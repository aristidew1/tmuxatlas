import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreferencesContext, defaultPreferences } from '../hooks/usePreferences'
import type { PWAInstallState } from '../hooks/usePWAInstall'
import type { Session } from '../hooks/useSessions'
import { resolveOwnerName } from '../lib/accountsApi'
import { AdminPage } from './AdminPage'
import { Login } from './Login'
import { MobileNav } from './MobileNav'
import { Overview } from './Overview'
import { SessionCard } from './SessionCard'
import { Settings } from './Settings'
import { TopBar } from './TopBar'

vi.mock('../state/provider', () => ({
  useApplicationState: () => ({
    state: {
      projection: {
        hosts: {},
        sessions: {},
        windows: {},
        panes: {},
        tool_events: {},
        activity: {},
        health: {},
      },
      connection: 'ready',
    },
    sessions: [],
    freeSessions: [],
    hosts: [{ id: 'h1', name: 'Serveur', online: true }],
    toolEvents: [],
    activity: new Map(),
    rehydrate: vi.fn(),
  }),
}))

const pwaInstall: PWAInstallState = {
  canPrompt: false,
  isStandalone: false,
  isAppleMobile: false,
  outcome: 'idle',
  install: vi.fn(),
}

const sampleSession = (overrides: Partial<Session> = {}): Session => ({
  id: '$1',
  name: 'alice-dev',
  host: 'h1',
  host_name: 'Serveur',
  host_online: true,
  owner: '0123456789abcdef0123456789abcdef',
  windows: [{ id: '@1', session_id: '$1', name: 'main', index: 0, active: true, layout: '', panes: [] }],
  created: '2026-01-15T10:00:00Z',
  attached: false,
  last_activity: '2026-01-15T10:05:00Z',
  ...overrides,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Login en mode accounts', () => {
  it('affiche le formulaire nom d’utilisateur + mot de passe, un seul bouton et TopoBackground', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    const { container } = render(<Login mode="accounts" error={null} onSubmit={onSubmit} />)

    const userInput = screen.getByLabelText('Nom d’utilisateur')
    const passInput = screen.getByLabelText('Mot de passe')
    expect(userInput).toHaveAttribute('autocomplete', 'username')
    expect(passInput).toHaveAttribute('autocomplete', 'current-password')
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy()

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('Se connecter')

    fireEvent.change(userInput, { target: { value: 'alice' } })
    fireEvent.change(passInput, { target: { value: 'motdepasse123' } })
    fireEvent.click(buttons[0])

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('alice', 'motdepasse123')
    })
  })

  it('affiche l’erreur générique ou l’explication 429', () => {
    const { rerender } = render(
      <Login mode="accounts" error="Nom d’utilisateur ou mot de passe incorrect." onSubmit={vi.fn()} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Nom d’utilisateur ou mot de passe incorrect.')

    rerender(
      <Login
        mode="accounts"
        error="Trop de tentatives de connexion. Réessayez dans quelques instants."
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Trop de tentatives de connexion. Réessayez dans quelques instants.',
    )
  })
})

describe('Résolution du nom du propriétaire et badges', () => {
  it('ne retourne jamais un identifiant hexadécimal brut', () => {
    const hexId = '0123456789abcdef0123456789abcdef'
    expect(resolveOwnerName(hexId)).toBeNull()
    expect(resolveOwnerName(hexId, { usersById: { [hexId]: 'alice' } })).toBe('alice')
  })

  it('affiche le badge propriétaire sur SessionCard uniquement quand le nom est résolu', () => {
    const { rerender } = render(
      <SessionCard
        session={sampleSession({ owner: '0123456789abcdef0123456789abcdef' })}
        events={[]}
        sparklines={false}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('session-owner-badge')).not.toBeInTheDocument()
    expect(screen.queryByText('0123456789abcdef0123456789abcdef')).not.toBeInTheDocument()

    rerender(
      <SessionCard
        session={sampleSession()}
        ownerName="alice"
        events={[]}
        sparklines={false}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByTestId('session-owner-badge')).toHaveTextContent('alice')
  })
})

