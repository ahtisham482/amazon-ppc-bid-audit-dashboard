import { Link } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * Shared layout for static text pages (Privacy, Terms, Changelog).
 * Minimal — left-aligned column, simple back link to home.
 */
export function LegalShell({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated?: string;
  children: ReactNode;
}) {
  return (
    <div className="legal-shell">
      <div className="legal-container">
        <header className="legal-header">
          <Link to="/" className="legal-back" aria-label="Back to home">
            ← PPC Auditor
          </Link>
          <h1>{title}</h1>
          {lastUpdated && (
            <p className="legal-updated">Last updated: {lastUpdated}</p>
          )}
        </header>
        <main className="legal-body">{children}</main>
        <footer className="legal-footer-row">
          <Link to="/">Home</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/changelog">Changelog</Link>
        </footer>
      </div>
    </div>
  );
}
