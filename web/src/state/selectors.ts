import type { ActivitySnapshot } from '../hooks/useActivity'
import type { Host } from '../hooks/useHosts'
import type { FreeSession, Pane, Session, Window } from '../hooks/useSessions'
import type { ToolEvent } from '../hooks/useToolEvents'
import { getBrandStorage, setBrandStorage } from '../lib/brandStorage'
import type { ApplicationState } from './reducer'
import type { FreeSessionState, SessionState } from './types'

export function isFullSessionState(value: SessionState | FreeSessionState): value is SessionState {
  return Boolean(value && 'host_id' in value && typeof value.host_id === 'string' && value.key)
}

export function selectSessions(state: ApplicationState): Session[] {
  return Object.values(state.projection.sessions)
    .filter(isFullSessionState)
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((source) => {
      const host = state.projection.hosts[source.host_key]
      const windows: Window[] = Object.values(state.projection.windows)
        .filter((window) => window.session_key === source.key)
        .sort((left, right) => left.index - right.index || left.key.localeCompare(right.key))
        .map((window) => {
          const panes: Pane[] = Object.values(state.projection.panes)
            .filter((pane) => pane.window_key === window.key)
            .sort((left, right) => left.index - right.index || left.key.localeCompare(right.key))
            .map((pane) => ({
              id: pane.tmux_id,
              window_id: window.tmux_id,
              session_id: source.tmux_id || '',
              index: pane.index,
              active: pane.active,
              width: pane.width,
              height: pane.height,
              current_command: pane.current_command || '',
              pid: pane.pid || 0,
            }))
          return {
            id: window.tmux_id,
            session_id: source.tmux_id || '',
            name: window.name,
            index: window.index,
            active: window.active,
            layout: window.layout || '',
            panes,
          }
        })
      return {
        id: source.tmux_id || '',
        name: source.name,
        host: source.host_id,
        host_name: host?.display_name,
        host_online: host?.online,
        owner: source.owner ?? null,
        windows,
        created: source.created || '',
        attached: source.attached,
        last_activity: source.last_activity || '',
      }
    })
}

export function selectFreeSessions(state: ApplicationState): FreeSession[] {
  const result: FreeSession[] = []
  for (const source of Object.values(state.projection.sessions)) {
    if (!isFullSessionState(source) && source.host && source.name) {
      result.push({
        host: source.host,
        name: source.name,
        owner: source.owner ?? null,
      })
    }
  }
  return result.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.host.localeCompare(right.host),
  )
}

interface CachedHost {
  id: string
  name: string
  version?: string
  local?: boolean
  online: boolean
}

function readCachedHosts(): CachedHost[] {
  try {
    const raw = getBrandStorage('known-hosts')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is CachedHost =>
        Boolean(item && typeof item.id === 'string' && typeof item.name === 'string'),
    )
  } catch {
    return []
  }
}

function writeCachedHosts(hosts: Host[]): void {
  if (hosts.length === 0) return
  try {
    const minimal: CachedHost[] = hosts.map((host) => ({
      id: host.id,
      name: host.name,
      version: host.version,
      local: host.local,
      online: host.online,
    }))
    setBrandStorage('known-hosts', JSON.stringify(minimal))
  } catch {
    // ignore storage errors
  }
}

export function selectHosts(state: ApplicationState, sessions = selectSessions(state)): Host[] {
  const projected = Object.values(state.projection.hosts)
    .sort((left, right) => left.key.localeCompare(right.key))
    .map<Host>((host) => ({
      id: host.id,
      name: host.display_name,
      version: host.version,
      local: host.local,
      online: host.online,
      sessions: sessions.filter((session) => session.host === host.id),
      last_seen: host.last_seen || '',
    }))

  if (projected.length > 0) {
    writeCachedHosts(projected)
  }

  const byId = new Map<string, Host>(projected.map((host) => [host.id, host]))
  const cachedById = new Map<string, CachedHost>(readCachedHosts().map((host) => [host.id, host]))

  for (const source of Object.values(state.projection.sessions)) {
    const hostId = isFullSessionState(source) ? source.host_id : source.host
    if (hostId && !byId.has(hostId)) {
      const cached = cachedById.get(hostId)
      byId.set(hostId, {
        id: hostId,
        name: cached?.name || hostId,
        version: cached?.version,
        local: cached?.local ?? true,
        online: cached?.online ?? true,
        sessions: sessions.filter((session) => session.host === hostId),
        last_seen: '',
      })
    }
  }

  if (byId.size === 0 && state.connection === 'ready') {
    for (const cached of cachedById.values()) {
      byId.set(cached.id, {
        id: cached.id,
        name: cached.name,
        version: cached.version,
        local: cached.local ?? true,
        online: cached.online ?? true,
        sessions: [],
        last_seen: '',
      })
    }
  }

  return [...byId.values()]
}

export function selectToolEvents(state: ApplicationState): ToolEvent[] {
  return Object.values(state.projection.tool_events)
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((event) => ({
      tool: event.tool,
      status: event.status as ToolEvent['status'],
      host: event.host_id,
      session: event.session,
      window: Number(event.window || 0),
      pane: event.pane,
      message: event.message,
      timestamp: event.timestamp,
      auto_detected: event.auto_detected,
    }))
}

export function selectActivity(state: ApplicationState): Map<string, ActivitySnapshot> {
  const result = new Map<string, ActivitySnapshot>()
  for (const activity of Object.values(state.projection.activity)) {
    const value: ActivitySnapshot = {
      host: activity.host_id,
      session: activity.session,
      idle_seconds: activity.data?.idle_seconds || 0,
      sparkline: activity.data?.sparkline || [],
      total_bytes: activity.data?.total_bytes || 0,
    }
    result.set(`${activity.host_id}/${activity.session}`, value)
  }
  return result
}
