package monitor

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

var severityOrder = map[string]int{"critical": 0, "warning": 1, "info": 2}

// alertCtx gives the rule helpers shared access to the response being built.
type alertCtx struct {
	resp   *Response
	alerts []Alert
}

func (a *alertCtx) add(alert Alert) { a.alerts = append(a.alerts, alert) }

// buildAlerts derives actionable findings from the current state. Every
// alert carries the facts behind it, ready-to-run commands and advice. The
// caller holds m.mu for reading.
func (m *Monitor) buildAlerts(resp *Response) []Alert {
	a := &alertCtx{resp: resp}
	recent := m.raw.since(time.Now().Add(-5*time.Minute).UnixMilli(), -1)
	if len(recent) >= 6 {
		a.cpuRules(average(recent))
	}
	a.loadRule()
	a.memoryRules()
	a.filesystemRules()
	a.serviceRules()
	a.timerRules()
	a.endpointRules()
	a.updateRules()
	a.logRules()
	a.sshRules()

	sort.SliceStable(a.alerts, func(i, j int) bool {
		return severityOrder[a.alerts[i].Severity] < severityOrder[a.alerts[j].Severity]
	})
	return a.alerts
}

// --- resources ---------------------------------------------------------------

func (a *alertCtx) topProcesses(byMemory bool, n int) AlertList {
	procs := append([]Process(nil), a.resp.Processes...)
	if byMemory {
		sort.Slice(procs, func(i, j int) bool { return procs[i].RSS > procs[j].RSS })
	} else {
		sort.Slice(procs, func(i, j int) bool { return procs[i].CPU > procs[j].CPU })
	}
	list := AlertList{Title: "Processus les plus gourmands"}
	if byMemory {
		list.Title = "Processus les plus gourmands en mémoire"
	}
	for i := 0; i < len(procs) && i < n; i++ {
		p := procs[i]
		item := fmt.Sprintf("%s (PID %d, %s) — CPU %s, RAM %s", p.Name, p.PID, p.User, pct(p.CPU), humanBytes(float64(p.RSS)))
		if p.Unit != "" {
			item += " — " + p.Unit
		}
		list.Items = append(list.Items, item)
	}
	return list
}

func (a *alertCtx) cpuRules(avg Sample) {
	now := a.resp.Now
	facts := []Fact{
		{"Moyenne 5 min", pct(avg.CPU)},
		{"Répartition actuelle", fmt.Sprintf("user %s · system %s · iowait %s · steal %s", pct(now.CPU.User), pct(now.CPU.System), pct(now.CPU.IOWait), pct(now.CPU.Steal))},
		{"Charge 1/5/15 min", fmt.Sprintf("%.2f / %.2f / %.2f pour %d cœurs", now.Load[0], now.Load[1], now.Load[2], a.resp.Host.CPUs)},
	}
	cpuCommands := []Command{
		{"Top des processus par CPU", "ps -eo pid,user,%cpu,%mem,etime,cmd --sort=-%cpu | head -15"},
		{"Consommation par service systemd", "systemd-cgtop -o cpu -n 1"},
		{"Suivi en direct", "top -o %CPU"},
	}
	switch {
	case avg.CPU >= 90:
		a.add(Alert{Severity: "critical", Title: fmt.Sprintf("CPU saturé (%.0f %% sur 5 min)", avg.CPU),
			Facts: facts, Lists: []AlertList{a.topProcesses(false, 5)}, Commands: cpuCommands,
			Advice: "Identifie le processus en tête : boucle infinie, build ou tâche planifiée trop lourde. Un service qui sature le CPU en continu peut être limité avec CPUQuota= dans son unité systemd."})
	case avg.CPU >= 75:
		a.add(Alert{Severity: "warning", Title: fmt.Sprintf("CPU élevé (%.0f %% sur 5 min)", avg.CPU),
			Facts: facts, Lists: []AlertList{a.topProcesses(false, 5)}, Commands: cpuCommands,
			Advice: "Pas encore critique. Surveille la tendance sur le graphique CPU ; si elle dure, regarde le processus en tête."})
	}
	if avg.Steal >= 10 {
		a.add(Alert{Severity: "warning", Title: fmt.Sprintf("Steal CPU à %.0f %%", avg.Steal),
			Detail: "L'hyperviseur de l'hébergeur prend du temps CPU à la VM.",
			Facts:  []Fact{{"Steal moyen 5 min", pct(avg.Steal)}, {"CPU utilisé", pct(avg.CPU)}},
			Commands: []Command{
				{"Colonne « st » en direct", "vmstat 1 10"},
				{"Historique sysstat du jour", "sar -u"},
			},
			Advice: "Le problème vient de l'hôte physique (voisins bruyants), pas de ta VM. S'il persiste, ouvre un ticket chez l'hébergeur ou passe sur une offre à vCPU dédiés."})
	}
	if avg.IOWait >= 20 {
		a.add(Alert{Severity: "warning", Title: fmt.Sprintf("Attente disque élevée (iowait %.0f %%)", avg.IOWait),
			Facts: a.diskFacts(),
			Commands: []Command{
				{"Occupation par disque", "iostat -xz 1 5"},
				{"Processus qui lisent/écrivent le plus", "pidstat -d 1 5"},
				{"Processus bloqués sur le disque (état D)", "ps -eo stat,pid,user,cmd | awk '$1 ~ /D/'"},
			},
			Advice: "Les processus attendent le disque. Cherche une sauvegarde, un vacuum Postgres ou une écriture de logs massive en cours."})
	}
}

