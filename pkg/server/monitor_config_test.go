package server

import (
	"reflect"
	"testing"
)

func TestMonitorEnabled(t *testing.T) {
	tests := map[string]bool{
		"": true, "on": true, "1": true, "off": false, "OFF": false, " false ": false, "0": false, "no": false,
	}
	for value, want := range tests {
		t.Run(value, func(t *testing.T) {
			if got := monitorEnabled(value); got != want {
				t.Fatalf("monitorEnabled(%q) = %v, want %v", value, got, want)
			}
		})
	}
}

func TestMonitorRange(t *testing.T) {
	tests := map[string]int64{"15m": 900, "1h": 3600, "6h": 21600, "24h": 86400, "": 3600, "bogus": 3600}
	for value, want := range tests {
		t.Run(value, func(t *testing.T) {
			if got := monitorRange(value); got != want {
				t.Fatalf("monitorRange(%q) = %d, want %d", value, got, want)
			}
		})
	}
}

func TestMonitorURLs(t *testing.T) {
	got := monitorURLs("https://a.example, http://b.example ftp://c.example not-a-url")
	want := []string{"https://a.example", "http://b.example"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("monitorURLs() = %v, want %v", got, want)
	}
	if got := monitorURLs(""); got != nil {
		t.Fatalf("monitorURLs(\"\") = %v, want nil", got)
	}
}
