/**
 * Ortex - ChatGPT Platform Adapter
 *
 * Handles detection of the ChatGPT web interface.
 *
 * MILESTONE 1: Detection only.
 * Conversation extraction and context injection are not yet implemented.
 *
 * Detection strategy:
 *   Primary   - hostname match (chat.openai.com or chatgpt.com)
 *   Secondary - presence of a known DOM element as a sanity check
 *
 * IMPORTANT: ChatGPT's DOM is subject to change without notice. Selectors
 * are documented here so failures are easy to diagnose and fix. The adapter
 * is designed to fall back gracefully rather than throw.
 */

import type { DetectionResult, PlatformAdapter } from "./platform-adapter"

/**
 * Known stable hostnames for the ChatGPT web interface.
 * OpenAI has operated both; both are treated as equivalent.
 */
const CHATGPT_HOSTNAMES = ["chat.openai.com", "chatgpt.com"] as const

/**
 * A secondary DOM signal used as a supporting (non-blocking) check.
 * This is a broad semantic element that should exist on any reasonable page.
 * If this check fails, detection still succeeds based on hostname alone.
 */
const CHATGPT_DOM_SIGNAL = "main"

export class ChatGPTAdapter implements PlatformAdapter {
  readonly platform = "chatgpt" as const

  detect(): DetectionResult {
    // Primary check: hostname
    const hostname = window.location.hostname
    const hostnameMatch = CHATGPT_HOSTNAMES.some((h) => hostname === h)

    if (!hostnameMatch) {
      return {
        detected: false,
        platform: this.platform,
        reason: `Hostname "${hostname}" does not match known ChatGPT hostnames`
      }
    }

    // Secondary check: DOM sanity (non-blocking)
    const domSignalPresent = document.querySelector(CHATGPT_DOM_SIGNAL) !== null
    if (!domSignalPresent) {
      console.warn(
        "[Ortex/ChatGPTAdapter] Hostname matched but DOM signal not found. " +
          "ChatGPT may have updated its markup. Proceeding with detection."
      )
    }

    return {
      detected: true,
      platform: this.platform
    }
  }
}
