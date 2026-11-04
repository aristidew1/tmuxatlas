/** Bridge Android IME edits directly to the terminal. xterm's composition
 * helper assumes a composition only appends to the textarea, but Gboard also
 * replaces previously committed text when a suggestion is selected. */
export function attachAndroidTerminalInput(
  container: HTMLElement,
  textarea: HTMLTextAreaElement,
  send: (data: string) => boolean,
): () => void {
  let previous = textarea.value
  const reset = () => { previous = ''; textarea.value = '' }
  const isTarget = (event: Event) => event.target === textarea
  const keydown = (event: KeyboardEvent) => {
    if (!isTarget(event)) return
    if (event.keyCode === 229 || event.key === 'Process') {
      event.stopPropagation()
    } else if (!['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) {
      // xterm handles physical keys and controls; discard the IME's old context.
      reset()
    }
  }
  const composition = (event: Event) => {
    if (isTarget(event)) event.stopPropagation()
  }
  const input = (event: Event) => {
    if (!isTarget(event)) return
    const inputEvent = event as InputEvent
    if (inputEvent.inputType === 'insertFromPaste') {
      reset()
      return
    }
    event.stopPropagation()
    const next = textarea.value
    const oldChars = Array.from(previous)
    const newChars = Array.from(next)
    let prefix = 0
    while (prefix < oldChars.length && prefix < newChars.length && oldChars[prefix] === newChars[prefix]) prefix++
    const edit = '\x7f'.repeat(oldChars.length - prefix) + newChars.slice(prefix).join('').replace(/\r?\n/g, '\r')
    if (edit && !send(edit)) { reset(); return }
    previous = next
    if (/[\r\n]/.test(next)) reset()
  }
  const pointerdown = (event: Event) => { if (!isTarget(event)) reset() }
  document.addEventListener('pointerdown', pointerdown, true)
  container.addEventListener('keydown', keydown, true)
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) container.addEventListener(type, composition, true)
  container.addEventListener('input', input, true)
  return () => {
    document.removeEventListener('pointerdown', pointerdown, true)
    container.removeEventListener('keydown', keydown, true)
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) container.removeEventListener(type, composition, true)
    container.removeEventListener('input', input, true)
  }
}
