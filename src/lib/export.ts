import { AuditRow, CampaignSummary, Summary } from "./types";
import { dateShort } from "./format";

function quote(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => quote(row[header])).join(","));
  return [headers.join(","), ...body].join("\n");
}

export function downloadText(fileName: string, content: string, type = "text/csv;charset=utf-8") {
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
    Spend: row.spend,
    Sales: row.sales,
    Orders: row.orders,
    ACoS: row.acos,
    ROAS: row.roas,
    Clicks: row.clicks,
    CPC: row.cpc,
    CTR: row.ctr,
    CVR: row.cvr,
    "Previous Bid": row.previousBid,
    "Latest Bid": row.latestBid,
    "Bid Change %": row.bidChangePct,
    "Last Bid Change": dateShort(row.lastBidChangeDate),
    "Bid Changes": row.bidChanges,
    "Match Level": row.matchLevel,
    "Before/After": row.impact.label
  };
}

export function campaignToExport(row: CampaignSummary): Record<string, unknown> {
  return {
    Campaign: row.campaign,
    Spend: row.spend,
    Sales: row.sales,
    Orders: row.orders,
    ACoS: row.acos,
    Targets: row.targets,
    "Issue Count": row.issueCount,
    "Winners Not Scaled": row.winnersNotScaled,
    "Losers Not Reduced": row.losersNotReduced,
    "Wrong Bid Changes": row.wrongBidChanges,
    "Too Many Bid Changes": row.tooManyBidChanges,
    "Needs More Data": row.needsMoreData,
    Unmatched: row.unmatched
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
