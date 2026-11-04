//go:build linux

package monitor

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// collectSystemd lists system and user services plus timers. It shells out to
// systemctl, which keeps the binary free of D-Bus dependencies.
func collectSystemd(ctx context.Context) ([]Service, []Timer) {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return nil, nil
	}
	boot := bootTime()
	var services []Service
	var timers []Timer
	for _, scope := range []string{"system", "user"} {
		services = append(services, listServices(ctx, scope, boot)...)
		timers = append(timers, listTimers(ctx, scope)...)
	}
	sort.SliceStable(services, func(i, j int) bool {
		ri, rj := serviceRank(services[i]), serviceRank(services[j])
		if ri != rj {
			return ri < rj
		}
		if services[i].Memory != services[j].Memory {
			return services[i].Memory > services[j].Memory
		}
		return services[i].Unit < services[j].Unit
	})
	sort.SliceStable(timers, func(i, j int) bool {
		if timers[i].Custom != timers[j].Custom {
			return timers[i].Custom
		}
		return timers[i].Unit < timers[j].Unit
	})
	return services, timers
}

func serviceRank(s Service) int {
	switch {
	case s.Active == "failed":
		return 0
	case s.Custom:
		return 1
	default:
		return 2
	}
}

func systemctl(ctx context.Context, scope string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	full := append([]string{"--no-pager"}, args...)
	if scope == "user" {
		full = append([]string{"--user"}, full...)
	}
	return exec.CommandContext(ctx, "systemctl", full...).Output()
}

type unitRow struct {
	Unit        string `json:"unit"`
	Load        string `json:"load"`
	Active      string `json:"active"`
	Sub         string `json:"sub"`
	Description string `json:"description"`
}

func listServices(ctx context.Context, scope string, boot int64) []Service {
	raw, err := systemctl(ctx, scope, "list-units", "--type=service", "--all", "--output=json")
	if err != nil {
		return nil
	}
	var rows []unitRow
	if json.Unmarshal(raw, &rows) != nil {
		return nil
	}
	var names []string
	byName := map[string]unitRow{}
	for _, r := range rows {
		if r.Load != "loaded" {
			continue
		}
		// Running or broken services; oneshots that exited cleanly are noise.
		if r.Active == "failed" || r.Sub == "running" || r.Active == "activating" || r.Active == "reloading" {
			names = append(names, r.Unit)
			byName[r.Unit] = r
		}
	}
	if len(names) == 0 {
		return nil
	}
	props := showUnits(ctx, scope, names,
		"Id,Result,MainPID,MemoryCurrent,CPUUsageNSec,NRestarts,StateChangeTimestampMonotonic,FragmentPath")
	out := make([]Service, 0, len(names))
	for _, name := range names {
		r := byName[name]
		p := props[name]
		s := Service{
			Unit: name, Scope: scope, Description: r.Description,
			Active: r.Active, Sub: r.Sub, Result: p["Result"],
			Custom: isCustomUnit(name, p["FragmentPath"], scope),
		}
		s.MainPID, _ = strconv.Atoi(p["MainPID"])
		s.Memory, _ = strconv.ParseUint(p["MemoryCurrent"], 10, 64)
		s.CPUNanos, _ = strconv.ParseUint(p["CPUUsageNSec"], 10, 64)
		s.Restarts, _ = strconv.Atoi(p["NRestarts"])
		if mono, err := strconv.ParseInt(p["StateChangeTimestampMonotonic"], 10, 64); err == nil && mono > 0 && boot > 0 {
			s.Since = boot + mono/1_000_000
		}
		if s.Memory == ^uint64(0) {
			s.Memory = 0
		}
		if s.Active == "failed" {
			s.RecentLogs = unitLogs(ctx, scope, name, 8)
		}
		out = append(out, s)
	}
	return out
}

type timerRow struct {
	Next      int64  `json:"next"`
	Last      int64  `json:"last"`
	Unit      string `json:"unit"`
	Activates string `json:"activates"`
}

func listTimers(ctx context.Context, scope string) []Timer {
	raw, err := systemctl(ctx, scope, "list-timers", "--all", "--output=json")
	if err != nil {
		return nil
	}
	var rows []timerRow
	if json.Unmarshal(raw, &rows) != nil || len(rows) == 0 {
		return nil
	}
	var services []string
	for _, r := range rows {
		if r.Activates != "" {
			services = append(services, r.Activates)
		}
	}
	props := showUnits(ctx, scope, services, "Id,Result,ExecMainStatus,ActiveState,FragmentPath")
	var timerNames []string
	for _, r := range rows {
		timerNames = append(timerNames, r.Unit)
	}
	timerProps := showUnits(ctx, scope, timerNames, "Id,FragmentPath")

	out := make([]Timer, 0, len(rows))
	for _, r := range rows {
		p := props[r.Activates]
		t := Timer{
			Unit: r.Unit, Scope: scope, Activates: r.Activates,
			Custom:  isCustomUnit(r.Unit, timerProps[r.Unit]["FragmentPath"], scope),
			Result:  p["Result"],
			Running: p["ActiveState"] == "activating" || p["ActiveState"] == "active",
		}
		if r.Next > 0 {
			t.Next = r.Next / 1_000_000
		}
		if r.Last > 0 {
			t.Last = r.Last / 1_000_000
		}
		t.ExitCode, _ = strconv.Atoi(p["ExecMainStatus"])
		if t.Last > 0 && t.Result != "" && t.Result != "success" {
			t.RecentLogs = unitLogs(ctx, scope, r.Activates, 8)
		}
		out = append(out, t)
	}
	return out
}

