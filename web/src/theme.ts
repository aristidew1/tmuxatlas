export const toolColors: Record<string, string> = {
  claude: '#d97757',
  codex: '#66e088',
  copilot: '#66b3ff',
  opencode: '#bc8cff',
}

export const statusConfig: Record<string, { color: string; label: string; icon?: string; bg?: string }> = {
  active: {
    color: 'var(--status-running)',
    label: 'En cours',
    bg: 'color-mix(in oklch, var(--status-running) 8%, transparent)',
  },
  waiting: {
    color: 'var(--warning)',
    label: 'En attente',
    icon: '●',
    bg: 'color-mix(in oklch, var(--warning) 8%, transparent)',
  },
  error: {
    color: 'var(--destructive)',
    label: 'Erreur',
    icon: '!',
    bg: 'color-mix(in oklch, var(--destructive) 8%, transparent)',
  },
  completed: {
    color: 'var(--status-done)',
    label: 'Terminé',
    icon: '✓',
    bg: 'color-mix(in oklch, var(--success) 8%, transparent)',
  },
}

/**
 * Shared semantic aliases intentionally reference the existing preset tokens.
 * This keeps custom themes backwards compatible while giving Workspace chrome
 * one stable vocabulary instead of repeating brand colors in components.
 */
export const semanticThemeVars: Readonly<Record<string, string>> = {
  '--surface-canvas': 'var(--background)',
  '--surface-raised': 'var(--card)',
  '--surface-overlay': 'var(--popover)',
  '--surface-inset': 'var(--muted)',
  '--surface-hover': 'color-mix(in oklch, var(--foreground) 6%, var(--card))',
  '--surface-active': 'color-mix(in oklch, var(--primary) 12%, var(--card))',
  '--text-primary': 'var(--foreground)',
  '--text-secondary': 'var(--muted-foreground)',
  '--text-on-accent': 'var(--primary-foreground)',
  '--elevation-sm': '0 1px 2px color-mix(in oklch, var(--background) 48%, transparent)',
  '--elevation-md': '0 8px 24px color-mix(in oklch, var(--background) 58%, transparent)',
  '--elevation-lg': '0 18px 48px color-mix(in oklch, var(--background) 68%, transparent)',
  '--focus-ring': 'var(--ring)',
  '--focus-ring-width': '2px',
  '--focus-ring-offset': '2px',
  '--motion-fast': '120ms',
  '--motion-normal': '180ms',
  '--motion-slow': '240ms',
  '--motion-ease': 'cubic-bezier(0.2, 0, 0, 1)',
  '--control-height-sm': '2rem',
  '--control-height-md': '2.5rem',
  '--control-height-lg': '2.75rem',
  '--control-target-min': '44px',
  '--terminal-chrome': 'var(--card)',
  '--terminal-chrome-foreground': 'var(--card-foreground)',
  '--terminal-chrome-muted': 'var(--muted)',
  '--terminal-chrome-border': 'var(--border)',
  '--terminal-chrome-shadow': 'inset 0 0 20px color-mix(in oklch, var(--primary) 8%, transparent)',
  '--status-info': 'var(--primary)',
  '--status-running': 'var(--secondary-foreground)',
  '--status-waiting': 'var(--warning)',
  '--status-done': 'var(--muted-foreground)',
  '--status-error': 'var(--destructive)',
  '--status-idle': 'var(--muted-foreground)',
  '--status-offline': 'var(--muted-foreground)',
}

/** Sharp corners and monospace type for the original terminal-style presets. */
const legacyChromeVars: Readonly<Record<string, string>> = {
  '--radius': '0.25rem',
  '--theme-font-body': 'var(--font-mono)',
  '--theme-font-body-weight': '700',
  '--theme-font-heading': 'var(--font-mono)',
  '--theme-font-heading-weight': '700',
  '--mon-a': 'oklch(0.62 0.13 235)',
  '--mon-b': 'oklch(0.66 0.14 55)',
}

/** Semantic tokens a preset may deliberately override instead of inheriting the shared alias. */
export const overridableSemanticTokens: ReadonlySet<string> = new Set([
  '--terminal-chrome-shadow',
  '--elevation-sm',
  '--elevation-md',
  '--elevation-lg',
])

