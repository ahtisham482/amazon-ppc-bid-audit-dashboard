import { AuditRow, CampaignSummary, Summary } from "./types";
import { RULES_VERSION, dateShort, decisionIdFromKey } from "./format";

// CSV cell formatters — round at serialisation so exports never leak IEEE-754 tails.
function money2(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toFixed(2);
}
function ratio4(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toFixed(4);
}
function acosPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return `${(value * 100).toFixed(2)}%`;
}
function int(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return String(Math.round(value));
}

function quote(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) =>
    headers.map((header) => quote(row[header])).join(","),
  );
  return [headers.join(","), ...body].join("\n");
}

export function downloadText(
  fileName: string,
  content: string,
  type = "text/csv;charset=utf-8",
) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function auditRowToExport(row: AuditRow): Record<string, unknown> {
  return {
    Priority: row.priority,
    Recommendation: row.recommendation,
    Category: row.category,
    "Secondary Tags": row.secondaryTags.join("; "),
    Confidence: row.confidence,
    Reason: row.reason,
    Campaign: row.campaign,
    "Ad Group": row.adGroup,
    Targeting: row.targeting,
    "Match Type": row.matchType,
    Spend: money2(row.spend),
    Sales: money2(row.sales),
    Orders: int(row.orders),
    ACoS: acosPct(row.acos),
    ROAS: ratio4(row.roas),
    Clicks: int(row.clicks),
    CPC: ratio4(row.cpc),
    CTR: row.ctr != null ? `${(row.ctr * 100).toFixed(2)}%` : "",
    CVR: row.cvr != null ? `${(row.cvr * 100).toFixed(2)}%` : "",
    "Previous Bid": money2(row.previousBid),
    "Latest Bid": money2(row.latestBid),
    "Bid Change %":
      row.bidChangePct != null ? `${(row.bidChangePct * 100).toFixed(1)}%` : "",
    "Last Bid Change": dateShort(row.lastBidChangeDate),
    "Bid Changes": int(row.bidChanges),
    "Match Level": row.matchLevel,
    "Before/After": row.impact.label,
    "Decision ID": `dec_${decisionIdFromKey(row.exactKey)}`,
    "Rules Version": RULES_VERSION,
  };
}

export function campaignToExport(
  row: CampaignSummary,
): Record<string, unknown> {
  return {
    Campaign: row.campaign,
    Spend: money2(row.spend),
    Sales: money2(row.sales),
    Orders: int(row.orders),
    ACoS: acosPct(row.acos),
    Targets: int(row.targets),
    "Issue Count": int(row.issueCount),
    "Winners Not Scaled": int(row.winnersNotScaled),
    "Losers Not Reduced": int(row.losersNotReduced),
    "Wrong Bid Changes": int(row.wrongBidChanges),
    "Too Many Bid Changes": int(row.tooManyBidChanges),
    "Needs More Data": int(row.needsMoreData),
    Unmatched: int(row.unmatched),
  };
}

export function executiveSummaryMarkdown(summary: Summary) {
  return `# Amazon PPC Bid Decision Quality Audit

- Total targets analyzed: ${summary.totalTargets}
- Matched targets: ${summary.matchedTargets}
- Unmatched targets: ${summary.unmatchedTargets}
- Winners not scaled: ${summary.winnersNotScaled}
- Losers not reduced: ${summary.losersNotReduced}
- Wrong bid increases: ${summary.wrongIncreases}
- Wrong bid reductions: ${summary.wrongReductions}
- Too many bid changes: ${summary.tooManyBidChanges}
- Needs more data: ${summary.needsMoreData}
- Estimated wasted spend: ${summary.estimatedWastedSpend.toFixed(2)}
- Estimated missed sales: ${summary.estimatedMissedSales.toFixed(2)}
- Bid decision score: ${summary.decisionScore}/100
`;
}
