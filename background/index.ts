/**
 * Ortex - Background Service Worker
 *
 * The central coordinator of the extension.
 *
 * Milestone 2 responsibilities:
 *   - Maintain a runtime map of tabId → PlatformSession.
 *   - Respond to GET_PLATFORM_STATE queries from the popup.
 *   - Relay EXTRACT_ACTIVE_CONVERSATION to the active content script.
 *   - Handle SAVE_CONVERSATION, GET_SAVED_CONVERSATIONS, GET_CONVERSATION
 *     via IndexedDB.
 *   - List open ChatGPT tabs (GET_CHATGPT_TABS).
 *   - Relay TRANSFER_CONTEXT to a specific tab's content script.
 *   - Clean up session state when tabs are removed or navigated.
 *
 * This file must NOT import DOM APIs. It runs in a service-worker context.
 *
 * Plasmo registers this file as the MV3 background service worker
 * automatically because it is located at background/index.ts.
 */

import {
  getAllConversations,
  getConversationById,
  saveConversation
} from "~src/storage/conversations"
import type {
  ContentExtractionResult,
  ContentInjectionResult,
  Conversation,
  ExtractConversationRequest,
  FromServiceWorkerMessage,
  GetChatGPTTabsRequest,
  GetChatGPTTabsResponse,
  GetConversationRequest,
  GetConversationResponse,
  GetPlatformStateRequest,
  GetSavedConversationsRequest,
  GetSavedConversationsResponse,
  OrtexTabInfo,
  PlatformDetectedMessage,
  PlatformSession,
  PlatformStateResponse,
  SaveConversationRequest,
  SaveConversationResponse,
  ToServiceWorkerMessage,
  TransferContextRequest,
  TransferResponse
} from "~src/types"

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

/**
 * In-memory session store. Maps Chrome tab IDs to their detected platform.
 *
 * Service workers can be terminated by the browser between events.
 * When the SW restarts, content scripts will re-detect and repopulate
 * this map on next popup open / user interaction.
 */
const sessions = new Map<number, PlatformSession>()

function isChatGPTUrl(url: string | undefined): boolean {
  if (!url) return false

  try {
    const parsed = new URL(url)
    return (
      (parsed.protocol === "https:" &&
        (parsed.hostname === "chat.openai.com" ||
          parsed.hostname === "chatgpt.com")) ||
      false
    )
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: ToServiceWorkerMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: FromServiceWorkerMessage) => void
  ): boolean => {
    switch (message.type) {
      case "PLATFORM_DETECTED":
        handlePlatformDetected(message, sender)
        return false // fire-and-forget

      case "GET_PLATFORM_STATE":
        handleGetPlatformState(sender, sendResponse as (r: PlatformStateResponse) => void)
        return true // async

      case "EXTRACT_ACTIVE_CONVERSATION":
        handleExtractConversation(sender, sendResponse)
        return true // async

      case "SAVE_CONVERSATION":
        handleSaveConversation(message, sendResponse as (r: SaveConversationResponse) => void)
        return true // async

      case "GET_SAVED_CONVERSATIONS":
        handleGetSavedConversations(sendResponse as (r: GetSavedConversationsResponse) => void)
        return true // async

      case "GET_CONVERSATION":
        handleGetConversation(message, sendResponse as (r: GetConversationResponse) => void)
        return true // async

      case "GET_CHATGPT_TABS":
        handleGetChatGPTTabs(sendResponse as (r: GetChatGPTTabsResponse) => void)
        return true // async

      case "TRANSFER_CONTEXT":
        handleTransferContext(message, sendResponse as (r: TransferResponse) => void)
        return true // async

      default:
        console.warn(
          "[Ortex/SW] Received unknown message type:",
          (message as { type: string }).type
        )
        return false
    }
  }
)

// ---------------------------------------------------------------------------
// Handler: PLATFORM_DETECTED
// ---------------------------------------------------------------------------

function handlePlatformDetected(
  message: PlatformDetectedMessage,
  sender: chrome.runtime.MessageSender
): void {
  const tabId = sender.tab?.id
  if (tabId === undefined) {
    console.warn("[Ortex/SW] PLATFORM_DETECTED received without a tab ID.")
    return
  }

  const session: PlatformSession = {
    tabId,
    platform: message.platform,
    detectedAt: Date.now()
  }

  sessions.set(tabId, session)
  console.log(`[Ortex/SW] Platform "${message.platform}" detected on tab ${tabId}.`)
}

