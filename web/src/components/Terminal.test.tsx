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
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
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

  it('sends special keys and resets locked modifiers after target change', () => {
    const view = render(<Terminal sessionName="one" hostId="host-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Up arrow' }))
    expect(terminal.sendInput).toHaveBeenCalledWith('\x1b[A')

    fireEvent.click(screen.getByRole('button', { name: /Control modifier: off/ }))
    fireEvent.click(screen.getByRole('button', { name: /Control modifier: once/ }))
    expect(screen.getByRole('button', { name: /Control modifier: locked/ })).toHaveAttribute('aria-pressed', 'true')

    view.rerender(<Terminal sessionName="two" hostId="host-b" />)
    expect(screen.getByRole('button', { name: /Control modifier: off/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports Clipboard failures and confirms multi-line paste', async () => {
    terminal.pasteClipboard.mockRejectedValueOnce(new Error('Clipboard permission denied.'))
    render(<Terminal sessionName="one" hostId="host-a" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Paste into Terminal' })[0])
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Clipboard permission denied.'))

    terminal.pasteClipboard.mockResolvedValueOnce({
      targetKey: terminalTargetKey('host-a', 'one'),
      generation: 4,
      text: 'one\ntwo',
      multiline: true,
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Paste into Terminal' })[0])
    const confirmation = await screen.findByRole('alertdialog')
    expect(confirmation).toHaveTextContent('Paste multiple lines')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Paste into Terminal' }))
    expect(terminal.commitClipboardPaste).toHaveBeenCalledWith(expect.objectContaining({ text: 'one\ntwo' }))
  })

  it('exposes 44px touch controls and a collapsible toolbar', () => {
    render(<Terminal sessionName="one" hostId="host-a" />)
    const toggle = screen.getByRole('button', { name: 'Hide terminal keys' })
    expect(toggle.className).toContain('min-h-11')
    fireEvent.click(toggle)
    expect(screen.queryByRole('toolbar', { name: 'Terminal keys' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show terminal keys' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens Search lazily and restores command actions on cleanup', async () => {
    terminal.searchState.loaded = true
    const onActions = vi.fn<(actions: TerminalCommandActions | null) => void>()
    const view = render(
      <Terminal
        sessionName="one"
        hostId="host-a"
        onCommandActionsChange={onActions}
      />,
    )
    const actions = onActions.mock.calls.find(([value]) => value)?.[0]
    expect(actions).toBeTruthy()
    act(() => actions?.openSearch())
    expect(await screen.findByRole('search', { name: 'Search Terminal scrollback' })).toBeVisible()
    expect(terminal.ensureSearchAddon).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Terminal search query' }), {
      target: { value: 'needle' },
    })
    await waitFor(() => expect(terminal.findNext).toHaveBeenCalledWith('needle', false))
    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal search' }))
    expect(terminal.clearSearch).toHaveBeenCalled()
    expect(terminal.focus).toHaveBeenCalled()
    view.unmount()
    expect(onActions).toHaveBeenLastCalledWith(null)
  })

  it('offers selection-aware Terminal context actions', () => {
    render(<Terminal sessionName="one" hostId="host-a" />)
    fireEvent.contextMenu(document.querySelector('[data-terminal-surface]')!)
    const menu = screen.getByRole('menu', { name: 'Terminal actions' })
    expect(menu).toBeVisible()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select all' }))
    expect(terminal.selectAll).toHaveBeenCalled()
  })

  it('keeps Composer drafts isolated for same-name Sessions on different Hosts', () => {
    const view = render(<Terminal sessionName="work" hostId="host-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Mobile Input Composer' }))
    const firstDraft = screen.getByRole('textbox', { name: /host-a\/work/ })
    fireEvent.change(firstDraft, { target: { value: 'draft for A' } })

    view.rerender(<Terminal sessionName="work" hostId="host-b" />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Mobile Input Composer' }))
    expect(screen.getByRole('textbox', { name: /host-b\/work/ })).toHaveValue('')

    view.rerender(<Terminal sessionName="work" hostId="host-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Mobile Input Composer' }))
    expect(screen.getByRole('textbox', { name: /host-a\/work/ })).toHaveValue('draft for A')
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
      <Terminal sessionName="work" hostId="host-a" terminalDrafts={terminalDrafts} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Expand Mobile Input Composer' }))
    fireEvent.change(screen.getByRole('textbox', { name: /host-a\/work/ }), {
      target: { value: 'survives remount' },
    })
    firstView.unmount()

    render(<Terminal sessionName="work" hostId="host-a" terminalDrafts={terminalDrafts} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Mobile Input Composer' }))
    expect(screen.getByRole('textbox', { name: /host-a\/work/ })).toHaveValue('survives remount')
  })

  it('sends the complete Composer value and only clears after success', async () => {
    render(<Terminal sessionName="work" hostId="host-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Mobile Input Composer' }))
    const draft = screen.getByRole('textbox', { name: /host-a\/work/ })
    fireEvent.change(draft, { target: { value: ' 你好 "$HOME"\nnext ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send command to host-a/work' }))
    await waitFor(() => expect(terminal.sendCommand).toHaveBeenCalledWith(' 你好 "$HOME"\nnext '))
    expect(draft).toHaveValue('')

    terminal.sendCommand.mockImplementationOnce(() => {
      throw new Error('Terminal target changed.')
    })
    fireEvent.change(draft, { target: { value: 'keep me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send command to host-a/work' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Terminal target changed.')
    expect(draft).toHaveValue('keep me')
  })

  it('does not submit Ctrl+Enter while IME composition is active', () => {
    render(<Terminal sessionName="work" hostId="host-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Mobile Input Composer' }))
    const draft = screen.getByRole('textbox', { name: /host-a\/work/ })
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
    fireEvent.click(screen.getByRole('button', { name: 'Turn off microphone' }))
    expect(mic.toggle).toHaveBeenCalledTimes(1)
    rerender(<Terminal sessionName="s" hostId="h" hostLocal zenMode onToggleZen={() => {}} />)
    expect(screen.getByRole('button', { name: 'Turn off microphone' }).textContent).toContain('Mic on')
  })

  it('shows microphone errors', () => {
    mic.available = true
    mic.error = 'Microphone access was denied in this browser.'
    render(<Terminal sessionName="s" hostId="h" hostLocal />)
    expect(screen.getByRole('alert').textContent).toContain('denied')
  })
})

describe('Claude talk button', () => {
  const talk = () => screen.getByRole('button', { name: 'Talk to Claude' })
  const stop = () => screen.getByRole('button', { name: 'Stop talking to Claude' })

  let slot: HTMLElement

  beforeEach(() => {
    slot = document.body.appendChild(document.createElement('div'))
    mic.available = true
    mic.state = 'on'
    terminal.setVoiceHold.mockReset().mockReturnValue(true)
  })
  afterEach(() => {
    cleanup()
    slot.remove()
  })

  it('renders in the status bar slot rather than the Terminal toolbar', () => {
    render(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    expect(slot).toContainElement(talk())
    expect(screen.getByRole('toolbar', { name: 'Terminal controls' })).not.toContainElement(talk())
  })

  it('holds the space bar from one click to the next and sends nothing else', () => {
    render(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    terminal.focus.mockClear()
    terminal.sendRawInput.mockClear()
    fireEvent.click(talk())
    expect(terminal.setVoiceHold).toHaveBeenCalledTimes(1)
    expect(terminal.setVoiceHold).toHaveBeenLastCalledWith(true)
    expect(terminal.focus).toHaveBeenCalled()
    expect(stop()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(stop())
    expect(terminal.setVoiceHold).toHaveBeenCalledTimes(2)
    expect(terminal.setVoiceHold).toHaveBeenLastCalledWith(false)
    expect(talk()).toHaveAttribute('aria-pressed', 'false')
    expect(terminal.sendRawInput).not.toHaveBeenCalled()
  })

  it('releases when the target changes, the microphone stops, or Zen Mode hides it', () => {
    const view = render(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    fireEvent.click(talk())
    view.rerender(<Terminal sessionName="other" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    expect(terminal.setVoiceHold).toHaveBeenLastCalledWith(false)
    expect(talk()).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(talk())
    mic.state = 'off'
    view.rerender(<Terminal sessionName="other" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    expect(terminal.setVoiceHold).toHaveBeenLastCalledWith(false)
    expect(talk()).toBeDisabled()

    mic.state = 'on'
    view.rerender(<Terminal sessionName="other" hostId="h" hostLocal talkSlot={slot} claudeActive />)
    fireEvent.click(talk())
    view.rerender(<Terminal sessionName="other" hostId="h" hostLocal talkSlot={null} claudeActive zenMode onToggleZen={() => {}} />)
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
    view.rerender(<Terminal sessionName="s" hostId="h" hostLocal talkSlot={slot} claudeActive connectionState="reconnecting" />)
    expect(talk()).toBeDisabled()
  })
})
