import Papa from "papaparse";
// xlsx is dynamically imported inside readRows / parseBulk / readWorkbookSheetNames
// so the ~110 KB chunk is fetched only when the user actually uploads a workbook.
// Type-only import keeps the WorkBook annotation working without including the runtime.
import type * as XLSX from "xlsx";
async function loadXLSX(): Promise<typeof import("xlsx")> {
  return import("xlsx");
}
import {
  AnalysisResult,
  AuditRow,
  BeforeAfterImpact,
  CampaignSummary,
  Category,
  FileStatus,
  HistoryRow,
  KpiKey,
  KpiThreshold,
  MatchLevel,
  Methodology,
  MethodologyEntry,
  PerformanceAggregate,
  Priority,
  Recommendation,
  RowExplain,
  TargetingRow,
  TimelineEntry,
  TimelineKpiVerdict,
  Thresholds,
  UnmatchedReason,
} from "./types";

type RawRow = Record<string, unknown>;

const AUTO_TARGETS = new Set([
  "close-match",
  "loose-match",
  "substitutes",
  "complements",
]);

export const defaultThresholds: Thresholds = {
  targetAcos: 0.25,
  minClicks: 8,
  minSpend: 20,
  minOrders: 2,
  minSales: 50,
  lookbackDays: 7,
  attributionDelayDays: 1,
  mode: "Balanced",
  kpis: [{ kpi: "acos", threshold: 0.25, direction: "lower" }],
};

export function thresholdsForMode(
  mode: Thresholds["mode"],
  current: Thresholds,
): Thresholds {
  const base = { ...current, mode };
  if (mode === "Conservative") {
    return {
      ...base,
      minClicks: 14,
      minSpend: 30,
      minOrders: 3,
      minSales: 75,
      attributionDelayDays: 2,
    };
  }
  if (mode === "Aggressive") {
    return {
      ...base,
      minClicks: 5,
      minSpend: 12,
      minOrders: 1,
      minSales: 30,
      attributionDelayDays: 1,
    };
  }
  return {
    ...base,
    minClicks: 8,
    minSpend: 20,
    minOrders: 2,
    minSales: 50,
    attributionDelayDays: 1,
  };
}

export type ReportKind =
  | "history"
  | "targeting"
  | "sb-targeting"
  | "bulk"
  | "acos-map"
  | "unknown";

const HISTORY_SIGNATURE = ["time", "metadata", "from", "to"];
const TARGETING_SIGNATURE = ["campaign name", "targeting", "spend"];
const BULK_SIGNATURE = ["product", "entity", "operation"];
const ACOS_MAP_KEYS = [
  "target acos",
  "break-even acos",
  "breakeven acos",
  "break even acos",
];
const BULK_SHEETS = [
  "Sponsored Products Campaigns",
  "Sponsored Brands Campaigns",
];

/**
 * Reads a CSV, XLS, or XLSX file into row objects.
 * - CSV / text  -> PapaParse (correct UTF-8 handling).
 * - XLS / XLSX  -> SheetJS (binary; also reads the legacy .xls format).
 * Throws plain-English errors so the UI can say exactly what went wrong.
 */
export async function readRows(file: File): Promise<RawRow[]> {
  const name = (file.name || "").toLowerCase();
  const isWorkbook = /\.(xlsx|xlsm|xlsb|xls)$/.test(name);

  if (isWorkbook) {
    const XLSX = await loadXLSX();
    let workbook: XLSX.WorkBook;
    try {
      const buffer = await file.arrayBuffer();
      workbook = XLSX.read(new Uint8Array(buffer), {
        type: "array",
        raw: true,
        cellDates: false,
      });
    } catch {
      throw new Error(
        `"${file.name}" could not be opened as an Excel file. If it is really a CSV, rename it to end in .csv and upload again.`,
      );
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error(`"${file.name}" has no worksheets.`);
    const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, {
      defval: "",
      raw: true,
    });
    if (!rows.length) {
      throw new Error(`"${file.name}" has a header row but no data rows.`);
    }
    return rows;
  }

  return new Promise((resolve, reject) => {
    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (result) => {
        if (!result.data.length) {
          reject(
            new Error(
              `"${file.name}" has no data rows. Make sure it is the exported CSV with a header row.`,
            ),
          );
          return;
        }
        resolve(result.data);
      },
      error: (error) =>
        reject(
          new Error(
            `"${file.name}" could not be read as a CSV: ${error.message}`,
          ),
        ),
    });
  });
}

/** Detects what kind of file this is from its column names. */
export function classifyReport(columns: string[]): ReportKind {
  const lower = columns.map((column) => column.trim().toLowerCase());
  const has = (needle: string) => lower.includes(needle);
  const hasLike = (sub: string) => lower.some((c) => c.includes(sub));

  // Bulk Operations file — its first sheet (Portfolios) has Product/Entity/Operation.
  if (BULK_SIGNATURE.every(has)) return "bulk";

  const historyHits = HISTORY_SIGNATURE.filter(has).length;
  if (historyHits >= 3) return "history";

  const targetingHits = TARGETING_SIGNATURE.filter(has).length;
  if (targetingHits >= 2) {
    // SB performance reports use 14-day attribution; SP uses 7-day.
    if (hasLike("14 day total sales") && !hasLike("7 day total sales")) {
      return "sb-targeting";
    }
    return "targeting";
  }

  if (
    (has("campaign") || has("campaign name") || has("portfolio name")) &&
    ACOS_MAP_KEYS.some((k) => hasLike(k))
  ) {
    return "acos-map";
  }
  return "unknown";
}

function columnsOf(rows: RawRow[]): string[] {
  return rows.length ? Object.keys(rows[0]) : [];
}

/** Reads + validates the Amazon Ads History export (CSV, XLS, or XLSX). */
export async function parseHistoryCsv(file: File): Promise<RawRow[]> {
  const rows = await readRows(file);
  const kind = classifyReport(columnsOf(rows));
  if (kind === "targeting") {
    throw new Error(
      `"${file.name}" looks like the Sponsored Products Targeting report, not the bid-change History export. Put it in the other box.`,
    );
  }
  if (kind === "unknown") {
    throw new Error(
      `"${file.name}" does not look like the Amazon Ads History export (missing the time / from / to / metadata columns).`,
    );
  }
  return rows;
}

/** Reads + validates the Sponsored Products Targeting report (XLSX, XLS, or CSV). */
export async function parseTargetingWorkbook(file: File): Promise<RawRow[]> {
  const rows = await readRows(file);
  const kind = classifyReport(columnsOf(rows));
  if (kind === "history") {
    throw new Error(
      `"${file.name}" looks like the bid-change History export, not the Sponsored Products Targeting report. Put it in the other box.`,
    );
  }
  if (kind === "unknown") {
    throw new Error(
      `"${file.name}" does not look like the Sponsored Products Targeting report (missing the Campaign Name / Targeting / Spend columns).`,
    );
  }
  return rows;
}

/** Fast peek at a workbook's sheet names (used to spot a Bulk file). */
export async function readWorkbookSheetNames(file: File): Promise<string[]> {
  try {
    const XLSX = await loadXLSX();
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), {
      type: "array",
      bookSheets: true,
    });
    return wb.SheetNames ?? [];
  } catch {
    return [];
  }
}

export function isBulkFile(fileName: string, sheetNames: string[]): boolean {
  if (/^bulk[-_]/i.test(fileName)) return true;
  return sheetNames.some((s) => BULK_SHEETS.includes(s));
}

export interface BulkTarget {
  programType: "SP" | "SB";
  campaign: string;
  adGroup: string;
  target: string;
  matchType: string;
  currentBid: number | null;
  /**
   * The original row from the Bulk file, including all IDs, Operation,
   * State, etc. Used by the Amazon-Bulk-Operations export so the emitted
   * CSV preserves Amazon's required columns (G12).
   */
  rawRow?: RawRow;
  /** Sheet this row originated from (preserves schema correctly per program). */
  rawSheet?: string;
  /** Header order from the source sheet so the export can preserve column order. */
  rawHeaders?: string[];
}

/**
 * Reads the Bulk Operations file. Only the SP/SB Campaigns sheets are parsed
 * (a Bulk file is ~20 MB; this keeps it fast). Returns one row per live
 * Keyword / Product Targeting with its current bid.
 */
