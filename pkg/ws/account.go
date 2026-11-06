package ws

import (
	"net/http"

	"github.com/LosFurina/tmuxatlas/pkg/auth"
	"github.com/gorilla/websocket"
)

// closeOnAccountRevocation interrupts an upgraded connection when its browser
// session is revoked, including when no further messages are being sent.
func closeOnAccountRevocation(conn *websocket.Conn, r *http.Request) func() {
	identity, ok := auth.AccountFromContext(r.Context())
	if !ok || identity.Done == nil {
		return func() {}
	}
	stop := make(chan struct{})
	go func() {
		select {
		case <-identity.Done:
			_ = conn.Close()
		case <-r.Context().Done():
			_ = conn.Close()
		case <-stop:
		}
	}()
	return func() { close(stop) }
}
