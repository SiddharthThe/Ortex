/**
 * Ortex - Shared Type Contracts
 *
 * All types used across content scripts, service worker, and popup
 * are centralized here to enforce a single source of truth.
 */

// ---------------------------------------------------------------------------
// Platform identifiers
// ---------------------------------------------------------------------------

/** Supported platform keys. Extend this union as new adapters are added. */
export type SupportedPlatform = "chatgpt" | "claude" | "gemini"

// ---------------------------------------------------------------------------
// Core data model
// ---------------------------------------------------------------------------

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: number
}

export interface Conversation {
  id: string
  platform: SupportedPlatform
  title?: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Extension messaging contracts
// ---------------------------------------------------------------------------

/**
 * Sent by a content script when it identifies the current page as a
 * supported LLM platform.
 */
export interface PlatformDetectedMessage {
  type: "PLATFORM_DETECTED"
  platform: SupportedPlatform
}

/**
 * Sent by the popup to ask the service worker for the current platform
 * state of the active tab.
 */
export interface GetPlatformStateRequest {
  type: "GET_PLATFORM_STATE"
}

/**
 * Service worker response to GET_PLATFORM_STATE.
 * platform is null when no supported platform is active in the queried tab.
 */
export interface PlatformStateResponse {
  type: "PLATFORM_STATE"
  platform: SupportedPlatform | null
}

/**
 * Union of all messages that can be sent TO the service worker.
 */
export type ToServiceWorkerMessage =
  | PlatformDetectedMessage
  | GetPlatformStateRequest

/**
 * Union of all messages that the service worker can send back.
 */
export type FromServiceWorkerMessage = PlatformStateResponse

// ---------------------------------------------------------------------------
// Service worker internal state
// ---------------------------------------------------------------------------

/**
 * Tracks which tab (if any) is currently on a supported platform.
 * The service worker maintains a map of tabId to PlatformSession at runtime.
 */
export interface PlatformSession {
  tabId: number
  platform: SupportedPlatform
  detectedAt: number
}
