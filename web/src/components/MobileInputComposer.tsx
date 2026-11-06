import { useEffect, useLayoutEffect, useRef, useState, type CompositionEvent, type KeyboardEvent } from 'react'
import { MAX_TERMINAL_COMMAND_BODY_BYTES, terminalCommandBodyByteLength } from '../lib/terminalInput'

interface MobileInputComposerProps {
  expanded?: boolean
  onClose?: () => void
  targetKey: string
  targetLabel: string
  initialDraft: string
  onDraftChange: (targetKey: string, value: string) => void
  onSend: (value: string) => void | Promise<void>
}

export function MobileInputComposer({
  expanded: controlledExpanded,
  onClose,
  targetKey,
  targetLabel,
  initialDraft,
  onDraftChange,
  onSend,
}: MobileInputComposerProps) {
  const [localExpanded, setExpanded] = useState(false)
  const expanded = controlledExpanded ?? localExpanded
  const [draft, setDraft] = useState(initialDraft)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const draftRef = useRef(initialDraft)
  const composingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const byteLength = terminalCommandBodyByteLength(draft)
  const tooLarge = byteLength > MAX_TERMINAL_COMMAND_BODY_BYTES

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const lineHeight = 22
    textarea.style.height = `${Math.max(lineHeight, Math.min(textarea.scrollHeight || lineHeight, lineHeight * 3))}px`
  }, [draft, expanded])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const persistNativeDraft = () => {
      const nextDraft = textarea.value
      draftRef.current = nextDraft
      onDraftChange(targetKey, nextDraft)
    }
    textarea.addEventListener('input', persistNativeDraft)
    return () => {
      persistNativeDraft()
      textarea.removeEventListener('input', persistNativeDraft)
    }
  }, [expanded, onDraftChange, targetKey])

  useEffect(() => {
    if (!expanded) return
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [expanded])

  const toggle = () => {
    if (controlledExpanded !== undefined) onClose?.()
    else setExpanded(value => !value)
  }

  const submit = async () => {
    if (sending || composingRef.current) return
    const submittedDraft = textareaRef.current?.value ?? draftRef.current
    draftRef.current = submittedDraft
    const submittedByteLength = terminalCommandBodyByteLength(submittedDraft)
    setFeedback('')
    if (submittedByteLength > MAX_TERMINAL_COMMAND_BODY_BYTES) {
      setError(
        `Le brouillon contient ${submittedByteLength.toLocaleString()} octets UTF-8 ; le maximum est ${MAX_TERMINAL_COMMAND_BODY_BYTES.toLocaleString()}.`,
      )
      return
    }
    setError('')
    setSending(true)
    try {
      await onSend(submittedDraft)
      if (draftRef.current === submittedDraft) {
        draftRef.current = ''
        setDraft('')
        onDraftChange(targetKey, '')
      }
      setFeedback(`Envoyé à ${targetLabel}.`)
      window.requestAnimationFrame(() => textareaRef.current?.focus())
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Impossible d’envoyer la commande.')
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey) &&
      !composingRef.current &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      void submit()
    }
  }

  const startComposition = (_event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = true
  }
  const endComposition = (_event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false
  }

  return (
    <div className="bg-card">
      {controlledExpanded === undefined && (
        <button
          type="button"
          aria-label={expanded ? 'Replier le compositeur' : 'Ouvrir le compositeur'}
          aria-expanded={expanded}
          onClick={toggle}
          className="flex min-h-11 w-full items-center justify-between px-3 text-xs font-mono"
        >
          <span>Compositeur</span>
          <span className="text-muted-foreground">{expanded ? 'Replier' : draft ? 'Brouillon' : 'Afficher'}</span>
        </button>
      )}
      {expanded && (
        <div className="border-t border-border p-2">
          {controlledExpanded !== undefined && (
            <button type="button" onClick={onClose} className="min-h-11 text-xs">
              Replier
            </button>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              aria-label={`Brouillon pour ${targetLabel}`}
              placeholder="Composez votre texte ; Entrée ajoute une ligne"
              autoCorrect="off"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              onChange={event => {
                const nextDraft = event.target.value
                draftRef.current = nextDraft
                setDraft(nextDraft)
                onDraftChange(targetKey, nextDraft)
                setError('')
                setFeedback('')
              }}
              onBlur={event => {
                const nextDraft = event.currentTarget.value
                draftRef.current = nextDraft
                onDraftChange(targetKey, nextDraft)
              }}
              onKeyDown={onKeyDown}
              onCompositionStart={startComposition}
              onCompositionEnd={endComposition}
              className="min-h-11 max-h-[66px] min-w-0 flex-1 resize-none overflow-y-auto rounded border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
            <button
              type="button"
              aria-label={`Envoyer la commande à ${targetLabel}`}
              disabled={sending || tooLarge}
              onClick={() => void submit()}
              className="min-h-11 min-w-16 rounded border border-primary/50 bg-primary/15 px-3 text-sm text-primary disabled:opacity-40"
            >
              {sending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
          <div className="mobile-composer-meta mt-1 flex min-w-0 justify-between gap-2 text-2xs text-muted-foreground">
            <span className="min-w-0">⌘/Ctrl+Entrée envoie ; Entrée ajoute une ligne.</span>
            <span className={tooLarge ? 'shrink-0 text-destructive' : 'shrink-0'}>
              {byteLength.toLocaleString()} / {MAX_TERMINAL_COMMAND_BODY_BYTES.toLocaleString()} octets
            </span>
          </div>
          {(error || tooLarge) && (
            <p className="mt-1 text-xs text-destructive" role="alert">
              {error || `Le brouillon dépasse ${MAX_TERMINAL_COMMAND_BODY_BYTES.toLocaleString()} octets UTF-8.`}
            </p>
          )}
          {feedback && (
            <p className="mt-1 text-xs text-success" role="status">
              {feedback}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
