import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, X } from 'lucide-react'
import type { ToolEvent } from '../hooks/useToolEvents'
import { useSessionPreview } from '../hooks/useSessionPreview'
import { useHostLabel } from '../lib/hostLabel'
import { replyToPrompt } from '../lib/sessionApi'
import { RuntimeAPIError } from '../lib/runtimeApi'
import { toolColors } from '../theme'
import { StatusIcon } from './ui/StatusPill'
import { Button } from './ui/Button'
import { TopoBackground } from './Brand'

const eventKey = (e: ToolEvent) => `${e.host || ''}/${e.session}/${e.window}/${e.pane || ''}`

function elapsed(timestamp: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60000))
  if (!Number.isFinite(minutes)) return 'une durée inconnue'
  if (minutes < 1) return 'moins d’une minute'
  if (minutes < 60) return `${minutes} min`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
  return `${Math.floor(minutes / 1440)} j`
}

function InboxRow({
  event,
  selected,
  multipleHosts,
  now,
  onSelect,
  onOpen,
  onDismiss,
}: {
  event: ToolEvent
  selected: boolean
  multipleHosts: boolean
  now: number
  onSelect: () => void
  onOpen: () => void
  onDismiss: () => void
}) {
  const label = useHostLabel()
  const { preview, refresh } = useSessionPreview(
    { hostId: event.host || '', session: event.session, pane: event.pane },
    { enabled: !!event.pane, lines: 8 },
  )
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const prompt = preview?.prompt?.is_prompt ? preview.prompt : null
  const message = prompt?.message || event.message
  const secondary = prompt?.message && event.message && event.message.trim() !== prompt.message.trim()
  const lines = preview?.lines.join('\n').replace(/\n(?:[ \t]*\n)+/g, '\n\n')

  const reply = async (key: string) => {
    if (!prompt?.fingerprint || !event.pane || sending) return
    setSending(true)
    setNotice('')
    try {
      await replyToPrompt({
        hostId: event.host || '',
        session: event.session,
        pane: event.pane,
        key,
        fingerprint: prompt.fingerprint,
      })
      setNotice('Réponse envoyée')
      refresh()
      // The question is answered: if the agent asks again, its hook raises a new alert.
      window.setTimeout(() => onDismiss(), 1200)
    } catch (error) {
      if (error instanceof RuntimeAPIError && error.code === 'prompt_changed') {
        setNotice('La question a changé')
        refresh()
      } else {
        setNotice('Impossible d’envoyer la réponse')
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <li className="border-b border-border/60 last:border-0">
      <button
        type="button"
        data-inbox-row={eventKey(event)}
        onClick={onSelect}
        aria-expanded={selected}
        className={`ui-focus-ring flex min-h-11 w-full items-start gap-2 rounded px-2 py-2 text-left ${selected ? 'bg-secondary/50' : 'hover:bg-secondary/30'}`}
      >
        <StatusIcon
          status={event.status === 'error' ? 'error' : 'waiting'}
          className={event.status === 'error' ? 'text-destructive mt-0.5' : 'text-warning mt-0.5'}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-medium text-foreground">{event.session}</span>
            <span style={{ color: toolColors[event.tool] || 'var(--muted-foreground)' }}>{event.tool}</span>
            {multipleHosts && (
              <span className="text-muted-foreground" title={event.host}>
                {label(event.host, event.host_name || 'Hôte')}
              </span>
            )}
            <span className="text-muted-foreground">
              {event.status === 'error' ? 'erreur' : 'en attente'} depuis {elapsed(event.timestamp, now)}
            </span>
          </span>
          <span className="mt-1 block whitespace-pre-wrap break-words text-sm">{message}</span>
          {secondary && (
            <span className="mt-1 block whitespace-pre-wrap text-xs text-muted-foreground">{event.message}</span>
          )}
        </span>
      </button>
      {(selected || (prompt?.options?.length && prompt.fingerprint && event.pane) || notice) && (
        <div className="pl-[30px] pr-2 pb-3">
          {selected && lines && (
            <pre className="mb-2 max-h-32 overflow-auto whitespace-pre font-mono text-2xs text-muted-foreground">
              {lines}
            </pre>
          )}
          {!selected && !!prompt?.context?.length && !!prompt.options?.length && (
            <pre
              aria-label="Contexte de la question"
              className="mb-2 overflow-hidden whitespace-pre font-mono text-2xs text-muted-foreground"
            >
              {prompt.context.join('\n')}
            </pre>
          )}
          {!!prompt?.options?.length && prompt.fingerprint && event.pane && (
            <div className="mb-2 flex flex-wrap gap-2">
              {prompt.options.map(option => (
                <Button key={option.key} size="sm" disabled={sending} onClick={() => void reply(option.key)}>
                  {option.key} {option.label}
                </Button>
              ))}
            </div>
          )}
          {selected && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<ArrowUpRight size={14} aria-hidden="true" />}
                onClick={onOpen}
              >
                Ouvrir
              </Button>
              <Button variant="ghost" size="sm" leadingIcon={<X size={14} aria-hidden="true" />} onClick={onDismiss}>
                Ignorer
              </Button>
            </div>
          )}
          {notice && (
            <span role="status" className="text-xs">
              {notice}
            </span>
          )}
        </div>
      )}
    </li>
  )
}

