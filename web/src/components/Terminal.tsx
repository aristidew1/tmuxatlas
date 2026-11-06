import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Keyboard, Mic, Pencil } from 'lucide-react'
import { useMediaQuery, COMPACT_LAYOUT_QUERY } from '../lib/useMediaQuery'
import { useHostLabel } from '../lib/hostLabel'
import type { Window as SessionWindow } from '../hooks/useSessions'
import type { WorkspaceStatus } from '../workspace/model'
import { WindowTabs } from './WindowTabs'
import { isEditingOutsideTerminal } from '../lib/focusGuard'
import { useTerminal, type PendingTerminalPaste } from '../hooks/useTerminal'
import { useTerminalDrafts, type TerminalDraftStore } from '../hooks/useTerminalDrafts'
import { MobileTerminalInput, terminalKeys, type ModifierName, type ModifierState } from '../lib/mobileTerminalInput'
import { terminalTargetKey } from '../lib/terminalInput'
import type { ConnectionState } from '../state/types'
import { deriveTerminalWorkspaceConnection, type TerminalWorkspaceConnectionState } from '../state/terminalConnection'
import { useMicStream } from '../hooks/useMicStream'
import { TalkButton } from './TalkButton'
import { TerminalCockpit } from './TerminalCockpit'
import { TerminalContextMenu, type TerminalMenuPosition } from './TerminalContextMenu'
import { TerminalPasteConfirmation } from './TerminalPasteConfirmation'
import { TerminalSearchBar } from './TerminalSearchBar'
import { MobileInputComposer } from './MobileInputComposer'

export interface TerminalCommandActions {
  reconnect: () => void
  focus: () => void
  openSearch: () => void
  copy: () => Promise<void>
  paste: () => Promise<void>
  scrollToBottom: () => void
}

export interface TerminalProps {
  embedded?: boolean
  windows?: SessionWindow[]
  windowAttention?: Record<number, 'error' | 'waiting'>
  onSelectWindow?: (index: number) => void
  onSelectPane?: (paneId: string) => void
  onBackToSessions?: () => void
  onPreviousSession?: () => void
  onNextSession?: () => void
  attentionCount?: number
  onOpenAlerts?: () => void
  sessionStatus?: WorkspaceStatus
  sessionName: string
  ownerName?: string | null
  hostId: string
  hostName?: string
  windowLabel?: string
  paneLabel?: string
  toolStatus?: string
  hubConnection?: ConnectionState
  agentOnline?: boolean
  sessionAvailable?: boolean
  connectionState?: TerminalWorkspaceConnectionState
  fullscreen?: boolean
  zenMode?: boolean
  /** The session runs on the machine serving this page, where the virtual microphone lives. */
  hostLocal?: boolean
  /** Whether voice/microphone features are allowed for the current user role. */
  voiceAllowed?: boolean
  /** Claude Code runs in the pane this Terminal has active. */
  claudeActive?: boolean
  /** Where the talk button renders; it is absent while the status bar is hidden. */
  talkSlot?: HTMLElement | null
  onToggleFullscreen?: () => void
  onToggleZen?: () => void
  onRetry?: () => void
  onCommandActionsChange?: (actions: TerminalCommandActions | null) => void
  terminalDrafts?: TerminalDraftStore
}

const terminalStateMessages: Record<TerminalWorkspaceConnectionState, string> = {
  connecting: 'Connexion au terminal…',
  rehydrating: 'Synchronisation du Hub…',
  connected: '',
  reconnecting: 'Terminal déconnecté. Reconnexion…',
  'hub-offline': 'La connexion au Hub est indisponible.',
  'agent-offline': 'L’agent est hors ligne.',
  'session-ended': 'Cette session n’est plus disponible.',
  'auth-required': 'Votre connexion au Hub a expiré.',
  'reload-required': 'Atlas a été mis à jour. Actualisez la page pour continuer.',
}

