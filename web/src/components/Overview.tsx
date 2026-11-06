import { useEffect, useState } from 'react'
import { Plus, TriangleAlert, User } from 'lucide-react'
import type { FreeSession, Session } from '../hooks/useSessions'
import { sessionKey } from '../hooks/useSessions'
import type { Host } from '../hooks/useHosts'
import type { ToolEvent } from '../hooks/useToolEvents'
import type { ActivitySnapshot } from '../hooks/useActivity'
import type { AccountRole } from '../hooks/useAuth'
import { usePreferences } from '../hooks/usePreferences'
import { claimSession, fetchAccountDirectory, releaseSession, resolveOwnerName } from '../lib/accountsApi'
import { useHostLabel } from '../lib/hostLabel'
import { useApplicationState } from '../state/provider'
import { Inbox } from './Inbox'
import { SessionCard } from './SessionCard'
import { Button } from './ui/Button'

interface OverviewProps {
  sessions: Session[]
  freeSessions?: FreeSession[]
  hosts: Host[]
  role?: AccountRole | null
  currentUsername?: string | null
  usersById?: ReadonlyMap<string, string> | Record<string, string>
  onSessionSelect: (session: Session) => void
  getSessionEvents: (session: string) => ToolEvent[]
  getSessionActivity: (session: string) => ActivitySnapshot | undefined
  pendingAlerts: ToolEvent[]
  onJumpToSession: (session: string, windowIndex?: number, pane?: string) => void
  onDismissAlert: (evt: ToolEvent) => void
  onOpenMonitoring: () => void
  onClaimSession?: (hostId: string, sessionName: string) => Promise<void>
  onReleaseSession?: (hostId: string, sessionName: string) => Promise<void>
  onCreateSession?: () => void
}

type Stats = {
  sessions: { total: number }
  agents: { active: number; waiting: number; error: number }
  system?: { cpu_percent?: number; memory?: { percent: number } }
}

const healthReasons: Record<string, string> = {
  offline: 'hôte hors ligne',
  stale: 'état de l’hôte obsolète',
  incompatible: 'protocole incompatible',
  'check-failed': 'vérification échouée',
  'update-rolled-back': 'mise à jour annulée après un échec',
}

