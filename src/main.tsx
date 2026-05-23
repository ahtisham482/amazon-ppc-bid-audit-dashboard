import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import "./styles.css";
import { initSentry, Sentry } from "./lib/sentry";
import { initAnalytics } from "./lib/analytics";

// Code-split the legal pages — only fetched when the user navigates there.
const PrivacyPage = lazy(() =>
  import("./pages/Privacy").then((m) => ({ default: m.PrivacyPage })),
);
const TermsPage = lazy(() =>
  import("./pages/Terms").then((m) => ({ default: m.TermsPage })),
);
const ChangelogPage = lazy(() =>
  import("./pages/Changelog").then((m) => ({ default: m.ChangelogPage })),
);

initSentry();
initAnalytics();

function LegalPageFallback() {
  return (
    <div
      style={{
        padding: 48,
        textAlign: "center",
        color: "#64748b",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      }}
    >
      Loading…
    </div>
  );
}

function AppCrashScreen({ resetError }: { resetError?: () => void }) {
  return (
    <div
      role="alert"
      style={{
        maxWidth: 420,
        margin: "80px auto",
        padding: "32px 28px",
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        textAlign: "center",
        boxShadow: "0 10px 30px -10px rgba(15, 23, 42, 0.15)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 22, color: "#111827" }}>
        Something went wrong
      </h1>
      <p
        style={{
          marginTop: 12,
          color: "#475569",
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        The audit hit an unexpected error. Your uploaded files are still in this
        tab — reloading should let you try again. We&apos;ve been notified.
      </p>
      <div
        style={{
          marginTop: 20,
          display: "flex",
          gap: 8,
          justifyContent: "center",
        }}
      >
        <button
          type="button"
          onClick={() => {
            resetError?.();
            window.location.reload();
          }}
          style={{
            background: "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => <AppCrashScreen resetError={resetError} />}
    >
      <HashRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route
            path="/privacy"
            element={
              <Suspense fallback={<LegalPageFallback />}>
                <PrivacyPage />
              </Suspense>
            }
          />
          <Route
            path="/terms"
            element={
              <Suspense fallback={<LegalPageFallback />}>
                <TermsPage />
              </Suspense>
            }
          />
          <Route
            path="/changelog"
            element={
              <Suspense fallback={<LegalPageFallback />}>
                <ChangelogPage />
              </Suspense>
            }
          />
        </Routes>
      </HashRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
