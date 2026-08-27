package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/types"
)

func grp(name, jid, gtype string, sendAck, active bool) MonitoredGroup {
	return MonitoredGroup{
		GroupJID:    jid,
		GroupName:   name,
		GroupType:   gtype,
		ProjectName: "TestProject",
		SendAck:     sendAck,
		IsActive:    active,
	}
}

func TestReconcileGroupsFindsUnreachable(t *testing.T) {
	monitored := []MonitoredGroup{
		grp("In Group", "1@g.us", "dr_submission", true, true),
		grp("Zulu Ack Group", "2@g.us", "dr_submission", true, true),
		grp("Alpha Quiet Group", "3@g.us", "admin", false, true),
	}
	// The number is in group 1, plus one group nobody is monitoring.
	report := reconcileGroups(monitored, []string{"1@g.us", "99@g.us"})

	if report.MonitoredCount != 3 {
		t.Fatalf("MonitoredCount = %d, want 3", report.MonitoredCount)
	}
	if report.JoinedCount != 2 {
		t.Fatalf("JoinedCount = %d, want 2", report.JoinedCount)
	}
	if len(report.Unreachable) != 2 {
		t.Fatalf("Unreachable = %d, want 2", len(report.Unreachable))
	}
	if report.UnreachableAckCount() != 1 {
		t.Fatalf("UnreachableAckCount = %d, want 1", report.UnreachableAckCount())
	}
	// Ack-carrying groups sort first: they are the ones that cost money.
	// "Zulu" sorts after "Alpha", so only the SendAck key can put it first.
	if report.Unreachable[0].GroupName != "Zulu Ack Group" {
		t.Fatalf("first unreachable = %q, want the ack group first despite sorting later by name", report.Unreachable[0].GroupName)
	}
}

// An inactive group is deliberately out of use. Reporting it would train people
// to ignore the warning, which defeats the point of having one.
func TestReconcileGroupsIgnoresInactive(t *testing.T) {
	monitored := []MonitoredGroup{
		grp("Retired", "1@g.us", "admin", true, false),
	}
	report := reconcileGroups(monitored, nil)

	if len(report.Unreachable) != 0 {
		t.Fatalf("inactive group reported as unreachable: %+v", report.Unreachable)
	}
	if report.UnreachableAckCount() != 0 {
		t.Fatalf("inactive group counted as a missing ack")
	}
}

func TestReconcileGroupsAllReachable(t *testing.T) {
	monitored := []MonitoredGroup{
		grp("A", "1@g.us", "dr_submission", true, true),
		grp("B", "2@g.us", "admin", false, true),
	}
	report := reconcileGroups(monitored, []string{"1@g.us", "2@g.us"})

	if len(report.Unreachable) != 0 {
		t.Fatalf("want none unreachable, got %+v", report.Unreachable)
	}
	if w := formatMembershipWarning(report); w != "" {
		t.Fatalf("healthy state produced a warning: %q", w)
	}
}

// The real 2026-08-22 shape: a swapped number in a small fraction of its groups.
func TestReconcileGroupsRealWorldShape(t *testing.T) {
	var monitored []MonitoredGroup
	var joined []string
	for i := 0; i < 58; i++ {
		jid := string(rune('a'+i%26)) + "x@g.us"
		// Make each JID unique.
		jid = jid[:1] + string(rune('0'+i/26)) + jid[1:]
		ack := i < 11 // the dr_submission-style groups
		monitored = append(monitored, grp("G", jid, "dr_submission", ack, true))
		if i < 14 {
			joined = append(joined, jid)
		}
	}
	report := reconcileGroups(monitored, joined)

	if len(report.Unreachable) != 44 {
		t.Fatalf("Unreachable = %d, want 44", len(report.Unreachable))
	}
	if report.UnreachableAckCount() != 0 {
		t.Fatalf("first 11 were joined, so no ack group should be unreachable; got %d", report.UnreachableAckCount())
	}
}

func TestFormatMembershipWarningNamesAckGroupsAndTheFix(t *testing.T) {
	report := reconcileGroups([]MonitoredGroup{
		grp("ETW Activations", "etw@g.us", "dr_submission", true, true),
		grp("Some QA Group", "qa@g.us", "admin", false, true),
	}, nil)

	w := formatMembershipWarning(report)
	for _, want := range []string{
		"ETW Activations",
		"etw@g.us",
		"Some QA Group",
		"send acknowledgements",
		"Fix:",
	} {
		if !strings.Contains(w, want) {
			t.Fatalf("warning missing %q:\n%s", want, w)
		}
	}
	// The ack group must be visibly distinguished, not just present.
	ackLine := ""
	for _, line := range strings.Split(w, "\n") {
		if strings.Contains(line, "ETW Activations") {
			ackLine = line
		}
	}
	if !strings.Contains(ackLine, "!!") {
		t.Fatalf("ack group not flagged in its line: %q", ackLine)
	}
}

// --- health projection ----------------------------------------------------

type fakeLister struct {
	groups []*types.GroupInfo
	err    error
	calls  int
}

func (f *fakeLister) GetJoinedGroups(_ context.Context) ([]*types.GroupInfo, error) {
	f.calls++
	return f.groups, f.err
}

func resetMembership(t *testing.T) {
	t.Helper()
	membershipMu.Lock()
	lastMembership = GroupMembershipReport{}
	membershipKnown = false
	membershipErrStr = ""
	membershipMu.Unlock()
	groupsMutex.Lock()
	monitoredGroups = nil
	groupsMutex.Unlock()
}