export async function parseBulk(file: File): Promise<BulkTarget[]> {
  const XLSX = await loadXLSX();
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    raw: true,
    sheets: BULK_SHEETS,
  });
  const out: BulkTarget[] = [];
  for (const sheetName of BULK_SHEETS) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<RawRow>(ws, {
      defval: "",
      raw: true,
    });
    // Capture header order from row 0 so the export writer can preserve it.
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    for (const r of rows) {
      const entity = string(read(r, "Entity"));
      if (entity !== "Keyword" && entity !== "Product Targeting") continue;
      const productType = string(read(r, "Product"));
      const programType = productType.includes("Brands") ? "SB" : "SP";
      const campaign =
        string(read(r, "Campaign Name")) ||
        string(read(r, "Campaign Name (Informational only)"));
      const adGroup =
        string(read(r, "Ad Group Name")) ||
        string(read(r, "Ad Group Name (Informational only)"));
      const target =
        entity === "Keyword"
          ? string(read(r, "Keyword Text"))
          : string(read(r, "Product Targeting Expression")) ||
            string(read(r, "Resolved Product Targeting Expression"));
      if (!campaign || !target) continue;
      const bid =
        toNumber(read(r, "Bid")) ??
        toNumber(read(r, "Ad Group Default Bid")) ??
        null;
      out.push({
        programType,
        campaign,
        adGroup,
        target,
        matchType: string(read(r, "Match Type")),
        currentBid: bid,
        rawRow: r,
        rawSheet: sheetName,
        rawHeaders: headers,
      });
    }
  }
  return out;
}

/** Per-program lookup of current bid, with several key fallbacks. */
interface BulkIndex {
  byExact: Map<string, number>;
  byCanonical: Map<string, number>;
  byNoMatchType: Map<string, number>;
  byCampaignTarget: Map<string, number>;
}

function buildBulkIndex(
  targets: BulkTarget[],
  program: "SP" | "SB",
): BulkIndex {
  const idx: BulkIndex = {
    byExact: new Map(),
    byCanonical: new Map(),
    byNoMatchType: new Map(),
    byCampaignTarget: new Map(),
  };
  for (const t of targets) {
    if (t.programType !== program) continue;
    if (t.currentBid === null) continue;
    idx.byExact.set(
      makeKey(t.campaign, t.adGroup, t.target, t.matchType),
      t.currentBid,
    );
    idx.byCanonical.set(
      makeKey(
        t.campaign,
        t.adGroup,
        t.target,
        canonicalMatchType(t.matchType, t.target),
      ),
      t.currentBid,
    );
    idx.byNoMatchType.set(
      makeNoMatchTypeKey(t.campaign, t.adGroup, t.target),
      t.currentBid,
    );
    idx.byCampaignTarget.set(
      `${norm(t.campaign)}||${canonicalTarget(t.target)}`,
      t.currentBid,
    );
  }
  return idx;
}

function bulkBidFor(
  aggregate: PerformanceAggregate,
  idx: BulkIndex | null,
): number | null {
  if (!idx) return null;
  const ct = `${norm(aggregate.campaign)}||${canonicalTarget(aggregate.targeting)}`;
  return (
    idx.byExact.get(aggregate.exactKey) ??
    idx.byCanonical.get(aggregate.canonicalKey) ??
    idx.byNoMatchType.get(aggregate.noMatchTypeKey) ??
    idx.byCampaignTarget.get(ct) ??
    null
  );
}

/** Parses an optional per-campaign target-ACoS map file. */
export function parseAcosMap(rows: RawRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const campaign =
      string(read(r, "Campaign")) ||
      string(read(r, "Campaign Name")) ||
      string(read(r, "Portfolio name")) ||
      string(read(r, "Portfolio"));
    let acos =
      toNumber(read(r, "Target ACoS")) ??
      toNumber(read(r, "Break-even ACoS")) ??
      toNumber(read(r, "Breakeven ACoS")) ??
      toNumber(read(r, "Break even ACoS"));
    if (!campaign || acos === null) continue;
    if (acos > 1) acos = acos / 100; // accept "25" or "0.25"
    map.set(norm(campaign), acos);
  }
  return map;
}

export interface AnalyzeOptions {
  bulkTargets?: BulkTarget[];
  sbTargetingRaw?: RawRow[];
  acosMap?: Map<string, number>;
  bulkFileName?: string;
}

function effectiveThresholds(
  thresholds: Thresholds,
  acosMap: Map<string, number> | undefined,
  campaign: string,
): Thresholds {
  const override =
    acosMap && acosMap.size ? acosMap.get(norm(campaign)) : undefined;
  const targetAcos = override !== undefined ? override : thresholds.targetAcos;
  // Always sync the ACoS KPI threshold to the current targetAcos so the
  // rolling-7 timeline uses the right number when targetAcos changes.
  const baseKpis = thresholds.kpis ?? [];
  const hasAcos = baseKpis.some((k) => k.kpi === "acos");
  const kpis: KpiThreshold[] = hasAcos
    ? baseKpis.map((k) =>
        k.kpi === "acos" ? { ...k, threshold: targetAcos } : k,
      )
    : [{ kpi: "acos", threshold: targetAcos, direction: "lower" }, ...baseKpis];
  return { ...thresholds, targetAcos, kpis };
}

/** Builds a self-contained audit for one program (used for Sponsored Brands). */
function runProgramAudit(
  programHistory: HistoryRow[],
  targeting: TargetingRow[],
  thresholds: Thresholds,
  bulk: BulkIndex | null,
  acosMap: Map<string, number> | undefined,
  label: string,
  notes: string[],
): import("./types").ProgramResult {
  const aggregates = aggregateTargeting(targeting);
  const indexes = buildHistoryIndexes(programHistory);
  const programCampaigns = new Set(programHistory.map((h) => h.campaignName));
  const auditRows = aggregates.map((aggregate) =>
    buildAuditRow(
      aggregate,
      indexes,
      effectiveThresholds(thresholds, acosMap, aggregate.campaign),
      bulk,
      programCampaigns,
    ),
  );
  return {
    label,
    auditRows,
    campaignSummary: summarizeBy(auditRows, (row) => row.campaign),
    adGroupSummary: summarizeBy(auditRows, (row) => row.adGroup),
    summary: summarize(
      auditRows,
      programHistory,
      programHistory,
      [],
      targeting,
    ),
    unmatchedPerformanceRows: auditRows.filter(
      (row) => row.matchLevel === "Unmatched",
    ),
    notes,
  };
}

