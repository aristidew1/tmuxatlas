import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { capturePTY } from './ptyCapture'

const baseURL = 'http://localhost:17658'
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
let server: ChildProcessWithoutNullStreams
let testHome: string

const preferences = {
  terminal: { font_size: 13, font_family: 'Space Mono', scrollback: 5000 },
  theme: 'retro-blue',
  custom_theme: {},
  sidebar: { default_collapsed: false, hidden_sessions: [], collapse_mode: 'small' },
  default_view: 'overview',
  notifications: { statuses: ['waiting', 'error', 'completed'] },
  agent_banner: { auto_dismiss_seconds: 0 },
  quick_switcher_shortcut: 'ctrl+k',
  sparklines_visible: true,
  overview_refresh_interval: 5,
  timestamp_format: 'relative',
  lock_timeout_minutes: 0,
  lock_background_faster: false,
  lock_background_minutes: 10,
  fullscreen_hide_alerts: true,
}

function workspaceSnapshot() {
  return {
    type: 'snapshot',
    schema_version: 1,
    instance_id: 'workspace-e2e',
    revision: 7,
    state: {
      hosts: {
        'host/host-alpha': { key: 'host/host-alpha', id: 'host-alpha', display_name: 'Alpha', online: true, local: true },
        'host/host-beta': { key: 'host/host-beta', id: 'host-beta', display_name: 'Beta', online: true, local: false },
        'host/host-offline': { key: 'host/host-offline', id: 'host-offline', display_name: 'Offline Host', online: false, local: false },
      },
      sessions: {
        'session/host-alpha/work': { key: 'session/host-alpha/work', host_key: 'host/host-alpha', host_id: 'host-alpha', name: 'work', attached: true, last_activity: '2026-07-27T02:00:00Z' },
        'session/host-alpha/done': { key: 'session/host-alpha/done', host_key: 'host/host-alpha', host_id: 'host-alpha', name: 'done', attached: false, last_activity: '2026-07-26T02:00:00Z' },
        'session/host-beta/work': { key: 'session/host-beta/work', host_key: 'host/host-beta', host_id: 'host-beta', name: 'work', attached: false, last_activity: '2026-07-27T03:00:00Z' },
        'session/host-offline/sleep': { key: 'session/host-offline/sleep', host_key: 'host/host-offline', host_id: 'host-offline', name: 'sleep', attached: false, last_activity: '2026-07-25T02:00:00Z' },
      },
      windows: {
        'window/host-alpha/work/0': { key: 'window/host-alpha/work/0', session_key: 'session/host-alpha/work', tmux_id: '@1', name: 'shell', index: 0, active: true },
        'window/host-alpha/work/1': { key: 'window/host-alpha/work/1', session_key: 'session/host-alpha/work', tmux_id: '@5', name: 'editor', index: 1, active: false },
        'window/host-alpha/done/0': { key: 'window/host-alpha/done/0', session_key: 'session/host-alpha/done', tmux_id: '@2', name: 'shell', index: 0, active: true },
        'window/host-beta/work/0': { key: 'window/host-beta/work/0', session_key: 'session/host-beta/work', tmux_id: '@3', name: 'review', index: 0, active: true },
        'window/host-offline/sleep/0': { key: 'window/host-offline/sleep/0', session_key: 'session/host-offline/sleep', tmux_id: '@4', name: 'shell', index: 0, active: true },
      },
      panes: {
        'pane/host-alpha/work/0/0': { key: 'pane/host-alpha/work/0/0', window_key: 'window/host-alpha/work/0', tmux_id: '%1', index: 0, active: true, width: 120, height: 32, current_command: 'codex', pid: 100 },
        'pane/host-alpha/done/0/0': { key: 'pane/host-alpha/done/0/0', window_key: 'window/host-alpha/done/0', tmux_id: '%2', index: 0, active: true, width: 120, height: 32, current_command: 'zsh', pid: 101 },
        'pane/host-beta/work/0/0': { key: 'pane/host-beta/work/0/0', window_key: 'window/host-beta/work/0', tmux_id: '%3', index: 0, active: true, width: 120, height: 32, current_command: 'claude', pid: 102 },
        'pane/host-offline/sleep/0/0': { key: 'pane/host-offline/sleep/0/0', window_key: 'window/host-offline/sleep/0', tmux_id: '%4', index: 0, active: true, width: 120, height: 32, current_command: 'zsh', pid: 103 },
      },
      tool_events: {
        'tool/host-alpha/work/0/%1': { key: 'tool/host-alpha/work/0/%1', host_id: 'host-alpha', session: 'work', window: '0', pane: '%1', tool: 'codex', status: 'waiting', message: 'Approval required', timestamp: '2026-07-27T03:01:00Z' },
        'tool/host-beta/work/0/%3': { key: 'tool/host-beta/work/0/%3', host_id: 'host-beta', session: 'work', window: '0', pane: '%3', tool: 'claude', status: 'error', message: 'Command failed', timestamp: '2026-07-27T03:02:00Z' },
      },
      activity: {
        'activity/host-alpha/work': { key: 'activity/host-alpha/work', host_id: 'host-alpha', session: 'work', timestamp: '2026-07-27T03:01:00Z', data: { idle_seconds: 0, sparkline: [0, 2, 4, 1], total_bytes: 1234 } },
      },
      health: {},
      metadata: { server: { version: 'workspace-e2e' } },
    },
  }
}

