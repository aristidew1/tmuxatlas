const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * True while the user is typing somewhere other than the terminal. Automatic
 * refocusing must wait: taking the focus from the rename field, for instance,
 * would blur it and submit a half-typed name.
 */
export function isEditingOutsideTerminal(): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  if (active.classList.contains('xterm-helper-textarea')) return false
  return EDITABLE_TAGS.has(active.tagName) || active.isContentEditable === true
}
