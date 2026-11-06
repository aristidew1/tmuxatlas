import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingTerminalPaste } from '../hooks/useTerminal'
import { terminalTargetKey } from '../lib/terminalInput'
import { Terminal, type TerminalCommandActions } from './Terminal'

const terminal = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  fit: vi.fn(),
  focus: vi.fn(),
  ptyState: 'connected' as const,
  termConnected: true,
  hasSelection: true,
  isAtBottom: true,
  hasNewOutput: false,
  scrollToBottom: vi.fn(),
  adjustFontSize: vi.fn(),
  sendInput: vi.fn(() => true),
  sendRawInput: vi.fn(() => true),
  sendCommand: vi.fn(() => true),
  captureConnection: vi.fn(),
  copySelection: vi.fn<() => Promise<boolean>>(),
  prepareClipboardPaste: vi.fn(),
  commitClipboardPaste: vi.fn(() => true),
  pasteClipboard: vi.fn<() => Promise<PendingTerminalPaste | null>>(),
  selectAll: vi.fn(),
  searchState: {
    loading: false,
    loaded: false,
    error: '',
    resultIndex: -1,
    resultCount: 0,
  },
  ensureSearchAddon: vi.fn<() => Promise<unknown>>(),
  findNext: vi.fn<() => Promise<boolean>>(),
  findPrevious: vi.fn<() => Promise<boolean>>(),
  clearSearch: vi.fn(),
  setVoiceHold: vi.fn<(on: boolean) => boolean>(),
  readScreen: vi.fn<() => string[]>(() => []),
}

const mic = {
  available: false,
  state: 'off' as 'off' | 'starting' | 'on',
  error: '',
  toggle: vi.fn(),
}
const useMicStream = vi.fn((_allowed: boolean) => mic)

vi.mock('../hooks/useMicStream', () => ({
  useMicStream: (allowed: boolean) => useMicStream(allowed),
}))

vi.mock('../hooks/useTerminal', () => ({
  useTerminal: () => terminal,
}))

