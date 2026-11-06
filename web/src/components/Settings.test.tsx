import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreferencesContext, defaultPreferences, type Preferences } from '../hooks/usePreferences'
import type { PWAInstallState } from '../hooks/usePWAInstall'
import { Settings } from './Settings'

vi.mock('../state/provider', () => ({
  useApplicationState: () => ({ hosts: [{ id: 'h1', name: 'Serveur', online: true }] }),
}))

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const pwaInstall: PWAInstallState = {
  canPrompt: false,
  isStandalone: false,
  isAppleMobile: false,
  outcome: 'idle',
  install: vi.fn(),
}

function contextValue({
  prefs = defaultPreferences,
  retrySave = vi.fn().mockResolvedValue(undefined),
  saveError = null,
  saveState = 'idle',
}: {
  prefs?: Preferences
  retrySave?: ReturnType<typeof vi.fn>
  saveError?: string | null
  saveState?: SaveState
} = {}) {
  return {
    prefs,
    updatePrefs: vi.fn().mockResolvedValue(undefined),
    loaded: true,
    refetch: vi.fn().mockResolvedValue(undefined),
    saveState,
    saveError,
    retrySave,
  }
}

function settings(value: ReturnType<typeof contextValue>) {
  return (
    <PreferencesContext.Provider value={value}>
      <Settings pushState="unsupported" onPushSubscribe={vi.fn()} onPushUnsubscribe={vi.fn()} pwaInstall={pwaInstall} />
    </PreferencesContext.Provider>
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Settings preference save feedback', () => {
  it('renders Hub agent settings when the legacy endpoint returns an empty object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    render(settings(contextValue()))

    expect(
      await screen.findByText(
        'Ce Hub ne nécessite pas de configuration locale. Installez et associez un agent sur chaque hôte tmux.',
      ),
    ).toBeInTheDocument()
  })

  it('enregistre un alias d’hôte', () => {
    const value = contextValue()
    render(settings(value))
    fireEvent.change(screen.getByLabelText('Alias de Serveur'), { target: { value: 'Bureau' } })
    expect(value.updatePrefs).toHaveBeenCalledWith({ host_aliases: { h1: 'Bureau' } })
    expect(screen.getByLabelText('Alias de Serveur').closest('label')).toHaveAttribute('title', 'h1')
  })

  it('announces saving and saved states and shows a success toast', async () => {
    const { rerender } = render(settings(contextValue()))

    rerender(settings(contextValue({ saveState: 'saving' })))
    expect(screen.getByText('Enregistrement…')).toHaveAttribute('role', 'status')

    rerender(settings(contextValue({ saveState: 'saved' })))
    expect(screen.getByText('Enregistré')).toHaveAttribute('role', 'status')
    expect(await screen.findByText('Réglages enregistrés')).toBeInTheDocument()
    expect(screen.getByText('Vos préférences sont à jour.')).toBeInTheDocument()
  })

  it('keeps an explicit unsaved warning and retries the failed payload', async () => {
    const retrySave = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(settings(contextValue()))

    rerender(
      settings(
        contextValue({
          retrySave,
          saveError: 'Failed to save preferences (503).',
          saveState: 'error',
        }),
      ),
    )

    expect(screen.getByText('Les modifications n’ont pas été enregistrées.')).toBeInTheDocument()
    expect(screen.getAllByText(/Failed to save preferences \(503\)\./)).toHaveLength(2)
    expect(await screen.findByText('Réglages non enregistrés')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer d’enregistrer les préférences' }))
    await waitFor(() => expect(retrySave).toHaveBeenCalledTimes(1))

    rerender(settings(contextValue({ retrySave, saveState: 'saving' })))
    expect(screen.queryByText('Les modifications n’ont pas été enregistrées.')).not.toBeInTheDocument()
    expect(screen.queryByText('Réglages non enregistrés')).not.toBeInTheDocument()
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument()
  })
})
