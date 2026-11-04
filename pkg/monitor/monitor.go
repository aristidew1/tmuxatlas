// Package monitor collects host-level observability data for the local
// machine: a rolling time series of system metrics, plus slower inventories
// (systemd units, HTTP endpoints, listening sockets, filesystems) and derived
// alerts. It is only started on roles that own a real host (not a pure hub).
package monitor

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/paths"
	"github.com/sirupsen/logrus"
)

const (
	// SampleInterval is the cadence of the raw time series.
	SampleInterval = 5 * time.Second
	rawCapacity    = 720  // 1 hour of raw samples
	rollupCapacity = 1440 // 24 hours of one-minute buckets
	persistEvery   = 5 * time.Minute
)

// Sample is one point of the system time series. Rates are per second,
// percentages are 0-100.
type Sample struct {
	T        int64   `json:"t"` // unix milliseconds
	CPU      float64 `json:"cpu"`
	IOWait   float64 `json:"iowait"`
	Steal    float64 `json:"steal"`
	Load1    float64 `json:"load1"`
	Mem      float64 `json:"mem"`
	Swap     float64 `json:"swap"`
	NetRx    float64 `json:"net_rx"`
	NetTx    float64 `json:"net_tx"`
	DiskR    float64 `json:"disk_r"`
	DiskW    float64 `json:"disk_w"`
	DiskUtil float64 `json:"disk_util"`
	PSICPU   float64 `json:"psi_cpu"`
	PSIMem   float64 `json:"psi_mem"`
	PSIIO    float64 `json:"psi_io"`
	TCP      float64 `json:"tcp"`
}

// HostInfo describes the machine. It changes rarely.
type HostInfo struct {
	Hostname       string    `json:"hostname"`
	OS             string    `json:"os"`
	Kernel         string    `json:"kernel"`
	Arch           string    `json:"arch"`
	CPUModel       string    `json:"cpu_model"`
	CPUs           int       `json:"cpus"`
	BootTime       int64     `json:"boot_time"` // unix seconds
	RebootRequired bool      `json:"reboot_required"`
	Updates        int       `json:"updates"`
	SecurityUpdate int       `json:"security_updates"`
	Packages       []Package `json:"packages,omitempty"`
	RebootPackages []string  `json:"reboot_packages,omitempty"`
	LatestKernel   string    `json:"latest_kernel,omitempty"`
}

// Package is an upgradable apt package.
type Package struct {
	Name     string `json:"name"`
	From     string `json:"from"`
	To       string `json:"to"`
	Suite    string `json:"suite"`
	Security bool   `json:"security"`
}

// Current is the instantaneous detail behind the latest sample.
type Current struct {
	CPU          CPUBreakdown `json:"cpu"`
	Cores        []float64    `json:"cores"`
	Load         [3]float64   `json:"load"`
	Memory       Memory       `json:"memory"`
	UptimeSec    float64      `json:"uptime_seconds"`
	Procs        int          `json:"procs"`
	ProcsRunning int          `json:"procs_running"`
	Threads      int          `json:"threads"`
	TCP          TCPStates    `json:"tcp"`
	PSI          PSI          `json:"psi"`
}

type CPUBreakdown struct {
	User   float64 `json:"user"`
	System float64 `json:"system"`
	IOWait float64 `json:"iowait"`
	Steal  float64 `json:"steal"`
	Idle   float64 `json:"idle"`
}

type Memory struct {
	Total     uint64 `json:"total"`
	Used      uint64 `json:"used"`
	Available uint64 `json:"available"`
	Cached    uint64 `json:"cached"`
	SwapTotal uint64 `json:"swap_total"`
	SwapUsed  uint64 `json:"swap_used"`
}

type TCPStates struct {
	Established int `json:"established"`
	TimeWait    int `json:"time_wait"`
	Listen      int `json:"listen"`
}

// PSI holds the "some avg10/avg60" pressure stall percentages.
type PSI struct {
	CPU10 float64 `json:"cpu10"`
	CPU60 float64 `json:"cpu60"`
	Mem10 float64 `json:"mem10"`
	Mem60 float64 `json:"mem60"`
	IO10  float64 `json:"io10"`
	IO60  float64 `json:"io60"`
}

