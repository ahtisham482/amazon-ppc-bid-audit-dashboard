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
  readRows,
  thresholdsForMode,
} from "./lib/analysis";
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
  | "Executive"
  | "Actions"
  | "Winners"
  | "Waste"
  | "Wrong Bids"
  | "Frequency"
  | "Campaigns"
  | "Data Quality"
  | "How it works";

const sections: Array<{ id: Section; icon: typeof Activity }> = [
  { id: "Executive", icon: Activity },
  { id: "Actions", icon: Layers3 },
  { id: "Winners", icon: ArrowUp },
  { id: "Waste", icon: ArrowDown },
  { id: "Wrong Bids", icon: AlertTriangle },
  { id: "Frequency", icon: RefreshCw },
  { id: "Campaigns", icon: BarChart3 },
  { id: "Data Quality", icon: ShieldCheck },
  { id: "How it works", icon: HelpCircle },
];

// Plain-English explainer shown at the top of each focused tab.
const sectionIntro: Partial<Record<Section, string>> = {
  Winners:
    "Targets that already make money but the bid was not meaningfully raised — you are likely leaving sales on the table. Decided by: profitable (ACoS ≤ target, enough sales & orders) AND no recent meaningful bid increase.",
  Waste:
    "Targets that lose money but the bid was not cut — spend keeps leaking. Decided by: wasteful (spend with zero orders, or ACoS ≥ 1.5× target) AND no recent meaningful bid decrease.",
  "Wrong Bids":
    "Bid moves that went the wrong way: a profitable target was cut, or a money-loser was bid up. Decided by: the most recent bid change direction contradicts the target's performance.",
  Frequency:
    "Targets changed so often that no change had time to prove itself, so the numbers are noisy. Decided by: 3 or more bid changes on the same target inside the uploaded window.",
};

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
  const [historyInfo, setHistoryInfo] = useState<FileInfo | null>(null);
  const [targetingInfo, setTargetingInfo] = useState<FileInfo | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>(defaultThresholds);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("Executive");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One entry point for every upload. Reads the file (CSV / XLS / XLSX),
  // detects whether it is the History export or the Targeting report from its
  // columns, and routes it to the correct slot — so it does not matter which
  // box the user dropped it on.
  async function ingest(file: File | null) {
    if (!file) return;
    setError(null);
    setIsLoading(true);
    try {
      const rows = await readRows(file);
      const kind = classifyReport(rows.length ? Object.keys(rows[0]) : []);
      if (kind === "history") {
        setHistoryRaw(rows);
        setHistoryInfo({ name: file.name, rows: rows.length });
        setResult(null);
      } else if (kind === "targeting") {
        setTargetingRaw(rows);
        setTargetingInfo({ name: file.name, rows: rows.length });
        setResult(null);
      } else {
        setError(
          `"${file.name}" does not look like either report. Upload the Amazon Ads History export (has time / from / to / metadata columns) or the Sponsored Products Targeting report (has Campaign Name / Targeting / Spend columns).`,
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Could not read "${file.name}".`,
      );
    } finally {
      setIsLoading(false);
    }
  }

  function runAnalysis() {
    if (!historyRaw || !targetingRaw) {
      setError(
        "Add both files: the Amazon Ads History export and the Sponsored Products Targeting report.",
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
          thresholds,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to analyze the files.",
      );
    }
  }

  function updateThresholds(next: Thresholds) {
    setThresholds(next);
    if (historyRaw && targetingRaw) {
      setResult(
        analyzeFiles(
          historyRaw,
          targetingRaw,
          historyInfo?.name ?? "history",
          targetingInfo?.name ?? "targeting",
          next,
        ),
      );
    }
  }

  const sectionRows = useMemo(() => {
    if (!result) return [];
    switch (activeSection) {
      case "Winners":
        return result.auditRows.filter(
          (row) =>
            row.category === "Winners Not Scaled" ||
            row.category === "Profitable Terms Reduced",
        );
      case "Waste":
        return result.auditRows.filter(
          (row) =>
            row.category === "Losers Not Reduced" ||
            row.category === "Unprofitable Terms Increased",
        );
      case "Wrong Bids":
        return result.auditRows.filter(
          (row) =>
            row.category === "Profitable Terms Reduced" ||
            row.category === "Unprofitable Terms Increased",
        );
      case "Frequency":
        return result.auditRows.filter(
          (row) =>
            row.category === "Too Many Bid Changes" ||
            row.secondaryTags.includes("Too Many Bid Changes"),
        );
      default:
        return result.auditRows;
    }
  }, [activeSection, result]);

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
            <h1>Amazon PPC Bid Decision Quality Auditor</h1>
            <p>
              Upload History and Targeting reports to expose missed scaling,
              spend leakage, wrong bid direction, and over-management.
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

        <section className="upload-strip" aria-label="Upload reports">
          <FileDrop
            title="History export"
            description="Amazon Ads bid-change CSV / XLSX"
            info={historyInfo}
            busy={isLoading}
            onFile={ingest}
          />
          <FileDrop
            title="Targeting report"
            description="Sponsored Products Targeting XLSX / XLS / CSV"
            info={targetingInfo}
            busy={isLoading}
            onFile={ingest}
          />
          <ThresholdPanel thresholds={thresholds} onChange={updateThresholds} />
        </section>
        <p className="upload-hint">
          Tip: it does not matter which box you use — drop or click either one
          and the file is detected automatically. CSV, XLS, and XLSX all work.
        </p>

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
            rows={sectionRows}
            thresholds={thresholds}
            onExport={(kind) => handleExport(kind, result)}
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
}: {
  title: string;
  description: string;
  info: FileInfo | null;
  busy: boolean;
  onFile: (file: File | null) => void;
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
        <strong>{info ? info.name : title}</strong>
        <small>
          {busy
            ? "Reading file…"
            : info
              ? `Detected · ${info.rows.toLocaleString()} rows`
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
        Choose
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
          Target ACoS
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
          Min spend
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
          Lookback
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
        <h2>Upload both reports to build the audit.</h2>
        <p>
          The dashboard will calculate match confidence, bid-change behavior,
          target performance, missed scale opportunities, waste leakage, and
          exportable action lists.
        </p>
      </div>
      <div className="empty-checklist">
        <div>
          <CheckCircle2 size={18} /> History CSV with bid changes
        </div>
        <div>
          <CheckCircle2 size={18} /> Sponsored Products targeting XLSX
        </div>
        <div>
          <CheckCircle2 size={18} /> Adjustable target ACoS and data thresholds
        </div>
        <div>
          <CheckCircle2 size={18} /> Local browser-side processing
        </div>
      </div>
    </section>
  );
}

function Dashboard({
  activeSection,
  result,
  rows,
  thresholds,
  onExport,
}: {
  activeSection: Section;
  result: AnalysisResult;
  rows: AuditRow[];
  thresholds: Thresholds;
  onExport: (kind: string) => void;
}) {
  return (
    <div className="dashboard">
      <StatusStrip result={result} />
      <KpiGrid result={result} />
      {activeSection === "Executive" && (
        <ExecutiveView
          result={result}
          thresholds={thresholds}
          onExport={onExport}
        />
      )}
      {activeSection !== "Executive" &&
        activeSection !== "Campaigns" &&
        activeSection !== "Data Quality" &&
        activeSection !== "How it works" && (
          <ActionView
            rows={rows}
            activeSection={activeSection}
            onExport={onExport}
          />
        )}
      {activeSection === "Campaigns" && (
        <CampaignView result={result} onExport={onExport} />
      )}
      {activeSection === "Data Quality" && (
        <DataQuality result={result} onExport={onExport} />
      )}
      {activeSection === "How it works" && <Methodology result={result} />}
    </div>
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

function storyParagraph(result: AnalysisResult, thresholds: Thresholds) {
  const s = result.summary;
  const b = s.scoreBreakdown;
  const parts: string[] = [];
  parts.push(
    `Using a ${percent(thresholds.targetAcos, 0)} target ACoS (${thresholds.mode.toLowerCase()} mode), we could grade ${number(b.judged)} of ${number(s.totalTargets)} targets. ${number(b.setAside)} were set aside because they had no bid-history match or too little data, so they are not counted in the score.`,
  );
  parts.push(
    `Of the ${number(b.judged)} graded, ${number(b.good)} look correctly managed and ${number(b.issues)} have a problem.`,
  );
  const probs: string[] = [];
  if (s.winnersNotScaled)
    probs.push(
      `${s.winnersNotScaled} winner(s) are not being scaled (~${money(s.estimatedMissedSales)} of sales left on the table)`,
    );
  if (s.losersNotReduced)
    probs.push(
      `${s.losersNotReduced} money-loser(s) were not cut (~${money(s.estimatedWastedSpend)} leaking)`,
    );
  const wrong = s.wrongIncreases + s.wrongReductions;
  if (wrong) probs.push(`${wrong} bid change(s) went the wrong direction`);
  if (s.tooManyBidChanges)
    probs.push(
      `${s.tooManyBidChanges} target(s) were changed too often to read clearly`,
    );
  if (probs.length) parts.push(`The biggest issues: ${probs.join("; ")}.`);
  return parts;
}

function ExecutiveView({
  result,
  thresholds,
  onExport,
}: {
  result: AnalysisResult;
  thresholds: Thresholds;
  onExport: (kind: string) => void;
}) {
  const s = result.summary;
  const b = s.scoreBreakdown;
  const grade = gradeFor(s.decisionScore);
  const total = Math.max(1, b.judged + b.setAside);
  const topFixes = result.auditRows
    .filter((row) => row.priority === "Critical" || row.priority === "High")
    .sort((a, b2) => b2.priorityScore - a.priorityScore)
    .slice(0, 6);

  return (
    <div className="executive-grid">
      <section className="panel wide story">
        <div className="panel-header">
          <div>
            <h2>Your account's bid-management story</h2>
            <p>Plain-English summary anyone on your team can read.</p>
          </div>
          <button
            className="button ghost"
            onClick={() => onExport("executive")}
          >
            <Download size={16} />
            Summary
          </button>
        </div>

        <div className={`story-grade ${grade.tone}`}>
          <div className="story-score">
            <strong>{s.decisionScore}</strong>
            <span>/ 100</span>
          </div>
          <div>
            <h3>Bid-management health: {grade.label}</h3>
            <p>{b.formula}</p>
          </div>
        </div>

        <div
          className="score-bar"
          title="How the graded targets split"
          aria-label="Score breakdown"
        >
          <span
            className="seg good"
            style={{ width: `${(b.good / total) * 100}%` }}
          >
            {b.good > 0 && `${b.good} managed well`}
          </span>
          <span
            className="seg bad"
            style={{ width: `${(b.issues / total) * 100}%` }}
          >
            {b.issues > 0 && `${b.issues} with a problem`}
          </span>
          <span
            className="seg muted"
            style={{ width: `${(b.setAside / total) * 100}%` }}
          >
            {b.setAside > 0 && `${b.setAside} set aside (not graded)`}
          </span>
        </div>

        <div className="story-narrative">
          {storyParagraph(result, thresholds).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        <StoryCharts result={result} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>What to fix first</h2>
            <p>The highest-impact problems, in order.</p>
          </div>
        </div>
        <div className="fix-list">
          {topFixes.length === 0 && (
            <p className="muted-note">
              No high-priority problems found with the current thresholds. 🎉
            </p>
          )}
          {topFixes.map((row) => (
            <div
              className="fix-card"
              key={`${row.campaign}-${row.targeting}-${row.category}`}
            >
              <div className="fix-head">
                <Badge tone={priorityTone(row.priority)}>{row.priority}</Badge>
                <strong>{row.recommendation}</strong>
                <span className="fix-cat">{row.category}</span>
              </div>
              <p className="fix-reason">{row.explain.reason}</p>
              <p className="fix-why">
                <Flame size={13} /> {row.explain.whyAction}
              </p>
            </div>
          ))}
        </div>
        {result.warnings.length > 0 && (
          <div className="insight-list">
            {result.warnings.map((warning) => (
              <div className="insight warning" key={warning}>
                <AlertTriangle size={16} />
                {warning}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel full">
        <div className="panel-header">
          <div>
            <h2>Highest-priority actions</h2>
            <p>Click any row's “Why?” to see the exact rule and numbers.</p>
          </div>
          <button className="button ghost" onClick={() => onExport("actions")}>
            <Download size={16} />
            Actions CSV
          </button>
        </div>
        <ActionTable
          rows={result.auditRows
            .filter((row) => row.priority !== "Low" && row.priority !== "Watch")
            .slice(0, 18)}
          compact
        />
      </section>
    </div>
  );
}

function StoryCharts({ result }: { result: AnalysisResult }) {
  const issueCats = new Set([
    "Winners Not Scaled",
    "Losers Not Reduced",
    "Profitable Terms Reduced",
    "Unprofitable Terms Increased",
    "Too Many Bid Changes",
  ]);
  const problemsByType = result.charts.categoryBreakdown
    .filter((d) => issueCats.has(d.name))
    .sort((a, b) => b.value - a.value);
  const campaignProblems = result.campaignSummary
    .filter((c) => c.issueCount > 0)
    .slice()
    .sort((a, b) => b.issueCount - a.issueCount)
    .slice(0, 8)
    .map((c) => ({ name: c.campaign, value: c.issueCount }));

  return (
    <div className="story-charts">
      <div className="chart-box">
        <h3>Problems by type</h3>
        <p className="chart-sub">How many targets fall into each problem.</p>
        <ResponsiveContainer width="100%" height={210}>
          <BarChart
            data={problemsByType}
            layout="vertical"
            margin={{ top: 4, right: 40, bottom: 4, left: 130 }}
          >
            <CartesianGrid stroke="#E5E7EB" horizontal={false} />
            <XAxis type="number" allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={128}
              tick={{ fontSize: 12 }}
            />
            <Tooltip />
            <Bar dataKey="value" radius={[0, 6, 6, 0]}>
              {problemsByType.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={categoryColors[entry.name] ?? "#475569"}
                />
              ))}
              <LabelList dataKey="value" position="right" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-box">
        <h3>Campaigns with the most problems</h3>
        <p className="chart-sub">Where to focus your clean-up first.</p>
        <ResponsiveContainer width="100%" height={210}>
          <BarChart
            data={campaignProblems}
            layout="vertical"
            margin={{ top: 4, right: 40, bottom: 4, left: 130 }}
          >
            <CartesianGrid stroke="#E5E7EB" horizontal={false} />
            <XAxis type="number" allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={128}
              tick={{ fontSize: 11 }}
            />
            <Tooltip />
            <Bar
              dataKey="value"
              radius={[0, 6, 6, 0]}
              fill="#92400E"
              name="Problem targets"
            >
              <LabelList dataKey="value" position="right" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ActionView({
  rows,
  activeSection,
  onExport,
}: {
  rows: AuditRow[];
  activeSection: Section;
  onExport: (kind: string) => void;
}) {
  return (
    <section className="panel full">
      <div className="panel-header">
        <div>
          <h2>
            {activeSection === "Actions" ? "Action dashboard" : activeSection}
          </h2>
          {sectionIntro[activeSection] && (
            <p className="section-intro">{sectionIntro[activeSection]}</p>
          )}
          <p>
            {rows.length.toLocaleString()} target combinations in this view ·
            click any “Why?” for the exact rule and numbers.
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
      <ActionTable rows={rows} />
    </section>
  );
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
                      <small>{row.adGroup}</small>
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
  return `Main issue: ${worst[0]} target(s) ${worst[1]}.`;
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
