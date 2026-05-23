/**
 * Persists per-target user actions (acknowledge / snooze / hide) to localStorage.
 *
 * The storage key is tied to the target AND its last bid-change date, so that
 * a fresh bid change automatically re-surfaces an acknowledged target ("I've
 * seen THIS state" semantics).
 *
 * Snoozes have a 7-day expiry and are filtered out on hydration / poll.
 *
 * If localStorage is unavailable (private mode, quota full), we fall back to
 * in-memory state and emit a one-time warning via the optional handler.
 */

export type TargetActionKind = "ack" | "snooze" | "hide";

export interface TargetActionRecord {
  action: TargetActionKind;
  ts: string; // ISO of when the user clicked
  snoozeUntil?: string; // ISO; only set for snooze
}

export type TargetActionMap = Record<string, TargetActionRecord>;

const STORAGE_KEY = "ppc-auditor.target-actions.v1";
export const SNOOZE_DAYS = 7;

let storageDisabled = false;
let storageErrorHandler: ((kind: "read" | "write" | "quota") => void) | null =
  null;

export function onStorageError(
  fn: (kind: "read" | "write" | "quota") => void,
): void {
  storageErrorHandler = fn;
}

export function isStorageDisabled(): boolean {
  return storageDisabled;
}

interface ActionKeyInput {
  campaign: string;
  adGroup: string;
  targeting: string;
  matchType: string;
  lastBidChangeDate: Date | null;
}

/**
 * Stable key for one (target, last-change) pair.
 * Acknowledging this key only "covers" the user's reaction to THIS bid-change
 * state. If a newer bid change lands, the key changes and the target re-surfaces.
 */
export function targetActionKey(row: ActionKeyInput): string {
  const lastISO = row.lastBidChangeDate
    ? row.lastBidChangeDate.toISOString().slice(0, 10)
    : "no-change";
  return `${row.campaign}|${row.adGroup}|${row.targeting}|${row.matchType}|${lastISO}`;
}

function safeLocalStorage(): Storage | null {
  if (storageDisabled) return null;
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const probeKey = "__ppc_auditor_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    storageDisabled = true;
    return null;
  }
}

/** Filter out expired snoozes. Mutates a copy, returns it. */
function pruneExpired(
  map: TargetActionMap,
  now: Date = new Date(),
): { pruned: TargetActionMap; changed: boolean } {
  const nowISO = now.toISOString();
  const out: TargetActionMap = {};
  let changed = false;
  for (const [k, v] of Object.entries(map)) {
    if (v.action === "snooze" && v.snoozeUntil && v.snoozeUntil <= nowISO) {
      changed = true;
      continue;
    }
    out[k] = v;
  }
  return { pruned: out, changed };
}

export function loadActions(now: Date = new Date()): TargetActionMap {
  const storage = safeLocalStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as TargetActionMap;
    if (typeof parsed !== "object" || parsed === null) return {};
    const { pruned, changed } = pruneExpired(parsed, now);
    if (changed) {
      // Best-effort save; ignore failure (we already have the pruned in memory).
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(pruned));
      } catch {
        /* noop */
      }
    }
    return pruned;
  } catch {
    storageErrorHandler?.("read");
    return {};
  }
}

export function saveActions(actions: TargetActionMap): boolean {
  const storage = safeLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(actions));
    return true;
  } catch (e) {
    if (
      e instanceof DOMException &&
      (e.name === "QuotaExceededError" || e.code === 22)
    ) {
      storageErrorHandler?.("quota");
    } else {
      storageErrorHandler?.("write");
    }
    storageDisabled = true;
    return false;
  }
}

export function makeActionRecord(
  kind: TargetActionKind,
  now: Date = new Date(),
): TargetActionRecord {
  const ts = now.toISOString();
  if (kind === "snooze") {
    const until = new Date(now.getTime() + SNOOZE_DAYS * 86_400_000);
    return { action: kind, ts, snoozeUntil: until.toISOString() };
  }
  return { action: kind, ts };
}

export function countActions(actions: TargetActionMap): {
  ack: number;
  snooze: number;
  hide: number;
  total: number;
} {
  let ack = 0;
  let snooze = 0;
  let hide = 0;
  for (const v of Object.values(actions)) {
    if (v.action === "ack") ack++;
    else if (v.action === "snooze") snooze++;
    else if (v.action === "hide") hide++;
  }
  return { ack, snooze, hide, total: ack + snooze + hide };
}

/** Re-prune expired snoozes (called by the hook on interval). */
export function pruneExpiredInMap(
  actions: TargetActionMap,
  now: Date = new Date(),
): TargetActionMap | null {
  const { pruned, changed } = pruneExpired(actions, now);
  return changed ? pruned : null;
}
