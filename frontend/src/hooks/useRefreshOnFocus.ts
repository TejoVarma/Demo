import { useEffect, useRef } from 'react'

const MIN_INTERVAL_MS = 2000

/** Calls `refresh` when the tab becomes visible or the window regains focus (at most every 2s). */
export function useRefreshOnFocus(refresh: () => void) {
  const refreshRef = useRef(refresh)
  const lastRun = useRef(0)

  useEffect(() => {
    refreshRef.current = refresh
  })

  useEffect(() => {
    const handle = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastRun.current < MIN_INTERVAL_MS) return
      lastRun.current = now
      refreshRef.current()
    }

    window.addEventListener('focus', handle)
    document.addEventListener('visibilitychange', handle)
    return () => {
      window.removeEventListener('focus', handle)
      document.removeEventListener('visibilitychange', handle)
    }
  }, [])
}
