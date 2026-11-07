// Claude Code shows its dictation state in the footer, below the rule that closes
// the prompt. An agent list can follow it, so the footer is not a fixed number of
// rows from the bottom.
const PROMPT_RULE = /─{10,}/
// Without a prompt rule on screen, only the last rows can be Claude's footer.
const FALLBACK_FOOTER_ROWS = 6
const RECORDING = /listening…|keep holding…/
const PROCESSING = /Voice: processing…/
const FAILED =
  /No speech detected|No audio detected|Voice connection failed|Voice stream error|Dictation error|Voice mode requires|Voice input is failing/

export type ClaudeVoiceStatus = 'recording' | 'processing' | 'failed' | 'idle'

function footerRows(rows: string[]): string[] {
  const lines = rows.filter(row => row.trim())
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (PROMPT_RULE.test(lines[index])) return lines.slice(index + 1)
  }
  return lines.slice(-FALLBACK_FOOTER_ROWS)
}

export function readClaudeVoiceStatus(rows: string[]): ClaudeVoiceStatus {
  const footer = footerRows(rows).join('\n')
  if (RECORDING.test(footer)) return 'recording'
  if (PROCESSING.test(footer)) return 'processing'
  return FAILED.test(footer) ? 'failed' : 'idle'
}