func (a *alertCtx) diskFacts() []Fact {
	var facts []Fact
	for _, d := range a.resp.Disks {
		facts = append(facts, Fact{d.Name, fmt.Sprintf("lecture %s/s · écriture %s/s · occupation %s", humanBytes(d.ReadRate), humanBytes(d.WriteRate), pct(d.Util))})
	}
	return facts
}

func (a *alertCtx) loadRule() {
	now, cpus := a.resp.Now, float64(a.resp.Host.CPUs)
	if cpus == 0 || now.Load[1] <= cpus*1.5 {
		return
	}
	a.add(Alert{Severity: "warning", Title: fmt.Sprintf("Charge système %.2f pour %d cœurs", now.Load[1], a.resp.Host.CPUs),
		Facts: []Fact{
			{"Charge 1/5/15 min", fmt.Sprintf("%.2f / %.2f / %.2f", now.Load[0], now.Load[1], now.Load[2])},
			{"Processus en exécution", strconv.Itoa(now.ProcsRunning)},
			{"Pression CPU / I/O (10 s)", fmt.Sprintf("%s / %s", pct(now.PSI.CPU10), pct(now.PSI.IO10))},
		},
		Lists: []AlertList{a.topProcesses(false, 5)},
		Commands: []Command{
			{"Processus bloqués sur le disque (état D)", "ps -eo stat,pid,user,cmd | awk '$1 ~ /D/'"},
			{"Top des processus par CPU", "ps -eo pid,user,%cpu,cmd --sort=-%cpu | head -15"},
		},
		Advice: "Une charge élevée avec un CPU peu utilisé signifie des processus bloqués sur les I/O ; avec un CPU saturé, trop de travail pour les cœurs disponibles."})
}

func (a *alertCtx) memoryRules() {
	now := a.resp.Now
	mem := now.Memory
	if mem.Total == 0 {
		return
	}
	facts := []Fact{
		{"Utilisée", fmt.Sprintf("%s sur %s", humanBytes(float64(mem.Used)), humanBytes(float64(mem.Total)))},
		{"Disponible", humanBytes(float64(mem.Available))},
		{"Cache (récupérable)", humanBytes(float64(mem.Cached))},
		{"Swap", fmt.Sprintf("%s sur %s", humanBytes(float64(mem.SwapUsed)), humanBytes(float64(mem.SwapTotal)))},
	}
	commands := []Command{
		{"Top des processus par mémoire", "ps -eo pid,user,rss,%mem,cmd --sort=-rss | head -15"},
		{"Mémoire par service systemd", "systemd-cgtop -m -n 1"},
		{"Processus tués par l'OOM killer", "journalctl -k --since -24h | grep -i 'out of memory' | tail"},
	}
	p := float64(mem.Used) / float64(mem.Total) * 100
	switch {
	case p >= 92:
		a.add(Alert{Severity: "critical", Title: fmt.Sprintf("Mémoire presque pleine (%.0f %%)", p), Detail: "Risque d'OOM killer.",
			Facts: facts, Lists: []AlertList{a.topProcesses(true, 5)}, Commands: commands,
			Advice: "Redémarre le service qui fuit ou limite-le avec MemoryMax= dans son unité systemd pour protéger le reste de la machine."})
	case p >= 80:
		a.add(Alert{Severity: "warning", Title: fmt.Sprintf("Mémoire élevée (%.0f %%)", p),
			Facts: facts, Lists: []AlertList{a.topProcesses(true, 5)}, Commands: commands,
			Advice: "Vérifie sur le graphique Mémoire si l'usage monte en continu (fuite) ou s'il est stable."})
	}
	if mem.SwapTotal > 0 && float64(mem.SwapUsed)/float64(mem.SwapTotal) >= 0.5 {
		a.add(Alert{Severity: "warning", Title: "Swap utilisé à plus de 50 %", Facts: facts,
			Commands: []Command{
				{"Périphériques de swap", "swapon --show"},
				{"Processus qui utilisent le swap", `grep -H VmSwap /proc/[0-9]*/status | sort -k2 -n | tail -10`},
			},
			Advice: "Un swap très utilisé ralentit tout. Si la RAM est libre aujourd'hui, c'est un ancien pic : « sudo swapoff -a && sudo swapon -a » vide le swap."})
	}
	if now.PSI.Mem10 >= 10 {
		a.add(Alert{Severity: "warning", Title: fmt.Sprintf("Pression mémoire %.0f %%", now.PSI.Mem10),
			Detail:   "Des tâches attendent de la mémoire.",
			Facts:    []Fact{{"Moyenne 10 s / 60 s", fmt.Sprintf("%s / %s", pct(now.PSI.Mem10), pct(now.PSI.Mem60))}},
			Lists:    []AlertList{a.topProcesses(true, 5)},
			Commands: []Command{{"Détail PSI", "cat /proc/pressure/memory"}},
			Advice:   "La machine passe du temps à récupérer de la mémoire (reclaim). Libère de la RAM ou ajoute du swap."})
	}
	if now.PSI.IO10 >= 25 {
		a.add(Alert{Severity: "warning", Title: fmt.Sprintf("Pression I/O %.0f %%", now.PSI.IO10),
			Detail: "Des tâches attendent le disque.",
			Facts:  append([]Fact{{"Moyenne 10 s / 60 s", fmt.Sprintf("%s / %s", pct(now.PSI.IO10), pct(now.PSI.IO60))}}, a.diskFacts()...),
			Commands: []Command{
				{"Processus qui lisent/écrivent le plus", "pidstat -d 1 5"},
				{"Détail PSI", "cat /proc/pressure/io"},
			}})
	}
}

