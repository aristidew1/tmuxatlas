function createMicTabId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Identifies this page's microphone on the server, so recorders in the sessions
 * this tab uses hear this tab rather than another person's.
 */
export const micTabId = createMicTabId()
