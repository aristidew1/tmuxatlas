import { describe, expect, it } from 'vitest'
import { readClaudeVoiceStatus } from './claudeVoiceStatus'

const rule = '─'.repeat(60)

// Claude Code 2.1.319 while dictating with six background agents, as tmux shows it.
const withAgents = (status: string) => [
  '● Lancement des 6 sous-agents en arrière-plan.',
  rule,
  '❯ ▁',
  rule,
  `  ⏵⏵ auto mode on (shift+tab to cycle) · ↓ to manage                    ${status}`,
  '  ● main',
  ...Array.from({ length: 5 }, (_, n) => `  ◯ general-purpose  Sous-agent sleep 150 (${n + 1}/6)          2s`),
  '  ↓ 1 more',
  '[claude_2] 0:claude*                                         "host" 10:07 07-Nov-26',
]

describe('readClaudeVoiceStatus', () => {
  it('reads the status below the prompt when an agent list follows it', () => {
    expect(readClaudeVoiceStatus(withAgents('listening…'))).toBe('recording')
    expect(readClaudeVoiceStatus(withAgents('Voice: processing…'))).toBe('processing')
    expect(readClaudeVoiceStatus(withAgents(''))).toBe('idle')
  })

  it('reads a failure shown below the prompt', () => {
    const rows = [rule, '❯', rule, '  ⏵⏵ auto mode on', '  No audio detected from microphone. Check the input device.']
    expect(readClaudeVoiceStatus(rows)).toBe('failed')
  })

  it('ignores the transcript and the prompt text above the footer', () => {
    const rows = [
      'Claude shows listening… while recording',
      rule,
      '❯ it says Voice: processing…',
      rule,
      '  ⏵⏵ auto mode on',
    ]
    expect(readClaudeVoiceStatus(rows)).toBe('idle')
  })

  it('falls back to the last rows when no prompt border is on screen', () => {
    expect(readClaudeVoiceStatus(['> hello', '  auto mode on   listening…'])).toBe('recording')
    expect(readClaudeVoiceStatus(['listening…', ...Array.from({ length: 8 }, (_, row) => `output ${row}`)])).toBe(
      'idle',
    )
  })
})