// showUnits runs `systemctl show` once for many units and indexes the
// resulting property blocks by unit Id.
func showUnits(ctx context.Context, scope string, units []string, props string) map[string]map[string]string {
	out := map[string]map[string]string{}
	if len(units) == 0 {
		return out
	}
	args := append([]string{"show", "-p", props}, units...)
	raw, err := systemctl(ctx, scope, args...)
	if err != nil && len(raw) == 0 {
		return out
	}
	block := map[string]string{}
	flush := func() {
		if id := block["Id"]; id != "" {
			out[id] = block
		}
		block = map[string]string{}
	}
	scanner := bufio.NewScanner(strings.NewReader(string(raw)))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			flush()
			continue
		}
		if k, v, ok := strings.Cut(line, "="); ok {
			if v == "[not set]" {
				v = ""
			}
			block[k] = v
		}
	}
	flush()
	return out
}

// isCustomUnit reports whether a unit was written by the administrator rather
// than shipped by a package.
func isCustomUnit(name, fragment, scope string) bool {
	if strings.HasPrefix(name, "snap.") || strings.HasPrefix(name, "snapd.") {
		return false
	}
	if scope == "user" {
		return strings.Contains(fragment, "/.config/systemd/")
	}
	return strings.HasPrefix(fragment, "/etc/systemd/system/")
}

func bootTime() int64 {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return 0
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if v, ok := strings.CutPrefix(scanner.Text(), "btime "); ok {
			n, _ := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
			return n
		}
	}
	return 0
}

// unitLogs returns the last lines a unit wrote to the journal.
func unitLogs(ctx context.Context, scope, unit string, n int) []string {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	args := []string{"--no-pager", "-q", "-o", "short-iso", "-n", strconv.Itoa(n)}
	if scope == "user" {
		args = append(args, "--user-unit", unit)
	} else {
		args = append(args, "-u", unit)
	}
	out, _ := exec.CommandContext(ctx, "journalctl", args...).Output()
	var lines []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			if len(line) > 300 {
				line = line[:300] + "…"
			}
			lines = append(lines, line)
		}
	}
	return lines
}

// collectLogs summarizes the journal: error volume by unit, SSH activity and
// the most recent error lines.
func collectLogs(ctx context.Context) LogStats {
	stats := LogStats{CheckedAt: time.Now().Unix()}
	if _, err := exec.LookPath("journalctl"); err != nil {
		return stats
	}
	run := func(args ...string) []byte {
		c, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		out, _ := exec.CommandContext(c, "journalctl", append([]string{"--no-pager", "-q"}, args...)...).Output()
		return out
	}

	raw := run("-p", "err", "--since", "-1h", "-o", "json", "--output-fields=MESSAGE,_SYSTEMD_UNIT,SYSLOG_IDENTIFIER,__REALTIME_TIMESTAMP")
	var lines []LogLine
	byUnit := map[string]int{}
	for _, line := range strings.Split(string(raw), "\n") {
		if line == "" {
			continue
		}
		var entry map[string]any
		if json.Unmarshal([]byte(line), &entry) != nil {
			continue
		}
		stats.ErrorsLastHour++
		unit, _ := entry["_SYSTEMD_UNIT"].(string)
		if unit == "" {
			unit, _ = entry["SYSLOG_IDENTIFIER"].(string)
		}
		if unit == "" {
			unit = "noyau/autre"
		}
		byUnit[unit]++
		msg, _ := entry["MESSAGE"].(string) // binary messages decode as arrays; skip them
		if msg == "" {
			continue
		}
		ts, _ := entry["__REALTIME_TIMESTAMP"].(string)
		us, _ := strconv.ParseInt(ts, 10, 64)
		if len(msg) > 300 {
			msg = msg[:300] + "…"
		}
		lines = append(lines, LogLine{T: us / 1000, Unit: unit, Message: msg})
	}
	if len(lines) > 15 {
		lines = lines[len(lines)-15:]
	}
	slices.Reverse(lines)
	stats.RecentErrors = lines
	stats.ErrorUnits = topCounts(byUnit, 6)

	stats.SSH = sshReport(ctx, run("-u", "ssh.service", "-u", "sshd.service", "--since", "-24h", "-o", "short-unix"))
	stats.SSHFailures24h = stats.SSH.Attempts
	return stats
}

