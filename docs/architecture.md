# Ortex — Architecture Documentation

**Version:** Milestone 1  
**Date:** 2026-10-01  
**Status:** In development — Milestone 1 complete

---

## Overview

Ortex is a Chromium Manifest V3 browser extension built with Plasmo and TypeScript.  
Its goal is to capture conversational context from web-based LLM interfaces (ChatGPT, Claude, Gemini),
normalize it into a platform-independent format, and inject that context into another supported platform.

The system operates **entirely locally in the browser**. No project-owned server, no cloud database,
no paid API calls are required for the core orchestration loop.

---

## Directory Structure (Milestone 1)

`
Ortex/
├── src/
│   ├── types/
│   │   └── index.ts          # Shared type contracts (single source of truth)
│   └── adapters/
│       ├── platform-adapter.ts   # PlatformAdapter interface
│       └── chatgpt-adapter.ts    # ChatGPT detection adapter
├── contents/
│   └── chatgpt.ts            # Plasmo content script — ChatGPT pages
├── background/
│   └── index.ts              # MV3 service worker
├── popup.tsx                  # React popup UI
└── docs/
    └── architecture.md        # This file
`

---

## Components

### 1. Shared Types (src/types/index.ts)

All cross-component contracts are defined here:

- SupportedPlatform — Union type of platform keys ("chatgpt" | "claude" | "gemini")
- Message — A single conversation turn (id, role, content, timestamp)
- Conversation — A complete normalized conversation (platform-independent)
- PlatformDetectedMessage — Typed message sent by content script to service worker
- GetPlatformStateRequest — Typed query sent by popup to service worker
- PlatformStateResponse — Typed response from service worker to popup
- PlatformSession — Runtime state held by the service worker per active tab

**Principle:** Nothing is typed as ny. All messages between components use discriminated unions
so exhaustive handling is enforced by the TypeScript compiler.

---

### 2. Platform Adapter Architecture (src/adapters/)

The adapter system separates platform-specific knowledge from the orchestration core.

#### PlatformAdapter (interface)

`	ypescript
interface PlatformAdapter {
  readonly platform: SupportedPlatform
  detect(): DetectionResult
}
`

Each adapter encapsulates:
- How to identify its platform (currently: detection only)
- (Future) How to extract structured conversation data from the DOM
- (Future) How to inject context into the platform's composer

**Current adapters:**

| Adapter | Platform | Status |
|---|---|---|
| ChatGPTAdapter | chatgpt | Detection only (Milestone 1) |
| ClaudeAdapter | claude | Not yet implemented |
| GeminiAdapter | gemini | Not yet implemented |

#### ChatGPTAdapter

Detection strategy (layered):
1. **Primary:** Hostname check — matches chat.openai.com and chatgpt.com
2. **Secondary:** DOM sanity check (presence of <main>) — non-blocking, diagnostic only

If the hostname matches, detection succeeds regardless of the DOM check.  
This makes the adapter resilient to minor markup changes.

**Important:** ChatGPT's DOM structure is not guaranteed to remain stable.
Selectors are deliberately minimal for Milestone 1. They are documented within
the adapter file so failures are easy to locate and fix.

---

### 3. Content Script (contents/chatgpt.ts)

Plasmo automatically injects this file into pages matching:
- https://chat.openai.com/*
- https://chatgpt.com/*

**Responsibilities (Milestone 1):**
1. Instantiate ChatGPTAdapter and call detect()
2. If detected, send PLATFORM_DETECTED to the service worker via chrome.runtime.sendMessage
3. Start a MutationObserver skeleton (currently a no-op — future milestones will extract turns here)

**Failure handling:**
- If sendMessage fails (service worker not ready), the error is logged as a warning.
  The popup will show "No supported platform detected" rather than crashing.

**Plasmo convention:**  
The exported config object at the bottom of the file controls URL matching.
No manual manifest.json edits are required.

---

### 4. Background Service Worker (ackground/index.ts)

The MV3 service worker acts as the **central coordinator**.

**Runtime state:**

`	ypescript
const sessions = new Map<number, PlatformSession>()
`

