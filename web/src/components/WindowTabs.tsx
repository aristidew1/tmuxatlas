import type { KeyboardEvent } from 'react'
import type { Window as SessionWindow } from '../hooks/useSessions'
import { StatusIcon } from './ui'

interface Props {
  windows: SessionWindow[]
  windowAttention?: Record<number, 'error' | 'waiting'>
  onSelectWindow?: (index: number) => void
  onSelectPane?: (id: string) => void
}

export function WindowTabs({ windows, windowAttention, onSelectWindow, onSelectPane }: Props) {
  const active = windows.find(window => window.active) ?? windows[0]
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const current = windows.findIndex(window => window.active)
    const next = windows[(current + (event.key === 'ArrowRight' ? 1 : -1) + windows.length) % windows.length]
    if (next) onSelectWindow?.(next.index)
  }
  if (windows.length < 2 && (active?.panes.length ?? 0) < 2) return null
  return (
    <div className="terminal-window-tabs flex h-9 shrink-0 items-center gap-2 px-2 text-xs">
      {windows.length >= 2 && (
        <div
          role="tablist"
          aria-label="Fenêtres"
          onKeyDown={onKeyDown}
          className="scrollbar-none flex h-11 -mt-2 min-w-0 flex-1 items-end overflow-x-auto"
        >
          {windows.map(window => {
            const attention = windowAttention?.[window.index]
            return (
              <button
                key={window.id}
                type="button"
                role="tab"
                aria-selected={window.active}
                tabIndex={window.active ? 0 : -1}
                onClick={() => onSelectWindow?.(window.index)}
                className="terminal-window-tab ui-focus-ring relative flex h-9 shrink-0 items-center gap-1 px-3 text-muted-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 aria-selected:text-foreground aria-selected:after:bg-primary"
              >
                <span className="tabular-nums">{window.index}</span> {window.name}
                {attention && (
                  <>
                    <StatusIcon status={attention} />
                    <span className="sr-only">{attention === 'error' ? 'Erreur' : 'En attente'}</span>
                  </>
                )}
              </button>
            )
          })}
        </div>
      )}
      {active && active.panes.length > 1 && (
        <select
          aria-label="Panneau actif"
          value={active.panes.find(pane => pane.active)?.id ?? ''}
          onChange={event => onSelectPane?.(event.target.value)}
          className="min-w-0 max-w-40 bg-transparent text-xs"
        >
          {active.panes.map(pane => (
            <option key={pane.id} value={pane.id}>
              {pane.index} · {pane.current_command}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
