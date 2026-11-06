import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewSessionModal } from './NewSessionModal'
import type { Host } from '../hooks/useHosts'
import { fetchProjectDirectories } from '../lib/sessionApi'

vi.mock('../lib/sessionApi', () => ({ fetchProjectDirectories: vi.fn() }))
const hosts: Host[] = [
  { id: 'a', name: 'Local', online: true, local: true, sessions: [], last_seen: '' },
  { id: 'b', name: 'Distant', online: true, sessions: [], last_seen: '' },
]
beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
})
afterEach(cleanup)
describe('Nouvelle session', () => {
  it('choisit un dossier, assainit le nom, mémorise les options et crée avec Entrée', async () => {
    vi.mocked(fetchProjectDirectories).mockResolvedValue([{ name: 'mon.projet:v2', path: '/projets/mon.projet:v2' }])
    const create = vi.fn()
    const { unmount } = render(<NewSessionModal hosts={hosts} onCreateSession={create} onClose={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /mon.projet:v2/ }))
    expect(screen.getByLabelText('Nom de la session')).toHaveValue('mon-projet-v2')
    await userEvent.click(screen.getByRole('button', { name: 'Codex' }))
    fireEvent.keyDown(screen.getByLabelText('Nom de la session'), { key: 'Enter' })
    expect(create).toHaveBeenCalledWith('mon-projet-v2', 'a', { cwd: '/projets/mon.projet:v2', agent: 'codex' })
    unmount()
    render(<NewSessionModal hosts={hosts} onCreateSession={create} onClose={vi.fn()} />)
    expect(screen.getByLabelText('Dossier')).toHaveValue('/projets/mon.projet:v2')
    expect(screen.getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('annule la recherche lors du changement d’hôte et accepte un dossier libre si indisponible', async () => {
    let signal: AbortSignal | undefined
    vi.mocked(fetchProjectDirectories).mockImplementation((id, abort) => {
      if (id === 'a') {
        signal = abort
        return new Promise(() => {})
      }
      return Promise.reject(new Error('501'))
    })
    const create = vi.fn()
    render(<NewSessionModal hosts={hosts} onCreateSession={create} onClose={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText('Hôte'), 'b')
    await waitFor(() => expect(signal?.aborted).toBe(true))
    await userEvent.type(screen.getByLabelText('Nom de la session'), 'travail')
    await userEvent.type(screen.getByLabelText('Dossier'), '/tmp/libre')
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }))
    expect(create).toHaveBeenCalledWith('travail', 'b', { cwd: '/tmp/libre' })
  })
})
