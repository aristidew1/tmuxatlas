import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMicStream } from './useMicStream'

const apiFetch = vi.fn()
vi.mock('../lib/api', () => ({ apiFetch: (path: string) => apiFetch(path) }))

describe('useMicStream', () => {
  const getUserMedia = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    getUserMedia.mockReset().mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    apiFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ enabled: true, ready: true }) })
    vi.stubGlobal('isSecureContext', true)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('turns on by itself when voice is enabled', async () => {
    const { result } = renderHook(() => useMicStream(true))
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.error).toContain('refusé'))
    expect(result.current.state).toBe('off')
  })

  it('does not capture on a host where it is not allowed', async () => {
    renderHook(() => useMicStream(false))
    await act(async () => {
      await Promise.resolve()
    })
    expect(apiFetch).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('stays off once turned off, until turned back on', async () => {
    getUserMedia.mockReturnValue(new Promise(() => {}))
    const first = renderHook(() => useMicStream(true))
    await waitFor(() => expect(first.result.current.state).toBe('starting'))
    act(() => first.result.current.toggle())
    expect(first.result.current.state).toBe('off')
    first.unmount()

    getUserMedia.mockClear()
    const second = renderHook(() => useMicStream(true))
    await waitFor(() => expect(second.result.current.available).toBe(true))
    expect(getUserMedia).not.toHaveBeenCalled()
    act(() => second.result.current.toggle())
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    expect(localStorage.getItem('tmuxatlas.mic.off')).toBeNull()
  })
})
