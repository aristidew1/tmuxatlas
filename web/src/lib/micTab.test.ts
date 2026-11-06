import { describe, expect, it } from 'vitest'
import { micTabId } from './micTab'

describe('micTabId', () => {
  it('matches the format the server accepts', () => {
    expect(micTabId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
  })
})
