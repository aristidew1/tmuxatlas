import type { Terminal } from '@xterm/xterm'

// Mouse-reporting applications need clicks and wheel events, but text drags
// should select in xterm rather than entering tmux copy mode or reaching a TUI.
export function enableTerminalMouseSelection(container: HTMLElement, term: Terminal): () => void {
  let cleanupPending: (() => void) | undefined
  let dispatching = false

  const onMouseDown = (event: MouseEvent) => {
    if (dispatching || event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || term.modes.mouseTrackingMode === 'none') return
    if ((event as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents) return
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.closest('.xterm-screen')) return

    event.preventDefault()
    event.stopImmediatePropagation()
    cleanupPending?.()
    const start = event
    const dispatchDown = (forceSelection: boolean) => {
      const isMac = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'].includes(navigator.platform)
      dispatching = true
      try {
        target.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, view: window, detail: start.detail,
          screenX: start.screenX, screenY: start.screenY, clientX: start.clientX, clientY: start.clientY,
          button: 0, buttons: 1,
          shiftKey: forceSelection && !isMac,
          altKey: forceSelection && isMac,
        }))
      } finally {
        dispatching = false
      }
    }
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
      window.removeEventListener('blur', cleanup)
      if (cleanupPending === cleanup) cleanupPending = undefined
    }
    const onMove = (move: MouseEvent) => {
      if (Math.hypot(move.clientX - start.clientX, move.clientY - start.clientY) < 4) return
      cleanup()
      dispatchDown(true)
      // The current movement occurred before xterm installed its listeners.
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: move.clientX, clientY: move.clientY,
        screenX: move.screenX, screenY: move.screenY, buttons: move.buttons,
      }))
    }
    const onUp = () => {
      cleanup()
      // Replay the press before the real release so applications receive a
      // normal click, including xterm's document-level mouseup handling.
      dispatchDown(false)
    }
    cleanupPending = cleanup
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
    window.addEventListener('blur', cleanup)
  }

  // In all-motion tracking mode xterm treats hover reports as user input and
  // clears the selection. Keep it until a click or actual keyboard input.
  const onMouseMove = (event: MouseEvent) => {
    if (event.buttons === 0 && term.hasSelection()) event.stopPropagation()
  }
  container.addEventListener('mousedown', onMouseDown, true)
  container.addEventListener('mousemove', onMouseMove, true)
  return () => {
    cleanupPending?.()
    container.removeEventListener('mousedown', onMouseDown, true)
    container.removeEventListener('mousemove', onMouseMove, true)
  }
}
