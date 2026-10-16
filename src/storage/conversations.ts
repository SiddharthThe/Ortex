/**
 * Ortex - Conversation Storage
 *
 * IndexedDB wrapper for persisting conversations locally.
 * This module is intentionally free of Chrome extension APIs so it can
 * be tested in isolation and reused in different extension contexts.
 *
 * NOTE: Service workers can be terminated between events, but IndexedDB
 * data persists independently of the service worker lifecycle.
 */

import type { Conversation } from "../types"

const DB_NAME = "ortex_conversations"
const DB_VERSION = 1
const STORE_NAME = "conversations"

// ---------------------------------------------------------------------------
// DB initialization
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })
        // Index by platform for efficient filtering in future milestones
        store.createIndex("platform", "platform", { unique: false })
        // Index by updatedAt for chronological sorting
        store.createIndex("updatedAt", "updatedAt", { unique: false })
      }
    }

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result)
    }

    request.onerror = (event) => {
      dbPromise = null // Allow retry
      reject(
        new Error(
          `IndexedDB open failed: ${(event.target as IDBOpenDBRequest).error?.message ?? "unknown"}`
        )
      )
    }
  })

  return dbPromise
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Save or update a conversation.
 * Uses put() so an existing conversation with the same id is overwritten
 * rather than duplicated.
 */
export async function saveConversation(conversation: Conversation): Promise<void> {
  const db = await getDb()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(conversation)

    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(
        new Error(
          `Failed to save conversation: ${request.error?.message ?? "unknown"}`
        )
      )
  })
}

/**
 * Retrieve all saved conversations, sorted newest-first by updatedAt.
 */
export async function getAllConversations(): Promise<Conversation[]> {
  const db = await getDb()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onsuccess = () => {
      const rows = (request.result as Conversation[]) ?? []
      // Sort newest-first
      rows.sort((a, b) => b.updatedAt - a.updatedAt)
      resolve(rows)
    }

    request.onerror = () =>
      reject(
        new Error(
          `Failed to retrieve conversations: ${request.error?.message ?? "unknown"}`
        )
      )
  })
}

/**
 * Retrieve a single conversation by id.
 * Returns null when no matching record exists.
 */
export async function getConversationById(
  id: string
): Promise<Conversation | null> {
  const db = await getDb()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(id)

    request.onsuccess = () => resolve((request.result as Conversation) ?? null)
    request.onerror = () =>
      reject(
        new Error(
          `Failed to retrieve conversation: ${request.error?.message ?? "unknown"}`
        )
      )
  })
}

/**
 * Delete a conversation by id.
 */
export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(id)

    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(
        new Error(
          `Failed to delete conversation: ${request.error?.message ?? "unknown"}`
        )
      )
  })
}