/** Warm, softly rounded chrome shared by both Claude-inspired presets. */
const claudeChromeVars: Readonly<Record<string, string>> = {
  '--radius': '0.625rem',
  '--theme-font-body': 'var(--font-sans)',
  '--theme-font-body-weight': '400',
  '--theme-font-heading': "'Source Serif 4', ui-serif, Georgia, serif",
  '--theme-font-heading-weight': '500',
  '--terminal-chrome-shadow': 'none',
}

export const DEFAULT_THEME = 'atlas'

export interface ThemePreset {
  name: string
  label: string
  cssVars: Record<string, string>
  xterm: {
    background: string
    foreground: string
    cursor: string
    cursorAccent: string
    selectionBackground: string
    black: string
    red: string
    green: string
    yellow: string
    blue: string
    magenta: string
    cyan: string
    white: string
    brightBlack: string
    brightRed: string
    brightGreen: string
    brightYellow: string
    brightBlue: string
    brightMagenta: string
    brightCyan: string
    brightWhite: string
  }
}

export const themePresets: Record<string, ThemePreset> = {
  atlas: {
    name: 'atlas',
    label: 'Atlas',
    cssVars: {
      '--background': 'oklch(0.173 0.009 264.3)', // #0e1014
      '--foreground': 'oklch(0.931 0.006 264.5)', // #e6e8ec
      '--card': 'oklch(0.213 0.013 264.3)', // #16191f
      '--card-foreground': 'oklch(0.931 0.006 264.5)',
      '--popover': 'oklch(0.243 0.015 261.7)', // #1c2027
      '--popover-foreground': 'oklch(0.931 0.006 264.5)',
      '--primary': 'oklch(0.727 0.129 245.3)', // #5aaef2
      '--primary-foreground': 'oklch(0.163 0.012 260.6)', // #0b0e13
      '--secondary': 'oklch(0.277 0.022 265.8)', // #232833
      '--secondary-foreground': 'oklch(0.794 0.016 260.7)', // #b6bcc6
      '--muted': 'oklch(0.195 0.011 260.7)', // #12151a
      '--muted-foreground': 'oklch(0.688 0.019 261.3)', // #949ba7
      '--accent': 'oklch(0.808 0.088 243.9)', // #8fc7f5
      '--accent-foreground': 'oklch(0.163 0.012 260.6)',
      '--destructive': 'oklch(0.697 0.164 29.4)', // #f2705f
      '--destructive-foreground': 'oklch(0.163 0.012 260.6)',
      '--border': 'oklch(0.309 0.019 264.2)', // #2b303a
      '--input': 'oklch(0.186 0.011 260.6)', // #101318
      '--ring': 'oklch(0.727 0.129 245.3)',
      '--success': 'oklch(0.735 0.136 159.3)', // #4cc38a
      '--warning': 'oklch(0.805 0.133 86.4)', // #e5b94e
      '--sidebar': 'oklch(0.159 0.009 264.3)', // #0b0d11
      '--sidebar-foreground': 'oklch(0.931 0.006 264.5)',
      '--sidebar-primary': 'oklch(0.727 0.129 245.3)',
      '--sidebar-primary-foreground': 'oklch(0.163 0.012 260.6)',
      '--sidebar-accent': 'oklch(0.213 0.013 264.3)',
      '--sidebar-accent-foreground': 'oklch(0.931 0.006 264.5)',
      '--sidebar-border': 'oklch(0.309 0.019 264.2)',
      '--sidebar-ring': 'oklch(0.727 0.129 245.3)',
      '--chart-primary': 'oklch(0.697 0.14 248.5)', // #4ea3f0
      '--chart-secondary': 'oklch(0.717 0.144 300)', // #b28df0
      ...semanticThemeVars,
      '--radius': '0.5rem',
      '--theme-font-body': 'var(--font-sans)',
      '--theme-font-body-weight': '400',
      '--theme-font-heading': 'var(--font-sans)',
      '--theme-font-heading-weight': '600',
      '--terminal-chrome-shadow': 'none',
      '--mon-a': 'oklch(0.637 0.135 242.9)', // #2e93d6
      '--mon-b': 'oklch(0.666 0.128 4.6)', // #d4708a
    },
    xterm: {
      background: '#0e1014',
      foreground: '#d5d9e0',
      cursor: '#5aaef2',
      cursorAccent: '#0e1014',
      selectionBackground: 'rgba(90, 174, 242, 0.28)',
      black: '#1c2027',
      red: '#f2705f',
      green: '#4cc38a',
      yellow: '#e5b94e',
      blue: '#5aaef2',
      magenta: '#c49af0',
      cyan: '#5cc8d6',
      white: '#b6bcc6',
      brightBlack: '#6b7280',
      brightRed: '#f79386',
      brightGreen: '#74d6a6',
      brightYellow: '#efcd78',
      brightBlue: '#8fc7f5',
      brightMagenta: '#d7b8f5',
      brightCyan: '#8ad9e3',
      brightWhite: '#f3f4f6',
    },
  },
  'claude-dark': {
    name: 'claude-dark',
    label: 'Claude sombre',
    cssVars: {
      '--background': 'oklch(0.268 0.004 106.6)', // #262624
      '--foreground': 'oklch(0.982 0.005 95.1)', // #faf9f5
      '--card': 'oklch(0.308 0.004 106.6)', // #30302e
      '--card-foreground': 'oklch(0.982 0.005 95.1)',
      '--popover': 'oklch(0.308 0.004 106.6)',
      '--popover-foreground': 'oklch(0.982 0.005 95.1)',
      '--primary': 'oklch(0.70 0.125 39)', // #e08162
      '--primary-foreground': 'oklch(0.214 0.002 67.7)', // #1a1918
      '--secondary': 'oklch(0.345 0.005 91.5)', // #3a3936
      '--secondary-foreground': 'oklch(0.807 0.014 97.5)', // #c2c0b6
      '--muted': 'oklch(0.236 0.002 67.7)', // #1f1e1d
      '--muted-foreground': 'oklch(0.72 0.012 95.2)', // #a3a199
      '--accent': 'oklch(0.75 0.076 56.2)', // #d4a27f
      '--accent-foreground': 'oklch(0.214 0.002 67.7)',
      '--destructive': 'oklch(0.71 0.14 26)', // #ec7c73
      '--destructive-foreground': 'oklch(0.214 0.002 67.7)',
      '--border': 'oklch(0.386 0.008 97.5)', // #45443f
      '--input': 'oklch(0.236 0.002 67.7)',
      '--ring': 'oklch(0.70 0.125 39)',
      '--success': 'oklch(0.744 0.115 133.2)', // #8fbc6f
      '--warning': 'oklch(0.767 0.124 76.5)', // #e0a84f
      '--sidebar': 'oklch(0.236 0.002 67.7)',
      '--sidebar-foreground': 'oklch(0.982 0.005 95.1)',
      '--sidebar-primary': 'oklch(0.70 0.125 39)',
      '--sidebar-primary-foreground': 'oklch(0.214 0.002 67.7)',
      '--sidebar-accent': 'oklch(0.308 0.004 106.6)',
      '--sidebar-accent-foreground': 'oklch(0.982 0.005 95.1)',
      '--sidebar-border': 'oklch(0.386 0.008 97.5)',
      '--sidebar-ring': 'oklch(0.70 0.125 39)',
      '--chart-primary': 'oklch(0.70 0.125 39)',
      '--chart-secondary': 'oklch(0.674 0.09 249.3)', // #6a9bcc
      ...semanticThemeVars,
      ...claudeChromeVars,
      '--mon-a': 'oklch(0.66 0.133 40.1)', // #d57350
      '--mon-b': 'oklch(0.659 0.112 250.6)', // #5a96d4
    },
    xterm: {
      background: '#1f1e1d',
      foreground: '#e8e6dc',
      cursor: '#d97757',
      cursorAccent: '#1f1e1d',
      selectionBackground: 'rgba(217, 119, 87, 0.3)',
      black: '#30302e',
      red: '#e5736a',
      green: '#8fbc6f',
      yellow: '#e0a84f',
      blue: '#6a9bcc',
      magenta: '#c48bb8',
      cyan: '#74b5ad',
      white: '#c2c0b6',
      brightBlack: '#85837b',
      brightRed: '#f09088',
      brightGreen: '#a8cf8a',
      brightYellow: '#edc077',
      brightBlue: '#8ab4dc',
      brightMagenta: '#d8a6ce',
      brightCyan: '#94cbc4',
      brightWhite: '#faf9f5',
    },
  },
  'claude-light': {
    name: 'claude-light',
    label: 'Claude clair',
    cssVars: {
      '--background': 'oklch(0.982 0.005 95.1)', // #faf9f5
      '--foreground': 'oklch(0.191 0.002 106.6)', // #141413
      '--card': 'oklch(1 0 0)',
      '--card-foreground': 'oklch(0.191 0.002 106.6)',
      '--popover': 'oklch(1 0 0)',
      '--popover-foreground': 'oklch(0.191 0.002 106.6)',
      '--primary': 'oklch(0.556 0.139 39.6)', // #b5512d
      '--primary-foreground': 'oklch(1 0 0)',
      '--secondary': 'oklch(0.924 0.014 97.5)', // #e8e6dc
      '--secondary-foreground': 'oklch(0.359 0.005 106.7)', // #3d3d3a
      '--muted': 'oklch(0.948 0.011 95.2)', // #f0eee6
      '--muted-foreground': 'oklch(0.523 0.009 99)', // #6b6a64
      '--accent': 'oklch(0.542 0.111 51.2)', // #a15a2c
      '--accent-foreground': 'oklch(1 0 0)',
      '--destructive': 'oklch(0.519 0.167 25.1)', // #b53333
      '--destructive-foreground': 'oklch(1 0 0)',
      '--border': 'oklch(0.893 0.015 98.3)', // #dedcd1
      '--input': 'oklch(1 0 0)',
      '--ring': 'oklch(0.556 0.139 39.6)',
      '--success': 'oklch(0.501 0.107 136)', // #46712f
      '--warning': 'oklch(0.519 0.103 76.1)', // #8a5f10
      '--sidebar': 'oklch(0.966 0.009 100)', // #f5f4ed
      '--sidebar-foreground': 'oklch(0.191 0.002 106.6)',
      '--sidebar-primary': 'oklch(0.556 0.139 39.6)',
      '--sidebar-primary-foreground': 'oklch(1 0 0)',
      '--sidebar-accent': 'oklch(0.924 0.014 97.5)',
      '--sidebar-accent-foreground': 'oklch(0.191 0.002 106.6)',
      '--sidebar-border': 'oklch(0.893 0.015 98.3)',
      '--sidebar-ring': 'oklch(0.556 0.139 39.6)',
      '--chart-primary': 'oklch(0.556 0.139 39.6)',
      '--chart-secondary': 'oklch(0.529 0.092 250)', // #3f6f9f
      ...semanticThemeVars,
      ...claudeChromeVars,
      // Semantic elevation mixes --background, which would produce invisible pale shadows here.
      '--elevation-sm': '0 1px 2px oklch(0.191 0.002 106.6 / 8%)',
      '--elevation-md': '0 8px 24px oklch(0.191 0.002 106.6 / 10%)',
      '--elevation-lg': '0 18px 48px oklch(0.191 0.002 106.6 / 14%)',
      '--mon-a': 'oklch(0.556 0.139 39.6)', // #b5512d
      '--mon-b': 'oklch(0.531 0.119 250.8)', // #2f6fae
    },
    xterm: {
      background: '#faf9f5',
      foreground: '#3d3d3a',
      cursor: '#b5512d',
      cursorAccent: '#faf9f5',
      selectionBackground: 'rgba(181, 81, 45, 0.2)',
      black: '#3d3d3a',
      red: '#b53333',
      green: '#46712f',
      yellow: '#8a5f10',
      blue: '#3f6f9f',
      magenta: '#8f4f85',
      cyan: '#2f7670',
      white: '#e8e6dc',
      brightBlack: '#6b6a64',
      brightRed: '#c94f45',
      brightGreen: '#568a3a',
      brightYellow: '#a3741a',
      brightBlue: '#4f85ba',
      brightMagenta: '#a5639b',
      brightCyan: '#3a8f88',
      brightWhite: '#141413',
    },
  },
  'retro-blue': {
    name: 'retro-blue',
    label: 'CRT bleu rétro',
    cssVars: {
      '--background': 'oklch(0.08 0.02 250)',
      '--foreground': 'oklch(0.78 0.12 230)',
      '--card': 'oklch(0.1 0.02 250)',
      '--card-foreground': 'oklch(0.78 0.12 230)',
      '--popover': 'oklch(0.1 0.02 250)',
      '--popover-foreground': 'oklch(0.78 0.12 230)',
      '--primary': 'oklch(0.72 0.15 230)',
      '--primary-foreground': 'oklch(0.08 0.02 250)',
      '--secondary': 'oklch(0.15 0.03 250)',
      '--secondary-foreground': 'oklch(0.68 0.1 230)',
      '--muted': 'oklch(0.12 0.02 250)',
      '--muted-foreground': 'oklch(0.58 0.08 230)',
      '--accent': 'oklch(0.7 0.15 200)',
      '--accent-foreground': 'oklch(0.08 0.02 250)',
      '--destructive': 'oklch(0.62 0.2 25)',
      '--destructive-foreground': 'oklch(0.08 0.02 250)',
      '--border': 'oklch(0.28 0.08 230)',
      '--input': 'oklch(0.12 0.02 250)',
      '--ring': 'oklch(0.72 0.15 230)',
      '--success': 'oklch(0.65 0.15 145)',
      '--warning': 'oklch(0.65 0.15 80)',
      '--sidebar': 'oklch(0.06 0.02 250)',
      '--sidebar-foreground': 'oklch(0.78 0.12 230)',
      '--sidebar-primary': 'oklch(0.72 0.15 230)',
      '--sidebar-primary-foreground': 'oklch(0.08 0.02 250)',
      '--sidebar-accent': 'oklch(0.15 0.03 250)',
      '--sidebar-accent-foreground': 'oklch(0.78 0.12 230)',
      '--sidebar-border': 'oklch(0.28 0.08 230)',
      '--sidebar-ring': 'oklch(0.72 0.15 230)',
      '--chart-primary': 'oklch(0.72 0.12 230)',
      '--chart-secondary': 'oklch(0.72 0.12 300)',
      ...legacyChromeVars,
      ...semanticThemeVars,
    },
    xterm: {
      background: '#0a0a1a',
      foreground: '#66b3ff',
      cursor: '#66b3ff',
      cursorAccent: '#0a0a1a',
      selectionBackground: 'rgba(102, 179, 255, 0.25)',
      black: '#1a1a3a',
      red: '#ff7b72',
      green: '#66e088',
      yellow: '#e6c866',
      blue: '#66b3ff',
      magenta: '#c4a0ff',
      cyan: '#66d9e8',
      white: '#b8c4d0',
      brightBlack: '#3a3a5a',
      brightRed: '#ffa198',
      brightGreen: '#7ee8a0',
      brightYellow: '#f0d880',
      brightBlue: '#80c4ff',
      brightMagenta: '#d4b8ff',
      brightCyan: '#80e8f0',
      brightWhite: '#d0dce8',
    },
  },
  dark: {
    name: 'dark',
    label: 'Sombre',
    cssVars: {
      '--background': 'oklch(0.1 0 0)',
      '--foreground': 'oklch(0.85 0 0)',
      '--card': 'oklch(0.13 0 0)',
      '--card-foreground': 'oklch(0.85 0 0)',
      '--popover': 'oklch(0.13 0 0)',
      '--popover-foreground': 'oklch(0.85 0 0)',
      '--primary': 'oklch(0.7 0.1 210)',
      '--primary-foreground': 'oklch(0.1 0 0)',
      '--secondary': 'oklch(0.18 0 0)',
      '--secondary-foreground': 'oklch(0.7 0 0)',
      '--muted': 'oklch(0.15 0 0)',
      '--muted-foreground': 'oklch(0.55 0 0)',
      '--accent': 'oklch(0.65 0.1 210)',
      '--accent-foreground': 'oklch(0.1 0 0)',
      '--destructive': 'oklch(0.55 0.2 25)',
      '--destructive-foreground': 'oklch(0.95 0 0)',
      '--border': 'oklch(0.25 0 0)',
      '--input': 'oklch(0.15 0 0)',
      '--ring': 'oklch(0.7 0.1 210)',
      '--success': 'oklch(0.65 0.15 145)',
      '--warning': 'oklch(0.65 0.15 80)',
      '--sidebar': 'oklch(0.08 0 0)',
      '--sidebar-foreground': 'oklch(0.85 0 0)',
      '--sidebar-primary': 'oklch(0.7 0.1 210)',
      '--sidebar-primary-foreground': 'oklch(0.1 0 0)',
      '--sidebar-accent': 'oklch(0.18 0 0)',
      '--sidebar-accent-foreground': 'oklch(0.85 0 0)',
      '--sidebar-border': 'oklch(0.25 0 0)',
      '--sidebar-ring': 'oklch(0.7 0.1 210)',
      '--chart-primary': 'oklch(0.65 0.1 210)',
      '--chart-secondary': 'oklch(0.65 0.1 310)',
      ...legacyChromeVars,
      ...semanticThemeVars,
    },
    xterm: {
      background: '#1a1a1a',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      cursorAccent: '#1a1a1a',
      selectionBackground: 'rgba(212, 212, 212, 0.2)',
      black: '#1a1a1a',
      red: '#f44747',
      green: '#6a9955',
      yellow: '#d7ba7d',
      blue: '#569cd6',
      magenta: '#c586c0',
      cyan: '#4ec9b0',
      white: '#d4d4d4',
      brightBlack: '#808080',
      brightRed: '#f44747',
      brightGreen: '#6a9955',
      brightYellow: '#d7ba7d',
      brightBlue: '#569cd6',
      brightMagenta: '#c586c0',
      brightCyan: '#4ec9b0',
      brightWhite: '#e5e5e5',
    },
  },
  light: {
    name: 'light',
    label: 'Clair',
    cssVars: {
      '--background': 'oklch(0.97 0 0)',
      '--foreground': 'oklch(0.2 0 0)',
      '--card': 'oklch(1 0 0)',
      '--card-foreground': 'oklch(0.2 0 0)',
      '--popover': 'oklch(1 0 0)',
      '--popover-foreground': 'oklch(0.2 0 0)',
      '--primary': 'oklch(0.45 0.12 250)',
      '--primary-foreground': 'oklch(0.98 0 0)',
      '--secondary': 'oklch(0.92 0 0)',
      '--secondary-foreground': 'oklch(0.35 0 0)',
      '--muted': 'oklch(0.94 0 0)',
      '--muted-foreground': 'oklch(0.5 0 0)',
      '--accent': 'oklch(0.5 0.12 250)',
      '--accent-foreground': 'oklch(0.98 0 0)',
      '--destructive': 'oklch(0.5 0.2 25)',
      '--destructive-foreground': 'oklch(0.98 0 0)',
      '--border': 'oklch(0.85 0 0)',
      '--input': 'oklch(0.94 0 0)',
      '--ring': 'oklch(0.45 0.12 250)',
      '--success': 'oklch(0.5 0.15 145)',
      '--warning': 'oklch(0.55 0.15 80)',
      '--sidebar': 'oklch(0.95 0 0)',
      '--sidebar-foreground': 'oklch(0.2 0 0)',
      '--sidebar-primary': 'oklch(0.45 0.12 250)',
      '--sidebar-primary-foreground': 'oklch(0.98 0 0)',
      '--sidebar-accent': 'oklch(0.9 0 0)',
      '--sidebar-accent-foreground': 'oklch(0.2 0 0)',
      '--sidebar-border': 'oklch(0.85 0 0)',
      '--sidebar-ring': 'oklch(0.45 0.12 250)',
      '--chart-primary': 'oklch(0.5 0.12 250)',
      '--chart-secondary': 'oklch(0.5 0.12 310)',
      ...legacyChromeVars,
      ...semanticThemeVars,
    },
    xterm: {
      background: '#ffffff',
      foreground: '#383a42',
      cursor: '#383a42',
      cursorAccent: '#ffffff',
      selectionBackground: 'rgba(56, 58, 66, 0.15)',
      black: '#383a42',
      red: '#e45649',
      green: '#50a14f',
      yellow: '#c18401',
      blue: '#4078f2',
      magenta: '#a626a4',
      cyan: '#0184bc',
      white: '#fafafa',
      brightBlack: '#a0a1a7',
      brightRed: '#e45649',
      brightGreen: '#50a14f',
      brightYellow: '#c18401',
      brightBlue: '#4078f2',
      brightMagenta: '#a626a4',
      brightCyan: '#0184bc',
      brightWhite: '#ffffff',
    },
  },
  'green-phosphor': {
    name: 'green-phosphor',
    label: 'Phosphore vert',
    cssVars: {
      '--background': 'oklch(0.08 0.02 140)',
      '--foreground': 'oklch(0.75 0.15 145)',
      '--card': 'oklch(0.1 0.02 140)',
      '--card-foreground': 'oklch(0.75 0.15 145)',
      '--popover': 'oklch(0.1 0.02 140)',
      '--popover-foreground': 'oklch(0.75 0.15 145)',
      '--primary': 'oklch(0.7 0.18 145)',
      '--primary-foreground': 'oklch(0.08 0.02 140)',
      '--secondary': 'oklch(0.15 0.03 140)',
      '--secondary-foreground': 'oklch(0.65 0.12 145)',
      '--muted': 'oklch(0.12 0.02 140)',
      '--muted-foreground': 'oklch(0.5 0.08 145)',
      '--accent': 'oklch(0.65 0.15 145)',
      '--accent-foreground': 'oklch(0.08 0.02 140)',
      '--destructive': 'oklch(0.55 0.2 25)',
      '--destructive-foreground': 'oklch(0.95 0 0)',
      '--border': 'oklch(0.25 0.06 145)',
      '--input': 'oklch(0.12 0.02 140)',
      '--ring': 'oklch(0.7 0.18 145)',
      '--success': 'oklch(0.65 0.15 145)',
      '--warning': 'oklch(0.65 0.15 80)',
      '--sidebar': 'oklch(0.06 0.02 140)',
      '--sidebar-foreground': 'oklch(0.75 0.15 145)',
      '--sidebar-primary': 'oklch(0.7 0.18 145)',
      '--sidebar-primary-foreground': 'oklch(0.08 0.02 140)',
      '--sidebar-accent': 'oklch(0.15 0.03 140)',
      '--sidebar-accent-foreground': 'oklch(0.75 0.15 145)',
      '--sidebar-border': 'oklch(0.25 0.06 145)',
      '--sidebar-ring': 'oklch(0.7 0.18 145)',
      '--chart-primary': 'oklch(0.7 0.18 145)',
      '--chart-secondary': 'oklch(0.65 0.15 200)',
      ...legacyChromeVars,
      ...semanticThemeVars,
    },
    xterm: {
      background: '#0a1a0a',
      foreground: '#33ff33',
      cursor: '#33ff33',
      cursorAccent: '#0a1a0a',
      selectionBackground: 'rgba(51, 255, 51, 0.2)',
      black: '#0a1a0a',
      red: '#ff5555',
      green: '#33ff33',
      yellow: '#ffff55',
      blue: '#55aaff',
      magenta: '#ff55ff',
      cyan: '#55ffff',
      white: '#aaffaa',
      brightBlack: '#225522',
      brightRed: '#ff8888',
      brightGreen: '#66ff66',
      brightYellow: '#ffff88',
      brightBlue: '#88ccff',
      brightMagenta: '#ff88ff',
      brightCyan: '#88ffff',
      brightWhite: '#ccffcc',
    },
  },
  midnight: {
    name: 'midnight',
    label: 'Minuit',
    cssVars: {
      // Core
      '--background': 'oklch(0.145 0 0)', // #0a0a0a
      '--foreground': 'oklch(0.922 0 0)', // #e5e5e5
      '--card': 'oklch(0.205 0 0)', // #1a1a1a
      '--card-foreground': 'oklch(0.922 0 0)', // #e5e5e5
      '--popover': 'oklch(0.205 0 0)', // #1a1a1a
      '--popover-foreground': 'oklch(0.922 0 0)', // #e5e5e5
      '--primary': 'oklch(0.623 0.214 259)', // #3b82f6
      '--primary-foreground': 'oklch(0.145 0 0)', // #0a0a0a
      '--secondary': 'oklch(0.250 0 0)', // #262626
      '--secondary-foreground': 'oklch(0.708 0 0)', // #a3a3a3
      '--muted': 'oklch(0.195 0 0)', // #171717
      '--muted-foreground': 'oklch(0.556 0 0)', // #737373
      '--accent': 'oklch(0.685 0.143 175)', // #14b8a6
      '--accent-foreground': 'oklch(0.145 0 0)', // #0a0a0a
      '--destructive': 'oklch(0.637 0.237 25)', // #ef4444
      '--destructive-foreground': 'oklch(0.985 0 0)', // #fafafa
      '--border': 'oklch(0.265 0 0)', // #2a2a2a
      '--input': 'oklch(0.195 0 0)', // #171717
      '--ring': 'oklch(0.623 0.214 259)', // #3b82f6
      '--success': 'oklch(0.685 0.143 175)', // #14b8a6
      '--warning': 'oklch(0.768 0.185 70)', // #f59e0b

      // Chart
      '--chart-primary': 'oklch(0.623 0.214 259)', // #3b82f6
      '--chart-secondary': 'oklch(0.685 0.143 175)', // #14b8a6

      // Sidebar
      '--sidebar': 'oklch(0.145 0 0)', // #0a0a0a
      '--sidebar-foreground': 'oklch(0.922 0 0)', // #e5e5e5
      '--sidebar-primary': 'oklch(0.623 0.214 259)', // #3b82f6
      '--sidebar-primary-foreground': 'oklch(0.145 0 0)', // #0a0a0a
      '--sidebar-accent': 'oklch(0.250 0 0)', // #262626
      '--sidebar-accent-foreground': 'oklch(0.922 0 0)', // #e5e5e5
      '--sidebar-border': 'oklch(0.265 0 0)', // #2a2a2a
      '--sidebar-ring': 'oklch(0.623 0.214 259)', // #3b82f6
      ...legacyChromeVars,
      ...semanticThemeVars,
    },
    xterm: {
      background: '#0a0a0a',
      foreground: '#e5e5e5',
      cursor: '#3b82f6',
      cursorAccent: '#0a0a0a',
      selectionBackground: 'rgba(59, 130, 246, 0.3)',
      black: '#171717',
      red: '#ef4444',
      green: '#14b8a6',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#a855f7',
      cyan: '#22d3ee',
      white: '#e5e5e5',
      brightBlack: '#737373',
      brightRed: '#f87171',
      brightGreen: '#2dd4bf',
      brightYellow: '#fbbf24',
      brightBlue: '#60a5fa',
      brightMagenta: '#c084fc',
      brightCyan: '#67e8f9',
      brightWhite: '#fafafa',
    },
  },
}

