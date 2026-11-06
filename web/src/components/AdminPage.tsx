import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { KeyRound, Plus, ShieldAlert, Trash2, User, UserCheck, UserX } from 'lucide-react'
import type { Session } from '../hooks/useSessions'
import {
  claimSession,
  createAdminUser,
  deleteAdminUser,
  fetchAdminSessions,
  fetchAdminUsers,
  releaseSession,
  resolveOwnerName,
  updateAdminUser,
  type AccountUser,
  type AdminSession,
} from '../lib/accountsApi'
import { useHostLabel } from '../lib/hostLabel'
import { Button, Dialog } from './ui'

interface AdminPageProps {
  currentUsername?: string | null
  liveSessions?: Session[]
  onUsersChanged?: (users: AccountUser[]) => void
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function AdminPage({ currentUsername, liveSessions = [], onUsersChanged }: AdminPageProps) {
  const hostLabel = useHostLabel()
  const [users, setUsers] = useState<AccountUser[]>([])
  const [adminSessions, setAdminSessions] = useState<AdminSession[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  // Create account form state
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [createSuccess, setCreateSuccess] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Reset password dialog state
  const [resetTarget, setResetTarget] = useState<AccountUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  // Delete user dialog state
  const [deleteTarget, setDeleteTarget] = useState<AccountUser | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Session assignment state
  const [selectedOwnerBySession, setSelectedOwnerBySession] = useState<Record<string, string>>({})
  const [sessionActionError, setSessionActionError] = useState<string | null>(null)
  const [pendingSessionKey, setPendingSessionKey] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [loadedUsers, loadedSessions] = await Promise.all([
        fetchAdminUsers(),
        fetchAdminSessions(),
      ])
      setUsers(loadedUsers)
      setAdminSessions(loadedSessions)
      onUsersChanged?.(loadedUsers)
      setPageError(null)
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Impossible de charger les données d’administration.')
    } finally {
      setLoading(false)
    }
  }, [onUsersChanged])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const usersById = useMemo(() => {
    const map = new Map<string, string>()
    for (const user of users) {
      map.set(user.id, user.username)
    }
    return map
  }, [users])

  const mergedSessions = useMemo<AdminSession[]>(() => {
    const byKey = new Map<string, AdminSession>()
    for (const session of adminSessions) {
      byKey.set(`${session.host}/${session.name}`, session)
    }
    for (const live of liveSessions) {
      const key = `${live.host}/${live.name}`
      const existing = byKey.get(key)
      byKey.set(key, {
        id: live.id || existing?.id || '',
        name: live.name,
        host: live.host,
        host_name: live.host_name || existing?.host_name,
        host_online: live.host_online ?? existing?.host_online,
        owner: live.owner !== undefined ? live.owner : existing?.owner ?? null,
        created: live.created || existing?.created,
        attached: live.attached ?? existing?.attached,
        last_activity: live.last_activity || existing?.last_activity,
      })
    }
    return [...byKey.values()].sort(
      (left, right) => left.name.localeCompare(right.name) || left.host.localeCompare(right.host),
    )
  }, [adminSessions, liveSessions])

  const activeUsers = useMemo(() => users.filter(user => !user.disabled), [users])

  const sessionsForUser = useCallback(
    (userId: string): AdminSession[] =>
      mergedSessions.filter(session => session.owner === userId),
    [mergedSessions],
  )

  const handleCreateUser = async (event: FormEvent) => {
    event.preventDefault()
    setCreateError(null)
    setCreateSuccess(null)
    const trimmed = newUsername.trim()
    if (!trimmed) {
      setCreateError('Veuillez saisir un nom d’utilisateur.')
      return
    }
    if (newPassword.length < 10 || newPassword.length > 200) {
      setCreateError('Le mot de passe doit contenir entre 10 et 200 caractères.')
      return
    }
    if (newPassword !== confirmPassword) {
      setCreateError('Les mots de passe ne correspondent pas.')
      return
    }
    setCreating(true)
    try {
      await createAdminUser(trimmed, newPassword)
      setNewUsername('')
      setNewPassword('')
      setConfirmPassword('')
      setCreateSuccess(`Compte « ${trimmed} » créé.`)
      await loadData()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Impossible de créer le compte.')
    } finally {
      setCreating(false)
    }
  }

  const handleToggleDisabled = async (user: AccountUser) => {
    setPageError(null)
    try {
      await updateAdminUser(user.id, { disabled: !user.disabled })
      await loadData()
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Impossible de modifier l’état du compte.')
    }
  }

  const handleResetPassword = async (event: FormEvent) => {
    event.preventDefault()
    if (!resetTarget) return
    setResetError(null)
    if (resetPassword.length < 10 || resetPassword.length > 200) {
      setResetError('Le mot de passe doit contenir entre 10 et 200 caractères.')
      return
    }
    if (resetPassword !== resetConfirm) {
      setResetError('Les mots de passe ne correspondent pas.')
      return
    }
    setResetting(true)
    try {
      await updateAdminUser(resetTarget.id, { password: resetPassword })
      setResetTarget(null)
      setResetPassword('')
      setResetConfirm('')
      await loadData()
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Impossible de réinitialiser le mot de passe.')
    } finally {
      setResetting(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteError(null)
    setDeleting(true)
    try {
      await deleteAdminUser(deleteTarget.id)
      setDeleteTarget(null)
      await loadData()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Impossible de supprimer le compte.')
    } finally {
      setDeleting(false)
    }
  }

  const handleAssignSession = async (session: AdminSession, ownerId: string) => {
    if (!ownerId) return
    const key = `${session.host}/${session.name}`
    setSessionActionError(null)
    setPendingSessionKey(key)
    try {
      await claimSession(session.host, session.name, ownerId)
      await loadData()
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Impossible d’assigner la session.')
    } finally {
      setPendingSessionKey(null)
    }
  }

  const handleReleaseSession = async (session: AdminSession) => {
    const key = `${session.host}/${session.name}`
    setSessionActionError(null)
    setPendingSessionKey(key)
    try {
      await releaseSession(session.host, session.name)
      await loadData()
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Impossible de libérer la session.')
    } finally {
      setPendingSessionKey(null)
    }
  }

  const deleteTargetSessions = deleteTarget ? sessionsForUser(deleteTarget.id) : []

  return (
    <main className="flex-1 overflow-y-auto p-4 text-sm sm:p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl tracking-tight text-foreground">Administration des comptes</h1>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert size={14} aria-hidden="true" className="shrink-0" />
            <span>Tous les comptes partagent le même utilisateur système du serveur. Un terminal donne ses droits.</span>
          </p>
        </header>

        {pageError && (
          <p
            role="alert"
            className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {pageError}
          </p>
        )}

        {/* Section Créer un compte */}
        <section aria-labelledby="admin-create-heading" className="atlas-surface rounded-xl p-4 sm:p-5">
          <h2 id="admin-create-heading" className="text-sm font-medium text-foreground">
            Créer un compte
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Longueur du mot de passe : 10 à 200 caractères.
          </p>
          <form onSubmit={handleCreateUser} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor="admin-new-username" className="block text-xs text-muted-foreground">
                Nom d’utilisateur
              </label>
              <input
                id="admin-new-username"
                type="text"
                value={newUsername}
                onChange={event => setNewUsername(event.target.value)}
                placeholder="ex. alice"
                autoComplete="off"
                spellCheck={false}
                className="ui-focus-ring min-h-11 w-full rounded bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="admin-new-password" className="block text-xs text-muted-foreground">
                Mot de passe
              </label>
              <input
                id="admin-new-password"
                type="password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                placeholder="10 à 200 caractères"
                autoComplete="new-password"
                className="ui-focus-ring min-h-11 w-full rounded bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="admin-confirm-password" className="block text-xs text-muted-foreground">
                Confirmer le mot de passe
              </label>
              <input
                id="admin-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                placeholder="Confirmer le mot de passe"
                autoComplete="new-password"
                className="ui-focus-ring min-h-11 w-full rounded bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-3">
              <div>
                {createError && (
                  <p role="alert" className="text-xs text-destructive">
                    {createError}
                  </p>
                )}
                {createSuccess && (
                  <p role="status" className="text-xs text-success">
                    {createSuccess}
                  </p>
                )}
              </div>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={creating}
                loadingLabel="Création…"
                leadingIcon={<Plus size={14} aria-hidden="true" />}
              >
                Créer le compte
              </Button>
            </div>
          </form>
        </section>

        {/* Section Liste des comptes */}
        <section aria-labelledby="admin-users-heading" className="atlas-surface rounded-xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 id="admin-users-heading" className="text-sm font-medium text-foreground">
              Comptes ({users.length})
            </h2>
          </div>
          {loading ? (
            <p className="mt-4 text-xs text-muted-foreground">Chargement des comptes…</p>
          ) : users.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">Aucun compte enregistré.</p>
          ) : (
            <div className="mt-4 divide-y divide-border">
              {users.map(user => {
                const isSelf = currentUsername === user.username
                return (
                  <div
                    key={user.id}
                    data-testid={`admin-user-row-${user.username}`}
                    className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{user.username}</span>
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-2xs text-muted-foreground">
                          {user.role === 'admin' ? 'Administrateur' : 'Utilisateur'}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-2xs ${
                            user.disabled
                              ? 'bg-destructive/15 text-destructive'
                              : 'bg-success/15 text-success'
                          }`}
                        >
                          {user.disabled ? 'Désactivé' : 'Actif'}
                        </span>
                      </div>
                      <p className="text-2xs text-muted-foreground">
                        Créé le {formatDate(user.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        leadingIcon={<KeyRound size={14} aria-hidden="true" />}
                        onClick={() => {
                          setResetTarget(user)
                          setResetPassword('')
                          setResetConfirm('')
                          setResetError(null)
                        }}
                      >
                        Réinitialiser le mot de passe
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isSelf && !user.disabled}
                        leadingIcon={
                          user.disabled ? (
                            <UserCheck size={14} aria-hidden="true" />
                          ) : (
                            <UserX size={14} aria-hidden="true" />
                          )
                        }
                        onClick={() => void handleToggleDisabled(user)}
                      >
                        {user.disabled ? 'Réactiver' : 'Désactiver'}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={isSelf}
                        leadingIcon={<Trash2 size={14} aria-hidden="true" />}
                        onClick={() => {
                          setDeleteTarget(user)
                          setDeleteError(null)
                        }}
                      >
                        Supprimer
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Section Sessions */}
        <section aria-labelledby="admin-sessions-heading" className="atlas-surface rounded-xl p-4 sm:p-5">
          <h2 id="admin-sessions-heading" className="text-sm font-medium text-foreground">
            Sessions ({mergedSessions.length})
          </h2>
          {sessionActionError && (
            <p
              role="alert"
              className="mt-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {sessionActionError}
            </p>
          )}
          {mergedSessions.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">Aucune session active.</p>
          ) : (
            <div className="mt-4 divide-y divide-border">
              {mergedSessions.map(session => {
                const key = `${session.host}/${session.name}`
                const ownerName = resolveOwnerName(session.owner, {
                  usersById,
                  currentUsername,
                  currentRole: 'admin',
                })
                const selectedOwner =
                  selectedOwnerBySession[key] ??
                  (session.owner && usersById.has(session.owner) ? session.owner : '')
                return (
                  <div
                    key={key}
                    data-testid={`admin-session-row-${session.name}`}
                    className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium text-foreground">{session.name}</span>
                        {ownerName ? (
                          <span
                            data-testid="admin-session-owner-badge"
                            className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-2xs text-muted-foreground"
                          >
                            <User size={12} aria-hidden="true" />
                            <span>{ownerName}</span>
                          </span>
                        ) : (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                            Libre
                          </span>
                        )}
                      </div>
                      <p className="text-2xs text-muted-foreground">
                        {hostLabel(session.host, session.host_name || 'Hôte')}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`assign-select-${key}`} className="sr-only">
                        Assigner {session.name} à un compte
                      </label>
                      <select
                        id={`assign-select-${key}`}
                        aria-label={`Assigner ${session.name} à un compte`}
                        value={selectedOwner}
                        onChange={event =>
                          setSelectedOwnerBySession(current => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        className="ui-focus-ring min-h-11 rounded border border-border bg-input px-2.5 text-xs text-foreground"
                      >
                        <option value="">Choisir un compte…</option>
                        {activeUsers.map(user => (
                          <option key={user.id} value={user.id}>
                            {user.username}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!selectedOwner}
                        loading={pendingSessionKey === key}
                        onClick={() => void handleAssignSession(session, selectedOwner)}
                      >
                        Assigner
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!session.owner}
                        loading={pendingSessionKey === key}
                        onClick={() => void handleReleaseSession(session)}
                      >
                        Libérer
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* Dialog: Réinitialiser le mot de passe */}
      {resetTarget && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setResetTarget(null)
          }}
          title={`Réinitialiser le mot de passe de ${resetTarget.username}`}
          description="Longueur requise : 10 à 200 caractères. Les sessions actives de ce compte seront déconnectées."
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setResetTarget(null)}>
                Annuler
              </Button>
              <Button
                type="submit"
                 form="reset-password-form"
                variant="primary"
                loading={resetting}
                loadingLabel="Enregistrement…"
              >
                Enregistrer
              </Button>
            </>
          }
        >
          <form id="reset-password-form" onSubmit={handleResetPassword} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="reset-new-password" className="block text-xs text-muted-foreground">
                Nouveau mot de passe
              </label>
              <input
                id="reset-new-password"
                type="password"
                value={resetPassword}
                onChange={event => setResetPassword(event.target.value)}
                placeholder="10 à 200 caractères"
                autoComplete="new-password"
                required
                className="ui-focus-ring min-h-11 w-full rounded bg-input px-3 text-sm text-foreground"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="reset-confirm-password" className="block text-xs text-muted-foreground">
                Confirmer le nouveau mot de passe
              </label>
              <input
                id="reset-confirm-password"
                type="password"
                value={resetConfirm}
                onChange={event => setResetConfirm(event.target.value)}
                placeholder="Confirmer le nouveau mot de passe"
                autoComplete="new-password"
                required
                className="ui-focus-ring min-h-11 w-full rounded bg-input px-3 text-sm text-foreground"
              />
            </div>
            {resetError && (
              <p role="alert" className="text-xs text-destructive">
                {resetError}
              </p>
            )}
          </form>
        </Dialog>
      )}

      {/* Dialog: Supprimer le compte */}
      {deleteTarget && (
        <Dialog
          open
          role="alertdialog"
          onOpenChange={open => {
            if (!open) setDeleteTarget(null)
          }}
          title={`Supprimer le compte ${deleteTarget.username} ?`}
          description="Cette action est irréversible. Les sessions appartenant à ce compte seront libérées."
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>
                Annuler
              </Button>
              <Button
                type="button"
                variant="destructive"
                loading={deleting}
                loadingLabel="Suppression…"
                onClick={() => void handleConfirmDelete()}
              >
                Confirmer la suppression
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-sm">
            {deleteTargetSessions.length > 0 ? (
              <div>
                <p className="text-xs text-muted-foreground">
                  Sessions qui seront libérées ({deleteTargetSessions.length}) :
                </p>
                <ul className="mt-1.5 list-inside list-disc font-mono text-xs text-foreground">
                  {deleteTargetSessions.map(session => (
                    <li key={`${session.host}/${session.name}`}>{session.name}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Aucune session active n’est associée à ce compte.
              </p>
            )}
            {deleteError && (
              <p role="alert" className="text-xs text-destructive">
                {deleteError}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </main>
  )
}
