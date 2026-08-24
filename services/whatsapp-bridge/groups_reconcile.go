package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"go.mau.fi/whatsmeow/types"
)

// Reconciliation between the groups the bridge is configured to monitor and the
// groups the paired WhatsApp number is actually a participant in.
//
// These two sets can drift apart silently. A number swap is the obvious way:
// the replacement number has to be re-added to every group by hand, and any
// group missed simply stops receiving acknowledgements. The bridge previously
// said nothing about this — it would load 58 monitored groups, be a member of
// 14, and report itself healthy. The gap only surfaced when someone noticed
// field workers were not getting acks.
//
// A send into a group the number has left fails with "you're not participating
// in that group", which is a per-message symptom of a standing configuration
// problem. Detecting the standing problem is what this file does.

// GroupMembershipReport is the outcome of one reconciliation pass.
type GroupMembershipReport struct {
	MonitoredCount int
	JoinedCount    int
	// Unreachable is every active monitored group the number cannot post to.
	Unreachable []MonitoredGroup
}

// UnreachableAckCount is the number that actually costs the business something:
// a group with SendAck set that the bridge cannot reach is a field worker
// submitting work and never hearing back.
func (r GroupMembershipReport) UnreachableAckCount() int {
	n := 0
	for _, g := range r.Unreachable {
		if g.SendAck {
			n++
		}
	}
	return n
}

// reconcileGroups is pure so it can be tested without a WhatsApp connection.
//
// Inactive monitored groups are skipped: they are deliberately not in use, so
// reporting them as unreachable would be noise that trains people to ignore
// the warning.
func reconcileGroups(monitored []MonitoredGroup, joinedJIDs []string) GroupMembershipReport {
	joined := make(map[string]struct{}, len(joinedJIDs))
	for _, jid := range joinedJIDs {
		joined[jid] = struct{}{}
	}

	report := GroupMembershipReport{
		MonitoredCount: len(monitored),
		JoinedCount:    len(joined),
	}
	for _, g := range monitored {
		if !g.IsActive {
			continue
		}
		if _, ok := joined[g.GroupJID]; !ok {
			report.Unreachable = append(report.Unreachable, g)
		}
	}

	// Ack-carrying groups first, then by name, so the costly ones are visible
	// without reading to the end of a 45-line list.
	sort.SliceStable(report.Unreachable, func(i, j int) bool {
		a, b := report.Unreachable[i], report.Unreachable[j]
		if a.SendAck != b.SendAck {
			return a.SendAck
		}
		return a.GroupName < b.GroupName
	})
	return report
}

// formatMembershipWarning renders the report for the log. Returns "" when
// nothing is wrong, so the caller can stay quiet on the healthy path.
func formatMembershipWarning(r GroupMembershipReport) string {
	if len(r.Unreachable) == 0 {
		return ""
	}
	var b strings.Builder
	fmt.Fprintf(&b, "⚠️  GROUP MEMBERSHIP GAP: monitoring %d groups, joined %d, cannot post to %d\n",
		r.MonitoredCount, r.JoinedCount, len(r.Unreachable))
	if n := r.UnreachableAckCount(); n > 0 {
		fmt.Fprintf(&b, "   %d of these send acknowledgements — submissions there get no reply:\n", n)
	}
	for _, g := range r.Unreachable {
		marker := "   -"
		if g.SendAck {
			marker = "   !!"
		}
		project := g.ProjectName
		if project == "" {
			project = "-"
		}
		fmt.Fprintf(&b, "%s %s [%s] project=%s %s\n", marker, g.GroupName, g.GroupType, project, g.GroupJID)
	}
	b.WriteString("   Fix: add the bridge's number to these groups from a handset that administers them.")
	return b.String()
}

// joinedGroupsLister is the slice of *whatsmeow.Client this needs, so the
// reconciler can be exercised without a live connection.
type joinedGroupsLister interface {
	GetJoinedGroups(ctx context.Context) ([]*types.GroupInfo, error)
}

// The reloader goroutine starts before the WhatsApp client exists, so this is
// written by main() while that goroutine is already reading it. An interface
// value is two words; an unsynchronised concurrent read can tear, so both sides
// go through the mutex rather than relying on the write landing first.
var (
	reconcileClientMu sync.RWMutex
	reconcileClient   joinedGroupsLister
)

func setReconcileClient(c joinedGroupsLister) {
	reconcileClientMu.Lock()
	defer reconcileClientMu.Unlock()
	reconcileClient = c
}

