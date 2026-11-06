import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderStrict } from '../test/render'
import { Inbox } from './Inbox'
import * as sessionApi from '../lib/sessionApi'
import { RuntimeAPIError } from '../lib/runtimeApi'
import type { ToolEvent } from '../hooks/useToolEvents'

const events: ToolEvent[] = [
  {
    host: 'h',
    session: 'attente',
    tool: 'claude',
    status: 'waiting',
    window: 0,
    pane: '%1',
    timestamp: '2024-01-01T00:00:00Z',
    message: 'Ancienne question',
  },
  {
    host: 'h',
    session: 'erreur',
    tool: 'codex',
    status: 'error',
    window: 0,
    pane: '%2',
    timestamp: '2024-01-02T00:00:00Z',
    message: 'Erreur de travail',
  },
]
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('Inbox', () => {
  it('priorise les erreurs et navigue au clavier sans agir depuis un champ', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    const open = vi.fn(),
      dismiss = vi.fn()
    renderStrict(
      <>
        <input aria-label="Recherche" />
        <Inbox events={events} multipleHosts={false} onOpen={open} onDismiss={dismiss} />
      </>,
    )
    const rows = document.querySelectorAll('[data-inbox-row]')
    expect(rows[0]).toHaveTextContent('erreur')
    fireEvent.keyDown(screen.getByLabelText('Recherche'), { key: 'x' })
    expect(dismiss).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'j' })
    expect(rows[1]).toHaveFocus()
    fireEvent.keyDown(rows[1], { key: 'Enter' })
    expect(open).toHaveBeenCalledWith(events[0])
  })
  it('envoie uniquement le choix explicite avec le fingerprint affiché et traite le conflit', async () => {
    const reply = vi
      .spyOn(sessionApi, 'replyToPrompt')
      .mockRejectedValue(new RuntimeAPIError(409, { code: 'prompt_changed' }))
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          pane: '%1',
          window: 0,
          lines: ['sortie'],
          prompt: {
            is_prompt: true,
            message: 'Continuer ?',
            options: [{ key: '1', label: 'Oui, exactement' }],
            fingerprint: 'empreinte',
          },
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    renderStrict(<Inbox events={[events[0]]} multipleHosts={false} onOpen={vi.fn()} onDismiss={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '1 Oui, exactement' }))
    await waitFor(() => expect(screen.getByText('La question a changé')).toBeInTheDocument())
    expect(reply).toHaveBeenCalledOnce()
    expect(reply).toHaveBeenCalledWith({
      hostId: 'h',
      session: 'attente',
      pane: '%1',
      key: '1',
      fingerprint: 'empreinte',
    })
  })
  it('affiche la question et les réponses du panneau non sélectionné', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const pane = new URL(url, 'http://localhost').searchParams.get('pane')
      return new Response(
        JSON.stringify({
          pane,
          window: 0,
          lines: [pane === '%1' ? 'aperçu attente' : 'aperçu erreur'],
          prompt:
            pane === '%1'
              ? {
                  is_prompt: true,
                  message: 'Question exacte ?',
                  options: [{ key: 'o', label: 'Oui' }],
                  fingerprint: 'empreinte',
                }
              : null,
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    renderStrict(<Inbox events={events} multipleHosts={false} onOpen={vi.fn()} onDismiss={vi.fn()} />)
    expect(await screen.findByText('Question exacte ?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'o Oui' })).toBeVisible()
    expect(screen.queryByText('aperçu attente')).not.toBeInTheDocument()
    expect(screen.getByText('aperçu erreur')).toBeInTheDocument()
  })
})

vi.mock('../state/provider', () => ({
  useApplicationState: () => ({ state: { projection: { health: {} } } }),
}))

describe('Résumé de la vue d’ensemble', () => {
  it('montre la commande concernée avec les réponses', async () => {
    const preview = {
      pane: '%1',
      window: 0,
      lines: [],
      prompt: {
        is_prompt: true,
        message: 'Do you want to proceed?',
        context: ['Bash command', 'git push origin main'],
        options: [{ key: '1', label: 'Yes' }],
        fingerprint: 'empreinte',
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(preview), { status: 200 })),
    )
    const timestamp = new Date().toISOString()
    renderStrict(
      <Inbox
        events={[
          { tool: 'claude', status: 'error', host: 'h', session: 'a', window: 0, pane: '%2', timestamp },
          { tool: 'claude', status: 'waiting', host: 'h', session: 'b', window: 0, pane: '%1', timestamp },
        ]}
        multipleHosts={false}
        onOpen={() => {}}
        onDismiss={() => {}}
      />,
    )
    const context = await screen.findByLabelText('Contexte de la question')
    expect(context.textContent).toContain('git push origin main')
  })

  it('accorde les compteurs et masque ceux qui valent zéro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sessions: { total: 1 },
              agents: { active: 1, waiting: 2, error: 1 },
            }),
            { status: 200 },
          ),
      ),
    )
    const { Overview } = await import('./Overview')
    const props = {
      sessions: [],
      hosts: [],
      pendingAlerts: [],
      onSessionSelect: vi.fn(),
      getSessionEvents: vi.fn(() => []),
      getSessionActivity: vi.fn(),
      onJumpToSession: vi.fn(),
      onDismissAlert: vi.fn(),
      onOpenMonitoring: vi.fn(),
    }
    const view = renderStrict(<Overview {...props} />)
    await waitFor(() => expect(screen.getByText('agent actif', { exact: false })).toHaveTextContent('1 agent actif'))
    expect(screen.getByText('en attente', { exact: false })).toHaveTextContent('2 en attente')
    expect(screen.getByText('erreur', { exact: false })).toHaveTextContent('1 erreur')
    expect(screen.getByText('session')).toHaveTextContent('1 session')
    view.unmount()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sessions: { total: 0 },
              agents: { active: 0, waiting: 0, error: 0 },
            }),
            { status: 200 },
          ),
      ),
    )
    renderStrict(<Overview {...props} />)
    expect(await screen.findByText('sessions')).toHaveTextContent('0 sessions')
    expect(screen.queryByText(/agents? actifs?/)).not.toBeInTheDocument()
    expect(screen.queryByText(/en attente/)).not.toBeInTheDocument()
    expect(screen.queryByText(/erreurs?/)).not.toBeInTheDocument()
  })
})
