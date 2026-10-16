/**
 * Ortex - ChatGPT Content Script
 *
 * Plasmo content script that runs on ChatGPT pages.
 *
 * Milestone 2 responsibilities:
 *   1. Detect the ChatGPT platform and notify the service worker.
 *   2. Respond to EXTRACT_CONVERSATION_COMMAND by extracting messages from
 *      the currently rendered conversation.
 *   3. Respond to INJECT_CONTEXT_COMMAND by inserting a context block into
 *      the ChatGPT composer (WITHOUT submitting it).
 *
 * Plasmo configuration exported at the bottom of this file controls which
 * URLs this script is injected into and when it runs.
 *
 * IMPORTANT: This file must NOT import the storage module. It runs in the
 * page's content-script context, NOT the service worker context. Storage
 * operations are handled by the service worker.
 */

import type { PlasmoCSConfig } from "plasmo"

import type {
  ContentExtractionResult,
  ContentInjectionResult,
  Conversation,
  Message,
  ToContentScriptCommand
} from "~src/types"
import { ChatGPTAdapter } from "~src/adapters/chatgpt-adapter"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[Ortex/ChatGPT]"

/**
 * DOM selectors for ChatGPT's conversation interface.
 *
 * ChatGPT uses data-testid attributes and semantic ARIA roles that are more
 * stable than class names (which are generated). These are documented here
 * so they can be maintained independently of the rest of the extension.
 *
 * MAINTENANCE NOTE: If extraction stops working, inspect the conversation
 * DOM structure at chat.openai.com and update these selectors.
 * Primary approach: data-testid="conversation-turn-*"
 * Fallback: [data-message-id], article[data-testid]
 */
const SELECTORS = {
  /** Container that holds all conversation turns */
  conversationContainer: [
    "[data-testid^='conversation-turn']",
    "article[data-testid]",
    "[data-message-id]"
  ],

  /** The prose/text content area within a turn */
  messageContent: [
    ".markdown.prose",
    "[data-message-content]",
    ".text-message",
    ".whitespace-pre-wrap"
  ],

  /** User turn indicators */
  userTurnIndicators: [
    "[data-message-author-role='user']",
    "[data-testid*='human']"
  ],

  /** Assistant turn indicators */
  assistantTurnIndicators: [
    "[data-message-author-role='assistant']",
    "[data-testid*='assistant']"
  ],

  /** The composer / prompt input textarea */
  composer: [
    "#prompt-textarea",
    "textarea[data-id]",
    "[contenteditable][data-id]",
    "textarea[placeholder*='Message']",
    "[contenteditable][placeholder*='Message']",
    "div[contenteditable='true']"
  ],

  /** Page title fallback candidates */
  pageTitle: ["title", "h1"]
} as const

// ---------------------------------------------------------------------------
// Adapter
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

