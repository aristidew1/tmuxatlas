//go:build linux

package monitor

import (
	"bufio"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const supported = true

const clockTicks = 100 // USER_HZ; 100 on every mainstream Linux build

type cpuTimes struct {
	user, nice, system, idle, iowait, irq, softirq, steal float64
}

func (c cpuTimes) total() float64 {
	return c.user + c.nice + c.system + c.idle + c.iowait + c.irq + c.softirq + c.steal
}

type ioCounters struct {
	rx, tx, rxErr, txErr, rxDrop, txDrop uint64
}

type diskCounters struct {
	reads, writes, sectorsRead, sectorsWritten, ioTicks uint64
}

type procTimes struct {
	ticks     float64
	starttime uint64
}

type usagePoint struct {
	T     int64  `json:"t"`
	Used  uint64 `json:"used"`
	Total uint64 `json:"total"`
}

type collector struct {
	prevAt    time.Time
	prevCPU   cpuTimes
	prevCores []cpuTimes
	prevNet   map[string]ioCounters
	prevDisk  map[string]diskCounters
	prevProc  map[int]procTimes
	users     map[uint32]string
	pageSize  uint64
	bootTime  int64

	usage       []usagePoint
	lastUsageAt time.Time
}

type snapshot struct {
	valid       bool
	sample      Sample
	current     Current
	filesystems []Filesystem
	interfaces  []Interface
	disks       []Disk
	processes   []Process
}

func newCollector(usage []usagePoint) *collector {
	c := &collector{
		prevNet:  map[string]ioCounters{},
		prevDisk: map[string]diskCounters{},
		prevProc: map[int]procTimes{},
		pageSize: uint64(os.Getpagesize()),
		usage:    usage,
	}
	c.users = readUsers()
	return c
}

func (c *collector) usageHistory() []usagePoint {
	return append([]usagePoint(nil), c.usage...)
}

func (c *collector) hostInfo() HostInfo {
	c.users = readUsers()
	info := HostInfo{
		Arch: runtime.GOARCH,
		CPUs: runtime.NumCPU(),
	}
	info.Hostname, _ = os.Hostname()
	info.Kernel = strings.TrimSpace(readString("/proc/sys/kernel/osrelease"))
	for _, line := range strings.Split(readString("/etc/os-release"), "\n") {
		if v, ok := strings.CutPrefix(line, "PRETTY_NAME="); ok {
			info.OS = strings.Trim(v, `"`)
		}
	}
	for _, line := range strings.Split(readString("/proc/cpuinfo"), "\n") {
		if strings.HasPrefix(line, "model name") {
			if _, v, ok := strings.Cut(line, ":"); ok {
				info.CPUModel = strings.TrimSpace(v)
				break
			}
		}
	}
	for _, line := range strings.Split(readString("/proc/stat"), "\n") {
		if v, ok := strings.CutPrefix(line, "btime "); ok {
			info.BootTime, _ = strconv.ParseInt(strings.TrimSpace(v), 10, 64)
			c.bootTime = info.BootTime
		}
	}
	_, err := os.Stat("/var/run/reboot-required")
	info.RebootRequired = err == nil
	info.Updates, info.SecurityUpdate = pendingUpdates()
	if pkgs, ok := upgradablePackages(); ok {
		info.Packages = pkgs
		info.Updates, info.SecurityUpdate = len(pkgs), 0
		for _, p := range pkgs {
			if p.Security {
				info.SecurityUpdate++
			}
		}
	}
	if info.RebootRequired {
		for _, line := range strings.Split(readString("/var/run/reboot-required.pkgs"), "\n") {
			if line = strings.TrimSpace(line); line != "" && !slices.Contains(info.RebootPackages, line) {
				info.RebootPackages = append(info.RebootPackages, line)
			}
		}
	}
	info.LatestKernel = latestInstalledKernel()
	return info
}

// upgradablePackages reads the apt cache ("apt list --upgradable"). It does not
// refresh package indexes, so it never touches the network.
func upgradablePackages() ([]Package, bool) {
	if _, err := exec.LookPath("apt"); err != nil {
		return nil, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "apt", "list", "--upgradable")
	cmd.Env = append(os.Environ(), "LANG=C", "LC_ALL=C")
	out, err := cmd.Output()
	if err != nil {
		return nil, false
	}
	pkgs := []Package{}
	for _, line := range strings.Split(string(out), "\n") {
		// tailscale/unknown 1.104.5 amd64 [upgradable from: 1.104.4]
		fields := strings.Fields(line)
		if len(fields) < 6 || !strings.Contains(fields[0], "/") {
			continue
		}
		name, suite, _ := strings.Cut(fields[0], "/")
		pkgs = append(pkgs, Package{
			Name: name, Suite: suite, To: fields[1],
			From:     strings.TrimSuffix(fields[len(fields)-1], "]"),
			Security: strings.Contains(suite, "-security"),
		})
	}
	sort.Slice(pkgs, func(i, j int) bool {
		if pkgs[i].Security != pkgs[j].Security {
			return pkgs[i].Security
		}
		return pkgs[i].Name < pkgs[j].Name
	})
	return pkgs, true
}

func latestInstalledKernel() string {
	matches, _ := filepath.Glob("/boot/vmlinuz-*")
	latest := ""
	for _, m := range matches {
		v := strings.TrimPrefix(filepath.Base(m), "vmlinuz-")
		if latest == "" || compareVersions(v, latest) > 0 {
			latest = v
		}
	}
	return latest
}

// compareVersions compares dotted/dashed version strings numerically.
func compareVersions(a, b string) int {
	split := func(s string) []string {
		return strings.FieldsFunc(s, func(r rune) bool { return r == '.' || r == '-' })
	}
	pa, pb := split(a), split(b)
	for i := 0; i < len(pa) && i < len(pb); i++ {
		na, ea := strconv.Atoi(pa[i])
		nb, eb := strconv.Atoi(pb[i])
		if ea == nil && eb == nil {
			if na != nb {
				return na - nb
			}
			continue
		}
		if c := strings.Compare(pa[i], pb[i]); c != 0 {
			return c
		}
	}
	return len(pa) - len(pb)
}

// pendingUpdates parses the update-notifier MOTD cache (Debian/Ubuntu).
func pendingUpdates() (int, int) {
	text := readString("/var/lib/update-notifier/updates-available")
	updates, security := 0, 0
	for _, line := range strings.Split(text, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || strings.Contains(line, "ESM") || strings.Contains(line, "additional") {
			continue // ESM-only updates are not installable without a subscription
		}
		n, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		switch {
		case strings.Contains(line, "security"):
			security = n
		case strings.Contains(line, "can be applied"):
			updates = n
		}
	}
	return updates, security
}

func (c *collector) sample(now time.Time) snapshot {
	snap := snapshot{sample: Sample{T: now.UnixMilli()}}
	elapsed := now.Sub(c.prevAt).Seconds()
	first := c.prevAt.IsZero()
	snap.valid = !first && elapsed > 0
	if elapsed <= 0 {
		elapsed = 1
	}

	cur := &snap.current

	// CPU
	total, cores, procsRunning := readCPU()
	cur.ProcsRunning = procsRunning
	if !first {
		cur.CPU = cpuBreakdown(c.prevCPU, total)
		cur.Cores = make([]float64, len(cores))
		for i := range cores {
			if i < len(c.prevCores) {
				b := cpuBreakdown(c.prevCores[i], cores[i])
				cur.Cores[i] = round1(100 - b.Idle - b.IOWait)
			}
		}
	}
	cpuDeltaTotal := total.total() - c.prevCPU.total()
	c.prevCPU, c.prevCores = total, cores

	// Load and process count
	if fields := strings.Fields(readString("/proc/loadavg")); len(fields) >= 4 {
		for i := 0; i < 3; i++ {
			cur.Load[i], _ = strconv.ParseFloat(fields[i], 64)
		}
	}
	if up := strings.Fields(readString("/proc/uptime")); len(up) > 0 {
		cur.UptimeSec, _ = strconv.ParseFloat(up[0], 64)
	}

	cur.Memory = readMemory()
	cur.PSI = readPSI()
	cur.TCP = readTCPStates()

	// Network
	netNow := readNet()
	var rxRate, txRate float64
	for name, counters := range netNow {
		prev, ok := c.prevNet[name]
		iface := Interface{
			Name: name, RxTotal: counters.rx, TxTotal: counters.tx,
			Errors: counters.rxErr + counters.txErr, Drops: counters.rxDrop + counters.txDrop,
		}
		if ok && !first {
			iface.RxRate = round1(rate(prev.rx, counters.rx, elapsed))
			iface.TxRate = round1(rate(prev.tx, counters.tx, elapsed))
		}
		if isPhysicalInterface(name) {
			rxRate += iface.RxRate
			txRate += iface.TxRate
		}
		if counters.rx > 0 || counters.tx > 0 {
			snap.interfaces = append(snap.interfaces, iface)
		}
	}
	sort.Slice(snap.interfaces, func(i, j int) bool {
		return snap.interfaces[i].RxTotal+snap.interfaces[i].TxTotal > snap.interfaces[j].RxTotal+snap.interfaces[j].TxTotal
	})
	c.prevNet = netNow

	// Block devices
	diskNow := readDisks()
	var readRate, writeRate, maxUtil float64
	for name, counters := range diskNow {
		d := Disk{Name: name}
		if prev, ok := c.prevDisk[name]; ok && !first {
			d.ReadRate = round1(rate(prev.sectorsRead, counters.sectorsRead, elapsed) * 512)
			d.WriteRate = round1(rate(prev.sectorsWritten, counters.sectorsWritten, elapsed) * 512)
			d.ReadIOPS = round1(rate(prev.reads, counters.reads, elapsed))
			d.WriteIOPS = round1(rate(prev.writes, counters.writes, elapsed))
			d.Util = round1(min(100, rate(prev.ioTicks, counters.ioTicks, elapsed)/10))
		}
		readRate += d.ReadRate
		writeRate += d.WriteRate
		maxUtil = max(maxUtil, d.Util)
		snap.disks = append(snap.disks, d)
	}
	sort.Slice(snap.disks, func(i, j int) bool { return snap.disks[i].Name < snap.disks[j].Name })
	c.prevDisk = diskNow

	snap.filesystems = readFilesystems()
	c.recordUsage(now, snap.filesystems)

	// Processes
	snap.processes, cur.Procs, cur.Threads = c.readProcesses(elapsed, first, cpuDeltaTotal)

	mem := cur.Memory
	snap.sample.CPU = round1(100 - cur.CPU.Idle)
	snap.sample.IOWait = round1(cur.CPU.IOWait)
	snap.sample.Steal = round1(cur.CPU.Steal)
	snap.sample.Load1 = cur.Load[0]
	if mem.Total > 0 {
		snap.sample.Mem = round1(float64(mem.Used) / float64(mem.Total) * 100)
	}
	if mem.SwapTotal > 0 {
		snap.sample.Swap = round1(float64(mem.SwapUsed) / float64(mem.SwapTotal) * 100)
	}
	snap.sample.NetRx = round1(rxRate)
	snap.sample.NetTx = round1(txRate)
	snap.sample.DiskR = round1(readRate)
	snap.sample.DiskW = round1(writeRate)
	snap.sample.DiskUtil = maxUtil
	snap.sample.PSICPU = cur.PSI.CPU10
	snap.sample.PSIMem = cur.PSI.Mem10
	snap.sample.PSIIO = cur.PSI.IO10
	snap.sample.TCP = float64(cur.TCP.Established)

	c.prevAt = now
	return snap
}

func cpuBreakdown(prev, cur cpuTimes) CPUBreakdown {
	d := cur.total() - prev.total()
	if d <= 0 {
		return CPUBreakdown{Idle: 100}
	}
	pct := func(a, b float64) float64 { return round1(max(0, (b-a)/d*100)) }
	return CPUBreakdown{
		User:   pct(prev.user+prev.nice, cur.user+cur.nice),
		System: pct(prev.system+prev.irq+prev.softirq, cur.system+cur.irq+cur.softirq),
		IOWait: pct(prev.iowait, cur.iowait),
		Steal:  pct(prev.steal, cur.steal),
		Idle:   pct(prev.idle, cur.idle),
	}
}

func readCPU() (cpuTimes, []cpuTimes, int) {
	var total cpuTimes
	var cores []cpuTimes
	running := 0
	for _, line := range strings.Split(readString("/proc/stat"), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		switch {
		case fields[0] == "cpu":
			total = parseCPU(fields)
		case strings.HasPrefix(fields[0], "cpu"):
			cores = append(cores, parseCPU(fields))
		case fields[0] == "procs_running" && len(fields) > 1:
			running, _ = strconv.Atoi(fields[1])
		}
	}
	return total, cores, running
}

func parseCPU(fields []string) cpuTimes {
	v := make([]float64, 9)
	for i := 1; i < len(fields) && i < 9; i++ {
		v[i], _ = strconv.ParseFloat(fields[i], 64)
	}
	return cpuTimes{user: v[1], nice: v[2], system: v[3], idle: v[4], iowait: v[5], irq: v[6], softirq: v[7], steal: v[8]}
}

func readMemory() Memory {
	info := map[string]uint64{}
	for _, line := range strings.Split(readString("/proc/meminfo"), "\n") {
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		n, _ := strconv.ParseUint(strings.TrimSuffix(strings.TrimSpace(val), " kB"), 10, 64)
		info[key] = n * 1024
	}
	m := Memory{
		Total:     info["MemTotal"],
		Available: info["MemAvailable"],
		Cached:    info["Buffers"] + info["Cached"] + info["SReclaimable"],
		SwapTotal: info["SwapTotal"],
	}
	if m.Total > m.Available {
		m.Used = m.Total - m.Available
	}
	if m.SwapTotal > info["SwapFree"] {
		m.SwapUsed = m.SwapTotal - info["SwapFree"]
	}
	return m
}

func readPSI() PSI {
	parse := func(name string) (float64, float64) {
		for _, line := range strings.Split(readString("/proc/pressure/"+name), "\n") {
			if !strings.HasPrefix(line, "some ") {
				continue
			}
			var a10, a60 float64
			for _, f := range strings.Fields(line) {
				if v, ok := strings.CutPrefix(f, "avg10="); ok {
					a10, _ = strconv.ParseFloat(v, 64)
				}
				if v, ok := strings.CutPrefix(f, "avg60="); ok {
					a60, _ = strconv.ParseFloat(v, 64)
				}
			}
			return a10, a60
		}
		return 0, 0
	}
	var p PSI
	p.CPU10, p.CPU60 = parse("cpu")
	p.Mem10, p.Mem60 = parse("memory")
	p.IO10, p.IO60 = parse("io")
	return p
}

func readTCPStates() TCPStates {
	var s TCPStates
	for _, path := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		forEachSocketLine(path, func(fields []string) {
			switch fields[3] {
			case "01":
				s.Established++
			case "06":
				s.TimeWait++
			case "0A":
				s.Listen++
			}
		})
	}
	return s
}

