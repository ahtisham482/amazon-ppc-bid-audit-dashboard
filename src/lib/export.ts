import { AnalysisResult, AuditRow, CampaignSummary, Summary } from "./types";
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
    // G22: "Before/After" column was always "Not enough data" on every row in
    // the sample audit. The card UI now shows the actual before/after as a
    // muted message; the CSV doesn't need a column with one constant value.
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
    // G21: "Issue Count" = Winners Not Scaled + Waste Not Cut + Wrong-direction
    // Moves + Over-managed (does NOT include Needs More Data or Unmatched).
    "Issue Count": int(row.issueCount),
    "Winners Not Scaled": int(row.winnersNotScaled),
    // G20: canonical names align with UI pills.
    "Waste Not Cut": int(row.losersNotReduced),
    "Wrong-direction Moves": int(row.wrongBidChanges),
    "Over-managed": int(row.tooManyBidChanges),
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
- Over-managed: ${summary.tooManyBidChanges}
- Needs more data: ${summary.needsMoreData}
- Estimated wasted spend: ${summary.estimatedWastedSpend.toFixed(2)}
- Estimated missed sales: ${summary.estimatedMissedSales.toFixed(2)}
- Bid decision score: ${summary.decisionScore}/100
`;
}

// F-P2-05: A one-page Executive Summary as a self-contained HTML file with a
// print stylesheet. The user opens it in a browser and presses Ctrl+P → Save
// as PDF; the layout is designed to fit on one landscape page.
export function executiveSummaryHtml(result: AnalysisResult): string {
  const s = result.summary;
  const dollar = (n: number) =>
    `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const matchPct =
    s.totalTargets > 0
      ? Math.round((s.matchedTargets / s.totalTargets) * 1000) / 10
      : 0;
  const rows = result.auditRows;
  const pushTop = rows
    .filter((r) => r.recommendation === "Increase bid")
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 3);
  const cutTop = rows
    .filter((r) => r.recommendation === "Reduce bid")
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 3);
  const renderRow = (r: AuditRow) =>
    `<tr><td>${esc(r.targeting)}<br><span class="dim">${esc(r.campaign)}</span></td><td>${r.acos != null ? `${(r.acos * 100).toFixed(1)}%` : "—"}</td><td>${dollar(r.sales)}</td><td>${dollar(r.spend)}</td><td>${r.latestBid != null ? `$${r.latestBid.toFixed(2)}` : "—"}</td></tr>`;
  const today = new Date().toISOString().slice(0, 10);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Amazon PPC — Executive Summary (${today})</title>
