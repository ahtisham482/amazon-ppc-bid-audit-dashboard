import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Filter,
  Flame,
  HelpCircle,
  Layers3,
  LineChart,
  Package,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  analyzeFiles,
  classifyReport,
  defaultThresholds,
  isBulkFile,
  parseAcosMap,
  parseBulk,
  readRows,
  readWorkbookSheetNames,
  thresholdsForMode,
} from "./lib/analysis";
import type { BulkTarget } from "./lib/analysis";
import {
  AnalysisResult,
  AuditRow,
  BeforeAfterImpact,
  CampaignSummary,
  Category,
  Mode,
  Priority,
  Thresholds,
  TimelineEntry,
  TimelineKpiVerdict,
  UnmatchedReason,
} from "./lib/types";
import { parseCampaignName, matchTypeLabel } from "./lib/campaign-parser";
import {
  RULES_VERSION,
  dateShort,
  decisionIdFromKey,
  money,
  money2,
  number,
  percent,
} from "./lib/format";
import {
  auditRowToExport,
  campaignToExport,
  downloadText,
  executiveSummaryMarkdown,
  toCsv,
} from "./lib/export";

type Section =
  | "Action Plan"
  | "All Targets"
  | "Campaigns"
  | "Products"
  | "Sponsored Brands"
  | "Help";

const sections: Array<{ id: Section; icon: typeof Activity }> = [
  { id: "Action Plan", icon: Activity },
  { id: "All Targets", icon: Layers3 },
  { id: "Campaigns", icon: BarChart3 },
  { id: "Products", icon: Package },
  { id: "Sponsored Brands", icon: Flame },
  { id: "Help", icon: HelpCircle },
];

/** Maps an engine recommendation to one of three plain buckets. */
type Move = "PUSH" | "HOLD" | "CUT";
function moveOf(row: AuditRow): Move {
  if (row.recommendation === "Increase bid") return "PUSH";
  if (
    row.recommendation === "Reduce bid" ||
    row.recommendation === "Pause / review"
  )
    return "CUT";
  return "HOLD"; // Hold, Collect more data, Review match
}

const categoryColors: Record<string, string> = {
  "Winners Not Scaled": "#0F766E",
  "Losers Not Reduced": "#B45309",
  "Profitable Terms Reduced": "#2563EB",
  "Unprofitable Terms Increased": "#DC2626",
  "No Action Despite Enough Data": "#7C3AED",
  "Too Many Bid Changes": "#92400E",
  "Needs More Data": "#64748B",
  "Correctly Managed": "#16A34A",
  Monitor: "#475569",
};

interface FileInfo {
  name: string;
  rows: number;
}

// ─── Threshold persistence (G3 + G2) ───────────────────────────────────────
const THRESHOLD_STORAGE_KEY = "ppc-auditor:thresholds:v1";

function hasStoredThresholds(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(THRESHOLD_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function loadStoredThresholds(): Thresholds {
  if (typeof window === "undefined") return defaultThresholds;
  try {
    const raw = window.localStorage.getItem(THRESHOLD_STORAGE_KEY);
    if (!raw) return defaultThresholds;
    const parsed = JSON.parse(raw);
    // Defensive: merge over defaults so a future schema add doesn't break old saves.
    return { ...defaultThresholds, ...parsed };
  } catch {
    return defaultThresholds;
  }
}

function saveStoredThresholds(t: Thresholds) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THRESHOLD_STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* localStorage disabled — silently ignore */
  }
}

