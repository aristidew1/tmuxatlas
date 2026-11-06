import { useEffect, useRef, useState } from 'react'

/** Toggles a held space bar, which Claude Code treats as hold-to-talk. */
export function TalkButton({ disabled, onHold }: {
  disabled: boolean
  onHold: (on: boolean) => void
}) {
  const [holding, setHolding] = useState(false)
  const onHoldRef = useRef(onHold)
  useEffect(() => { onHoldRef.current = onHold }, [onHold])

  useEffect(() => {
    if (!holding) return
    return () => onHoldRef.current(false)
  }, [holding])

  useEffect(() => {
    if (disabled) setHolding(false)
  }, [disabled])

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={holding ? 'Stop talking to Claude' : 'Talk to Claude'}
      aria-pressed={holding}
      title="Holds the space bar until you click again"
      className={`min-h-11 shrink-0 rounded border px-2 md:min-h-8 disabled:opacity-40 ${holding ? 'border-destructive text-destructive' : 'border-border text-muted-foreground hover:text-foreground'}`}
      onClick={() => {
        if (!holding) onHold(true)
        setHolding(!holding)
      }}
    >
      {holding ? '● Listening' : 'Talk'}
    </button>
  )
}