describe('Tableau de bord /admin', () => {
  const adminUsers = [
    {
      id: 'aaaaaaaa11111111aaaaaaaa11111111',
      username: 'admin',
      role: 'admin' as const,
      disabled: false,
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'bbbbbbbb22222222bbbbbbbb22222222',
      username: 'alice',
      role: 'user' as const,
      disabled: false,
      created_at: '2026-01-02T00:00:00Z',
    },
  ]
  const adminSessions = [
    {
      id: '$1',
      name: 'alice-work',
      host: 'h1',
      host_name: 'Serveur',
      owner: 'bbbbbbbb22222222bbbbbbbb22222222',
    },
  ]

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method || 'GET'
        if (url.endsWith('/api/admin/users') && method === 'GET') {
          return new Response(JSON.stringify({ users: adminUsers }), { status: 200 })
        }
        if (url.endsWith('/api/admin/sessions') && method === 'GET') {
          return new Response(JSON.stringify(adminSessions), { status: 200 })
        }
        if (url.endsWith('/api/admin/users') && method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 'cccccccc33333333cccccccc33333333',
              username: 'bob',
              role: 'user',
              disabled: false,
              created_at: '2026-01-03T00:00:00Z',
            }),
            { status: 201 },
          )
        }
        if (url.includes('/api/admin/users/') && method === 'PATCH') {
          return new Response(JSON.stringify(adminUsers[1]), { status: 200 })
        }
        if (url.includes('/api/admin/users/') && method === 'DELETE') {
          return new Response(null, { status: 204 })
        }
        if (url.endsWith('/api/session/claim') || url.endsWith('/api/session/release')) {
          return new Response(JSON.stringify({ request_id: 'r1', result: {} }), { status: 200 })
        }
        return new Response(null, { status: 404 })
      }),
    )
  })

  it('affiche le rappel permanent, crée un compte avec validation et cite les sessions libérées à la suppression', async () => {
    render(<AdminPage currentUsername="admin" />)

    expect(
      screen.getByText(
        'Tous les comptes partagent le même utilisateur système du serveur. Un terminal donne ses droits.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/10 à 200 caractères/)).toBeInTheDocument()

    await screen.findByTestId('admin-user-row-alice')
    expect(screen.getByTestId('admin-session-owner-badge')).toHaveTextContent('alice')

    // Validation de longueur et confirmation
    fireEvent.change(screen.getByLabelText('Nom d’utilisateur'), { target: { value: 'bob' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'court' } })
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'court' } })
    fireEvent.click(screen.getByRole('button', { name: 'Créer le compte' }))
    expect(screen.getByRole('alert')).toHaveTextContent('entre 10 et 200 caractères')

    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'motdepassevalide1' } })
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'motdepassevalide2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Créer le compte' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Les mots de passe ne correspondent pas.')

    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'motdepassevalide1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Créer le compte' }))
    expect(await screen.findByText('Compte « bob » créé.')).toBeInTheDocument()

    // Suppression de alice : le Dialog cite la session libérée alice-work
    const aliceRow = screen.getByTestId('admin-user-row-alice')
    fireEvent.click(within(aliceRow).getByRole('button', { name: 'Supprimer' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('alice-work')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmer la suppression' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })
})

describe('Vue non-admin : claim, release, erreur 409 et absence de routes interdites', () => {
  it('n’appelle pas /api/stats pour un non-admin et affiche toutes ses sessions', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <Overview
        role="user"
        currentUsername="alice"
        sessions={[sampleSession({ name: 'ma-session' })]}
        hosts={[{ id: 'h1', name: 'Serveur', online: true, sessions: [], last_seen: '' }]}
        onSessionSelect={vi.fn()}
        getSessionEvents={() => []}
        getSessionActivity={() => undefined}
        pendingAlerts={[]}
        onJumpToSession={vi.fn()}
        onDismissAlert={vi.fn()}
        onOpenMonitoring={vi.fn()}
      />,
    )

    expect(fetchMock).not.toHaveBeenCalledWith('/api/stats', expect.anything())
    expect(screen.queryByText(/CPU/)).not.toBeInTheDocument()
    expect(screen.getByText('ma-session')).toBeInTheDocument()
  })

  it('masque Monitoring et Administration pour un utilisateur non-admin et réduit les Réglages', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <>
        <TopBar
          currentView="overview"
          sidebarCollapsed={false}
          role="user"
          authMode="accounts"
          onToggleCollapse={vi.fn()}
          onOverview={vi.fn()}
          onMonitoring={vi.fn()}
          onWall={vi.fn()}
          onAdmin={vi.fn()}
          onOpenPalette={vi.fn()}
          onSettings={vi.fn()}
          onLogout={vi.fn()}
          events={[]}
          onJumpToSession={vi.fn()}
          onDismiss={vi.fn()}
          onDismissAll={vi.fn()}
        />
        <MobileNav
          currentView="overview"
          attentionCount={0}
          role="user"
          onOverview={vi.fn()}
          onSessions={vi.fn()}
          onMonitoring={vi.fn()}
          onSettings={vi.fn()}
        />
        <PreferencesContext.Provider
          value={{
            prefs: defaultPreferences,
            updatePrefs: vi.fn().mockResolvedValue(undefined),
            loaded: true,
            refetch: vi.fn().mockResolvedValue(undefined),
            saveState: 'idle',
            saveError: null,
            retrySave: vi.fn().mockResolvedValue(undefined),
            isLocalOnly: true,
          }}
        >
          <Settings
            pushState="unsupported"
            onPushSubscribe={vi.fn()}
            onPushUnsubscribe={vi.fn()}
            authMode="accounts"
            role="user"
            pwaInstall={pwaInstall}
          />
        </PreferencesContext.Provider>
      </>,
    )

    expect(screen.queryByRole('button', { name: 'Monitoring' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Administration' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument()
    expect(screen.getByText('Changer le mot de passe')).toBeInTheDocument()
    expect(
      screen.getByText('Les préférences d’affichage sont enregistrées localement sur cet appareil.'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/agent-status')
  })
})