export function analyzeFiles(
  historyRaw: RawRow[],
  targetingRaw: RawRow[],
  historyFileName: string,
  targetingFileName: string,
  thresholds: Thresholds,
  opts: AnalyzeOptions = {},
): AnalysisResult {
  const history = historyRaw
    .map(normalizeHistoryRow)
    .filter(Boolean) as HistoryRow[];
  const targeting = targetingRaw
    .map(normalizeTargetingRow)
    .filter(Boolean) as TargetingRow[];
  const aggregates = aggregateTargeting(targeting);
  const spHistory = history.filter((row) => row.programType === "SP");
  const sbHistory = history.filter((row) => row.programType === "SB");
  const historyIndexes = buildHistoryIndexes(spHistory);

  const spBulk = opts.bulkTargets
    ? buildBulkIndex(opts.bulkTargets, "SP")
    : null;
  const spCampaigns = new Set(spHistory.map((h) => h.campaignName));
  const auditRows = aggregates.map((aggregate) =>
    buildAuditRow(
      aggregate,
      historyIndexes,
      effectiveThresholds(thresholds, opts.acosMap, aggregate.campaign),
      spBulk,
      spCampaigns,
    ),
  );
  const unmatchedHistoryRows = getUnmatchedHistoryRows(spHistory, auditRows);
  const campaignSummary = summarizeBy(auditRows, (row) => row.campaign);
  const adGroupSummary = summarizeBy(auditRows, (row) => row.adGroup);
  const summary = summarize(
    auditRows,
    history,
    spHistory,
    sbHistory,
    targeting,
  );
  const charts = makeChartData(auditRows, campaignSummary);
  const historyStatus = makeHistoryStatus(historyFileName, history);
  const targetingStatus = makeTargetingStatus(
    targetingFileName,
    targeting,
    aggregates,
  );
  const unsupportedHistoryRows = sbHistory;
  const unmatchedPerformanceRows = auditRows.filter(
    (row) => row.matchLevel === "Unmatched",
  );

  // --- Sponsored Brands audit (only if an SB report was uploaded) ---
  let sb: import("./types").ProgramResult | null = null;
  if (opts.sbTargetingRaw && opts.sbTargetingRaw.length) {
    const sbTargeting = opts.sbTargetingRaw
      .map(normalizeTargetingRow)
      .filter(Boolean) as TargetingRow[];
    const sbBulk = opts.bulkTargets
      ? buildBulkIndex(opts.bulkTargets, "SB")
      : null;
    sb = runProgramAudit(
      sbHistory,
      sbTargeting,
      thresholds,
      sbBulk,
      opts.acosMap,
      "Sponsored Brands",
      [
        "Sponsored Brands reports are summary-level (a date range, not daily), so before/after impact is not available for SB.",
        "SB uses 14-day attribution; SP uses 7-day. Numbers are not directly comparable across programs.",
      ],
    );
  }

  // --- Bulk status ---
  let bulkStatus: import("./types").BulkStatus | null = null;
  if (opts.bulkTargets) {
    const spResolved = auditRows.filter((r) => r.bulkConfirmed).length;
    const nowJudgeable = auditRows.filter(
      (r) => r.bulkConfirmed && r.matchLevel === "Unmatched",
    ).length;
    bulkStatus = {
      fileName: opts.bulkFileName ?? "Bulk file",
      spTargets: opts.bulkTargets.filter((t) => t.programType === "SP").length,
      sbTargets: opts.bulkTargets.filter((t) => t.programType === "SB").length,
      spBidsResolved: spResolved,
      spNowJudgeable: nowJudgeable,
    };
  }

  const warnings = [
    ...(sbHistory.length && !sb
      ? [
          `${sbHistory.length.toLocaleString()} Sponsored Brands history rows are isolated. Upload the Sponsored Brands performance report to audit them (see the Sponsored Brands tab).`,
        ]
      : []),
    ...(sb
      ? [
          `Sponsored Brands audit is active: ${sb.summary.totalTargets.toLocaleString()} SB targets, ${sb.summary.matchedTargets.toLocaleString()} matched. See the Sponsored Brands tab.`,
        ]
      : []),
    ...(unmatchedPerformanceRows.length
      ? [
          bulkStatus
            ? `${unmatchedPerformanceRows.length.toLocaleString()} SP targets had no bid-change history; ${bulkStatus.spNowJudgeable.toLocaleString()} of them now have a known current bid from the Bulk file.`
            : `${unmatchedPerformanceRows.length.toLocaleString()} Sponsored Products target combinations did not match bid history in the selected window.`,
        ]
      : []),
    ...(opts.bulkTargets
      ? [
          `Current bids loaded from the Bulk file for ${bulkStatus?.spBidsResolved.toLocaleString()} SP targets.`,
        ]
      : [
          "If a target had no bid change in this file's date range, its current bid is unknown here. Upload a Bulk Operations file to fill in current bids and match more targets.",
        ]),
    ...(opts.acosMap && opts.acosMap.size
      ? [
          `Per-campaign target ACoS applied to ${opts.acosMap.size.toLocaleString()} campaign(s) from your ACoS map.`,
        ]
      : [
          "Upload a per-campaign ACoS map (Box 5) for tighter per-campaign targets. Until then the tool uses one global target ACoS for every campaign.",
        ]),
  ];

  return {
    historyStatus,
    targetingStatus,
    auditRows,
    campaignSummary,
    adGroupSummary,
    summary,
    unsupportedHistoryRows,
    unmatchedPerformanceRows,
    unmatchedHistoryRows,
    methodology: getMethodology(thresholds),
    charts,
    warnings,
    sb,
    bulkStatus,
  };
}

function normalizeHistoryRow(raw: RawRow): HistoryRow | null {
  const metadata = safeJson(read(raw, "metadata"));
  const programType = String(metadata.programType ?? "").trim();
  const timeValue = Number(read(raw, "time"));
  const time = Number.isFinite(timeValue) ? new Date(timeValue) : null;
  const fromBid = toNumber(read(raw, "from"));
  const toBid = toNumber(read(raw, "to"));
  const name = string(read(raw, "name"));
  const matchType = string(read(raw, "matchType"));
  const targetingType = string(read(raw, "targetingType"));
  const campaignName = string(metadata.campaignName);
  const adGroupName = string(metadata.adGroupName);
  const bidChangePct =
    fromBid && toBid !== null ? (toBid - fromBid) / fromBid : null;

  const exactKey = makeKey(campaignName, adGroupName, name, matchType);
  const canonicalKey = makeKey(campaignName, adGroupName, name, matchType);
  const noMatchTypeKey = makeNoMatchTypeKey(campaignName, adGroupName, name);

  if (!name && !campaignName) return null;

  return {
    raw,
    time,
    eventSourceType: string(read(raw, "eventSourceType")),
    eventSourceId: string(read(raw, "eventSourceId")),
    name,
    type: string(read(raw, "type")),
    fromBid,
    toBid,
    targetingType,
    matchType,
    targetingSecondary: string(read(raw, "targetingSecondary")),
    campaignId: string(read(raw, "campaignId")),
    adGroupId: string(read(raw, "adGroupId")),
    isSystemEvent: String(read(raw, "isSystemEvent")).toLowerCase() === "true",
    campaignName,
    adGroupName,
    programType,
    bidChangePct,
    exactKey,
    canonicalKey,
    noMatchTypeKey,
  };
}

function normalizeTargetingRow(raw: RawRow): TargetingRow | null {
  const campaign = string(read(raw, "Campaign Name"));
  const adGroup = string(read(raw, "Ad Group Name"));
  const targeting = string(read(raw, "Targeting"));
  const matchType = string(read(raw, "Match Type"));
  const date = toDate(read(raw, "Date"));
  if (!campaign || !adGroup || !targeting) return null;

  const exactKey = makeKey(campaign, adGroup, targeting, matchType);
  const canonicalKey = makeKey(
    campaign,
    adGroup,
    targeting,
    canonicalMatchType(matchType, targeting),
  );
  const noMatchTypeKey = makeNoMatchTypeKey(campaign, adGroup, targeting);

  return {
    raw,
    date,
    portfolio: string(read(raw, "Portfolio name")),
    currency: string(read(raw, "Currency")),
    campaign,
    country: string(read(raw, "Country")),
    adGroup,
    retailer: string(read(raw, "Retailer")),
    targeting,
    matchType,
    impressions: toNumber(read(raw, "Impressions")) ?? 0,
    topSearchShare: toNumber(read(raw, "Top-of-search Impression Share")),
    clicks: toNumber(read(raw, "Clicks")) ?? 0,
    ctr: toNumber(read(raw, "Click-Thru Rate (CTR)")),
    cpc: toNumber(read(raw, "Cost Per Click (CPC)")),
    spend: toNumber(read(raw, "Spend")) ?? 0,
    acos: toNumber(read(raw, "Total Advertising Cost of Sales (ACOS)")),
    roas: toNumber(read(raw, "Total Return on Advertising Spend (ROAS)")),
    // SP reports use 7-day attribution; SB reports use 14-day. Fall back so
    // the same normalizer serves both (SP files never hit the 14-day branch).
    sales:
      toNumber(read(raw, "7 Day Total Sales")) ??
      toNumber(read(raw, "14 Day Total Sales")) ??
      0,
    orders:
      toNumber(read(raw, "7 Day Total Orders (#)")) ??
      toNumber(read(raw, "14 Day Total Orders (#)")) ??
      0,
    units:
      toNumber(read(raw, "7 Day Total Units (#)")) ??
      toNumber(read(raw, "14 Day Total Units (#)")) ??
      0,
    cvr:
      toNumber(read(raw, "7 Day Conversion Rate")) ??
      toNumber(read(raw, "14 Day Conversion Rate")),
    exactKey,
    canonicalKey,
    noMatchTypeKey,
  };
}

function aggregateTargeting(rows: TargetingRow[]): PerformanceAggregate[] {
  const groups = new Map<string, TargetingRow[]>();
  rows.forEach((row) => {
    const key = makeKey(
      row.campaign,
      row.adGroup,
      row.targeting,
      row.matchType,
    );
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });

  return [...groups.values()].map((items) => {
    const first = items[0];
    const dateTimes = items
      .map((item) => item.date?.getTime())
      .filter((value): value is number => Number.isFinite(value));
    const uniqueDays = new Set(
      dateTimes.map((time) => new Date(time).toISOString().slice(0, 10)),
    ).size;
    const impressions = sum(items, "impressions");
    const clicks = sum(items, "clicks");
    const spend = sum(items, "spend");
    const sales = sum(items, "sales");
    const orders = sum(items, "orders");
    const units = sum(items, "units");

    return {
      campaign: first.campaign,
      adGroup: first.adGroup,
      targeting: first.targeting,
      matchType: first.matchType,
      firstDate: dateTimes.length ? new Date(Math.min(...dateTimes)) : null,
      lastDate: dateTimes.length ? new Date(Math.max(...dateTimes)) : null,
      days: uniqueDays,
      impressions,
      clicks,
      spend,
      sales,
      orders,
      units,
      cpc: clicks > 0 ? spend / clicks : null,
      ctr: impressions > 0 ? clicks / impressions : null,
      cvr: clicks > 0 ? orders / clicks : null,
      acos: sales > 0 ? spend / sales : null,
      roas: spend > 0 ? sales / spend : null,
      exactKey: first.exactKey,
      canonicalKey: first.canonicalKey,
      noMatchTypeKey: first.noMatchTypeKey,
      dailyRows: items,
    };
  });
}

