export interface RuntimeAPIErrorBody {
  request_id?: string
  generation?: number
  code?: string
}

export class RuntimeAPIError extends Error {
  requestId?: string
  generation?: number
  code: string

  constructor(status: number, body: RuntimeAPIErrorBody = {}) {
    const code = body.code || `http-${status}`
    super(runtimeErrorMessage(code))
    this.name = 'RuntimeAPIError'
    this.requestId = body.request_id
    this.generation = body.generation
    this.code = code
  }
}

export async function postRuntimeMutation<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let errorBody: RuntimeAPIErrorBody = {}
    try {
      errorBody = await response.json()
    } catch {}
    throw new RuntimeAPIError(response.status, errorBody)
  }
  return response.json()
}

export function runtimeErrorMessage(code: string): string {
  switch (code) {
    case 'invalid-target':
      return 'La cible de la session est invalide ou incomplète.'
    case 'not-found':
      return 'La session sélectionnée n’existe plus.'
    case 'peer-offline':
      return 'L’hôte sélectionné est hors ligne.'
    case 'peer-revoked':
      return 'L’accès à l’hôte sélectionné a été révoqué.'
    case 'protocol-incompatible':
      return 'L’hôte doit être mis à jour avant cette action.'
    case 'capability-unsupported':
      return 'L’hôte ne prend pas en charge cette action.'
    case 'queue-full':
      return 'L’hôte est occupé. Réessayez dans un instant.'
    case 'timeout':
      return 'L’hôte n’a pas terminé l’action à temps.'
    case 'execution-unknown':
      return 'Le résultat est inconnu après la reconnexion de l’hôte. Vérifiez la session avant de réessayer.'
    case 'request-conflict':
      return 'Cette demande entre en conflit avec une action précédente.'
    case 'resource-exhausted':
      return 'L’hôte ne peut pas conserver un autre résultat pour le moment.'
    default:
      return 'L’action sur la session a échoué.'
  }
}
import { apiFetch } from './api'