func (a *alertCtx) filesystemRules() {
	for _, fs := range a.resp.Filesystems {
		facts := []Fact{
			{"Utilisé", fmt.Sprintf("%s sur %s (%s)", humanBytes(float64(fs.Used)), humanBytes(float64(fs.Total)), pct(fs.Percent))},
			{"Libre", humanBytes(float64(fs.Available))},
			{"Inodes", pct(fs.InodesPct)},
			{"Périphérique", fs.Device + " · " + fs.FSType},
		}
		if fs.GrowthPerDay != 0 {
			facts = append(facts, Fact{"Croissance", humanBytes(fs.GrowthPerDay) + " par jour"})
		}
		commands := []Command{
			{"Plus gros dossiers", fmt.Sprintf("sudo du -xh --max-depth=2 %s 2>/dev/null | sort -h | tail -20", fs.Mount)},
			{"Plus gros fichiers", fmt.Sprintf("sudo find %s -xdev -type f -size +200M -exec ls -lh {} + 2>/dev/null | sort -k5 -h | tail -15", fs.Mount)},
			{"Taille du journal systemd", "journalctl --disk-usage"},
			{"Réduire le journal à 200 Mo", "sudo journalctl --vacuum-size=200M"},
			{"Nettoyer le cache apt et les paquets orphelins", "sudo apt clean && sudo apt autoremove --purge"},
		}
		advice := "Commence par les plus gros dossiers : journaux, sauvegardes locales, caches (pnpm, npm, Go) et vieux builds sont les suspects habituels."
		switch {
		case fs.Percent >= 90:
			a.add(Alert{Severity: "critical", Title: fmt.Sprintf("Disque %s plein à %.0f %%", fs.Mount, fs.Percent), Facts: facts, Commands: commands, Advice: advice})
		case fs.Percent >= 80:
			a.add(Alert{Severity: "warning", Title: fmt.Sprintf("Disque %s rempli à %.0f %%", fs.Mount, fs.Percent), Facts: facts, Commands: commands, Advice: advice})
		}
		if fs.InodesPct >= 90 {
			a.add(Alert{Severity: "critical", Title: fmt.Sprintf("Inodes de %s épuisés à %.0f %%", fs.Mount, fs.InodesPct),
				Detail: "Plus aucun fichier ne pourra être créé, même avec de l'espace libre.", Facts: facts,
				Commands: []Command{{"Dossiers contenant le plus de fichiers", fmt.Sprintf("sudo find %s -xdev -type f | cut -d/ -f2-4 | sort | uniq -c | sort -n | tail -15", fs.Mount)}},
				Advice:   "Souvent un cache ou un dossier de sessions/temporaires avec des millions de petits fichiers (node_modules, cache, mails)."})
		}
		if fs.DaysToFull > 0 && fs.DaysToFull < 30 {
			sev := "warning"
			if fs.DaysToFull < 7 {
				sev = "critical"
			}
			a.add(Alert{Severity: sev, Title: fmt.Sprintf("%s sera plein dans ~%.0f jours", fs.Mount, fs.DaysToFull),
				Detail: "Projection linéaire sur la croissance des derniers jours.", Facts: facts, Commands: commands,
				Advice: "Cherche ce qui grossit régulièrement : sauvegardes sans rotation, logs applicatifs, base de données."})
		}
	}
}

