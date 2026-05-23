import { LegalShell } from "./LegalShell";

export function ChangelogPage() {
  return (
    <LegalShell title="Changelog" lastUpdated="May 23, 2026">
      <p>What changed, when. Newest first.</p>

      <h2>v1.0 — Launch readiness pass (2026-05-23)</h2>
      <ul>
        <li>
          <strong>Performance:</strong> All Targets table is now virtualized. A
          1,211-row dataset that previously scrolled at ~13 fps now scrolls
          smoothly at ~43+ fps. The 1.2-second freeze when clicking &quot;Load
          all&quot; is gone.
        </li>
        <li>
          <strong>Persistence:</strong> Acknowledge / Snooze / Hide decisions
          now survive a reload. Snoozes auto-expire after 7 days. A new
          &quot;Your decisions&quot; bar lets you filter to acked / snoozed /
          hidden subsets and clear them in bulk.
        </li>
        <li>
          <strong>Toasts and empty states:</strong> Every download now confirms
          with a toast. Zero-results filter shows a friendly empty state with a
          &quot;Clear filters&quot; button. Analyze shows a shimmer skeleton.
        </li>
        <li>
          <strong>Accessibility (WCAG 2.1 AA):</strong> Skip-to-content link.
          All decorative icons get <code>aria-hidden</code>. All form inputs
          have explicit labels. Muted text contrast lifted from 4.44 to 7.06 on
          the upload surface.
        </li>
        <li>
          <strong>Observability:</strong> Sentry + privacy-respecting Plausible
          analytics are wired up (opt-in via env vars).
        </li>
        <li>
          <strong>Onboarding:</strong> 4-step first-run tour. &quot;Try with
          sample data&quot; button on landing.
        </li>
        <li>
          <strong>Branding:</strong> Footer with Privacy / Terms / Changelog
          links. OpenGraph + Twitter share cards.
        </li>
      </ul>

      <h2>v0.x — Pre-launch betas</h2>
      <ul>
        <li>Engine improvements, rule tuning, copy polish.</li>
        <li>Auto-detect file types regardless of which upload box you use.</li>
        <li>Threshold persistence + KPI selector for refined verdicts.</li>
        <li>Bid Timeline chart with KPI overlay.</li>
        <li>Amazon Bulk Update CSV export.</li>
      </ul>
    </LegalShell>
  );
}