interface HistoryIndexes {
  exact: Map<string, HistoryRow[]>;
  canonical: Map<string, HistoryRow[]>;
  noMatchType: Map<string, HistoryRow[]>;
}

function buildHistoryIndexes(rows: HistoryRow[]): HistoryIndexes {
  return {
    exact: groupHistory(rows, (row) => row.exactKey),
    canonical: groupHistory(rows, (row) => row.canonicalKey),
    noMatchType: groupHistory(rows, (row) => row.noMatchTypeKey),
  };
}

/**
 * Rolling 7-day-per-date verdict timeline.
 * For every calendar date present in `dailyRows`, computes the rolling-7 KPI value,
 * checks whether a bid change happened in that window, and produces a per-KPI verdict.
 * Direction-only — magnitude of the bid change is ignored.
 */
function buildTimeline(
  dailyRows: TargetingRow[],
  allBidChanges: HistoryRow[],
  kpis: KpiThreshold[],
): TimelineEntry[] {
  if (kpis.length === 0) return [];
  const byDate = new Map<
    string,
    {
      spend: number;
      sales: number;
      clicks: number;
      orders: number;
      impressions: number;
    }
  >();
  for (const dr of dailyRows) {
    if (!dr.date) continue;
    const key = dr.date.toISOString().slice(0, 10);
    const ex = byDate.get(key);
    if (ex) {
      ex.spend += dr.spend;
      ex.sales += dr.sales;
      ex.clicks += dr.clicks;
      ex.orders += dr.orders;
      ex.impressions += dr.impressions;
    } else {
      byDate.set(key, {
        spend: dr.spend,
        sales: dr.sales,
        clicks: dr.clicks,
        orders: dr.orders,
        impressions: dr.impressions,
      });
    }
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) return [];

  const out: TimelineEntry[] = [];
  for (let i = 0; i < dates.length; i++) {
    const dateKey = dates[i];
    const windowStartIdx = Math.max(0, i - 6);
    const windowDates = dates.slice(windowStartIdx, i + 1);
    // Require a complete 7-day window when enough data exists, otherwise use all
    if (windowDates.length < 7 && dates.length >= 7) continue;

    let spend = 0,
      sales = 0,
      clicks = 0,
      orders = 0,
      impressions = 0;
    for (const wd of windowDates) {
      const d = byDate.get(wd)!;
      spend += d.spend;
      sales += d.sales;
      clicks += d.clicks;
      orders += d.orders;
      impressions += d.impressions;
    }

    const startDate = windowDates[0];
    const endDate = dateKey;

    const windowBidChanges = allBidChanges.filter((h) => {
      if (!h.time) return false;
      const k = h.time.toISOString().slice(0, 10);
      return k >= startDate && k <= endDate;
    });

    let bidDirection: "increased" | "reduced" | null = null;
    let bidChange: TimelineKpiVerdict["bidChange"] = null;
    if (windowBidChanges.length > 0) {
      const last = windowBidChanges[windowBidChanges.length - 1];
      if (last.bidChangePct != null) {
        if (last.bidChangePct > 0) bidDirection = "increased";
        else if (last.bidChangePct < 0) bidDirection = "reduced";
      }
      bidChange = {
        fromBid: last.fromBid,
        toBid: last.toBid,
        changePct: last.bidChangePct,
        extraChanges: windowBidChanges.length - 1,
      };
    }

    const hasActivity =
      spend > 0 || clicks > 0 || impressions > 0 || orders > 0;

    const perKpi: TimelineKpiVerdict[] = kpis.map((kt) => {
      let value: number | null;
      let zeroSalesWithSpend = false;
      let noActivity = false;
      switch (kt.kpi) {
        case "acos":
          if (sales > 0) value = spend / sales;
          else if (spend > 0) {
            value = null;
            zeroSalesWithSpend = true;
          } else {
            value = null;
            noActivity = true;
          }
          break;
        case "cvr":
          if (clicks > 0) value = orders / clicks;
          else {
            value = null;
            noActivity = !hasActivity;
            zeroSalesWithSpend = hasActivity;
          }
          break;
        case "ctr":
          if (impressions > 0) value = clicks / impressions;
          else {
            value = null;
            noActivity = !hasActivity;
            zeroSalesWithSpend = hasActivity;
          }
          break;
        case "roas":
          if (spend > 0) value = sales / spend;
          else {
            value = null;
            noActivity = !hasActivity;
          }
          break;
        case "spend":
          // Spend is always defined (>=0). Never null.
          value = spend;
          if (!hasActivity) noActivity = true;
          break;
        default:
          value = null;
      }

      let worseThanThreshold: boolean | null = null;
      if (value != null) {
        worseThanThreshold =
          kt.direction === "lower"
            ? value > kt.threshold
            : value < kt.threshold;
      } else if (zeroSalesWithSpend) {
        // Spending without return = worse than threshold by intent.
        worseThanThreshold = true;
      }

      let verdict: TimelineKpiVerdict["verdict"];
      if (noActivity) {
        verdict = "no_activity";
      } else if (worseThanThreshold == null) {
        verdict = "no_data";
      } else if (worseThanThreshold) {
        if (bidDirection === null) verdict = "not_reduced";
        else if (bidDirection === "reduced") verdict = "acted_correctly";
        else verdict = "wrong_direction";
      } else {
        if (bidDirection === null) verdict = "not_increased";
        else if (bidDirection === "increased") verdict = "acted_correctly";
        else verdict = "wrong_direction";
      }

      return {
        kpi: kt.kpi,
        rolling7Value: value,
        threshold: kt.threshold,
        worseThanThreshold,
        bidDirection,
        bidChange,
        zeroSalesWithSpend,
        noActivity,
        verdict,
      };
    });

    out.push({ date: dateKey, perKpi });
  }

  return out;
}

function buildAuditRow(
  aggregate: PerformanceAggregate,
  indexes: HistoryIndexes,
  thresholds: Thresholds,
  bulk: BulkIndex | null = null,
  campaignsWithHistory: Set<string> = new Set(),
): AuditRow {
  const matched = findHistoryMatch(aggregate, indexes);
  const historyRows = matched.rows;
  const unmatchedReason: UnmatchedReason | null =
    matched.level !== "Unmatched"
      ? null
      : campaignsWithHistory.has(aggregate.campaign)
        ? "no_bid_change_in_window"
        : "name_mismatch";
  const latestHistory = latest(historyRows);
  const allBidChanges = historyRows
    .slice()
    .sort((a, b) => (a.time?.getTime() ?? 0) - (b.time?.getTime() ?? 0));
  const currentBid = bulkBidFor(aggregate, bulk);
  const bulkConfirmed = currentBid !== null;
  const bidChanges = historyRows.length;
  const previousBid = latestHistory?.fromBid ?? null;
  const latestBid = latestHistory?.toBid ?? null;
  const bidChangePct = latestHistory?.bidChangePct ?? null;
  const lastBidChangeDate = latestHistory?.time ?? null;
  // Direction-only — magnitude of the bid change is irrelevant per simplified spec.
  const lastIncrease = bidChangePct !== null && bidChangePct > 0;
  const lastDecrease = bidChangePct !== null && bidChangePct < 0;
  const profitable = isProfitable(aggregate, thresholds);
  const wasteful = isWasteful(aggregate, thresholds);
  const enoughData = hasEnoughData(aggregate, thresholds);
  // Over-managed: more than 1 bid change on any single calendar day. That's it.
  const tooManyBidChanges = (() => {
    if (allBidChanges.length < 2) return false;
    const byDay = new Map<string, number>();
    for (const h of allBidChanges) {
      if (!h.time) continue;
      const day = h.time.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      if ((byDay.get(day) ?? 0) > 1) return true;
    }
    return false;
  })();
  const impact = calculateBeforeAfter(aggregate, latestHistory, thresholds);
  const secondaryTags: Category[] = [];

  if (tooManyBidChanges) secondaryTags.push("Too Many Bid Changes");
  if (profitable && !lastIncrease) secondaryTags.push("Winners Not Scaled");
  if (wasteful && !lastDecrease) secondaryTags.push("Losers Not Reduced");
  if (profitable && lastDecrease)
    secondaryTags.push("Profitable Terms Reduced");
  if (wasteful && lastIncrease)
    secondaryTags.push("Unprofitable Terms Increased");
  if (!enoughData) secondaryTags.push("Needs More Data");

  const decision = decide({
    aggregate,
    thresholds,
    matchLevel: matched.level,
    profitable,
    wasteful,
    enoughData,
    tooManyBidChanges,
    lastIncrease,
    lastDecrease,
    bidChanges,
    bidChangePct,
    impact,
  });

  const explain = buildExplain({
    row: aggregate,
    thresholds,
    category: decision.category,
    recommendation: decision.recommendation,
    priority: decision.priority,
    confidence: decision.confidence,
    matchLevel: matched.level,
    enoughData,
    bidChanges,
    bidChangePct,
    previousBid,
    latestBid,
    impact,
  });

  const explainWithBid =
    currentBid !== null
      ? {
          ...explain,
          rule: `${explain.rule}  ·  Current bid (from Bulk file): ${money(currentBid)}.`,
        }
      : explain;

  const timeline = buildTimeline(
    aggregate.dailyRows,
    allBidChanges,
    thresholds.kpis ?? [],
  );

  return {
    ...aggregate,
    matchLevel: matched.level,
    unmatchedReason,
    latestHistory,
    allBidChanges,
    timeline,
    bidChanges,
    previousBid,
    latestBid,
    currentBid,
    bulkConfirmed,
    bidChangePct,
    lastBidChangeDate,
    category: decision.category,
    secondaryTags: [
      ...new Set(secondaryTags.filter((tag) => tag !== decision.category)),
    ],
    recommendation: decision.recommendation,
    priority: decision.priority,
    confidence: decision.confidence,
    reason: explainWithBid.reason,
    explain: explainWithBid,
    priorityScore: decision.priorityScore,
    impact,
  };
}