export function Inbox({
  events,
  multipleHosts,
  onOpen,
  onDismiss,
}: {
  events: ToolEvent[]
  multipleHosts: boolean
  onOpen: (event: ToolEvent) => void
  onDismiss: (event: ToolEvent) => void
}) {
  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) =>
          Number(b.status === 'error') - Number(a.status === 'error') ||
          Date.parse(a.timestamp) - Date.parse(b.timestamp),
      ),
    [events],
  )
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const list = useRef<HTMLUListElement>(null)
  const selectedIndex = Math.max(
    0,
    sorted.findIndex(e => eventKey(e) === selectedKey),
  )
  const selected = sorted[selectedIndex]
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      if (
        !selected ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog') ||
        document.querySelector('[role="dialog"], dialog[open]')
      )
        return
      const key = e.key.toLowerCase()
      if (key === 'j' || key === 'k') {
        e.preventDefault()
        const index = Math.max(0, Math.min(sorted.length - 1, selectedIndex + (key === 'j' ? 1 : -1)))
        setSelectedKey(eventKey(sorted[index]))
        const button = list.current?.querySelectorAll<HTMLButtonElement>('[data-inbox-row]')[index]
        button?.focus()
        button?.scrollIntoView?.({ block: 'nearest' })
      } else if (key === 'x') {
        e.preventDefault()
        onDismiss(selected)
      } else if (
        key === 'enter' &&
        (!target || target.hasAttribute('data-inbox-row') || !target.closest('button, a, [role=button]'))
      ) {
        e.preventDefault()
        onOpen(selected)
      }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [sorted, selected, selectedIndex, onDismiss, onOpen])

  return (
    <section aria-labelledby="inbox-title" className="mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="inbox-title" className="text-sm font-medium">
          À traiter {sorted.length > 0 && <span className="tabular-nums text-muted-foreground">({sorted.length})</span>}
        </h2>
        {sorted.length > 0 && (
          <span className="hidden text-2xs text-muted-foreground md:[@media(pointer:fine)]:inline">
            J/K naviguer · Entrée ouvrir · X ignorer
          </span>
        )}
      </div>
      {sorted.length ? (
        <ul ref={list} className="atlas-surface rounded-lg">
          {sorted.map((event, i) => (
            <InboxRow
              key={eventKey(event)}
              event={event}
              selected={i === selectedIndex}
              multipleHosts={multipleHosts}
              now={now}
              onSelect={() => setSelectedKey(eventKey(event))}
              onOpen={() => onOpen(event)}
              onDismiss={() => onDismiss(event)}
            />
          ))}
        </ul>
      ) : (
        <div className="atlas-surface relative overflow-hidden rounded-lg px-4 py-5 text-sm text-muted-foreground">
          <TopoBackground className="opacity-5" />
          <span className="relative">Rien à traiter</span>
        </div>
      )}
    </section>
  )
}