func readNet() map[string]ioCounters {
	out := map[string]ioCounters{}
	for _, line := range strings.Split(readString("/proc/net/dev"), "\n") {
		name, rest, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		f := strings.Fields(rest)
		if name == "lo" || len(f) < 16 {
			continue
		}
		u := func(i int) uint64 { n, _ := strconv.ParseUint(f[i], 10, 64); return n }
		out[name] = ioCounters{rx: u(0), rxErr: u(2), rxDrop: u(3), tx: u(8), txErr: u(10), txDrop: u(11)}
	}
	return out
}

func isPhysicalInterface(name string) bool {
	_, err := os.Stat(filepath.Join("/sys/class/net", name, "device"))
	return err == nil
}

func readDisks() map[string]diskCounters {
	out := map[string]diskCounters{}
	for _, line := range strings.Split(readString("/proc/diskstats"), "\n") {
		f := strings.Fields(line)
		if len(f) < 14 {
			continue
		}
		name := f[2]
		if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") ||
			strings.HasPrefix(name, "sr") || strings.HasPrefix(name, "dm-") || strings.HasPrefix(name, "md") {
			continue
		}
		// Whole devices only: partitions have a "partition" attribute.
		if _, err := os.Stat(filepath.Join("/sys/block", name)); err != nil {
			continue
		}
		u := func(i int) uint64 { n, _ := strconv.ParseUint(f[i], 10, 64); return n }
		out[name] = diskCounters{reads: u(3), sectorsRead: u(5), writes: u(7), sectorsWritten: u(9), ioTicks: u(12)}
	}
	return out
}

