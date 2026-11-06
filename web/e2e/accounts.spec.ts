import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const baseURL = 'http://localhost:17659'
const binaryPath = resolve(process.cwd(), '../dist/tmuxatlas')
let server: ChildProcessWithoutNullStreams | undefined
let testHome = ''
let tmuxTmpDir = ''
let serverEnv: NodeJS.ProcessEnv = {}

test.beforeAll(async () => {
  testHome = await mkdtemp(join(tmpdir(), 'tmuxatlas-accounts-home-'))
  tmuxTmpDir = await mkdtemp(join(tmpdir(), 'tmuxatlas-accounts-tmux-'))

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: testHome,
    XDG_CONFIG_HOME: join(testHome, '.config'),
    XDG_DATA_HOME: join(testHome, '.local', 'share'),
    XDG_STATE_HOME: join(testHome, '.local', 'state'),
    TMUX_TMPDIR: tmuxTmpDir,
    TMUXATLAS_AUTH: 'accounts',
  }
  delete env.TMUX
  delete env.TMUX_PANE
  delete env.TMUXATLAS_NO_AUTH
  serverEnv = env

  execFileSync('tmux', ['new-session', '-d', '-s', 'free-session'], { env })

  execFileSync(
    binaryPath,
    ['users', 'bootstrap-admin', '--username', 'admin', '--password-stdin'],
    {
      env,
      input: 'admin-password-123\n',
    },
  )

  server = spawn(
    binaryPath,
    ['server', '--listen', '127.0.0.1:17659', '--public-url', baseURL],
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(`${baseURL}/api/auth/status`)
          if (!response.ok) return null
          return await response.json()
        } catch {
          return null
        }
      },
      { timeout: 15_000 },
    )
    .toMatchObject({ mode: 'accounts', authenticated: false })
})

test.afterAll(async () => {
  server?.kill('SIGTERM')
  try {
    execFileSync('tmux', ['kill-server'], { env: serverEnv, stdio: 'ignore' })
  } catch {
    // ignore if tmux server already stopped
  }
  if (testHome) await rm(testHome, { recursive: true, force: true })
  if (tmuxTmpDir) await rm(tmuxTmpDir, { recursive: true, force: true })
})