type Filesystem struct {
	Mount        string  `json:"mount"`
	Device       string  `json:"device"`
	FSType       string  `json:"fstype"`
	Total        uint64  `json:"total"`
	Used         uint64  `json:"used"`
	Available    uint64  `json:"available"`
	Percent      float64 `json:"percent"`
	InodesPct    float64 `json:"inodes_percent"`
	DaysToFull   float64 `json:"days_to_full,omitempty"`
	GrowthPerDay float64 `json:"growth_per_day,omitempty"`
}

type Interface struct {
	Name    string  `json:"name"`
	RxRate  float64 `json:"rx_rate"`
	TxRate  float64 `json:"tx_rate"`
	RxTotal uint64  `json:"rx_total"`
	TxTotal uint64  `json:"tx_total"`
	Errors  uint64  `json:"errors"`
	Drops   uint64  `json:"drops"`
}

type Disk struct {
	Name      string  `json:"name"`
	ReadRate  float64 `json:"read_rate"`
	WriteRate float64 `json:"write_rate"`
	ReadIOPS  float64 `json:"read_iops"`
	WriteIOPS float64 `json:"write_iops"`
	Util      float64 `json:"util"`
}

type Process struct {
	PID     int     `json:"pid"`
	Name    string  `json:"name"`
	User    string  `json:"user"`
	CPU     float64 `json:"cpu"` // percent of one core, like top
	RSS     uint64  `json:"rss"`
	Threads int     `json:"threads"`
	Unit    string  `json:"unit,omitempty"`
	Command string  `json:"command"`
	Started int64   `json:"started"` // unix seconds
}

type Listener struct {
	Proto   string `json:"proto"`
	Address string `json:"address"`
	Port    int    `json:"port"`
	Public  bool   `json:"public"`
	PID     int    `json:"pid,omitempty"`
	Process string `json:"process,omitempty"`
	Unit    string `json:"unit,omitempty"`
}

type Service struct {
	Unit        string   `json:"unit"`
	Scope       string   `json:"scope"` // system | user
	Description string   `json:"description"`
	Active      string   `json:"active"`
	Sub         string   `json:"sub"`
	Result      string   `json:"result,omitempty"`
	Custom      bool     `json:"custom"`
	MainPID     int      `json:"main_pid,omitempty"`
	Memory      uint64   `json:"memory,omitempty"`
	CPUNanos    uint64   `json:"cpu_nanos,omitempty"`
	Restarts    int      `json:"restarts"`
	Since       int64    `json:"since,omitempty"` // unix seconds of last state change
	RecentLogs  []string `json:"recent_logs,omitempty"`
}

type Timer struct {
	Unit       string   `json:"unit"`
	Scope      string   `json:"scope"`
	Activates  string   `json:"activates"`
	Custom     bool     `json:"custom"`
	Next       int64    `json:"next,omitempty"` // unix seconds
	Last       int64    `json:"last,omitempty"` // unix seconds
	Result     string   `json:"result,omitempty"`
	ExitCode   int      `json:"exit_code"`
	Running    bool     `json:"running"`
	RecentLogs []string `json:"recent_logs,omitempty"`
}

type ProbePoint struct {
	T       int64   `json:"t"`
	Up      bool    `json:"up"`
	Latency float64 `json:"latency_ms"`
}

type Endpoint struct {
	URL         string       `json:"url"`
	Source      string       `json:"source"` // caddy | config
	Up          bool         `json:"up"`
	Status      int          `json:"status"`
	Error       string       `json:"error,omitempty"`
	LatencyMS   float64      `json:"latency_ms"`
	CertExpires int64        `json:"cert_expires,omitempty"` // unix seconds
	CertIssuer  string       `json:"cert_issuer,omitempty"`
	CheckedAt   int64        `json:"checked_at"`
	UptimePct   float64      `json:"uptime_percent"`
	History     []ProbePoint `json:"history"`
}

type LogStats struct {
	ErrorsLastHour int       `json:"errors_last_hour"`
	SSHFailures24h int       `json:"ssh_failures_24h"`
	RecentErrors   []LogLine `json:"recent_errors"`
	ErrorUnits     []Count   `json:"error_units,omitempty"`
	SSH            SSHReport `json:"ssh"`
	CheckedAt      int64     `json:"checked_at"`
}

type Count struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}

// SSHReport summarizes 24 hours of sshd activity.
type SSHReport struct {
	Attempts     int               `json:"attempts"`
	UniqueIPs    int               `json:"unique_ips"`
	RootAttempts int               `json:"root_attempts"`
	TopIPs       []IPCount         `json:"top_ips,omitempty"`
	TopUsers     []Count           `json:"top_users,omitempty"`
	Accepted     []Login           `json:"accepted,omitempty"`
	Fail2ban     *Fail2ban         `json:"fail2ban,omitempty"`
	Config       map[string]string `json:"config,omitempty"`
}