function findHistoryMatch(
  aggregate: PerformanceAggregate,
  indexes: HistoryIndexes,
): { level: MatchLevel; rows: HistoryRow[] } {
  const exact = indexes.exact.get(aggregate.exactKey);
  if (exact?.length) return { level: "High exact", rows: exact };
  const canonical = indexes.canonical.get(aggregate.canonicalKey);
  if (canonical?.length) return { level: "High canonical", rows: canonical };
  const noMatchType = indexes.noMatchType.get(aggregate.noMatchTypeKey);
  if (noMatchType?.length)
    return { level: "Medium no-match-type", rows: noMatchType };
  return { level: "Unmatched", rows: [] };
}

function decide(input: {
  aggregate: PerformanceAggregate;
  thresholds: Thresholds;
  matchLevel: MatchLevel;
  profitable: boolean;
  wasteful: boolean;
  enoughData: boolean;
  tooManyBidChanges: boolean;
  lastIncrease: boolean;
  lastDecrease: boolean;
  bidChanges: number;
  bidChangePct: number | null;
  impact: BeforeAfterImpact;
}): {
  category: Category;
  recommendation: Recommendation;
  priority: Priority;
  confidence: AuditRow["confidence"];
  reason: string;
  priorityScore: number;
} {
  const row = input.aggregate;
  const score = priorityScore(row, input);
  const priority = priorityFromScore(score, input);
  const confidence = confidenceFor(
    input.matchLevel,
    input.enoughData,
    input.impact,
  );
  const acosText =
    row.acos === null ? "no sales" : `${(row.acos * 100).toFixed(1)}% ACoS`;

  if (input.matchLevel === "Unmatched" && input.enoughData) {
    return {
      category: "No Action Despite Enough Data",
      recommendation: "Review match",
      priority,
      confidence: "Review Only",
      priorityScore: score,
      reason: `This target has enough activity (${row.clicks} clicks, $${row.spend.toFixed(2)} spend), but no matched bid-change history was found.`,
    };
  }

  if (!input.enoughData) {
    return {
      category: "Needs More Data",
      recommendation: "Collect more data",
      priority: "Watch",
      confidence,
      priorityScore: score,
      reason: `This target does not yet have enough clicks, spend, or orders for a reliable bid decision.`,
    };
  }

  if (input.wasteful && input.lastIncrease) {
    return {
      category: "Unprofitable Terms Increased",
      recommendation:
        input.thresholds.mode === "Aggressive"
          ? "Pause / review"
          : "Reduce bid",
      priority,
      confidence,
      priorityScore: score,
      reason: `Bid was increased even though this target has ${acosText} with $${row.spend.toFixed(2)} spend.`,
    };
  }

  if (input.profitable && input.lastDecrease) {
    return {
      category: "Profitable Terms Reduced",
      recommendation: "Increase bid",
      priority,
      confidence,
      priorityScore: score,
      reason: `Bid was reduced even though this target produced $${row.sales.toFixed(2)} sales at ${acosText}.`,
    };
  }

  if (input.wasteful && !input.lastDecrease) {
    return {
      category: "Losers Not Reduced",
      recommendation:
        input.thresholds.mode === "Aggressive" && row.orders === 0
          ? "Pause / review"
          : "Reduce bid",
      priority,
      confidence,
      priorityScore: score,
      reason:
        row.orders === 0
          ? `This target spent $${row.spend.toFixed(2)} with 0 orders and the latest bid change was not a reduction.`
          : `This target has ${acosText}, above the waste threshold, and the latest bid change was not a reduction.`,
    };
  }

  if (input.profitable && !input.lastIncrease) {
    return {
      category: "Winners Not Scaled",
      recommendation: "Increase bid",
      priority,
      confidence,
      priorityScore: score,
      reason: `This target has ${acosText} with ${row.orders} orders, but the latest bid change was not an increase.`,
    };
  }

  if (input.tooManyBidChanges) {
    return {
      category: "Too Many Bid Changes",
      recommendation: "Hold",
      priority: priority === "Critical" ? "High" : priority,
      confidence,
      priorityScore: score,
      reason: `This target had ${input.bidChanges} bid changes in the selected window, so wait for cleaner post-change data before another move.`,
    };
  }

  if (
    (input.profitable && input.lastIncrease) ||
    (input.wasteful && input.lastDecrease)
  ) {
    return {
      category: "Correctly Managed",
      recommendation: "Hold",
      priority: "Low",
      confidence,
      priorityScore: score,
      reason: `The latest bid direction appears aligned with performance.`,
    };
  }

  return {
    category: "Monitor",
    recommendation: "Hold",
    priority: "Low",
    confidence,
    priorityScore: score,
    reason: `Performance is not an obvious winner or loser against the current thresholds.`,
  };
}

// ---------------------------------------------------------------------------
// Plain-English explanation engine. Every audited target gets a reason, the
// exact rule + numbers behind it, and why the action / priority / confidence.
// This is the single source of truth for the in-app "How decisions are made".
// ---------------------------------------------------------------------------

function money(n: number | null | undefined) {
  return n === null || n === undefined || !Number.isFinite(n)
    ? "$0.00"
    : `$${n.toFixed(2)}`;
}
function pctText(n: number | null | undefined) {
  return n === null || n === undefined || !Number.isFinite(n)
    ? "no sales"
    : `${(n * 100).toFixed(1)}%`;
}

/** Plain-language guide for every category, with the user's thresholds filled in. */
function categoryGuide(t: Thresholds): Record<Category, MethodologyEntry> {
  const tA = `${Math.round(t.targetAcos * 100)}%`;
  return {
    "Winners Not Scaled": {
      category: "Winners Not Scaled",
      title: "Winners not scaled",
      plain:
        "A profitable target you are not pushing — the bid was not raised.",
      howDecided: `Profitable (ACoS ≤ target ${tA}, sales ≥ ${money(t.minSales)}, orders ≥ ${t.minOrders}) AND the most recent bid change was not an increase. Direction only — magnitude is ignored.`,
      whyItMatters:
        "These already make money. Not bidding them up leaves easy sales on the table.",
      action: "Raise the bid in small steps and watch ACoS.",
    },
    "Losers Not Reduced": {
      category: "Losers Not Reduced",
      title: "Waste not reduced",
      plain: "A money-losing target that was not cut — spend keeps leaking.",
      howDecided: `Wasteful (spend ≥ ${money(t.minSpend)} with 0 orders, OR spend ≥ ${money(t.minSpend)} and ACoS > target ${tA}) AND the most recent bid change was not a decrease. Direction only — magnitude is ignored.`,
      whyItMatters: "This is spend with little or no return — pure leakage.",
      action: "Lower the bid (or pause/review if there are zero orders).",
    },
    "Profitable Terms Reduced": {
      category: "Profitable Terms Reduced",
      title: "Profitable target was cut",
      plain: "A target that was making money but the bid was reduced anyway.",
      howDecided: `Profitable by the rule above, BUT the most recent bid change was a decrease (any %).`,
      whyItMatters: "Cutting a winner usually loses sales for no good reason.",
      action: "Review the cut — likely raise the bid back up.",
    },
    "Unprofitable Terms Increased": {
      category: "Unprofitable Terms Increased",
      title: "Money-loser was bid up",
      plain: "A target that was losing money but the bid was increased anyway.",
      howDecided: `Wasteful by the rule above, BUT the most recent bid change was an increase (any %).`,
      whyItMatters: "Bidding up a loser accelerates wasted spend.",
      action: "Reduce the bid (or pause/review).",
    },
    "No Action Despite Enough Data": {
      category: "No Action Despite Enough Data",
      title: "Enough data, but no matched history",
      plain:
        "This target had enough activity to judge, but we could not find its bid-change history in the file.",
      howDecided: `Enough activity (clicks ≥ ${t.minClicks}, or spend ≥ ${money(t.minSpend)}, or orders ≥ ${t.minOrders}) but no matching bid-change row was found for it in the uploaded History window.`,
      whyItMatters:
        "It may have had no bid change, or names differ between the two files. A Bulk file fixes this.",
      action: "Check the names, or upload a Bulk Operations file.",
    },
    "Too Many Bid Changes": {
      category: "Too Many Bid Changes",
      title: "Over-managed",
      plain:
        "The bid on this target was changed so often that no change had time to prove itself.",
      howDecided: `More than 1 bid change happened on the same calendar day.`,
      whyItMatters:
        "Constant tweaking stops Amazon learning and makes results impossible to read.",
      action:
        "Hold — wait for about a week of clean data before moving it again.",
    },
    "Needs More Data": {
      category: "Needs More Data",
      title: "Not enough data yet",
      plain: "Too little activity to make a safe bid decision.",
      howDecided: `Below every action threshold (clicks < ${t.minClicks} and spend < ${money(t.minSpend)} and orders < ${t.minOrders}).`,
      whyItMatters: "Acting on tiny samples is guessing, not optimizing.",
      action: "Collect more data before changing the bid.",
    },
    "Correctly Managed": {
      category: "Correctly Managed",
      title: "Managed correctly",
      plain: "The last bid move matched performance.",
      howDecided: `Profitable AND the latest bid change was an increase (any %), OR wasteful AND the latest bid change was a decrease (any %). Direction only — magnitude is ignored.`,
      whyItMatters: "Confirms good decisions so you can focus on the problems.",
      action: "Hold — keep doing this.",
    },
    Monitor: {
      category: "Monitor",
      title: "Stable — just monitor",
      plain: "Not a clear winner or loser right now.",
      howDecided: `Has enough data but does not meet the profitable or wasteful rules; performance is middling/stable.`,
      whyItMatters: "Nothing urgent — watch in case it drifts.",
      action: "Hold and keep an eye on it.",
    },
  };
}