function sendPlatformDetected(): void {
  chrome.runtime
    .sendMessage({ type: "PLATFORM_DETECTED", platform: "chatgpt" })
    .catch((err: unknown) => {
      console.warn(`${LOG_PREFIX} Failed to send PLATFORM_DETECTED:`, err)
    })
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Try a list of selectors and return the first element that matches, or null.
 */
function queryFirst(
  parent: Document | Element,
  selectors: readonly string[]
): Element | null {
  for (const selector of selectors) {
    try {
      const el = parent.querySelector(selector)
      if (el) return el
    } catch {
      // Malformed selector — skip
    }
  }
  return null
}

/**
 * Try a list of selectors and return all matching elements from the first
 * selector that produces results.
 */
function queryAll(
  parent: Document | Element,
  selectors: readonly string[]
): Element[] {
  for (const selector of selectors) {
    try {
      const els = Array.from(parent.querySelectorAll(selector))
      if (els.length > 0) return els
    } catch {
      // Malformed selector — skip
    }
  }
  return []
}

/**
 * Extract clean text from a content element.
 * Converts <br> and block-level elements to newlines, strips other HTML.
 */
function extractText(element: Element): string {
  // Walk the element tree and produce readable plain text
  function walk(el: Node): string {
    if (el.nodeType === Node.TEXT_NODE) {
      return el.textContent ?? ""
    }

    if (el.nodeType !== Node.ELEMENT_NODE) return ""

    const tag = (el as Element).tagName.toLowerCase()

    // Skip buttons, links that look like action elements, SVG, etc.
    if (["button", "svg", "script", "style"].includes(tag)) return ""

    const children = Array.from(el.childNodes).map(walk).join("")

    // Add line breaks for block-level elements
    if (
      ["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"].includes(
        tag
      )
    ) {
      return children.trimEnd() + "\n"
    }

    if (tag === "br") return "\n"

    if (tag === "pre" || tag === "code") {
      return children
    }

    return children
  }

  const raw = walk(element)
  // Collapse multiple consecutive blank lines to at most two
  return raw.replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Determine the role of a conversation turn element.
 * Returns null if the role cannot be determined.
 */
function detectTurnRole(turn: Element): "user" | "assistant" | null {
  // Strategy 1: data-message-author-role attribute on a descendant
  const authorRoleEl = turn.querySelector("[data-message-author-role]")
  if (authorRoleEl) {
    const role = authorRoleEl.getAttribute("data-message-author-role")
    if (role === "user" || role === "assistant") return role
  }

  // Strategy 2: data-testid on the turn itself or a parent
  const testId =
    turn.getAttribute("data-testid") ?? turn.closest("[data-testid]")?.getAttribute("data-testid") ?? ""

  if (testId.includes("human") || testId.includes("user")) return "user"
  if (testId.includes("assistant") || testId.includes("model")) return "assistant"

  // Strategy 3: aria-label / role indicators
  const ariaLabel = turn.getAttribute("aria-label") ?? ""
  if (/you said|your message/i.test(ariaLabel)) return "user"
  if (/chatgpt|assistant|response/i.test(ariaLabel)) return "assistant"

  return null
}

/**
 * Generate a stable ID for a message turn.
 * Uses the data-message-id attribute when available; otherwise falls back
 * to a position-based identifier (less stable across page refreshes).
 */
function extractTurnId(turn: Element, index: number): string {
  // Try data-message-id attribute on the turn itself
  const messageIdAttr = turn.getAttribute("data-message-id")
  if (messageIdAttr) return messageIdAttr

  // Try finding a descendant with data-message-id
  const withMessageId = turn.querySelector("[data-message-id]")
  if (withMessageId) {
    const id = withMessageId.getAttribute("data-message-id")
    if (id) return id
  }

  // Fallback to position-based
  return `chatgpt-turn-${index}`
}

/**
 * Extract the page title for the conversation.
 * Uses document.title with some cleanup of ChatGPT's suffix.
 */
function extractTitle(): string | undefined {
  const title = document.title
  if (!title || title === "ChatGPT") return undefined

  // ChatGPT appends " - ChatGPT" or "| ChatGPT" to conversation titles
  const clean = title
    .replace(/\s*[-|]\s*ChatGPT\s*$/i, "")
    .replace(/^ChatGPT\s*[-|]\s*/i, "")
    .trim()

  return clean || undefined
}

/**
 * Main extraction function.
 * Returns all visible conversation turns from the currently rendered page.
 */
function extractConversation(): Conversation {
  const now = Date.now()

  // Find all conversation turn elements
  const turns = queryAll(document, SELECTORS.conversationContainer)

  const messages: Message[] = []
  const seenIds = new Set<string>()

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]

    const role = detectTurnRole(turn)
    if (!role) continue // Skip turns we can't classify

    // Find the actual text content within the turn
    const contentEl = queryFirst(turn, SELECTORS.messageContent) ?? turn
    const content = extractText(contentEl)

    if (!content) continue // Skip empty turns

    const id = extractTurnId(turn, i)

    // De-duplicate by id
    if (seenIds.has(id)) continue
    seenIds.add(id)

    messages.push({
      id,
      role,
      content,
      timestamp: now // ChatGPT doesn't expose per-message timestamps in the DOM
    })
  }

  if (messages.length === 0) {
    throw new Error(
      "No rendered conversation messages were found. Wait for the conversation to finish loading and try again."
    )
  }

  // Extract a conversation-level id from the URL
  // ChatGPT URLs look like: /c/<uuid> or /g/<gpt-id>/c/<uuid>
  const urlMatch = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/)
  const conversationId = urlMatch?.[1] ?? `chatgpt-${now}`

  return {
    id: conversationId,
    platform: "chatgpt",
    title: extractTitle(),
    messages,
    createdAt: now,
    updatedAt: now
  }
}

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

/**
 * Find the ChatGPT composer element.
 * Returns the element or null if not found.
 */
function findComposer(): HTMLElement | null {
  for (const selector of SELECTORS.composer) {
    try {
      const el = document.querySelector(selector)
      if (el instanceof HTMLElement) return el
    } catch {
      // Malformed selector — skip
    }
  }
  return null
}

/**
 * Set the value of the composer and dispatch required input events so that
 * ChatGPT's React/state layer registers the change.
 *
 * Different ChatGPT composer implementations:
 * - Older: <textarea> — set .value + dispatch input event
 * - Newer: <div contenteditable> — set textContent + dispatch input/keydown events
 *
 * Returns true if text was successfully inserted and verified.
 */
