import { LegalShell } from "./LegalShell";

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service" lastUpdated="May 23, 2026">
      <p>
        By using PPC Auditor (&quot;the tool&quot;), you agree to these terms.
        They&apos;re short on purpose.
      </p>

      <h2>1. The tool is provided as-is</h2>
      <p>
        We make a good-faith effort to keep the audit math correct, but the tool
        is provided without any warranty. Use it as one input among many in your
        bid-management workflow.
      </p>

      <h2>2. You are responsible for your bid decisions</h2>
      <p>
        The push / hold / cut verdicts are suggestions based on rules applied to
        the data you upload. You are responsible for verifying any change before
        applying it to your live Amazon advertising account.
      </p>

      <h2>3. Don&apos;t redistribute</h2>
      <p>
        The tool&apos;s source bundle is provided for use, not for
        reverse-engineering and redistribution as your own commercial product.
        Personal and team use within your own organisation is fine.
      </p>

      <h2>4. Acceptable use</h2>
      <p>
        Don&apos;t use the tool to violate any applicable law or Amazon&apos;s
        terms of service.
      </p>

      <h2>5. Liability</h2>
      <p>
        To the maximum extent permitted by law, our liability for any claim
        related to the tool is limited to the amount you paid for it in the 12
        months prior to the claim (so, often, zero).
      </p>

      <h2>6. Governing law</h2>
      <p>
        These terms are governed by the laws of the operator&apos;s country of
        registration. Disputes are resolved in that jurisdiction.
      </p>

      <h2>7. Contact</h2>
      <p>
        Questions? Email{" "}
        <a href="mailto:support@ppc-auditor.example">
          support@ppc-auditor.example
        </a>
        .
      </p>
    </LegalShell>
  );
}
