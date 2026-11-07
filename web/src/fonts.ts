import '@fontsource-variable/geist/wght.css'
import '@fontsource/vt323/latin-400.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import '@fontsource/source-serif-4/latin-500.css'

const bundledTerminalFonts: Record<string, () => Promise<unknown>> = {
  'Space Mono': async () => {
    await Promise.all([import('@fontsource/space-mono/latin-400.css'), import('@fontsource/space-mono/latin-700.css')])
  },
  'JetBrains Mono': async () => {},
  'Fira Code': async () => {
    await Promise.all([import('@fontsource/fira-code/latin-400.css'), import('@fontsource/fira-code/latin-700.css')])
  },
}

export const bundledFontNames = Object.keys(bundledTerminalFonts)

export async function ensureTerminalFont(name: string): Promise<boolean> {
  const loader = bundledTerminalFonts[name]
  if (!loader) return false
  await loader()
  // Normal and bold are separate files: wait for both, as well as the fallback
  // fonts the terminal needs for symbols, before anything is drawn with them.
  await Promise.all(
    [`13px "${name}"`, `bold 13px "${name}"`, '13px "JetBrains Mono"', '13px "Symbols Nerd Font Mono"'].map(font =>
      document.fonts?.load(font),
    ),
  )
  return true
}
