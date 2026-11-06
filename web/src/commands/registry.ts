export type CommandScope = 'overlay' | 'workspace' | 'terminal'

export type CommandCategory = 'Navigation' | 'Session' | 'Terminal' | 'Espace de travail' | 'Compte'

export type CommandId =
  | 'palette.open'
  | 'help.open'
  | 'navigation.overview'
  | 'navigation.settings'
  | 'navigation.monitoring'
  | 'navigation.wall'
  | 'session.next'
  | 'session.previous'
  | `session.select.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | 'session.new'
  | 'connection.reconnect'
  | 'terminal.fullscreen'
  | 'terminal.zen'
  | 'workspace.sidebar.toggle'
  | 'attention.next'
  | 'account.sign-out'

export interface CommandEnvironment {
  hasTerminalTarget: boolean
  canReconnect: boolean
  canSignOut: boolean
  hasAttention: boolean
}

export interface CommandHandlerContext {
  source: 'shortcut' | 'palette' | 'help' | 'button'
}

export type CommandHandler = (context: CommandHandlerContext) => void | Promise<void>

export interface CommandDefinition {
  id: CommandId
  label: string
  category: CommandCategory
  scope: CommandScope
  shortcut?: string
  focusAfterRun: 'restore' | 'terminal' | 'none'
  enablement: (environment: CommandEnvironment) => boolean
}

export interface RegisteredCommand extends Omit<CommandDefinition, 'enablement'> {
  enabled: boolean
  run: CommandHandler
}

export interface CreateCommandRegistryOptions {
  environment: CommandEnvironment
  handlers: Partial<Record<CommandId, CommandHandler>>
  quickSwitcherShortcut?: string
}

const always = () => true
const terminalOnly = (environment: CommandEnvironment) => environment.hasTerminalTarget

const definitions: readonly CommandDefinition[] = [
  {
    id: 'palette.open',
    label: 'Rechercher',
    category: 'Navigation',
    scope: 'overlay',
    shortcut: 'mod+k',
    focusAfterRun: 'restore',
    enablement: always,
  },
  {
    id: 'help.open',
    label: 'Raccourcis clavier',
    category: 'Navigation',
    scope: 'overlay',
    shortcut: 'mod+/',
    focusAfterRun: 'restore',
    enablement: always,
  },
  {
    id: 'navigation.overview',
    label: 'Vue d’ensemble',
    category: 'Navigation',
    scope: 'workspace',
    focusAfterRun: 'none',
    enablement: always,
  },
  {
    id: 'navigation.monitoring',
    label: 'Monitoring',
    category: 'Navigation',
    scope: 'workspace',
    focusAfterRun: 'none',
    enablement: always,
  },
  {
    id: 'navigation.wall',
    label: 'Mur',
    category: 'Navigation',
    scope: 'workspace',
    focusAfterRun: 'none',
    enablement: always,
  },
  {
    id: 'session.next',
    label: 'Session suivante',
    category: 'Session',
    scope: 'workspace',
    shortcut: 'alt+shift+arrowdown',
    focusAfterRun: 'terminal',
    enablement: always,
  },
  {
    id: 'session.previous',
    label: 'Session précédente',
    category: 'Session',
    scope: 'workspace',
    shortcut: 'alt+shift+arrowup',
    focusAfterRun: 'terminal',
    enablement: always,
  },
  ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map(n => ({
    id: `session.select.${n}` as const,
    label: `Session ${n}`,
    category: 'Session' as const,
    scope: 'workspace' as const,
    shortcut: `alt+${n}`,
    focusAfterRun: 'terminal' as const,
    enablement: always,
  })),
  {
    id: 'navigation.settings',
    label: 'Ouvrir les réglages',
    category: 'Navigation',
    scope: 'workspace',
    shortcut: 'mod+,',
    focusAfterRun: 'none',
    enablement: always,
  },
  {
    id: 'session.new',
    label: 'Nouvelle session',
    category: 'Session',
    scope: 'workspace',
    focusAfterRun: 'restore',
    enablement: always,
  },
  {
    id: 'connection.reconnect',
    label: 'Reconnecter le terminal',
    category: 'Terminal',
    scope: 'terminal',
    focusAfterRun: 'terminal',
    enablement: environment => environment.hasTerminalTarget && environment.canReconnect,
  },
  {
    id: 'terminal.fullscreen',
    label: 'Plein écran',
    category: 'Terminal',
    scope: 'terminal',
    shortcut: 'mod+shift+f',
    focusAfterRun: 'terminal',
    enablement: terminalOnly,
  },
  {
    id: 'terminal.zen',
    label: 'Mode Zen',
    category: 'Terminal',
    scope: 'terminal',
    shortcut: 'mod+shift+z',
    focusAfterRun: 'terminal',
    enablement: terminalOnly,
  },
  {
    id: 'workspace.sidebar.toggle',
    label: 'Replier la barre latérale',
    category: 'Espace de travail',
    scope: 'workspace',
    focusAfterRun: 'restore',
    enablement: always,
  },
  {
    id: 'attention.next',
    shortcut: 'alt+shift+n',
    label: 'Alerte suivante',
    category: 'Espace de travail',
    scope: 'workspace',
    focusAfterRun: 'terminal',
    enablement: always,
  },
  {
    id: 'account.sign-out',
    label: 'Verrouiller / Se déconnecter',
    category: 'Compte',
    scope: 'workspace',
    focusAfterRun: 'none',
    enablement: environment => environment.canSignOut,
  },
] as const

function normalizeConfiguredShortcut(shortcut: string | undefined): string {
  if (!shortcut) return 'mod+k'
  return shortcut
    .trim()
    .toLowerCase()
    .replace(/^ctrl\+/, 'mod+')
}

export function createCommandRegistry({
  environment,
  handlers,
  quickSwitcherShortcut,
}: CreateCommandRegistryOptions): RegisteredCommand[] {
  const paletteShortcut = normalizeConfiguredShortcut(quickSwitcherShortcut)
  return definitions.map(definition => ({
    ...definition,
    shortcut: definition.id === 'palette.open' ? paletteShortcut : definition.shortcut,
    enabled: definition.enablement(environment) && Boolean(handlers[definition.id]),
    run: handlers[definition.id] || (() => {}),
  }))
}

export function getCommand(commands: readonly RegisteredCommand[], id: CommandId) {
  return commands.find(command => command.id === id)
}

export function isMacPlatform(platform = typeof navigator === 'undefined' ? '' : navigator.platform): boolean {
  return /Mac|iPhone|iPad/i.test(platform)
}

export function formatShortcut(shortcut: string | undefined, mac = isMacPlatform()): string {
  if (!shortcut) return ''
  const labels: Record<string, string> = mac
    ? { mod: '⌘', ctrl: 'Ctrl', shift: '⇧', alt: '⌥', enter: '↵', space: 'Espace' }
    : { mod: 'Ctrl', ctrl: 'Ctrl', shift: 'Maj', alt: 'Alt', enter: 'Entrée', space: 'Espace' }
  return shortcut
    .split('+')
    .map(part => labels[part.toLowerCase()] || (part.length === 1 ? part.toUpperCase() : part))
    .join(' ')
}

export interface ShortcutEventLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
  preventDefault(): void
  stopPropagation(): void
  stopImmediatePropagation?: () => void
}

function shortcutMatches(event: ShortcutEventLike, shortcut: string, mac: boolean): boolean {
  const parts = shortcut.toLowerCase().split('+')
  const key = parts[parts.length - 1] || ''
  const wantsMod = parts.includes('mod')
  const wantsShift = parts.includes('shift')
  const wantsAlt = parts.includes('alt')
  const actualMod = mac ? event.metaKey : event.ctrlKey
  const wrongPlatformMod = mac ? event.ctrlKey : event.metaKey
  const eventKey = event.key.toLowerCase() === ' ' ? 'space' : event.key.toLowerCase()
  const keyMatches =
    wantsAlt && /^[1-9]$/.test(key)
      ? event.code === `Digit${key}`
      : wantsAlt && /^[a-z]$/.test(key)
        ? event.code === `Key${key.toUpperCase()}` || (!event.code && eventKey === key)
        : eventKey === key
  return (
    keyMatches &&
    actualMod === wantsMod &&
    !wrongPlatformMod &&
    event.shiftKey === wantsShift &&
    event.altKey === wantsAlt
  )
}

function commandAllowedInScope(command: RegisteredCommand, activeScope: CommandScope): boolean {
  if (activeScope === 'overlay') return command.scope === 'overlay'
  if (command.scope === 'overlay') return true
  return command.scope === activeScope || (activeScope === 'terminal' && command.scope === 'workspace')
}

export function dispatchCommandShortcut(
  event: ShortcutEventLike,
  commands: readonly RegisteredCommand[],
  activeScope: CommandScope,
  mac = isMacPlatform(),
): RegisteredCommand | null {
  if (event.defaultPrevented || (event.altKey && event.ctrlKey)) return null
  const command = commands.find(
    candidate =>
      candidate.enabled &&
      candidate.shortcut &&
      commandAllowedInScope(candidate, activeScope) &&
      shortcutMatches(event, candidate.shortcut, mac),
  )
  if (!command) return null

  // Capture before xterm's textarea listener. An executed application command must
  // result in zero PTY bytes, while an unregistered Ctrl key is left untouched.
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation?.()
  void command.run({ source: 'shortcut' })
  return command
}
