import { CircleHelp } from 'lucide-react'
import type { Host } from '../hooks/useHosts'
interface StatusBarProps {
  sessionCount: number
  waitingCount: number
  pushState: string
  version: string | null
  updateAvailable: boolean
  hosts: Host[]
  agentCount: number
  onHelp?: () => void
  alignSlotToTerminal?: boolean
  onSlotChange?: (slot: HTMLElement | null) => void
}
export function StatusBar({
  sessionCount,
  waitingCount,
  pushState,
  version,
  updateAvailable,
  hosts,
  agentCount,
  onHelp,
  alignSlotToTerminal,
  onSlotChange,
}: StatusBarProps) {
  return (
    <footer className="hidden shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-4 py-1 font-sans text-2xs text-muted-foreground md:flex">
      <div className="flex items-center gap-4">
        <div className={`flex items-center gap-4 tabular-nums ${alignSlotToTerminal ? 'lg:min-w-[14rem]' : ''}`}>
          <span>Sessions : {sessionCount}</span>
          <span>Agents : {agentCount}</span>
          {hosts.length > 1 && <span>Hôtes en ligne : {hosts.filter(h => h.online).length}</span>}
          {waitingCount > 0 && <span className="text-warning">En attente : {waitingCount}</span>}
        </div>
        <div ref={onSlotChange} className="flex items-center empty:hidden" />
      </div>
      <div className="flex items-center gap-4">
        {pushState !== 'unsupported' && (
          <span>
            {pushState === 'subscribed'
              ? 'Notifications activées'
              : pushState === 'denied'
                ? 'Notifications bloquées'
                : 'Notifications désactivées'}
          </span>
        )}
        {version &&
          (updateAvailable ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ui-focus-ring text-warning"
              title="Recharger pour installer la mise à jour"
            >
              {version} · mise à jour disponible
            </button>
          ) : (
            <span>{version}</span>
          ))}
        {onHelp && (
          <button
            type="button"
            onClick={onHelp}
            aria-label="Raccourcis clavier"
            title="Raccourcis clavier"
            className="ui-focus-ring grid min-h-8 min-w-8 place-items-center rounded hover:text-foreground"
          >
            <CircleHelp size={16} aria-hidden />
          </button>
        )}
      </div>
    </footer>
  )
}