export function getMethodology(t: Thresholds): Methodology {
  const guide = categoryGuide(t);
  return {
    categories: [
      "Winners Not Scaled",
      "Losers Not Reduced",
      "Profitable Terms Reduced",
      "Unprofitable Terms Increased",
      "Too Many Bid Changes",
      "No Action Despite Enough Data",
      "Needs More Data",
      "Correctly Managed",
      "Monitor",
    ].map((c) => guide[c as Category]),
    score: `Decision Score = (targets managed well ÷ targets we could grade) × 100. We only grade targets that matched bid history AND had enough data. Unmatched or thin-data targets are set aside, not counted, so the score reflects real decision quality — not file gaps.`,
    priority: `Priority ranks what to fix first by money at stake (spend + sales), data strength, and how wrong the bid move was. Critical = big money + clear problem; High = important; Medium = worth doing; Low/Watch = minor or not enough data.`,
    confidence: `High = strong name match and a full 7-day before/after window. Medium = matched but without match type, or an incomplete before/after window. Low = thin data. Review Only = no bid-history match, so it is shown for review, never as a confirmed mistake.`,
    limitations: [
      "If a target had no bid change inside the uploaded History window, it has no history row — so its current bid is unknown from this file alone. A Bulk Operations file lists every target's current bid and fixes this.",
      "The Sponsored Products Targeting report has no campaign / ad-group / target IDs, so matching relies on names. Renames or structure differences cause some misses. A Bulk file (with IDs) raises the match rate.",
      "Sponsored Brands rows are isolated unless an SB performance report is uploaded — they form a separate audit and do not change the SP match rate.",
      "For tighter profit calls, upload a per-campaign target-ACoS map (Box 5). Without it the tool uses one global target ACoS for every campaign.",
    ],
  };
}

interface ExplainInput {
  row: PerformanceAggregate;
  thresholds: Thresholds;
  category: Category;
  recommendation: Recommendation;
  priority: Priority;
  confidence: AuditRow["confidence"];
  matchLevel: MatchLevel;
  enoughData: boolean;
  bidChanges: number;
  bidChangePct: number | null;
  previousBid: number | null;
  latestBid: number | null;
  impact: BeforeAfterImpact;
}

function targetLabel(row: PerformanceAggregate) {
  const mt =
    row.matchType && row.matchType !== "-" ? ` (${row.matchType})` : "";
  const suffix =
    row.adGroup && row.adGroup !== row.campaign ? ` › ${row.adGroup}` : "";
  return `"${row.targeting}"${mt} in ${row.campaign}${suffix}`;
}

function buildExplain(input: ExplainInput): RowExplain {
  const { row, category } = input;
  const guide = categoryGuide(input.thresholds)[category];
  const acos = pctText(row.acos);
  const label = targetLabel(row);
  const move =
    input.bidChangePct === null
      ? "no recorded bid change"
      : `last bid move ${input.bidChangePct >= 0 ? "+" : ""}${(input.bidChangePct * 100).toFixed(0)}% (${money(input.previousBid)} → ${money(input.latestBid)})`;

  const reasonByCategory: Record<Category, string> = {
    "Winners Not Scaled": `${label} makes money — ${row.orders} orders, ${money(row.sales)} sales at ${acos} ACoS — but the latest bid change was not an increase. You are likely leaving sales on the table.`,
    "Losers Not Reduced":
      row.orders === 0
        ? `${label} spent ${money(row.spend)} with 0 orders and the bid was not cut — that is pure wasted spend.`
        : `${label} is wasteful at ${acos} ACoS on ${money(row.spend)} spend and the bid was not cut.`,
    "Profitable Terms Reduced": `${label} was profitable (${money(row.sales)} sales, ${acos} ACoS) yet the bid was reduced (${move}). That likely loses sales for no reason.`,
    "Unprofitable Terms Increased": `${label} is losing money (${acos} ACoS, ${money(row.spend)} spend) yet the bid was increased (${move}). That speeds up the waste.`,
    "No Action Despite Enough Data": `${label} had enough activity (${row.clicks} clicks, ${money(row.spend)} spend) but we could not find its bid-change history in the uploaded file — so we can't say if the bid was right.`,
    "Too Many Bid Changes": `${label} had more than 1 bid change on the same calendar day. No change had time to prove itself, so the data is noisy.`,
    "Needs More Data": `${label} only has ${row.clicks} clicks and ${money(row.spend)} spend — not enough to safely change the bid yet.`,
    "Correctly Managed": `${label} was handled correctly: the ${move} matched its performance (${acos} ACoS).`,
    Monitor: `${label} is stable — not a clear winner or loser at the moment (${acos} ACoS, ${money(row.spend)} spend). Nothing urgent.`,
  };

  const whyActionMap: Record<Recommendation, string> = {
    "Increase bid":
      "Raise the bid: it is profitable with room to win more clicks/sales.",
    "Reduce bid": "Lower the bid: it is spending without enough return.",
    "Pause / review": "Stop or hand-check it: high spend with no/poor return.",
    Hold:
      category === "Too Many Bid Changes"
        ? "Leave it alone for now: it was changed too recently/often — wait for clean data."
        : "Leave the bid as is: it is either already correct or stable.",
    "Collect more data":
      "Do not change the bid yet: there is not enough clicks/spend/orders to decide safely.",
    "Review match":
      "We could not match this target to bid history — check names or add a Bulk file before acting.",
  };

  const rule = `Rule: ${guide.howDecided}  ·  This target — ACoS ${acos}, sales ${money(row.sales)}, orders ${row.orders}, spend ${money(row.spend)}, clicks ${row.clicks}, bid changes ${input.bidChanges}, ${move}.`;

  const moneyAtStake = money(row.spend + row.sales);
  const whyPriority =
    input.priority === "Watch"
      ? "Priority is Watch because there is not enough data to act confidently."
      : `Priority is ${input.priority}: ranked by money at stake (spend ${money(row.spend)} + sales ${money(row.sales)} = ${moneyAtStake}) and how clearly the rule was broken. More money + a clearer problem ⇒ higher priority.`;

  let whyConfidence: string;
  if (input.matchLevel === "Unmatched")
    whyConfidence =
      "Confidence: Review Only — no bid-history match, so this is shown for review, not as a confirmed mistake.";
  else if (!input.enoughData)
    whyConfidence = "Confidence: Low — not enough data to be sure.";
  else if (input.matchLevel === "Medium no-match-type")
    whyConfidence =
      "Confidence: Medium — matched by name but without match type, so treat as review-level.";
  else if (input.impact.status === "Full window")
    whyConfidence =
      "Confidence: High — strong name match and a full 7-day before/after window.";
  else
    whyConfidence =
      "Confidence: Medium — matched well, but the before/after window is incomplete.";

  return {
    reason: reasonByCategory[category],
    rule,
    whyAction: whyActionMap[input.recommendation],
    whyPriority,
    whyConfidence,
  };
}