interface StateHarness {
  sockets: WebSocketRoute[]
  pauseSnapshots: boolean
  sendSnapshot(socket?: WebSocketRoute): void
}

async function installWorkspaceMocks(page: Page): Promise<StateHarness> {
  let savedPreferences = structuredClone(preferences)
  await page.route('**/api/preferences', async route => {
    if (route.request().method() === 'PUT') savedPreferences = route.request().postDataJSON()
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(savedPreferences) })
  })
  await page.route('**/api/agent-status', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ agents: [], setup_command: 'tmuxatlas setup' }),
  }))

  const harness: StateHarness = {
    sockets: [],
    pauseSnapshots: false,
    sendSnapshot(socket) {
      const target = socket || this.sockets[this.sockets.length - 1]
      target?.send(JSON.stringify(workspaceSnapshot()))
    },
  }
  await page.routeWebSocket('**/ws/events?schema=1', socket => {
    harness.sockets.push(socket)
    if (!harness.pauseSnapshots) harness.sendSnapshot(socket)
  })
  return harness
}

async function waitForServer() {
  await expect.poll(async () => {
    try { return (await fetch(`${baseURL}/api/version`)).ok } catch { return false }
  }).toBe(true)
}

test.beforeAll(async () => {
  testHome = await mkdtemp(join(tmpdir(), 'tmuxatlas-workspace-e2e-'))
  server = spawn(resolve(process.cwd(), '..', 'dist', 'tmuxatlas'), [
    'server', '--listen', '127.0.0.1:17658', '--public-url', baseURL,
    '--discovery-interval', '60', '--no-auth',
  ], { env: { ...process.env, HOME: testHome, XDG_CONFIG_HOME: join(testHome, 'config'), XDG_DATA_HOME: join(testHome, 'data'), XDG_CACHE_HOME: join(testHome, 'cache'), XDG_RUNTIME_DIR: join(testHome, 'runtime') } })
  await waitForServer()
})