describe('Terminal workspace controls', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue('clipboard'),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    vi.clearAllMocks()
    terminal.copySelection.mockResolvedValue(true)
    terminal.pasteClipboard.mockResolvedValue(null)
    terminal.ensureSearchAddon.mockResolvedValue(undefined)
    terminal.findNext.mockResolvedValue(true)
    terminal.findPrevious.mockResolvedValue(true)
    terminal.sendCommand.mockReturnValue(true)
    terminal.searchState.loaded = false
  })

  it('does not focus or enable the microphone in an embedded tile', () => {
    render(<Terminal sessionName="one" hostId="host-a" hostLocal embedded />)
    expect(useMicStream).toHaveBeenCalledWith(false)
    expect(terminal.focus).not.toHaveBeenCalled()
    expect(screen.queryByRole('toolbar', { name: 'Touches du terminal' })).not.toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-terminal-surface]')!)
    expect(terminal.focus).toHaveBeenCalledTimes(1)
  })

  it('affiche les alertes des fenêtres et permet de les sélectionner', () => {
    const select = vi.fn()
    const windows = [
      { id: 'a', session_id: 's', layout: '', index: 0, name: 'éditeur', active: true, panes: [] },
      { id: 'b', session_id: 's', layout: '', index: 1, name: 'serveur', active: false, panes: [] },
    ] as NonNullable<React.ComponentProps<typeof Terminal>['windows']>
    render(
      <Terminal
        sessionName="une"
        hostId="h"
        windows={windows}
        windowAttention={{ 1: 'waiting' }}
        onSelectWindow={select}
      />,
    )
    const tab = screen.getByRole('tab', { name: /serveur.*En attente/i })
    fireEvent.click(tab)
    expect(select).toHaveBeenCalledWith(1)
  })

  it('désactive la copie dans le panneau mobile et ferme après une action', () => {
    terminal.hasSelection = false
    render(<Terminal sessionName="une" hostId="h" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Plus' })[1])
    const panel = screen.getByRole('dialog', { name: 'Actions du terminal' })
    expect(within(panel).getByRole('button', { name: 'Copier' })).toBeDisabled()
    fireEvent.click(within(panel).getByRole('button', { name: 'Rechercher' }))
    expect(screen.queryByRole('dialog', { name: 'Actions du terminal' })).not.toBeInTheDocument()
    terminal.hasSelection = true
  })

  it('sends special keys and resets locked modifiers after target change', () => {
    const view = render(<Terminal sessionName="one" hostId="host-a" hostName="host-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Flèche haut' }))
    expect(terminal.sendInput).toHaveBeenCalledWith('\x1b[A')

    fireEvent.click(screen.getByRole('button', { name: /Modificateur ctrl/ }))
    fireEvent.click(screen.getByRole('button', { name: /Modificateur ctrl/ }))
    expect(screen.getByRole('button', { name: /Modificateur ctrl/ })).toHaveAttribute('aria-pressed', 'true')

    view.rerender(<Terminal sessionName="two" hostId="host-b" hostName="host-b" />)
    expect(screen.getByRole('button', { name: /Modificateur ctrl/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports Clipboard failures and confirms multi-line paste', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
    terminal.pasteClipboard.mockRejectedValueOnce(new Error('Clipboard permission denied.'))
    render(<Terminal sessionName="one" hostId="host-a" hostName="host-a" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Coller' })[0])
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Clipboard permission denied.'))

    terminal.pasteClipboard.mockResolvedValueOnce({
      targetKey: terminalTargetKey('host-a', 'one'),
      generation: 4,
      text: 'one\ntwo',
      multiline: true,
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Coller' })[0])
    const confirmation = await screen.findByRole('alertdialog')
    expect(confirmation).toHaveTextContent('Coller plusieurs lignes')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Coller dans le terminal' }))
    expect(terminal.commitClipboardPaste).toHaveBeenCalledWith(expect.objectContaining({ text: 'one\ntwo' }))
  })

  it('exposes a single 44px mobile toolbar', () => {
    render(<Terminal sessionName="one" hostId="host-a" />)
    const toolbar = screen.getByRole('toolbar', { name: 'Touches du terminal' })
    expect(toolbar.className).toContain('h-11')
    expect(screen.getByRole('button', { name: 'Composer un message' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens Search lazily and restores command actions on cleanup', async () => {
    terminal.searchState.loaded = true
    const onActions = vi.fn<(actions: TerminalCommandActions | null) => void>()
    const view = render(
      <Terminal sessionName="one" hostId="host-a" hostName="host-a" onCommandActionsChange={onActions} />,
    )
    const actions = onActions.mock.calls.find(([value]) => value)?.[0]
    expect(actions).toBeTruthy()
    act(() => actions?.openSearch())
    expect(await screen.findByRole('search', { name: 'Rechercher dans le terminal' })).toBeVisible()
    expect(terminal.ensureSearchAddon).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Texte recherché' }), {
      target: { value: 'needle' },
    })
    await waitFor(() => expect(terminal.findNext).toHaveBeenCalledWith('needle', false))
    fireEvent.click(screen.getByRole('button', { name: 'Fermer la recherche' }))
    expect(terminal.clearSearch).toHaveBeenCalled()
    expect(terminal.focus).toHaveBeenCalled()
    view.unmount()
    expect(onActions).toHaveBeenLastCalledWith(null)
  })

  it('offers selection-aware Terminal context actions', () => {
    render(<Terminal sessionName="one" hostId="host-a" hostName="host-a" />)
    fireEvent.contextMenu(document.querySelector('[data-terminal-surface]')!)
    const menu = screen.getByRole('menu', { name: 'Actions du terminal' })
    expect(menu).toBeVisible()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tout sélectionner' }))
    expect(terminal.selectAll).toHaveBeenCalled()
  })

  it('keeps Composer drafts isolated for same-name Sessions on different Hosts', () => {
    const view = render(<Terminal sessionName="work" hostId="host-a" hostName="host-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Composer un message' }))
    const firstDraft = screen.getByRole('textbox', { name: /Hôte\/work/ })
    fireEvent.change(firstDraft, { target: { value: 'draft for A' } })

    view.rerender(<Terminal sessionName="work" hostId="host-b" hostName="host-b" />)
    fireEvent.click(screen.getByRole('button', { name: 'Composer un message' }))
    expect(screen.getByRole('textbox', { name: /Hôte\/work/ })).toHaveValue('')

    view.rerender(<Terminal sessionName="work" hostId="host-a" hostName="host-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Composer un message' }))
    expect(screen.getByRole('textbox', { name: /Hôte\/work/ })).toHaveValue('draft for A')
  })

  it('preserves Composer drafts when the Terminal workspace remounts', () => {
    const drafts = new Map<string, string>()
    const terminalDrafts = {
      getDraft: (targetKey: string) => drafts.get(targetKey) ?? '',
      setDraft: (targetKey: string, value: string) => {
        if (value) drafts.set(targetKey, value)
        else drafts.delete(targetKey)
      },
      clearDraft: (targetKey: string) => drafts.delete(targetKey),
    }
    const firstView = render(
      <Terminal sessionName="work" hostId="host-a" hostName="host-a" terminalDrafts={terminalDrafts} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Composer un message' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Hôte\/work/ }), {
      target: { value: 'survives remount' },
    })
    firstView.unmount()

    render(<Terminal sessionName="work" hostId="host-a" hostName="host-a" terminalDrafts={terminalDrafts} />)
    fireEvent.click(screen.getByRole('button', { name: 'Composer un message' }))
    expect(screen.getByRole('textbox', { name: /Hôte\/work/ })).toHaveValue('survives remount')
  })

  it('sends the complete Composer value and only clears after success', async () => {
    render(<Terminal sessionName="work" hostId="host-a" hostName="host-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Composer un message' }))
    const draft = screen.getByRole('textbox', { name: /Hôte\/work/ })
    fireEvent.change(draft, { target: { value: ' 你好 "$HOME"\nnext ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la commande à Hôte/work' }))
    await waitFor(() => expect(terminal.sendCommand).toHaveBeenCalledWith(' 你好 "$HOME"\nnext '))
    expect(draft).toHaveValue('')

    terminal.sendCommand.mockImplementationOnce(() => {
      throw new Error('Terminal target changed.')
    })
    fireEvent.change(draft, { target: { value: 'keep me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la commande à Hôte/work' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Terminal target changed.')
    expect(draft).toHaveValue('keep me')
  })

  it('does not submit Ctrl+Enter while IME composition is active', () => {
    render(<Terminal sessionName="work" hostId="host-a" hostName="host-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Composer un message' }))
    const draft = screen.getByRole('textbox', { name: /Hôte\/work/ })
    fireEvent.change(draft, { target: { value: '中文' } })
    fireEvent.compositionStart(draft)
    fireEvent.keyDown(draft, { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(terminal.sendCommand).not.toHaveBeenCalled()
    fireEvent.compositionEnd(draft)
    fireEvent.keyDown(draft, { key: 'Enter', ctrlKey: true })
    expect(terminal.sendCommand).toHaveBeenCalledWith('中文')
  })
})

describe('Terminal microphone', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    ),
  )
  beforeEach(() => {
    mic.available = false
    mic.state = 'off'
    mic.error = ''
    mic.toggle.mockClear()
    terminal.focus.mockClear()
    useMicStream.mockClear()
  })

  afterEach(cleanup)

  it('hides the button when voice is unavailable', () => {
    render(<Terminal sessionName="s" hostId="h" />)
    expect(useMicStream).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('button', { name: /microphone/i })).toBeNull()
  })

  it('only allows the microphone for sessions on the local host', () => {
    render(<Terminal sessionName="s" hostId="h" hostLocal />)
    expect(useMicStream).toHaveBeenCalledWith(true)
  })

  it('turns the microphone off and shows it is live, including in Zen Mode', () => {
    mic.available = true
    mic.state = 'on'
    const { rerender } = render(<Terminal sessionName="s" hostId="h" hostLocal />)
    fireEvent.click(screen.getByRole('button', { name: 'Désactiver le micro' }))
    expect(mic.toggle).toHaveBeenCalledTimes(1)
    rerender(<Terminal sessionName="s" hostId="h" hostLocal zenMode onToggleZen={() => {}} />)
    expect(screen.getByRole('button', { name: 'Désactiver le micro' }).textContent).toContain('Micro activé')
  })

  it('shows microphone errors', () => {
    mic.available = true
    mic.error = 'Microphone access was denied in this browser.'
    render(<Terminal sessionName="s" hostId="h" hostLocal />)
    expect(screen.getByRole('alert').textContent).toContain('denied')
  })
})

describe('Claude talk button', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    ),
  )
  const talk = () => screen.getByRole('button', { name: 'Talk : parler à Claude' })
  const stop = () => screen.getByRole('button', { name: 'Arrêter la dictée et modifier le texte' })
  const send = () => screen.getByRole('button', { name: 'Arrêter la dictée et envoyer le texte' })

  let slot: HTMLElement

  beforeEach(() => {
    slot = document.body.appendChild(document.createElement('div'))
    mic.available = true
    mic.state = 'on'
    mic.error = ''
    terminal.setVoiceHold.mockReset().mockReturnValue(true)
  })
  afterEach(() => {
    cleanup()
    slot.remove()
  })

  it('renders in the status bar slot rather than the Terminal toolbar', () => {
    render(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    expect(slot).toContainElement(talk())
    expect(document.querySelector('.terminal-cockpit')).not.toContainElement(talk())
  })

  it('shows Stop and Send while holding, and Stop leaves the transcript in the prompt', () => {
    render(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    terminal.focus.mockClear()
    terminal.sendRawInput.mockClear()
    fireEvent.click(talk())
    expect(terminal.setVoiceHold).toHaveBeenCalledTimes(1)
    expect(terminal.setVoiceHold).toHaveBeenLastCalledWith(true)
    expect(terminal.focus).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Talk : parler à Claude' })).toBeNull()
    expect(slot).toContainElement(send())
    fireEvent.click(stop())
    expect(terminal.setVoiceHold).toHaveBeenCalledTimes(2)
    expect(terminal.setVoiceHold).toHaveBeenLastCalledWith(false)
    expect(talk()).toBeEnabled()
    expect(terminal.sendRawInput).not.toHaveBeenCalled()
  })

  describe('Send', () => {
    const footer = (text: string) => terminal.readScreen.mockReturnValue(['> hello', `  auto mode on   ${text}`])
    const advance = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms)
      })
    const startListening = () => {
      render(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive />)
      fireEvent.click(talk())
      footer('listening…')
      advance(200)
    }

    beforeEach(() => {
      vi.useFakeTimers()
      terminal.sendRawInput.mockClear()
      terminal.readScreen.mockReset().mockReturnValue([])
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('presses Enter only once Claude has finished the transcript', () => {
      startListening()
      fireEvent.click(send())
      expect(terminal.setVoiceHold).toHaveBeenLastCalledWith(false)
      expect(send()).toBeDisabled()
      advance(1_000)
      footer('Voice: processing…')
      advance(5_000)
      expect(terminal.sendRawInput).not.toHaveBeenCalled()
      footer('')
      advance(1_000)
      expect(terminal.sendRawInput).toHaveBeenCalledTimes(1)
      expect(terminal.sendRawInput).toHaveBeenCalledWith(new Uint8Array([13]))
      expect(talk()).toBeEnabled()
    })

    it.each([
      ['Claude reports a failure', 'No speech detected.', 'n’a pas pu transcrire'],
      ['transcription never ends', 'Voice: processing…', 'n’a pas terminé'],
    ])('sends nothing when %s', (_name, text, message) => {
      startListening()
      fireEvent.click(send())
      footer(text)
      advance(31_000)
      expect(terminal.sendRawInput).not.toHaveBeenCalled()
      expect(screen.getByRole('alert').textContent).toContain(message)
    })

    it('sends nothing when Claude never listened, as in a Claude dialog', () => {
      render(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive />)
      fireEvent.click(talk())
      advance(500)
      fireEvent.click(send())
      advance(1_000)
      expect(terminal.sendRawInput).not.toHaveBeenCalled()
      expect(screen.getByRole('alert').textContent).toContain('n’écoutait pas')
    })

    it('ignores words on screen above the footer', () => {
      render(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive />)
      fireEvent.click(talk())
      terminal.readScreen.mockReturnValue(['listening…', ...Array.from({ length: 8 }, (_, row) => `output ${row}`)])
      advance(500)
      fireEvent.click(send())
      advance(1_000)
      expect(terminal.sendRawInput).not.toHaveBeenCalled()
    })
  })

  it('releases when the target changes, the microphone stops, or Zen Mode hides it', () => {
    const view = render(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    fireEvent.click(talk())
    view.rerender(<Terminal sessionName="other" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    expect(terminal.setVoiceHold).toHaveBeenLastCalledWith(false)
    expect(talk()).toBeEnabled()

    fireEvent.click(talk())
    mic.state = 'off'
    view.rerender(<Terminal sessionName="other" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    expect(terminal.setVoiceHold).toHaveBeenLastCalledWith(false)
    expect(talk()).toBeDisabled()

    mic.state = 'on'
    view.rerender(<Terminal sessionName="other" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    fireEvent.click(talk())
    view.rerender(
      <Terminal sessionName="other" hostId="h" hostLocal talkSlot={null} claudeActive zenMode onToggleZen={() => {}} />,
    )
    expect(terminal.setVoiceHold).toHaveBeenLastCalledWith(false)
  })

  it('is only active while Claude runs in the active pane, and releases when it exits', () => {
    const view = render(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} />)
    expect(talk()).toBeDisabled()
    view.rerender(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    fireEvent.click(talk())
    expect(terminal.setVoiceHold).toHaveBeenLastCalledWith(true)
    view.rerender(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} />)
    expect(terminal.setVoiceHold).toHaveBeenLastCalledWith(false)
    expect(talk()).toBeDisabled()
  })

  it('stays disabled until the microphone and Terminal are ready', () => {
    mic.state = 'off'
    const view = render(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    expect(talk()).toBeDisabled()
    mic.state = 'on'
    view.rerender(
      <Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive connectionState="reconnecting" />,
    )
    expect(talk()).toBeDisabled()
  })
})