var realFilesystems = map[string]bool{
	"ext2": true, "ext3": true, "ext4": true, "xfs": true, "btrfs": true, "vfat": true,
	"exfat": true, "zfs": true, "f2fs": true, "ntfs": true, "ntfs3": true, "fuseblk": true,
}

func readFilesystems() []Filesystem {
	seen := map[string]bool{}
	var out []Filesystem
	for _, line := range strings.Split(readString("/proc/mounts"), "\n") {
		f := strings.Fields(line)
		if len(f) < 3 || !realFilesystems[f[2]] || seen[f[0]] {
			continue
		}
		mount := strings.ReplaceAll(f[1], `\040`, " ")
		if strings.HasPrefix(mount, "/snap/") || strings.HasPrefix(mount, "/var/snap/") {
			continue
		}
		var st syscall.Statfs_t
		if syscall.Statfs(mount, &st) != nil || st.Blocks == 0 {
			continue
		}
		seen[f[0]] = true
		bsize := uint64(st.Bsize)
		total := st.Blocks * bsize
		free := st.Bfree * bsize
		avail := st.Bavail * bsize
		used := total - free
		fs := Filesystem{Mount: mount, Device: f[0], FSType: f[2], Total: total, Used: used, Available: avail}
		if used+avail > 0 {
			fs.Percent = round1(float64(used) / float64(used+avail) * 100)
		}
		if st.Files > 0 {
			fs.InodesPct = round1(float64(st.Files-st.Ffree) / float64(st.Files) * 100)
		}
		out = append(out, fs)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Mount < out[j].Mount })
	return out
}