type IPCount struct {
	IP     string `json:"ip"`
	Count  int    `json:"count"`
	Banned bool   `json:"banned"`
}

type Login struct {
	T      int64  `json:"t"`
	User   string `json:"user"`
	IP     string `json:"ip"`
	Method string `json:"method"`
}

type Fail2ban struct {
	CurrentlyFailed int      `json:"currently_failed"`
	TotalFailed     int      `json:"total_failed"`
	CurrentlyBanned int      `json:"currently_banned"`
	TotalBanned     int      `json:"total_banned"`
	Banned          []string `json:"banned,omitempty"`
	MaxRetry        int      `json:"max_retry"`
	FindTime        int      `json:"find_time"`
	BanTime         int      `json:"ban_time"`
}

type LogLine struct {
	T       int64  `json:"t"`
	Unit    string `json:"unit"`
	Message string `json:"message"`
}

// Alert is a finding with enough context to act on it: facts, the lists
// behind it, ready-to-run commands and a recommendation.
type Alert struct {
	Severity string      `json:"severity"` // critical | warning | info
	Title    string      `json:"title"`
	Detail   string      `json:"detail,omitempty"`
	Facts    []Fact      `json:"facts,omitempty"`
	Lists    []AlertList `json:"lists,omitempty"`
	Commands []Command   `json:"commands,omitempty"`
	Advice   string      `json:"advice,omitempty"`
}

type Fact struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type AlertList struct {
	Title string   `json:"title"`
	Items []string `json:"items"`
}

type Command struct {
	Label   string `json:"label"`
	Command string `json:"command"`
}

// Response is the payload of GET /api/monitor.
type Response struct {
	Supported   bool         `json:"supported"`
	Interval    int          `json:"interval"` // seconds between series points
	CollectedAt int64        `json:"collected_at"`
	Host        HostInfo     `json:"host"`
	Now         Current      `json:"now"`
	Series      []Sample     `json:"series"`
	Filesystems []Filesystem `json:"filesystems"`
	Interfaces  []Interface  `json:"interfaces"`
	Disks       []Disk       `json:"disks"`
	Processes   []Process    `json:"processes"`
	Listeners   []Listener   `json:"listeners"`
	Services    []Service    `json:"services"`
	Timers      []Timer      `json:"timers"`
	Endpoints   []Endpoint   `json:"endpoints"`
	Logs        LogStats     `json:"logs"`
	Alerts      []Alert      `json:"alerts"`
}

// ring is a fixed-capacity FIFO of samples.
type ring struct {
	buf  []Sample
	head int
	size int
}

func newRing(capacity int) *ring { return &ring{buf: make([]Sample, capacity)} }

func (r *ring) push(s Sample) {
	r.buf[(r.head+r.size)%len(r.buf)] = s
	if r.size < len(r.buf) {
		r.size++
	} else {
		r.head = (r.head + 1) % len(r.buf)
	}
}

// since returns samples with T > after and T >= from, oldest first.
func (r *ring) since(from, after int64) []Sample {
	out := make([]Sample, 0, r.size)
	for i := 0; i < r.size; i++ {
		s := r.buf[(r.head+i)%len(r.buf)]
		if s.T > after && s.T >= from {
			out = append(out, s)
		}
	}
	return out
}

func (r *ring) all() []Sample { return r.since(0, -1) }

// Monitor owns the collectors and their latest results.
type Monitor struct {
	mu        sync.RWMutex
	logger    *logrus.Entry
	collector *collector

	raw    *ring
	rollup *ring
	bucket []Sample

	host        HostInfo
	now         Current
	filesystems []Filesystem
	interfaces  []Interface
	disks       []Disk
	processes   []Process
	listeners   []Listener
	services    []Service
	timers      []Timer
	endpoints   []Endpoint
	logs        LogStats
	collectedAt int64

	statePath     string
	extraURLs     []string
	restoredUsage []usagePoint
}

// New creates a monitor. extraURLs are probed in addition to the hosts
// discovered from the local Caddy admin API.
func New(extraURLs []string) *Monitor {
	m := &Monitor{
		logger:    logrus.WithField("component", "monitor"),
		raw:       newRing(rawCapacity),
		rollup:    newRing(rollupCapacity),
		extraURLs: extraURLs,
	}
	if dir, err := dataDir(); err == nil {
		m.statePath = filepath.Join(dir, "monitor-history.json")
	}
	return m
}

