import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthLoadingState, EmptyWorkspaceState, WorkspaceLoadingState } from './PageStates'

afterEach(cleanup)

describe('PageStates', () => {
  it('announces authentication loading once and keeps its decorative shape hidden', () => {
    render(<AuthLoadingState />)

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status', { name: 'Vérification de l’authentification' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Connexion à Atlas' })).toBeInTheDocument()
    expect(document.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
  })

  it('exposes a labelled workspace loading status without announcing every placeholder', () => {
    render(<WorkspaceLoadingState label="Restoring workspace state" />)

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status', { name: 'Restoring workspace state' })).toBeInTheDocument()
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('provides working New Session and Setup actions for a ready empty workspace', async () => {
    const user = userEvent.setup()
    const onNewSession = vi.fn()
    const onOpenSetup = vi.fn()

    render(<EmptyWorkspaceState onNewSession={onNewSession} onOpenSetup={onOpenSetup} />)

    expect(screen.getByRole('heading', { name: 'Aucune session pour le moment' })).toBeInTheDocument()
    expect(screen.getByText(/Créez une session/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Nouvelle session' }))
    await user.click(screen.getByRole('button', { name: 'Configuration' }))

    expect(onNewSession).toHaveBeenCalledTimes(1)
    expect(onOpenSetup).toHaveBeenCalledTimes(1)
  })
})
