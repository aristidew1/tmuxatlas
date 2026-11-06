import { useEffect, useState } from 'react'
import type { Host } from '../../hooks/useHosts'
import { useHostLabel } from '../../lib/hostLabel'
import { toolColors } from '../../theme'
import { FleetHealth } from '../FleetHealth'
import { Monitoring } from './Monitoring'

type Stats = { panes: number; processes?: { name: string; count: number }[] }

export function MonitoringPage({ hosts }: { hosts: Host[] }) {
  const label = useHostLabel()
  const [stats, setStats] = useState<Stats | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await fetch('/api/stats', { signal: controller.signal })
        if (response.ok) setStats(await response.json())
      } catch {
        /* La prochaine actualisation réessaiera. */
      }
    }
    void load()
    const timer = setInterval(load, 5000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [])

  const processGroups =
    hosts.length > 1
      ? hosts
          .filter(host => host.stats?.processes?.length)
          .map(host => ({
            id: host.id,
            name: label(host.id, host.name || 'Hôte'),
            processes: host.stats!.processes as { name: string; count: number }[],
            panes: (host.sessions || []).reduce(
              (count, session) =>
                count +
                (session.windows || []).reduce(
                  (sum: number, window: { panes?: unknown[] }) => sum + (window.panes?.length || 0),
                  0,
                ),
              0,
            ),
          }))
      : stats?.processes?.length
        ? [{ id: '', name: '', processes: stats.processes, panes: stats.panes }]
        : []

  return (
    <main className="flex-1 overflow-y-auto p-4 text-sm sm:p-6">
      <h1 className="mb-5 text-2xl font-medium">Monitoring</h1>
      <FleetHealth />
      {processGroups.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-medium">Processus</h2>
          <div className="grid gap-5 md:grid-cols-2">
            {processGroups.map(group => (
              <div key={group.id}>
                {group.name && (
                  <h3 title={group.id} className="mb-2 text-xs">
                    {group.name}
                  </h3>
                )}
                {group.processes.slice(0, 10).map(process => (
                  <div key={process.name} className="flex items-center gap-3 py-1 text-xs">
                    <span className="w-24 truncate">{process.name}</span>
                    <div className="h-1.5 flex-1 rounded bg-secondary">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${(process.count / Math.max(...group.processes.map(p => p.count), 1)) * 100}%`,
                          background: toolColors[process.name] || 'var(--muted-foreground)',
                        }}
                      />
                    </div>
                    <span className="w-16 text-right tabular-nums text-muted-foreground">
                      {process.count} ({group.panes ? Math.round((process.count / group.panes) * 100) : 0} %)
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
      {hosts.some(host => host.stats) && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-medium">Statistiques système par hôte</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {hosts
              .filter(host => host.stats)
              .map(host => (
                <div key={host.id} className="atlas-surface rounded-lg p-4">
                  <h3 title={host.id} className="mb-2 text-sm">
                    {label(host.id, host.name || 'Hôte')}
                  </h3>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                    <span>
                      CPU : {host.stats?.cpu_percent != null ? `${Math.round(host.stats.cpu_percent)} %` : '—'}
                    </span>
                    <span>Mémoire : {host.stats?.memory ? `${Math.round(host.stats.memory.percent)} %` : '—'}</span>
                    <span>Cœurs : {host.stats?.cpus ?? '—'}</span>
                    <span>Architecture : {host.stats?.arch ?? '—'}</span>
                    {host.stats?.load && (
                      <span>
                        Charge : {host.stats.load['1m']} / {host.stats.load['5m']} / {host.stats.load['15m']}
                      </span>
                    )}
                    {host.stats?.memory && (
                      <span>
                        Mémoire utilisée : {(host.stats.memory.used_mb / 1024).toFixed(1)} /{' '}
                        {(host.stats.memory.total_mb / 1024).toFixed(1)} Go
                      </span>
                    )}
                    {host.stats?.uptime_seconds != null && (
                      <span>Disponibilité : {Math.floor(host.stats.uptime_seconds / 3600)} h</span>
                    )}
                    {host.stats?.tmuxatlas_mem_mb != null && (
                      <span>Mémoire Atlas : {host.stats.tmuxatlas_mem_mb.toFixed(1)} Mo</span>
                    )}
                    {host.stats?.goroutines != null && <span>Goroutines : {host.stats.goroutines}</span>}
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}
      <Monitoring />
    </main>
  )
}