// recordUsage keeps one root-filesystem usage point every 10 minutes for up to
// 7 days, used to forecast when the disk fills up.
func (c *collector) recordUsage(now time.Time, filesystems []Filesystem) {
	if now.Sub(c.lastUsageAt) < 10*time.Minute {
		return
	}
	for _, fs := range filesystems {
		if fs.Mount != "/" {
			continue
		}
		c.lastUsageAt = now
		c.usage = append(c.usage, usagePoint{T: now.UnixMilli(), Used: fs.Used, Total: fs.Total})
		cutoff := now.Add(-7 * 24 * time.Hour).UnixMilli()
		i := 0
		for i < len(c.usage) && c.usage[i].T < cutoff {
			i++
		}
		c.usage = c.usage[i:]
	}
}

// withForecast annotates the root filesystem with a linear growth estimate.
func (m *Monitor) withForecast(filesystems []Filesystem) []Filesystem {
	if m.collector == nil || len(filesystems) == 0 {
		return filesystems
	}
	points := m.collector.usage
	if len(points) < 12 || points[len(points)-1].T-points[0].T < int64(6*time.Hour/time.Millisecond) {
		return filesystems
	}
	// Least squares of used bytes over days.
	var sx, sy, sxx, sxy float64
	t0 := float64(points[0].T)
	for _, p := range points {
		x := (float64(p.T) - t0) / 86400000
		y := float64(p.Used)
		sx += x
		sy += y
		sxx += x * x
		sxy += x * y
	}
	n := float64(len(points))
	denom := n*sxx - sx*sx
	if denom == 0 {
		return filesystems
	}
	slope := (n*sxy - sx*sy) / denom // bytes per day
	out := append([]Filesystem(nil), filesystems...)
	for i := range out {
		if out[i].Mount != "/" {
			continue
		}
		out[i].GrowthPerDay = slope
		if slope > 0 {
			out[i].DaysToFull = round1(float64(out[i].Available) / slope)
		}
	}
	return out
}

