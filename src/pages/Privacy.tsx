import { LegalShell } from "./LegalShell";

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" lastUpdated="May 23, 2026">
      <p>
        PPC Auditor is a privacy-first tool. Your data stays on your device.
        Here&apos;s exactly what we do and don&apos;t collect.
      </p>

      <h2>1. Files never leave your browser</h2>
      <p>
        When you upload an Amazon Ads History export, Sponsored Products report,
        Bulk file, or ACoS map, the file is parsed entirely in your browser. No
        copy of the file or its contents is ever transmitted to a server, ours
        or anyone else&apos;s. The same applies to the analysis output.
      </p>

      <h2>2. What we collect (and only if you opt in)</h2>
      <p>
        If the deployment is configured with privacy-respecting analytics (we
        use <strong>Plausible</strong>, no cookies, no fingerprinting), we
        receive anonymous, aggregate event names so we can measure broad usage
        patterns. Specifically, we may record:
      </p>
      <ul>
        <li>That the &quot;Analyze&quot; button was clicked.</li>
        <li>
          A bucketed range for the decision score (0–25, 26–50, 51–75, 76–100).
        </li>
        <li>
          That an action button (Acknowledge / Snooze / Hide) was used, along
          with the verdict (push / hold / cut).
        </li>
        <li>
          That a download button was clicked, along with the download type.
        </li>
        <li>That a tab was changed, along with the tab name.</li>
      </ul>
      <p>
        We <strong>never</strong> capture: keywords, target text, campaign
        names, ASINs, dollar amounts, bid values, file names, file contents, or
        your IP address. Plausible itself does not store IPs.
      </p>

      <h2>3. Error monitoring</h2>
      <p>
        If the deployment is configured with Sentry, frontend errors are
        reported so we can fix bugs. Reports include the stack trace and the
        scrubbed page URL. Reports are filtered to drop anything that looks like
        uploaded data (long strings, CSV-row-shaped payloads). Session replay is
        disabled.
      </p>

      <h2>4. localStorage</h2>
      <p>
        Your acknowledgements, snoozes, and hidden decisions are saved to your
        browser&apos;s <code>localStorage</code> so they survive a reload. They
        live only on your device. You can clear them by clearing the browser
        site data, or via the in-app &quot;Clear all in view&quot; control.
      </p>

      <h2>5. Cookies</h2>
      <p>
        None. We don&apos;t use cookies. We don&apos;t share anything with ad
        networks.
      </p>

      <h2>6. Children</h2>
      <p>
        This tool is for adults running an Amazon advertising account. It is not
        directed at children under 13.
      </p>

      <h2>7. Contact</h2>
      <p>
        Questions about privacy? Email{" "}
        <a href="mailto:support@ppc-auditor.example">
          support@ppc-auditor.example
        </a>
        .
      </p>
    </LegalShell>
  );
}
