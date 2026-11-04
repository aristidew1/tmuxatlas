package monitor

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// caddyAdmin is the Caddy admin endpoint used to discover published sites.
func caddyAdmin() string {
	if v := os.Getenv("TMUXATLAS_MONITOR_CADDY_ADMIN"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://127.0.0.1:2019"
}

type caddyServer struct {
	Listen []string `json:"listen"`
	Routes []struct {
		Match []struct {
			Host []string `json:"host"`
		} `json:"match"`
	} `json:"routes"`
}

// discoverCaddyURLs returns https:// URLs for every concrete host name routed
// by the local Caddy instance. It returns nil when Caddy is not reachable.
func discoverCaddyURLs(ctx context.Context) []string {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, caddyAdmin()+"/config/apps/http/servers", nil)
	if err != nil {
		return nil
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	var servers map[string]caddyServer
	if json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&servers) != nil {
		return nil
	}
	seen := map[string]bool{}
	var urls []string
	for _, srv := range servers {
		scheme := "https"
		for _, l := range srv.Listen {
			if strings.HasSuffix(l, ":80") {
				scheme = "http"
			}
		}
		for _, route := range srv.Routes {
			for _, m := range route.Match {
				for _, host := range m.Host {
					if host == "" || strings.ContainsAny(host, "*{") || host == "localhost" {
						continue
					}
					u := scheme + "://" + host + "/"
					if !seen[u] {
						seen[u] = true
						urls = append(urls, u)
					}
				}
			}
		}
	}
	sort.Strings(urls)
	return urls
}

var probeClient = &http.Client{
	Timeout: 10 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
	Transport: &http.Transport{
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
		DisableKeepAlives:   true,
		TLSHandshakeTimeout: 5 * time.Second,
	},
}

// probeAll checks every URL concurrently. A response below 500 counts as up:
// 401 behind basic auth or a 404 on an API root still proves the site serves.
func probeAll(ctx context.Context, sources map[string]string) []Endpoint {
	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		out = make([]Endpoint, 0, len(sources))
	)
	for url, source := range sources {
		wg.Add(1)
		go func(url, source string) {
			defer wg.Done()
			e := probe(ctx, url)
			e.Source = source
			mu.Lock()
			out = append(out, e)
			mu.Unlock()
		}(url, source)
	}
	wg.Wait()
	return out
}

func probe(ctx context.Context, url string) Endpoint {
	e := Endpoint{URL: url, CheckedAt: time.Now().Unix()}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		e.Error = err.Error()
		return e
	}
	req.Header.Set("User-Agent", "TmuxAtlas-Monitor/1.0")
	start := time.Now()
	resp, err := probeClient.Do(req)
	e.LatencyMS = float64(time.Since(start).Microseconds()) / 1000
	if err != nil {
		e.Error = shortError(err)
		return e
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 256<<10))
	e.Status = resp.StatusCode
	e.Up = resp.StatusCode < 500
	if resp.TLS != nil && len(resp.TLS.PeerCertificates) > 0 {
		cert := resp.TLS.PeerCertificates[0]
		e.CertExpires = cert.NotAfter.Unix()
		e.CertIssuer = cert.Issuer.CommonName
		if len(cert.Issuer.Organization) > 0 {
			e.CertIssuer = cert.Issuer.Organization[0]
		}
	}
	return e
}

func shortError(err error) string {
	msg := err.Error()
	if i := strings.LastIndex(msg, ": "); i >= 0 && i+2 < len(msg) {
		msg = msg[i+2:]
	}
	return msg
}
