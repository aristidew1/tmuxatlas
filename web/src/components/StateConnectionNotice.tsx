import { CircleAlert, LoaderCircle } from 'lucide-react'
import { Button } from './ui'
import type { ConnectionState } from '../state/types'

export function StateConnectionNotice({
  state,
  onAuthRequired,
}: {
  state: ConnectionState
  onAuthRequired?: () => void
}) {
  if (state === 'ready') return null

  const labels: Record<ConnectionState, string> = {
    connecting: 'Connexion au Hub…',
    rehydrating: 'Synchronisation du Hub…',
    ready: '',
    reconnecting: 'Connexion perdue. Reconnexion…',
    'auth-required': 'Votre session de connexion a expiré.',
    'reload-required': 'Atlas a été mis à jour. Rechargez cette page pour continuer.',
  }
  const action =
    state === 'reload-required'
      ? () => window.location.reload()
      : state === 'auth-required'
        ? onAuthRequired
        : undefined

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute top-2 left-1/2 z-[9999] flex min-h-11 -translate-x-1/2 items-center gap-3 atlas-surface max-w-[calc(100%-2rem)] rounded-lg px-4 py-2 text-sm shadow-lg"
    >
      {state === 'auth-required' || state === 'reload-required' ? (
        <CircleAlert size={16} aria-hidden="true" />
      ) : (
        <LoaderCircle size={16} aria-hidden="true" />
      )}
      <span>{labels[state]}</span>
      {action && (
        <Button variant="ghost" onClick={action} className="shrink-0">
          {state === 'reload-required' ? 'Recharger' : 'Se connecter'}
        </Button>
      )}
    </div>
  )
}
