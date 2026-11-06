import { useState, useEffect, useCallback } from 'react'
import { authenticatePasskey, registerPasskey } from '../lib/webauthn'
import { apiFetch, setCSRFToken } from '../lib/api'

export type AuthMode = 'none' | 'passkey' | 'accounts'
export type AccountRole = 'admin' | 'user'

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

export interface AuthState {
  loading: boolean
  authRequired: boolean
  authMode: AuthMode
  needsSetup: boolean
  authenticated: boolean
  username: string | null
  role: AccountRole | null
  error: string | null
  rpId: string | null
  origin: string | null
  setup: (setupToken: string, label?: string) => Promise<boolean>
  login: () => Promise<boolean>
  loginWithPassword: (username: string, password?: string) => Promise<boolean>
  logout: () => Promise<void>
  refreshAuthStatus: () => Promise<boolean>
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
  const [authMode, setAuthMode] = useState<AuthMode>('none')
  const [needsSetup, setNeedsSetup] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const [role, setRole] = useState<AccountRole | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rpId, setRPID] = useState<string | null>(null)
  const [origin, setOrigin] = useState<string | null>(null)

  const refreshAuthStatus = useCallback(async (): Promise<boolean> => {
    try {
      const statusRes = await fetch('/api/auth/status')
      if (!statusRes.ok) {
        setAuthenticated(false)
        setUsername(null)
        setRole(null)
        setCSRFToken(null)
        return false
      }
      const status = await statusRes.json()
      if (status.mode === 'accounts') {
        setAuthMode('accounts')
        setAuthRequired(true)
        setNeedsSetup(false)
        if (status.authenticated === true) {
          setCSRFToken(status.csrf_token || null)
          setUsername(status.username || null)
          setRole(status.role === 'admin' || status.role === 'user' ? status.role : 'user')
          setAuthenticated(true)
          return true
        }
        setCSRFToken(null)
        setUsername(null)
        setRole(null)
        setAuthenticated(false)
        return false
      }

      setRPID(status.rp_id || null)
      setOrigin(status.origin || null)
      if (!status.auth_required) {
        setAuthMode('none')
        setAuthRequired(false)
        setAuthenticated(true)
        return true
      }
      setAuthMode('passkey')
      setAuthRequired(true)
      if (status.needs_setup) {
        setNeedsSetup(true)
        setAuthenticated(false)
        return false
      }
      const checkRes = await fetch('/api/auth/check')
      const check = await checkRes.json()
      setCSRFToken(check.csrf_token)
      const isAuth = check.authenticated === true
      setAuthenticated(isAuth)
      return isAuth
    } catch {
      setAuthenticated(false)
      return false
    }
  }, [])

  useEffect(() => {
    installFetchInterceptor()
    refreshAuthStatus().finally(() => setLoading(false))
  }, [refreshAuthStatus])

  useEffect(() => {
    if (!authRequired) return
    const onUnauthorized = () => {
      setAuthenticated(false)
      setUsername(null)
      setRole(null)
      setCSRFToken(null)
    }
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

  const loginWithPassword = useCallback(async (rawUsername: string, password = ''): Promise<boolean> => {
    setError(null)
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: rawUsername.trim(), password }),
      })
      if (res.status === 429) {
        setError('Trop de tentatives de connexion. Réessayez dans quelques instants.')
        return false
      }
      if (!res.ok) {
        setError('Nom d’utilisateur ou mot de passe incorrect.')
        return false
      }
      const data = await res.json()
      setCSRFToken(data.csrf_token || null)
      setUsername(data.username || rawUsername.trim())
      setRole(data.role === 'admin' || data.role === 'user' ? data.role : 'user')
      setAuthenticated(true)
      return true
    } catch {
      setError('Nom d’utilisateur ou mot de passe incorrect.')
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
    setUsername(null)
    setRole(null)
    setCSRFToken(null)
    setError(null)
  }, [])

  return {
    loading,
    authRequired,
    authMode,
    needsSetup,
    authenticated,
    username,
    role,
    error,
    rpId,
    origin,
    setup,
    login,
    loginWithPassword,
    logout,
    refreshAuthStatus,
  }
}
