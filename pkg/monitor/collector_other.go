//go:build !linux

package monitor

import (
	"context"
	"time"
)

const supported = false

type usagePoint struct {
	T     int64  `json:"t"`
	Used  uint64 `json:"used"`
	Total uint64 `json:"total"`
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

type collector struct{}

func newCollector([]usagePoint) *collector                 { return &collector{} }
func (*collector) hostInfo() HostInfo                      { return HostInfo{} }
func (*collector) sample(time.Time) snapshot               { return snapshot{} }
func (*collector) usageHistory() []usagePoint              { return nil }
func (*Monitor) withForecast(fs []Filesystem) []Filesystem { return fs }
func collectSystemd(context.Context) ([]Service, []Timer)  { return nil, nil }
func collectListeners() []Listener                         { return nil }
func collectLogs(context.Context) LogStats                 { return LogStats{} }
