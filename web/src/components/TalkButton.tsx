import { useEffect, useRef, useState } from 'react'
import { readClaudeVoiceStatus } from '../lib/claudeVoiceStatus'

const POLL_MS = 100
const RELEASE_SETTLE_MS = 300
const TRANSCRIPT_TIMEOUT_MS = 30_000
const IDLE_TICKS_BEFORE_SEND = 2

type Phase = 'idle' | 'holding' | 'sending'

const ROUND = 'grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-40 md:h-7 md:w-7'

/**
 * Holds the space bar, which Claude Code treats as hold-to-talk, until Stop or
 * Send. Send presses Enter once Claude's footer shows the transcript is in.
 */
export function TalkButton({ disabled, onHold, readScreen, onSubmit }: {
  disabled: boolean
  onHold: (on: boolean) => void
  readScreen: () => string[]
  onSubmit: () => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [notice, setNotice] = useState('')
  const latest = useRef({ onHold, readScreen, onSubmit })
  useEffect(() => { latest.current = { onHold, readScreen, onSubmit } }, [onHold, onSubmit, readScreen])
  const heard = useRef(false)

  // Leaving the holding phase, by any path, releases the space bar.
  useEffect(() => {
    if (phase !== 'holding') return
    return () => latest.current.onHold(false)
  }, [phase])

  useEffect(() => {
    if (disabled) setPhase('idle')
  }, [disabled])

  useEffect(() => {
    if (phase !== 'holding') return
    const timer = window.setInterval(() => {
      if (readClaudeVoiceStatus(latest.current.readScreen()) === 'recording') heard.current = true
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'sending') return
    const startedAt = Date.now()
    let idleTicks = 0
    const finish = (message: string) => {
      window.clearInterval(timer)
      setNotice(message)
      setPhase('idle')
    }
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt
      if (elapsed < RELEASE_SETTLE_MS) return
      const status = readClaudeVoiceStatus(latest.current.readScreen())
      if (status === 'recording') heard.current = true
      if (status === 'failed') {
        finish('Claude could not transcribe this. Nothing was sent.')
      } else if (elapsed > TRANSCRIPT_TIMEOUT_MS) {
        finish('Claude did not finish transcribing. Nothing was sent.')
      } else if (status !== 'idle') {
        idleTicks = 0
      } else if (!heard.current) {
        finish('Claude was not listening. Nothing was sent.')
      } else if (++idleTicks >= IDLE_TICKS_BEFORE_SEND) {
        latest.current.onSubmit()
        finish('')
      }
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [phase])

  if (phase === 'idle') {
    return (
      <>
        <button
          type="button"
          disabled={disabled}
          aria-label="Talk to Claude"
          title="Holds the space bar until you stop or send"
          className="min-h-11 shrink-0 rounded border border-border px-2 text-muted-foreground hover:text-foreground disabled:opacity-40 md:min-h-8"
          onClick={() => {
            setNotice('')
            heard.current = false
            setPhase('holding')
            onHold(true)
          }}
        >
          Talk
        </button>
        {notice && <span role="alert" title={notice} className="ml-2 min-w-0 truncate font-normal text-destructive">{notice}</span>}
      </>
    )
  }

  const sending = phase === 'sending'
  return (
    <div role="group" aria-label="Dictation" className="flex items-center gap-2">
      <button
        type="button"
        disabled={sending}
        aria-label="Stop talking and edit the prompt"
        title="Stop and edit the prompt"
        className={`${ROUND} border border-border bg-muted text-foreground hover:opacity-80`}
        onClick={() => setPhase('idle')}
      >
        <svg aria-hidden="true" viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="currentColor"><rect width="10" height="10" rx="2" /></svg>
      </button>
      <button
        type="button"
        disabled={sending}
        aria-label="Stop talking and send the prompt"
        title="Stop and send the prompt"
        className={`${ROUND} bg-blue-600 text-white hover:opacity-90`}
        onClick={() => setPhase('sending')}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>
      </button>
    </div>
  )
}
