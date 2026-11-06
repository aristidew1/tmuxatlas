import { useCallback } from 'react'
import { usePreferences } from '../hooks/usePreferences'

/** Resolves the name shown for a host: the user's alias first, then the host's own name. */
export function useHostLabel() {
  const { prefs } = usePreferences()
  const aliases = prefs.host_aliases
  return useCallback(
    (hostId: string | undefined, fallback?: string) =>
      (hostId && aliases?.[hostId]?.trim()) || fallback || hostId || '',
    [aliases],
  )
}
