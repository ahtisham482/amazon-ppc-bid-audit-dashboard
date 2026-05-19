import { Fragment, useMemo, useRef, useState } from "react";
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
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
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
  CampaignSummary,
  Category,
  Mode,
  Priority,
  Thresholds,
} from "./lib/types";
import { dateShort, money, money2, number, percent } from "./lib/format";
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
  | "Sponsored Brands"
  | "Help";

const sections: Array<{ id: Section; icon: typeof Activity }> = [
  { id: "Action Plan", icon: Activity },
  { id: "All Targets", icon: Layers3 },
  { id: "Campaigns", icon: BarChart3 },
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
  const [thresholds, setThresholds] = useState<Thresholds>(defaultThresholds);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("Action Plan");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUploads, setShowUploads] = useState(true);

  // One entry point for every upload. It detects what the file is from its
  // contents and routes it — so it never matters which box you use. The two
  // base files (History + SP Targeting) are required; Bulk / SB report / ACoS
  // map are optional enhancers.
  async function ingest(file: File | null) {
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

  function compute(next: Thresholds) {
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
      setShowUploads(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to analyze the files.",
      );
    }
  }

  function runAnalysis() {
    compute(thresholds);
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
              className={activeSection === id ? "nav-item active" : "nav-item"}
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
            {result && (
              <button
                className="button ghost"
                onClick={() => exportBundle(result)}
              >
                <Download size={17} />
                Export audit
              </button>
            )}
            <button
              className="button primary"
              onClick={runAnalysis}
              disabled={isLoading || !historyRaw || !targetingRaw}
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
                />
                <FileDrop
                  title="2 · SP Targeting"
                  description="Sponsored Products report"
                  tag="Required"
                  info={targetingInfo}
                  busy={isLoading}
                  onFile={ingest}
                />
                <FileDrop
                  title="3 · SB report"
                  description="Sponsored Brands report"
                  tag="Optional"
                  info={sbInfo}
                  busy={isLoading}
                  onFile={ingest}
                />
                <FileDrop
                  title="4 · Bulk file"
                  description="Adds current bids"
                  tag="Optional"
                  info={bulkInfo}
                  busy={isLoading}
                  onFile={ingest}
                />
                <FileDrop
                  title="5 · ACoS map"
                  description="Per-campaign targets"
                  tag="Optional"
                  info={acosInfo}
                  busy={isLoading}
                  onFile={ingest}
                />
              </div>
              <p className="upload-hint">
                Boxes 1 &amp; 2 are required; 3–5 are optional and add depth.
                Wrong box? Files are auto-detected, so it still works. CSV, XLS,
                XLSX all accepted.
              </p>
              <details className="settings-fold">
                <summary>Adjust targets &amp; thresholds (optional)</summary>
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

        {!result ? (
          <EmptyState />
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

function FileDrop({
  title,
  description,
  info,
  busy,
  onFile,
  tag,
}: {
  title: string;
  description: string;
  info: FileInfo | null;
  busy: boolean;
  onFile: (file: File | null) => void;
  tag?: "Required" | "Optional";
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function pick() {
    inputRef.current?.click();
  }

  return (
    <div
      className={`file-drop${dragOver ? " drag-over" : ""}${info ? " has-file" : ""}`}
      role="button"
      tabIndex={0}
      onClick={pick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          pick();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        onFile(event.dataTransfer.files?.[0] ?? null);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.xlsm,.xlsb,.txt"
        onChange={(event) => {
          onFile(event.target.files?.[0] ?? null);
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
        <small>
          {busy
            ? "Reading file…"
            : info
              ? `✓ ${info.name} · ${info.rows.toLocaleString()} rows`
              : `${description} — click or drop`}
        </small>
      </span>
      <button
        type="button"
        className="file-drop-btn"
        onClick={(event) => {
          event.stopPropagation();
          pick();
        }}
      >
        {info ? "Replace" : "Choose"}
      </button>
    </div>
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
        <label>
          Mode
          <select
            value={thresholds.mode}
            onChange={(event) =>
              onChange(
                thresholdsForMode(event.target.value as Mode, thresholds),
              )
            }
          >
            <option>Conservative</option>
            <option>Balanced</option>
            <option>Aggressive</option>
          </select>
        </label>
        <label>
          Target ACoS (%)
          <input
            type="number"
            value={Math.round(thresholds.targetAcos * 100)}
            min={1}
            max={200}
            onChange={(event) =>
              setField("targetAcos", Number(event.target.value) / 100)
            }
          />
        </label>
        <label>
          Min clicks
          <input
            type="number"
            value={thresholds.minClicks}
            min={0}
            onChange={(event) =>
              setField("minClicks", Number(event.target.value))
            }
          />
        </label>
        <label>
          Min spend ($)
          <input
            type="number"
            value={thresholds.minSpend}
            min={0}
            onChange={(event) =>
              setField("minSpend", Number(event.target.value))
            }
          />
        </label>
        <label>
          Min orders
          <input
            type="number"
            value={thresholds.minOrders}
            min={0}
            onChange={(event) =>
              setField("minOrders", Number(event.target.value))
            }
          />
        </label>
        <label>
          Lookback (days)
          <input
            type="number"
            value={thresholds.lookbackDays}
            min={3}
            max={30}
            onChange={(event) =>
              setField("lookbackDays", Number(event.target.value))
            }
          />
        </label>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <div className="empty-copy">
        <FileSpreadsheet size={42} />
        <h2>Add boxes 1 &amp; 2, then click Analyze.</h2>
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
          <AllTargets result={result} onExport={onExport} />
        </>
      )}
      {activeSection === "Campaigns" && (
        <CampaignView result={result} onExport={onExport} />
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

function MoveItem({ row }: { row: AuditRow }) {
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
        <div className="move-why">
          <p>{row.explain.reason}</p>
          <p>
            <strong>How decided:</strong> {row.explain.rule}
          </p>
          <p>
            <strong>Do this:</strong> {row.explain.whyAction}
          </p>
        </div>
      )}
    </div>
  );
}

function MoveColumn({
  move,
  rows,
  onSeeAll,
}: {
  move: Move;
  rows: AuditRow[];
  onSeeAll: () => void;
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
      <div className="move-list">
        {top.length === 0 && <p className="muted-note">Nothing here. 🎉</p>}
        {top.map((row) => (
          <MoveItem
            key={`${row.campaign}-${row.adGroup}-${row.targeting}-${row.matchType}`}
            row={row}
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
          <p>
            Start with the green column, then the red. Grey can wait. Click any
            keyword for the exact reason and numbers.{" "}
            <button className="linklike" onClick={() => onNavigate("Help")}>
              How is this decided?
            </button>
          </p>
        </div>
        <button className="button ghost" onClick={() => onExport("actions")}>
          <Download size={16} />
          Export action list
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
        />
        <MoveColumn
          move="CUT"
          rows={cut}
          onSeeAll={() => onNavigate("All Targets")}
        />
        <MoveColumn
          move="HOLD"
          rows={hold}
          onSeeAll={() => onNavigate("All Targets")}
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

const ALL_FILTERS: Array<{
  id: string;
  label: string;
  test: (r: AuditRow) => boolean;
}> = [
  { id: "all", label: "All", test: () => true },
  { id: "push", label: "Push", test: (r) => moveOf(r) === "PUSH" },
  { id: "cut", label: "Cut", test: (r) => moveOf(r) === "CUT" },
  { id: "hold", label: "Hold", test: (r) => moveOf(r) === "HOLD" },
  {
    id: "winners",
    label: "Winners not scaled",
    test: (r) =>
      r.category === "Winners Not Scaled" ||
      r.secondaryTags.includes("Winners Not Scaled"),
  },
  {
    id: "waste",
    label: "Waste not cut",
    test: (r) =>
      r.category === "Losers Not Reduced" ||
      r.secondaryTags.includes("Losers Not Reduced"),
  },
  {
    id: "wrong",
    label: "Wrong direction",
    test: (r) =>
      r.category === "Profitable Terms Reduced" ||
      r.category === "Unprofitable Terms Increased",
  },
  {
    id: "over",
    label: "Over-managed",
    test: (r) =>
      r.category === "Too Many Bid Changes" ||
      r.secondaryTags.includes("Too Many Bid Changes"),
  },
];

function AllTargets({
  result,
  onExport,
}: {
  result: AnalysisResult;
  onExport: (kind: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const active = ALL_FILTERS.find((f) => f.id === filter) ?? ALL_FILTERS[0];
  const rows = result.auditRows.filter(active.test);
  return (
    <section className="panel full">
      <div className="panel-header">
        <div>
          <h2>All targets</h2>
          <p>
            Every audited keyword/target. Filter, then click “Why?” for the
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
        {ALL_FILTERS.map((f) => {
          const n = result.auditRows.filter(f.test).length;
          return (
            <button
              key={f.id}
              className={`fchip${filter === f.id ? " active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <em>{number(n)}</em>
            </button>
          );
        })}
      </div>
      <ActionTable rows={rows} />
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

function ActionTable({
  rows,
  compact = false,
}: {
  rows: AuditRow[];
  compact?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [priority, setPriority] = useState("All");
  const [sort, setSort] = useState<
    "priorityScore" | "spend" | "sales" | "acos" | "bidChanges"
  >("priorityScore");
  const [openRow, setOpenRow] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return rows
      .filter((row) => category === "All" || row.category === category)
      .filter((row) => priority === "All" || row.priority === priority)
      .filter((row) => {
        const haystack =
          `${row.campaign} ${row.adGroup} ${row.targeting} ${row.reason}`.toLowerCase();
        return haystack.includes(search.toLowerCase());
      })
      .sort((a, b) => Number(b[sort] ?? 0) - Number(a[sort] ?? 0));
  }, [category, priority, rows, search, sort]);

  return (
    <div>
      {!compact && (
        <div className="table-tools">
          <label className="search-box">
            <Search size={16} />
            <input
              placeholder="Search campaign, target, reason"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            <Filter size={15} />
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option>All</option>
              {unique(rows.map((row) => row.category)).map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
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
            {filtered.slice(0, compact ? 18 : 500).map((row) => {
              const rowKey = `${row.campaign}-${row.adGroup}-${row.targeting}-${row.matchType}`;
              const isOpen = openRow === rowKey;
              return (
                <Fragment key={rowKey}>
                  <tr className={isOpen ? "row-open" : undefined}>
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
                        <div className="why-grid">
                          <p>
                            <strong>What:</strong> {row.explain.reason}
                          </p>
                          <p>
                            <strong>How it was decided:</strong>{" "}
                            {row.explain.rule}
                          </p>
                          <p>
                            <strong>Why this action:</strong>{" "}
                            {row.explain.whyAction}
                          </p>
                          <p>
                            <strong>Why this priority:</strong>{" "}
                            {row.explain.whyPriority}
                          </p>
                          <p>
                            <strong>Why this confidence:</strong>{" "}
                            {row.explain.whyConfidence}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
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

function CampaignView({
  result,
  onExport,
}: {
  result: AnalysisResult;
  onExport: (kind: string) => void;
}) {
  const campaigns = result.campaignSummary
    .slice()
    .sort((a, b) => b.issueCount - a.issueCount)
    .slice(0, 18);

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
            <div className="campaign-card" key={c.campaign}>
              <div className="campaign-card-top">
                <strong title={c.campaign}>{c.campaign}</strong>
                <span className="campaign-meta">
                  {money(c.spend)} spend · {percent(c.acos)} ACoS ·{" "}
                  {number(c.targets)} targets
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
                  <span className="chip warn">
                    {c.losersNotReduced} waste not cut
                  </span>
                )}
                {c.wrongBidChanges > 0 && (
                  <span className="chip bad">
                    {c.wrongBidChanges} wrong-direction
                  </span>
                )}
                {c.tooManyBidChanges > 0 && (
                  <span className="chip amber">
                    {c.tooManyBidChanges} over-managed
                  </span>
                )}
                {c.unmatched > 0 && (
                  <span className="chip slate">{c.unmatched} unmatched</span>
                )}
              </div>
            </div>
          ))}
        </div>
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
                <th>Problems</th>
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
                  <tr key={row.campaign}>
                    <td>{row.campaign}</td>
                    <td>{money(row.spend)}</td>
                    <td>{percent(row.acos)}</td>
                    <td>{number(row.targets)}</td>
                    <td>{row.issueCount}</td>
                    <td>{row.unmatched}</td>
                    <td className="reason-cell">{campaignProblemLine(row)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
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
            {b.good > 0 && b.good / total >= 0.1 && `${b.good} managed well`}
          </span>
          <span
            className="seg bad"
            style={{ width: `${(b.issues / total) * 100}%` }}
          >
            {b.issues > 0 &&
              b.issues / total >= 0.1 &&
              `${b.issues} with a problem`}
          </span>
          <span
            className="seg muted"
            style={{ width: `${(b.setAside / total) * 100}%` }}
          >
            {b.setAside > 0 &&
              b.setAside / total >= 0.1 &&
              `${b.setAside} set aside`}
          </span>
        </div>
        <div className="story-narrative">
          <p>
            {number(s.totalTargets)} SB targets · {number(s.matchedTargets)}{" "}
            matched to SB bid history · {number(s.winnersNotScaled)} winners not
            scaled · {number(s.losersNotReduced)} waste not cut ·{" "}
            {number(s.tooManyBidChanges)} over-managed.
          </p>
        </div>
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
            <p>Click any “Why?” for the exact rule and numbers.</p>
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
              Nothing is a guess — show this page to anyone who asks “why?”.
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
                <strong>How it’s decided:</strong> {c.howDecided}
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

function exportBundle(result: AnalysisResult) {
  handleExport("actions", result);
}
