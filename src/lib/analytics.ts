/**
 * Privacy-first analytics — Plausible-compatible.
 *
 * Activates only if VITE_PLAUSIBLE_DOMAIN is set at build time. Until then,
 * `track()` is a no-op so this module is safe to call everywhere.
 *
 * Why Plausible (not GA, not Segment):
 *   - No cookies, no PII, no fingerprinting.
 *   - Open source, self-hostable.
 *   - GDPR / CCPA friendly by default (no consent banner needed).
 *
 * What we DO track (all numeric values are bucketed; no targeting strings):
 *   - analyze_clicked (hasOptionalFiles: boolean)
 *   - decision_score_computed (scoreBucket: "0-25" | "26-50" | "51-75" | "76-100")
 *   - action_taken (action: "ack" | "snooze" | "hide", verdict: "push" | "hold" | "cut")
 *   - export_clicked (kind: "csv" | "html" | "bulk" | ...)
 *   - tab_changed (tab: section name)
 *
 * What we NEVER capture: campaign names, keywords, ASINs, bids, dollar amounts,
 * file names, file contents, IPs (Plausible itself doesn't store them).
 */

const PLAUSIBLE_DOMAIN = import.meta.env.VITE_PLAUSIBLE_DOMAIN as
  | string
  | undefined;
const PLAUSIBLE_SCRIPT_SRC =
  (import.meta.env.VITE_PLAUSIBLE_SCRIPT_SRC as string | undefined) ??
  "https://plausible.io/js/script.js";

let initialized = false;
let scriptInjected = false;

type PlausibleEventProps = Record<string, string | number | boolean>;

interface PlausibleFn {
  (event: string, options?: { props?: PlausibleEventProps }): void;
  q?: unknown[];
}

declare global {
  interface Window {
    plausible?: PlausibleFn;
  }
}

function injectPlausibleScript() {
  if (scriptInjected || typeof document === "undefined" || !PLAUSIBLE_DOMAIN) {
    return;
  }
  // Stub the global so events fired before the script loads queue up.
  if (!window.plausible) {
    const stub = function (this: unknown, ...args: Parameters<PlausibleFn>) {
      (stub.q = stub.q || []).push(args);
    } as PlausibleFn;
    window.plausible = stub;
  }
  const script = document.createElement("script");
  script.async = true;
  script.defer = true;
  script.dataset.domain = PLAUSIBLE_DOMAIN;
  script.src = PLAUSIBLE_SCRIPT_SRC;
  document.head.appendChild(script);
  scriptInjected = true;
}

export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;
  if (PLAUSIBLE_DOMAIN) injectPlausibleScript();
}

export function track(event: string, props?: PlausibleEventProps): void {
  if (!initialized || typeof window === "undefined" || !window.plausible) {
    return;
  }
  window.plausible(event, props ? { props } : undefined);
}

export function isAnalyticsActive(): boolean {
  return initialized && !!PLAUSIBLE_DOMAIN;
}

// ─── Bucket helpers ────────────────────────────────────────────────────────

export function bucketScore(
  score: number,
): "0-25" | "26-50" | "51-75" | "76-100" {
  if (score <= 25) return "0-25";
  if (score <= 50) return "26-50";
  if (score <= 75) return "51-75";
  return "76-100";
}
