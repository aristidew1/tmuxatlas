import { useEffect, useRef, useState } from 'react'
import { User } from 'lucide-react'
import type { Session } from '../hooks/useSessions'
import type { ToolEvent } from '../hooks/useToolEvents'
import type { ActivitySnapshot } from '../hooks/useActivity'
import { usePreferences } from '../hooks/usePreferences'
import { useSessionPreview } from '../hooks/useSessionPreview'
import { resolveOwnerName } from '../lib/accountsApi'
import { deriveSessionStatus, workspaceStatusLabel } from '../workspace/model'
import { Button } from './ui/Button'
import { StatusPill } from './ui/StatusPill'

function formatActivity(value: string, format: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  if (format === 'absolute') return date.toLocaleString()
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000))
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  if (minutes < 1440) return `il y a ${Math.floor(minutes / 60)} h`
  return `il y a ${Math.floor(minutes / 1440)} j`
}

export function SessionCard({
  session,
  events,
  activity,
  sparklines,
  ownerName,
  onSelect,
  onRelease,
}: {
  session: Session
  events: ToolEvent[]
  activity?: ActivitySnapshot
  sparklines: boolean
  ownerName?: string | null
  onSelect: () => void
  onRelease?: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  const { prefs } = usePreferences()
  const status = deriveSessionStatus(session, events)
  const previous = useRef(status)
  const [flash, setFlash] = useState(0)
  useEffect(() => {
    if (previous.current !== status) {
      previous.current = status
      setFlash(n => n + 1)
    }
  }, [status])
  useEffect(() => {
    if (!ref.current) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const { preview } = useSessionPreview({ hostId: session.host, session: session.name }, { enabled: visible, lines: 4 })
  const agents = [
    ...new Set([
      ...events.map(e => e.tool),
      ...session.windows.flatMap(w =>
        w.panes.map(p => p.current_command).filter(c => ['claude', 'codex', 'copilot', 'opencode'].includes(c)),
      ),
    ]),
  ]
  const resolvedOwner = ownerName !== undefined ? ownerName : resolveOwnerName(session.owner)
  const metadata = [
    agents.join(', '),
    `${session.windows.length} fenêtre${session.windows.length === 1 ? '' : 's'}`,
    session.last_activity ? formatActivity(session.last_activity, prefs.timestamp_format) : '',
  ].filter(Boolean)
  const lines = (preview?.lines ?? [])
    .join('\n')
    .replace(/\n(?:[ \t]*\n)+/g, '\n\n')
    .split('\n')
    .slice(-4)
  const hasLines = lines.some(line => line.trim())
  const values = activity?.sparkline ?? []
  const max = Math.max(...values, 1)

  const cardBody = (
    <div key={flash} className={`min-w-0 w-full ${flash ? 'atlas-flash' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{session.name}</span>
          {resolvedOwner && (
            <span
              data-testid="session-owner-badge"
              className="inline-flex shrink-0 items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-2xs text-muted-foreground"
            >
              <User size={12} aria-hidden="true" />
              <span>{resolvedOwner}</span>
            </span>
          )}
        </div>
        <StatusPill status={status}>{workspaceStatusLabel(status)}</StatusPill>
      </div>
      <div className="mt-2 truncate text-xs text-muted-foreground">{metadata.join(' · ')}</div>
      <div
        className="mt-3 flex h-[4lh] items-end overflow-hidden font-mono text-2xs text-muted-foreground"
        style={{ maskImage: 'linear-gradient(to bottom, transparent, black 30%)' }}
      >
        {hasLines && <pre className="overflow-hidden whitespace-pre">{lines.join('\n')}</pre>}
      </div>
      {sparklines && values.length >= 4 && (
        <svg
          aria-label="Activité récente"
          role="img"
          viewBox={`0 0 ${values.length - 1} 20`}
          preserveAspectRatio="none"
          className="mt-3 h-5 w-full"
        >
          <polyline
            points={values.map((v, i) => `${i},${19 - (v / max) * 18}`).join(' ')}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </div>
  )

  if (onRelease) {
    return (
      <div
        data-tone={status === 'error' || status === 'waiting' ? status : undefined}
        className="atlas-surface flex h-full w-full flex-col justify-between rounded-lg p-4 transition-colors hover:bg-secondary/50"
      >
        <button
          ref={ref}
          type="button"
          onClick={onSelect}
          className="ui-focus-ring flex w-full items-start text-left"
        >
          {cardBody}
        </button>
        <div className="mt-3 flex justify-end border-t border-border/60 pt-2">
          <Button type="button" variant="secondary" size="sm" onClick={onRelease}>
            Libérer
          </Button>
        </div>
      </div>
    )
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      data-tone={status === 'error' || status === 'waiting' ? status : undefined}
      className="atlas-surface ui-focus-ring flex h-full w-full items-start rounded-lg p-4 text-left transition-colors hover:bg-secondary/50"
    >
      {cardBody}
    </button>
  )
}
