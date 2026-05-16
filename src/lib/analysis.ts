import Papa from "papaparse";
import ExcelJS from "exceljs";
import {
  AnalysisResult,
  AuditRow,
  BeforeAfterImpact,
  CampaignSummary,
  Category,
  FileStatus,
  HistoryRow,
  MatchLevel,
  PerformanceAggregate,
  Priority,
  Recommendation,
  TargetingRow,
  Thresholds
} from "./types";

type RawRow = Record<string, unknown>;

const AUTO_TARGETS = new Set(["close-match", "loose-match", "substitutes", "complements"]);

export const defaultThresholds: Thresholds = {
  targetAcos: 0.25,
  minClicks: 8,
  minSpend: 20,
  minOrders: 2,
  minSales: 50,
  lookbackDays: 7,
  attributionDelayDays: 1,
  mode: "Balanced"
};

export function thresholdsForMode(mode: Thresholds["mode"], current: Thresholds): Thresholds {
  const base = { ...current, mode };
  if (mode === "Conservative") {
    return { ...base, minClicks: 14, minSpend: 30, minOrders: 3, minSales: 75, attributionDelayDays: 2 };
  }
  if (mode === "Aggressive") {
    return { ...base, minClicks: 5, minSpend: 12, minOrders: 1, minSales: 30, attributionDelayDays: 1 };
  }
  return { ...base, minClicks: 8, minSpend: 20, minOrders: 2, minSales: 50, attributionDelayDays: 1 };
}

export async function parseHistoryCsv(file: File): Promise<RawRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (result) => resolve(result.data),
      error: reject
    });
  });
}

export async function parseTargetingWorkbook(file: File): Promise<RawRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const headerNames: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headerNames[colNumber - 1] = String(cellToValue(cell.value) ?? `Column ${colNumber}`).trim();
  });

  const records: RawRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: RawRow = {};
    let hasValue = false;
    headerNames.forEach((header, index) => {
      const value = cellToValue(row.getCell(index + 1).value);
      if (value !== null && value !== undefined && value !== "") hasValue = true;
      record[header || `Column ${index + 1}`] = value ?? "";
    });
    if (hasValue) records.push(record);
  });
  return records;
}

export function analyzeFiles(
  historyRaw: RawRow[],
  targetingRaw: RawRow[],
  historyFileName: string,
  targetingFileName: string,
  thresholds: Thresholds
): AnalysisResult {
  const history = historyRaw.map(normalizeHistoryRow).filter(Boolean) as HistoryRow[];
  const targeting = targetingRaw.map(normalizeTargetingRow).filter(Boolean) as TargetingRow[];
  const aggregates = aggregateTargeting(targeting);
  const spHistory = history.filter((row) => row.programType === "SP");
  const sbHistory = history.filter((row) => row.programType === "SB");
  const historyIndexes = buildHistoryIndexes(spHistory);

  const auditRows = aggregates.map((aggregate) => buildAuditRow(aggregate, historyIndexes, thresholds));
  const unmatchedHistoryRows = getUnmatchedHistoryRows(spHistory, auditRows);
  const campaignSummary = summarizeBy(auditRows, (row) => row.campaign);
  const adGroupSummary = summarizeBy(auditRows, (row) => row.adGroup);
  const summary = summarize(auditRows, history, spHistory, sbHistory, targeting);
  const charts = makeChartData(auditRows, campaignSummary);
  const historyStatus = makeHistoryStatus(historyFileName, history);
  const targetingStatus = makeTargetingStatus(targetingFileName, targeting, aggregates);
  const unsupportedHistoryRows = sbHistory;
  const unmatchedPerformanceRows = auditRows.filter((row) => row.matchLevel === "Unmatched");

  const warnings = [
    ...(sbHistory.length
      ? [`${sbHistory.length.toLocaleString()} Sponsored Brands history rows were isolated because the uploaded performance report is Sponsored Products only.`]
      : []),
    ...(unmatchedPerformanceRows.length
      ? [`${unmatchedPerformanceRows.length.toLocaleString()} Sponsored Products target combinations did not match bid history in the selected window.`]
      : []),
    "Current bid cannot be known for targets with no bid-change history unless a Bulk Operations file is added.",
    "Profit-level recommendations need SKU margin, COGS, fees, and target ACoS by product."
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
    charts,
    warnings
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
  const bidChangePct = fromBid && toBid !== null ? (toBid - fromBid) / fromBid : null;

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
    noMatchTypeKey
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
  const canonicalKey = makeKey(campaign, adGroup, targeting, canonicalMatchType(matchType, targeting));
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
    sales: toNumber(read(raw, "7 Day Total Sales")) ?? 0,
    orders: toNumber(read(raw, "7 Day Total Orders (#)")) ?? 0,
    units: toNumber(read(raw, "7 Day Total Units (#)")) ?? 0,
    cvr: toNumber(read(raw, "7 Day Conversion Rate")),
    exactKey,
    canonicalKey,
    noMatchTypeKey
  };
}

