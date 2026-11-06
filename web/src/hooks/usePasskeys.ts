import { passkeyError } from './useAuth'
import { useCallback, useEffect, useState } from 'react'
import { registerPasskey, responseError } from '../lib/webauthn'

export interface PasskeyMetadata {
  id: string
  label: string
  created_at: string
  last_used_at?: string
}

export function usePasskeys() {
  const [passkeys, setPasskeys] = useState<PasskeyMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/passkeys')
      if (!response.ok) throw new Error(await responseError(response, 'Impossible de charger les passkeys'))
      const body = await response.json()
      setPasskeys(body.passkeys || [])
      setError(null)
    } catch (cause) {
      setError(passkeyError(cause, 'Impossible de charger les passkeys'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const add = useCallback(
    async (label: string) => {
      setPending('add')
      setError(null)
      try {
        await registerPasskey('', label.trim())
        await refresh()
        return true
      } catch (cause) {
        setError(passkeyError(cause, 'Impossible d’ajouter la passkey'))
        return false
      } finally {
        setPending(null)
      }
    },
    [refresh],
  )

  const rename = useCallback(
    async (id: string, label: string) => {
      setPending(id)
      setError(null)
      try {
        const response = await fetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label }),
        })
        if (!response.ok) throw new Error(await responseError(response, 'Impossible de renommer la passkey'))
        await refresh()
        return true
      } catch (cause) {
        setError(passkeyError(cause, 'Impossible de renommer la passkey'))
        return false
      } finally {
        setPending(null)
      }
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      setPending(id)
      setError(null)
      try {
        const response = await fetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })
        if (!response.ok) throw new Error(await responseError(response, 'Impossible de supprimer la passkey'))
        await refresh()
        return true
      } catch (cause) {
        setError(passkeyError(cause, 'Impossible de supprimer la passkey'))
        await refresh()
        return false
      } finally {
        setPending(null)
      }
    },
    [refresh],
  )

  return { passkeys, loading, pending, error, refresh, add, rename, remove }
}
