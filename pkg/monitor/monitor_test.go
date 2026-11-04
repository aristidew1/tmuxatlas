package monitor

import "testing"

func TestRingKeepsNewestSamples(t *testing.T) {
	r := newRing(3)
	for i := int64(1); i <= 5; i++ {
		r.push(Sample{T: i})
	}
	got := r.all()
	if len(got) != 3 || got[0].T != 3 || got[2].T != 5 {
		t.Fatalf("ring = %+v", got)
	}
	if after := r.since(0, 4); len(after) != 1 || after[0].T != 5 {
		t.Fatalf("since(after=4) = %+v", after)
	}
}

func TestAverage(t *testing.T) {
	avg := average([]Sample{{CPU: 10, NetRx: 100}, {CPU: 30, NetRx: 300}})
	if avg.CPU != 20 || avg.NetRx != 200 {
		t.Fatalf("average = %+v", avg)
	}
}

func TestDescribeResult(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"success", ""}, {"exit-code", "code de sortie non nul"}, {"weird", "weird"},
	} {
		t.Run(tc.in, func(t *testing.T) {
			if got := describeResult(tc.in); got != tc.want {
				t.Fatalf("describeResult(%q) = %q", tc.in, got)
			}
		})
	}
}
