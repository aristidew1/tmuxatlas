import { useState, type ComponentProps } from 'react'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '../hooks/useHosts'
import type { Session } from '../hooks/useSessions'
import type { ToolEvent } from '../hooks/useToolEvents'
import { postRuntimeMutation } from '../lib/runtimeApi'
import { renderStrict } from '../test/render'
import { buildWorkspaceViewModel } from '../workspace/model'
import { Sidebar } from './Sidebar'

vi.mock('../lib/runtimeApi', () => ({ postRuntimeMutation: vi.fn() }))

function session(host: string, name = 'work'): Session {
  return {
    id: `${host}-${name}`,
    host,
    host_name: 'Duplicate Host',
    host_online: true,
    name,
    created: '',
    attached: false,
    last_activity: '2026-01-01T00:00:00Z',
    windows: [],
  }
}

const sessions = [session('host-a'), session('host-b')]
const hosts: Host[] = [
  { id: 'host-a', name: 'Duplicate Host', online: true, sessions: [], last_seen: '' },
  { id: 'host-b', name: 'Duplicate Host', online: true, sessions: [], last_seen: '' },
]
const events: ToolEvent[] = [
  { host: 'host-a', session: 'work', tool: 'codex', status: 'waiting', window: 0, timestamp: '2026-01-02T00:00:00Z' },
  { host: 'host-b', session: 'work', tool: 'claude', status: 'error', window: 0, timestamp: '2026-01-03T00:00:00Z' },
]
const workspace = buildWorkspaceViewModel(sessions, events, new Map(), hosts)

function renderSidebar(overrides: Partial<ComponentProps<typeof Sidebar>> = {}) {
  const props: ComponentProps<typeof Sidebar> = {
    workspace,
    selectedSession: 'host-a/work',
    collapsed: false,
    collapseMode: 'small',
    recentTargets: [],
    onSessionSelect: vi.fn(),
    onDetachSession: vi.fn(),
    ...overrides,
  }
  const view = renderStrict(<Sidebar {...props} />)
  return { props, ...view }
}

