export type Mode = "Conservative" | "Balanced" | "Aggressive";

export type UnmatchedReason =
  | "no_bid_change_in_window"
  | "name_mismatch"
  | "target_not_in_bulk";

export type MatchLevel =
  | "High exact"
  | "High canonical"
  | "Medium no-match-type"
  | "Unmatched";

export type Priority = "Critical" | "High" | "Medium" | "Low" | "Watch";

export type Recommendation =
  | "Increase bid"
  | "Reduce bid"
  | "Pause / review"
  | "Hold"
  | "Collect more data"
  | "Review match";

export type Category =
  | "Winners Not Scaled"
  | "Losers Not Reduced"
  | "Profitable Terms Reduced"
  | "Unprofitable Terms Increased"
  | "No Action Despite Enough Data"
  | "Too Many Bid Changes"
  | "Needs More Data"
  | "Correctly Managed"
  | "Monitor";

export interface Thresholds {
  targetAcos: number;
  minClicks: number;
  minSpend: number;
  minOrders: number;
  minSales: number;
  lookbackDays: number;
  attributionDelayDays: number;
  mode: Mode;
  /** Active KPI thresholds for the rolling-7 timeline audit. */
  kpis: KpiThreshold[];
}

export interface FileStatus {
  fileName: string;
  rowCount: number;
  dateRange: string;
  reportType: string;
  warnings: string[];
  columns: string[];
}

export interface HistoryRow {
  raw: Record<string, unknown>;
  time: Date | null;
  eventSourceType: string;
  eventSourceId: string;
  name: string;
  type: string;
  fromBid: number | null;
  toBid: number | null;
  targetingType: string;
  matchType: string;
  targetingSecondary: string;
  campaignId: string;
  adGroupId: string;
  isSystemEvent: boolean;
  campaignName: string;
  adGroupName: string;
  programType: string;
  bidChangePct: number | null;
  exactKey: string;
  canonicalKey: string;
  noMatchTypeKey: string;
}

export interface TargetingRow {
  raw: Record<string, unknown>;
  date: Date | null;
  portfolio: string;
  currency: string;
  campaign: string;
  country: string;
  adGroup: string;
  retailer: string;
  targeting: string;
  matchType: string;
  impressions: number;
  topSearchShare: number | null;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  spend: number;
  acos: number | null;
  roas: number | null;
  sales: number;
  orders: number;
  units: number;
  cvr: number | null;
  exactKey: string;
  canonicalKey: string;
  noMatchTypeKey: string;
}

export interface PerformanceAggregate {
  campaign: string;
  adGroup: string;
  targeting: string;
  matchType: string;
  firstDate: Date | null;
  lastDate: Date | null;
  days: number;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
  cpc: number | null;
  ctr: number | null;
  cvr: number | null;
  acos: number | null;
  roas: number | null;
  exactKey: string;
  canonicalKey: string;
  noMatchTypeKey: string;
  dailyRows: TargetingRow[];
}

export interface BeforeAfterImpact {
  status: "Full window" | "Incomplete window" | "No bid change";
  label: "Helped" | "Hurt" | "Inconclusive" | "Not enough data";
  preSpend: number;
  postSpend: number;
  preSales: number;
  postSales: number;
  preOrders: number;
  postOrders: number;
  preAcos: number | null;
  postAcos: number | null;
  preDays: number;
  postDays: number;
}

/** Plain-English explanation attached to every audited target. */
export interface RowExplain {
  /** One simple sentence naming the target and what is going on. */
  reason: string;
  /** The exact rule + thresholds + the target's real numbers that triggered it. */
  rule: string;
  /** Why this recommended action, in plain words. */
  whyAction: string;
  /** Why this priority level. */
  whyPriority: string;
  /** Why this confidence level. */
  whyConfidence: string;
}

/** KPI we audit against. Each carries its own direction semantic. */
export type KpiKey = "acos" | "cvr" | "ctr" | "roas" | "spend";

/** Per-KPI threshold + direction. */
export interface KpiThreshold {
  kpi: KpiKey;
  /** Threshold value in same units the row stores (0.25 = 25% for ACoS/CVR/CTR; raw $ for spend; raw ratio for ROAS). */
  threshold: number;
  /** "lower" = lower is better (ACoS, Spend). "higher" = higher is better (CVR, CTR, ROAS). */
  direction: "lower" | "higher";
}

/** Per-date verdict produced by the rolling 7-day timeline engine. */
export interface TimelineEntry {
  /** Calendar date ISO yyyy-mm-dd. */
  date: string;
  /** Per-KPI verdicts for this date. */
  perKpi: TimelineKpiVerdict[];
}

export interface TimelineKpiVerdict {
  kpi: KpiKey;
  /** Rolling 7-day KPI value as of `date`. */
  rolling7Value: number | null;
  /** Threshold used. */
  threshold: number;
  /** Is the rolling value worse than threshold? (lower-is-better: value > threshold; higher-is-better: value < threshold) */
  worseThanThreshold: boolean | null;
  /** Direction of any bid change in the rolling window. null = no change. */
  bidDirection: "increased" | "reduced" | null;
  /** Final verdict for this KPI on this date. */
  verdict:
    | "acted_correctly"
    | "wrong_direction"
    | "not_reduced"
    | "not_increased"
    | "no_data";
}