// Supported reports whether the platform has a collector.
func Supported() bool { return supported }

// Run starts every collector loop and blocks until ctx is cancelled.
func (m *Monitor) Run(ctx context.Context) {
	if !supported {
		return
	}
	m.load()
	m.collector = newCollector(m.restoredUsage)
	m.mu.Lock()
	m.host = m.collector.hostInfo()
	m.mu.Unlock()

	var wg sync.WaitGroup
	loops := []struct {
		every time.Duration
		fn    func(context.Context)
	}{
		{SampleInterval, m.sample},
		{15 * time.Second, m.refreshSystemd},
		{30 * time.Second, m.refreshListeners},
		{60 * time.Second, m.refreshEndpoints},
		{5 * time.Minute, m.refreshLogs},
		{10 * time.Minute, m.refreshHost},
	}
	for _, loop := range loops {
		wg.Add(1)
		go func(every time.Duration, fn func(context.Context)) {
			defer wg.Done()
			fn(ctx)
			ticker := time.NewTicker(every)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					fn(ctx)
				}
			}
		}(loop.every, loop.fn)
	}

	persist := time.NewTicker(persistEvery)
	defer persist.Stop()
	for {
		select {
		case <-ctx.Done():
			wg.Wait()
			m.save()
			return
		case <-persist.C:
			m.save()
		}
	}
}

func (m *Monitor) sample(context.Context) {
	snap := m.collector.sample(time.Now())
	m.mu.Lock()
	defer m.mu.Unlock()
	m.now = snap.current
	m.filesystems = snap.filesystems
	m.interfaces = snap.interfaces
	m.disks = snap.disks
	m.processes = snap.processes
	m.collectedAt = snap.sample.T
	if !snap.valid {
		return // first pass only primes the counters
	}
	m.raw.push(snap.sample)

	minute := snap.sample.T / 60000
	if len(m.bucket) > 0 && m.bucket[0].T/60000 != minute {
		avg := average(m.bucket)
		avg.T = (m.bucket[0].T / 60000) * 60000
		m.rollup.push(avg)
		m.bucket = m.bucket[:0]
	}
	m.bucket = append(m.bucket, snap.sample)
}

func (m *Monitor) refreshHost(context.Context) {
	info := m.collector.hostInfo()
	m.mu.Lock()
	m.host = info
	m.mu.Unlock()
}

func (m *Monitor) refreshSystemd(ctx context.Context) {
	services, timers := collectSystemd(ctx)
	m.mu.Lock()
	m.services, m.timers = services, timers
	m.mu.Unlock()
}

func (m *Monitor) refreshListeners(context.Context) {
	listeners := collectListeners()
	m.mu.Lock()
	m.listeners = listeners
	m.mu.Unlock()
}

func (m *Monitor) refreshLogs(ctx context.Context) {
	logs := collectLogs(ctx)
	m.mu.Lock()
	m.logs = logs
	m.mu.Unlock()
}

func (m *Monitor) refreshEndpoints(ctx context.Context) {
	urls := discoverCaddyURLs(ctx)
	sources := make(map[string]string, len(urls)+len(m.extraURLs))
	for _, u := range urls {
		sources[u] = "caddy"
	}
	for _, u := range m.extraURLs {
		sources[u] = "config"
	}

	m.mu.RLock()
	previous := make(map[string]Endpoint, len(m.endpoints))
	for _, e := range m.endpoints {
		previous[e.URL] = e
	}
	m.mu.RUnlock()

	results := probeAll(ctx, sources)
	endpoints := make([]Endpoint, 0, len(results))
	for _, e := range results {
		history := append(previous[e.URL].History, ProbePoint{T: e.CheckedAt * 1000, Up: e.Up, Latency: e.LatencyMS})
		if len(history) > 1440 { // 24h at one probe per minute
			history = history[len(history)-1440:]
		}
		e.History = history
		up := 0
		for _, p := range history {
			if p.Up {
				up++
			}
		}
		e.UptimePct = float64(up) / float64(len(history)) * 100
		endpoints = append(endpoints, e)
	}
	sort.Slice(endpoints, func(i, j int) bool { return endpoints[i].URL < endpoints[j].URL })
	m.mu.Lock()
	m.endpoints = endpoints
	m.mu.Unlock()
}

