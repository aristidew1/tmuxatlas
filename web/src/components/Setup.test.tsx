import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Setup } from './Setup'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Setup', () => {
  it('renders the Hub setup state when the legacy endpoint returns an empty object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    render(<Setup onComplete={vi.fn()} />)

    expect(
      await screen.findByText(
        'Ce Hub ne nécessite pas de configuration locale. Installez et associez un agent sur chaque hôte tmux.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suivant' })).toBeInTheDocument()
  })
})