Maps Chrome tab IDs to detected platforms. This is in-memory only.
Service workers can be terminated between events; persistent storage
(via chrome.storage) will be added in a later milestone if needed.

**Message routing:**

| Incoming message | Handler | Sends back |
|---|---|---|
| PLATFORM_DETECTED | Records session for tab | Nothing |
| GET_PLATFORM_STATE | Looks up active tab | PLATFORM_STATE |

**Tab lifecycle management:**
- chrome.tabs.onRemoved → removes session when a tab is closed
- chrome.tabs.onUpdated (loading status) → removes session on navigation

**Why in-memory?**  
For Milestone 1, re-detection on page reload is acceptable. The content script
will fire PLATFORM_DETECTED again after each navigation, so state converges
quickly. Persistent caching adds complexity without benefit at this stage.

---

### 5. Popup (popup.tsx)

The React popup communicates exclusively with the service worker.
It does **not** interact with the DOM of the active tab directly.

**On mount:**
1. Sends GET_PLATFORM_STATE to the service worker
2. Receives PLATFORM_STATE response
3. Renders one of:
   - "Detecting platform…" (loading)
   - "ChatGPT detected" (green indicator)
   - "No supported platform detected" (grey indicator)

**Design principle:** The popup is a thin presentation layer.
Business logic lives in the service worker and adapters.

---

## Messaging Architecture

`
Content Script                 Service Worker              Popup
     │                               │                       │
     │  PLATFORM_DETECTED ──────────►│                       │
     │  { type, platform }           │ sessions.set(tabId)   │
     │                               │                       │
     │                               │◄── GET_PLATFORM_STATE─┤
     │                               │                       │
     │                               │─── PLATFORM_STATE ───►│
     │                               │  { platform | null }  │
`

All messages use discriminated union types from src/types/index.ts.
No ny-typed message objects are used anywhere in the codebase.

---

## Local-First Architecture

| Concern | Solution |
|---|---|
| Conversation data | Stays in chrome.storage.local / IndexedDB (future milestones) |
| Settings/state | chrome.storage.local |
| Platform communication | Chrome Extension messaging APIs only |
| No backend required | ✓ Core loop works with zero server infrastructure |

---

## Security Considerations

**Permissions declared (Milestone 1):**
- host_permissions: ["https://*/*"] — required for content script injection on HTTPS pages

**Not requested:**
- 	abs (only chrome.tabs.query with ctive: true — available without explicit permission in MV3 for the active tab)
- storage — will be added when persistence is implemented
- cookies, webRequest, 
ativeMessaging — not needed, not requested

**Data handling:**
- No conversation data leaves the browser in Milestone 1
- No authentication credentials are accessed or stored
- CSP of third-party sites is not bypassed

---

## Known Limitations (Milestone 1)

1. **In-memory session state only.** If the service worker is terminated between
   the content script firing and the popup opening, the popup may show
   "No supported platform detected" even on a ChatGPT tab. The content script
   will re-detect on the next page load.

2. **No conversation extraction.** The MutationObserver is a skeleton.
   No message content is captured yet.

3. **No Claude or Gemini support.** Detection adapters for these platforms
   are not yet implemented.

4. **Selector fragility risk.** ChatGPT may update its DOM at any time.
   The primary detection relies on hostname only, which is stable.
   DOM-based extraction (future milestones) will be more fragile.

5. **No persistent storage.** Detected platform state is not written to
   chrome.storage. It is only held in the service worker's in-memory map.

---

## How to Run

`powershell
# From the repository root
npm run dev
`

Then in Chrome:
1. Open chrome://extensions/
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the uild/chrome-mv3-dev directory generated by Plasmo

---

## Planned Next Milestones

| Milestone | Goal |
|---|---|
| 2 | ChatGPT conversation extraction via MutationObserver + DOM parsing |
| 3 | Normalized Conversation model stored in IndexedDB |
| 4 | Claude adapter (detection + extraction) |
| 5 | Gemini adapter (detection + extraction) |
| 6 | Context injection into target platform composer |
| 7 | Token counting / smart context trimming |
