import { describe, expect, it, vi } from 'vitest'
import { attachAndroidTerminalInput } from './androidTerminalInput'

describe('Android terminal input', () => {
  it('forwards Gboard composition and replacement once as terminal edits', () => {
    const container = document.createElement('div')
    const textarea = document.createElement('textarea')
    container.append(textarea)
    const send = vi.fn((_data: string) => true)
    const xterm = vi.fn()
    textarea.addEventListener('input', xterm)
    textarea.addEventListener('compositionend', xterm)
    const cleanup = attachAndroidTerminalInput(container, textarea, send)
    const change = (value: string, inputType: string) => {
      textarea.value = value
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }))
    }
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    change('bonjor', 'insertCompositionText')
    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    change('bonjour', 'insertReplacementText')
    expect(send.mock.calls.map(call => call[0])).toEqual(['bonjor', '\x7fur'])
    expect(xterm).not.toHaveBeenCalled()
    cleanup()
  })

  it('resets context on terminal keys and ignores disconnected edits', () => {
    const container = document.createElement('div')
    const textarea = document.createElement('textarea')
    container.append(textarea)
    const send = vi.fn(() => false)
    attachAndroidTerminalInput(container, textarea, send)
    textarea.value = 'abc'
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(textarea.value).toBe('')
    textarea.value = 'old'
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    expect(textarea.value).toBe('')
  })
})