function clearStoredThresholds() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(THRESHOLD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function isCustomThresholds(t: Thresholds): boolean {
  return (
    t.targetAcos !== defaultThresholds.targetAcos ||
    t.minClicks !== defaultThresholds.minClicks ||
    t.minSpend !== defaultThresholds.minSpend ||
    t.minOrders !== defaultThresholds.minOrders ||
    t.minSales !== defaultThresholds.minSales ||
    t.lookbackDays !== defaultThresholds.lookbackDays ||
    t.attributionDelayDays !== defaultThresholds.attributionDelayDays ||
    t.mode !== defaultThresholds.mode
  );
}

// G4: per-field validity check. Returns "" when valid, else a Sarah-friendly
// error string. Used both for the inline red text under the input and to
// gate the Analyze button.
type ThresholdField =
  | "targetAcos"
  | "minClicks"
  | "minSpend"
  | "minOrders"
  | "lookbackDays";

function thresholdFieldError(field: ThresholdField, t: Thresholds): string {
  switch (field) {
    case "targetAcos": {
      const pct = Math.round(t.targetAcos * 100);
      if (!Number.isFinite(pct) || pct < 1 || pct > 200)
        return "Target ACoS must be between 1% and 200%.";
      return "";
    }
    case "minClicks":
      if (!Number.isFinite(t.minClicks) || t.minClicks < 0)
        return "Min clicks must be 0 or higher.";
      return "";
    case "minSpend":
      if (!Number.isFinite(t.minSpend) || t.minSpend < 0)
        return "Min spend must be 0 or higher.";
      return "";
    case "minOrders":
      if (!Number.isFinite(t.minOrders) || t.minOrders < 0)
        return "Min orders must be 0 or higher.";
      return "";
    case "lookbackDays":
      if (
        !Number.isFinite(t.lookbackDays) ||
        t.lookbackDays < 3 ||
        t.lookbackDays > 30
      )
        return "Lookback must be between 3 and 30 days.";
      return "";
  }
}

function hasInvalidThresholds(t: Thresholds): boolean {
  const fields: ThresholdField[] = [
    "targetAcos",
    "minClicks",
    "minSpend",
    "minOrders",
    "lookbackDays",
  ];
  return fields.some((f) => thresholdFieldError(f, t) !== "");
}

export default function App() {
  const [historyRaw, setHistoryRaw] = useState<
    Record<string, unknown>[] | null
  >(null);
  const [targetingRaw, setTargetingRaw] = useState<
    Record<string, unknown>[] | null
  >(null);
  const [sbRaw, setSbRaw] = useState<Record<string, unknown>[] | null>(null);
  const [bulkTargets, setBulkTargets] = useState<BulkTarget[] | null>(null);
  const [acosMap, setAcosMap] = useState<Map<string, number> | null>(null);
  const [historyInfo, setHistoryInfo] = useState<FileInfo | null>(null);
  const [targetingInfo, setTargetingInfo] = useState<FileInfo | null>(null);
  const [sbInfo, setSbInfo] = useState<FileInfo | null>(null);
  const [bulkInfo, setBulkInfo] = useState<FileInfo | null>(null);
  const [acosInfo, setAcosInfo] = useState<FileInfo | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>(() =>
    loadStoredThresholds(),
  );
  const [thresholdsRestored, setThresholdsRestored] = useState(() =>
    hasStoredThresholds(),
  );
  // Persist threshold edits (debounced) so a refresh doesn't wipe customisations.
  // Clears storage when values return to defaults so the banner doesn't lie on reload.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (isCustomThresholds(thresholds)) saveStoredThresholds(thresholds);
      else clearStoredThresholds();
    }, 300);
    return () => window.clearTimeout(id);
  }, [thresholds]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("Action Plan");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUploads, setShowUploads] = useState(true);
  // G14: surface a toast when auto-detect routes a file to a different box
  // than the one the user dropped it on. Cleared after 4 s.
  const [autoRouteNotice, setAutoRouteNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!autoRouteNotice) return;
    // 4 s in production; long in dev so StrictMode double-mount doesn't race
    // the manual test reads. The toast is auto-cleared on next upload anyway.
    const id = window.setTimeout(() => setAutoRouteNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [autoRouteNotice]);

  // One entry point for every upload. It detects what the file is from its
  // contents and routes it — so it never matters which box you use. The two
  // base files (History + SP Targeting) are required; Bulk / SB report / ACoS
  // map are optional enhancers.
  async function ingest(file: File | null, intended?: Slot) {
    if (!file) return;
    setError(null);
    setIsLoading(true);
    try {
      const name = file.name.toLowerCase();
      const isWorkbook = /\.(xlsx|xlsm|xlsb|xls)$/.test(name);
      if (isWorkbook) {
        const sheets = await readWorkbookSheetNames(file);
        if (isBulkFile(file.name, sheets)) {
          const targets = await parseBulk(file);
          if (!targets.length) {
            setError(
              `"${file.name}" looks like a Bulk file but no Keyword / Product Targeting rows with bids were found.`,
            );
            return;
          }
          setBulkTargets(targets);
          setBulkInfo({ name: file.name, rows: targets.length });
          setResult(null);
          return;
        }
      }
      const rows = await readRows(file);
      const kind = classifyReport(rows.length ? Object.keys(rows[0]) : []);
      // G14: announce when the auto-detector routes the file to a different
      // slot than the one the user clicked / dropped on.
      if (intended && kind !== intended && kind !== "unknown") {
        const slotName: Record<Slot, string> = {
          history: "Box 1 (History)",
          targeting: "Box 2 (SP Targeting)",
          "sb-targeting": "Box 3 (SB report)",
          bulk: "Box 4 (Bulk file)",
          "acos-map": "Box 5 (ACoS map)",
        };
        setAutoRouteNotice(
          `Auto-detected as ${slotName[kind as Slot]} — moved your file there.`,
        );
      }
      if (kind === "history") {
        setHistoryRaw(rows);
        setHistoryInfo({ name: file.name, rows: rows.length });
      } else if (kind === "targeting") {
        setTargetingRaw(rows);
        setTargetingInfo({ name: file.name, rows: rows.length });
      } else if (kind === "sb-targeting") {
        setSbRaw(rows);
        setSbInfo({ name: file.name, rows: rows.length });
      } else if (kind === "acos-map") {
        const map = parseAcosMap(rows);
        if (!map.size) {
          setError(
            `"${file.name}" looks like an ACoS map but no Campaign + Target ACoS rows were found.`,
          );
          return;
        }
        setAcosMap(map);
        setAcosInfo({ name: file.name, rows: map.size });
      } else if (kind === "bulk") {
        const targets = await parseBulk(file);
        setBulkTargets(targets);
        setBulkInfo({ name: file.name, rows: targets.length });
      } else {
        setError(
          `"${file.name}" was not recognised. Expected: the History export, the SP Targeting report, the SB performance report, an Amazon Bulk file, or a Campaign→Target-ACoS map.`,
        );
        return;
      }
      setResult(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Could not read "${file.name}".`,
      );
    } finally {
      setIsLoading(false);
    }
  }

  function buildOpts() {
    return {
      bulkTargets: bulkTargets ?? undefined,
      sbTargetingRaw: sbRaw ?? undefined,
      acosMap: acosMap ?? undefined,
      bulkFileName: bulkInfo?.name,
    };
  }

  function compute(next: Thresholds, opts: { collapseUploads?: boolean } = {}) {
    if (!historyRaw || !targetingRaw) {
      setError(
        "Add both base files: the Amazon Ads History export and the Sponsored Products Targeting report.",
      );
      return;
    }
    setError(null);
    try {
      setResult(
        analyzeFiles(
          historyRaw,
          targetingRaw,
          historyInfo?.name ?? "history",
          targetingInfo?.name ?? "targeting",
          next,
          buildOpts(),
        ),
      );
      // Only collapse on the user-initiated Analyze action — not on
      // threshold/KPI tweaks, which would close the settings panel mid-edit.
      if (opts.collapseUploads) setShowUploads(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to analyze the files.",
      );
    }
  }

  function runAnalysis() {
    compute(thresholds, { collapseUploads: true });
  }

  function updateThresholds(next: Thresholds) {
    setThresholds(next);
    if (historyRaw && targetingRaw && result) compute(next);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <strong>PPC Auditor</strong>
            <span>Bid decisions</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Dashboard sections">
          {sections.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={activeSection === id ? "nav-item active" : "nav-item"}
              aria-current={activeSection === id ? "page" : undefined}
              onClick={() => setActiveSection(id)}
            >
              <Icon size={18} />
              <span>{id}</span>
            </button>
          ))}
        </nav>
        <div className="privacy-note">
          <ShieldCheck size={16} />
          <span>Files process locally in your browser.</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>Amazon PPC — What To Do</h1>
            <p>
              Upload your reports, then see exactly which keywords to{" "}
              <strong>push</strong>, <strong>hold</strong>, or{" "}
              <strong>cut</strong> — in plain English.
            </p>
          </div>
          <div className="topbar-actions">
            <button
              className="button primary"
              onClick={runAnalysis}
              disabled={
                isLoading ||
                !historyRaw ||
                !targetingRaw ||
                hasInvalidThresholds(thresholds)
              }
              title={
                hasInvalidThresholds(thresholds)
                  ? "Fix invalid threshold values to enable Analyze"
                  : undefined
              }
            >
              {isLoading ? (
                <RefreshCw className="spin" size={17} />
              ) : (
                <LineChart size={17} />
              )}
              Analyze
            </button>
          </div>
        </header>

        <section className="uploads-block" aria-label="Upload reports">
          {result && (
            <button
              type="button"
              className="uploads-toggle"
              onClick={() => setShowUploads((v) => !v)}
              aria-expanded={showUploads}
            >
              {showUploads ? "▾" : "▸"} Reports loaded
              <small>
                History {number(historyInfo?.rows ?? 0)} · SP{" "}
                {number(targetingInfo?.rows ?? 0)} rows
                {result &&
                  (() => {
                    const total = result.summary.totalTargets;
                    const matched = result.summary.matchedTargets;
                    const pct =
                      total > 0 ? Math.round((matched / total) * 100) : 0;
                    return (
                      <>
                        {" "}
                        · {number(matched)} of {number(total)} targets matched (
                        {pct}%)
                      </>
                    );
                  })()}
                {sbInfo ? " · SB ✓" : ""}
                {bulkInfo ? " · Bulk ✓" : ""}
                {acosInfo ? " · ACoS map ✓" : ""} — click to change files or
                settings
              </small>
            </button>
          )}
          {showUploads && (
            <>
              <div className="upload-grid">
                <FileDrop
                  title="1 · History"
                  description="Amazon Ads History export"
                  tag="Required"
                  info={historyInfo}
                  busy={isLoading}
                  onFile={ingest}
                  slot="history"
                />
                <FileDrop
                  title="2 · SP Targeting"
                  description="Sponsored Products report"
                  tag="Required"
                  info={targetingInfo}
                  busy={isLoading}
                  onFile={ingest}
                  slot="targeting"
                />
                <FileDrop
                  title="3 · SB report"
                  description="Sponsored Brands report"
                  tag="Optional"
                  info={sbInfo}
                  busy={isLoading}
                  onFile={ingest}
                  slot="sb-targeting"
                />
                <FileDrop
                  title="4 · Bulk file"
                  description="Adds current bids"
                  tag="Optional"
                  info={bulkInfo}
                  busy={isLoading}
                  onFile={ingest}
                  slot="bulk"
                />
                <FileDrop
                  title="5 · ACoS map"
                  description="Per-campaign targets"
                  tag="Optional"
                  info={acosInfo}
                  busy={isLoading}
                  onFile={ingest}
                  slot="acos-map"
                />
              </div>
              <p className="upload-hint">
                Boxes 1 &amp; 2 are required; 3–5 are optional and add depth.
                Wrong box? Files are auto-detected, so it still works. CSV, XLS,
                XLSX all accepted.
              </p>
              <details className="settings-fold">
                <summary>Adjust targets &amp; thresholds (optional)</summary>
                {(thresholdsRestored || isCustomThresholds(thresholds)) && (
                  <div className="threshold-restored">
                    <span>
                      {thresholdsRestored
                        ? "Using your saved thresholds."
                        : "Custom thresholds active."}
                    </span>
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => {
                        clearStoredThresholds();
                        setThresholds(defaultThresholds);
                        setThresholdsRestored(false);
                      }}
                    >
                      Reset to defaults
                    </button>
                  </div>
                )}
                <ThresholdPanel
                  thresholds={thresholds}
                  onChange={updateThresholds}
                />
              </details>
            </>
          )}
        </section>

        {error && (
          <div className="error-banner">
            <AlertTriangle size={18} />
            {error}
          </div>
        )}

        {autoRouteNotice && (
          <div className="auto-route-toast" role="status">
            <CheckCircle2 size={16} />
            {autoRouteNotice}
          </div>
        )}

        {!result ? (
          <EmptyState ready={!!historyRaw && !!targetingRaw} />
        ) : (
          <Dashboard
            activeSection={activeSection}
            result={result}
            thresholds={thresholds}
            onExport={(kind) => handleExport(kind, result)}
            onNavigate={setActiveSection}
          />
        )}
      </main>
    </div>
  );
}

type Slot = "history" | "targeting" | "sb-targeting" | "bulk" | "acos-map";

function FileDrop({
  title,
  description,
  info,
  busy,
  onFile,
  tag,
  slot,
}: {
  title: string;
  description: string;
  info: FileInfo | null;
  busy: boolean;
  onFile: (file: File | null, intended: Slot) => void;
  tag?: "Required" | "Optional";
  slot: Slot;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function pick() {
    inputRef.current?.click();
  }

  // F11: render as <label> so the only tab-stop is the <input type="file">.
  // The visible "Choose/Replace" button is decorative (tabIndex=-1) but still
  // clickable for mouse users.
  const stateText = busy
    ? "Reading file…"
    : info
      ? `✓ ${info.name} · ${info.rows.toLocaleString()} rows`
      : `${description} — click or drop`;
  return (
    <label
      className={`file-drop${dragOver ? " drag-over" : ""}${info ? " has-file" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        onFile(event.dataTransfer.files?.[0] ?? null, slot);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.xlsm,.xlsb,.txt"
        aria-label={`${title} — ${stateText}`}
        onChange={(event) => {
          onFile(event.target.files?.[0] ?? null, slot);
          event.target.value = "";
        }}
      />
      {info ? <CheckCircle2 size={20} /> : <UploadCloud size={20} />}
      <span>
        <strong>
          {title}
          {tag && (
            <em className={`tag ${tag === "Required" ? "req" : "opt"}`}>
              {tag}
            </em>
          )}
        </strong>
        <small>{stateText}</small>
      </span>
      <span className="file-drop-btn" aria-hidden="true">
        {info ? "Replace" : "Choose"}
      </span>
    </label>
  );
}

// G4: shared threshold-input row with inline red error when invalid
function ThresholdField({
  label,
  ariaLabel,
  value,
  min,
  max,
  error,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  min: number;
  max?: number;
  error: string;
  onChange: (v: number) => void;
}) {
  const invalid = error !== "";
  const id = `tf-${ariaLabel.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <label className={invalid ? "threshold-field invalid" : "threshold-field"}>
      {label}
      <input
        id={id}
        type="number"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-err` : undefined}
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {invalid && (
        <small id={`${id}-err`} className="threshold-error" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}

function ThresholdPanel({
  thresholds,
  onChange,
}: {
  thresholds: Thresholds;
  onChange: (next: Thresholds) => void;
}) {
  function setField<K extends keyof Thresholds>(
    field: K,
    value: Thresholds[K],
  ) {
    onChange({ ...thresholds, [field]: value });
  }

  return (
    <div className="threshold-panel">
      <div className="threshold-header">
        <SlidersHorizontal size={18} />
        <strong>Thresholds</strong>
      </div>
      <div className="threshold-grid">
        <ThresholdField
          label="Target ACoS (%)"
          ariaLabel="Target ACoS percentage"
          value={Math.round(thresholds.targetAcos * 100)}
          min={1}
          max={200}
          error={thresholdFieldError("targetAcos", thresholds)}
          onChange={(v) => setField("targetAcos", v / 100)}
        />
        <ThresholdField
          label="Min clicks"
          ariaLabel="Minimum clicks before judging"
          value={thresholds.minClicks}
          min={0}
          error={thresholdFieldError("minClicks", thresholds)}
          onChange={(v) => setField("minClicks", v)}
        />
        <ThresholdField
          label="Min spend ($)"
          ariaLabel="Minimum spend in dollars before judging"
          value={thresholds.minSpend}
          min={0}
          error={thresholdFieldError("minSpend", thresholds)}
          onChange={(v) => setField("minSpend", v)}
        />
        <ThresholdField
          label="Min orders"
          ariaLabel="Minimum orders before judging"
          value={thresholds.minOrders}
          min={0}
          error={thresholdFieldError("minOrders", thresholds)}
          onChange={(v) => setField("minOrders", v)}
        />
        <ThresholdField
          label="Lookback (days)"
          ariaLabel="Lookback window in days"
          value={thresholds.lookbackDays}
          min={3}
          max={30}
          error={thresholdFieldError("lookbackDays", thresholds)}
          onChange={(v) => setField("lookbackDays", v)}
        />
      </div>
      <KpiSelector thresholds={thresholds} onChange={onChange} />
    </div>
  );
}

const KPI_OPTIONS: Array<{
  kpi: "acos" | "cvr" | "ctr" | "roas" | "spend";
  label: string;
  direction: "lower" | "higher";
  unit: "percent" | "dollars" | "ratio";
  defaultThreshold: number;
}> = [
  {
    kpi: "acos",
    label: "ACoS",
    direction: "lower",
    unit: "percent",
    defaultThreshold: 0.25,
  },
  {
    kpi: "cvr",
    label: "CVR",
    direction: "higher",
    unit: "percent",
    defaultThreshold: 0.08,
  },
  {
    kpi: "ctr",
    label: "CTR",
    direction: "higher",
    unit: "percent",
    defaultThreshold: 0.005,
  },
  {
    kpi: "roas",
    label: "ROAS",
    direction: "higher",
    unit: "ratio",
    defaultThreshold: 4,
  },
  {
    kpi: "spend",
    label: "Spend",
    direction: "lower",
    unit: "dollars",
    defaultThreshold: 50,
  },
];

function KpiSelector({
  thresholds,
  onChange,
}: {
  thresholds: Thresholds;
  onChange: (next: Thresholds) => void;
}) {
  const active = new Map((thresholds.kpis ?? []).map((k) => [k.kpi, k]));
  const toggle = (kpi: (typeof KPI_OPTIONS)[number]) => {
    const next = active.has(kpi.kpi)
      ? (thresholds.kpis ?? []).filter((k) => k.kpi !== kpi.kpi)
      : [
          ...(thresholds.kpis ?? []),
          {
            kpi: kpi.kpi,
            threshold:
              kpi.kpi === "acos" ? thresholds.targetAcos : kpi.defaultThreshold,
            direction: kpi.direction,
          },
        ];
    onChange({ ...thresholds, kpis: next });
  };
  const editThreshold = (
    opt: (typeof KPI_OPTIONS)[number],
    inputValue: string,
  ) => {
    const num = Number(inputValue);
    if (!Number.isFinite(num)) return;
    const value = opt.unit === "percent" ? num / 100 : num;
    const next = (thresholds.kpis ?? []).map((k) =>
      k.kpi === opt.kpi ? { ...k, threshold: value } : k,
    );
    onChange({ ...thresholds, kpis: next });
  };
  const display = (
    opt: (typeof KPI_OPTIONS)[number],
    threshold: number,
  ): number =>
    opt.unit === "percent" ? Math.round(threshold * 1000) / 10 : threshold;
  return (
    <div className="kpi-selector">
      <div className="kpi-selector-title">
        Audit KPIs (rolling 7-day, direction only)
      </div>
      <div className="kpi-selector-list">
        {KPI_OPTIONS.map((opt) => {
          const on = active.has(opt.kpi);
          const current = active.get(opt.kpi);
          return (
            <label key={opt.kpi} className={`kpi-pill${on ? " on" : ""}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(opt)}
              />
              <span className="kpi-pill-label">
                {opt.label}{" "}
                <em>{opt.direction === "lower" ? "lower↓" : "higher↑"}</em>
              </span>
              {on && current && (
                <span className="kpi-pill-threshold">
                  ≷
                  <input
                    type="number"
                    value={display(opt, current.threshold)}
                    step={opt.unit === "ratio" ? 0.1 : 1}
                    onChange={(e) => editThreshold(opt, e.target.value)}
                  />
                  {opt.unit === "percent" && <span>%</span>}
                  {opt.unit === "dollars" && <span>$</span>}
                </span>
              )}
            </label>
          );
        })}
      </div>
      <p className="kpi-selector-note">
        Each selected KPI is evaluated independently per date on a rolling 7-day
        window. Verdict is direction only — magnitude of bid changes is ignored.
      </p>
    </div>
  );
}

function EmptyState({ ready = false }: { ready?: boolean }) {
  return (
    <section className="empty-state">
      <div className="empty-copy">
        <FileSpreadsheet size={42} />
        <h2>
          {ready
            ? "Ready when you are — click Analyze."
            : "Add boxes 1 & 2, then click Analyze."}
        </h2>
        <p>
          You&apos;ll get one simple screen: which keywords to{" "}
          <strong>push</strong>, <strong>hold</strong>, or <strong>cut</strong>{" "}
          — each with the plain-English reason behind it.
        </p>
      </div>
      <div className="empty-checklist">
        <div>
          <CheckCircle2 size={18} /> 1 · Bid-Change History export (required)
        </div>
        <div>
          <CheckCircle2 size={18} /> 2 · SP Targeting report (required)
        </div>
        <div>
          <CheckCircle2 size={18} /> 3–5 · SB / Bulk / ACoS map (optional)
        </div>
        <div>
          <CheckCircle2 size={18} /> Everything runs locally in your browser
        </div>
      </div>
    </section>
  );
}

function Dashboard({
  activeSection,
  result,
  thresholds,
  onExport,
  onNavigate,
}: {
  activeSection: Section;
  result: AnalysisResult;
  thresholds: Thresholds;
  onExport: (kind: string) => void;
  onNavigate: (s: Section) => void;
}) {
  return (
    <div className="dashboard">
      {activeSection === "Action Plan" && (
        <ActionPlan
          result={result}
          thresholds={thresholds}
          onExport={onExport}
          onNavigate={onNavigate}
        />
      )}
      {activeSection === "All Targets" && (
        <>
          <StatusStrip result={result} />
          <KpiGrid result={result} />
          <AllTargets
            result={result}
            onExport={onExport}
            lookbackDays={thresholds.lookbackDays}
            targetAcos={thresholds.targetAcos}
          />
        </>
      )}
      {activeSection === "Campaigns" && (
        <CampaignView
          result={result}
          thresholds={thresholds}
          onExport={onExport}
        />
      )}
      {activeSection === "Products" && (
        <ProductsView result={result} thresholds={thresholds} />
      )}
      {activeSection === "Sponsored Brands" && <SBView result={result} />}
      {activeSection === "Help" && (
        <>
          <Methodology result={result} />
          <DataQuality result={result} onExport={onExport} />
        </>
      )}
    </div>
  );
}

const MOVE_META: Record<
  Move,
  { title: string; tone: string; sub: string; metric: "sales" | "spend" }
> = {
  PUSH: {
    title: "PUSH — be aggressive",
    tone: "good",
    sub: "Profitable and under-bid. Raise these bids to win more sales.",
    metric: "sales",
  },
  CUT: {
    title: "CUT — stop the bleed",
    tone: "bad",
    sub: "Losing money and not reduced. Lower or pause these bids.",
    metric: "spend",
  },
  HOLD: {
    title: "HOLD — leave alone",
    tone: "slate",
    sub: "Already fine, too soon to judge, or not enough data. Do nothing yet.",
    metric: "spend",
  },
};

function shortReason(row: AuditRow, lookbackDays: number): string {
  const tgt = `"${row.targeting}"`;
  const acosFmt = row.acos != null ? percent(row.acos) : null;
  const pct =
    row.bidChangePct != null
      ? `${Math.abs(row.bidChangePct * 100).toFixed(0)}%`
      : null;
  switch (row.category) {
    case "Winners Not Scaled":
      return (
        [
          tgt,
          "is profitable",
          acosFmt ? `at ${acosFmt} ACoS` : null,
          pct
            ? `but the bid was just cut ${pct}`
            : "but the bid has not been raised",
        ]
          .filter(Boolean)
          .join(" ") + "."
      );
    case "Losers Not Reduced":
      return (
        [
          tgt,
          "is losing money",
          acosFmt ? `(${acosFmt} ACoS)` : null,
          "but the bid has not been reduced",
        ]
          .filter(Boolean)
          .join(" ") + "."
      );
    case "Profitable Terms Reduced":
      return (
        [
          tgt,
          "was profitable",
          pct ? `but the bid was cut ${pct}` : "but the bid was reduced",
        ]
          .filter(Boolean)
          .join(" ") + "."
      );
    case "Unprofitable Terms Increased":
      return (
        [
          tgt,
          "is unprofitable",
          acosFmt ? `(${acosFmt} ACoS)` : null,
          pct ? `and the bid was raised ${pct}` : "and the bid was raised",
        ]
          .filter(Boolean)
          .join(" ") + "."
      );
    case "Too Many Bid Changes":
      return `${tgt} had ${row.bidChanges} bid changes in the last ${lookbackDays} days — bids were changed again before the previous change had time to show results.`;
    case "No Action Despite Enough Data":
      return (
        [
          tgt,
          "has enough data",
          acosFmt ? `(${acosFmt} ACoS)` : null,
          "but no bid action was taken",
        ]
          .filter(Boolean)
          .join(" ") + "."
      );
    case "Needs More Data":
      return `${tgt} has only ${row.clicks} click${row.clicks !== 1 ? "s" : ""} — not enough to judge yet.`;
    case "Correctly Managed":
      return `${tgt} is on target${acosFmt ? ` at ${acosFmt} ACoS` : ""}.`;
    case "Monitor":
      return `${tgt} is borderline${acosFmt ? ` (${acosFmt} ACoS)` : ""} — watching for now.`;
    default:
      return row.explain.reason;
  }
}

function buildDoThis(row: AuditRow, lookbackDays: number): string {
  const bid = row.latestBid != null ? money2(row.latestBid) : null;
  const prevBid = row.previousBid != null ? money2(row.previousBid) : null;
  const acosFmt = row.acos != null ? percent(row.acos) : null;
  const spendFmt = row.spend > 0 ? money2(row.spend) : null;
  switch (row.category) {
    case "Winners Not Scaled":
      return bid
        ? `Raise the bid above ${bid} — at this level you are leaving profitable sales on the table every day.`
        : "Raise the bid — this target is profitable and under-bidding is costing you sales daily.";
    case "Losers Not Reduced":
      return spendFmt && acosFmt
        ? `Cut the bid — ${spendFmt} spent at ${acosFmt} ACoS is above target; every extra click makes the loss bigger.`
        : "Cut the bid — this target is unprofitable; every click makes the loss bigger.";
    case "Profitable Terms Reduced":
      return prevBid && bid
        ? `Restore the bid toward ${prevBid} — it was profitable before the cut to ${bid} and you are now missing sales.`
        : "Restore the bid — it was cut while the target was profitable, and you are now missing sales.";
    case "Unprofitable Terms Increased":
      return acosFmt
        ? `Reduce the bid — at ${acosFmt} ACoS this target loses money on every sale, and a higher bid buys more of that loss.`
        : "Reduce the bid — this target is unprofitable; raising it makes the problem worse.";
    case "Too Many Bid Changes": {
      const daysSince =
        row.lastBidChangeDate != null
          ? Math.floor(
              (Date.now() - row.lastBidChangeDate.getTime()) / 86_400_000,
            )
          : null;
      const nextReview =
        row.lastBidChangeDate != null
          ? new Date(
              row.lastBidChangeDate.getTime() + lookbackDays * 86_400_000,
            ).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : null;
      return [
        `Stop changing this bid — it moved ${row.bidChanges} times in ${lookbackDays} days.`,
        `A bid needs at least ${lookbackDays} uninterrupted days to generate clean data.`,
        daysSince !== null
          ? `Last change was ${daysSince} day${daysSince !== 1 ? "s" : ""} ago.`
          : null,
        nextReview ? `Next review date: ${nextReview}.` : null,
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "No Action Despite Enough Data":
      return acosFmt
        ? `Act now — ${acosFmt} ACoS with enough clicks means the signal is clear; waiting longer just delays the fix.`
        : "Act now — there is enough data to decide; holding off is leaving money on the table.";
    case "Needs More Data":
      return "Wait — do not change the bid yet. Let it run until there is enough data to judge it fairly.";
    case "Correctly Managed":
      // F6: split bid-direction quality from outcome quality. The card is
      // "Correctly Managed" because the LAST bid move matched performance —
      // it may still be over the ACoS target while it recovers.
      return acosFmt
        ? `Bid direction is correct — keep going. ACoS is ${acosFmt}; watch as it trends toward the target.`
        : "Bid direction is correct — keep going. Let the latest move work before changing again.";
    case "Monitor":
      return "Watch, do not act yet — one more week of data will make the right move clearer.";
    default:
      return row.explain.whyAction;
  }
}

function windowExplain(row: AuditRow, lookbackDays: number): string {
  const imp = row.impact;
  if (imp.status !== "Incomplete window") return row.explain.whyConfidence;
  const postDays = imp.postDays;
  const neededDays = Math.max(imp.preDays, lookbackDays);
  const remaining = Math.max(0, neededDays - postDays);
  let dateNote = "";
  if (row.lastBidChangeDate) {
    const completeDate = new Date(row.lastBidChangeDate.getTime());
    completeDate.setDate(completeDate.getDate() + neededDays);
    dateNote = ` Full picture available after ${completeDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`;
  }
  return (
    `Bid changed ${postDays} day${postDays !== 1 ? "s" : ""} ago. ` +
    `We compare ${neededDays} days before vs. after each bid move to measure impact — ` +
    (remaining > 0
      ? `${remaining} more day${remaining !== 1 ? "s" : ""} needed.`
      : "window just completed.") +
    dateNote
  );
}

// ── Per-target bid timeline chart ──────────────────────────────────────────
type DayAgg = {
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  label: string;
};

type KpiId =
  | "spend"
  | "sales"
  | "acos"
  | "orders"
  | "clicks"
  | "impressions"
  | "ctr"
  | "cvr"
  | "roas"
  | "cpc";

interface KpiDef {
  id: KpiId;
  label: string;
  color: string;
  axis: "money" | "percent" | "count" | "roas";
  dashed?: boolean;
  format: (v: number) => string;
}

const CHART_KPIS: KpiDef[] = [
  {
    id: "spend",
    label: "Spend",
    color: "#2563eb",
    axis: "money",
    format: (v) => `$${v.toFixed(2)}`,
  },
  {
    id: "sales",
    label: "Sales",
    color: "#0891b2",
    axis: "money",
    format: (v) => `$${v.toFixed(2)}`,
  },
  {
    id: "acos",
    label: "ACoS %",
    color: "#ef4444",
    axis: "percent",
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    id: "orders",
    label: "Orders",
    color: "#16a34a",
    axis: "count",
    dashed: true,
    format: (v) => `${v.toFixed(0)}`,
  },
  {
    id: "clicks",
    label: "Clicks",
    color: "#a855f7",
    axis: "count",
    dashed: true,
    format: (v) => `${v.toFixed(0)}`,
  },
  {
    id: "impressions",
    label: "Impressions",
    color: "#64748b",
    axis: "count",
    dashed: true,
    format: (v) => `${v.toFixed(0)}`,
  },
  {
    id: "ctr",
    label: "CTR %",
    color: "#d97706",
    axis: "percent",
    format: (v) => `${v.toFixed(2)}%`,
  },
  {
    id: "cvr",
    label: "CVR %",
    color: "#db2777",
    axis: "percent",
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    id: "roas",
    label: "ROAS",
    color: "#0d9488",
    axis: "roas",
    format: (v) => `${v.toFixed(2)}x`,
  },
  {
    id: "cpc",
    label: "CPC",
    color: "#7c3aed",
    axis: "money",
    format: (v) => `$${v.toFixed(2)}`,
  },
];

const KPI_BY_ID = new Map(CHART_KPIS.map((k) => [k.id, k]));

function BidTimelineChart({
  row,
  targetAcos,
}: {
  row: AuditRow;
  targetAcos: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [visible, setVisible] = useState<Set<KpiId>>(
    () => new Set<KpiId>(["spend", "acos", "orders"]),
  );

  // Build the full day map / bid change map once per row.
  const built = useMemo(() => {
    const dayMap = new Map<string, DayAgg>();
    for (const dr of row.dailyRows) {
      if (!dr.date) continue;
      const k = dr.date.toISOString().slice(0, 10);
      const ex = dayMap.get(k);
      if (ex) {
        ex.spend += dr.spend;
        ex.sales += dr.sales;
        ex.orders += dr.orders;
        ex.clicks += dr.clicks;
        ex.impressions += dr.impressions;
      } else {
        dayMap.set(k, {
          spend: dr.spend,
          sales: dr.sales,
          orders: dr.orders,
          clicks: dr.clicks,
          impressions: dr.impressions,
          label: dr.date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          }),
        });
      }
    }
    const bidChangeMap = new Map<string, (typeof row.allBidChanges)[0]>();
    for (const h of row.allBidChanges) {
      if (!h.time) continue;
      const k = h.time.toISOString().slice(0, 10);
      bidChangeMap.set(k, h);
      if (!dayMap.has(k)) {
        dayMap.set(k, {
          spend: 0,
          sales: 0,
          orders: 0,
          clicks: 0,
          impressions: 0,
          label: h.time.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          }),
        });
      }
    }
    const allDateKeys = [...dayMap.keys()].sort();
    return { dayMap, bidChangeMap, allDateKeys };
  }, [row.dailyRows, row.allBidChanges]);

  // Apply date filter to keys + chart data (compute ALL KPI values per day).
  const filtered = useMemo(() => {
    const { dayMap, allDateKeys } = built;
    const inRange = (k: string) => {
      if (fromDate && k < fromDate) return false;
      if (toDate && k > toDate) return false;
      return true;
    };
    const keys = allDateKeys.filter(inRange);
    const chartData = keys.map((k) => {
      const d = dayMap.get(k)!;
      const acos = d.sales > 0 ? (d.spend / d.sales) * 100 : null;
      const ctr = d.impressions > 0 ? (d.clicks / d.impressions) * 100 : null;
      const cvr = d.clicks > 0 ? (d.orders / d.clicks) * 100 : null;
      const roas = d.spend > 0 ? d.sales / d.spend : null;
      const cpc = d.clicks > 0 ? d.spend / d.clicks : null;
      return {
        dateKey: k,
        label: d.label,
        spend: d.spend > 0 ? d.spend : null,
        sales: d.sales > 0 ? d.sales : null,
        acos,
        orders: d.orders > 0 ? d.orders : null,
        clicks: d.clicks > 0 ? d.clicks : null,
        impressions: d.impressions > 0 ? d.impressions : null,
        ctr,
        cvr,
        roas,
        cpc,
        // Invisible hover anchor — guarantees every date is a tooltip target,
        // including dates that have a bid change but no performance data.
        __hover: 0,
      };
    });
    const tickInterval =
      keys.length > 20
        ? Math.ceil(keys.length / 10) - 1
        : keys.length > 12
          ? 2
          : 0;
    return { keys, chartData, tickInterval };
  }, [built, fromDate, toDate]);

  // Pick which axes to render based on visible KPIs.
  const visibleAxes = useMemo(() => {
    const axes = new Set<KpiDef["axis"]>();
    for (const id of visible) {
      const k = KPI_BY_ID.get(id);
      if (k) axes.add(k.axis);
    }
    return axes;
  }, [visible]);

  const toggleKpi = (id: KpiId) => {
    const next = new Set(visible);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setVisible(next);
  };

  if (row.dailyRows.length < 3) {
    return (
      <p className="bid-timeline-no-data">
        Daily data not available — re-export the targeting report with daily
        granularity to see the timeline.
      </p>
    );
  }

  const { dayMap, bidChangeMap, allDateKeys } = built;
  const { chartData, tickInterval } = filtered;
  const hasBidChanges = row.allBidChanges.length > 0;
  const earliest = allDateKeys[0] ?? "";
  const latest = allDateKeys[allDateKeys.length - 1] ?? "";

  const quickRange = (days: number | null) => {
    if (days == null) {
      setFromDate("");
      setToDate("");
      return;
    }
    if (!latest) return;
    const end = new Date(latest);
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    setFromDate(start.toISOString().slice(0, 10));
    setToDate(latest);
  };

  const chartHeight = expanded ? Math.round(window.innerHeight * 0.65) : 200;

  const chartBody = (
    <div
      className={`bid-timeline-chart${expanded ? " bid-timeline-chart-expanded" : ""}`}
    >
      {!hasBidChanges && (
        <p className="bid-timeline-no-data">
          No bid changes found for this target in the uploaded window —
          performance trend only.
        </p>
      )}
      <ResponsiveContainer width="100%" height={chartHeight}>
        <ComposedChart
          data={chartData}
          margin={{ top: 18, right: 50, bottom: 0, left: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            interval={tickInterval}
          />
          {visibleAxes.has("money") && (
            <YAxis
              yAxisId="money"
              orientation="left"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `$${(v as number).toFixed(0)}`}
              width={46}
            />
          )}
          {visibleAxes.has("percent") && (
            <YAxis
              yAxisId="percent"
              orientation="right"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${(v as number).toFixed(0)}%`}
              width={38}
            />
          )}
          {visibleAxes.has("count") && (
            <YAxis yAxisId="count" orientation="right" hide />
          )}
          {visibleAxes.has("roas") && (
            <YAxis yAxisId="roas" orientation="right" hide />
          )}
          {/* Anchor axis for bid markers when no other axis is visible */}
          {visibleAxes.size === 0 && (
            <YAxis yAxisId="money" orientation="left" hide />
          )}
          {/* Hidden axis backing the invisible hover-anchor line — always present */}
          <YAxis yAxisId="hover" orientation="left" hide domain={[0, 1]} />

          {/* Target ACoS dashed horizontal reference (only when ACoS visible) */}
          {visible.has("acos") && (
            <ReferenceLine
              yAxisId="percent"
              y={targetAcos * 100}
              stroke="#ef4444"
              strokeDasharray="4 3"
              label={{
                value: "Target",
                position: "right",
                fill: "#ef4444",
                fontSize: 10,
              }}
            />
          )}

          {/* Bid change vertical event markers — only within the visible range */}
          {row.allBidChanges.map((h, i) => {
            if (!h.time) return null;
            const k = h.time.toISOString().slice(0, 10);
            if (fromDate && k < fromDate) return null;
            if (toDate && k > toDate) return null;
            const d = dayMap.get(k);
            if (!d) return null;
            const isUp = (h.bidChangePct ?? 0) >= 0;
            const pctStr =
              h.bidChangePct != null
                ? `${isUp ? "+" : ""}${(h.bidChangePct * 100).toFixed(0)}%`
                : "";
            const markerAxis = visibleAxes.has("money")
              ? "money"
              : visibleAxes.has("percent")
                ? "percent"
                : visibleAxes.has("count")
                  ? "count"
                  : visibleAxes.has("roas")
                    ? "roas"
                    : "money";
            return (
              <ReferenceLine
                key={i}
                yAxisId={markerAxis}
                x={d.label}
                stroke={isUp ? "#16a34a" : "#ef4444"}
                strokeWidth={1.5}
                strokeDasharray="4 2"
                label={{
                  value: `${isUp ? "↑" : "↓"}${pctStr}`,
                  position: "top",
                  fill: isUp ? "#16a34a" : "#ef4444",
                  fontSize: 10,
                }}
              />
            );
          })}

          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const pt = payload[0]?.payload as Record<
                string,
                number | string | null
              >;
              const dateKey = pt.dateKey as string;
              const label = pt.label as string;
              // Exact match first — only fall back to neighbouring dates if no exact bid change exists on this day.
              const bcExact = bidChangeMap.get(dateKey);
              const bc =
                bcExact ||
                bidChangeMap.get(
                  allDateKeys[allDateKeys.indexOf(dateKey) - 1] ?? "",
                ) ||
                bidChangeMap.get(
                  allDateKeys[allDateKeys.indexOf(dateKey) + 1] ?? "",
                );
              const hasKpiValues = [...visible].some((id) => {
                const v = pt[id];
                return typeof v === "number" && v != null;
              });
              return (
                <div className="scatter-tooltip">
                  <strong>{bcExact ? `Bid change · ${label}` : label}</strong>
                  {[...visible].map((id) => {
                    const kpi = KPI_BY_ID.get(id);
                    const val = pt[id];
                    if (!kpi || val == null || typeof val !== "number")
                      return null;
                    return (
                      <div key={id} style={{ color: kpi.color }}>
                        {kpi.label}: {kpi.format(val)}
                      </div>
                    );
                  })}
                  {!hasKpiValues && (
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      No performance data on this day.
                    </div>
                  )}
                  {bc?.toBid != null && (
                    <>
                      <div
                        style={{
                          borderTop: "1px solid #e5e7eb",
                          margin: "4px 0 2px",
                          paddingTop: "4px",
                          fontSize: 11,
                          color: "#64748b",
                        }}
                      >
                        ── Bid change ──
                      </div>
                      <div>
                        {money2(bc.fromBid)} → {money2(bc.toBid)}
                        {bc.bidChangePct != null && (
                          <span
                            style={{
                              marginLeft: 4,
                              color:
                                bc.bidChangePct >= 0 ? "#16a34a" : "#ef4444",
                              fontWeight: 600,
                            }}
                          >
                            ({bc.bidChangePct >= 0 ? "+" : ""}
                            {(bc.bidChangePct * 100).toFixed(1)}%)
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            }}
          />

          {/* Invisible hover anchor — guarantees every date is a tooltip target,
              including bid-change dates with zero KPI activity */}
          <Line
            yAxisId="hover"
            type="monotone"
            dataKey="__hover"
            stroke="transparent"
            strokeOpacity={0}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
            connectNulls
          />
          {/* Dynamically render lines for selected KPIs only */}
          {[...visible].map((id) => {
            const kpi = KPI_BY_ID.get(id);
            if (!kpi) return null;
            return (
              <Line
                key={id}
                yAxisId={kpi.axis}
                type="monotone"
                dataKey={kpi.id}
                stroke={kpi.color}
                strokeWidth={1.5}
                strokeDasharray={kpi.dashed ? "4 2" : undefined}
                dot={false}
                connectNulls
                name={kpi.label}
                isAnimationActive={false}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
      {visible.size === 0 && (
        <p className="bid-timeline-no-data">
          Select at least one KPI to view the chart.
        </p>
      )}
    </div>
  );

  const kpiChips = (
    <div className="bid-timeline-kpi-chips">
      {CHART_KPIS.map((kpi) => {
        const on = visible.has(kpi.id);
        return (
          <button
            key={kpi.id}
            type="button"
            className={`kpi-chip${on ? " on" : ""}`}
            onClick={() => toggleKpi(kpi.id)}
          >
            <span className="kpi-chip-dot" style={{ background: kpi.color }} />
            {kpi.label}
          </button>
        );
      })}
    </div>
  );

  const toolbar = (
    <div className="bid-timeline-toolbar">
      <div className="bid-timeline-toolbar-left">
        <label>
          From
          <input
            type="date"
            value={fromDate}
            min={earliest}
            max={latest}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={toDate}
            min={earliest}
            max={latest}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="bid-timeline-range-pill"
          onClick={() => quickRange(7)}
        >
          Last 7 days
        </button>
        <button
          type="button"
          className="bid-timeline-range-pill"
          onClick={() => quickRange(30)}
        >
          Last 30 days
        </button>
        <button
          type="button"
          className="bid-timeline-range-pill"
          onClick={() => quickRange(null)}
        >
          All
        </button>
      </div>
      <button
        type="button"
        className="bid-timeline-expand-btn"
        onClick={() => setExpanded(!expanded)}
        aria-label={expanded ? "Close expanded chart" : "Expand chart"}
      >
        {expanded ? "✕ Close" : "⛶ Expand"}
      </button>
    </div>
  );

  if (expanded) {
    return (
      <div
        className="bid-timeline-modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) setExpanded(false);
        }}
      >
        <div className="bid-timeline-modal">
          <div className="bid-timeline-modal-header">
            <strong>{row.targeting}</strong>
            <span className="bid-timeline-modal-sub">{row.campaign}</span>
          </div>
          {toolbar}
          {kpiChips}
          {chartBody}
        </div>
      </div>
    );
  }

  return (
    <>
      {toolbar}
      {kpiChips}
      {chartBody}
    </>
  );
}

const KPI_LABEL: Record<TimelineKpiVerdict["kpi"], string> = {
  acos: "ACoS",
  cvr: "CVR",
  ctr: "CTR",
  roas: "ROAS",
  spend: "Spend",
};

function formatKpiValue(
  kpi: TimelineKpiVerdict["kpi"],
  value: number | null,
): string {
  if (value == null) return "—";
  if (kpi === "spend") return money2(value);
  if (kpi === "roas") return value.toFixed(2);
  return `${(value * 100).toFixed(1)}%`;
}

function verdictLabel(v: TimelineKpiVerdict["verdict"]): {
  text: string;
  cls: string;
  icon: string;
} {
  switch (v) {
    case "acted_correctly":
      return { text: "Acted correctly", cls: "good", icon: "✓" };
    case "wrong_direction":
      return { text: "Wrong-direction move", cls: "bad", icon: "✗" };
    case "not_reduced":
      return { text: "Not reduced", cls: "bad", icon: "✗" };
    case "not_increased":
      return { text: "Not increased", cls: "bad", icon: "✗" };
    case "no_activity":
      return { text: "No activity in window", cls: "mute", icon: "·" };
    case "no_data":
      return { text: "No data", cls: "mute", icon: "·" };
  }
}

function formatBidChangeInline(
  bc: TimelineKpiVerdict["bidChange"],
): string | null {
  if (!bc) return null;
  const from = bc.fromBid != null ? money2(bc.fromBid) : "—";
  const to = bc.toBid != null ? money2(bc.toBid) : "—";
  const pct =
    bc.changePct != null
      ? ` (${bc.changePct >= 0 ? "+" : ""}${(bc.changePct * 100).toFixed(0)}%)`
      : "";
  const extra = bc.extraChanges > 0 ? ` (+${bc.extraChanges} more)` : "";
  return `${from} → ${to}${pct}${extra}`;
}

function fmtIsoShort(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function ImpactRow({ impact }: { impact: BeforeAfterImpact }) {
  const preRange =
    impact.preStartIso && impact.preEndIso
      ? `${fmtIsoShort(impact.preStartIso)} – ${fmtIsoShort(impact.preEndIso)}`
      : "";
  const postRange =
    impact.postStartIso && impact.postEndIso
      ? `${fmtIsoShort(impact.postStartIso)} – ${fmtIsoShort(impact.postEndIso)}`
      : "";
  const changeDate = fmtIsoShort(impact.changeDateIso);
  const badgeCls =
    impact.label === "Helped"
      ? "helped"
      : impact.label === "Hurt"
        ? "hurt"
        : impact.label === "Inconclusive"
          ? "inconclusive"
          : "nodata";
  return (
    <>
      <div className="why-row">
        <span className="why-lbl">IMPACT</span>
        <div className="why-impact">
          <span className="why-impact-block">
            <span className="why-impact-val">
              {impact.preAcos != null ? percent(impact.preAcos) : "—"}
            </span>
            <span className="why-impact-sub">
              ACoS · {impact.preDays}d before
            </span>
            {preRange && <span className="why-impact-range">{preRange}</span>}
          </span>
          <span className="why-impact-arr">→</span>
          <span className="why-impact-block">
            <span className="why-impact-val">
              {impact.postAcos != null ? percent(impact.postAcos) : "—"}
            </span>
            <span className="why-impact-sub">
              ACoS · {impact.postDays}d after
            </span>
            {postRange && impact.postDays > 0 && (
              <span className="why-impact-range">{postRange}</span>
            )}
          </span>
          <span className="why-impact-block">
            <span className="why-impact-val">{money2(impact.preSales)}</span>
            <span className="why-impact-sub">sales before</span>
          </span>
          <span className="why-impact-arr">→</span>
          <span className="why-impact-block">
            <span className="why-impact-val">{money2(impact.postSales)}</span>
            <span className="why-impact-sub">
              sales after{impact.status === "Incomplete window" ? " *" : ""}
            </span>
          </span>
          <span className={`why-impact-badge ${badgeCls}`}>{impact.label}</span>
        </div>
      </div>
      <div className="why-impact-note-row">
        <span className="why-lbl"></span>
        <span className="why-impact-note">
          Window anchored on bid change on <strong>{changeDate}</strong>.{" "}
          {impact.postDays === 0
            ? "Bid changed today — no after-data yet. Check back tomorrow."
            : impact.status === "Incomplete window"
              ? "* Pre or post window has fewer days than ideal. Verdict may shift as more data collects."
              : "Full before/after window comparison."}
        </span>
      </div>
    </>
  );
}

function TimelineSection({ timeline }: { timeline: TimelineEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  if (timeline.length === 0) return null;
  // Newest first
  const sorted = [...timeline].sort((a, b) => (a.date < b.date ? 1 : -1));
  const visible = showAll ? sorted : sorted.slice(0, 3);
  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  return (
    <div className="why-timeline">
      <div className="why-timeline-head">
        <span className="why-lbl">TIMELINE</span>
        <span className="why-timeline-sub">Rolling 7-day verdict per date</span>
      </div>
      <div className="why-timeline-list">
        {visible.map((entry) => (
          <div key={entry.date} className="why-timeline-row">
            <span className="why-timeline-date">{fmtDate(entry.date)}</span>
            <div className="why-timeline-kpis">
              {entry.perKpi.map((kv) => {
                const v = verdictLabel(kv.verdict);
                const valueText =
                  kv.rolling7Value != null
                    ? formatKpiValue(kv.kpi, kv.rolling7Value)
                    : kv.zeroSalesWithSpend
                      ? "— (0 sales in window)"
                      : kv.noActivity
                        ? "—"
                        : "—";
                const cmp =
                  kv.worseThanThreshold == null
                    ? ""
                    : kv.worseThanThreshold
                      ? ` (worse than ${formatKpiValue(kv.kpi, kv.threshold)})`
                      : ` (better than ${formatKpiValue(kv.kpi, kv.threshold)})`;
                const bidInline = formatBidChangeInline(kv.bidChange);
                const bidNote =
                  kv.bidDirection === null
                    ? "no bid change"
                    : `bid ${kv.bidDirection}`;
                return (
                  <span key={kv.kpi} className={`why-timeline-kpi ${v.cls}`}>
                    <strong>
                      {KPI_LABEL[kv.kpi]} {valueText}
                    </strong>
                    {cmp} · {bidNote}
                    {bidInline && (
                      <span className="why-timeline-bid">{bidInline}</span>
                    )}{" "}
                    →{" "}
                    <em>
                      {v.icon} {v.text}
                    </em>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {sorted.length > 3 && (
        <button
          type="button"
          className="why-more-btn"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "▲ show recent only" : `▼ show all ${sorted.length} dates`}
        </button>
      )}
    </div>
  );
}

// ───────── BidDecisionCard — clean redesign per reference ──────────────────

const CATEGORY_BADGE: Record<
  Category,
  { cls: string; icon: string; label: string }
> = {
  "Correctly Managed": { cls: "ok", icon: "✓", label: "Correctly managed" },
  Monitor: { cls: "monitor", icon: "⊙", label: "Monitor" },
  "Winners Not Scaled": { cls: "warn", icon: "↑", label: "Winners not scaled" },
  "Losers Not Reduced": { cls: "bad", icon: "↓", label: "Losers not reduced" },
  "Profitable Terms Reduced": {
    cls: "bad",
    icon: "✗",
    label: "Profitable cut",
  },
  "Unprofitable Terms Increased": {
    cls: "bad",
    icon: "✗",
    label: "Money-loser raised",
  },
  "Too Many Bid Changes": {
    cls: "warn",
    icon: "⟳",
    label: "Over-managed",
  },
  "Needs More Data": { cls: "muted", icon: "·", label: "Needs more data" },
  "No Action Despite Enough Data": {
    cls: "warn",
    icon: "!",
    label: "No action taken",
  },
};

// decisionIdFromKey + RULES_VERSION moved to lib/format.ts so exports can reuse

function buildSubheadline(row: AuditRow): string {
  const acosFmt = row.acos != null ? percent(row.acos) : null;
  const move = formatBidChangeInline({
    fromBid: row.previousBid,
    toBid: row.latestBid,
    changePct: row.bidChangePct,
    extraChanges: 0,
  });
  switch (row.category) {
    case "Correctly Managed":
      return move
        ? `The last bid move (${move}) matched its performance. "${row.targeting}" is on target${acosFmt ? ` at ${acosFmt} ACoS` : ""}.`
        : `"${row.targeting}" is on target${acosFmt ? ` at ${acosFmt} ACoS` : ""}.`;
    case "Winners Not Scaled":
      return `"${row.targeting}" is profitable${acosFmt ? ` at ${acosFmt} ACoS` : ""} but the bid was not raised — leaving sales on the table.`;
    case "Losers Not Reduced":
      return `"${row.targeting}" is wasteful${acosFmt ? ` at ${acosFmt} ACoS` : ""} and the bid was not reduced.`;
    case "Profitable Terms Reduced":
      return `"${row.targeting}" was profitable${acosFmt ? ` at ${acosFmt} ACoS` : ""} yet the bid was cut${move ? ` (${move})` : ""}.`;
    case "Unprofitable Terms Increased":
      return `"${row.targeting}" is losing money${acosFmt ? ` at ${acosFmt} ACoS` : ""} yet the bid was raised${move ? ` (${move})` : ""}.`;
    case "Too Many Bid Changes":
      return `"${row.targeting}" had ${row.bidChanges} bid changes — more than one on the same day. The data is noisy.`;
    case "Needs More Data":
      return `"${row.targeting}" has ${number(row.clicks)} clicks and ${money2(row.spend)} spend — not enough to judge yet.`;
    case "Monitor":
      return `"${row.targeting}" is borderline${acosFmt ? ` (${acosFmt} ACoS)` : ""} — nothing urgent, watching for now.`;
    default:
      return row.reason;
  }
}

function AcosSparkline({
  timeline,
  targetAcos,
}: {
  timeline: TimelineEntry[];
  targetAcos: number;
}) {
  const points = timeline
    .slice(-7)
    .map((e) => e.perKpi.find((k) => k.kpi === "acos")?.rolling7Value ?? null)
    .filter((v): v is number => v != null);
  if (points.length < 2) return null;
  const lastAcos = points[points.length - 1];
  const ok = lastAcos <= targetAcos;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(max - min, 0.0001);
  const w = 80;
  const h = 18;
  const d = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className="bdc-sparkline"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke={ok ? "#047857" : "#b91c1c"}
        strokeWidth={1.5}
      />
    </svg>
  );
}

function bidPctClass(pct: number | null): string {
  if (pct == null) return "neutral";
  return pct >= 0 ? "pos" : "neg";
}

function BidDecisionCard({
  row,
  lookbackDays = 7,
  targetAcos = 0.25,
}: {
  row: AuditRow;
  lookbackDays?: number;
  targetAcos?: number;
}) {
  const [showChart, setShowChart] = useState(false);
  const [actionState, setActionState] = useState<
    "none" | "snoozed" | "acknowledged"
  >("none");
  const [showAllDates, setShowAllDates] = useState(false);
  const [showRawData, setShowRawData] = useState(false);

  const badge = CATEGORY_BADGE[row.category] ?? {
    cls: "muted",
    icon: "·",
    label: row.category,
  };
  const today = new Date();
  const reviewDate = today.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const headline = buildDoThis(row, lookbackDays);
  const sub = buildSubheadline(row);
  const decisionId = decisionIdFromKey(row.exactKey);

  // Window summary for the meta strip — last `lookbackDays` of dailyRows.
  const windowDates = (() => {
    if (row.dailyRows.length === 0) return null;
    const sorted = [...row.dailyRows]
      .filter((d) => d.date)
      .sort((a, b) => a.date!.getTime() - b.date!.getTime());
    if (sorted.length === 0) return null;
    const last = sorted[sorted.length - 1].date!;
    const first = new Date(last.getTime() - (lookbackDays - 1) * 86_400_000);
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    return `${fmt(first)} – ${fmt(last)}`;
  })();

  // F13: anchor the wording to the actual date so "7 days ago" and "today"
  // never appear on the same card for the same event. Format as
  // "Latest change: May 15 (7 days ago)".
  const lastChangeDateText = row.lastBidChangeDate
    ? (() => {
        const diff = Math.floor(
          (today.getTime() - row.lastBidChangeDate.getTime()) / 86_400_000,
        );
        const fmt = (d: Date) =>
          d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });
        const dateStr = fmt(row.lastBidChangeDate);
        if (diff === 0) return `Latest change: ${dateStr} (today)`;
        if (diff === 1) return `Latest change: ${dateStr} (yesterday)`;
        return `Latest change: ${dateStr} (${diff} days ago)`;
      })()
    : "No bid changes in window";

  // CVR/CPC derived numbers for the WHAT'S HAPPENING grid.
  const cvr = row.cvr != null ? percent(row.cvr) : "—";
  const cpc = row.cpc != null ? money2(row.cpc) : "—";
  const roas = row.roas != null ? `${row.roas.toFixed(2)}×` : "—";
  const avgOrderValue = row.orders > 0 ? money2(row.sales / row.orders) : null;

  const acosOnTarget = row.acos != null && row.acos <= targetAcos;
  const acosContext =
    row.acos == null
      ? "no sales in window"
      : acosOnTarget
        ? `on target · goal ≤ ${Math.round(targetAcos * 100)}%`
        : `above ${Math.round(targetAcos * 100)}% target`;

  const showImpact = row.impact.status !== "No bid change";

  return (
    <div className="bdc">
      {/* HEADER STRIP */}
      <div className="bdc-header">
        <div className="bdc-header-left">
          <div className={`bdc-badge bdc-badge-${badge.cls}`}>{badge.icon}</div>
          <div className="bdc-header-text">
            <div className="bdc-status-line">
              <span>{row.recommendation}</span>
              <span className="bdc-dot-sep">·</span>
              <span>{badge.label}</span>
              <span className="bdc-dot-sep">·</span>
              <span>Reviewed {reviewDate}</span>
            </div>
            <h2 className="bdc-headline">{headline}</h2>
            <p className="bdc-subheadline">{sub}</p>
          </div>
        </div>
        <div className="bdc-header-right">
          <div className="bdc-pills">
            <span className={`bdc-pill bdc-pill-${priorityTone(row.priority)}`}>
              {row.priority} priority
            </span>
            <span className="bdc-pill bdc-pill-muted">
              <span
                className={`bdc-pill-dot ${row.confidence.toLowerCase()}`}
              />
              {row.confidence} confidence · {row.matchLevel.toLowerCase()}
            </span>
          </div>
          <div className="bdc-actions">
            {actionState === "snoozed" && (
              <span className="bdc-action-state">Snoozed · 7d</span>
            )}
            {actionState === "acknowledged" && (
              <span className="bdc-action-state bdc-action-state-ack">
                ✓ Acknowledged
              </span>
            )}
            {actionState === "none" && (
              <>
                <button type="button" className="bdc-btn bdc-btn-ghost">
                  Hide
                </button>
                <button
                  type="button"
                  className="bdc-btn bdc-btn-ghost"
                  onClick={() => setActionState("snoozed")}
                >
                  Snooze 7d
                </button>
                <button
                  type="button"
                  className="bdc-btn bdc-btn-primary"
                  onClick={() => setActionState("acknowledged")}
                >
                  Acknowledge
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* META STRIP */}
      <div className="bdc-meta">
        <div className="bdc-meta-cell">
          <div className="bdc-meta-label">Campaign</div>
          <div className="bdc-meta-value">{row.campaign}</div>
          {row.adGroup && row.adGroup !== row.campaign && (
            <div className="bdc-meta-sub">{row.adGroup}</div>
          )}
        </div>
        <div className="bdc-meta-cell">
          <div className="bdc-meta-label">Target</div>
          <div className="bdc-meta-value">{row.targeting}</div>
          <div className="bdc-meta-sub">
            {row.matchType ? `${row.matchType} match` : "—"}
          </div>
        </div>
        <div className="bdc-meta-cell">
          <div className="bdc-meta-label">Window</div>
          <div className="bdc-meta-value">{windowDates ?? "—"}</div>
          <div className="bdc-meta-sub">Rolling {lookbackDays} days</div>
        </div>
        <div className="bdc-meta-cell">
          <div className="bdc-meta-label">Bid history</div>
          <div className="bdc-meta-value">
            {row.bidChanges} change{row.bidChanges !== 1 ? "s" : ""}
          </div>
          <div className="bdc-meta-sub">{lastChangeDateText}</div>
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="bdc-main">
        {/* LEFT COLUMN */}
        <div className="bdc-col bdc-col-left">
          <section className="bdc-section">
            <div className="bdc-section-label">What's happening</div>
            <div className="bdc-kpi-grid">
              <div className="bdc-kpi">
                <div className="bdc-kpi-label">ACoS</div>
                <div className={`bdc-kpi-value ${acosOnTarget ? "ok" : "bad"}`}>
                  {row.acos != null ? percent(row.acos) : "—"}
                </div>
                <AcosSparkline
                  timeline={row.timeline}
                  targetAcos={targetAcos}
                />
                <div className="bdc-kpi-sub">{acosContext}</div>
              </div>
              <div className="bdc-kpi">
                <div className="bdc-kpi-label">Spend</div>
                <div className="bdc-kpi-value">{money2(row.spend)}</div>
                <div className="bdc-kpi-sub">{lookbackDays}-day rolling</div>
              </div>
              <div className="bdc-kpi">
                <div className="bdc-kpi-label">Sales</div>
                <div className="bdc-kpi-value">{money2(row.sales)}</div>
                <div className="bdc-kpi-sub">
                  {row.orders} order{row.orders !== 1 ? "s" : ""} · {roas} ROAS
                </div>
              </div>
              <div className="bdc-kpi">
                <div className="bdc-kpi-label">Clicks</div>
                <div className="bdc-kpi-value">{number(row.clicks)}</div>
                <div className="bdc-kpi-sub">CVR {cvr}</div>
              </div>
              <div className="bdc-kpi">
                <div className="bdc-kpi-label">Orders</div>
                <div className="bdc-kpi-value">{number(row.orders)}</div>
                <div className="bdc-kpi-sub">
                  {avgOrderValue ? `avg ${avgOrderValue}` : "—"}
                </div>
              </div>
              <div
                className="bdc-kpi"
                title="Average CPC can exceed your max bid because of dynamic bidding (+up to 100%) and placement modifiers — Amazon controls this."
              >
                <div className="bdc-kpi-label">CPC</div>
                <div className="bdc-kpi-value">{cpc}</div>
                <div className="bdc-kpi-sub">
                  {row.currentBid != null
                    ? `at ${money2(row.currentBid)} max bid ⓘ`
                    : row.latestBid != null
                      ? `last bid ${money2(row.latestBid)} ⓘ`
                      : "—"}
                </div>
              </div>
            </div>
          </section>

          {(row.previousBid != null || row.latestBid != null) && (
            <section className="bdc-section">
              <div className="bdc-section-label">Most recent bid move</div>
              <div className="bdc-bid-move">
                <div className="bdc-bid-move-left">
                  {row.previousBid != null && (
                    <span className="bdc-bid-from">
                      {money2(row.previousBid)}
                    </span>
                  )}
                  <span className="bdc-bid-arrow">→</span>
                  {row.latestBid != null && (
                    <span className="bdc-bid-to">{money2(row.latestBid)}</span>
                  )}
                  {row.bidChangePct != null && (
                    <span
                      className={`bdc-bid-chip ${bidPctClass(row.bidChangePct)}`}
                    >
                      {row.bidChangePct >= 0 ? "+" : ""}
                      {(row.bidChangePct * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
                <div className="bdc-bid-move-right">
                  <div>
                    {row.lastBidChangeDate
                      ? row.lastBidChangeDate.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                  </div>
                  <div className="bdc-bid-move-sub">
                    {row.bidChanges > 0 &&
                      `${row.bidChanges}${ordinalSuffix(row.bidChanges)} change`}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div className="bdc-col bdc-col-right">
          {row.timeline.length > 0 && (
            <section className="bdc-section">
              <div className="bdc-section-label">
                How it was decided · Rolling 7-day verdict
              </div>
              <BdcVerdictTimeline
                timeline={row.timeline}
                showAll={showAllDates}
                onToggleAll={() => setShowAllDates(!showAllDates)}
              />
            </section>
          )}

          {showImpact && (
            <section className="bdc-section">
              <div className="bdc-section-label">Impact of latest move</div>
              <BdcImpactSplit impact={row.impact} />
              {(row.impact.postDays === 0 ||
                row.impact.status === "Incomplete window") && (
                <div className="bdc-notice">
                  <span className="bdc-notice-icon">ⓘ</span>
                  <span>
                    {row.impact.postDays === 0
                      ? `Bid changed today — no after-data yet. Anchored on ${fmtIsoShort(row.impact.changeDateIso)}. Check back tomorrow for the first reading.`
                      : `Before/after window is incomplete. Anchored on ${fmtIsoShort(row.impact.changeDateIso)}. Verdict may shift as more data collects.`}
                  </span>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* CHART TOGGLE */}
      {row.dailyRows.length >= 3 ? (
        <div className="bdc-chart-toggle">
          <button
            type="button"
            className="bdc-toggle-btn"
            onClick={() => setShowChart(!showChart)}
          >
            {showChart
              ? "▴ Hide bid timeline chart"
              : "▾ Show bid timeline chart"}
          </button>
          {showChart && (
            <div className="bdc-chart-wrap">
              <BidTimelineChart row={row} targetAcos={targetAcos} />
            </div>
          )}
        </div>
      ) : (
        // G6: explain the chart's absence rather than silently dropping the section.
        // SB cards never reach 3 daily rows because SB reports are summary-level.
        <div className="bdc-chart-placeholder">
          Bid timeline chart not available — Sponsored Brands reports are
          summary-level (a date range, not daily).
        </div>
      )}

      {/* FOOTER */}
      <div className="bdc-footer">
        <div className="bdc-footer-left">
          Decision ID <code>dec_{decisionId}</code> · generated by Rules{" "}
          {RULES_VERSION}
        </div>
        <div className="bdc-footer-right">
          <button
            type="button"
            className="bdc-link"
            onClick={() => setShowRawData(!showRawData)}
          >
            {showRawData ? "Hide raw data" : "View raw data"}
          </button>
        </div>
      </div>
      {showRawData && (
        <pre className="bdc-raw-data">
          {JSON.stringify(
            {
              campaign: row.campaign,
              adGroup: row.adGroup,
              targeting: row.targeting,
              matchType: row.matchType,
              category: row.category,
              recommendation: row.recommendation,
              priority: row.priority,
              confidence: row.confidence,
              matchLevel: row.matchLevel,
              previousBid: row.previousBid,
              latestBid: row.latestBid,
              bidChangePct: row.bidChangePct,
              bidChanges: row.bidChanges,
              spend: row.spend,
              sales: row.sales,
              orders: row.orders,
              clicks: row.clicks,
              acos: row.acos,
              impact: row.impact,
              rule: row.explain.rule,
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function BdcVerdictTimeline({
  timeline,
  showAll,
  onToggleAll,
}: {
  timeline: TimelineEntry[];
  showAll: boolean;
  onToggleAll: () => void;
}) {
  const sorted = [...timeline].sort((a, b) => (a.date < b.date ? 1 : -1));
  const visible = showAll ? sorted : sorted.slice(0, 4);
  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  return (
    <div className="bdc-verdict-list">
      {visible.map((entry, idx) => {
        const isLast = idx === visible.length - 1;
        const firstKpi = entry.perKpi[0];
        if (!firstKpi) return null;
        const v = verdictLabel(firstKpi.verdict);
        const valueText =
          firstKpi.rolling7Value != null
            ? formatKpiValue(firstKpi.kpi, firstKpi.rolling7Value)
            : firstKpi.zeroSalesWithSpend
              ? "— (0 sales)"
              : "—";
        const cmp =
          firstKpi.worseThanThreshold == null
            ? ""
            : firstKpi.worseThanThreshold
              ? ` — worse than ${formatKpiValue(firstKpi.kpi, firstKpi.threshold)}`
              : ` — better than ${formatKpiValue(firstKpi.kpi, firstKpi.threshold)}`;
        const bidText =
          firstKpi.bidDirection === null
            ? "no change"
            : `bid ${firstKpi.bidDirection}`;
        const bidInline = formatBidChangeInline(firstKpi.bidChange);
        return (
          <div key={entry.date} className="bdc-verdict-row">
            <div className="bdc-verdict-bullet-col">
              <span className={`bdc-verdict-dot ${v.cls}`} />
              {!isLast && <span className="bdc-verdict-line" />}
            </div>
            <div className="bdc-verdict-body">
              <div className="bdc-verdict-head">
                <strong>{fmtDate(entry.date)}</strong>
                <span>
                  {KPI_LABEL[firstKpi.kpi]} {valueText}
                  {cmp}, {bidText}
                </span>
              </div>
              {bidInline && <div className="bdc-verdict-bid">{bidInline}</div>}
              <div className={`bdc-verdict-tag ${v.cls}`}>
                {v.icon} {v.text}
              </div>
            </div>
          </div>
        );
      })}
      {sorted.length > 4 && (
        <button type="button" className="bdc-show-all" onClick={onToggleAll}>
          {showAll ? "▴ Show recent only" : `Show all ${sorted.length} dates →`}
        </button>
      )}
    </div>
  );
}

function BdcImpactSplit({ impact }: { impact: BeforeAfterImpact }) {
  const preHasData =
    impact.preDays > 0 &&
    (impact.preAcos != null || impact.preSales > 0 || impact.preSpend > 0);
  const postHasData =
    impact.postDays > 0 &&
    (impact.postAcos != null || impact.postSales > 0 || impact.postSpend > 0);

  // Both sides empty → single muted message (covers SB cards and any case
  // where Sponsored Brands summary-level data prevents before/after compute).
  if (!preHasData && !postHasData) {
    return (
      <div className="bdc-impact-empty">
        Impact comparison will appear once we have at least one day of
        post-bid-change data.
      </div>
    );
  }

  const preRange =
    impact.preStartIso && impact.preEndIso
      ? `${fmtIsoShort(impact.preStartIso)} – ${fmtIsoShort(impact.preEndIso)}`
      : "";
  const postRange =
    impact.postStartIso && impact.postEndIso && impact.postDays > 0
      ? `${fmtIsoShort(impact.postStartIso)} – ${fmtIsoShort(impact.postEndIso)}`
      : "";

  return (
    <div className="bdc-impact-split">
      <div className="bdc-impact-side">
        <div className="bdc-impact-head">
          <div>7 days before</div>
          <div className="bdc-impact-range">{preRange}</div>
        </div>
        <div className="bdc-impact-row">
          <span>ACoS</span>
          <strong>
            {impact.preAcos != null ? percent(impact.preAcos) : "—"}
          </strong>
        </div>
        <div className="bdc-impact-row">
          <span>Sales</span>
          <strong>{money2(impact.preSales)}</strong>
        </div>
      </div>
      <span className="bdc-impact-arr">→</span>
      <div className="bdc-impact-side">
        {postHasData ? (
          <>
            <div className="bdc-impact-head">
              <div>
                {impact.postDays} day{impact.postDays !== 1 ? "s" : ""} after
              </div>
              <div className="bdc-impact-range">{postRange}</div>
            </div>
            <div className="bdc-impact-row">
              <span>ACoS</span>
              <strong>
                {impact.postAcos != null ? percent(impact.postAcos) : "—"}
              </strong>
            </div>
            <div className="bdc-impact-row">
              <span>Sales</span>
              <strong>{money2(impact.postSales)}</strong>
            </div>
          </>
        ) : (
          <div className="bdc-impact-pending">
            After-data pending — check back once a day of activity follows the
            bid change.
          </div>
        )}
      </div>
    </div>
  );
}

function WhyCard(props: {
  row: AuditRow;
  lookbackDays?: number;
  targetAcos?: number;
}) {
  return <BidDecisionCard {...props} />;
}

function MoveItem({
  row,
  lookbackDays,
  targetAcos,
}: {
  row: AuditRow;
  lookbackDays: number;
  targetAcos: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`move-item${open ? " open" : ""}`}>
      <button
        type="button"
        className="move-item-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="move-tgt">
          <strong>{row.targeting}</strong>
          <small>
            {row.campaign}
            {row.matchType && row.matchType !== "-"
              ? ` · ${row.matchType}`
              : ""}
          </small>
        </span>
        <span className="move-nums">
          <span title="ACoS">{percent(row.acos)}</span>
          <span title="Sales">{money2(row.sales)}</span>
          {row.currentBid !== null && (
            <span title="Current bid" className="move-bid">
              bid {money2(row.currentBid)}
            </span>
          )}
        </span>
        <span className="move-toggle">{open ? "Hide" : "Why?"}</span>
      </button>
      {open && (
        <WhyCard
          row={row}
          lookbackDays={lookbackDays}
          targetAcos={targetAcos}
        />
      )}
    </div>
  );
}

function MoveColumn({
  move,
  rows,
  onSeeAll,
  lookbackDays,
  targetAcos,
}: {
  move: Move;
  rows: AuditRow[];
  onSeeAll: () => void;
  lookbackDays: number;
  targetAcos: number;
}) {
  const meta = MOVE_META[move];
  const sorted = rows.slice().sort((a, b) => b.priorityScore - a.priorityScore);
  const top = sorted.slice(0, 10);
  const totalMetric = rows.reduce(
    (sum, r) => sum + (meta.metric === "sales" ? r.sales : r.spend),
    0,
  );
  return (
    <div className={`move-col ${meta.tone}`}>
      <div className="move-col-head">
        <div className="move-count">{number(rows.length)}</div>
        <div>
          <h3>{meta.title}</h3>
          <p>{meta.sub}</p>
        </div>
      </div>
      <div className="move-money">
        {move === "PUSH"
          ? `≈ ${money(totalMetric)} sales in play`
          : move === "CUT"
            ? `≈ ${money(totalMetric)} spend at risk`
            : "No action needed right now"}
      </div>
      {move === "HOLD" && (
        <div className="hold-breakdown">
          {(
            [
              {
                label: "bid changed recently",
                count: rows.filter((r) => r.category === "Too Many Bid Changes")
                  .length,
                tone: "amber",
              },
              {
                label: "not enough data yet",
                count: rows.filter((r) => r.category === "Needs More Data")
                  .length,
                tone: "slate",
              },
              {
                label: "correctly managed",
                count: rows.filter((r) => r.category === "Correctly Managed")
                  .length,
                tone: "good",
              },
              {
                label: "watch",
                count: rows.filter((r) => r.category === "Monitor").length,
                tone: "slate",
              },
            ] as Array<{ label: string; count: number; tone: string }>
          )
            .filter((b) => b.count > 0)
            .map((b) => (
              <span key={b.label} className={`chip ${b.tone} xs`}>
                {number(b.count)} {b.label}
              </span>
            ))}
        </div>
      )}
      <div className="move-list">
        {top.length === 0 && <p className="muted-note">Nothing here. 🎉</p>}
        {top.map((row) => (
          <MoveItem
            key={`${row.campaign}-${row.adGroup}-${row.targeting}-${row.matchType}`}
            row={row}
            lookbackDays={lookbackDays}
            targetAcos={targetAcos}
          />
        ))}
      </div>
      {rows.length > top.length && (
        <button type="button" className="move-seeall" onClick={onSeeAll}>
          See all {number(rows.length)} in All Targets →
        </button>
      )}
    </div>
  );
}

function ActionPlan({
  result,
  thresholds,
  onExport,
  onNavigate,
}: {
  result: AnalysisResult;
  thresholds: Thresholds;
  onExport: (kind: string) => void;
  onNavigate: (s: Section) => void;
}) {
  const s = result.summary;
  const grade = gradeFor(s.decisionScore);
  const push = result.auditRows.filter((r) => moveOf(r) === "PUSH");
  const cut = result.auditRows.filter((r) => moveOf(r) === "CUT");
  const hold = result.auditRows.filter((r) => moveOf(r) === "HOLD");

  return (
    <div className="plan">
      <section className="plan-banner">
        <div className={`plan-grade ${grade.tone}`}>
          <strong>{s.decisionScore}</strong>
          <span>/100</span>
        </div>
        <div className="plan-headline">
          <h2>
            Bid-management health: {grade.label} ·{" "}
            <span className="hl-good">{number(push.length)} to push</span>,{" "}
            <span className="hl-bad">{number(cut.length)} to cut</span>,{" "}
            <span className="hl-muted">{number(hold.length)} to hold</span>
          </h2>
          {/* G15: surface the grading denominator so the score doesn't feel like
              a sweeping verdict on all 1,211 targets when it's actually based on
              the gradeable subset. */}
          <p className="plan-denom">
            Score based on {number(s.scoreBreakdown.judged)} fully-matched
            targets with enough data · {number(s.scoreBreakdown.setAside)} set
            aside (see Help).
          </p>
          <p>
            Start with the green column, then the red. Grey can wait. Click any
            keyword for the exact reason and numbers.{" "}
            <button className="linklike" onClick={() => onNavigate("Help")}>
              Read the rules ↗
            </button>
          </p>
        </div>
        <button className="button ghost" onClick={() => onExport("actions")}>
          <Download size={16} />
          Download action list (CSV)
        </button>
      </section>

      {result.warnings.length > 0 && (
        <details className="plan-warn">
          <summary>
            {result.warnings.length} things to know about the data
          </summary>
          <ul>
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="plan-grid">
        <MoveColumn
          move="PUSH"
          rows={push}
          onSeeAll={() => onNavigate("All Targets")}
          lookbackDays={thresholds.lookbackDays}
          targetAcos={thresholds.targetAcos}
        />
        <MoveColumn
          move="CUT"
          rows={cut}
          onSeeAll={() => onNavigate("All Targets")}
          lookbackDays={thresholds.lookbackDays}
          targetAcos={thresholds.targetAcos}
        />
        <MoveColumn
          move="HOLD"
          rows={hold}
          onSeeAll={() => onNavigate("All Targets")}
          lookbackDays={thresholds.lookbackDays}
          targetAcos={thresholds.targetAcos}
        />
      </div>
      <p className="plan-foot">
        Target ACoS {percent(thresholds.targetAcos, 0)} ·{" "}
        {thresholds.mode.toLowerCase()} mode · need the details? Open{" "}
        <button className="linklike" onClick={() => onNavigate("All Targets")}>
          All Targets
        </button>{" "}
        or{" "}
        <button className="linklike" onClick={() => onNavigate("Campaigns")}>
          Campaigns
        </button>
        .
      </p>
    </div>
  );
}

// F4: chips are now two visually-separated groups so counts make sense:
//   • `category` chips partition the rows (Push / Hold / Cut / All sum cleanly).
//   • `tag` chips overlay onto categories (Winners-not-scaled / Waste-not-cut /
//     Wrong-direction moves / Over-managed). A row can be in multiple tags AND
//     in exactly one category — which is why the chip counts don't sum to All.
// G20: "Wrong direction" → canonical "Wrong-direction moves" everywhere.
const ALL_FILTERS: Array<{
  id: string;
  label: string;
  kind: "category" | "tag";
  tooltip?: string;
  test: (r: AuditRow) => boolean;
}> = [
  { id: "all", label: "All", kind: "category", test: () => true },
  {
    id: "push",
    label: "Push",
    kind: "category",
    test: (r) => moveOf(r) === "PUSH",
  },
  {
    id: "hold",
    label: "Hold",
    kind: "category",
    test: (r) => moveOf(r) === "HOLD",
  },
  {
    id: "cut",
    label: "Cut",
    kind: "category",
    test: (r) => moveOf(r) === "CUT",
  },
  {
    id: "winners",
    label: "Winners not scaled",
    kind: "tag",
    tooltip:
      "Profitable target that was not bid up. Counted in Push/Hold/Cut too.",
    test: (r) =>
      r.category === "Winners Not Scaled" ||
      r.secondaryTags.includes("Winners Not Scaled"),
  },
  {
    id: "waste",
    label: "Waste not cut",
    kind: "tag",
    tooltip: "Money-loser that was not reduced. Counted in Push/Hold/Cut too.",
    test: (r) =>
      r.category === "Losers Not Reduced" ||
      r.secondaryTags.includes("Losers Not Reduced"),
  },
  {
    id: "wrong",
    label: "Wrong-direction moves",
    kind: "tag",
    tooltip:
      "Bid moved opposite to performance (profitable cut, or unprofitable raised). Counted in Push/Hold/Cut too.",
    test: (r) =>
      r.category === "Profitable Terms Reduced" ||
      r.category === "Unprofitable Terms Increased",
  },
  {
    id: "over",
    label: "Over-managed",
    kind: "tag",
    tooltip:
      "Bid changed more than once in the same day. Counted in Push/Hold/Cut too.",
    test: (r) =>
      r.category === "Too Many Bid Changes" ||
      r.secondaryTags.includes("Too Many Bid Changes"),
  },
];

function AllTargets({
  result,
  onExport,
  lookbackDays = 7,
  targetAcos = 0.25,
}: {
  result: AnalysisResult;
  onExport: (kind: string) => void;
  lookbackDays?: number;
  targetAcos?: number;
}) {
  const [filter, setFilter] = useState("all");
  // Compute counts ONCE per audit-rows change — was O(filters × rows) per render.
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const f of ALL_FILTERS) {
      let n = 0;
      for (const r of result.auditRows) if (f.test(r)) n++;
      out[f.id] = n;
    }
    return out;
  }, [result.auditRows]);
  // Memoize the filtered row list so ActionTable's downstream memo doesn't bust.
  const rows = useMemo(() => {
    const active = ALL_FILTERS.find((f) => f.id === filter) ?? ALL_FILTERS[0];
    return result.auditRows.filter(active.test);
  }, [result.auditRows, filter]);
  return (
    <section className="panel full">
      <div className="panel-header">
        <div>
          <h2>All targets</h2>
          <p>
            Every audited keyword/target. Filter, then click "Why?" for the
            exact rule and numbers.
          </p>
        </div>
        <div className="export-row">
          <button className="button ghost" onClick={() => onExport("full")}>
            <Download size={16} />
            Full CSV
          </button>
          <button className="button ghost" onClick={() => onExport("actions")}>
            <Download size={16} />
            Actions
          </button>
        </div>
      </div>
      <div className="filter-chips">
        {ALL_FILTERS.filter((f) => f.kind === "category").map((f) => (
          <button
            key={f.id}
            className={`fchip${filter === f.id ? " active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label} <em>{number(counts[f.id])}</em>
          </button>
        ))}
        <span className="fchip-divider" aria-hidden="true">
          tags (overlap)
        </span>
        {ALL_FILTERS.filter((f) => f.kind === "tag").map((f) => (
          <button
            key={f.id}
            className={`fchip fchip-tag${filter === f.id ? " active" : ""}`}
            onClick={() => setFilter(f.id)}
            title={f.tooltip}
          >
            {f.label} <em>{number(counts[f.id])}</em>
          </button>
        ))}
      </div>
      <ActionTable
        rows={rows}
        lookbackDays={lookbackDays}
        targetAcos={targetAcos}
      />
    </section>
  );
}

function StatusStrip({ result }: { result: AnalysisResult }) {
  return (
    <section className="status-strip">
      <StatusItem
        label="History"
        value={result.historyStatus.reportType}
        sub={`${result.historyStatus.rowCount.toLocaleString()} rows · ${result.historyStatus.dateRange}`}
      />
      <StatusItem
        label="Targeting"
        value={result.targetingStatus.reportType}
        sub={`${result.targetingStatus.rowCount.toLocaleString()} rows · ${result.targetingStatus.dateRange}`}
      />
      <StatusItem
        label="Match rate"
        value={`${percent(result.summary.matchedTargets / Math.max(1, result.summary.totalTargets), 1)}`}
        sub={`${result.summary.matchedTargets.toLocaleString()} of ${result.summary.totalTargets.toLocaleString()} targets`}
      />
      <StatusItem
        label="Unsupported"
        value={`${result.summary.sbHistoryRows.toLocaleString()} SB rows`}
        sub="Isolated until SB performance is uploaded"
      />
    </section>
  );
}

function StatusItem({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="status-item">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

function KpiGrid({ result }: { result: AnalysisResult }) {
  const kpis = [
    {
      label: "Decision score",
      value: `${result.summary.decisionScore}`,
      sub: "0-100 quality score",
      tone: "score",
    },
    {
      label: "Targets analyzed",
      value: number(result.summary.totalTargets),
      sub: `${number(result.summary.matchedTargets)} matched`,
      tone: "neutral",
    },
    {
      label: "Winners not scaled",
      value: number(result.summary.winnersNotScaled),
      sub: money(result.summary.estimatedMissedSales),
      tone: "good",
    },
    {
      label: "Waste not reduced",
      value: number(result.summary.losersNotReduced),
      sub: money(result.summary.estimatedWastedSpend),
      tone: "warn",
    },
    {
      label: "Wrong bid changes",
      value: number(
        result.summary.wrongIncreases + result.summary.wrongReductions,
      ),
      sub: `${result.summary.wrongIncreases} inc · ${result.summary.wrongReductions} red`,
      tone: "bad",
    },
    {
      label: "Too many changes",
      value: number(result.summary.tooManyBidChanges),
      sub: "Repeated bid edits",
      tone: "amber",
    },
  ];

  return (
    <section className="kpi-grid">
      {kpis.map((kpi) => (
        <div className={`kpi ${kpi.tone}`} key={kpi.label}>
          <span>{kpi.label}</span>
          <strong>{kpi.value}</strong>
          <small>{kpi.sub}</small>
        </div>
      ))}
    </section>
  );
}

function gradeFor(score: number) {
  if (score >= 80) return { label: "Strong", tone: "good" };
  if (score >= 60) return { label: "Fair", tone: "amber" };
  if (score >= 40) return { label: "Needs work", tone: "warn" };
  return { label: "Poor", tone: "bad" };
}

const PAGE_SIZE = 100;
const COMPACT_LIMIT = 18;

function ActionTable({
  rows,
  compact = false,
  lookbackDays = 7,
  targetAcos = 0.25,
}: {
  rows: AuditRow[];
  compact?: boolean;
  lookbackDays?: number;
  targetAcos?: number;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [priority, setPriority] = useState("All");
  const [sort, setSort] = useState<
    "priorityScore" | "spend" | "sales" | "acos" | "bidChanges"
  >("priorityScore");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(1);

  // Memoize the category dropdown options — was O(rows) on every render.
  const categoryOptions = useMemo(
    () => unique(rows.map((row) => row.category)),
    [rows],
  );

  // Reset pagination when filters/sort/rows change so we always show top-N first.
  const filterSig = `${category}|${priority}|${sort}|${search.trim().toLowerCase()}`;
  const lastSigRef = useRef(filterSig);
  if (lastSigRef.current !== filterSig) {
    lastSigRef.current = filterSig;
    if (pageCount !== 1) setPageCount(1);
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter((row) => category === "All" || row.category === category)
      .filter((row) => priority === "All" || row.priority === priority)
      .filter((row) => {
        if (!needle) return true;
        const haystack =
          `${row.campaign} ${row.adGroup} ${row.targeting} ${row.reason}`.toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => Number(b[sort] ?? 0) - Number(a[sort] ?? 0));
  }, [category, priority, rows, search, sort]);

  // Pagination — cap visible rows to avoid rendering thousands of <tr> cells at once.
  const visibleCount = compact
    ? COMPACT_LIMIT
    : Math.min(filtered.length, PAGE_SIZE * pageCount);
  const visibleRows = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  return (
    <div>
      {!compact && (
        <div className="table-tools">
          <label className="search-box">
            <Search size={16} />
            <input
              type="search"
              aria-label="Search campaign, target, or reason"
              placeholder="Search campaign, target, reason"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            <Filter size={15} />
            <span className="visually-hidden">Category</span>
            <select
              aria-label="Filter by category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option>All</option>
              {categoryOptions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              aria-label="Filter by priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              <option>All</option>
              {(
                ["Critical", "High", "Medium", "Low", "Watch"] as Priority[]
              ).map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Sort
            <select
              aria-label="Sort by"
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="priorityScore">Priority</option>
              <option value="spend">Spend</option>
              <option value="sales">Sales</option>
              <option value="acos">ACoS</option>
              <option value="bidChanges">Bid changes</option>
            </select>
          </label>
        </div>
      )}
      <div className="table-wrap">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Priority</th>
              <th>Action</th>
              <th>Reason</th>
              <th>Campaign</th>
              <th>Target</th>
              <th>Spend</th>
              <th>Sales</th>
              <th>Orders</th>
              <th>ACoS</th>
              <th>Bid</th>
              <th>Changes</th>
              <th>Confidence</th>
              <th>Why?</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const rowKey = `${row.campaign}-${row.adGroup}-${row.targeting}-${row.matchType}`;
              const isOpen = openRow === rowKey;
              return (
                <Fragment key={rowKey}>
                  <tr className={`audit-row${isOpen ? " row-open" : ""}`}>
                    <td>
                      <Badge tone={priorityTone(row.priority)}>
                        {row.priority}
                      </Badge>
                    </td>
                    <td>
                      <strong>{row.recommendation}</strong>
                      <small>{row.category}</small>
                    </td>
                    <td className="reason-cell">{row.reason}</td>
                    <td>
                      <span>{row.campaign}</span>
                      {row.adGroup !== row.campaign && (
                        <small>{row.adGroup}</small>
                      )}
                    </td>
                    <td>
                      <span>{row.targeting}</span>
                      <small>{row.matchType}</small>
                    </td>
                    <td>{money2(row.spend)}</td>
                    <td>{money2(row.sales)}</td>
                    <td>{number(row.orders)}</td>
                    <td>{percent(row.acos)}</td>
                    <td>
                      <span>
                        {money2(row.previousBid)} → {money2(row.latestBid)}
                      </span>
                      <small>{percent(row.bidChangePct)}</small>
                    </td>
                    <td>
                      <span>{row.bidChanges}</span>
                      <small>{dateShort(row.lastBidChangeDate)}</small>
                    </td>
                    <td>
                      <Badge tone="slate">{row.confidence}</Badge>
                      <small>{row.matchLevel}</small>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="why-btn"
                        aria-expanded={isOpen}
                        onClick={() => setOpenRow(isOpen ? null : rowKey)}
                      >
                        {isOpen ? "Hide" : "Why?"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="why-detail">
                      <td colSpan={13}>
                        <WhyCard
                          row={row}
                          lookbackDays={lookbackDays}
                          targetAcos={targetAcos}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!compact && filtered.length > visibleCount && (
        <div className="table-pager">
          <span className="table-pager-info">
            Showing {number(visibleCount)} of {number(filtered.length)} targets
          </span>
          <button
            type="button"
            className="button ghost"
            onClick={() => setPageCount((p) => p + 1)}
          >
            Load next {Math.min(PAGE_SIZE, filtered.length - visibleCount)}
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => setPageCount(Math.ceil(filtered.length / PAGE_SIZE))}
          >
            Load all
          </button>
        </div>
      )}
    </div>
  );
}

function campaignProblemLine(c: CampaignSummary) {
  const items: Array<[number, string]> = [
    [c.tooManyBidChanges, "changed too often"],
    [c.wrongBidChanges, "bid moves in the wrong direction"],
    [c.losersNotReduced, "money-losers not cut"],
    [c.winnersNotScaled, "winners not scaled up"],
  ];
  const worst = items.filter(([n]) => n > 0).sort((a, b) => b[0] - a[0])[0];
  if (!worst) {
    return c.unmatched > 0
      ? `No clear problems — but ${c.unmatched} target(s) here could not be matched to bid history.`
      : "No clear bid-management problems in this campaign.";
  }
  return `Main issue: ${worst[0]} ${worst[0] === 1 ? "target" : "targets"} ${worst[1]}.`;
}

function acosHeatClass(acos: number | null, targetAcos: number) {
  if (acos == null) return "muted";
  if (acos >= targetAcos * 1.5) return "bad";
  if (acos >= targetAcos) return "warn";
  return "good";
}

function AdGroupRow({
  row,
  auditRows,
  targetAcos,
}: {
  row: CampaignSummary;
  auditRows: AuditRow[];
  targetAcos: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const agRows = auditRows.filter((r) => r.adGroup === row.campaign);
  const heatClass = acosHeatClass(row.acos, targetAcos);
  return (
    <Fragment>
      <tr
        className={`ag-row${expanded ? " ag-open" : ""}${agRows.length > 0 ? " ag-clickable" : ""}`}
        onClick={() => agRows.length > 0 && setExpanded(!expanded)}
      >
        <td className="ag-name-cell">
          {agRows.length > 0 && (
            <span className="ag-toggle">{expanded ? "▾" : "▸"}</span>
          )}
          {row.campaign}
        </td>
        <td>{money(row.spend)}</td>
        <td className={`ag-acos ag-acos-${heatClass}`}>{percent(row.acos)}</td>
        <td>{number(row.targets)}</td>
        <td>
          <span className="ag-chips">
            {row.winnersNotScaled > 0 && (
              <span className="chip good xs" title="Winners not scaled">
                +{row.winnersNotScaled}
              </span>
            )}
            {row.losersNotReduced > 0 && (
              <span className="chip warn xs" title="Losers not reduced">
                -{row.losersNotReduced}
              </span>
            )}
            {row.wrongBidChanges > 0 && (
              <span className="chip bad xs" title="Wrong bid direction">
                ✗{row.wrongBidChanges}
              </span>
            )}
            {row.tooManyBidChanges > 0 && (
              <span className="chip amber xs" title="Too many bid changes">
                ⟳{row.tooManyBidChanges}
              </span>
            )}
            {row.issueCount === 0 && (
              <span className="chip slate xs">clean</span>
            )}
          </span>
        </td>
        <td>{row.unmatched > 0 ? row.unmatched : "—"}</td>
        <td className="reason-cell">{campaignProblemLine(row)}</td>
      </tr>
      {expanded && agRows.length > 0 && (
        <tr className="ag-expand-row">
          <td colSpan={7} className="ag-expand-cell">
            <ActionTable rows={agRows} compact targetAcos={targetAcos} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

interface ProductKpi {
  productCode: string;
  spend: number;
  sales: number;
  orders: number;
  targets: number;
  issueCount: number;
  acos: number | null;
  campaigns: number;
}

function ProductsView({
  result,
  thresholds,
}: {
  result: AnalysisResult;
  thresholds: Thresholds;
}) {
  const targetAcos = thresholds.targetAcos;
  const [sortField, setSortField] = useState<
    "spend" | "sales" | "orders" | "acos" | "issueCount" | "targets"
  >("spend");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [clickFilter, setClickFilter] = useState<string | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  function handleSort(field: typeof sortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const allProducts = useMemo<ProductKpi[]>(() => {
    const map = new Map<
      string,
      {
        spend: number;
        sales: number;
        orders: number;
        targets: number;
        issueCount: number;
        campaigns: Set<string>;
      }
    >();
    for (const r of result.auditRows) {
      const key = parseCampaignName(r.campaign).productCode || r.campaign;
      if (!map.has(key)) {
        map.set(key, {
          spend: 0,
          sales: 0,
          orders: 0,
          targets: 0,
          issueCount: 0,
          campaigns: new Set(),
        });
      }
      const entry = map.get(key)!;
      entry.spend += r.spend;
      entry.sales += r.sales;
      entry.orders += r.orders;
      entry.targets++;
      if (
        r.category !== "Correctly Managed" &&
        r.category !== "Monitor" &&
        r.category !== "Needs More Data"
      ) {
        entry.issueCount++;
      }
      entry.campaigns.add(r.campaign);
    }
    return Array.from(map.entries()).map(
      ([productCode, data]): ProductKpi => ({
        productCode,
        spend: data.spend,
        sales: data.sales,
        orders: data.orders,
        targets: data.targets,
        issueCount: data.issueCount,
        acos: data.sales > 0 ? data.spend / data.sales : null,
        campaigns: data.campaigns.size,
      }),
    );
  }, [result.auditRows]);

  const products = useMemo(() => {
    let ps = allProducts;
    if (clickFilter) ps = ps.filter((p) => p.productCode === clickFilter);
    if (search)
      ps = ps.filter((p) =>
        p.productCode.toLowerCase().includes(search.toLowerCase()),
      );
    if (statusFilter === "Over target")
      ps = ps.filter((p) => p.acos != null && p.acos >= targetAcos);
    else if (statusFilter === "Under target")
      ps = ps.filter((p) => p.acos != null && p.acos < targetAcos);
    else if (statusFilter === "No data") ps = ps.filter((p) => p.acos == null);
    if (issuesOnly) ps = ps.filter((p) => p.issueCount > 0);
    return ps.slice().sort((a, b) => {
      const mult = sortDir === "desc" ? 1 : -1;
      if (sortField === "acos")
        return mult * ((b.acos ?? 999) - (a.acos ?? 999));
      return mult * (b[sortField] - a[sortField]);
    });
  }, [
    allProducts,
    clickFilter,
    search,
    statusFilter,
    issuesOnly,
    sortField,
    sortDir,
    targetAcos,
  ]);

  const overTarget = allProducts.filter(
    (p) => p.acos != null && p.acos >= targetAcos,
  ).length;
  const totalSpend = allProducts.reduce((s, p) => s + p.spend, 0);
  const totalOrders = allProducts.reduce((s, p) => s + p.orders, 0);
  const wastedSpend = allProducts.reduce((s, p) => {
    if (p.acos == null || p.acos <= targetAcos) return s;
    return s + p.spend * ((p.acos - targetAcos) / p.acos);
  }, 0);

  const scatterData = allProducts
    .filter((p) => p.acos != null)
    .map((p) => ({
      x: p.spend,
      y: (p.acos as number) * 100,
      z: Math.max(p.targets * 5, 40),
      name: p.productCode,
      spend: p.spend,
      orders: p.orders,
      issueCount: p.issueCount,
      fill:
        (p.acos as number) >= targetAcos * 1.5
          ? "#ef4444"
          : (p.acos as number) >= targetAcos
            ? "#f59e0b"
            : "#10b981",
    }));

  function SortTh({
    field,
    label,
  }: {
    field: typeof sortField;
    label: string;
  }) {
    const active = sortField === field;
    return (
      <th
        className={`sort-th${active ? " sort-active" : ""}`}
        onClick={() => handleSort(field)}
      >
        {label}
        <span className="sort-arrow">
          {active ? (sortDir === "desc" ? " ▾" : " ▴") : " ↕"}
        </span>
      </th>
    );
  }

  return (
    <div className="products-page">
      {/* KPI summary strip */}
      <div className="product-kpi-strip">
        <div className="product-kpi-card">
          <span className="product-kpi-label">Products</span>
          <strong className="product-kpi-value">
            {number(allProducts.length)}
          </strong>
        </div>
        <div className="product-kpi-card bad">
          <span className="product-kpi-label">Over target ACoS</span>
          <strong className="product-kpi-value">{number(overTarget)}</strong>
        </div>
        <div className="product-kpi-card">
          <span className="product-kpi-label">Total spend</span>
          <strong className="product-kpi-value">{money(totalSpend)}</strong>
        </div>
        <div className="product-kpi-card warn">
          <span className="product-kpi-label">Est. wasted spend</span>
          <strong className="product-kpi-value">{money(wastedSpend)}</strong>
        </div>
        <div className="product-kpi-card">
          <span className="product-kpi-label">Total orders</span>
          <strong className="product-kpi-value">{number(totalOrders)}</strong>
        </div>
      </div>

      {/* Scatter chart */}
      <section className="panel full">
        <div className="panel-header">
          <div>
            <h2>Spend vs ACoS</h2>
            <p>
              Each dot = one product. Size = number of targets. Click a dot to
              filter the table below. Dashed line = target ACoS (
              {percent(targetAcos)}).
            </p>
          </div>
          {clickFilter && (
            <button
              className="button ghost"
              onClick={() => setClickFilter(null)}
            >
              Clear filter ✕
            </button>
          )}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="x"
              name="Spend"
              tickFormatter={(v) => `$${v.toFixed(0)}`}
              label={{
                value: "Spend ($)",
                position: "insideBottom",
                offset: -2,
                fontSize: 11,
              }}
            />
            <YAxis
              dataKey="y"
              name="ACoS"
              unit="%"
              label={{
                value: "ACoS %",
                angle: -90,
                position: "insideLeft",
                fontSize: 11,
              }}
            />
            <ZAxis dataKey="z" range={[40, 300]} />
            <ReferenceLine
              y={targetAcos * 100}
              stroke="#ef4444"
              strokeDasharray="5 3"
              label={{
                value: "Target",
                position: "right",
                fill: "#ef4444",
                fontSize: 11,
              }}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="scatter-tooltip">
                    <strong>{d.name}</strong>
                    <div>Spend: {money(d.spend)}</div>
                    <div>ACoS: {d.y.toFixed(1)}%</div>
                    <div>Orders: {number(d.orders)}</div>
                    <div>Issues: {d.issueCount}</div>
                  </div>
                );
              }}
            />
            <Scatter
              data={scatterData}
              shape={(rawProps: unknown) => {
                const props = rawProps as Record<string, unknown>;
                const cx = props.cx as number;
                const cy = props.cy as number;
                const payload = props.payload as {
                  z: number;
                  fill: string;
                  name: string;
                };
                const r = Math.sqrt(payload.z / Math.PI);
                const isSelected = clickFilter === payload.name;
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={payload.fill}
                    fillOpacity={0.75}
                    stroke={isSelected ? "#1e293b" : "transparent"}
                    strokeWidth={2}
                    style={{ cursor: "pointer" }}
                    onClick={() =>
                      setClickFilter((prev) =>
                        prev === payload.name ? null : payload.name,
                      )
                    }
                  />
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </section>

      {/* Table */}
      <section className="panel full">
        <div className="panel-header">
          <div>
            <h2>Product breakdown</h2>
            <p>Click any row to see its individual targets.</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="product-filter-bar">
          <label className="search-box">
            <Search size={14} />
            <input
              type="search"
              aria-label="Search product"
              placeholder="Search product"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            Status
            <select
              aria-label="Filter products by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option>All</option>
              <option>Over target</option>
              <option>Under target</option>
              <option>No data</option>
            </select>
          </label>
          <label className="product-issues-toggle">
            <input
              type="checkbox"
              checked={issuesOnly}
              onChange={(e) => setIssuesOnly(e.target.checked)}
            />
            Issues only
          </label>
          {(search || statusFilter !== "All" || issuesOnly || clickFilter) && (
            <button
              className="button ghost"
              onClick={() => {
                setSearch("");
                setStatusFilter("All");
                setIssuesOnly(false);
                setClickFilter(null);
              }}
            >
              Reset ✕
            </button>
          )}
          <span className="product-filter-count">
            {products.length} / {allProducts.length} products
          </span>
        </div>

        <div className="table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Product</th>
                <SortTh field="spend" label="Spend" />
                <SortTh field="sales" label="Sales" />
                <SortTh field="orders" label="Orders" />
                <SortTh field="acos" label="ACoS" />
                <th>Status</th>
                <SortTh field="targets" label="Targets" />
                <SortTh field="issueCount" label="Issue rate" />
                <th>Campaigns</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, productIdx) => {
                const heatClass = acosHeatClass(p.acos, targetAcos);
                const issueRate = p.targets > 0 ? p.issueCount / p.targets : 0;
                const isExpanded =
                  expandedProduct === `${p.productCode}#${productIdx}`;
                const productRows = result.auditRows.filter(
                  (r) =>
                    (parseCampaignName(r.campaign).productCode ||
                      r.campaign) === p.productCode,
                );
                // G5: when the same productCode appears more than once, label
                // each occurrence "(N of M)" so Sarah can tell them apart even
                // though Amazon's report doesn't carry distinct ASINs here.
                const sameCodeAll = products.filter(
                  (q) => q.productCode === p.productCode,
                );
                const sameCodeIdx = sameCodeAll.findIndex((q) => q === p) + 1;
                const dupSuffix =
                  sameCodeAll.length > 1
                    ? ` (${sameCodeIdx} of ${sameCodeAll.length})`
                    : "";
                // Pull the first ASIN target inside this product (if any) as
                // a hint of what the product actually is.
                const asinHint = (() => {
                  const asinRow = productRows.find((r) =>
                    /^asin=/i.test(r.targeting),
                  );
                  if (!asinRow) return null;
                  const m = asinRow.targeting.match(
                    /asin\s*=\s*"?([A-Z0-9]{6,})/i,
                  );
                  return m ? m[1] : null;
                })();
                const rowKey = `${p.productCode}#${productIdx}`;
                return (
                  <Fragment key={rowKey}>
                    <tr
                      className={`product-row${isExpanded ? " product-row-open" : ""}${productRows.length > 0 ? " product-row-clickable" : ""}`}
                      onClick={() =>
                        productRows.length > 0 &&
                        setExpandedProduct(isExpanded ? null : rowKey)
                      }
                    >
                      <td className="product-name-cell">
                        {productRows.length > 0 && (
                          <span className="ag-toggle">
                            {isExpanded ? "▾" : "▸"}
                          </span>
                        )}
                        <span>
                          {p.productCode}
                          {dupSuffix && (
                            <span className="product-dup-suffix">
                              {dupSuffix}
                            </span>
                          )}
                        </span>
                        {asinHint && (
                          <small className="product-asin-hint">
                            ASIN {asinHint}
                          </small>
                        )}
                      </td>
                      <td>{money(p.spend)}</td>
                      <td>{money(p.sales)}</td>
                      <td>{number(p.orders)}</td>
                      <td className={`ag-acos ag-acos-${heatClass}`}>
                        {percent(p.acos)}
                        <span className="product-acos-target">
                          {" "}
                          / {percent(targetAcos)}
                        </span>
                      </td>
                      <td>
                        {p.acos == null ? (
                          <span className="chip slate">No data</span>
                        ) : p.acos >= targetAcos ? (
                          <span className="chip bad">Over target</span>
                        ) : (
                          <span className="chip good">On target</span>
                        )}
                      </td>
                      <td>{number(p.targets)}</td>
                      <td>
                        <div className="product-issue-bar">
                          <div className="product-issue-track">
                            <div
                              className="product-issue-fill"
                              style={{
                                width: `${Math.min(issueRate * 100, 100)}%`,
                              }}
                            />
                          </div>
                          <span>
                            {p.issueCount} / {p.targets} ·{" "}
                            {Math.round(issueRate * 100)}%
                          </span>
                        </div>
                      </td>
                      <td>{number(p.campaigns)}</td>
                    </tr>
                    {isExpanded && productRows.length > 0 && (
                      <tr className="ag-expand-row">
                        <td colSpan={9} className="ag-expand-cell">
                          <ActionTable
                            rows={productRows}
                            compact
                            lookbackDays={thresholds.lookbackDays}
                            targetAcos={thresholds.targetAcos}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CampaignCard({
  c,
  auditRows,
  targetAcos = 0.25,
}: {
  c: CampaignSummary;
  auditRows: AuditRow[];
  targetAcos?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseCampaignName(c.campaign);
  const campaignRows = auditRows.filter((r) => r.campaign === c.campaign);
  return (
    <div className={`campaign-card${expanded ? " expanded" : ""}`}>
      <div className="campaign-card-top">
        {parsed.valid && parsed.productCode && (
          <span className="campaign-product-code">{parsed.productCode}</span>
        )}
        <strong className="campaign-name">{c.campaign}</strong>
        <span className="campaign-meta">
          {money(c.spend)} spend · {percent(c.acos)} ACoS · {number(c.targets)}{" "}
          {c.targets === 1 ? "target" : "targets"}
        </span>
      </div>
      <p className="campaign-problem">{campaignProblemLine(c)}</p>
      <div className="chip-row">
        {c.winnersNotScaled > 0 && (
          <span className="chip good">
            {c.winnersNotScaled} winners not scaled
          </span>
        )}
        {c.losersNotReduced > 0 && (
          <span className="chip warn">{c.losersNotReduced} waste not cut</span>
        )}
        {c.wrongBidChanges > 0 && (
          <span className="chip bad">{c.wrongBidChanges} wrong-direction</span>
        )}
        {c.tooManyBidChanges > 0 && (
          <span className="chip amber">{c.tooManyBidChanges} over-managed</span>
        )}
        {c.unmatched > 0 && (
          <span className="chip slate">{c.unmatched} unmatched</span>
        )}
      </div>
      {campaignRows.length > 0 && (
        <button
          type="button"
          className="campaign-drill-btn"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded
            ? "Hide targets ▴"
            : `View ${campaignRows.length} ${campaignRows.length === 1 ? "target" : "targets"} ▾`}
        </button>
      )}
      {expanded && (
        <div className="campaign-drill">
          {parsed.valid && (
            <div className="parsed-chips">
              {parsed.adType && (
                <span className="parsed-chip">{parsed.adType}</span>
              )}
              {parsed.mode && (
                <span className="parsed-chip">
                  {parsed.mode === "M" ? "Manual" : parsed.mode}
                </span>
              )}
              {parsed.matchType && (
                <span className="parsed-chip">
                  {matchTypeLabel(parsed.matchType)}
                </span>
              )}
              {parsed.strategy && (
                <span className="parsed-chip">{parsed.strategy}</span>
              )}
            </div>
          )}
          <ActionTable rows={campaignRows} compact targetAcos={targetAcos} />
        </div>
      )}
    </div>
  );
}

function CampaignView({
  result,
  thresholds,
  onExport,
}: {
  result: AnalysisResult;
  thresholds: Thresholds;
  onExport: (kind: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const INITIAL_LIMIT = 6;
  const allCampaigns = result.campaignSummary
    .slice()
    .sort((a, b) => b.issueCount - a.issueCount);
  const campaigns = showAll
    ? allCampaigns
    : allCampaigns.slice(0, INITIAL_LIMIT);
  const hiddenCount = allCampaigns.length - INITIAL_LIMIT;

  return (
    <div className="campaign-page">
      <section className="panel full">
        <div className="panel-header">
          <div>
            <h2>Campaign breakdown</h2>
            <p>
              Campaigns sorted by how many problems they have. Start at the top.
            </p>
          </div>
          <button
            className="button ghost"
            onClick={() => onExport("campaigns")}
          >
            <Download size={16} />
            Campaign CSV
          </button>
        </div>
        <div className="campaign-cards">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.campaign}
              c={c}
              auditRows={result.auditRows}
              targetAcos={thresholds.targetAcos}
            />
          ))}
        </div>
        {!showAll && hiddenCount > 0 && (
          <button
            type="button"
            className="campaign-show-more"
            onClick={() => setShowAll(true)}
          >
            Show {hiddenCount} more campaign{hiddenCount !== 1 ? "s" : ""} ▾
          </button>
        )}
        {showAll && hiddenCount > 0 && (
          <button
            type="button"
            className="campaign-show-more"
            onClick={() => setShowAll(false)}
          >
            Show fewer campaigns ▴
          </button>
        )}
      </section>

      <section className="panel full">
        <div className="panel-header">
          <div>
            <h2>Ad groups with the most problems</h2>
            <p>The same view, one level deeper.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Ad group</th>
                <th>Spend</th>
                <th>ACoS</th>
                <th>Targets</th>
                <th>Issues</th>
                <th>Unmatched</th>
                <th>Main issue</th>
              </tr>
            </thead>
            <tbody>
              {result.adGroupSummary
                .slice()
                .sort((a, b) => b.issueCount - a.issueCount)
                .slice(0, 20)
                .map((row) => (
                  <AdGroupRow
                    key={row.campaign}
                    row={row}
                    auditRows={result.auditRows}
                    targetAcos={thresholds.targetAcos}
                  />
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const UNMATCHED_REASON_LABELS: Record<
  UnmatchedReason,
  { label: string; detail: string }
> = {
  no_bid_change_in_window: {
    label: "No bid change in window",
    detail:
      "Campaign is in the history file, but this specific target had no bid change during the uploaded date range. Upload a wider history window or a Bulk file.",
  },
  name_mismatch: {
    label: "Campaign name not in history",
    detail:
      "This campaign does not appear in the history file at all. Check for renames, spaces, or structure differences between the two files.",
  },
  target_not_in_bulk: {
    label: "Not in Bulk file",
    detail: "Target was not found in the uploaded Bulk Operations file.",
  },
};

function UnmatchedBreakdown({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = row.unmatchedReason ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const entries = (Object.keys(counts) as UnmatchedReason[]).sort(
    (a, b) => counts[b] - counts[a],
  );
  return (
    <div className="unmatched-breakdown">
      <p className="unmatched-breakdown-title">Why are they unmatched?</p>
      {entries.map((reason) => {
        const meta = UNMATCHED_REASON_LABELS[reason] ?? {
          label: reason,
          detail: "",
        };
        return (
          <div key={reason} className="unmatched-breakdown-row">
            <span className="unmatched-breakdown-count">{counts[reason]}</span>
            <div>
              <span className="unmatched-breakdown-label">{meta.label}</span>
              {meta.detail && (
                <span className="unmatched-breakdown-detail">
                  {" "}
                  — {meta.detail}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DataQuality({
  result,
  onExport,
}: {
  result: AnalysisResult;
  onExport: (kind: string) => void;
}) {
  return (
    <div className="quality-grid">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>File readiness</h2>
            <p>Detected schemas and limitations.</p>
          </div>
        </div>
        <FileStatusBlock title="History CSV" status={result.historyStatus} />
        <FileStatusBlock
          title="Targeting XLSX"
          status={result.targetingStatus}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Match confidence</h2>
            <p>Rows are never silently discarded.</p>
          </div>
          <button
            className="button ghost"
            onClick={() => onExport("unmatched")}
          >
            <Download size={16} />
            Unmatched
          </button>
        </div>
        <div className="match-grid">
          <StatusItem
            label="High exact"
            value={number(result.summary.highExact)}
            sub="Campaign + ad group + target + match"
          />
          <StatusItem
            label="High canonical"
            value={number(result.summary.highCanonical)}
            sub="Product/auto target normalized"
          />
          <StatusItem
            label="Medium"
            value={number(result.summary.mediumMatch)}
            sub="Matched without match type"
          />
          <StatusItem
            label="Unmatched"
            value={number(result.summary.unmatchedTargets)}
            sub="Visible for review"
          />
        </div>
        <UnmatchedBreakdown rows={result.unmatchedPerformanceRows} />
        <div className="warning-stack">
          {result.warnings.map((warning) => (
            <div className="insight warning" key={warning}>
              <AlertTriangle size={17} />
              {warning}
            </div>
          ))}
        </div>
      </section>
      <section className="panel full">
        <div className="panel-header">
          <div>
            <h2>Unmatched performance rows</h2>
            <p>These targets had performance but no matched SP bid history.</p>
          </div>
        </div>
        <ActionTable rows={result.unmatchedPerformanceRows} compact />
      </section>
    </div>
  );
}

function FileStatusBlock({
  title,
  status,
}: {
  title: string;
  status: AnalysisResult["historyStatus"];
}) {
  return (
    <div className="file-status">
      <h3>{title}</h3>
      <p>
        <strong>{status.fileName}</strong>
      </p>
      <p>{status.reportType}</p>
      <p>
        {status.rowCount.toLocaleString()} rows · {status.dateRange}
      </p>
      <details>
        <summary>{status.columns.length} detected columns</summary>
        <div className="column-list">
          {status.columns.map((column) => (
            <span key={column}>{column}</span>
          ))}
        </div>
      </details>
    </div>
  );
}

function SBView({ result }: { result: AnalysisResult }) {
  const sb = result.sb;
  if (!sb) {
    return (
      <section className="panel full">
        <div className="panel-header">
          <div>
            <h2>Sponsored Brands audit</h2>
            <p>Not active yet.</p>
          </div>
        </div>
        <div className="sb-empty">
          <Flame size={36} />
          <h3>
            Upload the Sponsored Brands performance report to turn this on.
          </h3>
          <p>
            Your History export already contains{" "}
            <strong>
              {result.summary.sbHistoryRows.toLocaleString()} Sponsored Brands
              bid changes
            </strong>
            , but they stay isolated until an SB performance report is added.
            Drop the <em>Sponsored Brands Keyword/Targeting report</em> into any
            upload box — it is detected automatically — and a full SB audit
            appears here (same rules as Sponsored Products).
          </p>
        </div>
      </section>
    );
  }
  const s = sb.summary;
  const b = s.scoreBreakdown;
  const grade = gradeFor(s.decisionScore);
  const total = Math.max(1, b.judged + b.setAside);
  return (
    <div className="executive-grid">
      <section className="panel wide story">
        <div className="panel-header">
          <div>
            <h2>Sponsored Brands — bid-management story</h2>
            <p>Same audit engine as Sponsored Products, run on SB.</p>
          </div>
        </div>
        <div className={`story-grade ${grade.tone}`}>
          <div className="story-score">
            <strong>{s.decisionScore}</strong>
            <span>/ 100</span>
          </div>
          <div>
            <h3>SB bid-management health: {grade.label}</h3>
            <p>{b.formula}</p>
          </div>
        </div>
        <div className="score-bar" aria-label="SB score breakdown">
          <span
            className="seg good"
            style={{ width: `${(b.good / total) * 100}%` }}
          >
            {b.good > 0 &&
              b.good / total >= 0.1 &&
              `${number(b.good)} managed well`}
          </span>
          <span
            className="seg bad"
            style={{ width: `${(b.issues / total) * 100}%` }}
          >
            {b.issues > 0 &&
              b.issues / total >= 0.1 &&
              `${number(b.issues)} with a problem`}
          </span>
          <span
            className="seg muted"
            style={{ width: `${(b.setAside / total) * 100}%` }}
          >
            {b.setAside > 0 &&
              b.setAside / total >= 0.1 &&
              `${number(b.setAside)} set aside`}
          </span>
        </div>
        <div className="story-narrative">
          <p>
            {number(s.totalTargets)} SB targets · {number(s.matchedTargets)}{" "}
            matched to SB bid history
            {(() => {
              const total = s.totalTargets;
              const matched = s.matchedTargets;
              const pct = total > 0 ? Math.round((matched / total) * 100) : 0;
              return ` (${pct}%)`;
            })()}{" "}
            · {number(s.winnersNotScaled)} winners not scaled ·{" "}
            {number(s.losersNotReduced)} waste not cut ·{" "}
            {number(s.tooManyBidChanges)} over-managed.
          </p>
        </div>
        {/* F15: when match rate is low, prepend an explicit yellow notice
            so Sarah knows the SB column is sparse and what to do about it. */}
        {(() => {
          const total = s.totalTargets;
          const matched = s.matchedTargets;
          const pct = total > 0 ? matched / total : 1;
          if (pct >= 0.5) return null;
          const pctRound = Math.round(pct * 100);
          return (
            <div className="insight warning sb-sparse-notice">
              <AlertTriangle size={16} />
              <span>
                Heads up — only {pctRound}% of SB keywords matched bid history.
                SB results will be sparse. Upload a wider date-range History
                export to improve.
              </span>
            </div>
          );
        })()}
        <div className="insight-list">
          {sb.notes.map((n) => (
            <div className="insight warning" key={n}>
              <AlertTriangle size={16} />
              {n}
            </div>
          ))}
        </div>
      </section>
      <section className="panel full">
        <div className="panel-header">
          <div>
            <h2>Sponsored Brands — all targets</h2>
            <p>Click any "Why?" for the exact rule and numbers.</p>
          </div>
        </div>
        <ActionTable rows={sb.auditRows} />
      </section>
    </div>
  );
}

function Methodology({ result }: { result: AnalysisResult }) {
  const m = result.methodology;
  return (
    <div className="method-page">
      <section className="panel full">
        <div className="panel-header">
          <div>
            <h2>How decisions are made</h2>
            <p>
              Every recommendation in this tool follows the fixed rules below.
              Nothing is a guess — show this page to anyone who asks "why?".
            </p>
          </div>
        </div>
        <div className="method-block">
          <h3>The Decision Score</h3>
          <p>{m.score}</p>
          <p className="method-now">
            <strong>Right now:</strong> {result.summary.scoreBreakdown.formula}
          </p>
        </div>
        <div className="method-block">
          <h3>Priority — what to fix first</h3>
          <p>{m.priority}</p>
        </div>
        <div className="method-block">
          <h3>Confidence — how sure we are</h3>
          <p>{m.confidence}</p>
        </div>
      </section>

      <section className="panel full">
        <div className="panel-header">
          <div>
            <h2>Every category, explained</h2>
            <p>Exactly how each label is decided and why it matters.</p>
          </div>
        </div>
        <div className="method-grid">
          {m.categories.map((c) => (
            <div className="method-card" key={c.category}>
              <div className="method-card-head">
                <span
                  className="method-dot"
                  style={{
                    background: categoryColors[c.category] ?? "#475569",
                  }}
                />
                <strong>{c.title}</strong>
              </div>
              <p className="method-plain">{c.plain}</p>
              <p>
                <strong>How it's decided:</strong> {c.howDecided}
              </p>
              <p>
                <strong>Why it matters:</strong> {c.whyItMatters}
              </p>
              <p className="method-action">
                <strong>What to do:</strong> {c.action}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel full">
        <div className="panel-header">
          <div>
            <h2>Limits of this data (read before trusting blindly)</h2>
            <p>What these two files can and cannot tell you.</p>
          </div>
        </div>
        <ul className="method-limits">
          {m.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: string;
  children: React.ReactNode;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Meter({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  return (
    <span className="meter" title={`${value}`}>
      <i
        style={{
          width: `${Math.min(100, (value / max) * 100)}%`,
          background: color,
        }}
      />
    </span>
  );
}

function topReasons(rows: AuditRow[]) {
  return rows
    .filter((row) => row.priority === "Critical" || row.priority === "High")
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 7);
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function priorityTone(priority: Priority) {
  if (priority === "Critical") return "red";
  if (priority === "High") return "amber";
  if (priority === "Medium") return "blue";
  if (priority === "Watch") return "slate";
  return "green";
}

function handleExport(kind: string, result: AnalysisResult) {
  const rows = result.auditRows;
  if (kind === "executive") {
    downloadText(
      "amazon-ppc-executive-summary.md",
      executiveSummaryMarkdown(result.summary),
      "text/markdown;charset=utf-8",
    );
    return;
  }
  if (kind === "campaigns") {
    downloadText(
      "amazon-ppc-campaign-summary.csv",
      toCsv(result.campaignSummary.map(campaignToExport)),
    );
    return;
  }
  if (kind === "unmatched") {
    downloadText(
      "amazon-ppc-unmatched-rows.csv",
      toCsv(result.unmatchedPerformanceRows.map(auditRowToExport)),
    );
    return;
  }
  const filtered =
    kind === "actions"
      ? rows.filter((row) =>
          [
            "Increase bid",
            "Reduce bid",
            "Pause / review",
            "Review match",
          ].includes(row.recommendation),
        )
      : kind === "winners"
        ? rows.filter((row) => row.category === "Winners Not Scaled")
        : kind === "waste"
          ? rows.filter((row) => row.category === "Losers Not Reduced")
          : kind === "wrong"
            ? rows.filter(
                (row) =>
                  row.category === "Profitable Terms Reduced" ||
                  row.category === "Unprofitable Terms Increased",
              )
            : rows;
  downloadText(
    `amazon-ppc-${kind}-audit.csv`,
    toCsv(filtered.map(auditRowToExport)),
  );
}

// exportBundle removed: was a duplicate of handleExport("actions") — see G11.