export interface AuditRow extends PerformanceAggregate {
  matchLevel: MatchLevel;
  /** Why this target is Unmatched; null when matched. */
  unmatchedReason: UnmatchedReason | null;
  latestHistory: HistoryRow | null;
  /** All bid changes for this target, sorted oldest → newest. */
  allBidChanges: HistoryRow[];
  /** Per-date rolling-7 verdicts (empty if not enough data). */
  timeline: TimelineEntry[];
  bidChanges: number;
  previousBid: number | null;
  latestBid: number | null;
  /** Current bid from the Bulk Operations file, when uploaded. */
  currentBid: number | null;
  /** True when this target was found in the Bulk file (its bid is known). */
  bulkConfirmed: boolean;
  bidChangePct: number | null;
  lastBidChangeDate: Date | null;
  category: Category;
  secondaryTags: Category[];
  recommendation: Recommendation;
  priority: Priority;
  confidence: "High" | "Medium" | "Low" | "Review Only";
  reason: string;
  explain: RowExplain;
  priorityScore: number;
  impact: BeforeAfterImpact;
}

export interface Summary {
  totalTargets: number;
  matchedTargets: number;
  unmatchedTargets: number;
  highExact: number;
  highCanonical: number;
  mediumMatch: number;
  historyRows: number;
  spHistoryRows: number;
  sbHistoryRows: number;
  performanceRows: number;
  winnersNotScaled: number;
  losersNotReduced: number;
  wrongIncreases: number;
  wrongReductions: number;
  needsMoreData: number;
  tooManyBidChanges: number;
  estimatedWastedSpend: number;
  estimatedMissedSales: number;
  decisionScore: number;
  scoreBreakdown: ScoreBreakdown;
}

/** The visible math behind the Decision Score so it is not a black box. */
export interface ScoreBreakdown {
  /** Targets we could actually grade (matched + enough data). */
  judged: number;
  /** Of judged: decisions that look correct (Correctly Managed / Monitor). */
  good: number;
  /** Of judged: targets with a real bid-management problem. */
  issues: number;
  /** Targets set aside (unmatched or not enough data) — not graded. */
  setAside: number;
  /** Plain-English description of how the score was computed. */
  formula: string;
}

/** Plain-language description of one audit category, used by the in-app guide. */
export interface MethodologyEntry {
  category: Category;
  title: string;
  plain: string;
  howDecided: string;
  whyItMatters: string;
  action: string;
}

export interface Methodology {
  categories: MethodologyEntry[];
  score: string;
  priority: string;
  confidence: string;
  limitations: string[];
}

export interface CampaignSummary {
  campaign: string;
  spend: number;
  sales: number;
  orders: number;
  acos: number | null;
  targets: number;
  issueCount: number;
  winnersNotScaled: number;
  losersNotReduced: number;
  wrongBidChanges: number;
  tooManyBidChanges: number;
  needsMoreData: number;
  unmatched: number;
}

export interface AnalysisResult {
  historyStatus: FileStatus;
  targetingStatus: FileStatus;
  auditRows: AuditRow[];
  campaignSummary: CampaignSummary[];
  adGroupSummary: CampaignSummary[];
  summary: Summary;
  unsupportedHistoryRows: HistoryRow[];
  unmatchedPerformanceRows: AuditRow[];
  unmatchedHistoryRows: HistoryRow[];
  methodology: Methodology;
  charts: {
    priorityBreakdown: Array<{ name: string; value: number }>;
    categoryBreakdown: Array<{ name: string; value: number }>;
    scatter: Array<{
      name: string;
      acos: number;
      bidChange: number;
      spend: number;
      category: string;
    }>;
    spendSales: Array<{
      name: string;
      spend: number;
      sales: number;
      category: string;
    }>;
    campaignHeatmap: CampaignSummary[];
    beforeAfter: Array<{
      name: string;
      preAcos: number | null;
      postAcos: number | null;
      preSales: number;
      postSales: number;
    }>;
  };
  warnings: string[];
  /** Sponsored Brands audit, present only when an SB performance report is uploaded. */
  sb: ProgramResult | null;
  /** Bulk Operations file status, present only when a Bulk file is uploaded. */
  bulkStatus: BulkStatus | null;
}

/** A self-contained audit for one ad program (used for Sponsored Brands). */
export interface ProgramResult {
  label: string;
  auditRows: AuditRow[];
  campaignSummary: CampaignSummary[];
  adGroupSummary: CampaignSummary[];
  summary: Summary;
  unmatchedPerformanceRows: AuditRow[];
  notes: string[];
}

export interface BulkStatus {
  fileName: string;
  spTargets: number;
  sbTargets: number;
  /** SP performance targets whose current bid is now known from the Bulk file. */
  spBidsResolved: number;
  /** SP targets that had no bid history but are confirmed live in the Bulk file. */
  spNowJudgeable: number;
}