func (c *collector) readProcesses(elapsed float64, first bool, cpuDeltaTotal float64) ([]Process, int, int) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, 0, 0
	}
	next := make(map[int]procTimes, len(c.prevProc))
	all := make([]Process, 0, len(entries))
	threads := 0
	ncpu := float64(runtime.NumCPU())
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		raw := readString(filepath.Join("/proc", e.Name(), "stat"))
		closeIdx := strings.LastIndexByte(raw, ')')
		openIdx := strings.IndexByte(raw, '(')
		if closeIdx < 0 || openIdx < 0 || closeIdx+2 > len(raw) {
			continue
		}
		rest := strings.Fields(raw[closeIdx+2:])
		if len(rest) < 22 {
			continue
		}
		utime, _ := strconv.ParseFloat(rest[11], 64)
		stime, _ := strconv.ParseFloat(rest[12], 64)
		nthreads, _ := strconv.Atoi(rest[17])
		start, _ := strconv.ParseUint(rest[19], 10, 64)
		rssPages, _ := strconv.ParseUint(rest[21], 10, 64)
		threads += nthreads

		ticks := utime + stime
		next[pid] = procTimes{ticks: ticks, starttime: start}
		p := Process{
			PID:     pid,
			Name:    raw[openIdx+1 : closeIdx],
			RSS:     rssPages * c.pageSize,
			Threads: nthreads,
			Started: c.bootTime + int64(start/clockTicks),
		}
		if prev, ok := c.prevProc[pid]; ok && !first && prev.starttime == start {
			if cpuDeltaTotal > 0 {
				// Share of all CPU time, scaled to "percent of one core".
				p.CPU = round1((ticks - prev.ticks) / cpuDeltaTotal * 100 * ncpu)
			} else {
				p.CPU = round1((ticks - prev.ticks) / clockTicks / elapsed * 100)
			}
		}
		all = append(all, p)
	}
	c.prevProc = next

	// Keep the union of the top consumers by CPU and by memory.
	keep := map[int]bool{}
	sort.Slice(all, func(i, j int) bool { return all[i].CPU > all[j].CPU })
	for i := 0; i < len(all) && i < 12; i++ {
		keep[all[i].PID] = true
	}
	sort.Slice(all, func(i, j int) bool { return all[i].RSS > all[j].RSS })
	for i := 0; i < len(all) && i < 12; i++ {
		keep[all[i].PID] = true
	}
	top := make([]Process, 0, len(keep))
	for _, p := range all {
		if !keep[p.PID] {
			continue
		}
		dir := filepath.Join("/proc", strconv.Itoa(p.PID))
		p.Command = readCmdline(dir)
		if p.Command == "" {
			p.Command = "[" + p.Name + "]"
		}
		p.Unit = unitFromCgroup(readString(filepath.Join(dir, "cgroup")))
		if info, err := os.Stat(dir); err == nil {
			if st, ok := info.Sys().(*syscall.Stat_t); ok {
				p.User = c.users[st.Uid]
				if p.User == "" {
					p.User = strconv.Itoa(int(st.Uid))
				}
			}
		}
		top = append(top, p)
	}
	return top, len(all), threads
}

