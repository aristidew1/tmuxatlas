import { postRuntimeMutation } from './runtimeApi'

export interface PromptOption {
  key: string
  label: string
}

export interface SessionPrompt {
  is_prompt: boolean
  message: string
  /** Lines just above the question, such as the command being approved. Always shown with the answers. */
  context?: string[]
  options: PromptOption[]
  fingerprint: string
}

export interface SessionPreview {
  pane: string
  window: number
  lines: string[]
  prompt?: SessionPrompt | null
}

export interface ProjectDirectory {
  name: string
  path: string
}

export type NewSessionAgent = 'claude' | 'codex' | 'opencode' | 'copilot'

/** Carries the HTTP status so callers can stop polling a host that lacks the feature (501). */
export class SessionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    message?: string,
  ) {
    super(message || `HTTP ${status}`)
    this.name = 'SessionApiError'
  }
}

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: 'no-store' })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null
    throw new SessionApiError(response.status, body?.code, body?.message)
  }
  return (await response.json()) as T
}

export function fetchSessionPreview(
  target: { hostId: string; session: string; pane?: string; lines?: number },
  signal?: AbortSignal,
): Promise<SessionPreview> {
  const query = new URLSearchParams({ host_id: target.hostId, session: target.session })
  if (target.pane) query.set('pane', target.pane)
  if (target.lines) query.set('lines', String(target.lines))
  return readJson<SessionPreview>(`/api/session/preview?${query}`, signal)
}

export function fetchProjectDirectories(hostId: string, signal?: AbortSignal): Promise<ProjectDirectory[]> {
  const query = new URLSearchParams({ host_id: hostId })
  return readJson<{ directories?: ProjectDirectory[] }>(`/api/session/directories?${query}`, signal).then(
    body => body.directories ?? [],
  )
}

/** The server re-reads the pane and refuses the key when the question has changed. */
export function replyToPrompt(target: {
  hostId: string
  session: string
  pane: string
  key: string
  fingerprint: string
}) {
  return postRuntimeMutation('/api/session/reply', {
    host_id: target.hostId,
    session: target.session,
    pane: target.pane,
    key: target.key,
    fingerprint: target.fingerprint,
  })
}

export function selectWindow(hostId: string, session: string, window: number) {
  return postRuntimeMutation('/api/session/select-window', { host_id: hostId, session, window })
}

export function selectPane(hostId: string, session: string, pane: string) {
  return postRuntimeMutation('/api/session/select-pane', { host_id: hostId, session, pane })
}
