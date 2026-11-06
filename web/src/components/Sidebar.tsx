import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../lib/utils'
import { postRuntimeMutation } from '../lib/runtimeApi'
import { parseSessionKey, type Session } from '../hooks/useSessions'
import type { WorkspaceSession, WorkspaceStatus, WorkspaceViewModel } from '../workspace/model'
import { filterWorkspaceSessions, isAttentionStatus, workspaceStatusLabel } from '../workspace/model'
import { Button, Dialog, StatusIcon } from './ui'
import { Search, Pin, ChevronDown, ChevronRight, Pencil, Unplug, Trash2 } from 'lucide-react'
import { resolveOwnerName } from '../lib/accountsApi'
import { OwnerPicker } from './OwnerPicker'
import { useHostLabel } from '../lib/hostLabel'
import { focusableElements, makeOutsideInert } from './ui/overlayAccessibility'

interface SidebarProps {
  workspace: WorkspaceViewModel
  selectedSession: string | null
  collapsed: boolean
  collapseMode: 'small' | 'hidden'
  pinnedTargets: string[]
  recentTargets: string[]
  onTogglePin: (target: string) => void
  onSessionSelect: (session: Session) => void
  onDetachSession: (target: string) => void
  canKillSession?: boolean
  onKillSession?: (target: string) => void | Promise<void>
  onSessionRenamed?: (oldKey: string, newKey: string) => void
  onRuntimeError?: (message: string) => void
  mobileOpen?: boolean
  onMobileClose?: () => void
}

const filters = [
  { id: 'all', label: 'Toutes' },
  { id: 'attention', label: 'À traiter' },
  { id: 'running', label: 'En cours' },
  { id: 'idle', label: 'Inactives' },
  { id: 'done', label: 'Terminées' },
  { id: 'offline', label: 'Hors ligne' },
] as const
type Filter = (typeof filters)[number]['id']

function StatusFlash({ status }: { status: WorkspaceStatus }) {
  const previous = useRef(status)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (previous.current === status) return
    previous.current = status
    setFlash(true)
    const timer = window.setTimeout(() => setFlash(false), 1200)
    return () => window.clearTimeout(timer)
  }, [status])
  return (
    <span
      className={flash ? 'atlas-flash' : undefined}
      style={
        {
          '--flash':
            status === 'error' ? 'var(--destructive)' : status === 'waiting' ? 'var(--warning)' : 'var(--primary)',
        } as React.CSSProperties
      }
    >
      <StatusIcon
        status={status}
        className={
          status === 'error' ? 'text-destructive' : status === 'waiting' ? 'text-warning' : 'text-muted-foreground'
        }
      />
    </span>
  )
}

function relativeActivity(timestamp: string | null): string {
  if (!timestamp) return ''
  const elapsed = Date.now() - Date.parse(timestamp)
  if (!Number.isFinite(elapsed) || elapsed < 0) return ''
  if (elapsed < 60_000) return ''
  if (elapsed < 3_600_000) return `Il y a ${Math.floor(elapsed / 60_000)} min`
  if (elapsed < 86_400_000) return `Il y a ${Math.floor(elapsed / 3_600_000)} h`
  return `Il y a ${Math.floor(elapsed / 86_400_000)} j`
}