// ---------------------------------------------------------------------------
// Handler: GET_PLATFORM_STATE
// ---------------------------------------------------------------------------

function handleGetPlatformState(
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: PlatformStateResponse) => void
): void {
  // Popup context: sender.tab is undefined
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      const activeTabId = tabs[0]?.id ?? undefined
      const session =
        activeTabId !== undefined ? sessions.get(activeTabId) : undefined
      const activeTab = tabs[0]
      const platform =
        session?.platform ??
        (isChatGPTUrl(activeTab?.url) ? "chatgpt" : null)

      sendResponse({
        type: "PLATFORM_STATE",
        platform,
        tabId: activeTabId ?? null
      })
    })
    .catch((err: unknown) => {
      console.error("[Ortex/SW] Failed to query active tab:", err)
      sendResponse({ type: "PLATFORM_STATE", platform: null, tabId: null })
    })
}

// ---------------------------------------------------------------------------
// Handler: EXTRACT_ACTIVE_CONVERSATION
// ---------------------------------------------------------------------------

function handleExtractConversation(
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: FromServiceWorkerMessage) => void
): void {
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      const tab = tabs[0]
      if (!tab?.id) {
        sendResponse({
          type: "EXTRACTION_ERROR",
          error: "No active tab found."
        })
        return
      }

      const session = sessions.get(tab.id)
      if (!session && !isChatGPTUrl(tab.url)) {
        sendResponse({
          type: "EXTRACTION_ERROR",
          error:
            "This tab is not a recognized ChatGPT page. Open a ChatGPT conversation and try again."
        })
        return
      }

      // Relay the command to the content script in the active tab
      chrome.tabs
        .sendMessage<{ type: string }, ContentExtractionResult>(tab.id, {
          type: "EXTRACT_CONVERSATION_COMMAND"
        })
        .then((result: ContentExtractionResult) => {
          if (result?.conversation) {
            sendResponse({
              type: "EXTRACTION_SUCCESS",
              conversation: result.conversation
            })
          } else {
            sendResponse({
              type: "EXTRACTION_ERROR",
              error: result?.error ?? "Extraction returned no conversation."
            })
          }
        })
        .catch((err: unknown) => {
          const msg =
            err instanceof Error ? err.message : "Content script unreachable."
          console.error("[Ortex/SW] Extraction relay failed:", err)
          sendResponse({
            type: "EXTRACTION_ERROR",
            error: `Could not reach the content script: ${msg}. Try reloading the ChatGPT tab.`
          })
        })
    })
    .catch((err: unknown) => {
      sendResponse({
        type: "EXTRACTION_ERROR",
        error: `Tab query failed: ${err instanceof Error ? err.message : "unknown error"}`
      })
    })
}

// ---------------------------------------------------------------------------
// Handler: SAVE_CONVERSATION
// ---------------------------------------------------------------------------

function handleSaveConversation(
  message: SaveConversationRequest,
  sendResponse: (response: SaveConversationResponse) => void
): void {
  saveConversation(message.conversation)
    .then(() => {
      sendResponse({ type: "SAVE_SUCCESS" })
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown storage error"
      console.error("[Ortex/SW] Save failed:", err)
      sendResponse({ type: "SAVE_ERROR", error: msg })
    })
}

// ---------------------------------------------------------------------------
// Handler: GET_SAVED_CONVERSATIONS
// ---------------------------------------------------------------------------

function handleGetSavedConversations(
  sendResponse: (response: GetSavedConversationsResponse) => void
): void {
  getAllConversations()
    .then((conversations: Conversation[]) => {
      sendResponse({ type: "SAVED_CONVERSATIONS", conversations })
    })
    .catch((err: unknown) => {
      console.error("[Ortex/SW] GetAll failed:", err)
      sendResponse({ type: "SAVED_CONVERSATIONS", conversations: [] })
    })
}

// ---------------------------------------------------------------------------
// Handler: GET_CONVERSATION
// ---------------------------------------------------------------------------

