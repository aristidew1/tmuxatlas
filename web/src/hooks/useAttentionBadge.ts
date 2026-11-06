import { useEffect } from 'react'

export function useAttentionBadge(count: number) {
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '')
    document.title = count > 0 ? `(${count}) ${base}` : base
    const badge = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    const result = count > 0 ? badge.setAppBadge?.(count) : badge.clearAppBadge?.()
    result?.catch(() => {})
  }, [count])
}
