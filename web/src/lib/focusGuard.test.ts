import { afterEach, describe, expect, it } from 'vitest'
import { isEditingOutsideTerminal } from './focusGuard'

describe('isEditingOutsideTerminal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const focusNew = (tag: string, className = '') => {
    const element = document.createElement(tag)
    element.className = className
    document.body.appendChild(element)
    element.focus()
  }

  it('is true in a field outside the terminal', () => {
    focusNew('input')
    expect(isEditingOutsideTerminal()).toBe(true)
  })

  it('is false in the terminal input', () => {
    focusNew('textarea', 'xterm-helper-textarea')
    expect(isEditingOutsideTerminal()).toBe(false)
  })

  it('is false when nothing editable has the focus', () => {
    focusNew('button')
    expect(isEditingOutsideTerminal()).toBe(false)
  })
})
