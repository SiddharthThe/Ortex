/**
 * Ortex - Background Service Worker
 *
 * The central coordinator of the extension.
 *
 * Responsibilities (Milestone 1):
 *   - Receive PLATFORM_DETECTED messages from content scripts.
 *   - Maintain a runtime map of tabId -> PlatformSession.
 *   - Respond to GET_PLATFORM_STATE queries from the popup.
 *   - Clean up session state when tabs are removed or navigated.
 *
 * This file must NOT import DOM APIs. It runs in a service-worker context.
 *
 * Plasmo registers this file as the MV3 background service worker
 * automatically because it is located at background/index.ts.
 */

import type {
  FromServiceWorkerMessage,
  PlatformDetectedMessage,
  PlatformSession,
  PlatformStateResponse,
  ToServiceWorkerMessage
} from "../src/types"

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

/**
 * In-memory session store. Maps Chrome tab IDs to their detected platform.
 *
 * NOTE: This is intentionally in-memory only. Service workers can be
 * terminated by the browser between events. For Milestone 1, this is
 * acceptable - the content script will re-detect on the next interaction
 * with the popup. Persistent state via chrome.storage will be added later.
 */
const sessions = new Map<number, PlatformSession>()

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: ToServiceWorkerMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: FromServiceWorkerMessage) => void
  ) => {
    switch (message.type) {
      case "PLATFORM_DETECTED":
        handlePlatformDetected(message, sender)
        // No response needed for fire-and-forget messages
        return false

      case "GET_PLATFORM_STATE":
        handleGetPlatformState(sender, sendResponse)
        // Return true to keep the message channel open for async response
        return true

      default:
        // Exhaustive check: TypeScript will warn if a message type is unhandled
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
    console.warn(
      "[Ortex/SW] PLATFORM_DETECTED received without a tab ID. Ignoring."
    )
    return
  }

  const session: PlatformSession = {
    tabId,
    platform: message.platform,
    detectedAt: Date.now()
  }

  sessions.set(tabId, session)

  console.log(
    `[Ortex/SW] Platform "${message.platform}" detected on tab ${tabId}.`
  )
}

// ---------------------------------------------------------------------------
// Handler: GET_PLATFORM_STATE
// ---------------------------------------------------------------------------

function handleGetPlatformState(
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: PlatformStateResponse) => void
): void {
  // The popup queries state for the currently active tab.
  // sender.tab is undefined when the message comes from a popup.
  if (sender.tab?.id !== undefined) {
    const session = sessions.get(sender.tab.id)
    sendResponse({
      type: "PLATFORM_STATE",
      platform: session?.platform ?? null
    })
    return
  }

  // Popup context: query the active tab from the focused window.
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      const activeTabId = tabs[0]?.id
      const session =
        activeTabId !== undefined ? sessions.get(activeTabId) : undefined

      const response: PlatformStateResponse = {
        type: "PLATFORM_STATE",
        platform: session?.platform ?? null
      }

      sendResponse(response)
    })
    .catch((err: unknown) => {
      console.error("[Ortex/SW] Failed to query active tab:", err)
      sendResponse({ type: "PLATFORM_STATE", platform: null })
    })
}

// ---------------------------------------------------------------------------
// Tab lifecycle management
// ---------------------------------------------------------------------------

/** When a tab is removed (closed), discard its session. */
chrome.tabs.onRemoved.addListener((tabId: number) => {
  if (sessions.has(tabId)) {
    console.log(
      `[Ortex/SW] Tab ${tabId} closed. Removing platform session.`
    )
    sessions.delete(tabId)
  }
})

/**
 * When a tab navigates to a new URL, discard the stale session.
 * The content script will re-detect if the new page is a supported platform.
 */
chrome.tabs.onUpdated.addListener(
  (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
    if (changeInfo.status === "loading" && sessions.has(tabId)) {
      console.log(
        `[Ortex/SW] Tab ${tabId} navigating. Clearing platform session.`
      )
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