function aggregateTargeting(rows: TargetingRow[]): PerformanceAggregate[] {
  const groups = new Map<string, TargetingRow[]>();
  rows.forEach((row) => {
    const key = makeKey(row.campaign, row.adGroup, row.targeting, row.matchType);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });

  return [...groups.values()].map((items) => {
    const first = items[0];
    const dateTimes = items.map((item) => item.date?.getTime()).filter((value): value is number => Number.isFinite(value));
    const uniqueDays = new Set(dateTimes.map((time) => new Date(time).toISOString().slice(0, 10))).size;
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
      dailyRows: items
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
    noMatchType: groupHistory(rows, (row) => row.noMatchTypeKey)
  };
}

function buildAuditRow(aggregate: PerformanceAggregate, indexes: HistoryIndexes, thresholds: Thresholds): AuditRow {
  const matched = findHistoryMatch(aggregate, indexes);
  const historyRows = matched.rows;
  const latestHistory = latest(historyRows);
  const bidChanges = historyRows.length;
  const previousBid = latestHistory?.fromBid ?? null;
  const latestBid = latestHistory?.toBid ?? null;
  const bidChangePct = latestHistory?.bidChangePct ?? null;
  const lastBidChangeDate = latestHistory?.time ?? null;
  const lastIncrease = bidChangePct !== null && bidChangePct > 0.05;
  const lastDecrease = bidChangePct !== null && bidChangePct < -0.05;
  const profitable = isProfitable(aggregate, thresholds);
  const wasteful = isWasteful(aggregate, thresholds);
  const enoughData = hasEnoughData(aggregate, thresholds);
  const tooManyBidChanges = bidChanges >= 3;
  const impact = calculateBeforeAfter(aggregate, latestHistory, thresholds);
  const secondaryTags: Category[] = [];

  if (tooManyBidChanges) secondaryTags.push("Too Many Bid Changes");
  if (profitable && !lastIncrease) secondaryTags.push("Winners Not Scaled");
  if (wasteful && !lastDecrease) secondaryTags.push("Losers Not Reduced");
  if (profitable && lastDecrease) secondaryTags.push("Profitable Terms Reduced");
  if (wasteful && lastIncrease) secondaryTags.push("Unprofitable Terms Increased");
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
    impact
  });

  return {
    ...aggregate,
    matchLevel: matched.level,
    latestHistory,
    bidChanges,
    previousBid,
    latestBid,
    bidChangePct,
    lastBidChangeDate,
    category: decision.category,
    secondaryTags: [...new Set(secondaryTags.filter((tag) => tag !== decision.category))],
    recommendation: decision.recommendation,
    priority: decision.priority,
    confidence: decision.confidence,
    reason: decision.reason,
    priorityScore: decision.priorityScore,
    impact
  };
}

