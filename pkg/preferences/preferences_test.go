package preferences

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestHostAliasesSanitize(t *testing.T) {
	p := Default()
	p.HostAliases = map[string]string{
		"a": "  Home Lab  ", "b": "   ", "c": strings.Repeat("é", 60), "d": "x\x00y\n", "": "orphan",
	}
	p.Sanitize()
	if p.HostAliases["a"] != "Home Lab" || p.HostAliases["d"] != "xy" {
		t.Fatalf("%v", p.HostAliases)
	}
	if _, ok := p.HostAliases["b"]; ok {
		t.Fatal("blank alias must be removed")
	}
	if _, ok := p.HostAliases[""]; ok {
		t.Fatal("empty id must be dropped")
	}
	if n := len([]rune(p.HostAliases["c"])); n != MaxHostAliasRunes {
		t.Fatalf("len=%d", n)
	}
}

func TestHostAliasesPersistAndAreCopied(t *testing.T) {
	store := &Store{path: filepath.Join(t.TempDir(), "preferences.json"), data: Default()}
	prefs := Default()
	prefs.HostAliases = map[string]string{"host-1": " Prod "}
	if err := store.Update(prefs); err != nil {
		t.Fatal(err)
	}
	reloaded := &Store{path: store.path, data: Default()}
	if err := reloaded.load(); err != nil {
		t.Fatal(err)
	}
	if got := reloaded.Get().HostAliases["host-1"]; got != "Prod" {
		t.Fatalf("alias=%q", got)
	}
	copy := store.Get()
	copy.HostAliases["host-1"] = "mutated"
	if store.Get().HostAliases["host-1"] != "Prod" {
		t.Fatal("Get must return a copy")
	}
	// Empty alias removes the entry and the key is omitted from JSON.
	prefs = Default()
	prefs.HostAliases = map[string]string{"host-1": ""}
	if err := store.Update(prefs); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(store.Get())
	if strings.Contains(string(raw), "host_aliases") {
		t.Fatalf("host_aliases should be omitted: %s", raw)
	}
}
