import { useEffect, useRef } from 'react'
import { Bell, PanelLeft, Plus, Search, Settings } from 'lucide-react'
import type { ToolEvent } from '../hooks/useToolEvents'
import { usePreferences } from '../hooks/usePreferences'
import { formatShortcut } from '../commands/registry'
import { AtlasMark } from './Brand'
import { Kbd, Menu, StatusIcon } from './ui'

interface TopBarProps {
  currentView: string
  sidebarCollapsed: boolean
  onToggleCollapse: () => void
  onOverview: () => void
  onMonitoring: () => void
  onWall: () => void
  onOpenPalette: () => void
  onSettings: () => void
  onNewSession?: () => void
  events: ToolEvent[]
  onJumpToSession: (session: string, windowIndex?: number, pane?: string) => void
  onDismiss: (evt: ToolEvent) => void
  onDismissAll: () => void
}

function relativeTime(timestamp: string) {
  const date = Date.parse(timestamp)
  if (Number.isNaN(date)) return ''
  const seconds = Math.round((date - Date.now()) / 1000)
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(seconds) < 60) return format.format(seconds, 'second')
  if (Math.abs(seconds) < 3600) return format.format(Math.round(seconds / 60), 'minute')
  if (Math.abs(seconds) < 86400) return format.format(Math.round(seconds / 3600), 'hour')
  return format.format(Math.round(seconds / 86400), 'day')
}

export function TopBar({
  currentView,
  sidebarCollapsed,
  onToggleCollapse,
  onOverview,
  onMonitoring,
  onWall,
  onOpenPalette,
  onSettings,
  onNewSession,
  events,
  onJumpToSession,
  onDismiss,
  onDismissAll,
}: TopBarProps) {
  const actionable = events.filter(event => event.status === 'waiting' || event.status === 'error')
  const { prefs } = usePreferences()
  const timers = useRef<Map<string, number>>(new Map())
  useEffect(() => {
    const seconds = prefs.agent_banner.auto_dismiss_seconds
    if (seconds <= 0) return
    events.forEach((event, index) => {
      if (event.status !== 'waiting' && event.status !== 'error') return
      const key = `${event.tool}-${event.session}-${event.pane}-${index}`
      if (timers.current.has(key)) return
      timers.current.set(
        key,
        window.setTimeout(() => {
          onDismiss(event)
          timers.current.delete(key)
        }, seconds * 1000),
      )
    })
    const current = timers.current
    return () => {
      current.forEach(clearTimeout)
      current.clear()
    }
  }, [events, prefs.agent_banner.auto_dismiss_seconds, onDismiss])

  const button =
    'ui-focus-ring flex min-h-11 min-w-11 items-center justify-center gap-2 rounded px-2 ' +
    'text-muted-foreground hover:bg-secondary hover:text-foreground md:min-h-8 md:min-w-8'
  const navigation = [
    ['overview', 'Vue d’ensemble', onOverview],
    ['wall', 'Mur', onWall],
    ['monitoring', 'Monitoring', onMonitoring],
  ] as const
  const alertColor = actionable.some(event => event.status === 'error')
    ? 'text-destructive'
    : actionable.length
      ? 'text-warning'
      : 'text-muted-foreground'
  const collapseLabel = sidebarCollapsed ? 'Déplier la barre latérale' : 'Replier la barre latérale'

  return (
    <header className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border bg-card px-2 pt-[var(--safe-area-inset-top)] font-sans text-sm md:gap-3 md:px-4">
      <button
        type="button"
        onClick={onOverview}
        aria-label="Vue d’ensemble"
        className="ui-focus-ring flex min-w-0 items-center gap-2 rounded"
      >
        <AtlasMark />
        <span>Atlas</span>
      </button>
      <nav aria-label="Navigation principale" className="hidden items-center gap-1 md:flex">
        {navigation.map(([view, label, action]) => (
          <button
            key={view}
            type="button"
            onClick={action}
            aria-current={currentView === view ? 'page' : undefined}
            className={`${button} ${currentView === view ? 'bg-secondary text-foreground' : ''}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="flex-1" />
      <div className="hidden items-center md:flex">
        <button
          type="button"
          className={button}
          onClick={onNewSession}
          title="Nouvelle session"
          aria-label="Nouvelle session"
        >
          <Plus size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={button}
          onClick={onToggleCollapse}
          title={collapseLabel}
          aria-label={collapseLabel}
        >
          <PanelLeft size={16} aria-hidden />
        </button>
      </div>
      <Menu
        label={`Alertes (${actionable.length})`}
        trigger={
          <span className={`flex items-center gap-1 tabular-nums ${alertColor}`}>
            <Bell size={16} aria-hidden />
            {actionable.length}
          </span>
        }
      >
        <div className="max-h-[60vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto p-2">
          {actionable.length === 0 && <p className="p-2 text-xs text-muted-foreground">Aucune alerte</p>}
          {actionable.map((event, index) => (
            <div
              key={`${event.host}-${event.session}-${event.pane}-${index}`}
              className="flex items-start gap-1 border-b border-border py-1 last:border-0"
            >
              <button
                type="button"
                role="menuitem"
                className="ui-focus-ring flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded p-2 text-left hover:bg-secondary"
                onClick={() =>
                  onJumpToSession(
                    event.host ? `${event.host}/${event.session}` : event.session,
                    event.window,
                    event.pane,
                  )
                }
              >
                <StatusIcon
                  status={event.status === 'error' ? 'error' : 'waiting'}
                  className={event.status === 'error' ? 'text-destructive' : 'text-warning'}
                />
                <span className="min-w-0 text-xs">
                  <span className="block">
                    {event.session} · {event.tool}
                  </span>
                  <span className="block break-words text-muted-foreground">
                    {event.message || (event.status === 'error' ? 'Erreur' : 'En attente')}
                  </span>
                  <time className="text-2xs text-muted-foreground" dateTime={event.timestamp}>
                    {relativeTime(event.timestamp)}
                  </time>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="ui-focus-ring min-h-11 rounded px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onDismiss(event)}
              >
                Ignorer
              </button>
            </div>
          ))}
          {actionable.length > 0 && (
            <button
              type="button"
              role="menuitem"
              className="ui-focus-ring min-h-11 w-full rounded px-2 text-left text-xs hover:bg-secondary"
              onClick={onDismissAll}
            >
              Tout ignorer
            </button>
          )}
        </div>
      </Menu>
      <button type="button" className={button} onClick={onOpenPalette} aria-label="Rechercher" title="Rechercher">
        <Search size={16} aria-hidden />
        <span className="hidden lg:inline">Rechercher</span>
        <span className="hidden lg:inline">
          <Kbd className="font-normal text-muted-foreground">
            {formatShortcut(prefs.quick_switcher_shortcut || 'mod+k')}
          </Kbd>
        </span>
      </button>
      <button
        type="button"
        className={button}
        onClick={onSettings}
        aria-label="Réglages"
        title="Réglages"
        aria-current={currentView === 'settings' ? 'page' : undefined}
      >
        <Settings size={16} aria-hidden />
      </button>
    </header>
  )
}
