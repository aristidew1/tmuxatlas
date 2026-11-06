import type { ConnectionState } from './types'
import type { PtyConnectionState } from '../hooks/useTerminal'

export type TerminalWorkspaceConnectionState =
  | 'connecting'
  | 'rehydrating'
  | 'connected'
  | 'reconnecting'
  | 'hub-offline'
  | 'agent-offline'
  | 'session-ended'
  | 'auth-required'
  | 'reload-required'

export interface TerminalWorkspaceConnectionInput {
  hub: ConnectionState
  pty: PtyConnectionState
  agentOnline: boolean
  sessionAvailable: boolean
}

export interface TerminalWorkspaceConnection {
  state: TerminalWorkspaceConnectionState
  label: string
  detail: string
  recoverable: boolean
}

const connectionCopy: Record<TerminalWorkspaceConnectionState, Omit<TerminalWorkspaceConnection, 'state'>> = {
  connecting: {
    label: 'Connexion',
    detail: 'Ouverture de la connexion au terminal…',
    recoverable: false,
  },
  rehydrating: {
    label: 'Synchronisation',
    detail: 'Actualisation de l’état du Hub…',
    recoverable: false,
  },
  connected: {
    label: 'Connecté',
    detail: 'Le terminal est connecté.',
    recoverable: false,
  },
  reconnecting: {
    label: 'Reconnexion',
    detail: 'La connexion au terminal a été interrompue. Nouvelle tentative…',
    recoverable: true,
  },
  'hub-offline': {
    label: 'Hub hors ligne',
    detail: 'Le navigateur ne peut pas joindre le Hub.',
    recoverable: true,
  },
  'agent-offline': {
    label: 'Agent hors ligne',
    detail: 'L’hôte sélectionné n’est pas connecté au Hub.',
    recoverable: true,
  },
  'session-ended': {
    label: 'Session terminée',
    detail: 'La session tmux sélectionnée n’est plus disponible.',
    recoverable: false,
  },
  'auth-required': {
    label: 'Connexion requise',
    detail: 'Votre session de connexion a expiré.',
    recoverable: true,
  },
  'reload-required': {
    label: 'Rechargement requis',
    detail: 'Atlas a été mis à jour. Rechargez cette page.',
    recoverable: true,
  },
}

/**
 * Combines the three connection layers used by a Terminal view. Higher-level
 * Hub and target availability always win over the lower-level PTY socket so
 * the UI cannot claim a stale socket is connected after its target vanished.
 */
export function deriveTerminalWorkspaceConnection(
  input: TerminalWorkspaceConnectionInput,
): TerminalWorkspaceConnection {
  let state: TerminalWorkspaceConnectionState

  if (input.hub === 'auth-required') {
    state = 'auth-required'
  } else if (input.hub === 'reload-required') {
    state = 'reload-required'
  } else if (input.hub === 'connecting') {
    state = 'connecting'
  } else if (input.hub === 'rehydrating') {
    state = 'rehydrating'
  } else if (input.hub === 'reconnecting') {
    state = 'hub-offline'
  } else if (!input.sessionAvailable) {
    state = 'session-ended'
  } else if (!input.agentOnline) {
    state = 'agent-offline'
  } else if (input.pty === 'connected') {
    state = 'connected'
  } else if (input.pty === 'connecting') {
    state = 'connecting'
  } else {
    state = 'reconnecting'
  }

  return { state, ...connectionCopy[state] }
}