// --- systemd -----------------------------------------------------------------

func scopeFlag(scope string) string {
	if scope == "user" {
		return " --user"
	}
	return ""
}

func journalUnitFlag(scope, unit string) string {
	if scope == "user" {
		return "--user-unit " + unit
	}
	return "-u " + unit
}

func sudoFor(scope string) string {
	if scope == "user" {
		return ""
	}
	return "sudo "
}

func (a *alertCtx) serviceRules() {
	for _, s := range a.resp.Services {
		sc := scopeFlag(s.Scope)
		facts := []Fact{
			{"Unité", s.Unit + " (" + s.Scope + ")"},
			{"Description", s.Description},
			{"Redémarrages depuis le boot", strconv.Itoa(s.Restarts)},
		}
		if s.Since > 0 {
			facts = append(facts, Fact{"Dernier changement d'état", humanDate(s.Since)})
		}
		var lists []AlertList
		if len(s.RecentLogs) > 0 {
			lists = append(lists, AlertList{Title: "Derniers logs du service", Items: s.RecentLogs})
		}
		commands := []Command{
			{"État détaillé", "systemctl" + sc + " status " + s.Unit + " --no-pager"},
			{"Logs complets", "journalctl " + journalUnitFlag(s.Scope, s.Unit) + " -n 100 --no-pager"},
		}
		if s.Active == "failed" {
			facts = append(facts, Fact{"Cause", orDash(describeResult(s.Result))})
			commands = append(commands,
				Command{"Redémarrer", sudoFor(s.Scope) + "systemctl" + sc + " restart " + s.Unit},
				Command{"Effacer l'état d'échec (après correction)", sudoFor(s.Scope) + "systemctl" + sc + " reset-failed " + s.Unit})
			a.add(Alert{Severity: "critical", Title: "Service en échec : " + s.Unit, Detail: describeResult(s.Result),
				Facts: facts, Lists: lists, Commands: commands,
				Advice: "Lis les derniers logs : la cause est presque toujours dans les 20 dernières lignes (config invalide, port déjà pris, dépendance absente)."})
		} else if s.Custom && s.Restarts >= 3 {
			commands = append(commands, Command{"Erreurs récentes", "journalctl " + journalUnitFlag(s.Scope, s.Unit) + " --since -24h -p warning --no-pager | tail -50"})
			a.add(Alert{Severity: "warning", Title: fmt.Sprintf("%s a redémarré %d fois", s.Unit, s.Restarts),
				Detail: "Depuis le démarrage de la machine.", Facts: facts, Commands: commands,
				Advice: "Restart=on-failure masque les crashs : le service tombe puis revient. Cherche l'erreur qui précède chaque redémarrage."})
		}
	}
}

func (a *alertCtx) timerRules() {
	for _, t := range a.resp.Timers {
		if !t.Custom || t.Running || t.Last == 0 || t.Result == "" || t.Result == "success" {
			continue
		}
		sc := scopeFlag(t.Scope)
		facts := []Fact{
			{"Service lancé", t.Activates},
			{"Dernière exécution", humanDate(t.Last)},
			{"Résultat", fmt.Sprintf("%s (code %d)", orDash(describeResult(t.Result)), t.ExitCode)},
		}
		if t.Next > 0 {
			facts = append(facts, Fact{"Prochaine exécution", humanDate(t.Next)})
		}
		var lists []AlertList
		if len(t.RecentLogs) > 0 {
			lists = append(lists, AlertList{Title: "Derniers logs de l'exécution", Items: t.RecentLogs})
		}
		a.add(Alert{Severity: "critical", Title: "Dernière exécution échouée : " + t.Activates,
			Detail: fmt.Sprintf("%s (code %d)", describeResult(t.Result), t.ExitCode),
			Facts:  facts, Lists: lists,
			Commands: []Command{
				{"État détaillé", "systemctl" + sc + " status " + t.Activates + " --no-pager"},
				{"Logs de la dernière exécution", "journalctl " + journalUnitFlag(t.Scope, t.Activates) + " -n 100 --no-pager"},
				{"Relancer maintenant", sudoFor(t.Scope) + "systemctl" + sc + " start " + t.Activates},
				{"Planning du timer", "systemctl" + sc + " list-timers " + t.Unit + " --all"},
			},
			Advice: "Une sauvegarde ou une tâche planifiée qui échoue silencieusement est le piège classique. Corrige puis relance à la main pour vérifier."})
	}
}

