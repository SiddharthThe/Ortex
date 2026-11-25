/**
 * Ortex Popup — Milestone 2
 *
 * Fully functional popup implementing the Detect → Extract → Preview →
 * Save → Transfer flow for ChatGPT.
 *
 * Architecture:
 *   - All data operations go through chrome.runtime.sendMessage to the
 *     service worker, which relays to content scripts as needed.
 *   - No DOM manipulation happens here; pure React + Chrome messaging.
 *   - State is local to the popup; persisted conversations are loaded from
 *     IndexedDB via the service worker on mount.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import type {
  Conversation,
  ExtractionResponse,
  GetChatGPTTabsResponse,
  GetSavedConversationsResponse,
  Message,
  OrtexTabInfo,
  PlatformStateResponse,
  SaveConversationResponse,
  SupportedPlatform,
  TransferResponse
} from "~src/types"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_LABELS: Record<SupportedPlatform, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini"
}

const PLATFORM_COLORS: Record<SupportedPlatform, string> = {
  chatgpt: "#10a37f",
  claude: "#d97706",
  gemini: "#4285f4"
}

// Max messages shown in the preview panel (full data is always saved)
const PREVIEW_MESSAGE_LIMIT = 20

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendMsg<Req extends { type: string }, Res>(
  message: Req
): Promise<Res> {
  return chrome.runtime.sendMessage<Req, Res>(message)
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + "…"
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type ViewMode = "main" | "preview" | "saved"

export default function IndexPopup() {
  // --- Detection state ---
  const [detectedPlatform, setDetectedPlatform] =
    useState<SupportedPlatform | null>(null)
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [platformLoading, setPlatformLoading] = useState(true)

  // --- Extraction state ---
  const [extracting, setExtracting] = useState(false)
  const [extractedConversation, setExtractedConversation] =
    useState<Conversation | null>(null)
  const [extractionError, setExtractionError] = useState<string | null>(null)

  // --- Save state ---
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // --- Saved conversations ---
  const [savedConversations, setSavedConversations] = useState<Conversation[]>(
    []
  )
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null)

  // --- Transfer state ---
  const [chatgptTabs, setChatgptTabs] = useState<OrtexTabInfo[]>([])
  const [destinationTabId, setDestinationTabId] = useState<number | null>(null)
  const [transferring, setTransferring] = useState(false)
  const [transferSuccess, setTransferSuccess] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)

  // --- UI navigation ---
  const [view, setView] = useState<ViewMode>("main")

  // --- Avoid stale closures in async callbacks ---
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // ---------------------------------------------------------------------------
  // On mount: detect platform + load saved conversations + list tabs
  // ---------------------------------------------------------------------------

  const detectPlatform = useCallback(async () => {
    setPlatformLoading(true)
    try {
      const res = await sendMsg<{ type: "GET_PLATFORM_STATE" }, PlatformStateResponse>(
        { type: "GET_PLATFORM_STATE" }
      )
      if (!mountedRef.current) return
      setDetectedPlatform(res?.platform ?? null)
      setActiveTabId(res?.tabId ?? null)
    } catch {
      if (!mountedRef.current) return
      setDetectedPlatform(null)
      setActiveTabId(null)
    } finally {
      if (mountedRef.current) setPlatformLoading(false)
    }
  }, [])

  const loadSavedConversations = useCallback(async () => {
    try {
      const res = await sendMsg<
        { type: "GET_SAVED_CONVERSATIONS" },
        GetSavedConversationsResponse
      >({ type: "GET_SAVED_CONVERSATIONS" })
      if (!mountedRef.current) return
      setSavedConversations(res?.conversations ?? [])
    } catch {
      // non-fatal; saved list just stays empty
    }
  }, [])

  const loadChatGPTTabs = useCallback(async () => {
    try {
      const res = await sendMsg<
        { type: "GET_CHATGPT_TABS" },
        GetChatGPTTabsResponse
      >({ type: "GET_CHATGPT_TABS" })
      if (!mountedRef.current) return
      const tabs = res?.tabs ?? []
      setChatgptTabs(tabs)
      // Pre-select first tab that is not the current active tab
      if (tabs.length > 0 && destinationTabId === null) {
        const nonActive = tabs.find((t) => t.id !== activeTabId)
        setDestinationTabId(nonActive?.id ?? tabs[0].id)
      }
    } catch {
      // non-fatal
    }
  }, [activeTabId, destinationTabId])

  useEffect(() => {
    detectPlatform()
    loadSavedConversations()
  }, [detectPlatform, loadSavedConversations])

  // Load ChatGPT tabs once we know the active tab
  useEffect(() => {
    loadChatGPTTabs()
  }, [loadChatGPTTabs])

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleExtract = async () => {
    setExtracting(true)
    setExtractionError(null)
    setExtractedConversation(null)
    setSaveSuccess(false)
    setSaveError(null)
    setTransferSuccess(false)
    setTransferError(null)

    try {
      const res = await sendMsg<
        { type: "EXTRACT_ACTIVE_CONVERSATION" },
        ExtractionResponse
      >({ type: "EXTRACT_ACTIVE_CONVERSATION" })

      if (!mountedRef.current) return

      if (res?.type === "EXTRACTION_SUCCESS") {
        setExtractedConversation(res.conversation)
        setView("preview")
      } else {
        setExtractionError(
          (res as { error?: string })?.error ??
            "Extraction failed. No messages were found."
        )
      }
    } catch (err) {
      if (!mountedRef.current) return
      setExtractionError(
        err instanceof Error
          ? err.message
          : "Could not communicate with the extension service worker."
      )
    } finally {
      if (mountedRef.current) setExtracting(false)
    }
  }

  const handleSave = async () => {
    if (!extractedConversation) return
    setSaving(true)
    setSaveSuccess(false)
    setSaveError(null)

    try {
      const res = await sendMsg<
        { type: "SAVE_CONVERSATION"; conversation: Conversation },
        SaveConversationResponse
      >({
        type: "SAVE_CONVERSATION",
        conversation: {
          ...extractedConversation,
          updatedAt: Date.now()
        }
      })

      if (!mountedRef.current) return

      if (res?.type === "SAVE_SUCCESS") {
        setSaveSuccess(true)
        loadSavedConversations()
      } else {
        setSaveError(
          (res as { error?: string })?.error ?? "Failed to save conversation."
        )
      }
    } catch (err) {
      if (!mountedRef.current) return
      setSaveError(
        err instanceof Error ? err.message : "Save operation failed."
      )
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const handleTransfer = async (conversation: Conversation) => {
    if (!destinationTabId) {
      setTransferError("Select a destination ChatGPT tab first.")
      return
    }

    setTransferring(true)
    setTransferSuccess(false)
    setTransferError(null)

    try {
      const res = await sendMsg<
        {
          type: "TRANSFER_CONTEXT"
          destinationTabId: number
          conversation: Conversation
        },
        TransferResponse
      >({
        type: "TRANSFER_CONTEXT",
        destinationTabId,
        conversation
      })

      if (!mountedRef.current) return

      if (res?.type === "TRANSFER_SUCCESS") {
        setTransferSuccess(true)
      } else {
        setTransferError(
          (res as { error?: string })?.error ?? "Transfer failed."
        )
      }
    } catch (err) {
      if (!mountedRef.current) return
      setTransferError(
        err instanceof Error ? err.message : "Transfer operation failed."
      )
    } finally {
      if (mountedRef.current) setTransferring(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const conversationForTransfer =
    selectedSavedId !== null
      ? (savedConversations.find((c) => c.id === selectedSavedId) ?? null)
      : extractedConversation

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={styles.root}>
      {/* ── Header ── */}
      <div style={styles.header}>
        <div style={styles.logoBox}>O</div>
        <div>
          <div style={styles.logoName}>Ortex</div>
          <div style={styles.logoSub}>LLM Context Orchestrator</div>
        </div>

        {/* Refresh button */}
        <button
          id="btn-refresh"
          onClick={() => {
            detectPlatform()
            loadSavedConversations()
            loadChatGPTTabs()
          }}
          style={styles.iconBtn}
          title="Refresh detection"
          aria-label="Refresh platform detection"
        >
          ↻
        </button>
      </div>

      {/* ── Platform Status ── */}
      <section style={styles.section} aria-label="Current platform">
        <label style={styles.label}>CURRENT PLATFORM</label>
        <PlatformBadge
          loading={platformLoading}
          platform={detectedPlatform}
        />
      </section>

      {/* ── Tab Nav ── */}
      <div style={styles.tabNav} role="tablist">
        {(["main", "saved"] as ViewMode[]).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            id={`tab-${v}`}
            onClick={() => setView(v)}
            style={{
              ...styles.tabBtn,
              ...(view === v ? styles.tabBtnActive : {})
            }}
          >
            {v === "main" ? "Extract" : `Saved (${savedConversations.length})`}
          </button>
        ))}
        {extractedConversation && (
          <button
            role="tab"
            aria-selected={view === "preview"}
            id="tab-preview"
            onClick={() => setView("preview")}
            style={{
              ...styles.tabBtn,
              ...(view === "preview" ? styles.tabBtnActive : {})
            }}
          >
            Preview
          </button>
        )}
      </div>

      {/* ── Main View ── */}
      {view === "main" && (
        <MainView
          platform={detectedPlatform}
          extracting={extracting}
          extractionError={extractionError}
          extractedConversation={extractedConversation}
          onExtract={handleExtract}
        />
      )}

      {/* ── Preview View ── */}
      {view === "preview" && extractedConversation && (
        <PreviewView
          conversation={extractedConversation}
          saving={saving}
          saveSuccess={saveSuccess}
          saveError={saveError}
          onSave={handleSave}
          onBack={() => setView("main")}
        />
      )}

      {/* ── Saved View ── */}
      {view === "saved" && (
        <SavedView
          conversations={savedConversations}
          selectedId={selectedSavedId}
          onSelect={(id) => setSelectedSavedId(id === selectedSavedId ? null : id)}
        />
      )}

      {/* ── Transfer Section (always visible) ── */}
      <section style={styles.transferSection} aria-label="Transfer context">
        <label style={styles.label}>TRANSFER CONTEXT</label>

        {/* Context source indicator */}
        <div style={styles.transferSourceRow}>
          <span style={styles.fieldLabel}>
            {conversationForTransfer
              ? `Using: ${truncate(conversationForTransfer.title ?? "Untitled conversation", 30)}`
              : "No conversation selected"}
          </span>
          <span style={styles.badge}>
            {conversationForTransfer
              ? `${conversationForTransfer.messages.length} msgs`
              : "—"}
          </span>
        </div>

        {/* Destination tab selector */}
        <div style={styles.field}>
          <span style={styles.fieldLabel}>Destination tab</span>
          {chatgptTabs.length === 0 ? (
            <span style={styles.dimText}>No ChatGPT tabs open</span>
          ) : (
            <select
              id="select-destination-tab"
              value={destinationTabId ?? ""}
              onChange={(e) =>
                setDestinationTabId(parseInt(e.target.value, 10))
              }
              style={styles.select}
            >
              {chatgptTabs.map((tab) => (
                <option
                  key={tab.id}
                  value={tab.id}
                  disabled={tab.id === activeTabId}
                >
                  {truncate(tab.title, 35)}
                  {tab.id === activeTabId ? " (current)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Transfer button */}
        <button
          id="btn-transfer"
          onClick={() =>
            conversationForTransfer && handleTransfer(conversationForTransfer)
          }
          disabled={
            !conversationForTransfer || !destinationTabId || transferring
          }
          style={{
            ...styles.primaryBtn,
            ...((!conversationForTransfer || !destinationTabId || transferring)
              ? styles.primaryBtnDisabled
              : {})
          }}
        >
          {transferring ? "Transferring…" : "Transfer Context →"}
        </button>

        {transferSuccess && (
          <StatusBanner type="success">
            ✓ Context inserted into destination tab. The message is not sent — you
            must press Enter to send it.
          </StatusBanner>
        )}
        {transferError && (
          <StatusBanner type="error">{transferError}</StatusBanner>
        )}
      </section>

      {/* Footer */}
      <div style={styles.footer}>Local-first · No mandatory API keys</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PlatformBadge({
  loading,
  platform
}: {
  loading: boolean
  platform: SupportedPlatform | null
}) {
  const dotColor = loading ? "#555d70" : platform ? "#22c55e" : "#737373"
  const label = loading
    ? "Detecting platform…"
    : platform
      ? `${PLATFORM_LABELS[platform]} detected`
      : "No supported platform detected"

  const borderColor = platform
    ? PLATFORM_COLORS[platform] + "55"
    : "#252938"

  return (
    <div
      style={{
        ...styles.platformBadge,
        borderColor,
        boxShadow: platform
          ? `0 0 0 1px ${PLATFORM_COLORS[platform]}33`
          : "none"
      }}
    >
      <span
        style={{
          ...styles.dot,
          background: dotColor,
          boxShadow: platform ? `0 0 6px ${dotColor}88` : "none"
        }}
      />
      <span style={{ fontSize: "13px", color: platform ? "#86efac" : "#c9ceda" }}>
        {label}
      </span>
    </div>
  )
}

function MainView({
  platform,
  extracting,
  extractionError,
  extractedConversation,
  onExtract
}: {
  platform: SupportedPlatform | null
  extracting: boolean
  extractionError: string | null
  extractedConversation: Conversation | null
  onExtract: () => void
}) {
  const canExtract = platform === "chatgpt" && !extracting

  return (
    <section style={styles.section} aria-label="Extract conversation">
      <label style={styles.label}>ACTIVE CONVERSATION</label>

      {!platform ? (
        <EmptyState
          icon="🔍"
          title="No supported platform detected"
          description="Open a ChatGPT conversation in this tab, then click Refresh."
        />
      ) : platform !== "chatgpt" ? (
        <EmptyState
          icon="⚠️"
          title={`${PLATFORM_LABELS[platform]} detected`}
          description="Only ChatGPT extraction is supported in this milestone."
        />
      ) : (
        <div>
          {extractedConversation ? (
            <div style={styles.extractedSummary}>
              <div style={styles.convTitle}>
                {extractedConversation.title ?? "Untitled conversation"}
              </div>
              <div style={styles.convMeta}>
                {extractedConversation.messages.length} messages ·{" "}
                {formatTimestamp(extractedConversation.updatedAt)}
              </div>
            </div>
          ) : (
            <div style={styles.emptyConv}>
              <div style={styles.emptyIcon}>💬</div>
              <div style={styles.emptyTitle}>Ready to extract</div>
              <div style={styles.emptyDesc}>
                Click below to extract the current ChatGPT conversation.
              </div>
            </div>
          )}

          <button
            id="btn-extract"
            onClick={onExtract}
            disabled={!canExtract}
            style={{
              ...styles.primaryBtn,
              marginTop: "10px",
              ...(!canExtract ? styles.primaryBtnDisabled : {})
            }}
          >
            {extracting
              ? "Extracting…"
              : extractedConversation
                ? "Re-extract Conversation"
                : "Extract Conversation"}
          </button>

          {extractionError && (
            <StatusBanner type="error">{extractionError}</StatusBanner>
          )}
        </div>
      )}
    </section>
  )
}

function PreviewView({
  conversation,
  saving,
  saveSuccess,
  saveError,
  onSave,
  onBack
}: {
  conversation: Conversation
  saving: boolean
  saveSuccess: boolean
  saveError: string | null
  onSave: () => void
  onBack: () => void
}) {
  const preview = conversation.messages.slice(0, PREVIEW_MESSAGE_LIMIT)
  const truncated = conversation.messages.length > PREVIEW_MESSAGE_LIMIT

  return (
    <section style={styles.section} aria-label="Conversation preview">
      <div style={styles.previewHeader}>
        <div>
          <label style={styles.label}>CONVERSATION PREVIEW</label>
          <div style={styles.convMeta}>
            {conversation.messages.length} messages ·{" "}
            {PLATFORM_LABELS[conversation.platform]}
          </div>
        </div>
        <button onClick={onSave} disabled={saving} id="btn-save" style={styles.saveBtn}>
          {saving ? "Saving…" : saveSuccess ? "✓ Saved" : "Save"}
        </button>
      </div>

      {conversation.title && (
        <div style={styles.convTitle}>{conversation.title}</div>
      )}

      {saveError && <StatusBanner type="error">{saveError}</StatusBanner>}
      {saveSuccess && (
        <StatusBanner type="success">
          Conversation saved locally. It will persist after popup closure.
        </StatusBanner>
      )}

      <div
        style={styles.messageList}
        role="list"
        aria-label="Conversation messages"
      >
        {preview.length === 0 ? (
          <div style={styles.emptyDesc}>No messages extracted.</div>
        ) : (
          preview.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
        {truncated && (
          <div style={styles.truncationNote}>
            Showing {PREVIEW_MESSAGE_LIMIT} of {conversation.messages.length}{" "}
            messages. All messages are saved.
          </div>
        )}
      </div>
    </section>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user"

  return (
    <div
      role="listitem"
      style={{
        ...styles.messageBubble,
        ...(isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant)
      }}
    >
      <div
        style={{
          ...styles.messageRole,
          color: isUser ? "#a5b4fc" : "#86efac"
        }}
      >
        {isUser ? "You" : "ChatGPT"}
      </div>
      <div style={styles.messageContent}>
        {truncate(message.content, 300)}
      </div>
    </div>
  )
}

function SavedView({
  conversations,
  selectedId,
  onSelect
}: {
  conversations: Conversation[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (conversations.length === 0) {
    return (
      <section style={styles.section} aria-label="Saved conversations">
        <label style={styles.label}>SAVED CONVERSATIONS</label>
        <EmptyState
          icon="📂"
          title="No saved conversations yet"
          description="Extract a conversation and save it to see it here."
        />
      </section>
    )
  }

  return (
    <section style={styles.section} aria-label="Saved conversations">
      <label style={styles.label}>SAVED CONVERSATIONS</label>
      <div style={styles.savedList} role="list">
        {conversations.map((conv) => {
          const selected = conv.id === selectedId
          return (
            <button
              key={conv.id}
              role="listitem"
              id={`saved-conv-${conv.id}`}
              onClick={() => onSelect(conv.id)}
              style={{
                ...styles.savedItem,
                ...(selected ? styles.savedItemSelected : {})
              }}
            >
              <div style={styles.savedItemTitle}>
                {selected ? "✓ " : ""}
                {truncate(conv.title ?? "Untitled conversation", 35)}
              </div>
              <div style={styles.savedItemMeta}>
                {conv.messages.length} msgs ·{" "}
                {formatTimestamp(conv.updatedAt)} ·{" "}
                {PLATFORM_LABELS[conv.platform]}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function EmptyState({
  icon,
  title,
  description
}: {
  icon: string
  title: string
  description: string
}) {
  return (
    <div style={styles.emptyConv}>
      <div style={styles.emptyIcon}>{icon}</div>
      <div style={styles.emptyTitle}>{title}</div>
      <div style={styles.emptyDesc}>{description}</div>
    </div>
  )
}

function StatusBanner({
  type,
  children
}: {
  type: "success" | "error"
  children: React.ReactNode
}) {
  return (
    <div
      role="alert"
      style={{
        ...styles.banner,
        ...(type === "success" ? styles.bannerSuccess : styles.bannerError)
      }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  root: {
    width: "380px",
    minHeight: "520px",
    maxHeight: "640px",
    overflowY: "auto" as const,
    background: "#0f1117",
    color: "#ffffff",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    padding: "20px",
    boxSizing: "border-box" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: "0px"
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "20px"
  },
  logoBox: {
    width: "38px",
    height: "38px",
    borderRadius: "10px",
    background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "18px",
    fontWeight: 700,
    flexShrink: 0
  },
  logoName: {
    fontSize: "18px",
    fontWeight: 700,
    letterSpacing: "-0.3px"
  },
  logoSub: {
    fontSize: "11px",
    color: "#8b93a7",
    marginTop: "2px"
  },
  iconBtn: {
    marginLeft: "auto",
    background: "transparent",
    border: "1px solid #252938",
    borderRadius: "8px",
    color: "#737b8e",
    fontSize: "18px",
    width: "34px",
    height: "34px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "border-color 0.15s, color 0.15s"
  },
  section: {
    marginBottom: "16px"
  },
  label: {
    display: "block",
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "1.2px",
    color: "#6f778a",
    marginBottom: "7px"
  },
  platformBadge: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    background: "#171a23",
    border: "1px solid #252938",
    borderRadius: "10px",
    padding: "12px",
    transition: "border-color 0.2s"
  },
  dot: {
    width: "9px",
    height: "9px",
    borderRadius: "50%",
    display: "inline-block",
    flexShrink: 0,
    transition: "background 0.2s, box-shadow 0.2s"
  },
  tabNav: {
    display: "flex",
    gap: "6px",
    marginBottom: "14px"
  },
  tabBtn: {
    flex: 1,
    padding: "7px",
    borderRadius: "8px",
    border: "1px solid #252938",
    background: "#171a23",
    color: "#6f778a",
    fontSize: "11px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s"
  },
  tabBtnActive: {
    borderColor: "#6366f1",
    background: "#1c1a3a",
    color: "#a5b4fc"
  },
  emptyConv: {
    background: "#171a23",
    border: "1px solid #252938",
    borderRadius: "10px",
    padding: "20px",
    textAlign: "center" as const
  },
  emptyIcon: {
    fontSize: "28px",
    marginBottom: "8px"
  },
  emptyTitle: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#dce0e9",
    marginBottom: "4px"
  },
  emptyDesc: {
    fontSize: "11px",
    color: "#737b8e",
    lineHeight: 1.5
  },
  extractedSummary: {
    background: "#171a23",
    border: "1px solid #252938",
    borderRadius: "10px",
    padding: "12px 14px"
  },
  convTitle: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#dce0e9",
    marginBottom: "3px"
  },
  convMeta: {
    fontSize: "10px",
    color: "#737b8e"
  },
  primaryBtn: {
    width: "100%",
    padding: "11px",
    border: "none",
    borderRadius: "10px",
    background: "linear-gradient(135deg, #6366f1, #7c3aed)",
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(99, 102, 241, 0.25)",
    transition: "opacity 0.15s"
  },
  primaryBtnDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
    boxShadow: "none"
  },
  saveBtn: {
    padding: "6px 14px",
    borderRadius: "8px",
    border: "1px solid #6366f1",
    background: "#1c1a3a",
    color: "#a5b4fc",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer"
  },
  banner: {
    marginTop: "8px",
    padding: "9px 12px",
    borderRadius: "8px",
    fontSize: "11px",
    lineHeight: 1.5
  },
  bannerSuccess: {
    background: "#052e16",
    border: "1px solid #166534",
    color: "#86efac"
  },
  bannerError: {
    background: "#2d0a0a",
    border: "1px solid #7f1d1d",
    color: "#fca5a5"
  },
  previewHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: "10px"
  },
  messageList: {
    maxHeight: "220px",
    overflowY: "auto" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    marginTop: "10px",
    paddingRight: "2px"
  },
  messageBubble: {
    borderRadius: "8px",
    padding: "8px 10px",
    border: "1px solid transparent"
  },
  messageBubbleUser: {
    background: "#1a1730",
    borderColor: "#312e6d"
  },
  messageBubbleAssistant: {
    background: "#101a14",
    borderColor: "#14532d"
  },
  messageRole: {
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "0.8px",
    marginBottom: "4px"
  },
  messageContent: {
    fontSize: "11px",
    color: "#c9ceda",
    lineHeight: 1.55,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const
  },
  truncationNote: {
    fontSize: "10px",
    color: "#555d70",
    textAlign: "center" as const,
    padding: "6px"
  },
  savedList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
    maxHeight: "200px",
    overflowY: "auto" as const
  },
  savedItem: {
    width: "100%",
    background: "#171a23",
    border: "1px solid #252938",
    borderRadius: "9px",
    padding: "10px 12px",
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "border-color 0.15s"
  },
  savedItemSelected: {
    borderColor: "#6366f1",
    background: "#1c1a3a"
  },
  savedItemTitle: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#dce0e9",
    marginBottom: "3px"
  },
  savedItemMeta: {
    fontSize: "10px",
    color: "#737b8e"
  },
  transferSection: {
    borderTop: "1px solid #1e2130",
    paddingTop: "16px",
    marginTop: "4px"
  },
  transferSourceRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#171a23",
    border: "1px solid #252938",
    borderRadius: "9px",
    padding: "8px 12px",
    marginBottom: "8px"
  },
  field: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#171a23",
    border: "1px solid #252938",
    borderRadius: "9px",
    padding: "9px 11px",
    marginBottom: "8px"
  },
  fieldLabel: {
    fontSize: "12px",
    color: "#9da5b7"
  },
  badge: {
    fontSize: "10px",
    background: "#252938",
    color: "#737b8e",
    borderRadius: "5px",
    padding: "2px 7px"
  },
  dimText: {
    fontSize: "11px",
    color: "#555d70",
    fontStyle: "italic"
  },
  select: {
    background: "#20232d",
    border: "1px solid #303444",
    borderRadius: "6px",
    color: "#dce0e9",
    padding: "5px 7px",
    fontSize: "11px",
    outline: "none",
    cursor: "pointer",
    maxWidth: "180px"
  },
  footer: {
    textAlign: "center" as const,
    fontSize: "10px",
    color: "#555d70",
    marginTop: "12px",
    paddingTop: "12px",
    borderTop: "1px solid #1e2130"
  }
} as const