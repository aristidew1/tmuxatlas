import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceViewModel } from '../workspace/model'
import { WallView } from './WallView'

vi.mock('./Terminal', () => ({
  Terminal: ({ sessionName, embedded }: { sessionName: string; embedded: boolean }) => (
    <div data-testid="terminal">
      {sessionName} {String(embedded)}
    </div>
  ),
}))
vi.mock('../lib/hostLabel', () => ({ useHostLabel: () => (_id: string, fallback: string) => fallback }))
const session = (name: string, status: 'idle' | 'waiting') => ({
  key: `host/${name}`,
  hostId: 'host',
  hostName: 'Machine',
  name,
  status,
  lastActivity: null,
  agents: [],
  searchText: '',
  source: {} as never,
})
const sessions = [session('une', 'idle'), session('deux', 'waiting'), session('trois', 'idle')]
const workspace: WorkspaceViewModel = { sessions, hosts: [], byTarget: new Map(sessions.map(item => [item.key, item])) }
describe('Mur', () => {
  afterEach(cleanup)
  beforeEach(() => localStorage.clear())
  it('propose les sessions à traiter et ouvre une session', () => {
    const open = vi.fn()
    render(<WallView workspace={workspace} onOpenSession={open} />)
    expect(screen.getAllByTestId('terminal').map(node => node.textContent)).toEqual(['deux true', 'une true'])
    fireEvent.click(screen.getAllByRole('button', { name: 'Agrandir' })[0])
    expect(open).toHaveBeenCalledWith('host/deux')
  })
  it('affiche le nom dans le sélecteur sans répéter l’hôte unique', () => {
    render(<WallView workspace={workspace} onOpenSession={vi.fn()} />)
    const selected = screen.getAllByRole('combobox')[0] as HTMLSelectElement
    expect(selected.selectedOptions[0]).toHaveTextContent('deux')
    expect(selected.selectedOptions[0]).not.toHaveTextContent('Machine')
  })
  it('persiste les choix et retire les sessions disparues', () => {
    const view = render(<WallView workspace={workspace} onOpenSession={vi.fn()} />)
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'host/trois' } })
    expect(localStorage.getItem('tmuxatlas:wall-targets:v1')).toContain('host/trois')
    view.rerender(
      <WallView workspace={{ ...workspace, byTarget: new Map([['host/une', sessions[0]]]) }} onOpenSession={vi.fn()} />,
    )
    expect(screen.queryByText('trois true')).not.toBeInTheDocument()
  })
})