const lightThemes: ReadonlySet<string> = new Set(['light', 'claude-light'])

/**
 * Converts any CSS colour to #rrggbb. Browsers keep oklch() in computed styles,
 * so anything other than rgb() has to be rasterised to read its sRGB value.
 */
export function cssColorToHex(color: string): string | null {
  const toHex = (channels: number[]) => `#${channels.map(n => n.toString(16).padStart(2, '0')).join('')}`
  const rgb = color.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (rgb) return toHex([+rgb[1], +rgb[2], +rgb[3]])
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return null
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
  return toHex([red, green, blue])
}

export function applyTheme(themeName: string, customTheme?: Record<string, string>) {
  const theme = themePresets[themeName] || themePresets[DEFAULT_THEME]
  const root = document.documentElement
  root.style.colorScheme = lightThemes.has(theme.name) ? 'light' : 'dark'
  for (const [key, value] of Object.entries(theme.cssVars)) {
    root.style.setProperty(key, value)
  }
  // Apply custom overrides on top of preset
  if (customTheme) {
    for (const [key, value] of Object.entries(customTheme)) {
      if (value) root.style.setProperty(key, value)
    }
  }
}

export function getXtermTheme(themeName: string) {
  const theme = themePresets[themeName] || themePresets[DEFAULT_THEME]
  return theme.xterm
}
