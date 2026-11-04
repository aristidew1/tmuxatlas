import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatClock } from './format'

export interface ChartSeries {
  key: string
  label: string
  color: string
  values: number[]
}

interface TimeSeriesChartProps {
  title: string
  times: number[]
  series: ChartSeries[]
  format: (value: number) => string
  /** Hard upper bound of the axis, e.g. 100 for percentages. */
  ceiling?: number
  /** Smallest axis maximum, so a near-zero series is not magnified into noise. */
  minMax?: number
  /** `bytes` rounds the axis to 1024-based values so ticks read as round numbers. */
  scale?: 'number' | 'bytes'
  /** Horizontal reference, e.g. the CPU core count on a load chart. Never stretches the axis. */
  reference?: { value: number; label: string }
  /** Expected seconds between points; larger gaps break the line. */
  interval: number
  height?: number
  showDate?: boolean
}

const PAD = { top: 8, right: 8, bottom: 20, left: 50 }
const NICE_STEPS = [1, 2, 3, 4, 5, 6, 8, 10]

function niceCeil(value: number, scale: 'number' | 'bytes'): number {
  if (value <= 0) return 1
  const base = scale === 'bytes' ? 1024 : 10
  const exp = Math.max(scale === 'bytes' ? 0 : -6, Math.floor(Math.log(value) / Math.log(base)))
  const unit = scale === 'bytes' ? Math.pow(1024, exp) : Math.pow(10, exp)
  const scaled = value / unit
  const decade = scaled < 10 ? 1 : scaled < 100 ? 10 : 100
  const step = NICE_STEPS.find(s => s * decade >= scaled - 1e-9) ?? 10
  return step * decade * unit
}

/** Largest axis value, derived from the data and clamped to the configured bounds. */
export function chartMax(values: number[][], { ceiling, minMax = 0, scale = 'number' }: { ceiling?: number; minMax?: number; scale?: 'number' | 'bytes' }): number {
  let peak = 0
  for (const series of values) for (const v of series) if (v > peak) peak = v
  const nice = niceCeil(Math.max(peak * 1.1, minMax), scale)
  return ceiling !== undefined ? Math.min(nice, ceiling) : nice
}

