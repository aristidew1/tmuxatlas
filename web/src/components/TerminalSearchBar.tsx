import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { TerminalSearchState } from '../hooks/useTerminal'

interface TerminalSearchBarProps {
  state: TerminalSearchState
  onLoad: () => Promise<unknown>
  onFindNext: (query: string, caseSensitive: boolean) => Promise<boolean>
  onFindPrevious: (query: string, caseSensitive: boolean) => Promise<boolean>
  onRetry: () => Promise<unknown>
  onClose: () => void
}

export function TerminalSearchBar({
  state,
  onLoad,
  onFindNext,
  onFindPrevious,
  onRetry,
  onClose,
}: TerminalSearchBarProps) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void onLoad().catch(() => {})
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [onLoad])

  useEffect(() => {
    if (!query || !state.loaded) return
    void onFindNext(query, caseSensitive).catch(() => {})
  }, [caseSensitive, onFindNext, query, state.loaded])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const action = event.shiftKey ? onFindPrevious : onFindNext
      void action(query, caseSensitive).catch(() => {})
    }
  }

  const resultLabel =
    state.resultCount > 0
      ? `${Math.max(0, state.resultIndex) + 1} / ${state.resultCount}`
      : query && state.loaded
        ? 'Aucun résultat'
        : ''

  return (
    <div
      role="search"
      aria-label="Rechercher dans le terminal"
      className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1 font-mono text-xs"
    >
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Rechercher dans le terminal"
        aria-label="Texte recherché"
        className="min-h-9 min-w-0 flex-1 rounded border border-border bg-input px-2 text-foreground outline-none focus:border-primary"
      />
      <span className="min-w-16 text-center text-muted-foreground" aria-live="polite">
        {state.loading ? 'Chargement…' : resultLabel}
      </span>
      <button
        type="button"
        aria-label="Respecter la casse"
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive(value => !value)}
        className="min-h-9 min-w-9 rounded border border-border px-2 data-[active=true]:border-primary data-[active=true]:text-primary"
        data-active={caseSensitive}
      >
        Aa
      </button>
      <button
        type="button"
        aria-label="Résultat précédent"
        disabled={!query || !state.loaded}
        onClick={() => void onFindPrevious(query, caseSensitive).catch(() => {})}
        className="min-h-9 min-w-9 rounded border border-border disabled:opacity-40"
      >
        <ArrowUp aria-hidden="true" size={16} />
      </button>
      <button
        type="button"
        aria-label="Résultat suivant"
        disabled={!query || !state.loaded}
        onClick={() => void onFindNext(query, caseSensitive).catch(() => {})}
        className="min-h-9 min-w-9 rounded border border-border disabled:opacity-40"
      >
        <ArrowDown aria-hidden="true" size={16} />
      </button>
      <button
        type="button"
        aria-label="Fermer la recherche"
        onClick={onClose}
        className="min-h-9 min-w-9 rounded border border-border"
      >
        <X aria-hidden="true" size={16} />
      </button>
      {state.error && (
        <div className="flex w-full items-center justify-between gap-2 text-destructive" role="alert">
          <span className="min-w-0 flex-1 truncate">{state.error}</span>
          <button
            type="button"
            onClick={() => void onRetry().catch(() => {})}
            className="min-h-9 rounded border border-destructive/50 px-2"
          >
            Réessayer la recherche
          </button>
        </div>
      )}
    </div>
  )
}