function findHistoryMatch(aggregate: PerformanceAggregate, indexes: HistoryIndexes): { level: MatchLevel; rows: HistoryRow[] } {
  const exact = indexes.exact.get(aggregate.exactKey);
  if (exact?.length) return { level: "High exact", rows: exact };
  const canonical = indexes.canonical.get(aggregate.canonicalKey);
  if (canonical?.length) return { level: "High canonical", rows: canonical };
  const noMatchType = indexes.noMatchType.get(aggregate.noMatchTypeKey);
  if (noMatchType?.length) return { level: "Medium no-match-type", rows: noMatchType };
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
}): { category: Category; recommendation: Recommendation; priority: Priority; confidence: AuditRow["confidence"]; reason: string; priorityScore: number } {
  const row = input.aggregate;
  const score = priorityScore(row, input);
  const priority = priorityFromScore(score, input);
  const confidence = confidenceFor(input.matchLevel, input.enoughData, input.impact);
  const acosText = row.acos === null ? "no sales" : `${(row.acos * 100).toFixed(1)}% ACoS`;

  if (input.matchLevel === "Unmatched" && input.enoughData) {
    return {
      category: "No Action Despite Enough Data",
      recommendation: "Review match",
      priority,
      confidence: "Review Only",
      priorityScore: score,
      reason: `This target has enough activity (${row.clicks} clicks, $${row.spend.toFixed(2)} spend), but no matched bid-change history was found.`
    };
  }

  if (!input.enoughData) {
    return {
      category: "Needs More Data",
      recommendation: "Collect more data",
      priority: "Watch",
      confidence,
      priorityScore: score,
      reason: `This target does not yet have enough clicks, spend, or orders for a reliable bid decision.`
    };
  }

  if (input.wasteful && input.lastIncrease) {
    return {
      category: "Unprofitable Terms Increased",
      recommendation: input.thresholds.mode === "Aggressive" ? "Pause / review" : "Reduce bid",
      priority,
      confidence,
      priorityScore: score,
      reason: `Bid was increased even though this target has ${acosText} with $${row.spend.toFixed(2)} spend.`
    };
  }

  if (input.profitable && input.lastDecrease) {
    return {
      category: "Profitable Terms Reduced",
      recommendation: "Increase bid",
      priority,
      confidence,
      priorityScore: score,
      reason: `Bid was reduced even though this target produced $${row.sales.toFixed(2)} sales at ${acosText}.`
    };
  }

  if (input.wasteful && !input.lastDecrease) {
    return {
      category: "Losers Not Reduced",
      recommendation: input.thresholds.mode === "Aggressive" && row.orders === 0 ? "Pause / review" : "Reduce bid",
      priority,
      confidence,
      priorityScore: score,
      reason: row.orders === 0
        ? `This target spent $${row.spend.toFixed(2)} with 0 orders and no meaningful bid reduction was found.`
        : `This target has ${acosText}, above the waste threshold, and no meaningful bid reduction was found.`
    };
  }

  if (input.profitable && !input.lastIncrease) {
    return {
      category: "Winners Not Scaled",
      recommendation: "Increase bid",
      priority,
      confidence,
      priorityScore: score,
      reason: `This target has ${acosText} with ${row.orders} orders, but no meaningful bid increase was found.`
    };
  }

  if (input.tooManyBidChanges) {
    return {
      category: "Too Many Bid Changes",
      recommendation: "Hold",
      priority: priority === "Critical" ? "High" : priority,
      confidence,
      priorityScore: score,
      reason: `This target had ${input.bidChanges} bid changes in the selected window, so wait for cleaner post-change data before another move.`
    };
  }

  if ((input.profitable && input.lastIncrease) || (input.wasteful && input.lastDecrease)) {
    return {
      category: "Correctly Managed",
      recommendation: "Hold",
      priority: "Low",
      confidence,
      priorityScore: score,
      reason: `The latest bid direction appears aligned with performance.`
    };
  }

  return {
    category: "Monitor",
    recommendation: "Hold",
    priority: "Low",
    confidence,
    priorityScore: score,
    reason: `Performance is not an obvious winner or loser against the current thresholds.`
  };
}

