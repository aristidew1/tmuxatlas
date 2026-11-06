package server

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/accounts"
	"github.com/LosFurina/tmuxatlas/pkg/auth"
	"github.com/LosFurina/tmuxatlas/pkg/peer"
	"github.com/go-chi/chi/v5"
)

func TestEveryRouteIsClassifiedForAccounts(t *testing.T) {
	sessions := auth.NewSessionManager(time.Hour)
	a, err := auth.NewAccountsAuth(accounts.OpenStore(filepath.Join(t.TempDir(), "users.json")), sessions)
	if err != nil {
		t.Fatal(err)
	}
	observed := make(chan []string, 1)
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		result <- Run(ctx, &Options{
			Role: "hub", ListenAddress: "127.0.0.1:0", PublicURL: "http://127.0.0.1:1",
			SocketPath: filepath.Join(t.TempDir(), "test.sock"), AuthEnabled: true,
			AccountsAuth: a, SessionMgr: sessions, PeerHandler: &peer.Handler{}, PTYRelay: &peer.PTYRelay{},
			routerObserver: func(routes chi.Routes) {
				var unclassified []string
				_ = chi.Walk(routes, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
					key := method + " " + route
					if !accountUserRoutes[key] && accountOtherRoutes[key] == "" {
						unclassified = append(unclassified, key)
					}
					if accountUserRoutes[key] && accountOtherRoutes[key] != "" {
						unclassified = append(unclassified, fmt.Sprintf("%s classée deux fois", key))
					}
					return nil
				})
				observed <- unclassified
			},
		})
	}()
	select {
	case unclassified := <-observed:
		for _, route := range unclassified {
			t.Errorf("route non classée : %s", route)
		}
	case err := <-result:
		t.Fatalf("démarrage du routeur : %v", err)
	case <-time.After(5 * time.Second):
		t.Error("routeur indisponible")
	}
	cancel()
	select {
	case err := <-result:
		if err != nil {
			t.Error(err)
		}
	case <-time.After(5 * time.Second):
		t.Error("arrêt du serveur expiré")
	}
}