export function TimeSeriesChart({
  title,
  times,
  series,
  format,
  ceiling,
  minMax,
  scale = 'number',
  reference,
  interval,
  height = 124,
  showDate = false,
}: TimeSeriesChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = height - PAD.top - PAD.bottom
  const n = times.length
  const t0 = times[0] ?? 0
  const t1 = times[n - 1] ?? 1
  const span = Math.max(1, t1 - t0)

  const max = useMemo(
    () => chartMax(series.map(s => s.values), { ceiling, minMax, scale }),
    [series, ceiling, minMax, scale],
  )

  const x = (t: number) => PAD.left + ((t - t0) / span) * plotW
  const y = (v: number) => PAD.top + plotH - (Math.min(v, max) / max) * plotH

  // Split into segments wherever the collector was down.
  const breaks = useMemo(() => {
    const gap = interval * 1000 * 3
    const out: number[] = []
    for (let i = 1; i < n; i++) if (times[i] - times[i - 1] > gap) out.push(i)
    return out
  }, [times, n, interval])

  const paths = useMemo(() => series
    // A series stuck at zero would only draw a coloured line over the axis.
    .filter(s => s.values.some(Boolean))
    .map(s => {
      let line = ''
      let area = ''
      let start = 0
      const segments = [...breaks, n]
      for (const end of segments) {
        if (end - start >= 1) {
          let seg = ''
          for (let i = start; i < end; i++) {
            seg += `${i === start ? 'M' : 'L'}${x(times[i]).toFixed(1)},${y(s.values[i] ?? 0).toFixed(1)}`
          }
          line += seg
          area += `${seg}L${x(times[end - 1]).toFixed(1)},${PAD.top + plotH}L${x(times[start]).toFixed(1)},${PAD.top + plotH}Z`
        }
        start = end
      }
      return { key: s.key, color: s.color, line, area }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [series, breaks, n, times, plotW, plotH, max])

  const ticks = [0, max / 2, max]
  const xTicks = n > 1 ? [t0, t0 + span / 2, t1] : []

  const indexAt = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || n === 0) return null
    const t = t0 + ((clientX - rect.left - PAD.left) / Math.max(1, plotW)) * span
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (times[mid] < t) lo = mid + 1
      else hi = mid
    }
    if (lo > 0 && Math.abs(times[lo - 1] - t) < Math.abs(times[lo] - t)) lo--
    return lo
  }

  const onPointerMove = (e: PointerEvent) => setHover(indexAt(e.clientX))
  const onKeyDown = (e: KeyboardEvent) => {
    if (n === 0) return
    if (e.key === 'ArrowLeft') { setHover(h => Math.max(0, (h ?? n) - 1)); e.preventDefault() }
    if (e.key === 'ArrowRight') { setHover(h => Math.min(n - 1, (h ?? n - 2) + 1)); e.preventDefault() }
    if (e.key === 'Escape') setHover(null)
  }

  const latest = series.map(s => s.values[n - 1])
  const summary = series.map(s => {
    const vals = s.values
    if (vals.length === 0) return `${s.label} : aucune donnée`
    const peak = Math.max(...vals)
    return `${s.label} : actuel ${format(vals[vals.length - 1])}, pic ${format(peak)}`
  }).join(' ; ')

  const hx = hover !== null ? x(times[hover]) : 0
  const tooltipLeft = hover !== null && hx > width - 170
  const referenceVisible = reference !== undefined && reference.value <= max

  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3 font-normal">
      <h4 className="text-xs font-semibold text-foreground">{title}</h4>
      {/* One row in every card, so plots line up across the grid. */}
      <div className="mb-1.5 mt-1 flex min-h-[18px] flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
        {series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color }} />
            {s.label}
            {latest[i] !== undefined && <span className="tabular-nums text-foreground">{format(latest[i])}</span>}
          </span>
        ))}
        {reference && !referenceVisible && <span className="ml-auto">{reference.label}</span>}
      </div>
      <div
        ref={wrapRef}
        className="relative rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-label={`${title}. ${summary}`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setHover(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} className="block overflow-visible" aria-hidden>
            {ticks.map(v => (
              <g key={v}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeOpacity={v === 0 ? 1 : 0.5} strokeWidth={1} />
                <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 10 }}>
                  {format(v)}
                </text>
              </g>
            ))}
            {xTicks.map((t, i) => (
              <text
                key={i}
                x={x(t)}
                y={height - 5}
                textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                className="fill-muted-foreground"
                style={{ fontSize: 10 }}
              >
                {formatClock(t, showDate)}
              </text>
            ))}
            {referenceVisible && (
              <g>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--muted-foreground)" strokeWidth={1} />
                <text x={width - PAD.right} y={y(reference.value) - 4} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 10 }}>
                  {reference.label}
                </text>
              </g>
            )}
            {paths.map(p => (
              <path key={`${p.key}-area`} d={p.area} fill={p.color} fillOpacity={0.1} />
            ))}
            {paths.map(p => (
              <path key={p.key} d={p.line} fill="none" stroke={p.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hover !== null && (
              <g>
                <line x1={hx} x2={hx} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--muted-foreground)" strokeWidth={1} />
                {series.map(s => (
                  <circle key={s.key} cx={hx} cy={y(s.values[hover] ?? 0)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        {n === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
            Collecte en cours…
          </div>
        )}
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-[140px] rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-[var(--elevation-md)]"
            style={tooltipLeft ? { right: width - hx + 10 } : { left: hx + 10 }}
          >
            <div className="mb-1 text-muted-foreground">{formatClock(times[hover], true)}</div>
            {series.map(s => (
              <div key={s.key} className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="ml-auto pl-2 font-semibold tabular-nums text-foreground">{format(s.values[hover] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Tiny inline trend line for table cells (no axes, no interaction). */
export function MiniTrend({ values, color, width = 96, height = 22, max }: { values: number[]; color: string; width?: number; height?: number; max?: number }) {
  if (values.length < 2) return <span className="text-muted-foreground">—</span>
  const top = max ?? Math.max(...values, 1)
  const step = width / (values.length - 1)
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - 2 - (Math.min(v, top) / top) * (height - 4)).toFixed(1)}`).join('')
  return (
    <svg width={width} height={height} aria-hidden className="block">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}
