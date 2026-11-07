import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Maximize2, Plus, X } from 'lucide-react'
import { getBrandStorage, setBrandStorage } from '../lib/brandStorage'
import { useHostLabel } from '../lib/hostLabel'
import { isAttentionStatus, type WorkspaceViewModel } from '../workspace/model'
import { IconButton, StatusIcon } from './ui'
import { Terminal } from './Terminal'

const storageKey = 'wall-targets:v1'
type WallSession = WorkspaceViewModel['sessions'][number]

/**
 * Up to four live sessions side by side. Until the account chooses its tiles,
 * the Wall suggests its own sessions; any session can then be added.
 */
export function WallView({
  workspace,
  owner,
  onOpenSession,
}: {
  workspace: WorkspaceViewModel
  /** The signed-in account; without one, every session counts as its own. */
  owner?: string | null
  onOpenSession: (key: string) => void
}) {
  const hostLabel = useHostLabel()
  const needsSuggestions = useRef(false)
  const isOwn = (session: WallSession) => !owner || session.ownerName === owner
  const ownSessions = workspace.sessions.filter(isOwn)
  const suggestions = () =>
    [...ownSessions]
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
    needsSuggestions.current = ownSessions.length === 0
    return suggestions()
  })
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    if (!needsSuggestions.current || ownSessions.length === 0) return
    needsSuggestions.current = false
    setTargets(suggestions())
  }, [workspace.sessions, owner])
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
  const availableOwn = available.filter(isOwn)
  const availableOthers = available.filter(session => !isOwn(session))
  const multipleHosts = new Set(workspace.sessions.map(session => session.hostId)).size > 1
  const name = (session: WallSession) =>
    multipleHosts
      ? `${hostLabel(session.hostId, session.hostName === session.hostId ? 'Hôte' : session.hostName || 'Hôte')} / ${session.name}`
      : session.name
  const label = (session: WallSession) =>
    isOwn(session) ? name(session) : `${name(session)} · ${session.ownerName || 'sans propriétaire'}`
  const option = (session: WallSession) => (
    <option key={session.key} value={session.key}>
      {label(session)}
    </option>
  )
  const choose = (update: (previous: string[]) => string[]) => {
    // A choice ends the suggestions, so it is saved even before the account owns a session.
    needsSuggestions.current = false
    setTargets(update)
  }
  const select = (index: number, key: string) =>
    choose(previous => {
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
          <IconButton aria-label="Ajouter une tuile" onClick={() => choose(previous => [...previous, ''])}>
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
                      {availableOthers.length > 0 && owner ? (
                        <>
                          {availableOwn.length > 0 && (
                            <optgroup label="Mes sessions">{availableOwn.map(option)}</optgroup>
                          )}
                          <optgroup label="Autres propriétaires">{availableOthers.map(option)}</optgroup>
                        </>
                      ) : (
                        available.map(option)
                      )}
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
                    onClick={() => choose(previous => previous.filter((_, i) => i !== index))}
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