// --- endpoints ---------------------------------------------------------------

func (a *alertCtx) endpointRules() {
	now := time.Now().Unix()
	for _, e := range a.resp.Endpoints {
		if e.CheckedAt == 0 {
			continue
		}
		host := strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(e.URL, "https://"), "http://"), "/")
		facts := []Fact{
			{"URL", e.URL},
			{"Code HTTP", orDash(strconv.Itoa(e.Status))},
			{"Latence", fmt.Sprintf("%.0f ms", e.LatencyMS)},
			{"Disponibilité 24 h", pct(e.UptimePct)},
		}
		if e.Error != "" {
			facts = append(facts, Fact{"Erreur", e.Error})
		}
		if last := lastUp(e.History); last > 0 {
			facts = append(facts, Fact{"Dernière réponse OK", humanDate(last / 1000)})
		}
		curlTiming := fmt.Sprintf(`curl -o /dev/null -sS -w 'dns %%{time_namelookup}s · connexion %%{time_connect}s · tls %%{time_appconnect}s · 1er octet %%{time_starttransfer}s · total %%{time_total}s\n' %s`, e.URL)
		if !e.Up {
			a.add(Alert{Severity: "critical", Title: host + " ne répond pas", Detail: e.Error, Facts: facts,
				Commands: []Command{
					{"Tester la requête", "curl -sSI --max-time 10 " + e.URL},
					{"État de Caddy", "systemctl status caddy --no-pager"},
					{"Logs de Caddy", "journalctl -u caddy -n 50 --no-pager"},
					{"Ports web en écoute", "ss -ltnp | grep -E ':(80|443) '"},
				},
				Advice: "Un code 502/503 vient en général de l'application derrière Caddy (service arrêté ou port changé) ; un timeout ou une erreur TLS vient plutôt de Caddy ou du DNS."})
			continue
		}
		if e.LatencyMS >= 2000 {
			a.add(Alert{Severity: "warning", Title: fmt.Sprintf("%s lent (%.0f ms)", host, e.LatencyMS), Facts: facts,
				Commands: []Command{{"Décomposer le temps de réponse", curlTiming}},
				Advice:   "Si le « 1er octet » domine, c'est l'application qui est lente (base de données, rendu) ; sinon le réseau ou le TLS."})
		}
		if e.CertExpires > 0 {
			days := float64(e.CertExpires-now) / 86400
			certFacts := []Fact{{"Émetteur", orDash(e.CertIssuer)}, {"Expire le", humanDate(e.CertExpires)}, {"Jours restants", fmt.Sprintf("%.0f", days)}}
			certCommands := []Command{
				{"Logs de renouvellement Caddy", "journalctl -u caddy --since -7d --no-pager | grep -iE 'certificate|acme|obtain|renew' | tail -30"},
				{"Certificat servi", fmt.Sprintf("echo | openssl s_client -connect %s:443 -servername %s 2>/dev/null | openssl x509 -noout -dates -issuer", host, host)},
				{"Forcer une nouvelle tentative", "sudo systemctl reload caddy"},
			}
			advice := "Caddy renouvelle 30 jours avant l'expiration. S'il n'y arrive pas, vérifie que le DNS pointe toujours vers ce serveur et que le port 80/443 est ouvert."
			switch {
			case days < 7:
				a.add(Alert{Severity: "critical", Title: fmt.Sprintf("Certificat de %s expire dans %.0f jours", host, days), Facts: certFacts, Commands: certCommands, Advice: advice})
			case days < 21:
				a.add(Alert{Severity: "warning", Title: fmt.Sprintf("Certificat de %s expire dans %.0f jours", host, days),
					Detail: "Le renouvellement automatique semble bloqué.", Facts: certFacts, Commands: certCommands, Advice: advice})
			}
		}
	}
}

func lastUp(history []ProbePoint) int64 {
	for i := len(history) - 1; i >= 0; i-- {
		if history[i].Up {
			return history[i].T
		}
	}
	return 0
}

// --- host --------------------------------------------------------------------

func (a *alertCtx) serviceActive(unit string) bool {
	for _, s := range a.resp.Services {
		if s.Unit == unit && s.Active == "active" {
			return true
		}
	}
	return false
}