test('mode accounts : parcours complet admin, alice et bob, isolation, attribution, révocation et accessibilité axe', async ({
  page,
  browser,
}) => {
  // 1. Page de login + contrôle axe sans violation sérieuse
  await page.goto(baseURL)
  await expect(page.getByLabel('Nom d’utilisateur')).toBeVisible()
  await expect(page.getByLabel('Mot de passe')).toBeVisible()

  const loginAxe = await new AxeBuilder({ page }).analyze()
  expect(
    loginAxe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([])

  // 2. Admin se connecte, ouvre /admin, contrôle axe et crée alice et bob
  await page.getByLabel('Nom d’utilisateur').fill('admin')
  await page.getByLabel('Mot de passe').fill('admin-password-123')
  await page.getByRole('button', { name: 'Se connecter' }).click()

  await expect(page.getByRole('button', { name: 'Administration' })).toBeVisible()
  await page.getByRole('button', { name: 'Administration' }).click()
  await expect(page).toHaveURL(`${baseURL}/admin`)
  await expect(
    page.getByText(
      'Tous les comptes partagent le même utilisateur système du serveur. Un terminal donne ses droits.',
    ),
  ).toBeVisible()

  const adminAxe = await new AxeBuilder({ page }).analyze()
  expect(
    adminAxe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([])

  // Libérer free-session (initialement migrée vers admin au premier démarrage) pour en faire une session libre
  const initialFreeRow = page.getByTestId('admin-session-row-free-session')
  await expect(initialFreeRow).toBeVisible()
  await initialFreeRow.getByRole('button', { name: 'Libérer' }).click()
  await expect(initialFreeRow).toContainText('Libre')

  // Création d'alice
  await page.getByLabel('Nom d’utilisateur').fill('alice')
  await page.getByLabel('Mot de passe', { exact: true }).fill('alice-password-123')
  await page.getByLabel('Confirmer le mot de passe').fill('alice-password-123')
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  await expect(page.getByTestId('admin-user-row-alice')).toBeVisible()

  // Création de bob
  await page.getByLabel('Nom d’utilisateur').fill('bob')
  await page.getByLabel('Mot de passe', { exact: true }).fill('bob-password-123')
  await page.getByLabel('Confirmer le mot de passe').fill('bob-password-123')
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  await expect(page.getByTestId('admin-user-row-bob')).toBeVisible()

  // 3. Alice se connecte, n'a pas d'entrée Administration, crée une session et la voit
  const aliceContext = await browser.newContext()
  const alicePage = await aliceContext.newPage()
  const aliceForbiddenCalls: string[] = []
  alicePage.on('response', response => {
    const url = response.url()
    if (
      response.status() === 403
    ) {
      aliceForbiddenCalls.push(`${response.status()} ${url}`)
    }
  })

  await alicePage.goto(baseURL)
  await alicePage.getByLabel('Nom d’utilisateur').fill('alice')
  await alicePage.getByLabel('Mot de passe').fill('alice-password-123')
  await alicePage.getByRole('button', { name: 'Se connecter' }).click()

  await expect(alicePage.getByRole('button', { name: 'Nouvelle session' }).first()).toBeVisible()
  await expect(alicePage.getByRole('button', { name: 'Administration' })).toHaveCount(0)
  await expect(alicePage.getByRole('button', { name: 'Monitoring' }).first()).toBeVisible()
  await alicePage.getByRole('button', { name: 'Monitoring' }).first().click()
  await expect(alicePage).toHaveURL(`${baseURL}/monitoring`)
  await expect(alicePage.getByRole('heading', { name: 'Monitoring', level: 1 })).toBeVisible()
  await alicePage.goto(baseURL)

  await alicePage.getByRole('button', { name: 'Nouvelle session' }).first().click()
  const dialog = alicePage.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Nom de la session').fill('alice-session')
  await dialog.getByRole('button', { name: 'Créer' }).click()

  await expect(alicePage).toHaveURL(/\/session\/[^/]+\/alice-session$/)
  const aliceSessionUrl = alicePage.url()

  await alicePage.goto(baseURL)
  await expect(alicePage.getByText('alice-session').first()).toBeVisible()
  await expect(alicePage.getByTestId('session-owner-badge').first()).toHaveText('alice')
  expect(aliceForbiddenCalls).toEqual([])

  // 4. Bob se connecte, ne voit pas alice-session, son URL directe est refusée, et s'assigne free-session
  const bobContext = await browser.newContext()
  const bobPage = await bobContext.newPage()
  await bobPage.goto(baseURL)
  await bobPage.getByLabel('Nom d’utilisateur').fill('bob')
  await bobPage.getByLabel('Mot de passe').fill('bob-password-123')
  await bobPage.getByRole('button', { name: 'Se connecter' }).click()

  // Le propriétaire est une étiquette : Bob voit et ouvre la session d'Alice.
  await expect(bobPage.getByText('alice-session').first()).toBeVisible()
  await bobPage.goto(aliceSessionUrl)
  await expect(bobPage).toHaveURL(aliceSessionUrl)
  await expect(bobPage.locator('.xterm')).toBeVisible()
  await bobPage.goto(baseURL)

  // Bob s'assigne la session libre depuis son badge
  await bobPage.getByRole('button', { name: /Changer le propriétaire de free-session/ }).first().click()
  await bobPage.getByRole('menuitem', { name: 'bob' }).click()
  await expect(bobPage.getByRole('button', { name: /Changer le propriétaire de free-session/ }).first()).toContainText('bob')

  // 5. Admin voit les propriétaires des sessions, puis désactive bob et la page de bob repart au login
  await page.reload()
  const aliceSessionRow = page.getByTestId('admin-session-row-alice-session')
  const freeSessionRow = page.getByTestId('admin-session-row-free-session')
  await expect(aliceSessionRow).toContainText('alice')
  await expect(freeSessionRow).toContainText('bob')

  const bobUserRow = page.getByTestId('admin-user-row-bob')
  await bobUserRow.getByRole('button', { name: 'Désactiver' }).click()
  await expect(bobUserRow).toContainText('Désactivé')

  await expect(bobPage.getByLabel('Nom d’utilisateur')).toBeVisible({ timeout: 10_000 })
  await expect(bobPage.getByRole('button', { name: 'Se connecter' })).toBeVisible()

  await aliceContext.close()
  await bobContext.close()
})