test.afterAll(async () => {
  server?.kill('SIGTERM')
  await rm(testHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test('Chromium Workspace covers navigation, Terminal tools, recovery, feedback, Zen isolation and accessibility', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      if (kind === 'webgl2') return null
      return (getContext as Function).call(this, kind, ...args)
    } as typeof getContext
  })
  const state = await installWorkspaceMocks(page)
  const pty = await capturePTY(page)
  await page.goto(baseURL)

  // Sidebar owns every Session under exactly one expandable canonical Host.
  await expect(page.getByRole('button', { name: 'Replier les sessions de Alpha' })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Replier les sessions de Beta' })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Replier les sessions de Offline Host' })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Ouvrir la session work sur Alpha, En attente' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Ouvrir la session work sur Beta, Erreur' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Ouvrir la session sleep sur Offline Host, Hors ligne' })).toHaveCount(1)
  await page.locator('[aria-label="Filtrer les sessions"]').getByRole('button', { name: /À traiter/ }).click()
  await expect(page.getByRole('button', { name: /Ouvrir la session work.*En attente/ })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Ouvrir la session done.*Inactif/ })).toHaveCount(0)
  await page.locator('[aria-label="Filtrer les sessions"]').getByRole('button', { name: /Toutes/ }).click()

  // Rechercher resolves a same-name Session to its stable Host target.
  await page.keyboard.press(`${primaryModifier}+k`)
  const palette = page.getByRole('dialog', { name: 'Rechercher' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('Beta work')
  await palette.getByRole('option').filter({ hasText: 'work' }).filter({ hasText: 'Beta' }).first().click()
  await expect(page).toHaveURL(`${baseURL}/session/host-beta/work`)
  await expect.poll(() => Boolean(pty.latest({ hostId: 'host-beta', sessionName: 'work' }))).toBe(true)
  await expect(page.locator('.terminal-cockpit__header')).toContainText('Beta /')
  await expect(page.locator('.terminal-cockpit__header')).toContainText('Erreur')

  // Alert chrome and Sidebar navigation both keep the explicit Host identity.
  await page.getByRole('button', { name: 'Alertes (2)' }).click()
  await expect(page.getByRole('menu')).toContainText('codex')
  await expect(page.getByRole('menu')).toContainText('Approval required')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Ouvrir la session work sur Alpha, En attente' }).click()
  await expect(page).toHaveURL(`${baseURL}/session/host-alpha/work`)
  await expect.poll(() => Boolean(pty.latest({ hostId: 'host-alpha', sessionName: 'work' }))).toBe(true)
  const alphaPTY = pty.latest({ hostId: 'host-alpha', sessionName: 'work' })!
  alphaPTY.socket.send(Buffer.from('needle one\r\nneedle two\r\nready\r\n'))
  await expect(page.locator('.xterm-rows')).toContainText('needle')
  await expect(page.locator('.terminal-cockpit__header')).toContainText('Alpha /')
  await expect(page.locator('.terminal-cockpit__header')).toContainText('En attente')
  await expect(page.locator('.xterm-helper-textarea')).toBeAttached()

  const connectionCountBeforeCommands = pty.connections.length
  const binaryCountBeforeCommands = pty.binaryFrames(alphaPTY).length

  // Search loads on demand, reports results and closes without PTY input.
  await page.locator('.terminal-cockpit__header').getByRole('button', { name: 'Rechercher' }).click()
  const search = page.getByRole('search', { name: 'Rechercher dans le terminal' })
  await search.getByRole('searchbox', { name: 'Texte recherché' }).fill('needle')
  await expect(search).toContainText(/1 \/ 2/)
  await search.getByRole('button', { name: 'Résultat suivant' }).click()
  await search.getByRole('button', { name: 'Fermer la recherche' }).click()

  // Context menu remains keyboard-discoverable and can open the same Search UI.
  await page.locator('[data-terminal-surface]').click({ button: 'right', position: { x: 60, y: 40 } })
  const menu = page.getByRole('menu', { name: 'Actions du terminal' })
  await expect(menu.getByRole('menuitem', { name: 'Copier la sélection' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Rechercher dans le terminal' })).toBeEnabled()
  await menu.getByRole('menuitem', { name: 'Rechercher dans le terminal' }).click()
  await expect(page.getByRole('search', { name: 'Rechercher dans le terminal' })).toBeVisible()
  await page.getByRole('button', { name: 'Fermer la recherche' }).click()

  // Registered application shortcuts and Zen must neither reconnect nor leak bytes.
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.press(`${primaryModifier}+k`)
  const shortcutPalette = page.getByRole('dialog', { name: 'Rechercher' })
  await expect(shortcutPalette).toBeVisible()
  await expect(shortcutPalette.getByRole('combobox')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(shortcutPalette).toHaveCount(0)
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.press(`${primaryModifier}+Shift+f`)
  await expect(page.getByRole('button', { name: 'Plein écran' })).toBeVisible()
  await page.keyboard.press(`${primaryModifier}+Shift+f`)
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.press(`${primaryModifier}+Shift+z`)
  await expect(page.getByRole('button', { name: 'Quitter le mode Zen' })).toBeVisible()
  await expect(page.locator('header')).toHaveCount(0)
  await page.getByRole('button', { name: 'Quitter le mode Zen' }).click()
  expect(pty.connections).toHaveLength(connectionCountBeforeCommands)
  expect(pty.binaryFrames(alphaPTY)).toHaveLength(binaryCountBeforeCommands)

  // A PTY interruption reports a distinct state and an explicit retry opens one new generation.
  await alphaPTY.socket.close({ code: 1012, reason: 'workspace e2e reconnect' })
  await expect(page.getByText('Terminal déconnecté. Reconnexion…')).toBeVisible()
  await page.getByRole('button', { name: 'Réessayer' }).click()
  await expect.poll(() => pty.connections.length).toBe(connectionCountBeforeCommands + 1)
  await expect(page.locator('.xterm-helper-textarea')).toBeAttached()

  // Hub state reconnection keeps the PTY target alive while exposing global recovery status.
  state.pauseSnapshots = true
  await state.sockets[state.sockets.length - 1].close({ code: 1012, reason: 'workspace e2e state reconnect' })
  await expect(page.getByRole('status').filter({ hasText: /Connexion perdue|Synchronisation du Hub/ })).toBeVisible()
  await expect.poll(() => state.sockets.length).toBeGreaterThan(1)
  state.pauseSnapshots = false
  await expect.poll(async () => {
    state.sendSnapshot()
    return page.getByText(/Connexion perdue|Synchronisation du Hub/).count()
  }).toBe(0)
  await expect(page.locator('.terminal-cockpit__header')).toContainText('Alpha /')

  // A real Preferences mutation announces both inline state and Toast feedback.
  await page.getByTitle('Réglages').click()
  await expect(page.getByRole('heading', { name: 'Réglages' })).toBeVisible()
  await page.locator('#terminal').getByRole('switch').click()
  await expect(page.getByText('Réglages enregistrés', { exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Enregistré' }).first()).toBeVisible()

  // Main desktop Workspace must have no critical or serious Axe violations.
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Vue d’ensemble' }).click()
  await page.getByRole('button', { name: 'Ouvrir la session work sur Alpha, En attente' }).click()
  await expect(page.locator('.terminal-cockpit__header')).toContainText('Alpha /')
  const accessibility = await new AxeBuilder({ page }).include('.app-shell').analyze()
  const blocking = accessibility.violations.filter(violation => (
    violation.impact === 'critical' || violation.impact === 'serious'
  ))
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
})


test('Atlas routes, AZERTY shortcut and window tabs preserve their targets', async ({ page }) => {
  await installWorkspaceMocks(page)
  const pty = await capturePTY(page)
  const mutations: unknown[] = []
  await page.route('**/api/session/select-window', async route => {
    mutations.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.goto(`${baseURL}/wall`)
  await expect(page.getByRole('heading', { name: 'Mur' })).toBeVisible()
  await page.getByRole('button', { name: 'Monitoring', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/monitoring`)
  await page.goto(`${baseURL}/session/host-beta/work`)
  const beta = await pty.waitForConnection({ hostId: 'host-beta', sessionName: 'work' })
  const before = pty.binaryFrames(beta).length
  await page.locator('.xterm-helper-textarea').focus()
  await page.locator('.xterm-helper-textarea').dispatchEvent('keydown', {
    key: '&', code: 'Digit1', altKey: true, bubbles: true, cancelable: true,
  })
  await expect(page).toHaveURL(`${baseURL}/session/host-alpha/done`)
  expect(pty.binaryFrames(beta)).toHaveLength(before)
  await page.getByRole('button', { name: 'Ouvrir la session work sur Alpha, En attente' }).click()
  await page.getByRole('tab', { name: '1 editor' }).click()
  await expect.poll(() => mutations).toContainEqual({ host_id: 'host-alpha', session: 'work', window: 1 })
})

for (const status of [200, 409]) {
  test(`Inbox keyboard navigation and quick reply (${status})`, async ({ page }) => {
    const state = await installWorkspaceMocks(page)
    let previews = 0
    const dismissals: unknown[] = []
    await page.route('**/api/tool-event', async route => {
      dismissals.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, body: '{}' })
      const snapshot = workspaceSnapshot()
      Reflect.deleteProperty(snapshot.state.tool_events, 'tool/host-alpha/work/0/%1')
      snapshot.revision++
      state.sockets.at(-1)?.send(JSON.stringify(snapshot))
    })
    const replies: unknown[] = []
    await page.route('**/api/session/preview?**', async route => {
      previews++
      await route.fulfill({ json: {
        pane: '%1', window: 0, lines: ['Confirmer ?'],
        prompt: { is_prompt: true, message: 'Confirmer ?', options: [{ key: 'y', label: 'Oui' }], fingerprint: 'fp-1' },
      } })
    })
    await page.route('**/api/session/reply', async route => {
      replies.push(route.request().postDataJSON())
      await route.fulfill({ status, json: status === 409 ? { code: 'prompt_changed', message: 'changed' } : {} })
    })
    await page.goto(baseURL)
    const rows = page.locator('[data-inbox-row]')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('j')
    await expect(rows.nth(1)).toBeFocused()
    await expect(rows.nth(1)).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('k')
    await expect(rows.nth(0)).toBeFocused()
    await expect(rows.nth(0)).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('j')
    await rows.nth(1).locator('..').getByRole('button', { name: 'y Oui' }).click()
    await expect.poll(() => replies).toEqual([{ host_id: 'host-alpha', session: 'work', pane: '%1', key: 'y', fingerprint: 'fp-1' }])
    await expect(page.getByRole('status').filter({ hasText: status === 200 ? 'Réponse envoyée' : 'La question a changé' })).toBeVisible()
    await expect.poll(() => previews).toBeGreaterThan(2)
    if (status === 409) {
      await expect(rows).toHaveCount(2)
      expect(dismissals).toHaveLength(0)
    } else {
      await expect.poll(() => dismissals).toContainEqual({
        host: 'host-alpha', session: 'work', window: 0, pane: '%1',
      })
    }
  })
}
