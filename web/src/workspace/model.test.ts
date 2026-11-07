import { describe, expect, it } from 'vitest'
import type { Host } from '../hooks/useHosts'
import type { Session } from '../hooks/useSessions'
import type { ToolEvent } from '../hooks/useToolEvents'
import { buildWorkspaceViewModel, filterWorkspaceSessions } from './model'

function session(host: string, name = 'work', online = true, command = 'zsh'): Session {
  return {
    id: `${host}-${name}`,
    host,
    host_name: 'same-display-name',
    host_online: online,
    name,
    windows: [{ id: 'w', session_id: 's', name: 'shell', index: 0, active: true, layout: '', panes: [{ id: 'p', window_id: 'w', session_id: 's', index: 0, active: true, width: 80, height: 24, current_command: command, pid: 1 }] }],
    created: '2026-01-01T00:00:00Z',
    attached: false,
    last_activity: '2026-01-02T00:00:00Z',
  }
}

const hosts: Host[] = [
  { id: 'host-a', name: 'same-display-name', online: true, sessions: [], last_seen: '' },
  { id: 'host-b', name: 'same-display-name', online: true, sessions: [], last_seen: '' },
]

describe('Workspace view model', () => {
  it('keeps sessions ordered by creation time when activity and status change', () => {
    const older = { ...session('host-a', 'older'), created: '2026-01-01T00:00:00Z' }
    const newer = { ...session('host-a', 'newer'), created: '2026-01-02T00:00:00Z' }
    const first = buildWorkspaceViewModel([newer, older], [], new Map(), hosts)
    const updated = buildWorkspaceViewModel([
      { ...newer, attached: true, last_activity: '2026-01-05T00:00:00Z' },
      { ...older, last_activity: '2026-01-04T00:00:00Z' },
    ], [{ host: 'host-a', session: 'newer', tool: 'codex', status: 'error', window: 0, timestamp: '2026-01-06T00:00:00Z' }], new Map(), hosts)
    expect(first.sessions.map(value => value.name)).toEqual(['newer', 'older'])
    expect(updated.hosts[0].sessions.map(value => value.name)).toEqual(['newer', 'older'])
  })

  it('keeps same-name Hosts and Sessions as separate canonical targets', () => {
    const model = buildWorkspaceViewModel([session('host-a'), session('host-b')], [], new Map(), hosts)
    expect(model.hosts).toHaveLength(2)
    expect(model.sessions.map(value => value.key).sort()).toEqual(['host-a/work', 'host-b/work'])
    expect(model.byTarget.get('host-a/work')?.hostId).toBe('host-a')
    expect(model.byTarget.get('host-b/work')?.hostId).toBe('host-b')
  })

  it('derives status, activity and Host attention precedence', () => {
    const events: ToolEvent[] = [
      { host: 'host-a', session: 'work', tool: 'codex', status: 'waiting', window: 0, timestamp: '2026-01-03T00:00:00Z' },
      { host: 'host-a', session: 'broken', tool: 'claude', status: 'error', window: 0, timestamp: '2026-01-04T00:00:00Z' },
    ]
    const model = buildWorkspaceViewModel([session('host-a'), session('host-a', 'broken')], events, new Map(), hosts.slice(0, 1))
    expect(model.byTarget.get('host-a/work')).toMatchObject({ status: 'waiting', agents: ['codex'], lastActivity: '2026-01-03T00:00:00Z' })
    expect(model.byTarget.get('host-a/broken')?.status).toBe('error')
    expect(model.hosts[0]).toMatchObject({ status: 'error', attentionCount: 2, sessionCount: 2 })
  })

  it('follows the agent rather than the process running in its pane', () => {
    const status = (eventStatus?: ToolEvent['status']) =>
      buildWorkspaceViewModel(
        [session('host-a', 'work', true, 'claude')],
        eventStatus ? [{ host: 'host-a', session: 'work', tool: 'claude', status: eventStatus, window: 0, timestamp: '2026-01-03T00:00:00Z' }] : [],
        new Map(),
        hosts,
      ).sessions[0].status
    expect(status('active')).toBe('running')
    expect(status('waiting')).toBe('waiting')
    expect(status('completed')).toBe('done')
    expect(status('idle')).toBe('idle')
    expect(status()).toBe('running')
  })

  it('filters by stable status and searchable Host, Session, Window or Agent terms', () => {
    const events: ToolEvent[] = [{ host: 'host-a', session: 'work', tool: 'codex', status: 'waiting', window: 0, timestamp: '2026-01-03T00:00:00Z' }]
    const model = buildWorkspaceViewModel([session('host-a'), session('host-b', 'other', false)], events, new Map(), hosts)
    expect(filterWorkspaceSessions(model.sessions, 'codex', 'all').map(value => value.key)).toEqual(['host-a/work'])
    expect(filterWorkspaceSessions(model.sessions, '', 'offline').map(value => value.key)).toEqual(['host-b/other'])
    expect(filterWorkspaceSessions(model.sessions, 'host-b', 'all').map(value => value.key)).toEqual(['host-b/other'])
  })
})