func (a *alertCtx) updateRules() {
	h := a.resp.Host
	if h.Updates > 0 {
		list := AlertList{Title: "Paquets à mettre à jour"}
		needsReboot := false
		for i, p := range h.Packages {
			if i >= 40 {
				list.Items = append(list.Items, fmt.Sprintf("… et %d autres", len(h.Packages)-i))
				break
			}
			tag := ""
			if p.Security {
				tag = " [sécurité]"
			}
			list.Items = append(list.Items, fmt.Sprintf("%s : %s → %s (%s)%s", p.Name, p.From, p.To, p.Suite, tag))
			if strings.HasPrefix(p.Name, "linux-") || p.Name == "libc6" || strings.HasPrefix(p.Name, "systemd") {
				needsReboot = true
			}
		}
		auto := "inactives"
		if a.serviceActive("unattended-upgrades.service") {
			auto = "actives"
		}
		facts := []Fact{
			{"Mises à jour", strconv.Itoa(h.Updates)},
			{"Dont sécurité", strconv.Itoa(h.SecurityUpdate)},
			{"Mises à jour automatiques (unattended-upgrades)", auto},
		}
		commands := []Command{
			{"Tout mettre à jour", "sudo apt update && sudo apt upgrade -y"},
			{"Voir la liste à jour", "apt list --upgradable"},
		}
		if h.SecurityUpdate > 0 {
			commands = append(commands, Command{"Appliquer seulement la sécurité", "sudo unattended-upgrade -v"})
		}
		if len(h.Packages) > 0 {
			commands = append(commands, Command{"Changelog du premier paquet", "apt changelog " + h.Packages[0].Name + " | head -40"})
		}
		advice := "Mise à jour sans risque particulier : aucun paquet système critique ne demande de redémarrage."
		if needsReboot {
			advice = "La liste contient le noyau, la libc ou systemd : prévois un redémarrage après la mise à jour."
		}
		if auto == "actives" {
			advice += " Les correctifs de sécurité Ubuntu s'installent déjà automatiquement chaque jour ; les paquets des dépôts tiers restent à mettre à jour à la main."
		}
		alert := Alert{Severity: "info", Facts: facts, Lists: []AlertList{list}, Commands: commands, Advice: advice}
		switch {
		case h.SecurityUpdate > 0:
			alert.Severity = "warning"
			alert.Title = fmt.Sprintf("%d mises à jour de sécurité en attente", h.SecurityUpdate)
		case h.Updates == 1:
			alert.Title = "1 mise à jour disponible"
		default:
			alert.Title = fmt.Sprintf("%d mises à jour disponibles", h.Updates)
		}
		if len(h.Packages) == 1 {
			p := h.Packages[0]
			alert.Detail = fmt.Sprintf("%s %s → %s", p.Name, p.From, p.To)
		}
		a.add(alert)
	}
	if h.RebootRequired {
		facts := []Fact{
			{"Noyau en cours", h.Kernel},
			{"Noyau le plus récent installé", orDash(h.LatestKernel)},
			{"Démarré depuis", humanDuration(a.resp.Now.UptimeSec)},
		}
		var lists []AlertList
		if len(h.RebootPackages) > 0 {
			lists = append(lists, AlertList{Title: "Paquets qui demandent le redémarrage", Items: h.RebootPackages})
		}
		a.add(Alert{Severity: "info", Title: "Redémarrage requis", Detail: "Un nouveau noyau ou une bibliothèque système attend un reboot.",
			Facts: facts, Lists: lists,
			Commands: []Command{
				{"Paquets concernés", "cat /var/run/reboot-required.pkgs"},
				{"Services actifs qui ne redémarreront pas seuls", `for u in $(systemctl list-units --type=service --state=running --no-legend --plain | awk '{print $1}'); do s=$(systemctl is-enabled "$u" 2>/dev/null); [ "$s" = enabled ] || [ "$s" = static ] || echo "$u: $s"; done`},
				{"Redémarrer", "sudo reboot"},
			},
			Advice: "Choisis un moment calme : les sites seront coupés environ une minute. Les services activés (enabled) redémarrent seuls ; les sessions tmux, elles, seront perdues."})
	}
}