func readCmdline(dir string) string {
	raw, err := os.ReadFile(filepath.Join(dir, "cmdline"))
	if err != nil || len(raw) == 0 {
		return ""
	}
	cmd := strings.TrimSpace(strings.ReplaceAll(string(raw), "\x00", " "))
	if len(cmd) > 240 {
		cmd = cmd[:240] + "…"
	}
	return cmd
}

// unitFromCgroup extracts the systemd unit (service or scope) owning a process.
func unitFromCgroup(cgroup string) string {
	for _, line := range strings.Split(cgroup, "\n") {
		_, path, ok := strings.Cut(line, "::")
		if !ok {
			continue
		}
		parts := strings.Split(strings.Trim(path, "/"), "/")
		for i := len(parts) - 1; i >= 0; i-- {
			p := parts[i]
			if strings.HasSuffix(p, ".service") || strings.HasSuffix(p, ".scope") {
				if strings.HasPrefix(p, "user@") && i < len(parts)-1 {
					continue
				}
				return p
			}
		}
	}
	return ""
}

func readUsers() map[uint32]string {
	users := map[uint32]string{}
	for _, line := range strings.Split(readString("/etc/passwd"), "\n") {
		f := strings.Split(line, ":")
		if len(f) < 3 {
			continue
		}
		if uid, err := strconv.ParseUint(f[2], 10, 32); err == nil {
			users[uint32(uid)] = f[0]
		}
	}
	return users
}

