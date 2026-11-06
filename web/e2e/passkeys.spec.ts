import {
  test,
  expect,
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from '@playwright/test'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const baseURL = 'http://localhost:17654'
let server: ChildProcessWithoutNullStreams
let testHome: string
let setupToken: string
let browser: Browser
let context: BrowserContext
let page: Page
let cdp: CDPSession
let authenticatorId: string
let socketPath: string

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${baseURL}/api/auth/status`)
      if (response.ok) return
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('TmuxAtlas E2E server did not become ready')
}

test.beforeAll(async () => {
  testHome = await mkdtemp(join(tmpdir(), 'tmuxatlas-e2e-'))
  socketPath = join(testHome, 'tmuxatlas.sock')
  const binary = resolve(process.cwd(), '..', 'dist', 'tmuxatlas')
  server = spawn(binary, [
    'server',
    '--listen', '127.0.0.1:17654',
    '--public-url', baseURL,
    '--socket', socketPath,
    '--discovery-interval', '60',
  ], {
    env: { ...process.env, HOME: testHome, XDG_CONFIG_HOME: join(testHome, 'config'), XDG_DATA_HOME: join(testHome, 'data'), XDG_CACHE_HOME: join(testHome, 'cache'), XDG_RUNTIME_DIR: join(testHome, 'runtime'), TMUXATLAS_NO_AUTH: 'false', TMUXATLAS_SESSION_TTL: '1h' },
  })
  let logs = ''
  const collect = (chunk: Buffer) => {
    logs += chunk.toString()
    const match = logs.match(/"setup_token":"([A-Za-z0-9_-]+)"/)
    if (match) setupToken = match[1]
  }
  server.stdout.on('data', collect)
  server.stderr.on('data', collect)
  await waitForServer()
  for (let attempt = 0; attempt < 50 && !setupToken; attempt++) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  if (!setupToken) throw new Error(`Setup token was not found in server logs:\n${logs}`)

  const initialToken = setupToken
  setupToken = await new Promise<string>((resolveToken, rejectToken) => {
    execFile(binary, ['bootstrap-token', '--socket', socketPath], {
      env: { ...process.env, HOME: testHome, XDG_CONFIG_HOME: join(testHome, 'config'), XDG_DATA_HOME: join(testHome, 'data'), XDG_CACHE_HOME: join(testHome, 'cache'), XDG_RUNTIME_DIR: join(testHome, 'runtime') },
    }, (error, stdout) => {
      if (error) rejectToken(error)
      else resolveToken(stdout.trim())
    })
  })
  const replay = await fetch(`${baseURL}/api/auth/passkey/register/begin`, {
    method: 'POST',
    headers: { Origin: baseURL, 'Content-Type': 'application/json' },
    body: JSON.stringify({ setup_token: initialToken, label: 'stale' }),
  })
  if (replay.status !== 401) {
    throw new Error(`Rotated bootstrap token replay returned ${replay.status}, want 401`)
  }

  browser = await chromium.launch()
  context = await browser.newContext()
  page = await context.newPage()
  cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const authenticator = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  authenticatorId = authenticator.authenticatorId
})

test.afterAll(async () => {
  await context?.close()
  await browser?.close()
  server?.kill('SIGTERM')
  await rm(testHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test('complete Passkey lifecycle and browser mutation protections', async ({ request }) => {
  await page.goto(baseURL)
  await page.getByPlaceholder('Jeton de configuration').fill(setupToken)
  await page.getByPlaceholder('Libellé de la passkey (facultatif)').fill('Primary')
  await page.getByRole('button', { name: 'Créer la passkey' }).click()

  await expect(page.getByRole('heading', { name: 'Configuration des agents' })).toBeVisible()
  await page.getByRole('button', { name: 'Suivant' }).click()
  await page.getByRole('button', { name: 'Accéder au tableau de bord' }).click()

  await page.getByTitle('Réglages').click()

  const authCheck = await page.evaluate(async () => fetch('/api/auth/check').then((response) => response.json()))
  expect(authCheck.csrf_token).toBeTruthy()
  const cookies = await context.cookies(baseURL)
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
  const preferences = await request.get(`${baseURL}/api/preferences`, {
    headers: { Cookie: cookieHeader },
  }).then((response) => response.json())
  const mutationHeaders = {
    Cookie: cookieHeader,
    'X-TmuxAtlas-CSRF': authCheck.csrf_token,
  }
  expect((await request.put(`${baseURL}/api/preferences`, {
    headers: { ...mutationHeaders, Origin: 'http://admin.localhost:17654' },
    data: preferences,
  })).status()).toBe(403)
  expect((await request.put(`${baseURL}/api/preferences`, {
    headers: mutationHeaders,
    data: preferences,
  })).status()).toBe(403)
  expect((await request.put(`${baseURL}/api/preferences`, {
    headers: { ...mutationHeaders, Origin: baseURL, 'Content-Type': 'text/plain' },
    data: JSON.stringify(preferences),
  })).status()).toBe(415)
  expect((await request.put(`${baseURL}/api/preferences`, {
    headers: { ...mutationHeaders, Origin: baseURL },
    data: preferences,
  })).status()).toBe(200)

  await expect(page.getByText('Primary', { exact: true })).toBeVisible()
  const registeredCredentials = await cdp.send('WebAuthn.getCredentials', { authenticatorId })
  expect(registeredCredentials.credentials).toHaveLength(1)
  expect(registeredCredentials.credentials[0].isResidentCredential).toBe(true)
  await page.getByRole('button', { name: 'Se déconnecter' }).click()
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true })
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
    authenticatorId,
    enabled: true,
  })
  await page.getByRole('button', { name: 'Se connecter avec une passkey' }).click()
  await page.getByTitle('Réglages').click()

  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
    authenticatorId,
    enabled: false,
  })
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'usb',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  await page.getByLabel('Nom de la nouvelle passkey').fill('Backup')
  await page.getByRole('button', { name: 'Ajouter une passkey' }).click()
  await expect(page.getByTestId('passkey-row')).toHaveCount(2)

  const backup = page.getByTestId('passkey-row').filter({ hasText: 'Backup' })
  await backup.getByRole('button', { name: 'Renommer' }).click()
  await page.getByLabel('Nom de la passkey', { exact: true }).fill('Travel key')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Travel key', { exact: true })).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  const primary = page.getByTestId('passkey-row').filter({ hasText: 'Primary' })
  await primary.getByRole('button', { name: 'Supprimer' }).click()
  await expect(page.getByTestId('passkey-row')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Supprimer' })).toBeDisabled()

  const finalDeleteStatus = await page.evaluate(async () => {
    const inventory = await fetch('/api/auth/passkeys').then((response) => response.json())
    return fetch(`/api/auth/passkeys/${encodeURIComponent(inventory.passkeys[0].id)}`, {
      method: 'DELETE',
    }).then((response) => response.status)
  })
  expect(finalDeleteStatus).toBe(409)
  await expect(page.getByText('Travel key', { exact: true })).toBeVisible()
})
