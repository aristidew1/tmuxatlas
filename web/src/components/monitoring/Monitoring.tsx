import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MiniTrend, TimeSeriesChart } from './TimeSeriesChart'
import { useMonitor } from './useMonitor'
import {
  formatBytes,
  formatCpuTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRate,
  formatRelative,
  hostOf,
} from './format'
import type {
  MonitorAlert,
  MonitorEndpoint,
  MonitorRange,
  MonitorResponse,
  MonitorSample,
  MonitorService,
  MonitorSSHReport,
  MonitorTimer,
} from './types'

// Two-series chart palette. Each preset provides its own pair, validated for CVD
// separation and contrast on its card surface (see --mon-a / --mon-b in theme.ts).
const A = 'var(--mon-a)'
const B = 'var(--mon-b)'

type Tone = 'ok' | 'warning' | 'critical' | 'neutral'

const toneColor: Record<Tone, string> = {
  ok: 'var(--success)',
  warning: 'var(--warning)',
  critical: 'var(--destructive)',
  neutral: 'var(--muted-foreground)',
}
const toneIcon: Record<Tone, string> = { ok: '✓', warning: '▲', critical: '✕', neutral: '●' }

function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  // Healthy is the expected state: it stays quiet so problems stand out.
  if (tone === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: toneColor.ok }} />
        {label}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-[1px] text-[11px] font-medium"
      style={{ color: toneColor[tone], background: `color-mix(in oklch, ${toneColor[tone]} 12%, transparent)` }}
    >
      <span aria-hidden>{toneIcon[tone]}</span>
      {label}
    </span>
  )
}

function pctTone(value: number, warn: number, crit: number): Tone {
  return value >= crit ? 'critical' : value >= warn ? 'warning' : 'ok'
}

function Meter({ value, tone }: { value: number; tone: Tone }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-secondary" role="presentation">
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: tone === 'warning' || tone === 'critical' ? toneColor[tone] : A }}
      />
    </div>
  )
}

function Kpi({ label, value, tone = 'neutral', badge, meter, facts, children }: {
  label: string
  value: string
  tone?: Tone
  badge?: string
  meter?: number
  facts?: [string, string][]
  children?: ReactNode
}) {
  const alerting = tone === 'warning' || tone === 'critical'
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 font-normal">
      <div className="flex min-h-5 items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        {alerting && <StatusBadge tone={tone} label={badge ?? (tone === 'critical' ? 'Critique' : 'Élevé')} />}
      </div>
      <div className="text-2xl font-semibold leading-none text-foreground">{value}</div>
      {facts && (meter !== undefined ? <Meter value={meter} tone={tone} /> : <div aria-hidden className="h-1" />)}
      {facts && (
        <dl className="flex flex-col gap-1 text-[11px]">
          {facts.map(([name, fact]) => (
            <div key={name} className="flex items-baseline justify-between gap-2">
              <dt className="truncate text-muted-foreground">{name}</dt>
              <dd className="whitespace-nowrap tabular-nums text-foreground">{fact}</dd>
            </div>
          ))}
        </dl>
      )}
      {children && <div className="text-[11px] leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  )
}

function CoreStrip({ cores }: { cores: number[] }) {
  return (
    <div
      className="mt-1 flex h-4 items-end gap-px"
      role="img"
      aria-label={`Charge par cœur : ${cores.map(c => `${Math.round(c)} %`).join(', ')}`}
    >
      {cores.map((c, i) => (
        <div key={i} className="flex h-full flex-1 flex-col justify-end overflow-hidden rounded-[2px] bg-secondary" title={`Cœur ${i} : ${formatPercent(c)}`}>
          <div style={{ height: `max(1px, ${c}%)`, background: c >= 90 ? toneColor.critical : c >= 70 ? toneColor.warning : A }} />
        </div>
      ))}
    </div>
  )
}

const severityTone: Record<MonitorAlert['severity'], Tone> = { critical: 'critical', warning: 'warning', info: 'neutral' }

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const area = document.createElement('textarea')
        area.value = text
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        area.remove()
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={copied ? 'Commande copiée' : 'Copier la commande'}
    >
      {copied ? 'Copié ✓' : 'Copier'}
    </button>
  )
}