func (a *alertCtx) logRules() {
	logs := a.resp.Logs
	if logs.ErrorsLastHour < 50 {
		return
	}
	units := AlertList{Title: "Unités qui produisent le plus d'erreurs (1 h)"}
	for _, c := range logs.ErrorUnits {
		units.Items = append(units.Items, fmt.Sprintf("%s — %d", c.Key, c.Count))
	}
	recent := AlertList{Title: "Dernières erreurs"}
	for i, l := range logs.RecentErrors {
		if i >= 5 {
			break
		}
		recent.Items = append(recent.Items, fmt.Sprintf("%s %s : %s", time.UnixMilli(l.T).Format("15:04:05"), l.Unit, l.Message))
	}
	cmds := []Command{{"Toutes les erreurs de l'heure", "journalctl -p err --since -1h --no-pager"}}
	if len(logs.ErrorUnits) > 0 {
		cmds = append(cmds, Command{"Erreurs de l'unité la plus bruyante", "journalctl -p err --since -1h -u " + logs.ErrorUnits[0].Key + " --no-pager"})
	}
	a.add(Alert{Severity: "warning", Title: fmt.Sprintf("%d erreurs dans le journal sur 1 h", logs.ErrorsLastHour),
		Facts: []Fact{{"Erreurs sur 1 h", strconv.Itoa(logs.ErrorsLastHour)}}, Lists: []AlertList{units, recent}, Commands: cmds,
		Advice: "Une seule unité concentre souvent l'essentiel : corrige-la en priorité."})
}

// --- SSH ---------------------------------------------------------------------

func (a *alertCtx) sshRules() {
	ssh := a.resp.Logs.SSH
	cfg := ssh.Config
	passwordOn := cfg != nil && cfg["passwordauthentication"] == "yes"
	if passwordOn {
		a.add(Alert{Severity: "warning", Title: "SSH accepte les mots de passe",
			Detail: "Les robots peuvent tenter de deviner un mot de passe.",
			Facts:  []Fact{{"PasswordAuthentication", "yes"}, {"PermitRootLogin", orDash(cfg["permitrootlogin"])}},
			Commands: []Command{
				{"Désactiver (vérifie d'abord que ta clé fonctionne)", "echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/10-no-password.conf && sudo sshd -t && sudo systemctl reload ssh"},
			},
			Advice: "Avec une authentification par clé uniquement, les attaques par dictionnaire deviennent inoffensives."})
	}
	if ssh.Attempts < 100 {
		return
	}

	facts := []Fact{
		{"Tentatives refusées (24 h)", strconv.Itoa(ssh.Attempts)},
		{"Adresses IP distinctes", strconv.Itoa(ssh.UniqueIPs)},
		{"Tentatives sur root", strconv.Itoa(ssh.RootAttempts)},
	}
	if cfg != nil {
		password := "désactivée (clé uniquement)"
		if passwordOn {
			password = "activée"
		}
		facts = append(facts,
			Fact{"Authentification par mot de passe", password},
			Fact{"Connexion root", describeRootLogin(cfg["permitrootlogin"])},
			Fact{"Port SSH", orDash(cfg["port"])},
			Fact{"Essais par connexion (MaxAuthTries)", orDash(cfg["maxauthtries"])},
		)
	}
	f2b := ssh.Fail2ban
	if f2b != nil {
		facts = append(facts,
			Fact{"fail2ban — IP bannies actuellement", strconv.Itoa(f2b.CurrentlyBanned)},
			Fact{"fail2ban — bannissements depuis son démarrage", strconv.Itoa(f2b.TotalBanned)},
			Fact{"fail2ban — règle", fmt.Sprintf("%d échecs en %s → banni %s", f2b.MaxRetry, humanDuration(float64(f2b.FindTime)), humanDuration(float64(f2b.BanTime)))},
		)
	} else {
		facts = append(facts, Fact{"fail2ban", "absent ou jail sshd inactive"})
	}

	ips := AlertList{Title: "Adresses les plus actives (24 h)"}
	evading := 0
	for _, ip := range ssh.TopIPs {
		status := "non bannie"
		if ip.Banned {
			status = "bannie"
		} else if f2b != nil && ip.Count >= 3*max(1, f2b.MaxRetry) {
			evading++
		}
		ips.Items = append(ips.Items, fmt.Sprintf("%s — %d tentatives (≈ 1 toutes les %s) — %s", ip.IP, ip.Count, humanDuration(86400/float64(ip.Count)), status))
	}
	users := AlertList{Title: "Identifiants essayés"}
	for _, u := range ssh.TopUsers {
		users.Items = append(users.Items, fmt.Sprintf("%s — %d", u.Key, u.Count))
	}
	lists := []AlertList{ips, users}
	if len(ssh.Accepted) > 0 {
		ok := AlertList{Title: "Connexions réussies (24 h) — vérifie qu'elles viennent de toi"}
		for _, l := range ssh.Accepted {
			ok.Items = append(ok.Items, fmt.Sprintf("%s — %s depuis %s (%s)", time.UnixMilli(l.T).Format("02/01 15:04"), l.User, l.IP, l.Method))
		}
		lists = append(lists, ok)
	}

	commands := []Command{
		{"État de la prison fail2ban", "sudo fail2ban-client status sshd"},
		{"Tentatives par IP (24 h)", `journalctl -u ssh --since -24h -o cat | grep -oE '(from|user \S+) [0-9.]+ port' | grep -oE '[0-9]+(\.[0-9]+){3}' | sort | uniq -c | sort -rn | head -20`},
		{"Connexions réussies (7 jours)", "journalctl -u ssh --since -7d -o short-iso | grep Accepted"},
	}
	if len(ssh.TopIPs) > 0 && !ssh.TopIPs[0].Banned {
		commands = append(commands, Command{"Bannir l'IP la plus active", "sudo fail2ban-client set sshd banip " + ssh.TopIPs[0].IP})
	}
	if f2b != nil && evading > 0 {
		commands = append(commands, Command{"Attraper les attaques lentes (fenêtre d'un jour, bannissement progressif)",
			"sudo tee /etc/fail2ban/jail.d/sshd-slow.local <<'EOF'\n[sshd]\nfindtime = 1d\nmaxretry = 5\nbantime = 1d\nbantime.increment = true\nEOF\nsudo systemctl reload fail2ban"})
	}

	var advice []string
	if !passwordOn && cfg != nil {
		advice = append(advice, "Les mots de passe sont refusés par SSH : ces tentatives ne peuvent pas aboutir sans ta clé privée. C'est du bruit de robots, pas une intrusion.")
	}
	if evading > 0 && f2b != nil {
		advice = append(advice, fmt.Sprintf("%d adresse(s) dépassent largement le seuil sans être bannies : elles espacent leurs essais pour rester sous la fenêtre fail2ban (%d échecs en %s). Une fenêtre d'un jour les bannirait.",
			evading, f2b.MaxRetry, humanDuration(float64(f2b.FindTime))))
	}
	if cfg != nil && cfg["port"] == "22" {
		advice = append(advice, "Changer de port SSH ou le filtrer par IP (pare-feu de l'hébergeur, Tailscale) ferait disparaître presque tout ce bruit.")
	}

	detail := "Bruit de scan habituel."
	if f2b != nil {
		detail = fmt.Sprintf("%d IP distinctes · %d bannies actuellement par fail2ban.", ssh.UniqueIPs, f2b.CurrentlyBanned)
	}
	a.add(Alert{Severity: "info", Title: fmt.Sprintf("%d tentatives SSH refusées sur 24 h", ssh.Attempts), Detail: detail,
		Facts: facts, Lists: lists, Commands: commands, Advice: strings.Join(advice, " ")})
}