export function Sidebar({
  workspace,
  selectedSession,
  collapsed,
  collapseMode,
  pinnedTargets,
  onTogglePin,
  onSessionSelect,
  onDetachSession,
  canKillSession = false,
  onKillSession,
  onSessionRenamed,
  onRuntimeError,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const hostLabel = useHostLabel()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<Filter>('all')
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(() => new Set(workspace.hosts.map(host => host.id)))
  const knownHostsRef = useRef(new Set(workspace.hosts.map(host => host.id)))
  const [renaming, setRenaming] = useState<WorkspaceSession | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{ session: WorkspaceSession; x: number; y: number } | null>(null)
  const [killTarget, setKillTarget] = useState<WorkspaceSession | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const onMobileCloseRef = useRef(onMobileClose)
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window.matchMedia !== 'function' ? mobileOpen : window.matchMedia('(max-width: 1023px)').matches,
  )
  const mobileDrawerActive = mobileOpen && isMobileViewport

  useEffect(() => {
    onMobileCloseRef.current = onMobileClose
  }, [onMobileClose])

  const filtered = useMemo(
    () =>
      filterWorkspaceSessions(workspace.sessions, query, statusFilter === 'attention' ? 'all' : statusFilter).filter(
        session => statusFilter !== 'attention' || isAttentionStatus(session.status),
      ),
    [query, statusFilter, workspace.sessions],
  )
  const pinnedSet = useMemo(() => new Set(pinnedTargets), [pinnedTargets])
  const filtering = query.trim().length > 0 || statusFilter !== 'all'

  useEffect(() => {
    const currentHostIds = new Set(workspace.hosts.map(host => host.id))
    const addedHostIds = [...currentHostIds].filter(id => !knownHostsRef.current.has(id))
    knownHostsRef.current = currentHostIds
    if (addedHostIds.length === 0) return
    setExpandedHosts(current => new Set([...current, ...addedHostIds]))
  }, [workspace.hosts])

  useEffect(() => {
    if (!selectedSession) return
    const selectedHostId = parseSessionKey(selectedSession).host
    setExpandedHosts(current => {
      if (current.has(selectedHostId)) return current
      return new Set([...current, selectedHostId])
    })
  }, [selectedSession])

  useEffect(() => {
    if (!renaming) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renaming])

  useEffect(() => {
    if (!contextMenu) return
    const close = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setContextMenu(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', escape, true)
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [contextMenu])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 1023px)')
    const update = () => setIsMobileViewport(media.matches)
    update()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }
    media.addListener?.(update)
    return () => media.removeListener?.(update)
  }, [])

  useEffect(() => {
    if (mobileOpen && !isMobileViewport) onMobileCloseRef.current?.()
  }, [isMobileViewport, mobileOpen])

  useEffect(() => {
    const drawer = asideRef.current
    if (!drawer) return
    drawer.inert = isMobileViewport && !mobileDrawerActive
    return () => {
      drawer.inert = false
    }
  }, [isMobileViewport, mobileDrawerActive])

  useEffect(() => {
    if (!mobileDrawerActive || !onMobileCloseRef.current || !asideRef.current) return
    const drawer = asideRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const restoreBackground = makeOutsideInert(drawer, element => element.hasAttribute('data-sidebar-backdrop'))
    const focusable = () => focusableElements(drawer)
    const frame = window.requestAnimationFrame(() => drawer.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onMobileCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const targets = focusable()
      if (targets.length === 0) {
        event.preventDefault()
        drawer.focus()
        return
      }
      const first = targets[0]
      const last = targets[targets.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || drawer.contains(event.target as Node)) return
      event.preventDefault()
      onMobileCloseRef.current?.()
    }
    drawer.addEventListener('keydown', onKeyDown)
    document.addEventListener('keydown', onDocumentKeyDown)

    return () => {
      window.cancelAnimationFrame(frame)
      drawer.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keydown', onDocumentKeyDown)
      restoreBackground()
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus()
      })
    }
  }, [mobileDrawerActive])

  const openMenu = (session: WorkspaceSession, x: number, y: number) => setContextMenu({ session, x, y })

  const startRename = (session: WorkspaceSession) => {
    setRenaming(session)
    setRenameValue(session.name)
    setContextMenu(null)
  }

  const submitRename = async () => {
    const current = renaming
    const nextName = renameValue.trim()
    if (!current || !nextName || nextName === current.name) {
      setRenaming(null)
      return
    }
    try {
      await postRuntimeMutation('/api/session/rename', {
        host_id: current.hostId,
        session: current.name,
        new_name: nextName,
      })
      onSessionRenamed?.(current.key, `${current.hostId}/${nextName}`)
    } catch (error) {
      onRuntimeError?.(error instanceof Error ? error.message : 'L’action sur la session a échoué.')
    } finally {
      setRenaming(null)
    }
  }

  const runDetach = (target: string) => {
    setContextMenu(null)
    onDetachSession(target)
  }

  const renderSession = (session: WorkspaceSession, showHost = false) => {
    const selected = selectedSession === session.key
    const isRenaming = renaming?.key === session.key
    const ownerName =
      session.ownerName !== undefined ? session.ownerName : resolveOwnerName(session.owner ?? session.source.owner)
    return (
      <li key={session.key}>
        <div
          className={cn(
            'group relative flex w-full rounded-lg border-l-2 transition-colors',
            'min-h-11',
            selected
              ? 'border-primary bg-sidebar-accent text-sidebar-primary'
              : session.status === 'error'
                ? 'border-destructive bg-destructive/10'
                : session.status === 'waiting'
                  ? 'border-warning bg-warning/10'
                  : 'border-transparent hover:bg-sidebar-accent',
          )}
        >
          <button
            type="button"
            aria-label={`Ouvrir la session ${session.name} sur ${hostLabel(session.hostId, session.hostName === session.hostId ? 'Hôte' : session.hostName)}, ${workspaceStatusLabel(session.status)}`}
            aria-haspopup="menu"
            onClick={() => !isRenaming && onSessionSelect(session.source)}
            onContextMenu={event => {
              event.preventDefault()
              openMenu(session, event.clientX, event.clientY)
            }}
            onKeyDown={event => {
              if (event.key === 'F10' && event.shiftKey) {
                event.preventDefault()
                const rect = event.currentTarget.getBoundingClientRect()
                openMenu(session, rect.left + 24, rect.top + 24)
              }
            }}
            className={cn(
              'min-w-0 flex-1 text-left text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              collapsed && !mobileDrawerActive ? 'px-3 py-2' : 'px-2.5 py-1',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <StatusFlash status={session.status} />
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  aria-label={`Renommer ${session.name}`}
                  value={renameValue}
                  onChange={event => setRenameValue(event.target.value)}
                  onKeyDown={event => {
                    event.stopPropagation()
                    if (event.key === 'Enter') void submitRename()
                    if (event.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={() => void submitRename()}
                  onClick={event => event.stopPropagation()}
                  className="min-w-0 flex-1 rounded border border-primary bg-input px-1 py-0.5 font-mono text-sm text-foreground outline-none"
                />
              ) : (
                <>
                  <span className={cn('min-w-0 flex-1 font-medium', 'truncate text-sm leading-4')} title={session.name}>
                    {collapsed && !mobileDrawerActive ? session.name.charAt(0).toUpperCase() : session.name}
                  </span>
                </>
              )}
            </div>
            {(!collapsed || mobileDrawerActive) && (
              <div className="flex h-3.5 min-w-0 items-center gap-1.5 text-2xs leading-3 text-muted-foreground">
                {showHost && (
                  <span className="truncate">
                    {hostLabel(session.hostId, session.hostName === session.hostId ? 'Hôte' : session.hostName)}
                  </span>
                )}
                <span className="shrink-0">{relativeActivity(session.lastActivity)}</span>
                {session.agents.length > 0 && <span className="min-w-0 truncate">{session.agents.join(', ')}</span>}
              </div>
            )}
          </button>
          {(!collapsed || mobileDrawerActive) && (
            <OwnerPicker
              hostId={session.hostId}
              session={session.name}
              ownerName={ownerName}
              testId="sidebar-owner-badge"
              className="absolute bottom-1 right-8 !py-0"
            />
          )}
          {(!collapsed || mobileDrawerActive) && (
            <button
              type="button"
              aria-label={
                pinnedSet.has(session.key)
                  ? `Désépingler la session ${session.name} sur ${hostLabel(session.hostId, session.hostName === session.hostId ? 'Hôte' : session.hostName)}`
                  : `Épingler la session ${session.name} sur ${hostLabel(session.hostId, session.hostName === session.hostId ? 'Hôte' : session.hostName)}`
              }
              aria-pressed={pinnedSet.has(session.key)}
              onClick={() => onTogglePin(session.key)}
              className={cn(
                'mr-0.5 grid min-h-11 w-9 shrink-0 place-items-center self-center rounded text-muted-foreground opacity-0 [@media(hover:none)]:opacity-100 hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 ui-focus-ring',
                pinnedSet.has(session.key) && 'opacity-100',
              )}
            >
              <Pin size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </li>
    )
  }

  const filteredKeys = new Set(filtered.map(session => session.key))
  const hostGroups = workspace.hosts.flatMap(host => {
    const hostSessions = host.sessions.filter(session => filteredKeys.has(session.key))
    if (!hostSessions.length) return []
    return [{ host, sessions: hostSessions }]
  })

  const toggleHost = (hostId: string) => {
    setExpandedHosts(current => {
      const next = new Set(current)
      if (next.has(hostId)) next.delete(hostId)
      else next.add(hostId)
      return next
    })
  }

  const isHidden = collapsed && collapseMode === 'hidden'
  const compact = collapsed && !mobileDrawerActive
  return (
    <>
      {mobileDrawerActive && (
        <button
          type="button"
          data-sidebar-backdrop=""
          aria-label="Fermer le volet des sessions"
          tabIndex={-1}
          className="mobile-sidebar-backdrop z-30 bg-black/50"
          onClick={onMobileClose}
        />
      )}
      <aside
        ref={asideRef}
        role={mobileDrawerActive ? 'dialog' : undefined}
        aria-modal={mobileDrawerActive || undefined}
        aria-hidden={isMobileViewport && !mobileDrawerActive ? true : undefined}
        aria-label="Sessions de l’espace de travail"
        tabIndex={-1}
        className={cn(
          'mobile-sidebar-drawer z-40 flex w-72 max-w-[85vw] flex-col bg-sidebar text-sm text-sidebar-foreground transition-transform duration-300 lg:z-auto lg:max-w-none lg:transition-all',
          mobileDrawerActive ? 'translate-x-0' : '-translate-x-full pointer-events-none',
          'lg:pointer-events-auto lg:translate-x-0',
          collapsed ? (collapseMode === 'hidden' ? 'lg:w-0 lg:overflow-hidden' : 'lg:w-16') : 'lg:w-64',
          !isHidden && 'border-r border-sidebar-border',
        )}
      >
        {(!collapsed || mobileDrawerActive) && (
          <div className="space-y-2 border-b border-sidebar-border p-3">
            <label className="sr-only" htmlFor="workspace-session-search">
              Rechercher des sessions
            </label>
            <div className="relative">
              <Search
                size={14}
                aria-hidden="true"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                id="workspace-session-search"
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Filtrer les sessions…"
                className="h-8 w-full rounded-md bg-input pl-8 pr-2 text-sm text-foreground ui-focus-ring"
              />
            </div>
            <div
              className="-mx-1 flex flex-nowrap gap-0.5 overflow-x-auto scrollbar-none [mask-image:linear-gradient(to_right,black_92%,transparent)]"
              aria-label="Filtrer les sessions"
            >
              {filters.map(filter => {
                const count = workspace.sessions.filter(
                  session =>
                    filter.id === 'all' ||
                    (filter.id === 'attention' ? isAttentionStatus(session.status) : session.status === filter.id),
                ).length
                if (filter.id !== 'all' && count === 0 && statusFilter !== filter.id) return null
                return (
                  <button
                    key={filter.id}
                    type="button"
                    aria-pressed={statusFilter === filter.id}
                    onClick={() => setStatusFilter(filter.id)}
                    className={cn(
                      'min-h-11 shrink-0 whitespace-nowrap rounded-full px-1.5 py-1 text-2xs ui-focus-ring md:min-h-0',
                      statusFilter === filter.id
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {filter.label} <span className="tabular-nums">{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <nav aria-label="Navigation des hôtes et sessions" className="flex-1 overflow-y-auto overscroll-contain p-2">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {workspace.sessions.length === 0 ? 'Aucune session' : 'Aucune session ne correspond à ce filtre'}
            </div>
          ) : compact ? (
            <ul className="space-y-1">{filtered.map(session => renderSession(session))}</ul>
          ) : (
            <ul className="space-y-1">
              {hostGroups.map(({ host, sessions }) => (
                <li key={host.id}>
                  <button
                    type="button"
                    aria-label={`${filtering || expandedHosts.has(host.id) ? 'Replier' : 'Déployer'} les sessions de ${hostLabel(host.id, host.name === host.id ? 'Hôte' : host.name)}`}
                    aria-expanded={filtering || expandedHosts.has(host.id)}
                    title={host.id}
                    onClick={() => toggleHost(host.id)}
                    className="mt-1 flex min-h-11 w-full items-center gap-2 rounded px-3 text-left text-xs font-semibold text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {filtering || expandedHosts.has(host.id) ? (
                      <ChevronDown size={14} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={14} aria-hidden="true" />
                    )}
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        host.online ? 'bg-foreground' : 'bg-muted-foreground',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {hostLabel(host.id, host.name === host.id ? 'Hôte' : host.name)}
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                      {sessions.length}
                    </span>
                    {sessions.some(session => isAttentionStatus(session.status)) && (
                      <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-2xs text-warning">
                        {sessions.filter(session => isAttentionStatus(session.status)).length}
                      </span>
                    )}
                  </button>
                  {(filtering || expandedHosts.has(host.id)) && (
                    <ul className="ml-3 space-y-1 border-l border-sidebar-border pl-1">
                      {sessions.map(session => renderSession(session))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </nav>

        {contextMenu && (
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Actions pour ${contextMenu.session.name}`}
            className="fixed z-[10000] min-w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 240),
              top: Math.min(contextMenu.y, window.innerHeight - 280),
            }}
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => startRename(contextMenu.session)}
              className="flex h-10 w-full items-center rounded px-3 text-left hover:bg-secondary focus:bg-secondary focus:outline-none"
            >
              <Pencil size={14} aria-hidden="true" className="mr-2" />
              Renommer
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                onTogglePin(contextMenu.session.key)
                setContextMenu(null)
              }}
              className="flex h-10 w-full items-center rounded px-3 text-left hover:bg-secondary focus:bg-secondary focus:outline-none"
            >
              <Pin size={14} aria-hidden="true" className="mr-2" />
              {pinnedSet.has(contextMenu.session.key) ? 'Désépingler' : 'Épingler'}
            </button>
            <div role="separator" className="my-1 h-px bg-border" />
            <button
              role="menuitem"
              type="button"
              onClick={() => runDetach(contextMenu.session.key)}
              className="flex h-10 w-full items-center rounded px-3 text-left hover:bg-secondary focus:bg-secondary focus:outline-none"
            >
              <Unplug size={14} aria-hidden="true" className="mr-2" />
              Détacher le navigateur (tmux continue)
            </button>
            <div role="separator" className="my-1 h-px bg-border" />
            {canKillSession && onKillSession ? (
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setKillTarget(contextMenu.session)
                  setContextMenu(null)
                }}
                className="flex h-10 w-full items-center rounded px-3 text-left text-destructive hover:bg-destructive/10 focus:bg-destructive/10 focus:outline-none"
              >
                <Trash2 size={14} aria-hidden="true" className="mr-2" />
                Supprimer la session…
              </button>
            ) : (
              <p className="px-3 py-2 text-2xs text-muted-foreground">
                Cet hôte ne permet pas de supprimer la session en toute sécurité.
              </p>
            )}
          </div>
        )}
      </aside>

      {killTarget && (
        <Dialog
          open
          role="alertdialog"
          onOpenChange={open => {
            if (!open) setKillTarget(null)
          }}
          title="Supprimer définitivement la session tmux ?"
          description="La session tmux et tous les programmes qui y tournent seront arrêtés, pas seulement cette vue du navigateur."
          footer={
            <>
              <Button variant="secondary" onClick={() => setKillTarget(null)}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  const target = killTarget.key
                  setKillTarget(null)
                  await onKillSession?.(target)
                }}
              >
                Supprimer la session
              </Button>
            </>
          }
        >
          <dl className="rounded border border-border bg-muted/50 p-3 text-sm">
            <div>
              <dt className="inline text-muted-foreground">Hôte : </dt>
              <dd className="inline" title={killTarget.hostId}>
                {hostLabel(killTarget.hostId, killTarget.hostName === killTarget.hostId ? 'Hôte' : killTarget.hostName)}
              </dd>
            </div>
            <div className="mt-1">
              <dt className="inline text-muted-foreground">Session : </dt>
              <dd className="inline font-mono">{killTarget.name}</dd>
            </div>
          </dl>
        </Dialog>
      )}
    </>
  )
}