export function Terminal({
  embedded = false,
  windows = [],
  windowAttention,
  onSelectWindow,
  onSelectPane,
  onBackToSessions,
  onPreviousSession,
  onNextSession,
  attentionCount,
  onOpenAlerts,
  sessionStatus,
  sessionName,
  ownerName,
  hostId,
  hostName,
  windowLabel,
  paneLabel,
  toolStatus,
  hubConnection,
  agentOnline,
  sessionAvailable,
  connectionState,
  fullscreen,
  zenMode,
  hostLocal,
  voiceAllowed = true,
  claudeActive,
  talkSlot,
  onToggleFullscreen,
  onToggleZen,
  onRetry,
  onCommandActionsChange,
  terminalDrafts,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<MobileTerminalInput | null>(null)
  if (!inputRef.current) inputRef.current = new MobileTerminalInput()
  const input = inputRef.current
  const targetKey = terminalTargetKey(hostId, sessionName)
  const resolveHostLabel = useHostLabel()
  const hostLabel = resolveHostLabel(hostId, hostName === hostId ? 'Hôte' : hostName || 'Hôte') || 'Hôte'
  const targetLabel = `${hostLabel}/${sessionName}`
  const compact = useMediaQuery(COMPACT_LAYOUT_QUERY)
  const localTerminalDrafts = useTerminalDrafts()
  const { getDraft, setDraft } = terminalDrafts ?? localTerminalDrafts
  const [modifiers, setModifiers] = useState<ModifierState>(input.snapshot())
  const [composerOpen, setComposerOpen] = useState(false)
  const [toolbarError, setToolbarError] = useState('')
  const [toolbarFeedback, setToolbarFeedback] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<TerminalMenuPosition | null>(null)
  const [pendingPaste, setPendingPaste] = useState<PendingTerminalPaste | null>(null)
  const [pasteError, setPasteError] = useState('')
  const {
    connect,
    disconnect,
    reconnect,
    fit,
    focus,
    ptyState,
    termConnected,
    hasSelection,
    isAtBottom,
    hasNewOutput,
    scrollToBottom,
    adjustFontSize,
    sendInput,
    sendRawInput,
    setVoiceHold,
    readScreen,
    sendCommand,
    copySelection,
    pasteClipboard,
    imagePasteStatus,
    commitClipboardPaste,
    selectAll,
    searchState,
    ensureSearchAddon,
    findNext,
    findPrevious,
    clearSearch,
  } = useTerminal(sessionName, hostId, input)
  const mic = useMicStream(Boolean(hostLocal && !embedded && voiceAllowed))
  const toggleMic = useCallback(() => {
    mic.toggle()
    focus()
  }, [focus, mic])
  const holdSpace = useCallback(
    (on: boolean) => {
      setVoiceHold(on)
      focus()
    },
    [focus, setVoiceHold],
  )

  const submitPrompt = useCallback(() => {
    try {
      sendRawInput(new Uint8Array([13]))
    } catch {
      /* the Terminal reports the disconnect */
    }
    focus()
  }, [focus, sendRawInput])

  const workspaceConnection =
    connectionState ??
    deriveTerminalWorkspaceConnection({
      hub: hubConnection ?? 'ready',
      agentOnline: agentOnline ?? true,
      sessionAvailable: sessionAvailable ?? true,
      pty: ptyState,
    }).state
  const canPaste = workspaceConnection === 'connected' && Boolean(navigator.clipboard?.readText)

  useEffect(() => input.subscribe(setModifiers), [input])
  useEffect(() => {
    input.reset()
    setToolbarError('')
    setToolbarFeedback('')
    setComposerOpen(false)
    setPendingPaste(null)
    setPasteError('')
    setContextMenu(null)
    setSearchOpen(false)
    clearSearch()
  }, [clearSearch, hostId, input, sessionName])

  const cycleModifier = (modifier: ModifierName) => {
    input.cycle(modifier)
    focus()
  }

  const reportError = useCallback((error: unknown, fallback: string) => {
    setToolbarFeedback('')
    setToolbarError(error instanceof Error ? error.message : fallback)
  }, [])

  const copy = useCallback(async () => {
    setToolbarError('')
    try {
      await copySelection()
      setToolbarFeedback('Sélection copiée.')
    } catch (error) {
      reportError(error, 'Impossible de copier la sélection.')
      throw error
    }
  }, [copySelection, reportError])

  const paste = useCallback(async () => {
    setToolbarError('')
    setToolbarFeedback('')
    try {
      const confirmation = await pasteClipboard()
      if (confirmation) {
        setPendingPaste(confirmation)
        setPasteError('')
      } else {
        setToolbarFeedback('Texte collé dans le terminal.')
      }
    } catch (error) {
      reportError(error, 'Impossible de coller le presse-papiers.')
      throw error
    }
  }, [pasteClipboard, reportError])

  const confirmPaste = useCallback(() => {
    if (!pendingPaste) return
    setPasteError('')
    try {
      commitClipboardPaste(pendingPaste)
      setPendingPaste(null)
      setToolbarFeedback('Lignes collées dans le terminal.')
      setToolbarError('')
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : 'Impossible d’envoyer le collage.')
    }
  }, [commitClipboardPaste, pendingPaste])

  const openSearch = useCallback(() => {
    setContextMenu(null)
    setSearchOpen(true)
  }, [])

  const closeSearch = useCallback(() => {
    clearSearch()
    setSearchOpen(false)
    window.requestAnimationFrame(() => focus())
  }, [clearSearch, focus])

  const sendComposerCommand = useCallback(
    (value: string) => {
      sendCommand(value)
      setToolbarError('')
    },
    [sendCommand],
  )

  useEffect(() => {
    if (!onCommandActionsChange) return
    const actions: TerminalCommandActions = {
      reconnect,
      focus,
      openSearch,
      copy: async () => {
        await copy()
      },
      paste: async () => {
        await paste()
      },
      scrollToBottom,
    }
    onCommandActionsChange(actions)
    return () => onCommandActionsChange(null)
  }, [copy, focus, onCommandActionsChange, openSearch, paste, reconnect, scrollToBottom, targetKey])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    connect(container)
    const autoFocus = () => {
      if (!isEditingOutsideTerminal()) focus()
    }
    const focusFrame = embedded ? 0 : window.requestAnimationFrame(autoFocus)
    const focusTimer = embedded ? 0 : window.setTimeout(autoFocus, 100)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.clearTimeout(focusTimer)
      disconnect()
    }
  }, [connect, disconnect, focus, embedded])

  useEffect(() => {
    if (embedded || !termConnected || document.hidden) return
    const timer = window.setTimeout(() => {
      fit()
      if (isEditingOutsideTerminal()) return
      focus()
      containerRef.current?.querySelector<HTMLTextAreaElement>('textarea.xterm-helper-textarea')?.focus()
    }, 100)
    return () => window.clearTimeout(timer)
  }, [fit, focus, termConnected, embedded])

  useEffect(() => {
    if (embedded) return
    let timer: number | null = null
    const refocus = () => {
      if (document.hidden || !containerRef.current) return
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        fit()
        if (isEditingOutsideTerminal()) return
        focus()
        containerRef.current?.querySelector<HTMLTextAreaElement>('textarea.xterm-helper-textarea')?.focus()
      }, 200)
    }
    document.addEventListener('visibilitychange', refocus)
    window.addEventListener('focus', refocus)
    return () => {
      document.removeEventListener('visibilitychange', refocus)
      window.removeEventListener('focus', refocus)
      if (timer !== null) window.clearTimeout(timer ?? undefined)
    }
  }, [fit, focus, embedded])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let frame: number | null = null
    const scheduleFit = () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = null
        fit()
      })
    }
    const observer = new ResizeObserver(scheduleFit)
    observer.observe(container)
    window.visualViewport?.addEventListener('resize', scheduleFit)
    window.visualViewport?.addEventListener('scroll', scheduleFit)
    return () => {
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
      window.visualViewport?.removeEventListener('resize', scheduleFit)
      window.visualViewport?.removeEventListener('scroll', scheduleFit)
    }
  }, [fit])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let lastY = 0
    let lastTime = 0
    let accumulated = 0
    let velocity = 0
    let inertiaId: number | null = null
    let lastClientX = 0
    let lastClientY = 0
    const lineHeight = 20

    const dispatchScroll = (lines: number, clientX: number, clientY: number) => {
      const target = container.querySelector('.xterm-screen')
      if (!target) return
      for (let index = 0; index < Math.abs(lines); index++) {
        target.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: lines > 0 ? lineHeight : -lineHeight,
            clientX,
            clientY,
            bubbles: true,
            cancelable: true,
          }),
        )
      }
    }

    const processAccumulated = (clientX: number, clientY: number) => {
      const speed = Math.abs(velocity)
      const multiplier = speed > 12 ? 8 : speed > 7 ? 5 : speed > 4 ? 3 : speed > 2 ? 2 : 1
      const threshold = lineHeight / multiplier
      while (Math.abs(accumulated) >= threshold) {
        const direction = accumulated > 0 ? 1 : -1
        dispatchScroll(direction, clientX, clientY)
        accumulated -= direction * threshold
      }
    }

    const stopInertia = () => {
      if (inertiaId === null) return
      window.cancelAnimationFrame(inertiaId)
      inertiaId = null
    }
    const inertiaLoop = () => {
      if (Math.abs(velocity) < 0.3) {
        velocity = 0
        accumulated = 0
        inertiaId = null
        return
      }
      velocity *= 0.92
      accumulated += velocity * 16
      processAccumulated(lastClientX, lastClientY)
      inertiaId = window.requestAnimationFrame(inertiaLoop)
    }
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      stopInertia()
      lastY = event.touches[0].clientY
      lastTime = performance.now()
      accumulated = 0
      velocity = 0
    }
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      event.preventDefault()
      const now = performance.now()
      const currentY = event.touches[0].clientY
      const deltaY = lastY - currentY
      const elapsed = now - lastTime
      lastClientX = event.touches[0].clientX
      lastClientY = event.touches[0].clientY
      if (elapsed > 0) velocity = velocity * 0.3 + (deltaY / elapsed) * 0.7
      accumulated += deltaY
      lastY = currentY
      lastTime = now
      processAccumulated(lastClientX, lastClientY)
    }
    const onTouchEnd = () => {
      if (Math.abs(velocity) > 0.5) inertiaId = window.requestAnimationFrame(inertiaLoop)
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd, { passive: true })
    container.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      stopInertia()
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [sessionName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fit()
      if (!embedded && !isEditingOutsideTerminal()) focus()
    }, 100)
    return () => window.clearTimeout(timer)
  }, [fit, focus, fullscreen, zenMode, embedded])

  const showMenuAtButton = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect()
    setContextMenu({ x: rect.right - 160, y: rect.bottom + 4 })
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {!embedded && !zenMode && (
        <TerminalCockpit
          hostLabel={hostLabel}
          sessionStatus={sessionStatus}
          onBackToSessions={onBackToSessions}
          onPreviousSession={onPreviousSession}
          onNextSession={onNextSession}
          attentionCount={attentionCount}
          onOpenAlerts={onOpenAlerts}
          sessionName={sessionName}
          ownerName={ownerName}
          hostId={hostId}
          windowLabel={windowLabel}
          paneLabel={paneLabel}
          toolStatus={toolStatus}
          connectionState={workspaceConnection}
          canCopy={hasSelection}
          canPaste={canPaste}
          showScrollToBottom={!isAtBottom || hasNewOutput}
          fullscreen={fullscreen}
          zenMode={zenMode}
          mic={mic.available ? { state: mic.state, error: mic.error, onToggle: toggleMic } : undefined}
          onSearch={openSearch}
          onCopy={() => void copy().catch(() => {})}
          onPaste={() => void paste().catch(() => {})}
          onFontSize={adjustFontSize}
          onScrollToBottom={scrollToBottom}
          onToggleFullscreen={onToggleFullscreen}
          onToggleZen={onToggleZen}
          onMore={showMenuAtButton}
        />
      )}
      {!embedded &&
        !compact &&
        mic.available &&
        talkSlot &&
        createPortal(
          <TalkButton
            key={targetKey}
            disabled={!claudeActive || mic.state !== 'on' || workspaceConnection !== 'connected'}
            onHold={holdSpace}
            readScreen={readScreen}
            onSubmit={submitPrompt}
          />,
          talkSlot,
        )}
      {!embedded && zenMode && mic.state !== 'off' && (
        <button
          type="button"
          aria-label="Désactiver le micro"
          onClick={toggleMic}
          className="absolute right-24 top-3 z-20 min-h-11 rounded border border-destructive bg-card/95 px-3 text-xs text-destructive"
        >
          Micro activé
        </button>
      )}
      {!embedded && zenMode && onToggleZen && (
        <button
          type="button"
          aria-label="Quitter le mode Zen"
          onClick={onToggleZen}
          className="absolute right-3 top-3 z-20 min-h-11 rounded border border-border bg-card/95 px-3 text-xs text-muted-foreground"
        >
          Quitter Zen
        </button>
      )}
      {!embedded && !zenMode && (
        <WindowTabs
          windows={windows}
          windowAttention={windowAttention}
          onSelectWindow={onSelectWindow}
          onSelectPane={onSelectPane}
        />
      )}
      {searchOpen && (
        <TerminalSearchBar
          state={searchState}
          onLoad={ensureSearchAddon}
          onFindNext={findNext}
          onFindPrevious={findPrevious}
          onRetry={ensureSearchAddon}
          onClose={closeSearch}
        />
      )}
      <div
        className="relative min-h-0 w-full flex-1 bg-card"
        onContextMenu={event => {
          event.preventDefault()
          setContextMenu({ x: event.clientX, y: event.clientY })
        }}
      >
        <div
          ref={containerRef}
          data-terminal-surface
          className="absolute inset-0 overflow-hidden pl-1 md:pl-2 md:pt-1"
          onClick={embedded ? focus : undefined}
        />
        {workspaceConnection !== 'connected' && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded bg-background/80">
            <div className="pointer-events-auto flex max-w-[90%] items-center gap-3 rounded border border-border bg-card px-4 py-3 font-mono text-sm">
              <span className="h-2 w-2 shrink-0 animate-[pulse_1.5s_ease-in-out_infinite] rounded-full bg-warning" />
              <span>{terminalStateMessages[workspaceConnection]}</span>
              {(workspaceConnection === 'reconnecting' || workspaceConnection === 'hub-offline') && (
                <button
                  type="button"
                  onClick={onRetry || reconnect}
                  className="min-h-9 rounded border border-primary/50 px-3 text-primary"
                >
                  Réessayer
                </button>
              )}
            </div>
          </div>
        )}
        {imagePasteStatus && (
          <div role="status" className="px-3 py-2 text-sm">
            {imagePasteStatus}
          </div>
        )}
        {pendingPaste && (
          <TerminalPasteConfirmation
            text={pendingPaste.text}
            targetLabel={targetLabel}
            error={pasteError}
            onConfirm={confirmPaste}
            onCancel={() => {
              setPendingPaste(null)
              setPasteError('')
              focus()
            }}
          />
        )}
      </div>

      {!embedded && compact && (
        <div className="shrink-0 pb-[var(--safe-area-inset-bottom)]">
          {composerOpen && (
            <MobileInputComposer
              key={targetKey}
              targetKey={targetKey}
              targetLabel={targetLabel}
              initialDraft={getDraft(targetKey)}
              onDraftChange={setDraft}
              onSend={sendComposerCommand}
              expanded
              onClose={() => setComposerOpen(false)}
            />
          )}
          <div className="flex h-11 items-center" role="toolbar" aria-label="Touches du terminal">
            <div className="scrollbar-none flex min-w-0 flex-1 overflow-x-auto">
              {(
                [
                  ['Échap', 'Esc', terminalKeys.escape],
                  ['Tabulation', 'Tab', terminalKeys.tab],
                  ['Flèche gauche', <ArrowLeft size={16} />, terminalKeys.left],
                  ['Flèche haut', <ArrowUp size={16} />, terminalKeys.up],
                  ['Flèche bas', <ArrowDown size={16} />, terminalKeys.down],
                  ['Flèche droite', <ArrowRight size={16} />, terminalKeys.right],
                ] as const
              ).map(([label, content, value]) => (
                <button
                  key={label}
                  type="button"
                  aria-label={label}
                  className="grid h-11 min-w-11 place-items-center font-mono text-xs"
                  onClick={() => {
                    sendInput(value)
                    focus()
                  }}
                >
                  {content}
                </button>
              ))}
              {(['ctrl', 'alt'] as const).map(modifier => (
                <button
                  key={modifier}
                  type="button"
                  aria-label={`Modificateur ${modifier}`}
                  aria-pressed={modifiers[modifier] !== 'off'}
                  className="h-11 min-w-11 font-mono text-xs aria-pressed:text-primary"
                  onClick={() => cycleModifier(modifier)}
                >
                  {modifier === 'ctrl' ? 'Ctrl' : 'Alt'}
                </button>
              ))}
              <button
                type="button"
                aria-label="Afficher le clavier"
                className="grid h-11 min-w-11 place-items-center"
                onClick={focus}
              >
                <Keyboard size={16} />
              </button>
              <button
                type="button"
                aria-label="Composer un message"
                aria-expanded={composerOpen}
                className="grid h-11 min-w-11 place-items-center"
                onClick={() => setComposerOpen(value => !value)}
              >
                <Pencil size={16} />
              </button>
            </div>
            {mic.available && (
              <div className="flex shrink-0 items-center bg-card">
                <button
                  type="button"
                  aria-label={mic.state === 'off' ? 'Activer le micro' : 'Désactiver le micro'}
                  aria-pressed={mic.state !== 'off'}
                  className="grid h-11 w-11 place-items-center"
                  onClick={toggleMic}
                >
                  <Mic size={16} />
                </button>
                <TalkButton
                  key={targetKey}
                  disabled={!claudeActive || mic.state !== 'on' || workspaceConnection !== 'connected'}
                  onHold={holdSpace}
                  readScreen={readScreen}
                  onSubmit={submitPrompt}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {(toolbarError || toolbarFeedback) && (
        <p className="px-2 text-xs" role={toolbarError ? 'alert' : 'status'}>
          {toolbarError || toolbarFeedback}
        </p>
      )}

      {contextMenu && (
        <TerminalContextMenu
          position={contextMenu}
          canCopy={hasSelection}
          canPaste={canPaste}
          onCopy={() => void copy().catch(() => {})}
          onPaste={() => void paste().catch(() => {})}
          onFind={openSearch}
          onFontSize={adjustFontSize}
          onScrollToBottom={scrollToBottom}
          showScrollToBottom={!isAtBottom || hasNewOutput}
          onSelectAll={() => {
            selectAll()
            focus()
          }}
          onClose={() => {
            setContextMenu(null)
            focus()
          }}
        />
      )}
    </div>
  )
}