function calculateBeforeAfter(aggregate: PerformanceAggregate, history: HistoryRow | null | undefined, thresholds: Thresholds): BeforeAfterImpact {
  if (!history?.time) {
    return emptyImpact("No bid change", "Not enough data");
  }

  const changeDate = startOfDay(history.time);
  const preStart = addDays(changeDate, -thresholds.lookbackDays);
  const preEnd = addDays(changeDate, -1);
  const postStart = addDays(changeDate, thresholds.attributionDelayDays);
  const postEnd = addDays(postStart, thresholds.lookbackDays - 1);

  const preRows = aggregate.dailyRows.filter((row) => row.date && row.date >= preStart && row.date <= preEnd);
  const postRows = aggregate.dailyRows.filter((row) => row.date && row.date >= postStart && row.date <= postEnd);
  const pre = summarizeDaily(preRows);
  const post = summarizeDaily(postRows);
  const full = pre.days >= Math.min(3, thresholds.lookbackDays) && post.days >= Math.min(3, thresholds.lookbackDays);
  let label: BeforeAfterImpact["label"] = "Not enough data";

  if (full && pre.spend > 0 && post.spend > 0) {
    const acosImproved = pre.acos !== null && post.acos !== null && post.acos < pre.acos * 0.95;
    const salesImproved = post.sales > pre.sales * 1.05;
    const acosWorse = pre.acos !== null && post.acos !== null && post.acos > pre.acos * 1.1;
    if (acosImproved || salesImproved) label = "Helped";
    else if (acosWorse && post.sales <= pre.sales * 1.05) label = "Hurt";
    else label = "Inconclusive";
  }

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
    postDays: post.days
  };
}

function summarizeDaily(rows: TargetingRow[]) {
  const spend = sum(rows, "spend");
  const sales = sum(rows, "sales");
  const orders = sum(rows, "orders");
  const days = new Set(rows.map((row) => row.date?.toISOString().slice(0, 10)).filter(Boolean)).size;
  return {
    spend,
    sales,
    orders,
    acos: sales > 0 ? spend / sales : null,
    days
  };
}

function summarize(
  auditRows: AuditRow[],
  history: HistoryRow[],
  spHistory: HistoryRow[],
  sbHistory: HistoryRow[],
  targeting: TargetingRow[]
) {
  const matchedTargets = auditRows.filter((row) => row.matchLevel !== "Unmatched").length;
  const hasTag = (row: AuditRow, category: Category) => row.category === category || row.secondaryTags.includes(category);
  const rowsWithIssues = auditRows.filter((row) =>
    ["Winners Not Scaled", "Losers Not Reduced", "Profitable Terms Reduced", "Unprofitable Terms Increased", "Too Many Bid Changes"].includes(row.category)
  ).length;
  const actionableRows = auditRows.filter((row) => ["Increase bid", "Reduce bid", "Pause / review", "Review match"].includes(row.recommendation)).length;
  const decisionScore = Math.max(0, Math.round(100 - (rowsWithIssues / Math.max(1, auditRows.length)) * 70 - (actionableRows / Math.max(1, auditRows.length)) * 20));

  return {
    totalTargets: auditRows.length,
    matchedTargets,
    unmatchedTargets: auditRows.length - matchedTargets,
    highExact: auditRows.filter((row) => row.matchLevel === "High exact").length,
    highCanonical: auditRows.filter((row) => row.matchLevel === "High canonical").length,
    mediumMatch: auditRows.filter((row) => row.matchLevel === "Medium no-match-type").length,
    historyRows: history.length,
    spHistoryRows: spHistory.length,
    sbHistoryRows: sbHistory.length,
    performanceRows: targeting.length,
    winnersNotScaled: auditRows.filter((row) => hasTag(row, "Winners Not Scaled")).length,
    losersNotReduced: auditRows.filter((row) => hasTag(row, "Losers Not Reduced")).length,
    wrongIncreases: auditRows.filter((row) => row.category === "Unprofitable Terms Increased").length,
    wrongReductions: auditRows.filter((row) => row.category === "Profitable Terms Reduced").length,
    needsMoreData: auditRows.filter((row) => row.category === "Needs More Data").length,
    tooManyBidChanges: auditRows.filter((row) => row.category === "Too Many Bid Changes" || row.secondaryTags.includes("Too Many Bid Changes")).length,
    estimatedWastedSpend: auditRows
      .filter((row) => hasTag(row, "Losers Not Reduced") || row.category === "Unprofitable Terms Increased")
      .reduce((total, row) => total + row.spend, 0),
    estimatedMissedSales: auditRows
      .filter((row) => hasTag(row, "Winners Not Scaled") || row.category === "Profitable Terms Reduced")
      .reduce((total, row) => total + row.sales, 0),
    decisionScore
  };
}