export function Overview({
  sessions,
  freeSessions,
  hosts,
  role,
  currentUsername,
  usersById,
  onSessionSelect,
  getSessionEvents,
  getSessionActivity,
  pendingAlerts,
  onJumpToSession,
  onDismissAlert,
  onOpenMonitoring,
  onClaimSession,
  onReleaseSession,
  onCreateSession,
}: OverviewProps) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [ownershipError, setOwnershipError] = useState<string | null>(null)
  const [pendingTarget, setPendingTarget] = useState<string | null>(null)
  const { prefs } = usePreferences()
  const appState = useApplicationState()
  const hostLabel = useHostLabel()
  const isNonAdminUser = role === 'user'

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const res = await fetch('/api/stats', { signal: controller.signal })
        if (res.ok) setStats(await res.json())
      } catch {
        /* La prochaine actualisation réessaiera. */
      }
    }
    void load()
    const timer = setInterval(load, (prefs.overview_refresh_interval || 5) * 1000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [prefs.overview_refresh_interval])

  const visibleSessions = sessions

  const handleClaim = async (hostId: string, sessionName: string) => {
    const key = `${hostId}/${sessionName}`
    setOwnershipError(null)
    setPendingTarget(key)
    try {
      if (onClaimSession) {
        await onClaimSession(hostId, sessionName)
      } else {
        await claimSession(hostId, sessionName)
      }
    } catch (err) {
      setOwnershipError(err instanceof Error ? err.message : 'Impossible d’attribuer cette session.')
    } finally {
      setPendingTarget(null)
    }
  }

  const handleRelease = async (hostId: string, sessionName: string) => {
    const key = `${hostId}/${sessionName}`
    setOwnershipError(null)
    setPendingTarget(key)
    try {
      if (onReleaseSession) {
        await onReleaseSession(hostId, sessionName)
      } else {
        await releaseSession(hostId, sessionName)
      }
    } catch (err) {
      setOwnershipError(err instanceof Error ? err.message : 'Impossible de libérer cette session.')
    } finally {
      setPendingTarget(null)
    }
  }

  const reason = Object.values(appState.state.projection.health)
    .map(health => (health.facts as unknown as { summary?: string } | undefined)?.summary)
    .find(summary => summary && healthReasons[summary])
  const active = stats?.agents.active ?? 0
  const waiting = stats?.agents.waiting ?? pendingAlerts.filter(e => e.status === 'waiting').length
  const errors = stats?.agents.error ?? pendingAlerts.filter(e => e.status === 'error').length
  const total = stats?.sessions.total ?? visibleSessions.length
  const groups = new Map<string, Session[]>()
  visibleSessions.forEach(session => groups.set(session.host, [...(groups.get(session.host) || []), session]))

  return (
    <main className="flex-1 overflow-y-auto p-4 text-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <span>
            <strong className="font-medium text-foreground">{total}</strong> session{total === 1 ? '' : 's'}
          </span>
          {active > 0 && (
            <span>
              <strong className="font-medium text-foreground">{active}</strong> agent
              {active === 1 ? ' actif' : 's actifs'}
            </span>
          )}
          {waiting > 0 && (
            <span>
              <strong className="font-medium text-foreground">{waiting}</strong> en attente
            </span>
          )}
          {errors > 0 && (
            <span>
              <strong className="font-medium text-foreground">{errors}</strong> erreur{errors === 1 ? '' : 's'}
            </span>
          )}
          {
            <button
              type="button"
              onClick={onOpenMonitoring}
              className="ui-focus-ring min-h-11 underline decoration-border underline-offset-4"
            >
              CPU {stats?.system?.cpu_percent != null ? `${Math.round(stats.system.cpu_percent)} %` : '—'} · Mémoire{' '}
              {stats?.system?.memory ? `${Math.round(stats.system.memory.percent)} %` : '—'}
            </button>
          }
        </div>
        {onCreateSession && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCreateSession}
            leadingIcon={<Plus size={14} aria-hidden="true" />}
          >
            Nouvelle session
          </Button>
        )}
      </div>
      {ownershipError && (
        <p
          role="alert"
          className="mb-4 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {ownershipError}
        </p>
      )}
      <Inbox
        events={pendingAlerts}
        multipleHosts={hosts.length > 1}
        onOpen={e => onJumpToSession(e.host ? `${e.host}/${e.session}` : e.session, e.window, e.pane)}
        onDismiss={onDismissAlert}
      />
      {reason && (
        <button
          type="button"
          onClick={onOpenMonitoring}
          className="ui-focus-ring mb-5 flex min-h-11 items-center gap-2 text-xs text-warning"
        >
          <TriangleAlert size={16} aria-hidden="true" />
          Santé d’un hôte dégradée : {healthReasons[reason]} · Voir le monitoring
        </button>
      )}
      {visibleSessions.length === 0 && <p className="text-muted-foreground">Aucune session disponible.</p>}
      {[...groups].map(([id, group]) => (
        <section key={id} className="mb-6">
          <h2 className="mb-2 text-sm font-medium" title={id}>
            {hosts.length > 1
              ? hostLabel(id, group[0].host_name || hosts.find(h => h.id === id)?.name || 'Hôte')
              : 'Sessions'}{' '}
            <span className="text-xs text-muted-foreground">({group.length})</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.map(session => {
              const key = sessionKey(session)
              const ownerName = resolveOwnerName(session.owner, {
                usersById,
                currentUsername,
                currentRole: role,
              })
              return (
                <SessionCard
                  key={key}
                  session={session}
                  events={getSessionEvents(key)}
                  activity={getSessionActivity(key)}
                  sparklines={!!prefs.sparklines_visible}
                  ownerName={ownerName}
                  onSelect={() => onSessionSelect(session)}
                  onRelease={isNonAdminUser ? () => void handleRelease(session.host, session.name) : undefined}
                />
              )
            })}
          </div>
        </section>
      ))}
    </main>
  )
}
