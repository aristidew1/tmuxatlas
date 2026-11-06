import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, User } from 'lucide-react'
import { useAccountRole } from '../lib/accountContext'
import { claimSession, fetchAccountDirectory, releaseSession, type AccountDirectoryEntry } from '../lib/accountsApi'

const MENU_WIDTH = 208

interface OwnerPickerProps {
  hostId: string
  session: string
  ownerName?: string | null
  testId?: string
  className?: string
}

/** The owner's name; clicking it opens a menu that gives the session to another account. */
export function OwnerPicker({ hostId, session, ownerName, testId, className = '' }: OwnerPickerProps) {
  const role = useAccountRole()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [accounts, setAccounts] = useState<AccountDirectoryEntry[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const open = position !== null

  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setPosition(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPosition(null)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', escape, true)
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open, accounts])

  if (!role) {
    if (!ownerName) return null
    return (
      <span
        data-testid={testId}
        className={`inline-flex shrink-0 items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-2xs text-secondary-foreground ${className}`}
      >
        <User size={12} aria-hidden="true" />
        <span className="max-w-24 truncate">{ownerName}</span>
      </span>
    )
  }
  if (!ownerName && role !== 'admin') return null

  const toggle = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    if (open) {
      setPosition(null)
      return
    }
    const rect = triggerRef.current!.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)),
      top: rect.bottom + 4,
    })
    setError('')
    fetchAccountDirectory()
      .then(setAccounts)
      .catch(() => setError('Impossible de charger les comptes.'))
  }

  const change = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      setPosition(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de changer le propriétaire.')
    } finally {
      setBusy(false)
    }
  }

  const itemClass =
    'ui-focus-ring flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary disabled:opacity-50'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Changer le propriétaire de ${session}, actuellement ${ownerName || 'aucun'}`}
        onClick={toggle}
        className={`ui-focus-ring inline-flex shrink-0 items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-2xs text-secondary-foreground hover:bg-secondary/70 ${className}`}
      >
        <User size={12} aria-hidden="true" />
        <span className="max-w-24 truncate">{ownerName || 'Libre'}</span>
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Propriétaire de ${session}`}
            onClick={event => event.stopPropagation()}
            style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
            className="fixed z-[10000] max-h-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {accounts === null && !error && <p className="px-2 py-2 text-xs text-muted-foreground">Chargement…</p>}
            {accounts?.map(account => {
              const current = account.username === ownerName
              return (
                <button
                  key={account.id}
                  type="button"
                  role="menuitem"
                  disabled={busy || current}
                  onClick={() => void change(() => claimSession(hostId, session, account.id))}
                  className={itemClass}
                >
                  <span className="w-3.5 shrink-0">{current && <Check size={14} aria-hidden="true" />}</span>
                  <span className="truncate">{account.username}</span>
                </button>
              )
            })}
            {accounts && ownerName && (
              <>
                <div role="separator" className="my-1 h-px bg-border" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void change(() => releaseSession(hostId, session))}
                  className={itemClass}
                >
                  <span className="w-3.5 shrink-0" />
                  Libérer la session
                </button>
              </>
            )}
            {error && (
              <p role="alert" className="px-2 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
