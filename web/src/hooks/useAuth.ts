import { useState, useEffect, useCallback } from 'react'
import { authenticatePasskey, registerPasskey } from '../lib/webauthn'
import { apiFetch, setCSRFToken } from '../lib/api'

/** Present browser and server passkey errors without exposing untranslated messages. */
export function passkeyError(cause: unknown, fallback: string): string {
  if (!cause || typeof cause !== 'object') return fallback
  const { name, message } = cause as { name?: string; message?: string }
  if (name === 'NotAllowedError' || /cancelled/i.test(message || ''))
    return 'La demande de passkey a été annulée ou a expiré.'
  if (/require HTTPS/i.test(message || ''))
    return 'Les passkeys nécessitent HTTPS (localhost est autorisé pour les essais locaux).'
  if (/does not support passkeys/i.test(message || '')) return 'Ce navigateur ne prend pas en charge les passkeys.'
  if (/invalid setup token or session/i.test(message || ''))
    return 'Le jeton de configuration ou la session est invalide.'
  if (/capacity reached/i.test(message || '')) return 'Trop de demandes de passkey sont en cours. Réessayez.'
  if (/verification failed/i.test(message || '')) return 'La vérification de la passkey a échoué.'
  return fallback
}

interface AuthState {
  loading: boolean
  authRequired: boolean
  needsSetup: boolean
  authenticated: boolean
  error: string | null
  rpId: string | null
  origin: string | null
  setup: (setupToken: string, label?: string) => Promise<boolean>
  login: () => Promise<boolean>
  logout: () => Promise<void>
}

let interceptorInstalled = false
function installFetchInterceptor() {
  if (interceptorInstalled) return
  interceptorInstalled = true
  window.fetch = apiFetch
}

export function useAuth(): AuthState {
  const [loading, setLoading] = useState(true)
  const [authRequired, setAuthRequired] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rpId, setRPID] = useState<string | null>(null)
  const [origin, setOrigin] = useState<string | null>(null)

  useEffect(() => {
    installFetchInterceptor()

    async function checkAuth() {
      try {
        const statusRes = await fetch('/api/auth/status')
        const status = await statusRes.json()
        setRPID(status.rp_id || null)
        setOrigin(status.origin || null)
        if (!status.auth_required) {
          setAuthenticated(true)
          setLoading(false)
          return
        }
        setAuthRequired(true)
        if (status.needs_setup) {
          setNeedsSetup(true)
          setLoading(false)
          return
        }
        const checkRes = await fetch('/api/auth/check')
        const check = await checkRes.json()
        setCSRFToken(check.csrf_token)
        setAuthenticated(check.authenticated === true)
      } catch {
        setAuthenticated(false)
      }
      setLoading(false)
    }
    checkAuth()
  }, [])

  useEffect(() => {
    if (!authRequired) return
    const onUnauthorized = () => setAuthenticated(false)
    window.addEventListener('auth:unauthorized', onUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized)
  }, [authRequired])

  const setup = useCallback(async (setupToken: string, label = ''): Promise<boolean> => {
    setError(null)
    try {
      await registerPasskey(setupToken.trim(), label.trim())
      const checkRes = await fetch('/api/auth/check')
      const check = await checkRes.json()
      setCSRFToken(check.csrf_token)
      setNeedsSetup(false)
      setAuthenticated(true)
      return true
    } catch (cause) {
      setError(passkeyError(cause, 'La configuration de la passkey a échoué'))
      return false
    }
  }, [])

  const login = useCallback(async (): Promise<boolean> => {
    setError(null)
    try {
      await authenticatePasskey()
      const checkRes = await fetch('/api/auth/check')
      const check = await checkRes.json()
      setCSRFToken(check.csrf_token)
      setAuthenticated(true)
      return true
    } catch (cause) {
      setError(passkeyError(cause, 'La connexion par passkey a échoué'))
      return false
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // The local UI should still return to the sign-in screen.
    }
    setAuthenticated(false)
    setCSRFToken(null)
  }, [])

  return {
    loading,
    authRequired,
    needsSetup,
    authenticated,
    error,
    rpId,
    origin,
    setup,
    login,
    logout,
  }
}
