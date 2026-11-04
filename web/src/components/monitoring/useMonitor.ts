import { useCallback, useEffect, useRef, useState } from 'react'
import { rangeSeconds, type MonitorRange, type MonitorResponse, type MonitorSample } from './types'

const POLL_MS = 5000

export type MonitorStatus = 'loading' | 'ready' | 'unavailable' | 'error'

/**
 * Polls GET /api/monitor. The series is fetched once per range, then only
 * points newer than the last one received are requested and appended.
 * Polling pauses while the tab is hidden.
 */
export function useMonitor(range: MonitorRange) {
  const [data, setData] = useState<MonitorResponse | null>(null)
  const [series, setSeries] = useState<MonitorSample[]>([])
  const [status, setStatus] = useState<MonitorStatus>('loading')
  const [lastUpdate, setLastUpdate] = useState<number>(0)
  const [failed, setFailed] = useState(false)
  const lastT = useRef(0)
  const rangeRef = useRef(range)

  const fetchOnce = useCallback(async () => {
    const currentRange = rangeRef.current
    try {
      const res = await fetch(`/api/monitor?range=${currentRange}&after=${lastT.current}`, { cache: 'no-store' })
      if (res.status === 404) {
        setStatus('unavailable')
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as MonitorResponse
      if (rangeRef.current !== currentRange) return // range changed mid-flight
      if (!body.supported) {
        setStatus('unavailable')
        return
      }
      const incoming = body.series ?? []
      const cutoff = Date.now() - rangeSeconds[currentRange] * 1000
      setSeries(prev => {
        const merged = lastT.current === 0 ? incoming : prev.concat(incoming)
        const firstKept = merged.findIndex(s => s.t >= cutoff)
        return firstKept <= 0 ? merged : merged.slice(firstKept)
      })
      if (incoming.length > 0) lastT.current = incoming[incoming.length - 1].t
      setData(body)
      setStatus('ready')
      setLastUpdate(Date.now())
      setFailed(false)
    } catch {
      setFailed(true)
      setStatus(prev => (prev === 'ready' ? 'ready' : 'error'))
    }
  }, [])

  useEffect(() => {
    rangeRef.current = range
    // The previous series stays on screen until the new range arrives.
    lastT.current = 0
    void fetchOnce()
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer === null) timer = setInterval(() => void fetchOnce(), POLL_MS)
    }
    const stop = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.hidden) stop()
      else {
        void fetchOnce()
        start()
      }
    }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [range, fetchOnce])

  return { data, series, status, lastUpdate, failed, refresh: fetchOnce }
}
