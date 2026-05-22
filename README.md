# Amazon PPC Bid Decision Quality Auditor

Upload-based local dashboard for auditing Amazon PPC bid-management decisions.

## Live App

https://ahtisham482.github.io/amazon-ppc-bid-audit-dashboard/

## Run

```powershell
cd "C:\Users\DELLL\Downloads\$100M offer\PPC-Bid-Tool\ppc-bid-audit-dashboard"
npm install
npm run dev -- --port 5173
```

Open:

```text
http://127.0.0.1:5173/
```

## Inputs

Required:

1. Amazon Ads History bid-change CSV.
2. Sponsored Products Targeting performance XLSX.

The app processes files in the browser. It does not upload account data to an external server.

## What It Audits

- Winners not scaled.
- Losers not reduced.
- Profitable terms reduced.
- Unprofitable terms increased.
- Too many bid changes.
- No action despite enough data.
- Needs more data.
- Correctly managed / monitor rows.

## Matching Logic

The app follows the analyst handoff:

- High exact: campaign + ad group + target + match type.
- High canonical: product targeting and auto targeting normalized.
- Medium no-match-type: campaign + ad group + target only.
- Unmatched: kept visible in Data Quality.

## Export Schema Notes

- **Ad Group column:** the value is passed through literally from the Amazon source file. On campaigns where Amazon's report has `Campaign Name == Ad Group Name`, both CSV columns will show the same string. The BidDecisionCard UI suppresses the second line when they match; analysts who pivot the raw CSV will still see the literal source data.
- **ACoS column:** formatted as a percent string (e.g. `29.98%`) consistently across all three exports (Action list, Full CSV, Campaign CSV).
- **Decision ID + Rules Version:** present on every Action list / Full CSV row as the last two columns. Use these to trace a recommendation back to the rule that produced it.
- **Numeric precision:** money rounded to 2 dp, ratios to 4 dp, integers exact. No IEEE-754 tails.

## Current Limitations

- Sponsored Brands rows are isolated unless an SB performance report is added.
- Current bid is unknown when a target has no bid-change history.
- ID-level matching is limited because the Sponsored Products targeting report does not include campaign/ad group/target IDs.
- True profit logic needs SKU margin, fees, COGS, and target ACoS by product.

## Verification

Verified with:

- `amazon-ads-history-api-export-2026-05-15T17-08-40-998Z.csv`
- `Sponsored_Products_Targeting_report.xlsx`

Observed results:

- History rows: 5,271.
- SP history rows: 3,153.
- SB isolated rows: 2,118.
- Targeting rows: 14,968.
- Unique SP target combinations: 1,211.
- Matched combinations: 741.
- Match rate: 61.2%.
- Winners not scaled: 3.
- Waste not reduced: 1.
- Wrong bid changes: 4.
- Too many bid changes: 237.