// "We could not check" must never look like "there is no problem".
func TestMembershipHealthReportsUncheckedBeforeAnyRun(t *testing.T) {
	resetMembership(t)

	h := membershipHealth()

	if h["checked"] != false {
		t.Fatalf("checked = %v, want false before any run", h["checked"])
	}
	if _, ok := h["unreachable"]; ok {
		t.Fatal("unreachable count present before any check ran — reads as a clean result")
	}
}

func TestMembershipHealthRecordsQueryFailure(t *testing.T) {
	resetMembership(t)

	runGroupReconciliation(context.Background(), &fakeLister{err: errors.New("socket closed")})

	h := membershipHealth()
	if h["checked"] != false {
		t.Fatalf("a failed query must not count as checked, got %v", h["checked"])
	}
	if h["error"] != "socket closed" {
		t.Fatalf("error = %v, want the upstream cause", h["error"])
	}
}

func TestRunGroupReconciliationPopulatesHealth(t *testing.T) {
	resetMembership(t)
	groupsMutex.Lock()
	monitoredGroups = []MonitoredGroup{
		grp("Reachable", "1@g.us", "dr_submission", true, true),
		grp("Unreachable Ack", "2@g.us", "dr_submission", true, true),
	}
	groupsMutex.Unlock()

	jid, err := types.ParseJID("1@g.us")
	if err != nil {
		t.Fatalf("ParseJID: %v", err)
	}
	runGroupReconciliation(context.Background(), &fakeLister{groups: []*types.GroupInfo{{JID: jid}}})

	h := membershipHealth()
	if h["checked"] != true {
		t.Fatalf("checked = %v, want true", h["checked"])
	}
	if h["unreachable"] != 1 {
		t.Fatalf("unreachable = %v, want 1", h["unreachable"])
	}
	if h["unreachable_with_ack"] != 1 {
		t.Fatalf("unreachable_with_ack = %v, want 1", h["unreachable_with_ack"])
	}
}

func TestRunGroupReconciliationSurvivesNilClientAndNilGroups(t *testing.T) {
	resetMembership(t)

	runGroupReconciliation(context.Background(), nil) // must not panic
	if membershipHealth()["checked"] != false {
		t.Fatal("nil client recorded a check")
	}

	runGroupReconciliation(context.Background(), &fakeLister{groups: []*types.GroupInfo{nil}})
	if membershipHealth()["checked"] != true {
		t.Fatal("a nil group entry aborted the check")
	}
}

// The gap the original tests missed: they only covered never-run -> failure.
// After a SUCCESSFUL run, a later failure used to leave checked=true with the
// previous run's counts, so a monitor gating on checked + unreachable_with_ack
// would read an active outage as healthy.
func TestMembershipHealthDoesNotInheritPreviousSuccessOnFailure(t *testing.T) {
	resetMembership(t)
	groupsMutex.Lock()
	monitoredGroups = []MonitoredGroup{grp("Reachable", "1@g.us", "dr_submission", true, true)}
	groupsMutex.Unlock()

	jid, err := types.ParseJID("1@g.us")
	if err != nil {
		t.Fatalf("ParseJID: %v", err)
	}
	runGroupReconciliation(context.Background(), &fakeLister{groups: []*types.GroupInfo{{JID: jid}}})
	if membershipHealth()["checked"] != true {
		t.Fatal("setup: the successful run should have recorded a check")
	}

	runGroupReconciliation(context.Background(), &fakeLister{err: errors.New("boom")})

	h := membershipHealth()
	if h["checked"] != false {
		t.Fatalf("checked = %v after a failure following a success, want false", h["checked"])
	}
	if h["error"] != "boom" {
		t.Fatalf("error = %v, want the upstream cause", h["error"])
	}
	// The stale counts are what actually fooled a monitor, so assert they are gone.
	for _, k := range []string{"monitored", "joined", "unreachable", "unreachable_with_ack"} {
		if v, ok := h[k]; ok {
			t.Fatalf("stale %q = %v survived a failed check", k, v)
		}
	}
}

// reconcileClient is written by main() while the reloader goroutine is already
// reading it. Run under -race; without the mutex this reports a data race.
func TestReconcileClientAccessorIsRaceFree(t *testing.T) {
	t.Cleanup(func() { setReconcileClient(nil) })

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 200; i++ {
			_ = getReconcileClient()
		}
	}()
	for i := 0; i < 200; i++ {
		setReconcileClient(&fakeLister{})
	}
	<-done

	if getReconcileClient() == nil {
		t.Fatal("client was lost")
	}
}

// The 5-minute reload drove GetJoinedGroups 288 times a day and WhatsApp
// started returning 429 within hours. These pin the floor that prevents a
// repeat.
func TestReconcileIntervalDefaultsToSixHours(t *testing.T) {
	t.Setenv("WA_RECONCILE_INTERVAL", "")
	if got := reconcileInterval(); got != 6*time.Hour {
		t.Fatalf("default = %s, want 6h", got)
	}
}

func TestReconcileIntervalRejectsAggressiveOverride(t *testing.T) {
	// 5m is the exact value that caused the incident.
	t.Setenv("WA_RECONCILE_INTERVAL", "5m")
	got := reconcileInterval()
	if got != minReconcileInterval {
		t.Fatalf("interval = %s, want exactly the %s floor", got, minReconcileInterval)
	}
}

func TestReconcileIntervalAcceptsReasonableOverride(t *testing.T) {
	t.Setenv("WA_RECONCILE_INTERVAL", "2h")
	if got := reconcileInterval(); got != 2*time.Hour {
		t.Fatalf("interval = %s, want 2h", got)
	}
}

func TestReconcileIntervalFallsBackOnGarbage(t *testing.T) {
	t.Setenv("WA_RECONCILE_INTERVAL", "not-a-duration")
	if got := reconcileInterval(); got != defaultReconcileInterval {
		t.Fatalf("interval = %s, want the default on unparseable input", got)
	}
}
