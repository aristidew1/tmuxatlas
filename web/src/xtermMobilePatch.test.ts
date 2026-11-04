import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { patchXtermMobileInput } from '../xterm-mobile-patch'

describe('xterm mobile textarea changes', () => {
  it.each([
    ['bon', 'bonjour', 'jour'],
    ['bonjor', 'bonjour', '\x7fur'],
    ['test', 'Test', '\x7f\x7f\x7f\x7fTest'],
    ['abc', 'ab', '\x7f'],
    ['abc', 'abc', ''],
  ])('translates %s to %s', async (before, after, expected) => {
    const source = patchXtermMobileInput(readFileSync('node_modules/@xterm/xterm/lib/xterm.js', 'utf8'))
    const start = source.indexOf('const e=this._textarea.value;setTimeout')
    const end = source.indexOf('updateCompositionElements(e)', start)
    const body = source.slice(start, end).replace(/\}$/, '')
    const emit = vi.fn()
    const instance = { _textarea: { value: before }, _isComposing: false, _coreService: { triggerDataEvent: emit } }
    const handler = new Function('a', `return function(){${body}}`)({ C0: { DEL: '\x7f' } })
    handler.call(instance)
    instance._textarea.value = after
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(emit.mock.calls.map(call => call[0]).join('')).toBe(expected)
  })
})
