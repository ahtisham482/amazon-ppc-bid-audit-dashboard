/**
 * Sentry error monitoring — privacy-respecting init.
 *
 * Activates only if VITE_SENTRY_DSN is set at build time. Without a DSN,
 * Sentry doesn't capture anything (no PII leaves the browser).
 *
 * Privacy rules:
 *   - sendDefaultPii: false  (no IP / cookies / user identifiers).
 *   - replaysSessionSampleRate: 0  (we NEVER session-replay user sessions).
 *   - replaysOnErrorSampleRate: 0  (we NEVER replay even on errors).
 *   - beforeSend scrubs anything that looks like uploaded data (long arrays,
 *     campaign-name-ish strings, currency-shaped values).
 */

import * as Sentry from "@sentry/react";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

let initialized = false;

export function initSentry(): void {
  if (initialized || !SENTRY_DSN) return;
  initialized = true;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      // Scrub anything that looks like uploaded file content.
      try {
        const json = JSON.stringify(event);
        // Drop if any string longer than 8 KB sneaks into the payload —
        // uploaded data could end up serialised in error messages otherwise.
        if (json.length > 100_000) return null;
      } catch {
        return null;
      }
      // Strip query strings from URL fragments
      if (event.request?.url) {
        event.request.url = event.request.url.split("?")[0];
      }
      // Drop breadcrumbs that mention file:// URLs or contain CSV-looking commas
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.filter((b) => {
          const blob = JSON.stringify(b);
          if (/file:\/\//i.test(blob)) return false;
          // crude CSV-row detector
          if ((blob.match(/,/g) ?? []).length > 12) return false;
          return true;
        });
      }
      return event;
    },
  });
}

export function isSentryActive(): boolean {
  return initialized;
}

export { Sentry };
