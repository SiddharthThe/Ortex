/**
 * Ortex - Platform Adapter Interface
 *
 * Defines the contract that every platform-specific adapter must satisfy.
 * This abstraction keeps the orchestration core free of platform-specific
 * DOM logic; each adapter encapsulates what it knows about one platform.
 *
 * CURRENT STATUS: Interface only. The ChatGPT adapter currently implements
 * detection only (Milestone 1).
 */

import type { SupportedPlatform } from "../types"

/**
 * Result returned by an adapter's detect() method.
 */
export interface DetectionResult {
  detected: boolean
  platform: SupportedPlatform
  /** Human-readable reason when detection fails; useful for debugging. */
  reason?: string
}

/**
 * Base contract for all platform adapters.
 *
 * Each adapter is responsible for:
 *  - Identifying whether the current page belongs to its platform.
 *  - (Future) Extracting structured conversation data from the DOM.
 *  - (Future) Injecting context into the platform's composer.
 */
export interface PlatformAdapter {
  /** The platform this adapter handles. */
  readonly platform: SupportedPlatform

  /**
   * Inspect the current page and return whether this adapter's platform
   * is active. Must be safe to call multiple times.
   */
  detect(): DetectionResult
}