function summarizeBy(rows: AuditRow[], getKey: (row: AuditRow) => string): CampaignSummary[] {
  const groups = new Map<string, AuditRow[]>();
  rows.forEach((row) => {
    const key = getKey(row) || "Unknown";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });

  return [...groups.entries()]
    .map(([campaign, items]) => {
      const spend = sum(items, "spend");
      const sales = sum(items, "sales");
      const issueCount = items.filter((row) => row.priority !== "Low" && row.priority !== "Watch").length;
      return {
        campaign,
        spend,
        sales,
        orders: sum(items, "orders"),
        acos: sales > 0 ? spend / sales : null,
        targets: items.length,
        issueCount,
        winnersNotScaled: items.filter((row) => row.category === "Winners Not Scaled").length,
        losersNotReduced: items.filter((row) => row.category === "Losers Not Reduced").length,
        wrongBidChanges: items.filter((row) => row.category === "Profitable Terms Reduced" || row.category === "Unprofitable Terms Increased").length,
        tooManyBidChanges: items.filter((row) => row.category === "Too Many Bid Changes" || row.secondaryTags.includes("Too Many Bid Changes")).length,
        needsMoreData: items.filter((row) => row.category === "Needs More Data").length,
        unmatched: items.filter((row) => row.matchLevel === "Unmatched").length
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

function makeChartData(auditRows: AuditRow[], campaignSummary: CampaignSummary[]) {
  return {
    priorityBreakdown: bucketCounts(auditRows, (row) => row.priority),
    categoryBreakdown: bucketCounts(auditRows, (row) => row.category),
    scatter: auditRows
      .filter((row) => row.acos !== null && row.bidChangePct !== null && row.spend > 0)
      .slice()
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 250)
      .map((row) => ({ name: row.targeting, acos: row.acos ?? 0, bidChange: row.bidChangePct ?? 0, spend: row.spend, category: row.category })),
    spendSales: auditRows
      .filter((row) => row.spend > 0 || row.sales > 0)
      .slice()
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 250)
      .map((row) => ({ name: row.targeting, spend: row.spend, sales: row.sales, category: row.category })),
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
        postSales: row.impact.postSales
      }))
  };
}

function getUnmatchedHistoryRows(spHistory: HistoryRow[], auditRows: AuditRow[]) {
  const matchedKeys = new Set(auditRows.flatMap((row) => [row.exactKey, row.canonicalKey, row.noMatchTypeKey]));
  return spHistory.filter((row) => !matchedKeys.has(row.exactKey) && !matchedKeys.has(row.canonicalKey) && !matchedKeys.has(row.noMatchTypeKey));
}

function makeHistoryStatus(fileName: string, rows: HistoryRow[]): FileStatus {
  const times = rows.map((row) => row.time?.getTime()).filter((value): value is number => Number.isFinite(value));
  const columns = rows[0] ? Object.keys(rows[0].raw) : [];
  const sp = rows.filter((row) => row.programType === "SP").length;
  const sb = rows.filter((row) => row.programType === "SB").length;
  return {
    fileName,
    rowCount: rows.length,
    dateRange: times.length ? `${new Date(Math.min(...times)).toISOString().slice(0, 10)} to ${new Date(Math.max(...times)).toISOString().slice(0, 10)}` : "-",
    reportType: `History bid changes (${sp.toLocaleString()} SP, ${sb.toLocaleString()} SB)`,
    warnings: sb ? [`${sb.toLocaleString()} SB rows isolated until an SB performance report is uploaded.`] : [],
    columns
  };
}

function makeTargetingStatus(fileName: string, rows: TargetingRow[], aggregates: PerformanceAggregate[]): FileStatus {
  const times = rows.map((row) => row.date?.getTime()).filter((value): value is number => Number.isFinite(value));
  const columns = rows[0] ? Object.keys(rows[0].raw) : [];
  const dailyKeys = aggregates.filter((row) => row.days > 1).length;
  return {
    fileName,
    rowCount: rows.length,
    dateRange: times.length ? `${new Date(Math.min(...times)).toISOString().slice(0, 10)} to ${new Date(Math.max(...times)).toISOString().slice(0, 10)}` : "-",
    reportType: `${dailyKeys ? "Daily" : "Summary"} Sponsored Products targeting performance`,
    warnings: dailyKeys ? [] : ["Before/after impact needs daily targeting performance data."],
    columns
  };
}