function calculateBeforeAfter(
  aggregate: PerformanceAggregate,
  history: HistoryRow | null | undefined,
  thresholds: Thresholds,
): BeforeAfterImpact {
  if (!history?.time) {
    return emptyImpact("No bid change", "Not enough data");
  }

  const changeDate = startOfDay(history.time);
  const preStart = addDays(changeDate, -thresholds.lookbackDays);
  const preEnd = addDays(changeDate, -1);
  const postStart = addDays(changeDate, thresholds.attributionDelayDays);
  const postEnd = addDays(postStart, thresholds.lookbackDays - 1);

  const preRows = aggregate.dailyRows.filter(
    (row) => row.date && row.date >= preStart && row.date <= preEnd,
  );
  const postRows = aggregate.dailyRows.filter(
    (row) => row.date && row.date >= postStart && row.date <= postEnd,
  );
  const pre = summarizeDaily(preRows);
  const post = summarizeDaily(postRows);
  const full =
    pre.days >= Math.min(3, thresholds.lookbackDays) &&
    post.days >= Math.min(3, thresholds.lookbackDays);
  let label: BeforeAfterImpact["label"] = "Not enough data";

  if (full && pre.spend > 0 && post.spend > 0) {
    const acosImproved =
      pre.acos !== null && post.acos !== null && post.acos < pre.acos * 0.95;
    const salesImproved = post.sales > pre.sales * 1.05;
    const acosWorse =
      pre.acos !== null && post.acos !== null && post.acos > pre.acos * 1.1;
    if (acosImproved || salesImproved) label = "Helped";
    else if (acosWorse && post.sales <= pre.sales * 1.05) label = "Hurt";
    else label = "Inconclusive";
  }

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    status: full ? "Full window" : "Incomplete window",
    label,
    preSpend: pre.spend,
    postSpend: post.spend,
    preSales: pre.sales,
    postSales: post.sales,
    preOrders: pre.orders,
    postOrders: post.orders,
    preAcos: pre.acos,
    postAcos: post.acos,
    preDays: pre.days,
    postDays: post.days,
    changeDateIso: iso(changeDate),
    preStartIso: iso(preStart),
    preEndIso: iso(preEnd),
    postStartIso: iso(postStart),
    postEndIso: iso(postEnd),
  };
}

function summarizeDaily(rows: TargetingRow[]) {
  const spend = sum(rows, "spend");
  const sales = sum(rows, "sales");
  const orders = sum(rows, "orders");
  const days = new Set(
    rows.map((row) => row.date?.toISOString().slice(0, 10)).filter(Boolean),
  ).size;
  return {
    spend,
    sales,
    orders,
    acos: sales > 0 ? spend / sales : null,
    days,
  };
}

function summarize(
  auditRows: AuditRow[],
  history: HistoryRow[],
  spHistory: HistoryRow[],
  sbHistory: HistoryRow[],
  targeting: TargetingRow[],
) {
  const matchedTargets = auditRows.filter(
    (row) => row.matchLevel !== "Unmatched",
  ).length;
  const hasTag = (row: AuditRow, category: Category) =>
    row.category === category || row.secondaryTags.includes(category);
  const ISSUE_CATS: Category[] = [
    "Winners Not Scaled",
    "Losers Not Reduced",
    "Profitable Terms Reduced",
    "Unprofitable Terms Increased",
    "Too Many Bid Changes",
  ];
  const SET_ASIDE: Category[] = [
    "Needs More Data",
    "No Action Despite Enough Data",
  ];
  // We only grade targets we can actually judge: matched to bid history AND
  // enough data. Unmatched / thin-data targets are set aside, not counted, so
  // the score reflects real decision quality instead of file gaps.
  const judgedRows = auditRows.filter(
    (row) =>
      row.matchLevel !== "Unmatched" && !SET_ASIDE.includes(row.category),
  );
  const judged = judgedRows.length;
  const issuesJudged = judgedRows.filter((row) =>
    ISSUE_CATS.includes(row.category),
  ).length;
  const goodJudged = judged - issuesJudged;
  const setAside = auditRows.length - judged;
  const decisionScore =
    judged === 0 ? 0 : Math.round((goodJudged / judged) * 100);
  const scoreBreakdown = {
    judged,
    good: goodJudged,
    issues: issuesJudged,
    setAside,
    formula: `${goodJudged.toLocaleString("en-US")} of ${judged.toLocaleString("en-US")} gradeable targets look correctly managed → ${decisionScore}/100. ${setAside.toLocaleString("en-US")} targets were set aside (no bid-history match or not enough data) and were not graded.`,
  };

  return {
    totalTargets: auditRows.length,
    matchedTargets,
    unmatchedTargets: auditRows.length - matchedTargets,
    highExact: auditRows.filter((row) => row.matchLevel === "High exact")
      .length,
    highCanonical: auditRows.filter(
      (row) => row.matchLevel === "High canonical",
    ).length,
    mediumMatch: auditRows.filter(
      (row) => row.matchLevel === "Medium no-match-type",
    ).length,
    historyRows: history.length,
    spHistoryRows: spHistory.length,
    sbHistoryRows: sbHistory.length,
    performanceRows: targeting.length,
    winnersNotScaled: auditRows.filter((row) =>
      hasTag(row, "Winners Not Scaled"),
    ).length,
    losersNotReduced: auditRows.filter((row) =>
      hasTag(row, "Losers Not Reduced"),
    ).length,
    wrongIncreases: auditRows.filter(
      (row) => row.category === "Unprofitable Terms Increased",
    ).length,
    wrongReductions: auditRows.filter(
      (row) => row.category === "Profitable Terms Reduced",
    ).length,
    needsMoreData: auditRows.filter((row) => row.category === "Needs More Data")
      .length,
    tooManyBidChanges: auditRows.filter(
      (row) =>
        row.category === "Too Many Bid Changes" ||
        row.secondaryTags.includes("Too Many Bid Changes"),
    ).length,
    estimatedWastedSpend: auditRows
      .filter(
        (row) =>
          hasTag(row, "Losers Not Reduced") ||
          row.category === "Unprofitable Terms Increased",
      )
      .reduce((total, row) => total + row.spend, 0),
    estimatedMissedSales: auditRows
      .filter(
        (row) =>
          hasTag(row, "Winners Not Scaled") ||
          row.category === "Profitable Terms Reduced",
      )
      .reduce((total, row) => total + row.sales, 0),
    decisionScore,
    scoreBreakdown,
  };
}

