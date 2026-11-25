/**
 * Ortex - Shared Type Contracts
 *
 * All types used across content scripts, service worker, and popup
 * are centralized here to enforce a single source of truth.
 *
 * Milestone 2: adds conversation extraction, storage, and transfer contracts.
 */

// ---------------------------------------------------------------------------
// Platform identifiers
// ---------------------------------------------------------------------------

/** Supported platform keys. Extend this union as new adapters are added. */
export type SupportedPlatform = "chatgpt" | "claude" | "gemini"

// ---------------------------------------------------------------------------
// Core data model
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "assistant"

export interface Message {
  id: string
  role: MessageRole
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
// Tab info (serializable subset of chrome.tabs.Tab)
// ---------------------------------------------------------------------------

export interface OrtexTabInfo {
  id: number
  title: string
  url: string
  platform: SupportedPlatform
}

// ---------------------------------------------------------------------------
// Extension messaging contracts — popup → service worker
// ---------------------------------------------------------------------------

/** Sent by a content script when it identifies the current page as a
 *  supported LLM platform. */
export interface PlatformDetectedMessage {
  type: "PLATFORM_DETECTED"
  platform: SupportedPlatform
}

/** Popup asks the service worker for the current platform + tab id. */
export interface GetPlatformStateRequest {
  type: "GET_PLATFORM_STATE"
}

/** Popup asks to extract the conversation from the active tab. */
export interface ExtractConversationRequest {
  type: "EXTRACT_ACTIVE_CONVERSATION"
}

/** Popup asks the service worker to save a conversation to storage. */
export interface SaveConversationRequest {
  type: "SAVE_CONVERSATION"
  conversation: Conversation
}

/** Popup asks for all saved conversations. */
export interface GetSavedConversationsRequest {
  type: "GET_SAVED_CONVERSATIONS"
}

/** Popup asks for a single saved conversation by id. */
export interface GetConversationRequest {
  type: "GET_CONVERSATION"
  id: string
}

/** Popup asks for a list of open ChatGPT tabs. */
export interface GetChatGPTTabsRequest {
  type: "GET_CHATGPT_TABS"
}

/** Popup asks to inject context into a specific tab. */
export interface TransferContextRequest {
  type: "TRANSFER_CONTEXT"
  destinationTabId: number
  conversation: Conversation
}

// ---------------------------------------------------------------------------
// Extension messaging contracts — content script ↔ service worker
// ---------------------------------------------------------------------------

/** Service worker asks a content script to extract the conversation. */
export interface ExtractConversationCommand {
  type: "EXTRACT_CONVERSATION_COMMAND"
}

/** Service worker asks a content script to inject context text. */
export interface InjectContextCommand {
  type: "INJECT_CONTEXT_COMMAND"
  text: string
}

// ---------------------------------------------------------------------------
// Responses — service worker → popup
// ---------------------------------------------------------------------------

export interface PlatformStateResponse {
  type: "PLATFORM_STATE"
  platform: SupportedPlatform | null
  tabId: number | null
}

export interface ExtractionSuccessResponse {
  type: "EXTRACTION_SUCCESS"
  conversation: Conversation
}

export interface ExtractionErrorResponse {
  type: "EXTRACTION_ERROR"
  error: string
}

export type ExtractionResponse = ExtractionSuccessResponse | ExtractionErrorResponse

export interface SaveConversationResponse {
  type: "SAVE_SUCCESS" | "SAVE_ERROR"
  error?: string
}

export interface GetSavedConversationsResponse {
  type: "SAVED_CONVERSATIONS"
  conversations: Conversation[]
}

export interface GetConversationResponse {
  type: "CONVERSATION_DATA"
  conversation: Conversation | null
}

export interface GetChatGPTTabsResponse {
  type: "CHATGPT_TABS"
  tabs: OrtexTabInfo[]
}

export interface TransferSuccessResponse {
  type: "TRANSFER_SUCCESS"
}

export interface TransferErrorResponse {
  type: "TRANSFER_ERROR"
  error: string
}

export type TransferResponse = TransferSuccessResponse | TransferErrorResponse

// ---------------------------------------------------------------------------
// Content script responses (content → service worker relay → popup)
// ---------------------------------------------------------------------------

export interface ContentExtractionResult {
  type: "CONTENT_EXTRACTION_RESULT"
  conversation?: Conversation
  error?: string
}

export interface ContentInjectionResult {
  type: "CONTENT_INJECTION_RESULT"
  success: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Discriminated unions for type narrowing
// ---------------------------------------------------------------------------

/** Union of all messages that can be sent TO the service worker. */
export type ToServiceWorkerMessage =
  | PlatformDetectedMessage
  | GetPlatformStateRequest
  | ExtractConversationRequest
  | SaveConversationRequest
  | GetSavedConversationsRequest
  | GetConversationRequest
  | GetChatGPTTabsRequest
  | TransferContextRequest

/** Union of all messages that the service worker can send back. */
export type FromServiceWorkerMessage =
  | PlatformStateResponse
  | ExtractionResponse
  | SaveConversationResponse
  | GetSavedConversationsResponse
  | GetConversationResponse
  | GetChatGPTTabsResponse
  | TransferResponse

/** Union of commands that the service worker sends to content scripts. */
export type ToContentScriptCommand =
  | ExtractConversationCommand
  | InjectContextCommand

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
