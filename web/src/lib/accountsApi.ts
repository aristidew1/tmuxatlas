import { apiFetch } from './api'
import { RuntimeAPIError, type RuntimeAPIErrorBody } from './runtimeApi'

export interface AccountUser {
  id: string
  username: string
  role: 'admin' | 'user'
  disabled: boolean
  created_at: string
  password_changed_at?: string
}

export interface AdminSession {
  id: string
  name: string
  host: string
  host_name?: string
  host_online?: boolean
  owner?: string | null
  created?: string
  attached?: boolean
  last_activity?: string
}

const HEX_ACCOUNT_ID_RE = /^[0-9a-f]{32}$/i

export function isAccountHexId(value: string | null | undefined): boolean {
  if (!value) return false
  return HEX_ACCOUNT_ID_RE.test(value.trim())
}

export function resolveOwnerName(
  owner: string | null | undefined,
  options: {
    usersById?: ReadonlyMap<string, string> | Record<string, string>
    currentUsername?: string | null
    currentRole?: 'admin' | 'user' | null
  } = {},
): string | null {
  const raw = owner?.trim()
  if (!raw) return null

  const { usersById, currentUsername, currentRole } = options
  if (usersById) {
    const mapped =
      'get' in usersById && typeof usersById.get === 'function'
        ? usersById.get(raw)
        : (usersById as Record<string, string>)[raw]
    if (mapped) return mapped
  }

  if (isAccountHexId(raw)) {
    return null
  }

  return raw
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const text = (await res.text()).trim()
    if (!text) return fallback
    try {
      const parsed = JSON.parse(text) as { code?: string; error?: string; message?: string }
      if (parsed.code) return new RuntimeAPIError(res.status, parsed).message
      if (parsed.error) return translateAccountServerError(parsed.error, fallback)
      if (parsed.message) return translateAccountServerError(parsed.message, fallback)
    } catch {
      return translateAccountServerError(text, fallback)
    }
  } catch {
    // ignore
  }
  return fallback
}

export function translateAccountServerError(raw: string, fallback: string): string {
  const text = raw.trim()
  if (/nom d'utilisateur déjà pris/i.test(text) || /already exists/i.test(text)) {
    return 'Ce nom d’utilisateur est déjà utilisé.'
  }
  if (/nom d'utilisateur invalide/i.test(text)) {
    return 'Nom d’utilisateur invalide (1 à 32 caractères : lettres minuscules, chiffres, point, tiret ou tiret bas).'
  }
  if (/mot de passe/i.test(text) && /10.*200/i.test(text)) {
    return 'Le mot de passe doit contenir entre 10 et 200 caractères.'
  }
  if (/identifiants invalides/i.test(text)) {
    return 'L’ancien mot de passe est incorrect.'
  }
  if (/dernier administrateur/i.test(text)) {
    return 'Impossible de désactiver ou supprimer le dernier administrateur actif.'
  }
  if (/introuvable/i.test(text)) {
    return 'Ce compte est introuvable.'
  }
  if (/trop de tentatives/i.test(text)) {
    return 'Trop de tentatives. Réessayez dans quelques instants.'
  }
  return text || fallback
}

export interface AccountDirectoryEntry {
  id: string
  username: string
}

export async function fetchAccountDirectory(): Promise<AccountDirectoryEntry[]> {
  const res = await apiFetch('/api/accounts/directory')
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, 'Impossible de charger les comptes.'))
  }
  return (await res.json()) as AccountDirectoryEntry[]
}

export async function fetchAdminUsers(): Promise<AccountUser[]> {
  const res = await apiFetch('/api/admin/users')
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, 'Impossible de charger les comptes.'))
  }
  const data = (await res.json()) as { users?: AccountUser[] } | AccountUser[]
  if (Array.isArray(data)) return data
  return data?.users ?? []
}

export async function createAdminUser(username: string, password: string): Promise<AccountUser> {
  const res = await apiFetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password }),
  })
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, 'Impossible de créer le compte.'))
  }
  return (await res.json()) as AccountUser
}

export async function updateAdminUser(
  id: string,
  patch: { password?: string; disabled?: boolean },
): Promise<AccountUser> {
  const res = await apiFetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, 'Impossible de mettre à jour le compte.'))
  }
  return (await res.json()) as AccountUser
}

export async function deleteAdminUser(id: string): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, 'Impossible de supprimer le compte.'))
  }
}

export async function fetchAdminSessions(): Promise<AdminSession[]> {
  const res = await apiFetch('/api/admin/sessions')
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, 'Impossible de charger les sessions.'))
  }
  const data = (await res.json()) as AdminSession[] | null
  return data ?? []
}

export async function claimSession(hostId: string, session: string, owner?: string): Promise<void> {
  const payload: Record<string, unknown> = { host_id: hostId, session }
  if (owner !== undefined) {
    payload.owner = owner
  }
  const res = await apiFetch('/api/session/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let errorBody: RuntimeAPIErrorBody = {}
    try {
      errorBody = (await res.json()) as RuntimeAPIErrorBody
    } catch {
      // ignore non-json
    }
    if (res.status === 409 && !errorBody.code) {
      errorBody.code = 'already-owned'
    }
    throw new RuntimeAPIError(res.status, errorBody)
  }
}

export async function releaseSession(hostId: string, session: string): Promise<void> {
  const res = await apiFetch('/api/session/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host_id: hostId, session }),
  })
  if (!res.ok) {
    let errorBody: RuntimeAPIErrorBody = {}
    try {
      errorBody = (await res.json()) as RuntimeAPIErrorBody
    } catch {
      // ignore non-json
    }
    throw new RuntimeAPIError(res.status, errorBody)
  }
}

export async function changeOwnPassword(oldPassword: string, newPassword: string): Promise<void> {
  const res = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  })
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('L’ancien mot de passe est incorrect.')
    }
    if (res.status === 429) {
      throw new Error('Trop de tentatives. Réessayez dans quelques instants.')
    }
    throw new Error(await parseErrorMessage(res, 'Impossible de modifier le mot de passe.'))
  }
}
