import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Maximize2, Plus, X } from 'lucide-react'
import { getBrandStorage, setBrandStorage } from '../lib/brandStorage'
import { useHostLabel } from '../lib/hostLabel'
import { isAttentionStatus, type WorkspaceViewModel } from '../workspace/model'
import { IconButton, StatusIcon } from './ui'
import { Terminal } from './Terminal'

const storageKey = 'wall-targets:v1'
export function WallView({
  workspace,
  onOpenSession,
}: {
  workspace: WorkspaceViewModel
  onOpenSession: (key: string) => void
}) {
  const hostLabel = useHostLabel()
  const needsSuggestions = useRef(false)
  const suggestions = () =>
    [...workspace.sessions]
      .sort(
        (a, b) =>
          Number(isAttentionStatus(b.status)) - Number(isAttentionStatus(a.status)) ||
          (Date.parse(b.lastActivity ?? '') || 0) - (Date.parse(a.lastActivity ?? '') || 0),
      )
      .slice(0, 2)
      .map(session => session.key)
  const [targets, setTargets] = useState<string[]>(() => {
    try {
      const saved = getBrandStorage(storageKey)
      if (saved !== null) {
        const parsed: unknown = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          return [...new Set(parsed.filter((value): value is string => typeof value === 'string'))].slice(0, 4)
        }
      }
    } catch {
      /* Stockage indisponible. */
    }
    needsSuggestions.current = workspace.sessions.length === 0
    return suggestions()
  })
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    if (!needsSuggestions.current || workspace.sessions.length === 0) return
    needsSuggestions.current = false
    setTargets(suggestions())
  }, [workspace.sessions])
  useEffect(() => {
    setTargets(previous => {
      const next = previous.filter(key => !key || workspace.byTarget.has(key))
      return next.length === previous.length ? previous : next
    })
  }, [workspace.byTarget])
  useEffect(() => {
    if (needsSuggestions.current) return
    try {
      setBrandStorage(storageKey, JSON.stringify(targets))
    } catch {
      /* Stockage indisponible. */
    }
  }, [targets])
  const available = workspace.sessions.filter(session => !targets.includes(session.key))
  const multipleHosts = new Set(workspace.sessions.map(session => session.hostId)).size > 1
  const label = (session: (typeof workspace.sessions)[number]) =>
    multipleHosts
      ? `${hostLabel(session.hostId, session.hostName === session.hostId ? 'Hôte' : session.hostName || 'Hôte')} / ${session.name}`
      : session.name
  const select = (index: number, key: string) =>
    setTargets(previous => {
      const next = [...previous]
      if (index === next.length) next.push(key)
      else next[index] = key
      return next
    })
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl">Mur</h1>
        {targets.length < 4 && available.length > 0 && (
          <IconButton aria-label="Ajouter une tuile" onClick={() => setTargets(previous => [...previous, ''])}>
            <Plus size={16} />
          </IconButton>
        )}
      </header>
      {targets.length > 2 && (
        <p className="text-xs text-muted-foreground md:hidden">
          Au-delà de deux tuiles, la lecture est moins confortable sur téléphone.
        </p>
      )}
      {targets.length === 0 && available.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Aucune session à afficher pour le moment.
        </div>
      ) : (
        <div
          className={`grid min-h-0 flex-1 auto-rows-[minmax(18rem,1fr)] grid-cols-1 gap-3 overflow-auto md:auto-rows-fr md:grid-cols-2 ${targets.length === 1 ? 'md:grid-cols-1' : targets.length === 3 ? 'md:grid-cols-3' : ''}`}
        >
          {(targets.length ? targets : ['']).map((key, index) => {
            const session = workspace.byTarget.get(key)
            return (
              <div
                key={key || `empty-${index}`}
                data-tone={
                  session?.status === 'error' ? 'error' : session?.status === 'waiting' ? 'waiting' : undefined
                }
                className={`atlas-surface flex min-h-72 min-w-0 flex-col overflow-hidden rounded-lg ${active === key && key ? 'ring-2 ring-primary' : ''}`}
                onFocusCapture={() => setActive(key)}
                onMouseDown={() => setActive(key)}
              >
                <header className="flex h-11 shrink-0 items-center gap-2 px-3">
                  <div className="relative flex min-w-0 flex-1 items-center gap-2">
                    {session && <StatusIcon status={session.status} />}
                    <select
                      aria-label={session ? 'Changer de session' : 'Choisir une session'}
                      value={key}
                      className="ui-focus-ring min-h-11 min-w-0 flex-1 appearance-none truncate bg-transparent pr-5 text-sm text-foreground"
                      onChange={event => select(index, event.target.value)}
                    >
                      <option value="" disabled>
                        Choisir une session
                      </option>
                      {session && <option value={key}>{label(session)}</option>}
                      {available.map(item => (
                        <option key={item.key} value={item.key}>
                          {label(item)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-0" />
                  </div>
                  {session && (
                    <IconButton aria-label="Agrandir" size="sm" onClick={() => onOpenSession(key)}>
                      <Maximize2 size={16} />
                    </IconButton>
                  )}
                  <IconButton
                    aria-label="Retirer"
                    size="sm"
                    onClick={() => setTargets(previous => previous.filter((_, i) => i !== index))}
                  >
                    <X size={16} />
                  </IconButton>
                </header>
                {session && (
                  <Terminal
                    embedded
                    sessionName={session.name}
                    hostId={session.hostId}
                    hostName={session.hostName}
                    sessionStatus={session.status}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