function setComposerText(composer: HTMLElement, text: string): boolean {
  const isContentEditable =
    composer.getAttribute("contenteditable") !== null ||
    composer instanceof HTMLDivElement

  if (isContentEditable) {
    // For contenteditable divs, we need to use execCommand or direct mutation
    composer.focus()

    // Clear existing content first
    composer.textContent = ""

    // Use document.execCommand for compatibility with React's synthetic events
    try {
      document.execCommand("selectAll", false)
      document.execCommand("delete", false)
      document.execCommand("insertText", false, text)
    } catch {
      // execCommand not available — fall back to textContent mutation
      composer.textContent = text
    }

    // Dispatch events that React listens to
    composer.dispatchEvent(new Event("input", { bubbles: true }))
    composer.dispatchEvent(new Event("change", { bubbles: true }))

    // Verify insertion
    const verified =
      (composer.textContent ?? "").includes(text.slice(0, 50))
    return verified
  }

  // textarea path
  if (composer instanceof HTMLTextAreaElement) {
    // Warn user if there's an existing draft
    const existingDraft = composer.value.trim()
    if (existingDraft) {
      // Return false — caller should warn the user
      return false
    }

    // Use the React input value setter trick
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(composer, text)
    } else {
      composer.value = text
    }

    composer.dispatchEvent(new InputEvent("input", { bubbles: true }))
    composer.dispatchEvent(new Event("change", { bubbles: true }))

    // Verify
    const verified = composer.value.includes(text.slice(0, 50))
    return verified
  }

  return false
}

/**
 * Inject context text into the ChatGPT composer.
 * Returns a result indicating success or failure.
 */
function injectContext(text: string): ContentInjectionResult {
  const composer = findComposer()

  if (!composer) {
    return {
      type: "CONTENT_INJECTION_RESULT",
      success: false,
      error:
        "Could not find the ChatGPT composer. Make sure you are on a ChatGPT conversation page and the input area is visible."
    }
  }

  // Check for existing draft in textarea
  if (
    composer instanceof HTMLTextAreaElement &&
    composer.value.trim().length > 0
  ) {
    return {
      type: "CONTENT_INJECTION_RESULT",
      success: false,
      error:
        "The composer already contains a draft. Please clear it before transferring context."
    }
  }

  // Check for existing draft in contenteditable
  if (
    composer.getAttribute("contenteditable") !== null &&
    (composer.textContent ?? "").trim().length > 0
  ) {
    return {
      type: "CONTENT_INJECTION_RESULT",
      success: false,
      error:
        "The composer already contains a draft. Please clear it before transferring context."
    }
  }

  const success = setComposerText(composer, text)

  if (!success) {
    return {
      type: "CONTENT_INJECTION_RESULT",
      success: false,
      error:
        "Text injection failed or could not be verified. The composer may be using a format not yet supported."
    }
  }

  return { type: "CONTENT_INJECTION_RESULT", success: true }
}

// ---------------------------------------------------------------------------
// Message listener (service worker → content script)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: ToContentScriptCommand,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (
      response: ContentExtractionResult | ContentInjectionResult
    ) => void
  ) => {
    if (message.type === "EXTRACT_CONVERSATION_COMMAND") {
      try {
        const conversation = extractConversation()
        sendResponse({
          type: "CONTENT_EXTRACTION_RESULT",
          conversation
        })
      } catch (err: unknown) {
        sendResponse({
          type: "CONTENT_EXTRACTION_RESULT",
          error:
            err instanceof Error
              ? err.message
              : "Unknown extraction error"
        })
      }
      return true // async response
    }

    if (message.type === "INJECT_CONTEXT_COMMAND") {
      const result = injectContext(message.text)
      sendResponse(result)
      return true
    }

    return false
  }
)

// ---------------------------------------------------------------------------
// MutationObserver — minimal, used only to re-detect after SPA navigation
// ---------------------------------------------------------------------------

let observer: MutationObserver | null = null
let lastPathname = window.location.pathname

function startObserver(): void {
  if (observer) return

  observer = new MutationObserver(() => {
    // Only act on SPA navigation (URL changes), not every DOM mutation
    if (window.location.pathname !== lastPathname) {
      lastPathname = window.location.pathname
      // Re-detect platform (in case user navigated away and back)
      runDetection()
    }
  })

  // Observe only the minimal structure needed to catch SPA navigation
  observer.observe(document.body, { childList: true, subtree: false })

  console.log(`${LOG_PREFIX} Navigation observer started.`)
}

function stopObserver(): void {
  if (observer) {
    observer.disconnect()
    observer = null
    console.log(`${LOG_PREFIX} Navigation observer stopped.`)
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

// Plasmo injects the content script after DOM is ready (document_idle).
initialize()

window.addEventListener("unload", () => {
  stopObserver()
})

// ---------------------------------------------------------------------------
// Plasmo content script configuration
// ---------------------------------------------------------------------------

export const config: PlasmoCSConfig = {
  matches: ["https://chat.openai.com/*", "https://chatgpt.com/*"]
}
