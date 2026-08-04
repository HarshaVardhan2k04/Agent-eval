import { useEffect, useRef, useState } from 'react'

// A drop-in replacement for useState whose value is mirrored to sessionStorage,
// so a page's inputs/selections survive navigating away and back (and a refresh)
// for the duration of the browser session. Use ONLY for serializable state — not
// File/Blob objects (keep those in a module-level cache) and not transient flags
// like `busy`/`error`, which should reset on remount.
export function usePersisted<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const storageKey = `ae:${key}`
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      return raw != null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  // Skip the very first write (it would just echo what we loaded).
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    try { sessionStorage.setItem(storageKey, JSON.stringify(val)) } catch { /* full/disabled */ }
  }, [storageKey, val])
  return [val, setVal]
}

// Clear one or more persisted keys (e.g. after a form is submitted/consumed).
export function clearPersisted(...keys: string[]) {
  for (const k of keys) {
    try { sessionStorage.removeItem(`ae:${k}`) } catch { /* ignore */ }
  }
}