func getReconcileClient() joinedGroupsLister {
	reconcileClientMu.RLock()
	defer reconcileClientMu.RUnlock()
	return reconcileClient
}

// getGroupNameOrUnknown resolves a JID for log messages. A send failure that
// names only the JID still costs someone a lookup to act on.
func getGroupNameOrUnknown(jid string) string {
	if g := getGroupByJID(jid); g != nil && g.GroupName != "" {
		return g.GroupName
	}
	return "unknown group"
}

var (
	membershipMu     sync.RWMutex
	lastMembership   GroupMembershipReport
	membershipKnown  bool
	membershipErrStr string
)

// runGroupReconciliation queries live membership, logs any gap, and caches the
// result for /health.
//
// A failure to query is recorded rather than swallowed: "we could not check" and
// "there is no problem" must not look the same to whoever reads /health.
func runGroupReconciliation(ctx context.Context, client joinedGroupsLister) {
	if client == nil {
		return
	}
	groups, err := client.GetJoinedGroups(ctx)
	if err != nil {
		// Clear the cached result, not just record the error. Leaving the last
		// successful counts in place would report checked=true with
		// unreachable=0 while the check is actually failing, and a monitor
		// gating on those two fields would call an outage healthy.
		membershipMu.Lock()
		membershipErrStr = err.Error()
		membershipKnown = false
		lastMembership = GroupMembershipReport{}
		membershipMu.Unlock()
		fmt.Printf("⚠️  Could not check group membership: %v\n", err)
		return
	}

	jids := make([]string, 0, len(groups))
	for _, g := range groups {
		if g != nil {
			jids = append(jids, g.JID.String())
		}
	}

	groupsMutex.RLock()
	monitored := make([]MonitoredGroup, len(monitoredGroups))
	copy(monitored, monitoredGroups)
	groupsMutex.RUnlock()

	report := reconcileGroups(monitored, jids)

	membershipMu.Lock()
	lastMembership = report
	membershipKnown = true
	membershipErrStr = ""
	membershipMu.Unlock()

	if warning := formatMembershipWarning(report); warning != "" {
		fmt.Println(warning)
	} else {
		fmt.Printf("✅ Group membership: all %d monitored groups reachable\n", report.MonitoredCount)
	}
}

// membershipHealth is the /health projection. The "checked" flag is what stops
// a never-run or failed check reading as a clean bill of health.
func membershipHealth() map[string]interface{} {
	membershipMu.RLock()
	defer membershipMu.RUnlock()

	out := map[string]interface{}{"checked": membershipKnown}
	if membershipErrStr != "" {
		out["error"] = membershipErrStr
	}
	if membershipKnown {
		out["monitored"] = lastMembership.MonitoredCount
		out["joined"] = lastMembership.JoinedCount
		out["unreachable"] = len(lastMembership.Unreachable)
		out["unreachable_with_ack"] = lastMembership.UnreachableAckCount()
	}
	return out
}

// GetJoinedGroups is an info query, and WhatsApp rate-limits info queries. The
// first version of this ran it on the five-minute group reload, which is 288
// calls a day and produced a steady drip of "429 rate-overlimit" within hours
// of deploying. This account has already been blocked twice, so provoking the
// rate limiter to keep a diagnostic fresh is a bad trade.
//
// Group membership changes when a person adds or removes the number — days
// apart, not minutes. Six hours is far more often than the thing being watched
// actually moves, and the check still runs once at startup so a restart gives
// an immediate answer.
const defaultReconcileInterval = 6 * time.Hour

// minReconcileInterval stops a careless override from recreating the problem.
const minReconcileInterval = 30 * time.Minute

func reconcileInterval() time.Duration {
	raw := getEnvOrDefault("WA_RECONCILE_INTERVAL", "")
	if raw == "" {
		return defaultReconcileInterval
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		fmt.Printf("⚠️  WA_RECONCILE_INTERVAL=%q is not a duration, using %s\n", raw, defaultReconcileInterval)
		return defaultReconcileInterval
	}
	if d < minReconcileInterval {
		fmt.Printf("⚠️  WA_RECONCILE_INTERVAL=%s is below the %s floor, using the floor\n", d, minReconcileInterval)
		return minReconcileInterval
	}
	return d
}

// startMembershipReconciler runs the membership check on its own slow schedule,
// deliberately decoupled from the five-minute DB reload.
func startMembershipReconciler() {
	interval := reconcileInterval()
	fmt.Printf("🕒 Group membership will be re-checked every %s\n", interval)
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			runGroupReconciliation(context.Background(), getReconcileClient())
		}
	}()
}
