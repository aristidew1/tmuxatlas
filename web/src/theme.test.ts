import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, cssColorToHex, DEFAULT_THEME, themePresets } from './theme'

afterEach(() => vi.restoreAllMocks())

describe('cssColorToHex', () => {
  it('reads rgb() and rgba() strings directly', () => {
    expect(cssColorToHex('rgb(217, 119, 87)')).toBe('#d97757')
    expect(cssColorToHex('rgba(1, 2, 3, 0.5)')).toBe('#010203')
    expect(cssColorToHex('rgb(217 119 87)')).toBe('#d97757')
  })

  it('rasterises formats that browsers keep as-is, such as oklch()', () => {
    const context = {
      fillStyle: '',
      fillRect: vi.fn(),
      getImageData: () => ({ data: [217, 119, 87, 255] }),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    expect(cssColorToHex('oklch(0.672 0.131 38.8)')).toBe('#d97757')
    expect(context.fillStyle).toBe('oklch(0.672 0.131 38.8)')
  })

  it('returns null when no 2D context is available', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(cssColorToHex('oklch(0.5 0.1 40)')).toBeNull()
  })
})

describe('applyTheme color scheme', () => {
  it('follows the luminosity of the preset for native controls', () => {
    applyTheme('claude-light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    applyTheme('claude-dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})

it('conserve les identifiants des thèmes et affiche leurs noms français', () => {
  expect(Object.values(themePresets).map(theme => theme.label)).toEqual([
    'Atlas',
    'Claude sombre',
    'Claude clair',
    'CRT bleu rétro',
    'Sombre',
    'Clair',
    'Phosphore vert',
    'Minuit',
  ])
  expect(DEFAULT_THEME).toBe('atlas')
})