function isProfitable(row: PerformanceAggregate, thresholds: Thresholds) {
  return row.sales >= thresholds.minSales && row.orders >= thresholds.minOrders && row.acos !== null && row.acos <= thresholds.targetAcos;
}

function isWasteful(row: PerformanceAggregate, thresholds: Thresholds) {
  return (
    (row.spend >= thresholds.minSpend && row.orders === 0) ||
    (row.spend >= thresholds.minSpend && row.acos !== null && row.acos >= thresholds.targetAcos * 1.5)
  );
}

function hasEnoughData(row: PerformanceAggregate, thresholds: Thresholds) {
  return row.clicks >= thresholds.minClicks || row.spend >= thresholds.minSpend || row.orders >= thresholds.minOrders;
}

function priorityScore(row: PerformanceAggregate, input: { wasteful: boolean; profitable: boolean; enoughData: boolean; matchLevel: MatchLevel; tooManyBidChanges: boolean }) {
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

function priorityFromScore(score: number, input: { wasteful: boolean; profitable: boolean; enoughData: boolean }) {
  if (!input.enoughData) return "Watch";
  if (score >= 55) return "Critical";
  if (score >= 38) return "High";
  if (score >= 22) return "Medium";
  return "Low";
}

function confidenceFor(matchLevel: MatchLevel, enoughData: boolean, impact: BeforeAfterImpact): AuditRow["confidence"] {
  if (matchLevel === "Unmatched") return "Review Only";
  if (!enoughData) return "Low";
  if (matchLevel === "Medium no-match-type") return "Medium";
  if (impact.status === "Full window") return "High";
  return "Medium";
}

function bucketCounts<T>(rows: T[], getKey: (row: T) => string) {
  const map = new Map<string, number>();
  rows.forEach((row) => map.set(getKey(row), (map.get(getKey(row)) ?? 0) + 1));
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function groupHistory(rows: HistoryRow[], keyer: (row: HistoryRow) => string) {
  const map = new Map<string, HistoryRow[]>();
  rows.forEach((row) => {
    const key = keyer(row);
    map.set(key, [...(map.get(key) ?? []), row]);
  });
  map.forEach((items, key) => {
    map.set(key, items.slice().sort((a, b) => (a.time?.getTime() ?? 0) - (b.time?.getTime() ?? 0)));
  });
  return map;
}

function latest(rows: HistoryRow[]) {
  if (!rows.length) return null;
  return rows.slice().sort((a, b) => (b.time?.getTime() ?? 0) - (a.time?.getTime() ?? 0))[0];
}

function sum<T>(items: T[], field: keyof T) {
  return items.reduce((total, item) => total + (Number(item[field]) || 0), 0);
}

function read(raw: RawRow, name: string) {
  const exact = raw[name];
  if (exact !== undefined) return exact;
  const found = Object.keys(raw).find((key) => key.trim().toLowerCase() === name.trim().toLowerCase());
  return found ? raw[found] : undefined;
}

function cellToValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;
  if ("result" in value) return cellToValue(value.result as ExcelJS.CellValue);
  if ("text" in value) return value.text;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("hyperlink" in value && "text" in value) return value.text;
  return String(value);
}

function string(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[$,%\s]/g, "").replace(/,/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  if (String(value).includes("%") && parsed > 1) return parsed / 100;
  return parsed;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return utcCalendarDate(value);
  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return utcCalendarDate(new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000));
  }
  const text = String(value).trim();
  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
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
  if (match === "-" && (normalizedTarget.startsWith("asin=") || normalizedTarget.startsWith("asin-expanded=") || normalizedTarget.startsWith("category="))) {
    return "TARGETING_EXPRESSION";
  }
  if (match === "-" && AUTO_TARGETS.has(normalizedTarget)) {
    return "TARGETING_EXPRESSION_PREDEFINED";
  }
  return matchType;
}

function makeKey(campaign: string, adGroup: string, target: string, matchType: string) {
  return [norm(campaign), norm(adGroup), canonicalTarget(target), norm(matchType)].join("||");
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
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcCalendarDate(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function emptyImpact(status: BeforeAfterImpact["status"], label: BeforeAfterImpact["label"]): BeforeAfterImpact {
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
    postDays: 0
  };
}

function truncate(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