function AlertDetails({ alert, id }: { alert: MonitorAlert; id: string }) {
  const facts = alert.facts ?? []
  const lists = alert.lists ?? []
  const commands = alert.commands ?? []
  return (
    <div id={id} className="mt-2.5 flex flex-col gap-3 border-t border-border/60 pt-3">
      {facts.length > 0 && (
        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {facts.map(f => (
            <div key={f.label} className="flex min-w-0 flex-col">
              <dt className="text-[11px] text-muted-foreground">{f.label}</dt>
              <dd className="break-words text-foreground">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {alert.advice && (
        <p className="rounded-md border border-border/60 bg-background/60 px-3 py-2 leading-relaxed text-foreground">
          <span className="mr-1.5 font-semibold">Conseil</span>
          {alert.advice}
        </p>
      )}
      {lists.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {lists.map(l => (
            <div key={l.title} className="min-w-0">
              <h5 className="mb-1 text-[11px] font-medium text-muted-foreground">{l.title}</h5>
              <ul className="max-h-56 overflow-auto rounded-md border border-border/60 bg-background/60 text-[11px]">
                {l.items.map((item, k) => (
                  <li key={k} className="break-words border-b border-border/40 px-2.5 py-1 text-foreground last:border-0">{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {commands.length > 0 && (
        <div className="flex flex-col gap-2">
          <h5 className="text-[11px] font-medium text-muted-foreground">Commandes utiles</h5>
          {commands.map(c => (
            <div key={c.label} className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">{c.label}</span>
                <span className="ml-auto"><CopyButton text={c.command} /></span>
              </div>
              <pre className="overflow-x-auto whitespace-pre rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-[11px] text-foreground">
                <code>{c.command}</code>
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function hasDetails(a: MonitorAlert) {
  return Boolean(a.facts?.length || a.lists?.length || a.commands?.length || a.advice)
}

function AlertRow({ alert, id, open, onToggle }: { alert: MonitorAlert; id: string; open: boolean; onToggle: () => void }) {
  const tone = severityTone[alert.severity]
  const expandable = hasDetails(alert)
  const expanded = expandable && open
  const header = (
    <>
      <StatusBadge tone={tone} label={alert.severity === 'critical' ? 'Critique' : alert.severity === 'warning' ? 'Attention' : 'Info'} />
      <span className="font-medium text-foreground">{alert.title}</span>
      {alert.detail && <span className="text-muted-foreground">{alert.detail}</span>}
      {expandable && (
        <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
          {expanded ? 'Masquer ▴' : 'Détails ▾'}
        </span>
      )}
    </>
  )
  return (
    <li
      className="rounded-md border border-border bg-card px-3 py-2 text-xs font-normal"
      style={{ borderLeft: `3px solid ${toneColor[tone]}` }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={id}
          className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {header}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">{header}</div>
      )}
      {expanded && <AlertDetails alert={alert} id={id} />}
    </li>
  )
}

function Alerts({ alerts }: { alerts: MonitorAlert[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  if (alerts.length === 0) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-xs font-normal">
        <StatusBadge tone="ok" label="Tout va bien" />
        <span className="text-muted-foreground">Aucun problème détecté sur les ressources, services, tâches et sites.</span>
      </div>
    )
  }
  const toggle = (key: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  return (
    <ul className="mb-4 flex flex-col gap-1.5" aria-label="Alertes">
      {alerts.map((a, i) => {
        const key = a.title.replace(/\d+/g, '#') // stays open while counts change
        return (
          <AlertRow
            key={`${a.title}-${i}`}
            alert={a}
            id={`alert-details-${i}`}
            open={open.has(key)}
            onToggle={() => toggle(key)}
          />
        )
      })}
    </ul>
  )
}

/** Arrow, Home and End navigation for a roving-tabindex group of buttons. */
function onRovingKey(e: KeyboardEvent<HTMLElement>, count: number, index: number, select: (next: number) => void) {
  let next: number
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % count
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + count) % count
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = count - 1
  else return
  e.preventDefault()
  select(next)
  e.currentTarget.querySelectorAll('button')[next]?.focus()
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  const index = options.findIndex(o => o.value === value)
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-md bg-secondary p-0.5"
      onKeyDown={e => onRovingKey(e, options.length, index, next => onChange(options[next].value))}
    >
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={`min-h-7 whitespace-nowrap rounded px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            value === o.value ? 'bg-card text-foreground shadow-[var(--elevation-sm)]' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const NUM = 'text-right tabular-nums'

function Table({ label, head, numeric = [], children, empty }: {
  label: string
  head: string[]
  /** Indexes of right-aligned columns. */
  numeric?: number[]
  children: ReactNode
  empty?: boolean
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full border-collapse text-left text-xs font-normal">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-border text-[11px] text-muted-foreground">
            {head.map((h, i) => <th key={i} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium ${numeric.includes(i) ? 'text-right' : ''}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-border/60 [&>tr]:transition-colors [&>tr:hover]:bg-secondary/40 [&>tr:last-child]:border-0 [&_td]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2">
          {children}
        </tbody>
      </table>
      {empty && <div className="px-3 py-4 text-center text-xs text-muted-foreground">Rien à afficher.</div>}
    </div>
  )
}

function serviceTone(s: MonitorService): { tone: Tone; label: string } {
  if (s.active === 'failed') return { tone: 'critical', label: 'échec' }
  if (s.active === 'activating') return { tone: 'warning', label: 'démarrage' }
  if (s.sub === 'running') return { tone: 'ok', label: 'actif' }
  return { tone: 'neutral', label: s.sub }
}

function ServicesPanel({ services, mineOnly }: { services: MonitorService[]; mineOnly: boolean }) {
  const rows = mineOnly ? services.filter(s => s.custom || s.active === 'failed') : services
  return (
    <Table label="Services" head={['État', 'Service', 'Mémoire', 'Temps CPU', 'Redém.', 'Depuis']} numeric={[2, 3, 4]} empty={rows.length === 0}>
      {rows.map(s => {
        const st = serviceTone(s)
        return (
          <tr key={`${s.scope}-${s.unit}`}>
            <td><StatusBadge tone={st.tone} label={st.label} /></td>
            <td className="max-w-[320px]">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-foreground">{s.unit.replace(/\.service$/, '')}</span>
                {s.scope === 'user' && <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">user</span>}
              </div>
              <div className="truncate text-[11px] text-muted-foreground" title={s.description}>{s.description}</div>
            </td>
            <td className={NUM}>{s.memory ? formatBytes(s.memory) : '—'}</td>
            <td className={NUM}>{formatCpuTime(s.cpu_nanos)}</td>
            <td className={NUM} style={{ color: s.restarts >= 3 ? toneColor.warning : undefined }}>{s.restarts}</td>
            <td className="whitespace-nowrap text-muted-foreground">{s.since ? formatRelative(s.since) : '—'}</td>
          </tr>
        )
      })}
    </Table>
  )
}

function timerTone(t: MonitorTimer): { tone: Tone; label: string } {
  if (t.running) return { tone: 'neutral', label: 'en cours' }
  if (!t.last) return { tone: 'neutral', label: 'jamais lancé' }
  if (t.result && t.result !== 'success') return { tone: 'critical', label: `échec (${t.exit_code})` }
  return { tone: 'ok', label: 'succès' }
}

function TimersPanel({ timers, mineOnly }: { timers: MonitorTimer[]; mineOnly: boolean }) {
  const rows = mineOnly ? timers.filter(t => t.custom || (t.result && t.result !== 'success')) : timers
  return (
    <Table label="Tâches planifiées" head={['Dernier résultat', 'Tâche', 'Dernière exécution', 'Prochaine']} empty={rows.length === 0}>
      {rows.map(t => {
        const st = timerTone(t)
        return (
          <tr key={`${t.scope}-${t.unit}`}>
            <td><StatusBadge tone={st.tone} label={st.label} /></td>
            <td>
              <span className="font-medium text-foreground">{t.unit.replace(/\.timer$/, '')}</span>
              {t.scope === 'user' && <span className="ml-1.5 rounded border border-border px-1 text-[10px] text-muted-foreground">user</span>}
            </td>
            <td className="whitespace-nowrap text-muted-foreground" title={t.last ? new Date(t.last * 1000).toLocaleString('fr-FR') : undefined}>{formatRelative(t.last)}</td>
            <td className="whitespace-nowrap text-muted-foreground" title={t.next ? new Date(t.next * 1000).toLocaleString('fr-FR') : undefined}>{formatRelative(t.next)}</td>
          </tr>
        )
      })}
    </Table>
  )
}

function certTone(expires?: number): { tone: Tone; label: string } {
  if (!expires) return { tone: 'neutral', label: '—' }
  const days = (expires * 1000 - Date.now()) / 86400000
  const label = `${Math.floor(days)} j`
  return { tone: days < 7 ? 'critical' : days < 21 ? 'warning' : 'ok', label }
}

function EndpointsPanel({ endpoints }: { endpoints: MonitorEndpoint[] }) {
  return (
    <Table label="Sites surveillés" head={['État', 'Site', 'HTTP', 'Latence', 'Tendance 24 h', 'Dispo. 24 h', 'Certificat', 'Vérifié']} numeric={[2, 3, 5]} empty={endpoints.length === 0}>
      {endpoints.map(e => {
        const cert = certTone(e.cert_expires)
        const history = (e.history ?? []).slice(-120)
        return (
          <tr key={e.url}>
            <td>{e.checked_at ? <StatusBadge tone={e.up ? 'ok' : 'critical'} label={e.up ? 'en ligne' : 'hors ligne'} /> : <StatusBadge tone="neutral" label="en attente" />}</td>
            <td>
              <a href={e.url} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:underline">{hostOf(e.url)}</a>
              {e.error && <div className="text-[11px]" style={{ color: toneColor.critical }}>{e.error}</div>}
            </td>
            <td className={NUM}>{e.status || '—'}</td>
            <td className={NUM} style={{ color: e.latency_ms >= 2000 ? toneColor.warning : undefined }}>{e.checked_at ? `${formatNumber(e.latency_ms)} ms` : '—'}</td>
            <td><MiniTrend values={history.map(p => p.latency_ms)} color={A} /></td>
            <td className={NUM}>{history.length ? formatPercent(e.uptime_percent) : '—'}</td>
            <td title={e.cert_issuer}>{cert.label === '—' ? '—' : <StatusBadge tone={cert.tone} label={cert.label} />}</td>
            <td className="whitespace-nowrap text-muted-foreground">{formatRelative(e.checked_at)}</td>
          </tr>
        )
      })}
    </Table>
  )
}

function ProcessesPanel({ data, sortBy }: { data: MonitorResponse; sortBy: 'cpu' | 'mem' }) {
  const rows = useMemo(() => {
    const list = [...(data.processes ?? [])]
    list.sort((a, b) => (sortBy === 'cpu' ? b.cpu - a.cpu || b.rss - a.rss : b.rss - a.rss))
    return list.slice(0, 12)
  }, [data.processes, sortBy])
  const total = data.now.memory.total || 1
  return (
    <Table label="Processus les plus actifs" head={['PID', 'Processus', 'Utilisateur', 'CPU', 'Mémoire', 'Unité', 'Commande']} numeric={[0, 3, 4]} empty={rows.length === 0}>
      {rows.map(p => (
        <tr key={p.pid}>
          <td className={`${NUM} text-muted-foreground`}>{p.pid}</td>
          <td className="font-medium text-foreground">{p.name}</td>
          <td className="text-muted-foreground">{p.user}</td>
          <td className={NUM} style={{ color: p.cpu >= 80 ? toneColor.warning : undefined }}>{formatPercent(p.cpu)}</td>
          <td className={NUM}>{formatBytes(p.rss)} <span className="text-muted-foreground">({formatPercent((p.rss / total) * 100)})</span></td>
          <td className="max-w-[180px] truncate text-muted-foreground" title={p.unit}>{p.unit?.replace(/\.service$/, '') ?? '—'}</td>
          <td className="max-w-[360px] truncate text-muted-foreground" title={p.command}>{p.command}</td>
        </tr>
      ))}
    </Table>
  )
}

function StoragePanel({ data }: { data: MonitorResponse }) {
  const filesystems = data.filesystems ?? []
  const disks = data.disks ?? []
  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-3 font-normal">
        <h4 className="text-xs font-semibold text-foreground">Systèmes de fichiers</h4>
        {filesystems.map(fs => {
          const tone = pctTone(fs.percent, 80, 90)
          return (
            <div key={fs.mount} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2 text-xs">
                <span className="font-medium text-foreground">{fs.mount}</span>
                <span className="text-[11px] text-muted-foreground">{fs.device} · {fs.fstype}</span>
                <span className="ml-auto tabular-nums text-foreground">{formatPercent(fs.percent)}</span>
              </div>
              <Meter value={fs.percent} tone={tone} />
              <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                <span>{formatBytes(fs.used)} / {formatBytes(fs.total)}</span>
                <span>{formatBytes(fs.available)} libres</span>
                <span>inodes {formatPercent(fs.inodes_percent)}</span>
                {fs.growth_per_day !== undefined && (
                  <span>
                    {fs.growth_per_day > 0 ? `+${formatBytes(fs.growth_per_day)}/jour` : 'stable'}
                    {fs.days_to_full ? ` · plein dans ~${formatNumber(fs.days_to_full)} j` : ''}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <Table label="Disques" head={['Disque', 'Lecture', 'Écriture', 'IOPS l/é', 'Occupation']} numeric={[1, 2, 3, 4]} empty={disks.length === 0}>
        {disks.map(d => (
          <tr key={d.name}>
            <td className="font-medium text-foreground">{d.name}</td>
            <td className={NUM}>{formatRate(d.read_rate)}</td>
            <td className={NUM}>{formatRate(d.write_rate)}</td>
            <td className={NUM}>{formatNumber(d.read_iops)} / {formatNumber(d.write_iops)}</td>
            <td className={NUM}>{formatPercent(d.util)}</td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function NetworkPanel({ data }: { data: MonitorResponse }) {
  const interfaces = data.interfaces ?? []
  const listeners = data.listeners ?? []
  const exposed = listeners.filter(l => l.public).length
  return (
    <div className="flex flex-col gap-3">
      <Table label="Interfaces réseau" head={['Interface', 'Entrant', 'Sortant', 'Total reçu', 'Total envoyé', 'Erreurs']} numeric={[1, 2, 3, 4, 5]} empty={interfaces.length === 0}>
        {interfaces.map(i => (
          <tr key={i.name}>
            <td className="font-medium text-foreground">{i.name}</td>
            <td className={NUM}>{formatRate(i.rx_rate)}</td>
            <td className={NUM}>{formatRate(i.tx_rate)}</td>
            <td className={`${NUM} text-muted-foreground`}>{formatBytes(i.rx_total)}</td>
            <td className={`${NUM} text-muted-foreground`}>{formatBytes(i.tx_total)}</td>
            <td className={NUM} style={{ color: i.errors + i.drops > 0 ? toneColor.warning : undefined }}>{i.errors + i.drops}</td>
          </tr>
        ))}
      </Table>
      <div>
        <div className="mb-1.5 text-xs font-normal text-muted-foreground">
          {listeners.length} ports en écoute · <span style={{ color: exposed ? toneColor.warning : undefined }}>{exposed} exposés sur Internet</span>
        </div>
        <Table label="Ports en écoute" head={['Exposition', 'Port', 'Adresse', 'Processus', 'Unité']} empty={listeners.length === 0}>
          {listeners.map(l => (
            <tr key={`${l.proto}-${l.address}-${l.port}`}>
              <td>{l.public ? <StatusBadge tone="warning" label="public" /> : <StatusBadge tone="ok" label="local" />}</td>
              <td className="whitespace-nowrap tabular-nums font-medium text-foreground">{l.port}<span className="ml-1 text-[11px] font-normal text-muted-foreground">{l.proto}</span></td>
              <td className="text-muted-foreground">{l.address}</td>
              <td>{l.process ?? '—'}{l.pid ? <span className="ml-1 text-[11px] text-muted-foreground">#{l.pid}</span> : null}</td>
              <td className="text-muted-foreground">{l.unit?.replace(/\.service$/, '') ?? '—'}</td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  )
}

function SSHSummary({ ssh }: { ssh: MonitorSSHReport }) {
  const f2b = ssh.fail2ban
  const cfg = ssh.config ?? {}
  return (
    <div className="grid items-start gap-3 lg:grid-cols-3">
      <Table label="Adresses IP refusées" head={['IP (24 h)', 'Tentatives', 'fail2ban']} numeric={[1]} empty={!ssh.top_ips?.length}>
        {(ssh.top_ips ?? []).map(ip => (
          <tr key={ip.ip}>
            <td className="font-medium text-foreground">{ip.ip}</td>
            <td className={NUM}>{formatNumber(ip.count)}</td>
            <td>{ip.banned ? <StatusBadge tone="ok" label="bannie" /> : <StatusBadge tone="neutral" label="libre" />}</td>
          </tr>
        ))}
      </Table>
      <Table label="Identifiants essayés" head={['Identifiant essayé', 'Tentatives']} numeric={[1]} empty={!ssh.top_users?.length}>
        {(ssh.top_users ?? []).map(u => (
          <tr key={u.key}>
            <td className="font-medium text-foreground">{u.key}</td>
            <td className={NUM}>{formatNumber(u.count)}</td>
          </tr>
        ))}
      </Table>
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-border bg-card p-3 text-xs font-normal leading-relaxed text-muted-foreground">
          <div><span className="text-foreground">{formatNumber(ssh.unique_ips)}</span> IP distinctes · <span className="text-foreground">{formatNumber(ssh.root_attempts)}</span> essais sur root</div>
          <div>mot de passe : <span className="text-foreground">{cfg.passwordauthentication === 'yes' ? 'accepté' : cfg.passwordauthentication ? 'refusé' : '—'}</span> · port <span className="text-foreground">{cfg.port ?? '—'}</span></div>
          {f2b ? (
            <div>fail2ban : <span className="text-foreground">{f2b.currently_banned}</span> bannies · règle {f2b.max_retry} échecs / {formatDuration(f2b.find_time)} → {formatDuration(f2b.ban_time)}</div>
          ) : <div>fail2ban : absent</div>}
        </div>
        <Table label="Connexions réussies" head={['Connexion réussie', 'Depuis']} empty={!ssh.accepted?.length}>
          {(ssh.accepted ?? []).map((l, i) => (
            <tr key={i}>
              <td className="text-muted-foreground">{new Date(l.t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · <span className="text-foreground">{l.user}</span></td>
              <td>{l.ip} <span className="text-[11px] text-muted-foreground">{l.method}</span></td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  )
}

function LogsPanel({ data }: { data: MonitorResponse }) {
  const logs = data.logs
  const lines = logs.recent_errors ?? []
  return (
    <div className="flex flex-col gap-3 font-normal">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Erreurs du journal (1 h)" value={formatNumber(logs.errors_last_hour)} tone={logs.errors_last_hour >= 50 ? 'warning' : 'ok'} />
        <Kpi label="Tentatives SSH refusées (24 h)" value={formatNumber(logs.ssh_failures_24h)} tone={logs.ssh_failures_24h >= 100 ? 'warning' : 'ok'} />
        <Kpi label="Analysé" value={formatRelative(logs.checked_at)}>toutes les 5 minutes</Kpi>
      </div>
      {logs.ssh && logs.ssh.attempts > 0 && <SSHSummary ssh={logs.ssh} />}
      <div className="rounded-lg border border-border bg-card">
        <h4 className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">Dernières erreurs (priorité err et plus)</h4>
        {lines.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">Aucune erreur sur la dernière heure.</div>
        ) : (
          <ul className="divide-y divide-border/50">
            {lines.map((l, i) => (
              <li key={i} className="flex flex-wrap gap-x-3 px-3 py-2 text-xs sm:flex-nowrap">
                <span className="shrink-0 tabular-nums text-muted-foreground">{new Date(l.t).toLocaleTimeString('fr-FR')}</span>
                <span className="w-40 shrink-0 truncate text-foreground" title={l.unit}>{l.unit || '—'}</span>
                <span className="min-w-0 break-words text-muted-foreground">{l.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

type Tab = 'services' | 'timers' | 'sites' | 'processes' | 'storage' | 'network' | 'logs'

function column(series: MonitorSample[], key: keyof MonitorSample): number[] {
  return series.map(s => s[key] as number)
}

export function Monitoring() {
  const [range, setRange] = useState<MonitorRange>('1h')
  const [tab, setTab] = useState<Tab>('services')
  const [mineOnly, setMineOnly] = useState(true)
  const [procSort, setProcSort] = useState<'cpu' | 'mem'>('cpu')
  const { data, series, status, lastUpdate, failed } = useMonitor(range)

  if (status === 'unavailable') return null

  const times = series.map(s => s.t)
  const interval = data?.interval ?? 5
  const showDate = range === '24h'

  if (!data) {
    return (
      <section aria-labelledby="monitoring-title" className="mb-6">
        <h2 id="monitoring-title" className="mb-2.5 text-sm font-semibold text-foreground">Monitoring</h2>
        {status === 'error' ? (
          <div className="rounded-lg border border-border bg-card p-4 text-xs font-normal text-muted-foreground">
            Impossible de joindre /api/monitor. Nouvelle tentative automatique dans quelques secondes.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" role="status" aria-label="Chargement des métriques…">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="ui-skeleton h-36" />)}
          </div>
        )}
      </section>
    )
  }

  const { host, now } = data
  const mem = now.memory
  const memPct = mem.total ? (mem.used / mem.total) * 100 : 0
  const cpuPct = 100 - now.cpu.idle
  const root = (data.filesystems ?? []).find(f => f.mount === '/') ?? data.filesystems?.[0]
  const endpoints = data.endpoints ?? []
  const checked = endpoints.filter(e => e.checked_at)
  const up = checked.filter(e => e.up).length
  const avgLatency = checked.length ? checked.reduce((n, e) => n + e.latency_ms, 0) / checked.length : 0
  const latest = series[series.length - 1]
  const services = data.services ?? []
  const timers = data.timers ?? []
  const failedServices = services.filter(s => s.active === 'failed').length
  const failedTimers = timers.filter(t => t.last && t.result && t.result !== 'success').length
  const stale = failed || Date.now() - lastUpdate > 20000

  const tabs: { id: Tab; label: string; count?: number; alert?: boolean }[] = [
    { id: 'services', label: 'Services', count: services.filter(s => s.custom).length, alert: failedServices > 0 },
    { id: 'timers', label: 'Tâches planifiées', count: timers.filter(t => t.custom).length, alert: failedTimers > 0 },
    { id: 'sites', label: 'Sites', count: endpoints.length, alert: checked.length > up },
    { id: 'processes', label: 'Processus' },
    { id: 'storage', label: 'Stockage' },
    { id: 'network', label: 'Réseau & ports' },
    { id: 'logs', label: 'Journal', alert: data.logs.errors_last_hour >= 50 },
  ]

  return (
    <section aria-labelledby="monitoring-title" className="mb-6">
      {/* Header: stays visible because the range drives every chart below */}
      <div className="sticky -top-4 z-20 -mx-4 mb-3 sm:-top-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background px-4 py-2 sm:-mx-6 sm:px-6">
        <h2 id="monitoring-title" className="text-sm font-semibold text-foreground">Monitoring</h2>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground" role="status">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${stale ? '' : 'animate-[pulse_2s_ease-in-out_infinite]'}`}
            style={{ background: stale ? toneColor.warning : toneColor.ok }}
          />
          {stale ? `données figées · dernière mesure ${formatRelative(lastUpdate / 1000)}` : 'en direct'}
        </span>
        <div className="ml-auto">
          <Segmented
            label="Période des graphiques"
            value={range}
            onChange={setRange}
            options={[
              { value: '15m', label: '15 min' },
              { value: '1h', label: '1 h' },
              { value: '6h', label: '6 h' },
              { value: '24h', label: '24 h' },
            ]}
          />
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-normal text-muted-foreground">
        <span className="font-medium text-foreground">{host.hostname}</span>
        <span>{host.os}</span>
        <span>noyau {host.kernel}</span>
        <span title={host.cpu_model}>{host.cpus} vCPU · {formatBytes(mem.total)} RAM</span>
        <span>démarré il y a {formatDuration(now.uptime_seconds)}</span>
        <span>{formatNumber(now.procs)} processus · {formatNumber(now.threads)} threads</span>
        {host.reboot_required && <span style={{ color: toneColor.warning }}>▲ redémarrage requis</span>}
      </div>

      <Alerts alerts={data.alerts ?? []} />

      {/* KPIs */}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="CPU"
          value={formatPercent(cpuPct)}
          tone={pctTone(cpuPct, 75, 90)}
          meter={cpuPct}
          facts={[
            ['Utilisateur', formatPercent(now.cpu.user)],
            ['Système', formatPercent(now.cpu.system)],
            ['Attente disque', formatPercent(now.cpu.iowait)],
            ['Volé (steal)', formatPercent(now.cpu.steal)],
          ]}
        >
          {now.cores && now.cores.length > 0 && <CoreStrip cores={now.cores} />}
        </Kpi>
        <Kpi
          label="Mémoire"
          value={formatPercent(memPct)}
          tone={pctTone(memPct, 80, 92)}
          meter={memPct}
          facts={[
            ['Utilisée', formatBytes(mem.used)],
            ['Cache', formatBytes(mem.cached)],
            ['Swap', mem.swap_total ? formatBytes(mem.swap_used) : 'aucun'],
            ['Total', formatBytes(mem.total)],
          ]}
        />
        {root && (
          <Kpi
            label={`Disque ${root.mount}`}
            value={formatPercent(root.percent)}
            tone={pctTone(root.percent, 80, 90)}
            meter={root.percent}
            facts={[
              ['Libres', formatBytes(root.available)],
              ['Total', formatBytes(root.total)],
              ['Inodes', formatPercent(root.inodes_percent)],
              root.days_to_full ? ['Plein dans', `~${formatNumber(root.days_to_full)} j`] : root.growth_per_day !== undefined ? ['Croissance', 'stable'] : ['Projection', 'après 6 h'],
            ]}
          />
        )}
        <Kpi
          label="Charge"
          value={formatNumber(now.load[0], 2)}
          tone={now.load[1] > host.cpus * 1.5 ? 'warning' : 'ok'}
          meter={(now.load[0] / Math.max(1, host.cpus)) * 100}
          facts={[
            ['5 min', formatNumber(now.load[1], 2)],
            ['15 min', formatNumber(now.load[2], 2)],
            ['Pression CPU', formatPercent(now.psi.cpu10)],
            ['Pression I/O', formatPercent(now.psi.io10)],
          ]}
        />
        <Kpi
          label="Réseau"
          value={latest ? formatRate(latest.net_rx + latest.net_tx) : '—'}
          facts={[
            ['Entrant', latest ? formatRate(latest.net_rx) : '—'],
            ['Sortant', latest ? formatRate(latest.net_tx) : '—'],
            ['Connexions', formatNumber(now.tcp.established)],
            ['En écoute', formatNumber(now.tcp.listen)],
          ]}
        />
        <Kpi
          label="Sites et services"
          value={checked.length ? `${up}/${checked.length}` : '—'}
          tone={checked.length === 0 ? 'neutral' : up === checked.length ? 'ok' : 'critical'}
          badge="Panne"
          facts={[
            ['Latence moy.', checked.length ? `${formatNumber(avgLatency)} ms` : 'en cours…'],
            ['Services', failedServices ? `${failedServices} en échec` : 'OK'],
            ['Tâches', failedTimers ? `${failedTimers} en échec` : 'OK'],
            ['Surveillés', formatNumber(endpoints.length)],
          ]}
        />
      </div>

      {/* Charts */}
      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <TimeSeriesChart
          title="CPU"
          times={times}
          interval={interval}
          showDate={showDate}
          ceiling={100}
          minMax={10}
          format={formatPercent}
          series={[
            { key: 'cpu', label: 'Utilisation', color: A, values: column(series, 'cpu') },
            { key: 'iowait', label: 'Attente disque', color: B, values: column(series, 'iowait') },
          ]}
        />
        <TimeSeriesChart
          title="Mémoire"
          times={times}
          interval={interval}
          showDate={showDate}
          ceiling={100}
          minMax={10}
          format={formatPercent}
          series={mem.swap_total
            ? [
                { key: 'mem', label: 'RAM', color: A, values: column(series, 'mem') },
                { key: 'swap', label: 'Swap', color: B, values: column(series, 'swap') },
              ]
            : [{ key: 'mem', label: 'RAM', color: A, values: column(series, 'mem') }]}
        />
        <TimeSeriesChart
          title="Charge système"
          times={times}
          interval={interval}
          showDate={showDate}
          minMax={1}
          format={v => formatNumber(v, 1)}
          reference={{ value: host.cpus, label: `${host.cpus} cœurs` }}
          series={[{ key: 'load1', label: 'Charge 1 min', color: A, values: column(series, 'load1') }]}
        />
        <TimeSeriesChart
          title="Réseau"
          times={times}
          interval={interval}
          showDate={showDate}
          scale="bytes"
          format={formatRate}
          series={[
            { key: 'rx', label: 'Entrant', color: A, values: column(series, 'net_rx') },
            { key: 'tx', label: 'Sortant', color: B, values: column(series, 'net_tx') },
          ]}
        />
        <TimeSeriesChart
          title="Disque I/O"
          times={times}
          interval={interval}
          showDate={showDate}
          scale="bytes"
          format={formatRate}
          series={[
            { key: 'r', label: 'Lecture', color: A, values: column(series, 'disk_r') },
            { key: 'w', label: 'Écriture', color: B, values: column(series, 'disk_w') },
          ]}
        />
        <TimeSeriesChart
          title="Connexions TCP établies"
          times={times}
          interval={interval}
          showDate={showDate}
          minMax={4}
          format={v => formatNumber(v)}
          series={[{ key: 'tcp', label: 'Connexions', color: A, values: column(series, 'tcp') }]}
        />
      </div>

      {/* Inventories */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border">
        <div
          role="tablist"
          aria-label="Détails du monitoring"
          className="-mb-px flex max-w-full gap-4 overflow-x-auto"
          onKeyDown={e => onRovingKey(e, tabs.length, tabs.findIndex(t => t.id === tab), next => setTab(tabs[next].id))}
        >
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`mon-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="mon-panel"
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {t.count !== undefined && <span className="font-normal text-muted-foreground">{t.count}</span>}
              {t.alert && (
                <>
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: toneColor.critical }} />
                  <span className="sr-only">(problème)</span>
                </>
              )}
            </button>
          ))}
        </div>
        <div className="mb-1.5">
          {(tab === 'services' || tab === 'timers') && (
            <Segmented
              label="Filtre des unités"
              value={mineOnly ? 'mine' : 'all'}
              onChange={v => setMineOnly(v === 'mine')}
              options={[{ value: 'mine', label: 'Mes unités' }, { value: 'all', label: 'Toutes' }]}
            />
          )}
          {tab === 'processes' && (
            <Segmented
              label="Tri des processus"
              value={procSort}
              onChange={setProcSort}
              options={[{ value: 'cpu', label: 'Par CPU' }, { value: 'mem', label: 'Par mémoire' }]}
            />
          )}
        </div>
      </div>
      <div id="mon-panel" role="tabpanel" aria-labelledby={`mon-tab-${tab}`} className="mb-2">
        {tab === 'services' && <ServicesPanel services={services} mineOnly={mineOnly} />}
        {tab === 'timers' && <TimersPanel timers={timers} mineOnly={mineOnly} />}
        {tab === 'sites' && <EndpointsPanel endpoints={endpoints} />}
        {tab === 'processes' && <ProcessesPanel data={data} sortBy={procSort} />}
        {tab === 'storage' && <StoragePanel data={data} />}
        {tab === 'network' && <NetworkPanel data={data} />}
        {tab === 'logs' && <LogsPanel data={data} />}
      </div>
    </section>
  )
}