function summarizeBy(
  rows: AuditRow[],
  getKey: (row: AuditRow) => string,
): CampaignSummary[] {
  const groups = new Map<string, AuditRow[]>();
  rows.forEach((row) => {
    const key = getKey(row) || "Unknown";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });

  return [...groups.entries()]
    .map(([campaign, items]) => {
      const spend = sum(items, "spend");
      const sales = sum(items, "sales");
      const issueCount = items.filter(
        (row) => row.priority !== "Low" && row.priority !== "Watch",
      ).length;
      return {
        campaign,
        spend,
        sales,
        orders: sum(items, "orders"),
        acos: sales > 0 ? spend / sales : null,
        targets: items.length,
        issueCount,
        winnersNotScaled: items.filter(
          (row) => row.category === "Winners Not Scaled",
        ).length,
        losersNotReduced: items.filter(
          (row) => row.category === "Losers Not Reduced",
        ).length,
        wrongBidChanges: items.filter(
          (row) =>
            row.category === "Profitable Terms Reduced" ||
            row.category === "Unprofitable Terms Increased",
        ).length,
        tooManyBidChanges: items.filter(
          (row) =>
            row.category === "Too Many Bid Changes" ||
            row.secondaryTags.includes("Too Many Bid Changes"),
        ).length,
        needsMoreData: items.filter((row) => row.category === "Needs More Data")
          .length,
        unmatched: items.filter((row) => row.matchLevel === "Unmatched").length,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

function makeChartData(
  auditRows: AuditRow[],
  campaignSummary: CampaignSummary[],
) {
  return {
    priorityBreakdown: bucketCounts(auditRows, (row) => row.priority),
    categoryBreakdown: bucketCounts(auditRows, (row) => row.category),
    scatter: auditRows
      .filter(
        (row) =>
          row.acos !== null && row.bidChangePct !== null && row.spend > 0,
      )
      .slice()
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 250)
      .map((row) => ({
        name: row.targeting,
        acos: row.acos ?? 0,
        bidChange: row.bidChangePct ?? 0,
        spend: row.spend,
        category: row.category,
      })),
    spendSales: auditRows
      .filter((row) => row.spend > 0 || row.sales > 0)
      .slice()
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 250)
      .map((row) => ({
        name: row.targeting,
        spend: row.spend,
        sales: row.sales,
        category: row.category,
      })),
    campaignHeatmap: campaignSummary.slice(0, 18),
    beforeAfter: auditRows
      .filter((row) => row.impact.status !== "No bid change")
      .slice()
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 14)
      .map((row) => ({
        name: truncate(row.targeting, 28),
        preAcos: row.impact.preAcos,
        postAcos: row.impact.postAcos,
        preSales: row.impact.preSales,
        postSales: row.impact.postSales,
      })),
  };
}

function getUnmatchedHistoryRows(
  spHistory: HistoryRow[],
  auditRows: AuditRow[],
) {
  const matchedKeys = new Set(
    auditRows.flatMap((row) => [
      row.exactKey,
      row.canonicalKey,
      row.noMatchTypeKey,
    ]),
  );
  return spHistory.filter(
    (row) =>
      !matchedKeys.has(row.exactKey) &&
      !matchedKeys.has(row.canonicalKey) &&
      !matchedKeys.has(row.noMatchTypeKey),
  );
}

function makeHistoryStatus(fileName: string, rows: HistoryRow[]): FileStatus {
  const times = rows
    .map((row) => row.time?.getTime())
    .filter((value): value is number => Number.isFinite(value));
  const columns = rows[0] ? Object.keys(rows[0].raw) : [];
  const sp = rows.filter((row) => row.programType === "SP").length;
  const sb = rows.filter((row) => row.programType === "SB").length;
  return {
    fileName,
    rowCount: rows.length,
    dateRange: times.length
      ? `${new Date(Math.min(...times)).toISOString().slice(0, 10)} to ${new Date(Math.max(...times)).toISOString().slice(0, 10)}`
      : "-",
    reportType: `History bid changes (${sp.toLocaleString()} SP, ${sb.toLocaleString()} SB)`,
    warnings: sb
      ? [
          `${sb.toLocaleString()} SB rows isolated until an SB performance report is uploaded.`,
        ]
      : [],
    columns,
  };
}

function makeTargetingStatus(
  fileName: string,
  rows: TargetingRow[],
  aggregates: PerformanceAggregate[],
): FileStatus {
  const times = rows
    .map((row) => row.date?.getTime())
    .filter((value): value is number => Number.isFinite(value));
  const columns = rows[0] ? Object.keys(rows[0].raw) : [];
  const dailyKeys = aggregates.filter((row) => row.days > 1).length;
  return {
    fileName,
    rowCount: rows.length,
    dateRange: times.length
      ? `${new Date(Math.min(...times)).toISOString().slice(0, 10)} to ${new Date(Math.max(...times)).toISOString().slice(0, 10)}`
      : "-",
    reportType: `${dailyKeys ? "Daily" : "Summary"} Sponsored Products targeting performance`,
    warnings: dailyKeys
      ? []
      : ["Before/after impact needs daily targeting performance data."],
    columns,
  };
}

function isProfitable(row: PerformanceAggregate, thresholds: Thresholds) {
  return (
    row.sales >= thresholds.minSales &&
    row.orders >= thresholds.minOrders &&
    row.acos !== null &&
    row.acos <= thresholds.targetAcos
  );
}

function isWasteful(row: PerformanceAggregate, thresholds: Thresholds) {
  // Direct threshold compare — no 1.5x multiplier per simplified spec.
  return (
    (row.spend >= thresholds.minSpend && row.orders === 0) ||
    (row.spend >= thresholds.minSpend &&
      row.acos !== null &&
      row.acos > thresholds.targetAcos)
  );
}

function hasEnoughData(row: PerformanceAggregate, thresholds: Thresholds) {
  return (
    row.clicks >= thresholds.minClicks ||
    row.spend >= thresholds.minSpend ||
    row.orders >= thresholds.minOrders
  );
}

function priorityScore(
  row: PerformanceAggregate,
  input: {
    wasteful: boolean;
    profitable: boolean;
    enoughData: boolean;
    matchLevel: MatchLevel;
    tooManyBidChanges: boolean;
  },
) {
  let score = 0;
  score += Math.min(35, row.spend * 0.8);
  score += Math.min(25, row.sales * 0.08);
  score += Math.min(18, row.orders * 2);
  if (input.wasteful) score += 18;
  if (input.profitable) score += 14;
  if (input.tooManyBidChanges) score += 9;
  if (!input.enoughData) score -= 25;
  if (input.matchLevel === "Unmatched") score -= 10;
  return Math.max(0, Math.round(score));
}

function priorityFromScore(
  score: number,
  input: { wasteful: boolean; profitable: boolean; enoughData: boolean },
) {
  if (!input.enoughData) return "Watch";
  if (score >= 55) return "Critical";
  if (score >= 38) return "High";
  if (score >= 22) return "Medium";
  return "Low";
}

function confidenceFor(
  matchLevel: MatchLevel,
  enoughData: boolean,
  impact: BeforeAfterImpact,
): AuditRow["confidence"] {
  if (matchLevel === "Unmatched") return "Review Only";
  if (!enoughData) return "Low";
  if (matchLevel === "Medium no-match-type") return "Medium";
  if (impact.status === "Full window") return "High";
  return "Medium";
}

function bucketCounts<T>(rows: T[], getKey: (row: T) => string) {
  const map = new Map<string, number>();
  rows.forEach((row) => map.set(getKey(row), (map.get(getKey(row)) ?? 0) + 1));
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function groupHistory(rows: HistoryRow[], keyer: (row: HistoryRow) => string) {
  const map = new Map<string, HistoryRow[]>();
  rows.forEach((row) => {
    const key = keyer(row);
    map.set(key, [...(map.get(key) ?? []), row]);
  });
  map.forEach((items, key) => {
    map.set(
      key,
      items
        .slice()
        .sort((a, b) => (a.time?.getTime() ?? 0) - (b.time?.getTime() ?? 0)),
    );
  });
  return map;
}

function latest(rows: HistoryRow[]) {
  if (!rows.length) return null;
  return rows
    .slice()
    .sort((a, b) => (b.time?.getTime() ?? 0) - (a.time?.getTime() ?? 0))[0];
}

function sum<T>(items: T[], field: keyof T) {
  return items.reduce((total, item) => total + (Number(item[field]) || 0), 0);
}

function read(raw: RawRow, name: string) {
  const exact = raw[name];
  if (exact !== undefined) return exact;
  const found = Object.keys(raw).find(
    (key) => key.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  return found ? raw[found] : undefined;
}

function string(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .replace(/[$,%\s]/g, "")
    .replace(/,/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  if (String(value).includes("%") && parsed > 1) return parsed / 100;
  return parsed;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return utcCalendarDate(value);
  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return utcCalendarDate(
      new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000),
    );
  }
  const text = String(value).trim();
  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd)
    return new Date(
      Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])),
    );
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : utcCalendarDate(parsed);
}

function safeJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function norm(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s*=\s*/g, "=")
    .replace(/\s+/g, " ");
}

function canonicalTarget(value: unknown) {
  return norm(value);
}

function canonicalMatchType(matchType: string, target: string) {
  const match = norm(matchType);
  const normalizedTarget = canonicalTarget(target);
  if (
    match === "-" &&
    (normalizedTarget.startsWith("asin=") ||
      normalizedTarget.startsWith("asin-expanded=") ||
      normalizedTarget.startsWith("category="))
  ) {
    return "TARGETING_EXPRESSION";
  }
  if (match === "-" && AUTO_TARGETS.has(normalizedTarget)) {
    return "TARGETING_EXPRESSION_PREDEFINED";
  }
  return matchType;
}

function makeKey(
  campaign: string,
  adGroup: string,
  target: string,
  matchType: string,
) {
  return [
    norm(campaign),
    norm(adGroup),
    canonicalTarget(target),
    norm(matchType),
  ].join("||");
}

function makeNoMatchTypeKey(campaign: string, adGroup: string, target: string) {
  return [norm(campaign), norm(adGroup), canonicalTarget(target)].join("||");
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function utcCalendarDate(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function emptyImpact(
  status: BeforeAfterImpact["status"],
  label: BeforeAfterImpact["label"],
): BeforeAfterImpact {
  return {
    status,
    label,
    preSpend: 0,
    postSpend: 0,
    preSales: 0,
    postSales: 0,
    preOrders: 0,
    postOrders: 0,
    preAcos: null,
    postAcos: null,
    preDays: 0,
    postDays: 0,
    changeDateIso: null,
    preStartIso: null,
    preEndIso: null,
    postStartIso: null,
    postEndIso: null,
  };
}

function truncate(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
