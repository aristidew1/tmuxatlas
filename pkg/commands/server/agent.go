package server

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/urfave/cli/v3"

	"github.com/LosFurina/tmuxatlas/pkg/activity"
	"github.com/LosFurina/tmuxatlas/pkg/identity"
	"github.com/LosFurina/tmuxatlas/pkg/peer"
	agentserver "github.com/LosFurina/tmuxatlas/pkg/server"
	"github.com/LosFurina/tmuxatlas/pkg/state"
	"github.com/LosFurina/tmuxatlas/pkg/tmux"
	"github.com/LosFurina/tmuxatlas/pkg/toolevents"
)

func validateHubURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || !u.IsAbs() || u.Host == "" {
		return fmt.Errorf("hub URL must be an absolute HTTP(S) URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("hub URL must use HTTP or HTTPS")
	}
	if u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("hub URL must not contain credentials, a path, query, or fragment")
	}
	return nil
}

// ExecuteAgent runs the outbound-only peer runtime without Web UI, WebAuthn,
// WebPush, pairing endpoints, or a TCP listener.
func ExecuteAgent(ctx context.Context, c *cli.Command) error {
	hubURL := c.String("hub")
	if err := validateHubURL(hubURL); err != nil {
		return err
	}
	client, err := tmux.NewClient()
	if err != nil {
		return err
	}
	stateMgr := state.NewManager(client)
	tracker := toolevents.NewTracker()
	actTracker := activity.NewTracker()

	interval := time.Duration(c.Int("discovery-interval")) * time.Second
	discovery := tmux.NewDiscovery(client, interval, stateMgr.UpdateSessions)
	go discovery.Run(ctx)

	watcher := toolevents.NewWatcher(tracker, agentPaneLister(client), client.CapturePaneContent, toolevents.DefaultWatchInterval)
	if !c.Bool("no-control-mode") {
		controlMode := tmux.NewControlMode(client, stateMgr.UpdateSessions,
			tmux.WithOnConnect(func() { discovery.SetInterval(30 * time.Second) }),
			tmux.WithOnDisconnect(func() { discovery.SetInterval(interval) }),
			tmux.WithOnOutput(func(paneID string, dataLen int) {
				if session := stateMgr.SessionForPane(paneID); session != "" {
					actTracker.Record(session, dataLen)
				}
				watcher.RecordOutput(paneID)
			}),
		)
		go controlMode.Run(ctx)
	}

	hostname, _ := os.Hostname()
	nodeIdentity, err := identity.LoadOrCreate(hostname)
	if err != nil {
		return fmt.Errorf("load identity: %w", err)
	}
	peerStore, err := identity.NewPeerStore()
	if err != nil {
		return fmt.Errorf("load peer store: %w", err)
	}
	peerMgr := peer.NewManager(nodeIdentity, peerStore, stateMgr)
	go peerMgr.Run()
	watcher.SetHost(peerMgr.LocalID(), peerMgr.LocalName())
	go watcher.Run(ctx)

	peerClient := peer.NewClient(
		hubURL, nodeIdentity, peerStore, stateMgr, peerMgr, actTracker, tracker, client.TmuxPath(),
	)
	go peerClient.Run(ctx)
	logrus.WithFields(logrus.Fields{
		"hub": hubURL, "name": nodeIdentity.Name, "fingerprint": nodeIdentity.Fingerprint(),
	}).Info("starting headless TmuxAtlas agent")

	return agentserver.RunAgentSocket(ctx, c.String("socket"), tracker, peerMgr)
}
