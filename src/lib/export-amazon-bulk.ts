/**
 * Amazon Sponsored Products Bulk Operations export (G12).
 *
 * Takes the audit's PUSH / CUT rows and the previously-uploaded Bulk file's
 * raw rows, emits a CSV that the user can paste straight into Amazon Ads →
 * Bulk Operations → Upload. The schema mirrors the original Bulk file's 53
 * columns; only Operation ("Update") and Bid are mutated.
 *
 * Recommended-bid defaults (conservative; user can edit before uploading):
 *   PUSH (Increase bid):  newBid = round(currentBid × 1.15, 2)
 *   CUT  (Reduce bid):    newBid = round(currentBid × 0.80, 2)
 *   Pause / review:       not exported (state change beyond scope here)
 *   Hold / Review match:  not exported
 */
import type { AuditRow } from "./types";
import type { BulkTarget } from "./analysis";
import { toCsv } from "./export";

/** Per-recommendation new-bid multiplier. */
const PUSH_MULTIPLIER = 1.15;
const CUT_MULTIPLIER = 0.8;
/** Amazon clamps SP bids to this range; we clamp our suggested bids too. */
const MIN_BID = 0.02;
const MAX_BID = 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function suggestNewBid(
  row: AuditRow,
  currentBid: number | null,
): number | null {
  if (currentBid == null || !Number.isFinite(currentBid)) return null;
  let next: number;
  if (row.recommendation === "Increase bid") {
    next = currentBid * PUSH_MULTIPLIER;
  } else if (row.recommendation === "Reduce bid") {
    next = currentBid * CUT_MULTIPLIER;
  } else {
    return null;
  }
  next = round2(next);
  if (next < MIN_BID) next = MIN_BID;
  if (next > MAX_BID) next = MAX_BID;
  return next;
}

/** Build a quick lookup of BulkTargets keyed by (campaign|adGroup|target|matchType). */
function indexBulkTargets(targets: BulkTarget[]): Map<string, BulkTarget> {
  const idx = new Map<string, BulkTarget>();
  for (const t of targets) {
    if (!t.rawRow) continue;
    const key = `${t.campaign}${t.adGroup}${t.target}${t.matchType ?? ""}`;
    idx.set(key, t);
    // Also index by campaign|target only for fallback matches (some SP rows
    // don't carry an explicit match type).
    const altKey = `${t.campaign}${t.target}`;
    if (!idx.has(altKey)) idx.set(altKey, t);
  }
  return idx;
}

/** Result of building the export — includes diagnostics for the UI. */
export interface BulkExportResult {
  csv: string;
  rowsEmitted: number;
  rowsSkipped: number;
  skippedReasons: {
    unmatched: number;
    noCurrentBid: number;
    notActionable: number;
  };
}

export function buildAmazonBulkExport(
  auditRows: AuditRow[],
  bulkTargets: BulkTarget[],
): BulkExportResult {
  const idx = indexBulkTargets(bulkTargets);
  // Header order from the first usable BulkTarget so the CSV matches Amazon's
  // expected column layout exactly.
  const headers =
    bulkTargets.find((t) => t.rawHeaders && t.rawHeaders.length)?.rawHeaders ??
    [];
  const rows: Array<Record<string, unknown>> = [];
  let unmatched = 0;
  let noCurrentBid = 0;
  let notActionable = 0;

  for (const r of auditRows) {
    if (
      r.recommendation !== "Increase bid" &&
      r.recommendation !== "Reduce bid"
    ) {
      notActionable++;
      continue;
    }
    const key = `${r.campaign}${r.adGroup}${r.targeting}${r.matchType ?? ""}`;
    let bulk = idx.get(key);
    if (!bulk) {
      // fallback: campaign+target only
      bulk = idx.get(`${r.campaign}${r.targeting}`);
    }
    if (!bulk || !bulk.rawRow) {
      unmatched++;
      continue;
    }
    const newBid = suggestNewBid(r, bulk.currentBid);
    if (newBid == null) {
      noCurrentBid++;
      continue;
    }
    // Clone the raw row, then mutate Operation + Bid.
    const out: Record<string, unknown> = { ...bulk.rawRow };
    out["Operation"] = "Update";
    out["Bid"] = newBid;
    // Amazon ignores Informational-only columns on import but they must be
    // present in the schema. Leave their values intact from the source row.
    rows.push(out);
  }

  // Preserve the original header order; if no rows emitted, still write headers
  // so the user sees the schema.
  const orderedRows = rows.map((r) => {
    if (!headers.length) return r;
    const ordered: Record<string, unknown> = {};
    for (const h of headers) ordered[h] = r[h] ?? "";
    return ordered;
  });

  // toCsv() needs at least one row to infer headers; if none, emit a header-only CSV.
  let csv: string;
  if (orderedRows.length === 0 && headers.length > 0) {
    csv = headers.join(",");
  } else if (orderedRows.length === 0) {
    csv = "";
  } else {
    csv = toCsv(orderedRows);
  }

  return {
    csv,
    rowsEmitted: rows.length,
    rowsSkipped: unmatched + noCurrentBid + notActionable,
    skippedReasons: { unmatched, noCurrentBid, notActionable },
  };
}