// Snapshot builds the API response. rangeSec selects the series window;
// windows above one hour use the one-minute rollup. Only points newer than
// afterMS are returned so clients can poll incrementally.
func (m *Monitor) Snapshot(rangeSec int64, afterMS int64) Response {
	m.mu.RLock()
	defer m.mu.RUnlock()
	resp := Response{Supported: supported}
	if !supported {
		return resp
	}
	now := time.Now().UnixMilli()
	from := now - rangeSec*1000
	if rangeSec > 3600 {
		resp.Interval = 60
		resp.Series = m.rollup.since(from, afterMS)
	} else {
		resp.Interval = int(SampleInterval / time.Second)
		resp.Series = m.raw.since(from, afterMS)
	}
	resp.CollectedAt = m.collectedAt
	resp.Host = m.host
	resp.Now = m.now
	resp.Filesystems = m.withForecast(m.filesystems)
	resp.Interfaces = m.interfaces
	resp.Disks = m.disks
	resp.Processes = m.processes
	resp.Listeners = m.listeners
	resp.Services = m.services
	resp.Timers = m.timers
	resp.Endpoints = m.endpoints
	resp.Logs = m.logs
	resp.Alerts = m.buildAlerts(&resp)
	return resp
}

func average(samples []Sample) Sample {
	var a Sample
	for _, s := range samples {
		a.CPU += s.CPU
		a.IOWait += s.IOWait
		a.Steal += s.Steal
		a.Load1 += s.Load1
		a.Mem += s.Mem
		a.Swap += s.Swap
		a.NetRx += s.NetRx
		a.NetTx += s.NetTx
		a.DiskR += s.DiskR
		a.DiskW += s.DiskW
		a.DiskUtil += s.DiskUtil
		a.PSICPU += s.PSICPU
		a.PSIMem += s.PSIMem
		a.PSIIO += s.PSIIO
		a.TCP += s.TCP
	}
	n := float64(len(samples))
	if n == 0 {
		return a
	}
	a.CPU /= n
	a.IOWait /= n
	a.Steal /= n
	a.Load1 /= n
	a.Mem /= n
	a.Swap /= n
	a.NetRx /= n
	a.NetTx /= n
	a.DiskR /= n
	a.DiskW /= n
	a.DiskUtil /= n
	a.PSICPU /= n
	a.PSIMem /= n
	a.PSIIO /= n
	a.TCP /= n
	return a
}

// persisted is the on-disk form of the long-term history.
type persisted struct {
	Version   int                     `json:"version"`
	Rollup    []Sample                `json:"rollup"`
	RootUsage []usagePoint            `json:"root_usage"`
	Probes    map[string][]ProbePoint `json:"probes"`
}

func (m *Monitor) save() {
	if m.statePath == "" {
		return
	}
	m.mu.RLock()
	data := persisted{Version: 1, Rollup: m.rollup.all(), Probes: map[string][]ProbePoint{}}
	if m.collector != nil {
		data.RootUsage = m.collector.usageHistory()
	}
	for _, e := range m.endpoints {
		data.Probes[e.URL] = e.History
	}
	m.mu.RUnlock()
	raw, err := json.Marshal(data)
	if err != nil {
		return
	}
	tmp := m.statePath + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		m.logger.WithError(err).Debug("persist monitor history")
		return
	}
	_ = os.Rename(tmp, m.statePath)
}

func (m *Monitor) load() {
	if m.statePath == "" {
		return
	}
	raw, err := os.ReadFile(m.statePath)
	if err != nil {
		return
	}
	var data persisted
	if json.Unmarshal(raw, &data) != nil || data.Version != 1 {
		return
	}
	cutoff := time.Now().Add(-24 * time.Hour).UnixMilli()
	for _, s := range data.Rollup {
		if s.T >= cutoff {
			m.rollup.push(s)
		}
	}
	for url, history := range data.Probes {
		kept := history[:0]
		for _, p := range history {
			if p.T >= cutoff {
				kept = append(kept, p)
			}
		}
		if len(kept) > 0 {
			m.endpoints = append(m.endpoints, Endpoint{URL: url, History: kept})
		}
	}
	m.restoredUsage = data.RootUsage
}

func dataDir() (string, error) {
	dir, err := paths.DataDir()
	if err != nil {
		return "", err
	}
	return dir, os.MkdirAll(dir, 0o700)
}
