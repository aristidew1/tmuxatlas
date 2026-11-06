import { useState, useEffect, useCallback, useRef } from 'react'
import { usePreferences, type Preferences } from '../hooks/usePreferences'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { cssColorToHex, themePresets, applyTheme } from '../theme'
import { cn } from '../lib/utils'
import { AgentStatusList, normalizeAgentStatus, SetupCommandBox, type StatusResult } from './Setup'
import { PasskeySettings } from './PasskeySettings'
import type { PWAInstallState } from '../hooks/usePWAInstall'
import { Button, ToastProvider, useToast } from './ui'
import { useApplicationState } from '../state/provider'
import { useHostLabel } from '../lib/hostLabel'
import { ChevronRight } from 'lucide-react'

const terminalFontFamilies = [
  'Space Mono',
  'JetBrains Mono',
  'Fira Code',
  'Menlo',
  'Monaco',
  'Consolas',
  'Courier New',
  'monospace',
]

const timestampFormats = [
  { value: 'relative', label: 'Relative (il y a 2 min)' },
  { value: 'absolute', label: 'Absolue (14:32:05)' },
]

const shortcutOptions = [
  { value: 'ctrl+k', label: 'Ctrl K / ⌘ K' },
  { value: 'ctrl+p', label: 'Ctrl P / ⌘ P' },
  { value: 'ctrl+space', label: 'Ctrl Espace' },
]

const notifStatuses = [
  { value: 'waiting', label: 'En attente' },
  { value: 'error', label: 'Erreur' },
  { value: 'completed', label: 'Terminé' },
]

// Customizable CSS variables exposed to users, grouped by purpose
const customizableVars = [
  { key: '--primary', label: 'Accent' },
  { key: '--background', label: 'Arrière-plan' },
  { key: '--foreground', label: 'Premier plan' },
  { key: '--border', label: 'Bordure' },
  { key: '--card', label: 'Carte' },
  { key: '--muted', label: 'Atténué' },
  { key: '--success', label: 'Succès' },
  { key: '--warning', label: 'Avertissement' },
  { key: '--destructive', label: 'Destruction' },
]

const sectionIds = ['appearance', 'terminal', 'interface', 'notifications', 'hosts', 'agents', 'security'] as const

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="atlas-surface rounded-lg p-5 scroll-mt-4">
      <h3 className="text-sm font-medium text-foreground mb-0.5">{title}</h3>
      {description && <p className="text-xs text-muted-foreground mb-4">{description}</p>}
      {!description && <div className="mb-4" />}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Divider() {
  return <div className="border-t border-border -mx-5 my-1" />
}

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="flex-1">
        <div className="text-sm text-foreground">{label}</div>
        {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-input border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary min-w-[160px]"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className="bg-input border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary w-[80px] text-right"
    />
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'pointer-events-none block h-4 w-4 rounded-full bg-foreground shadow-sm transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  )
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="color"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-8 h-6 rounded border border-border cursor-pointer bg-transparent"
    />
  )
}

// Resolve a CSS variable value (possibly oklch) to a hex color for the color picker
function resolvedColor(cssVar: string, customTheme: Record<string, string>): string {
  const override = customTheme[cssVar]
  if (override && override.startsWith('#')) return override
  // Read from computed style
  const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
  if (raw.startsWith('#')) return raw
  // Resolve through a temp element so var() references are followed
  const el = document.createElement('div')
  el.style.color = raw
  document.body.appendChild(el)
  const computed = getComputedStyle(el).color
  document.body.removeChild(el)
  return cssColorToHex(computed || raw) ?? '#888888'
}

const sectionLabels: Record<(typeof sectionIds)[number], string> = {
  appearance: 'Apparence',
  terminal: 'Terminal',
  interface: 'Interface',
  notifications: 'Notifications',
  hosts: 'Hôtes',
  agents: 'Agents',
  security: 'Sécurité',
}

interface SettingsProps {
  pushState: string
  onPushSubscribe: () => void
  onPushUnsubscribe: () => void
  onLogout?: () => void
  pwaInstall: PWAInstallState
}

