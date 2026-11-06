import { useCallback, useEffect, useState } from 'react'
import { fetchSessionPreview, SessionApiError, type SessionPreview } from '../lib/sessionApi'

const unsupportedHosts = new Set<string>()

type Target = { hostId: string; session: string; pane?: string }

export function useSessionPreview(
  target: Target,
  { enabled, lines = 4, intervalMs = 4000 }: { enabled: boolean; lines?: number; intervalMs?: number },
) {
  const [preview, setPreview] = useState<SessionPreview | null>(null)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => {
    setPreview(null)
    setRevision(n => n + 1)
  }, [])
  const { hostId, session, pane } = target
  useEffect(() => {
    setPreview(null)
    if (!enabled || !hostId || unsupportedHosts.has(hostId)) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let failures = 0
    let inFlight = false
    const poll = async () => {
      if (stopped || document.hidden || unsupportedHosts.has(hostId) || inFlight) return
      inFlight = true
      controller = new AbortController()
      try {
        const result = await fetchSessionPreview({ hostId, session, pane, lines }, controller.signal)
        if (!stopped) {
          setPreview(result)
          failures = 0
        }
      } catch (error) {
        if (!controller.signal.aborted && !stopped) {
          if (error instanceof SessionApiError && error.status === 501) {
            unsupportedHosts.add(hostId)
            setPreview(null)
          } else failures++
        }
      } finally {
        inFlight = false
      }
      if (!stopped && !document.hidden && !unsupportedHosts.has(hostId))
        timer = setTimeout(poll, controller.signal.aborted ? 0 : Math.min(intervalMs * 2 ** failures, 60000))
    }
    const visibility = () => {
      if (document.hidden) {
        clearTimeout(timer)
        controller?.abort()
      } else {
        clearTimeout(timer)
        void poll()
      }
    }
    document.addEventListener('visibilitychange', visibility)
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [hostId, session, pane, enabled, lines, intervalMs, revision])
  return { preview, refresh }
}