describe('state-driven Sidebar', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('porte le bouton pour replier et déplier, sauf quand elle est masquée', () => {
    const onToggleCollapse = vi.fn()
    const { props, rerender } = renderSidebar({ onToggleCollapse })
    fireEvent.click(screen.getByRole('button', { name: 'Replier la barre latérale' }))
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)

    rerender(<Sidebar {...props} collapsed />)
    fireEvent.click(screen.getByRole('button', { name: 'Déplier la barre latérale' }))
    expect(onToggleCollapse).toHaveBeenCalledTimes(2)

    rerender(<Sidebar {...props} collapsed collapseMode="hidden" />)
    expect(screen.queryByRole('button', { name: 'Déplier la barre latérale' })).not.toBeInTheDocument()
  })

  it('keeps same-name Sessions on different stable Hosts as separate entries', () => {
    renderSidebar()
    const sessionButtons = screen.getAllByRole('button', { name: /Ouvrir la session work sur Duplicate Host/ })
    expect(sessionButtons).toHaveLength(2)
    expect(screen.getByRole('button', { name: /session work sur Duplicate Host, En attente/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /session work sur Duplicate Host, Erreur/ })).toBeInTheDocument()
  })

  it('distingue erreur et attente et anime seulement un changement de statut', () => {
    const { props, rerender } = renderSidebar({ selectedSession: null })
    const waiting = screen.getByRole('button', { name: /En attente/ })
    const error = screen.getByRole('button', { name: /Erreur/ })
    expect(waiting.parentElement).toHaveClass('border-warning')
    expect(error.parentElement).toHaveClass('border-destructive')
    expect(waiting.querySelector('.atlas-flash')).toBeNull()
    const changed = buildWorkspaceViewModel(sessions, [{ ...events[0], status: 'error' }, events[1]], new Map(), hosts)
    rerender(<Sidebar {...props} workspace={changed} />)
    expect(screen.getAllByRole('button', { name: /Erreur/ })[0].querySelector('.atlas-flash')).toBeInTheDocument()
  })

  it('supports text/status filters and offers no pin action', async () => {
    renderSidebar()
    await userEvent.type(screen.getByLabelText('Rechercher des sessions'), 'codex')
    expect(screen.getAllByRole('button', { name: /Ouvrir la session work sur Duplicate Host/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /pingler/ })).not.toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Rechercher des sessions'))
    await userEvent.click(screen.getByRole('button', { name: /À traiter/ }))
    expect(screen.getAllByRole('button', { name: /Ouvrir la session work sur Duplicate Host/ })).toHaveLength(2)
    expect(screen.getByText('claude')).toBeInTheDocument()
  })

  it('affiche les filtres utiles sur une rangée et conserve le filtre actif à zéro', async () => {
    const { props, rerender } = renderSidebar()
    expect(screen.getByPlaceholderText('Filtrer les sessions…')).toBeInTheDocument()
    const filters = screen.getByLabelText('Filtrer les sessions')
    expect(filters).toHaveClass('flex-nowrap', 'overflow-x-auto', 'scrollbar-none')
    expect(within(filters).queryByRole('button', { name: /En cours/ })).not.toBeInTheDocument()
    await userEvent.click(within(filters).getByRole('button', { name: /À traiter/ }))
    const calmWorkspace = buildWorkspaceViewModel(sessions, [], new Map(), hosts)
    rerender(<Sidebar {...props} workspace={calmWorkspace} />)
    expect(within(filters).getByRole('button', { name: /À traiter 0/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('évite de répéter l’activité récente tout en gardant le nom de l’agent', () => {
    const recent = buildWorkspaceViewModel(
      sessions,
      [{ ...events[0], timestamp: new Date().toISOString() }],
      new Map(),
      hosts,
    )
    renderSidebar({ workspace: recent })
    expect(screen.queryByText('Actif maintenant')).not.toBeInTheDocument()
    expect(screen.getByText('codex')).toBeInTheDocument()
  })

  it('groups every Session exactly once under its stable Host', () => {
    const calmWorkspace = buildWorkspaceViewModel(sessions, [], new Map(), hosts)
    renderSidebar({ workspace: calmWorkspace, recentTargets: ['host-b/work'] })
    expect(screen.queryByText(/Pinned ·/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Recent ·/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Replier les sessions de Duplicate Host' })[0]).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getAllByRole('button', { name: 'Replier les sessions de Duplicate Host' })[1]).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getAllByRole('button', { name: /Ouvrir la session work sur Duplicate Host/ })).toHaveLength(2)
  })

  it('keeps Session rows compact while showing up to two name lines', () => {
    const longName = 'hp-fix-installation-and-runtime-validation'
    const longWorkspace = buildWorkspaceViewModel([session('host-a', longName)], [], new Map(), hosts.slice(0, 1))
    renderSidebar({ workspace: longWorkspace, selectedSession: `host-a/${longName}` })

    const label = screen.getByText(longName)
    expect(label).toHaveClass('truncate')
    expect(label).toHaveAttribute('title', longName)
    const sessionButton = screen.getByRole('button', {
      name: `Ouvrir la session ${longName} sur Duplicate Host, Inactif`,
    })
    expect(sessionButton.parentElement).toHaveClass('min-h-11')
    expect(sessionButton.querySelector('[data-status=idle]')).toBeInTheDocument()
  })

  it('collapses Hosts independently and reopens the selected Host', async () => {
    const { props, rerender } = renderSidebar({ selectedSession: null })
    const hostA = screen.getByTitle('host-a')
    await userEvent.click(hostA)
    expect(screen.getByRole('button', { name: 'Déployer les sessions de Duplicate Host' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getAllByRole('button', { name: /Ouvrir la session work sur Duplicate Host/ })).toHaveLength(1)

    rerender(<Sidebar {...props} selectedSession="host-a/work" />)
    await waitFor(() => {
      expect(screen.getByTitle('host-a')).toHaveAttribute('aria-expanded', 'true')
    })
  })

  it('makes detach an explicit browser-only action without a runtime mutation', async () => {
    const detach = vi.fn()
    renderSidebar({ onDetachSession: detach })
    const first = screen.getByRole('button', { name: /Ouvrir la session work sur Duplicate Host, En attente/ })
    fireEvent.contextMenu(first, { clientX: 20, clientY: 20 })
    expect(screen.getByRole('menu')).toHaveAccessibleName(/Actions pour work/)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Détacher le navigateur (tmux continue)' }))
    expect(detach).toHaveBeenCalledWith('host-a/work')
    expect(postRuntimeMutation).not.toHaveBeenCalled()
  })

  it('capability-gates destructive kill and confirms the complete Host + Session target', async () => {
    const kill = vi.fn()
    const { unmount } = renderStrict(
      <Sidebar
        workspace={workspace}
        selectedSession="host-a/work"
        collapsed={false}
        collapseMode="small"
        recentTargets={[]}
        onSessionSelect={vi.fn()}
        onDetachSession={vi.fn()}
      />,
    )
    fireEvent.contextMenu(screen.getByRole('button', { name: /Ouvrir la session work sur Duplicate Host, En attente/ }))
    expect(screen.queryByRole('menuitem', { name: 'Supprimer la session…' })).not.toBeInTheDocument()
    expect(screen.getByText(/Cet hôte ne permet pas/)).toBeInTheDocument()
    unmount()

    renderSidebar({ canKillSession: true, onKillSession: kill })
    fireEvent.contextMenu(screen.getByRole('button', { name: /Ouvrir la session work sur Duplicate Host, En attente/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Supprimer la session…' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Supprimer définitivement la session tmux ?' })
    expect(dialog).toHaveTextContent('Duplicate Host')
    expect(within(dialog).getByTitle('host-a')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Session : work')
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer la session' }))
    expect(kill).toHaveBeenCalledWith('host-a/work')
  })

  it('garde le mode replié compact et développe le tiroir mobile', () => {
    const { unmount } = renderSidebar({ collapsed: true })
    expect(screen.queryByPlaceholderText('Filtrer les sessions…')).not.toBeInTheDocument()
    expect(screen.getAllByText('W')).toHaveLength(2)
    unmount()

    renderSidebar({ collapsed: true, mobileOpen: true, onMobileClose: vi.fn() })
    expect(screen.getByRole('dialog')).toContainElement(screen.getByPlaceholderText('Filtrer les sessions…'))
    expect(screen.getAllByText('work')).toHaveLength(2)
  })

  it('traps the mobile Drawer, makes background inert, closes on Escape and restores focus', async () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <div>
          <button type="button" autoFocus data-testid="drawer-trigger">
            Open sessions
          </button>
          <Sidebar
            workspace={workspace}
            selectedSession={null}
            collapsed={false}
            collapseMode="small"
            recentTargets={[]}
            onSessionSelect={vi.fn()}
            onDetachSession={vi.fn()}
            mobileOpen={open}
            onMobileClose={() => setOpen(false)}
          />
        </div>
      )
    }

    renderStrict(<Harness />)
    const trigger = screen.getByTestId('drawer-trigger')
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Sessions de l’espace de travail' })).toHaveFocus())
    expect(trigger).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('dialog', { name: 'Sessions de l’espace de travail' })).toBeInTheDocument()

    fireEvent.keyDown(screen.getByLabelText('Rechercher des sessions'), { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sessions de l’espace de travail' })).not.toBeInTheDocument(),
    )
    expect(trigger).not.toHaveAttribute('aria-hidden')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('closes the mobile Drawer when Escape arrives before focus enters it', async () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <div>
          <button type="button" data-testid="early-drawer-trigger">
            Open sessions
          </button>
          <Sidebar
            workspace={workspace}
            selectedSession={null}
            collapsed={false}
            collapseMode="small"
            recentTargets={[]}
            onSessionSelect={vi.fn()}
            onDetachSession={vi.fn()}
            mobileOpen={open}
            onMobileClose={() => setOpen(false)}
          />
        </div>
      )
    }

    renderStrict(<Harness />)
    fireEvent.keyDown(screen.getByTestId('early-drawer-trigger'), { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sessions de l’espace de travail' })).not.toBeInTheDocument(),
    )
  })
})