<style>
  @page { size: letter landscape; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.4 -apple-system, "Segoe UI", Roboto, system-ui, sans-serif; color: #0f172a; margin: 0; padding: 24px; max-width: 1100px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #475569; font-size: 12px; margin: 0 0 16px; }
  .grid { display: grid; grid-template-columns: 200px 1fr 1fr; gap: 18px; margin-bottom: 16px; }
  .score { font-size: 56px; font-weight: 800; color: #0f766e; line-height: 1; }
  .score-sub { font-size: 11px; color: #475569; margin-top: 2px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; }
  .kpi-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #475569; }
  .kpi-value { font-size: 18px; font-weight: 700; margin-top: 2px; color: #0f172a; }
  .kpi-sub { font-size: 10px; color: #64748b; margin-top: 1px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #475569; margin: 14px 0 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; padding: 4px 6px; background: #f1f5f9; color: #475569; font-weight: 600; font-size: 10px; text-transform: uppercase; }
  td { padding: 5px 6px; vertical-align: top; border-bottom: 1px solid #f1f5f9; }
  .dim { color: #94a3b8; font-size: 10px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .files { font-size: 11px; color: #475569; }
  .files div { margin: 2px 0; }
  .foot { margin-top: 12px; padding-top: 8px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 10px; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style>
</head>
<body>
<h1>Amazon PPC — Executive Summary</h1>
<p class="sub">Generated ${today} · Rules ${RULES_VERSION}</p>

<div class="grid">
  <div>
    <div class="score">${s.decisionScore}<span style="font-size:18px;color:#94a3b8">/100</span></div>
    <div class="score-sub">Bid-management decision score</div>
  </div>
  <div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">PUSH</div><div class="kpi-value">${s.winnersNotScaled}</div><div class="kpi-sub">${dollar(s.estimatedMissedSales)} sales in play</div></div>
      <div class="kpi"><div class="kpi-label">CUT</div><div class="kpi-value">${s.losersNotReduced}</div><div class="kpi-sub">${dollar(s.estimatedWastedSpend)} spend at risk</div></div>
      <div class="kpi"><div class="kpi-label">WRONG MOVES</div><div class="kpi-value">${s.wrongIncreases + s.wrongReductions}</div><div class="kpi-sub">${s.wrongIncreases} inc · ${s.wrongReductions} red</div></div>
      <div class="kpi"><div class="kpi-label">OVER-MANAGED</div><div class="kpi-value">${s.tooManyBidChanges}</div><div class="kpi-sub">multiple changes / day</div></div>
    </div>
  </div>
  <div>
    <div class="kpi-grid" style="grid-template-columns: 1fr 1fr;">
      <div class="kpi"><div class="kpi-label">Targets analyzed</div><div class="kpi-value">${s.totalTargets.toLocaleString()}</div><div class="kpi-sub">${s.matchedTargets.toLocaleString()} matched (${matchPct}%)</div></div>
      <div class="kpi"><div class="kpi-label">Set aside</div><div class="kpi-value">${(s.totalTargets - s.matchedTargets).toLocaleString()}</div><div class="kpi-sub">unmatched / thin data</div></div>
    </div>
  </div>
</div>

<div class="two-col">
  <div>
    <h2>Top 3 PUSH — be aggressive</h2>
    <table><thead><tr><th>Target / Campaign</th><th>ACoS</th><th>Sales</th><th>Spend</th><th>Bid</th></tr></thead>
    <tbody>${pushTop.length ? pushTop.map(renderRow).join("") : '<tr><td colspan="5" class="dim">None — no profitable targets need a bid increase.</td></tr>'}</tbody>
    </table>
  </div>
  <div>
    <h2>Top 3 CUT — stop the bleed</h2>
    <table><thead><tr><th>Target / Campaign</th><th>ACoS</th><th>Sales</th><th>Spend</th><th>Bid</th></tr></thead>
    <tbody>${cutTop.length ? cutTop.map(renderRow).join("") : '<tr><td colspan="5" class="dim">None — no wasteful targets need a bid reduction.</td></tr>'}</tbody>
    </table>
  </div>
</div>

<h2>Data quality</h2>
<div class="kpi-grid">
  <div class="kpi"><div class="kpi-label">High exact</div><div class="kpi-value">${s.highExact.toLocaleString()}</div><div class="kpi-sub">Campaign + ad group + target + match</div></div>
  <div class="kpi"><div class="kpi-label">High canonical</div><div class="kpi-value">${s.highCanonical.toLocaleString()}</div><div class="kpi-sub">Product/auto target normalized</div></div>
  <div class="kpi"><div class="kpi-label">Medium</div><div class="kpi-value">${s.mediumMatch.toLocaleString()}</div><div class="kpi-sub">Matched without match type</div></div>
  <div class="kpi"><div class="kpi-label">Unmatched</div><div class="kpi-value">${s.unmatchedTargets.toLocaleString()}</div><div class="kpi-sub">Visible for review</div></div>
</div>

<h2>Files used</h2>
<div class="files">
  <div><strong>History:</strong> ${esc(result.historyStatus.fileName)} · ${result.historyStatus.rowCount.toLocaleString()} rows · ${esc(result.historyStatus.dateRange)}</div>
  <div><strong>SP Targeting:</strong> ${esc(result.targetingStatus.fileName)} · ${result.targetingStatus.rowCount.toLocaleString()} rows · ${esc(result.targetingStatus.dateRange)}</div>
</div>

<div class="foot">Decision Score = (targets managed well ÷ targets we could grade) × 100. Direction-only verdicts on a rolling 7-day window. Generated by Amazon PPC Bid Decision Quality Auditor · Rules ${RULES_VERSION}.</div>
</body>
</html>`;
}

function esc(s: string): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