func describeRootLogin(v string) string {
	switch v {
	case "without-password", "prohibit-password":
		return "par clé uniquement"
	case "yes":
		return "autorisée avec mot de passe"
	case "no":
		return "interdite"
	case "forced-commands-only":
		return "commandes forcées uniquement"
	}
	return orDash(v)
}

// --- formatting --------------------------------------------------------------

func describeResult(result string) string {
	switch result {
	case "", "success":
		return ""
	case "exit-code":
		return "code de sortie non nul"
	case "signal", "core-dump":
		return "tué par un signal"
	case "timeout":
		return "délai dépassé"
	case "oom-kill":
		return "tué par l'OOM killer"
	case "start-limit-hit":
		return "trop de redémarrages"
	default:
		return result
	}
}

func orDash(s string) string {
	if s == "" || s == "0" {
		return "—"
	}
	return s
}

func pct(v float64) string {
	if v >= 10 {
		return fmt.Sprintf("%.0f %%", v)
	}
	return strings.Replace(fmt.Sprintf("%.1f %%", v), ".", ",", 1)
}

func humanBytes(b float64) string {
	units := []string{"o", "Ko", "Mo", "Go", "To"}
	i := 0
	for b >= 1024 && i < len(units)-1 {
		b /= 1024
		i++
	}
	if i == 0 || b >= 100 {
		return fmt.Sprintf("%.0f %s", b, units[i])
	}
	return strings.Replace(fmt.Sprintf("%.1f %s", b, units[i]), ".", ",", 1)
}

func humanDuration(seconds float64) string {
	s := int64(seconds)
	switch {
	case s >= 86400:
		d, h := s/86400, (s%86400)/3600
		if h == 0 {
			return fmt.Sprintf("%d j", d)
		}
		return fmt.Sprintf("%d j %d h", d, h)
	case s >= 3600:
		h, m := s/3600, (s%3600)/60
		if m == 0 {
			return fmt.Sprintf("%d h", h)
		}
		return fmt.Sprintf("%d h %d min", h, m)
	case s >= 60:
		return fmt.Sprintf("%d min", s/60)
	default:
		return fmt.Sprintf("%d s", s)
	}
}

func humanDate(unix int64) string {
	return time.Unix(unix, 0).Format("02/01/2006 15:04")
}