// collectListeners lists TCP listening sockets and bound UDP sockets with the
// process that owns them.
func collectListeners() []Listener {
	type key struct {
		proto, addr string
		port        int
	}
	byInode := map[string]Listener{}
	seen := map[key]bool{}
	sources := []struct{ path, proto, state string }{
		{"/proc/net/tcp", "tcp", "0A"}, {"/proc/net/tcp6", "tcp", "0A"},
		{"/proc/net/udp", "udp", "07"}, {"/proc/net/udp6", "udp", "07"},
	}
	for _, src := range sources {
		forEachSocketLine(src.path, func(f []string) {
			if f[3] != src.state || len(f) < 10 {
				return
			}
			if src.proto == "udp" && !strings.HasSuffix(f[2], ":0000") {
				return // connected UDP socket, not a server
			}
			addr, port := parseSocketAddr(f[1])
			if port == 0 || (src.proto == "udp" && port >= 32768) {
				return
			}
			k := key{src.proto, addr, port}
			if seen[k] {
				return
			}
			seen[k] = true
			byInode[f[9]] = Listener{Proto: src.proto, Address: addr, Port: port, Public: isPublicAddr(addr)}
		})
	}
	// Resolve socket inodes to processes.
	if entries, err := os.ReadDir("/proc"); err == nil && len(byInode) > 0 {
		for _, e := range entries {
			pid, err := strconv.Atoi(e.Name())
			if err != nil {
				continue
			}
			fdDir := filepath.Join("/proc", e.Name(), "fd")
			fds, err := os.ReadDir(fdDir)
			if err != nil {
				continue
			}
			for _, fd := range fds {
				target, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
				if err != nil || !strings.HasPrefix(target, "socket:[") {
					continue
				}
				inode := target[8 : len(target)-1]
				l, ok := byInode[inode]
				if !ok || l.PID != 0 {
					continue
				}
				l.PID = pid
				stat := readString(filepath.Join("/proc", e.Name(), "stat"))
				if o, c := strings.IndexByte(stat, '('), strings.LastIndexByte(stat, ')'); o >= 0 && c > o {
					l.Process = stat[o+1 : c]
				}
				l.Unit = unitFromCgroup(readString(filepath.Join("/proc", e.Name(), "cgroup")))
				byInode[inode] = l
			}
		}
	}
	out := make([]Listener, 0, len(byInode))
	for _, l := range byInode {
		out = append(out, l)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Public != out[j].Public {
			return out[i].Public
		}
		if out[i].Port != out[j].Port {
			return out[i].Port < out[j].Port
		}
		return out[i].Proto+out[i].Address < out[j].Proto+out[j].Address
	})
	return out
}

func forEachSocketLine(path string, fn func([]string)) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Scan() // header
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 4 {
			fn(fields)
		}
	}
}

// parseSocketAddr decodes the kernel's little-endian hex "ADDR:PORT" format.
func parseSocketAddr(s string) (string, int) {
	hexAddr, hexPort, ok := strings.Cut(s, ":")
	if !ok {
		return "", 0
	}
	port, _ := strconv.ParseInt(hexPort, 16, 32)
	switch len(hexAddr) {
	case 8:
		b := make([]byte, 4)
		for i := 0; i < 4; i++ {
			v, _ := strconv.ParseUint(hexAddr[i*2:i*2+2], 16, 8)
			b[3-i] = byte(v)
		}
		return strconv.Itoa(int(b[0])) + "." + strconv.Itoa(int(b[1])) + "." + strconv.Itoa(int(b[2])) + "." + strconv.Itoa(int(b[3])), int(port)
	case 32:
		b := make([]byte, 16)
		for word := 0; word < 4; word++ {
			for i := 0; i < 4; i++ {
				v, _ := strconv.ParseUint(hexAddr[word*8+i*2:word*8+i*2+2], 16, 8)
				b[word*4+3-i] = byte(v)
			}
		}
		return formatIPv6(b), int(port)
	}
	return "", int(port)
}

func formatIPv6(b []byte) string {
	allZero := true
	for _, v := range b {
		if v != 0 {
			allZero = false
		}
	}
	if allZero {
		return "::"
	}
	// IPv4-mapped
	mapped := true
	for i := 0; i < 10; i++ {
		if b[i] != 0 {
			mapped = false
		}
	}
	if mapped && b[10] == 0xff && b[11] == 0xff {
		return strconv.Itoa(int(b[12])) + "." + strconv.Itoa(int(b[13])) + "." + strconv.Itoa(int(b[14])) + "." + strconv.Itoa(int(b[15]))
	}
	loopback := true
	for i := 0; i < 15; i++ {
		if b[i] != 0 {
			loopback = false
		}
	}
	if loopback && b[15] == 1 {
		return "::1"
	}
	parts := make([]string, 8)
	for i := 0; i < 8; i++ {
		parts[i] = strconv.FormatUint(uint64(b[i*2])<<8|uint64(b[i*2+1]), 16)
	}
	return strings.Join(parts, ":")
}

func isPublicAddr(addr string) bool {
	return !strings.HasPrefix(addr, "127.") && addr != "::1"
}

func rate(prev, cur uint64, seconds float64) float64 {
	if cur < prev || seconds <= 0 {
		return 0
	}
	return float64(cur-prev) / seconds
}

func readString(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(raw)
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}
