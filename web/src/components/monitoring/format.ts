const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

const units = ['o', 'Ko', 'Mo', 'Go', 'To']

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '0 o'
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value >= 100 || i === 0 ? nf0.format(value) : nf1.format(value)} ${units[i]}`
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatPercent(value: number): string {
  return `${value >= 10 ? nf0.format(value) : nf1.format(value)} %`
}

export function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(value)
}

export function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d} j ${h} h`
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min`
  return `${Math.floor(seconds)} s`
}

/** "il y a 5 min" / "dans 3 h" from a unix-seconds timestamp. */
export function formatRelative(unixSeconds: number | undefined, nowMs = Date.now()): string {
  if (!unixSeconds) return '—'
  const delta = unixSeconds - nowMs / 1000
  const text = formatDuration(Math.abs(delta))
  if (Math.abs(delta) < 5) return "à l'instant"
  return delta < 0 ? `il y a ${text}` : `dans ${text}`
}

export function formatClock(ms: number, withDate = false): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (!withDate) return time
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${time}`
}

export function formatCpuTime(nanos: number | undefined): string {
  if (!nanos) return '—'
  return formatDuration(nanos / 1e9)
}

export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}
