// Claude Code shows its dictation state in the footer, below the prompt.
const FOOTER_ROWS = 6
const RECORDING = /listening…|keep holding…/
const PROCESSING = /Voice: processing…/
const FAILED = /No speech detected|No audio detected|Voice connection failed|Voice stream error|Dictation error|Voice mode requires|Voice input is failing/

export type ClaudeVoiceStatus = 'recording' | 'processing' | 'failed' | 'idle'

export function readClaudeVoiceStatus(rows: string[]): ClaudeVoiceStatus {
  const footer = rows.filter(row => row.trim()).slice(-FOOTER_ROWS).join('\n')
  if (RECORDING.test(footer)) return 'recording'
  if (PROCESSING.test(footer)) return 'processing'
  return FAILED.test(footer) ? 'failed' : 'idle'
}