function handleGetConversation(
  message: GetConversationRequest,
  sendResponse: (response: GetConversationResponse) => void
): void {
  getConversationById(message.id)
    .then((conversation: Conversation | null) => {
      sendResponse({ type: "CONVERSATION_DATA", conversation })
    })
    .catch((err: unknown) => {
      console.error("[Ortex/SW] GetConversation failed:", err)
      sendResponse({ type: "CONVERSATION_DATA", conversation: null })
    })
}

// ---------------------------------------------------------------------------
// Handler: GET_CHATGPT_TABS
// ---------------------------------------------------------------------------

function handleGetChatGPTTabs(
  sendResponse: (response: GetChatGPTTabsResponse) => void
): void {
  // Query all tabs matching ChatGPT URLs
  chrome.tabs
    .query({ url: ["https://chat.openai.com/*", "https://chatgpt.com/*"] })
    .then((tabs) => {
      const ortexTabs: OrtexTabInfo[] = tabs
        .filter((tab) => tab.id !== undefined && tab.url !== undefined)
        .map((tab) => ({
          id: tab.id!,
          title: tab.title ?? "ChatGPT",
          url: tab.url!,
          platform: "chatgpt" as const
        }))

      sendResponse({ type: "CHATGPT_TABS", tabs: ortexTabs })
    })
    .catch((err: unknown) => {
      console.error("[Ortex/SW] GetChatGPTTabs failed:", err)
      sendResponse({ type: "CHATGPT_TABS", tabs: [] })
    })
}

// ---------------------------------------------------------------------------
// Handler: TRANSFER_CONTEXT
// ---------------------------------------------------------------------------

/**
 * Formats a Conversation into a readable context block for injection.
 */
function formatContextBlock(conversation: Conversation): string {
  const turnLines = conversation.messages
    .map((msg) => {
      const label = msg.role === "user" ? "User" : "Assistant"
      return `${label}:\n${msg.content}`
    })
    .join("\n\n")

  const titleLine = conversation.title
    ? `[Previous conversation: ${conversation.title}]`
    : "[Previous conversation]"

  return [
    "The following is context from a previous AI conversation.",
    "Use it as background information for my next request.",
    "Do not assume that every statement is still current.",
    "",
    titleLine,
    "",
    turnLines,
    "",
    "[End of previous conversation]",
    "",
    "Please continue from this context. Ask me if any essential information is missing."
  ].join("\n")
}

function handleTransferContext(
  message: TransferContextRequest,
  sendResponse: (response: TransferResponse) => void
): void {
  const contextText = formatContextBlock(message.conversation)

  chrome.tabs
    .sendMessage<{ type: string; text: string }, ContentInjectionResult>(
      message.destinationTabId,
      {
        type: "INJECT_CONTEXT_COMMAND",
        text: contextText
      }
    )
    .then((result: ContentInjectionResult) => {
      if (result?.success) {
        sendResponse({ type: "TRANSFER_SUCCESS" })
      } else {
        sendResponse({
          type: "TRANSFER_ERROR",
          error: result?.error ?? "Injection failed for an unknown reason."
        })
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "Content script unreachable."
      console.error("[Ortex/SW] Transfer relay failed:", err)
      sendResponse({
        type: "TRANSFER_ERROR",
        error: `Could not reach the destination tab: ${msg}. Reload the destination ChatGPT page and try again.`
      })
    })
}

// ---------------------------------------------------------------------------
// Tab lifecycle management
// ---------------------------------------------------------------------------

chrome.tabs.onRemoved.addListener((tabId: number) => {
  if (sessions.has(tabId)) {
    console.log(`[Ortex/SW] Tab ${tabId} closed. Removing platform session.`)
    sessions.delete(tabId)
  }
})

chrome.tabs.onUpdated.addListener(
  (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
    if (changeInfo.status === "loading" && sessions.has(tabId)) {
      console.log(`[Ortex/SW] Tab ${tabId} navigating. Clearing platform session.`)
      sessions.delete(tabId)
    }
  }
)

// ---------------------------------------------------------------------------
// Service worker lifecycle logging
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Ortex/SW] Extension installed / updated.")
})

console.log("[Ortex/SW] Service worker started.")