function SettingsContent({ pushState, onPushSubscribe, onPushUnsubscribe, onLogout, pwaInstall }: SettingsProps) {
  const { prefs, updatePrefs, saveState, saveError, retrySave } = usePreferences()
  const { hosts } = useApplicationState()
  const hostLabel = useHostLabel()
  const { dismiss, toast } = useToast()
  const previousSaveState = useRef(saveState)
  const feedbackToast = useRef<string | null>(null)
  const [showCustomColors, setShowCustomColors] = useState(() => Object.keys(prefs.custom_theme || {}).length > 0)
  const [agentStatus, setAgentStatus] = useState<StatusResult | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)

  const fetchAgentStatus = useCallback(async () => {
    setAgentLoading(true)
    try {
      const res = await fetch('/api/agent-status')
      if (res.ok) setAgentStatus(normalizeAgentStatus(await res.json()))
    } catch {}
    setAgentLoading(false)
  }, [])

  useEffect(() => {
    fetchAgentStatus()
  }, [fetchAgentStatus])

  useEffect(() => {
    if (previousSaveState.current === saveState) return
    previousSaveState.current = saveState

    if (feedbackToast.current) {
      dismiss(feedbackToast.current)
      feedbackToast.current = null
    }

    if (saveState === 'saved') {
      feedbackToast.current = toast({
        title: 'Réglages enregistrés',
        description: 'Vos préférences sont à jour.',
        variant: 'success',
      })
    } else if (saveState === 'error') {
      feedbackToast.current = toast({
        title: 'Réglages non enregistrés',
        description: saveError ?? 'Vérifiez votre connexion et réessayez.',
        variant: 'error',
        duration: 0,
      })
    }
  }, [dismiss, saveError, saveState, toast])

  const update = async (partial: Partial<Preferences>) => {
    await updatePrefs(partial)
  }

  const updateNested = async <K extends keyof Preferences>(key: K, nested: Partial<Preferences[K]>) => {
    const current = prefs[key]
    await update({ [key]: { ...(typeof current === 'object' ? current : {}), ...nested } } as Partial<Preferences>)
  }

  const handleThemeChange = async (theme: string) => {
    applyTheme(theme, prefs.custom_theme)
    await update({ theme })
  }

  const handleCustomColorChange = async (cssVar: string, hex: string) => {
    const next = { ...(prefs.custom_theme || {}), [cssVar]: hex }
    applyTheme(prefs.theme, next)
    await update({ custom_theme: next })
  }

  const handleResetCustomColors = async () => {
    applyTheme(prefs.theme, {})
    await update({ custom_theme: {} })
    setShowCustomColors(false)
  }

  const toggleNotifStatus = async (status: string) => {
    const current = prefs.notifications.statuses
    const next = current.includes(status) ? current.filter(s => s !== status) : [...current, status]
    await updateNested('notifications', { statuses: next })
  }

  const visibleSections = onLogout ? sectionIds : sectionIds.filter(s => s !== 'security')
  const customTheme = prefs.custom_theme || {}
  const hasCustomColors = Object.values(customTheme).some(v => !!v)

  return (
    <div className="flex-1 p-6 overflow-y-auto ui-body-text text-sm" aria-busy={saveState === 'saving' || undefined}>
      <div className="max-w-2xl">
        <div className="flex items-start justify-between gap-4 mb-5">
          <h2 className="ui-heading-text text-2xl text-foreground">Réglages</h2>
          <div className="min-h-7 text-right">
            {saveState === 'saving' && (
              <span className="text-xs text-primary" role="status" aria-live="polite">
                Enregistrement…
              </span>
            )}
            {saveState === 'saved' && (
              <span className="text-xs text-success" role="status" aria-live="polite">
                Enregistré
              </span>
            )}
            {saveState === 'error' && (
              <div
                className="flex max-w-md flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs font-normal text-destructive"
                role="alert"
                aria-live="assertive"
              >
                <span>
                  <strong className="font-semibold">Les modifications n’ont pas été enregistrées.</strong>
                  {saveError && ` ${saveError}`}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="Réessayer d’enregistrer les préférences"
                  onClick={() => void retrySave()}
                >
                  Réessayer
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Jump nav */}
        <nav className="flex gap-1 mb-5 flex-wrap">
          {visibleSections.map(id => (
            <a
              key={id}
              href={`#${id}`}
              className="px-2.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {sectionLabels[id]}
            </a>
          ))}
        </nav>

        <div className="flex flex-col gap-4">
          {/* ── Apparence ── */}
          <Section id="appearance" title="Apparence" description="Thème, couleurs et format d’affichage">
            <div className="grid grid-cols-2 gap-2">
              {Object.values(themePresets).map(theme => (
                <button
                  key={theme.name}
                  onClick={() => handleThemeChange(theme.name)}
                  className={cn(
                    'p-3 rounded-lg border text-left transition-colors',
                    prefs.theme === theme.name
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-foreground hover:border-primary/40',
                  )}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className="w-4 h-4 rounded-full border border-border"
                      style={{ background: theme.xterm.background }}
                    />
                    <div
                      className="w-4 h-4 rounded-full border border-border"
                      style={{ background: theme.xterm.foreground }}
                    />
                    <div
                      className="w-4 h-4 rounded-full border border-border"
                      style={{ background: theme.xterm.blue }}
                    />
                    <div
                      className="w-4 h-4 rounded-full border border-border"
                      style={{ background: theme.xterm.green }}
                    />
                  </div>
                  <div className="text-sm font-semibold">{theme.label}</div>
                </button>
              ))}
            </div>

            <Divider />

            {/* Custom color overrides */}
            <div className="py-1">
              <button
                onClick={() => setShowCustomColors(v => !v)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <ChevronRight
                  size={14}
                  aria-hidden="true"
                  className={cn('transition-transform', showCustomColors && 'rotate-90')}
                />
                Couleurs personnalisées
                {hasCustomColors && <span className="text-xs text-primary">(actives)</span>}
              </button>
              {showCustomColors && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="grid grid-cols-3 gap-2">
                    {customizableVars.map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2">
                        <ColorInput
                          value={resolvedColor(key, customTheme)}
                          onChange={hex => handleCustomColorChange(key, hex)}
                        />
                        <span className="text-xs text-muted-foreground">{label}</span>
                      </div>
                    ))}
                  </div>
                  {hasCustomColors && (
                    <button
                      onClick={handleResetCustomColors}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors self-start mt-1"
                    >
                      Rétablir les couleurs du thème
                    </button>
                  )}
                </div>
              )}
            </div>

            <Divider />

            <Row label="Format des dates" description="Affichage des dates dans l’interface">
              <SelectInput
                value={prefs.timestamp_format}
                onChange={v => update({ timestamp_format: v })}
                options={timestampFormats}
              />
            </Row>
            <Row label="Actualisation de la vue d’ensemble" description="Intervalle d’actualisation en secondes">
              <NumberInput
                value={prefs.overview_refresh_interval}
                onChange={v => update({ overview_refresh_interval: Math.max(1, Math.min(60, v)) })}
                min={1}
                max={60}
              />
            </Row>
          </Section>

          {/* ── Terminal ── */}
          <Section id="terminal" title="Terminal" description="Police, historique et plein écran">
            <Row label="Police" description="Police à chasse fixe du terminal">
              <SelectInput
                value={prefs.terminal.font_family}
                onChange={v => updateNested('terminal', { font_family: v })}
                options={terminalFontFamilies.map(f => ({ value: f, label: f }))}
              />
            </Row>
            <Row label="Taille de police" description="Taille du texte en pixels">
              <NumberInput
                value={prefs.terminal.font_size}
                onChange={v => updateNested('terminal', { font_size: Math.max(8, Math.min(32, v)) })}
                min={8}
                max={32}
              />
            </Row>
            <Row label="Historique" description="Nombre de lignes à conserver">
              <NumberInput
                value={prefs.terminal.scrollback}
                onChange={v => updateNested('terminal', { scrollback: Math.max(100, Math.min(100000, v)) })}
                min={100}
                max={100000}
                step={500}
              />
            </Row>
            <Divider />
            <Row label="Masquer les alertes en plein écran" description="Masquer la bannière des agents en plein écran">
              <Toggle checked={prefs.fullscreen_hide_alerts} onChange={v => update({ fullscreen_hide_alerts: v })} />
            </Row>
          </Section>

          {/* ── Interface ── */}
          <Section id="interface" title="Interface" description="Disposition, barre latérale et raccourcis">
            <Row label="Vue par défaut" description="Vue affichée au démarrage">
              <SelectInput
                value={prefs.default_view}
                onChange={v => update({ default_view: v })}
                options={[
                  { value: 'overview', label: 'Vue d’ensemble' },
                  { value: 'last-session', label: 'Dernière session' },
                ]}
              />
            </Row>
            <Row label="Barre latérale par défaut" description="État de la barre au chargement">
              <Toggle
                checked={prefs.sidebar.default_collapsed}
                onChange={v => updateNested('sidebar', { default_collapsed: v })}
                label={prefs.sidebar.default_collapsed ? 'Repliée' : 'Déployée'}
              />
            </Row>
            <Row label="Mode de repli" description="Comportement de la barre repliée">
              <SelectInput
                value={prefs.sidebar.collapse_mode || 'small'}
                onChange={v => updateNested('sidebar', { collapse_mode: v })}
                options={[
                  { value: 'small', label: 'Colonne étroite' },
                  { value: 'hidden', label: 'Complètement masquée' },
                ]}
              />
            </Row>
            <Row label="Graphiques d’activité" description="Afficher les graphiques d’activité dans la barre">
              <Toggle checked={prefs.sparklines_visible} onChange={v => update({ sparklines_visible: v })} />
            </Row>
            <Divider />
            <Row label="Raccourci du sélecteur rapide" description="Raccourci clavier du sélecteur rapide">
              <SelectInput
                value={prefs.quick_switcher_shortcut}
                onChange={v => update({ quick_switcher_shortcut: v })}
                options={shortcutOptions}
              />
            </Row>
            <Divider />
            <div className="py-1.5" data-testid="pwa-install">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="text-sm text-foreground">Installer Atlas</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Ouvrir ce Hub dans une application autonome.
                  </div>
                </div>
                {pwaInstall.isStandalone ? (
                  <span className="text-xs text-success" data-testid="pwa-installed">
                    Installé
                  </span>
                ) : pwaInstall.canPrompt ? (
                  <button
                    type="button"
                    onClick={() => void pwaInstall.install()}
                    className="px-3 py-1.5 rounded text-xs border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                  >
                    Installer Atlas
                  </button>
                ) : pwaInstall.isAppleMobile ? (
                  <span className="text-xs text-muted-foreground">Installation manuelle</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Menu du navigateur</span>
                )}
              </div>
              {!pwaInstall.isStandalone && pwaInstall.isAppleMobile && (
                <p
                  className="mt-3 rounded border border-border bg-background p-3 text-xs text-muted-foreground"
                  data-testid="pwa-ios-guidance"
                >
                  Sur iPhone ou iPad, touchez Partager puis Sur l’écran d’accueil.
                </p>
              )}
              <div className="mt-2 text-xs text-muted-foreground" aria-live="polite">
                {pwaInstall.outcome === 'dismissed' &&
                  'Installation ignorée. Vous pourrez réessayer depuis votre navigateur.'}
                {pwaInstall.outcome === 'accepted' &&
                  'Installation acceptée. Atlas sera accessible depuis vos applications.'}
              </div>
            </div>
          </Section>

          {/* ── Notifications ── */}
          <Section id="notifications" title="Notifications" description="Notifications et événements des agents">
            <Row
              label="Notifications"
              description={
                pushState === 'unsupported'
                  ? 'Nécessite HTTPS ou localhost et un navigateur compatible'
                  : pushState === 'denied'
                    ? 'Bloquées par le navigateur : modifiez les réglages du site'
                    : pushState === 'subscribed'
                      ? 'Notifications des agents activées'
                      : 'Recevoir les alertes même lorsque l’onglet est fermé'
              }
            >
              {pushState === 'unsupported' ? (
                <span className="text-xs text-muted-foreground">Indisponible</span>
              ) : pushState === 'denied' ? (
                <span className="text-xs text-destructive">Bloqué</span>
              ) : (
                <Toggle
                  checked={pushState === 'subscribed'}
                  onChange={v => (v ? onPushSubscribe() : onPushUnsubscribe())}
                />
              )}
            </Row>
            <Row label="États déclenchant une alerte" description="Choisissez les états des agents à signaler">
              <div className="flex gap-2">
                {notifStatuses.map(s => (
                  <button
                    key={s.value}
                    onClick={() => toggleNotifStatus(s.value)}
                    className={cn(
                      'px-2.5 py-1 rounded text-xs border transition-colors',
                      prefs.notifications.statuses.includes(s.value)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Fermeture automatique" description="Délai en secondes avant fermeture (0 = manuelle)">
              <NumberInput
                value={prefs.agent_banner.auto_dismiss_seconds}
                onChange={v => updateNested('agent_banner', { auto_dismiss_seconds: Math.max(0, Math.min(300, v)) })}
                min={0}
                max={300}
              />
            </Row>
          </Section>

          <Section id="hosts" title="Hôtes" description="Donnez un nom facile à reconnaître à chaque hôte.">
            {hosts.length === 0 && <p className="text-xs text-muted-foreground">Aucun hôte disponible.</p>}
            {hosts.map(host => (
              <label key={host.id} title={host.id} className="flex min-h-11 items-center justify-between gap-4 text-sm">
                <span className="truncate">{hostLabel(host.id, host.name === host.id ? 'Hôte' : host.name)}</span>
                <input
                  aria-label={`Alias de ${host.name === host.id ? 'cet hôte' : host.name}`}
                  value={prefs.host_aliases?.[host.id] ?? ''}
                  placeholder={host.name === host.id ? 'Hôte' : host.name}
                  onChange={event => {
                    const aliases = { ...prefs.host_aliases }
                    if (event.target.value) aliases[host.id] = event.target.value
                    else delete aliases[host.id]
                    void update({ host_aliases: aliases })
                  }}
                  className="min-h-11 w-40 rounded bg-input px-2 text-sm ui-focus-ring"
                />
              </label>
            ))}
          </Section>

          {/* ── Agents ── */}
          <Section id="agents" title="Agents" description="Installation des agents et configuration des intégrations">
            {agentStatus ? (
              <div className="flex flex-col gap-3">
                <AgentStatusList agents={agentStatus.agents} />
                {agentStatus.setup_command ? (
                  <SetupCommandBox command={agentStatus.setup_command} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Ce Hub ne nécessite pas de configuration locale. Installez et associez un agent sur chaque hôte
                    tmux.
                  </p>
                )}
                <button
                  onClick={fetchAgentStatus}
                  disabled={agentLoading}
                  className="self-start px-3 py-1.5 rounded text-xs border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {agentLoading ? 'Vérification…' : 'Actualiser'}
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {agentLoading ? 'Vérification des agents…' : 'Impossible de charger l’état des agents.'}
              </p>
            )}
          </Section>

          {/* ── Sécurité ── */}
          {onLogout && (
            <Section id="security" title="Sécurité" description="Passkeys, verrouillage et déconnexion">
              <PasskeySettings />
              <Divider />
              <Row label="Délai de verrouillage" description="Déconnexion après inactivité (0 = désactivé)">
                <div className="flex items-center gap-2">
                  <NumberInput
                    value={prefs.lock_timeout_minutes}
                    onChange={v => update({ lock_timeout_minutes: Math.max(0, Math.min(120, v)) })}
                    min={0}
                    max={120}
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
              </Row>
              <Row
                label="Verrouiller plus vite en arrière-plan"
                description="Réduire le délai lorsque l’onglet est masqué"
              >
                <Toggle checked={prefs.lock_background_faster} onChange={v => update({ lock_background_faster: v })} />
              </Row>
              {prefs.lock_background_faster && (
                <Row label="Délai en arrière-plan" description="Délai d’inactivité lorsque l’onglet est masqué">
                  <div className="flex items-center gap-2">
                    <NumberInput
                      value={prefs.lock_background_minutes}
                      onChange={v => update({ lock_background_minutes: Math.max(1, Math.min(120, v)) })}
                      min={1}
                      max={120}
                    />
                    <span className="text-xs text-muted-foreground">min</span>
                  </div>
                </Row>
              )}
              <Divider />
              <Row label="Déconnexion" description="Terminer la session actuelle">
                <button
                  onClick={onLogout}
                  className="px-3 py-1.5 rounded text-sm border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                >
                  Se déconnecter
                </button>
              </Row>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

export function Settings(props: SettingsProps) {
  return (
    <ToastProvider>
      <SettingsContent {...props} />
    </ToastProvider>
  )
}
