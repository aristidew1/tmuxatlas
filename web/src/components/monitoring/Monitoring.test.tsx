import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Monitoring } from './Monitoring'
import { chartMax } from './TimeSeriesChart'
import type { MonitorResponse } from './types'

const now = Date.now()
const response: MonitorResponse = {
  supported: true,
  interval: 5,
  collected_at: now,
  host: { hostname: 'vps', os: 'Ubuntu', kernel: '6.8', arch: 'amd64', cpu_model: 'x', cpus: 8, boot_time: 0, reboot_required: false, updates: 0, security_updates: 0 },
  now: {
    cpu: { user: 10, system: 5, iowait: 1, steal: 0, idle: 84 },
    cores: [10, 20],
    load: [0.5, 0.4, 0.3],
    memory: { total: 8 * 2 ** 30, used: 2 * 2 ** 30, available: 6 * 2 ** 30, cached: 2 ** 30, swap_total: 0, swap_used: 0 },
    uptime_seconds: 3600,
    procs: 200,
    procs_running: 1,
    threads: 400,
    tcp: { established: 10, time_wait: 0, listen: 5 },
    psi: { cpu10: 0, cpu60: 0, mem10: 0, mem60: 0, io10: 0, io60: 0 },
  },
  series: [
    { t: now - 5000, cpu: 12, iowait: 1, steal: 0, load1: 0.5, mem: 25, swap: 0, net_rx: 100, net_tx: 50, disk_r: 0, disk_w: 10, disk_util: 1, psi_cpu: 0, psi_mem: 0, psi_io: 0, tcp: 10 },
    { t: now, cpu: 16, iowait: 1, steal: 0, load1: 0.5, mem: 25, swap: 0, net_rx: 200, net_tx: 50, disk_r: 0, disk_w: 10, disk_util: 1, psi_cpu: 0, psi_mem: 0, psi_io: 0, tcp: 10 },
  ],
  filesystems: [{ mount: '/', device: '/dev/sda1', fstype: 'ext4', total: 100, used: 20, available: 80, percent: 20, inodes_percent: 5 }],
  interfaces: [],
  disks: [],
  processes: [],
  listeners: [],
  services: [
    { unit: 'api.service', scope: 'system', description: 'API', active: 'failed', sub: 'failed', result: 'exit-code', custom: true, restarts: 0 },
    { unit: 'cron.service', scope: 'system', description: 'Cron', active: 'active', sub: 'running', custom: false, restarts: 0 },
  ],
  timers: [],
  endpoints: [],
  logs: { errors_last_hour: 0, ssh_failures_24h: 0, recent_errors: [], checked_at: 0 },
  alerts: [{
    severity: 'critical',
    title: 'Service en échec : api.service',
    detail: 'code de sortie non nul',
    facts: [{ label: 'Cause', value: 'code de sortie non nul' }],
    lists: [{ title: 'Derniers logs du service', items: ['boom: port already in use'] }],
    commands: [{ label: 'Redémarrer', command: 'sudo systemctl restart api.service' }],
    advice: 'Lis les derniers logs.',
  }],
}

describe('Monitoring', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders alerts, KPIs and filters services to the operator units', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })))
    render(<Monitoring />)
    expect(await screen.findByText('Service en échec : api.service')).toBeInTheDocument()
    expect(screen.getByText('Critique')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /CPU\. Utilisation : actuel 16 %/ })).toBeInTheDocument()
    expect(screen.getByText('api')).toBeInTheDocument()
    expect(screen.queryByText('cron')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Toutes' }))
    expect(screen.getByText('cron')).toBeInTheDocument()
  })

  it('expands an alert to show facts, logs, advice and copyable commands', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })))
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<Monitoring />)
    const toggle = await screen.findByRole('button', { name: /Service en échec : api\.service/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('boom: port already in use')).toBeInTheDocument()
    expect(screen.getByText('Lis les derniers logs.')).toBeInTheDocument()
    expect(screen.getByText('sudo systemctl restart api.service')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copier la commande' }))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('sudo systemctl restart api.service'))
    expect(await screen.findByRole('button', { name: 'Commande copiée' })).toBeInTheDocument()
  })

  it('hides itself when the role has no monitoring', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const { container } = render(<Monitoring />)
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})

describe('chartMax', () => {
  it('fits the axis to the data within its bounds', () => {
    expect(chartMax([[4, 5]], { ceiling: 100, minMax: 10 })).toBe(10)
    expect(chartMax([[30]], { ceiling: 100, minMax: 10 })).toBe(40)
    expect(chartMax([[99]], { ceiling: 100, minMax: 10 })).toBe(100)
    expect(chartMax([[0.14]], { minMax: 1 })).toBe(1)
    expect(chartMax([[27]], { minMax: 4 })).toBe(30)
  })

  it('rounds byte scales on 1024 so ticks read as round numbers', () => {
    expect(chartMax([[200 * 1024]], { scale: 'bytes' })).toBe(300 * 1024)
    expect(chartMax([[0]], { scale: 'bytes' })).toBe(1)
  })
})

describe('Monitoring states', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('always shows information alerts such as refused SSH attempts', async () => {
    const alerts = [
      { severity: 'warning', title: 'Disque presque plein' },
      { severity: 'info', title: '1815 tentatives SSH refusées sur 24 h', detail: '174 IP distinctes' },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...response, alerts }), { status: 200 })))
    render(<Monitoring />)
    expect(await screen.findByText('Disque presque plein')).toBeInTheDocument()
    expect(screen.getByText('1815 tentatives SSH refusées sur 24 h')).toBeInTheDocument()
    expect(screen.getByText('174 IP distinctes')).toBeInTheDocument()
  })

  it('moves between detail tabs with the arrow keys', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })))
    render(<Monitoring />)
    const services = await screen.findByRole('tab', { name: /Services/ })
    fireEvent.keyDown(services, { key: 'ArrowRight' })
    const timers = screen.getByRole('tab', { name: /Tâches planifiées/ })
    expect(timers).toHaveAttribute('aria-selected', 'true')
    expect(timers).toHaveFocus()
    fireEvent.keyDown(timers, { key: 'End' })
    expect(screen.getByRole('tab', { name: /Journal/ })).toHaveFocus()
  })

  it('announces frozen data as soon as a poll fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      render(<Monitoring />)
      expect(await screen.findByText('en direct')).toBeInTheDocument()
      fetchMock.mockRejectedValue(new Error('offline'))
      await vi.advanceTimersByTimeAsync(5000)
      expect(await screen.findByText(/données figées/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
