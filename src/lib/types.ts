export type Mode = "Conservative" | "Balanced" | "Aggressive";

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

export interface AuditRow extends PerformanceAggregate {
  matchLevel: MatchLevel;
  latestHistory: HistoryRow | null;
  bidChanges: number;
  previousBid: number | null;
  latestBid: number | null;
  bidChangePct: number | null;
  lastBidChangeDate: Date | null;
  category: Category;
  secondaryTags: Category[];
  recommendation: Recommendation;
  priority: Priority;
  confidence: "High" | "Medium" | "Low" | "Review Only";
  reason: string;
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
  charts: {
    priorityBreakdown: Array<{ name: string; value: number }>;
    categoryBreakdown: Array<{ name: string; value: number }>;
    scatter: Array<{ name: string; acos: number; bidChange: number; spend: number; category: string }>;
    spendSales: Array<{ name: string; spend: number; sales: number; category: string }>;
    campaignHeatmap: CampaignSummary[];
    beforeAfter: Array<{ name: string; preAcos: number | null; postAcos: number | null; preSales: number; postSales: number }>;
  };
  warnings: string[];
}