var (
	reInvalidUser = regexp.MustCompile(`Invalid user (\S*) from (\S+) port`)
	reFailedPass  = regexp.MustCompile(`Failed (?:password|publickey|none) for (?:invalid user )?(\S+) from (\S+) port`)
	reClosedAuth  = regexp.MustCompile(`Connection closed by authenticating user (\S+) (\S+) port`)
	reAuthFailure = regexp.MustCompile(`authentication failure;.*rhost=(\S+)(?:\s+user=(\S+))?`)
	reAccepted    = regexp.MustCompile(`Accepted (\S+) for (\S+) from (\S+) port`)
)

// sshReport parses "journalctl -o short-unix" output of the SSH daemon.
func sshReport(ctx context.Context, raw []byte) SSHReport {
	var r SSHReport
	ips := map[string]int{}
	users := map[string]int{}
	for _, line := range strings.Split(string(raw), "\n") {
		tsField, rest, ok := strings.Cut(line, " ")
		if !ok {
			continue
		}
		_, msg, ok := strings.Cut(rest, ": ")
		if !ok {
			continue
		}
		var user, ip string
		switch {
		case reInvalidUser.MatchString(msg):
			m := reInvalidUser.FindStringSubmatch(msg)
			user, ip = m[1], m[2]
		case reFailedPass.MatchString(msg):
			m := reFailedPass.FindStringSubmatch(msg)
			user, ip = m[1], m[2]
		case reClosedAuth.MatchString(msg):
			m := reClosedAuth.FindStringSubmatch(msg)
			user, ip = m[1], m[2]
		case reAuthFailure.MatchString(msg):
			m := reAuthFailure.FindStringSubmatch(msg)
			ip, user = m[1], m[2]
		case reAccepted.MatchString(msg):
			m := reAccepted.FindStringSubmatch(msg)
			ts, _ := strconv.ParseFloat(tsField, 64)
			r.Accepted = append(r.Accepted, Login{T: int64(ts * 1000), Method: m[1], User: m[2], IP: m[3]})
			continue
		default:
			continue
		}
		r.Attempts++
		ips[ip]++
		if user == "" {
			user = "(vide)"
		}
		users[user]++
		if user == "root" {
			r.RootAttempts++
		}
	}
	r.UniqueIPs = len(ips)
	if len(r.Accepted) > 8 {
		r.Accepted = r.Accepted[len(r.Accepted)-8:]
	}
	slices.Reverse(r.Accepted)
	r.TopUsers = topCounts(users, 10)
	r.Fail2ban = fail2banStatus(ctx)
	banned := map[string]bool{}
	if r.Fail2ban != nil {
		for _, ip := range r.Fail2ban.Banned {
			banned[ip] = true
		}
	}
	for _, c := range topCounts(ips, 10) {
		r.TopIPs = append(r.TopIPs, IPCount{IP: c.Key, Count: c.Count, Banned: banned[c.Key]})
	}
	r.Config = sshdConfig(ctx)
	return r
}

func topCounts(m map[string]int, n int) []Count {
	out := make([]Count, 0, len(m))
	for k, v := range m {
		out = append(out, Count{Key: k, Count: v})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Key < out[j].Key
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}

func fail2banStatus(ctx context.Context) *Fail2ban {
	if _, err := exec.LookPath("fail2ban-client"); err != nil {
		return nil
	}
	run := func(args ...string) string {
		c, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		out, err := exec.CommandContext(c, "fail2ban-client", args...).Output()
		if err != nil {
			return ""
		}
		return string(out)
	}
	status := run("status", "sshd")
	if status == "" {
		return nil
	}
	f := &Fail2ban{}
	for _, line := range strings.Split(status, "\n") {
		_, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		n, _ := strconv.Atoi(value)
		switch {
		case strings.Contains(line, "Currently failed"):
			f.CurrentlyFailed = n
		case strings.Contains(line, "Total failed"):
			f.TotalFailed = n
		case strings.Contains(line, "Currently banned"):
			f.CurrentlyBanned = n
		case strings.Contains(line, "Total banned"):
			f.TotalBanned = n
		case strings.Contains(line, "Banned IP list"):
			f.Banned = strings.Fields(value)
		}
	}
	f.MaxRetry, _ = strconv.Atoi(strings.TrimSpace(run("get", "sshd", "maxretry")))
	f.FindTime, _ = strconv.Atoi(strings.TrimSpace(run("get", "sshd", "findtime")))
	f.BanTime, _ = strconv.Atoi(strings.TrimSpace(run("get", "sshd", "bantime")))
	return f
}

// sshdConfig returns the effective values of the security-relevant options.
func sshdConfig(ctx context.Context) map[string]string {
	path, err := exec.LookPath("sshd")
	if err != nil {
		path = "/usr/sbin/sshd"
	}
	c, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(c, path, "-T").Output()
	if err != nil {
		return nil
	}
	keep := map[string]bool{"port": true, "passwordauthentication": true, "permitrootlogin": true,
		"pubkeyauthentication": true, "kbdinteractiveauthentication": true, "maxauthtries": true}
	cfg := map[string]string{}
	for _, line := range strings.Split(string(out), "\n") {
		k, v, ok := strings.Cut(line, " ")
		if ok && keep[k] {
			if _, seen := cfg[k]; !seen {
				cfg[k] = v
			}
		}
	}
	return cfg
}
