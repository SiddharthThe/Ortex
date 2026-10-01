/**
 * Ortex - ChatGPT Content Script
 *
 * Plasmo content script that runs on ChatGPT pages.
 * Responsibilities (Milestone 1):
 *   1. Run the ChatGPT adapter to confirm the platform is active.
 *   2. Send a typed PLATFORM_DETECTED message to the service worker.
 *   3. Set up a MutationObserver skeleton for future conversation extraction.
 *
 * Plasmo configuration exported at the bottom of this file controls which
 * URLs this script is injected into and when it runs.
 */

import type { PlatformDetectedMessage } from "../src/types"
import { ChatGPTAdapter } from "../src/adapters/chatgpt-adapter"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[Ortex/ChatGPT]"

// ---------------------------------------------------------------------------
// Adapter instantiation
// ---------------------------------------------------------------------------

const adapter = new ChatGPTAdapter()

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function runDetection(): void {
  const result = adapter.detect()

  if (!result.detected) {
    console.log(
      `${LOG_PREFIX} Platform not detected on this page.`,
      result.reason ?? ""
    )
    return
  }

  console.log(`${LOG_PREFIX} Platform detected: ${result.platform}`)
  sendPlatformDetected()
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

function sendPlatformDetected(): void {
  const message: PlatformDetectedMessage = {
    type: "PLATFORM_DETECTED",
    platform: "chatgpt"
  }

  chrome.runtime.sendMessage(message).catch((err: unknown) => {
    // This can happen if the service worker is temporarily inactive.
    // It is not fatal; detection will re-run on page reload.
    console.warn(`${LOG_PREFIX} Failed to send PLATFORM_DETECTED:`, err)
  })
}

// ---------------------------------------------------------------------------
// MutationObserver skeleton
// ---------------------------------------------------------------------------
// NOTE: Conversation extraction is NOT implemented in Milestone 1.
// The observer is set up here to establish the architectural pattern.
// It will be expanded in future milestones.

let observer: MutationObserver | null = null

function startObserver(): void {
  if (observer) return // Guard against duplicate initialization

  observer = new MutationObserver((_mutations) => {
    // Milestone 1: observer is intentionally a no-op.
    // Future milestones will extract conversation turns here.
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true
  })

  console.log(`${LOG_PREFIX} MutationObserver started (skeleton mode).`)
}

function stopObserver(): void {
  if (observer) {
    observer.disconnect()
    observer = null
    console.log(`${LOG_PREFIX} MutationObserver stopped.`)
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initialize(): void {
  console.log(`${LOG_PREFIX} Content script initialized.`)
  runDetection()
  startObserver()
}

// Plasmo injects the content script after DOM is ready (document_idle),
// so we can safely call initialize() directly.
initialize()

// Clean up observer if the script context is torn down (e.g., navigation).
window.addEventListener("unload", () => {
  stopObserver()
})

// ---------------------------------------------------------------------------
// Plasmo content script configuration
// ---------------------------------------------------------------------------

export const config = {
  matches: ["https://chat.openai.com/*", "https://chatgpt.com/*"]
}
