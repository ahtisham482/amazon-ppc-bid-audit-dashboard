import { useMemo, useState } from "react";
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
  Layers3,
  LineChart,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  analyzeFiles,
  defaultThresholds,
  parseHistoryCsv,
  parseTargetingWorkbook,
  thresholdsForMode
} from "./lib/analysis";
import {
  AnalysisResult,
  AuditRow,
  CampaignSummary,
  Category,
  Mode,
  Priority,
  Thresholds
} from "./lib/types";
import { dateShort, money, money2, number, percent } from "./lib/format";
import { auditRowToExport, campaignToExport, downloadText, executiveSummaryMarkdown, toCsv } from "./lib/export";

type Section =
  | "Executive"
  | "Actions"
  | "Winners"
  | "Waste"
  | "Wrong Bids"
  | "Frequency"
  | "Campaigns"
  | "Data Quality";

const sections: Array<{ id: Section; icon: typeof Activity }> = [
  { id: "Executive", icon: Activity },
  { id: "Actions", icon: Layers3 },
  { id: "Winners", icon: ArrowUp },
  { id: "Waste", icon: ArrowDown },
  { id: "Wrong Bids", icon: AlertTriangle },
  { id: "Frequency", icon: RefreshCw },
  { id: "Campaigns", icon: BarChart3 },
  { id: "Data Quality", icon: ShieldCheck }
];

const categoryColors: Record<string, string> = {
  "Winners Not Scaled": "#0F766E",
  "Losers Not Reduced": "#B45309",
  "Profitable Terms Reduced": "#2563EB",
  "Unprofitable Terms Increased": "#DC2626",
  "No Action Despite Enough Data": "#7C3AED",
  "Too Many Bid Changes": "#92400E",
  "Needs More Data": "#64748B",
  "Correctly Managed": "#16A34A",
  Monitor: "#475569"
};

export default function App() {
  const [historyFile, setHistoryFile] = useState<File | null>(null);
  const [targetingFile, setTargetingFile] = useState<File | null>(null);
  const [historyRaw, setHistoryRaw] = useState<Record<string, unknown>[] | null>(null);
  const [targetingRaw, setTargetingRaw] = useState<Record<string, unknown>[] | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>(defaultThresholds);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("Executive");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAnalysis() {
    if (!historyFile || !targetingFile) {
      setError("Upload both the Amazon Ads History CSV and the Sponsored Products Targeting XLSX.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [historyRows, targetingRows] = await Promise.all([
        historyRaw ?? parseHistoryCsv(historyFile),
        targetingRaw ?? parseTargetingWorkbook(targetingFile)
      ]);
      setHistoryRaw(historyRows);
      setTargetingRaw(targetingRows);
      setResult(analyzeFiles(historyRows, targetingRows, historyFile.name, targetingFile.name, thresholds));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to parse the uploaded files.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateThresholds(next: Thresholds) {
    setThresholds(next);
    if (historyRaw && targetingRaw && historyFile && targetingFile) {
      setResult(analyzeFiles(historyRaw, targetingRaw, historyFile.name, targetingFile.name, next));
    }
  }

  const sectionRows = useMemo(() => {
    if (!result) return [];
    switch (activeSection) {
      case "Winners":
        return result.auditRows.filter((row) => row.category === "Winners Not Scaled" || row.category === "Profitable Terms Reduced");
      case "Waste":
        return result.auditRows.filter((row) => row.category === "Losers Not Reduced" || row.category === "Unprofitable Terms Increased");
      case "Wrong Bids":
        return result.auditRows.filter((row) => row.category === "Profitable Terms Reduced" || row.category === "Unprofitable Terms Increased");
      case "Frequency":
        return result.auditRows.filter((row) => row.category === "Too Many Bid Changes" || row.secondaryTags.includes("Too Many Bid Changes"));
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
            <p>Upload History and Targeting reports to expose missed scaling, spend leakage, wrong bid direction, and over-management.</p>
          </div>
          <div className="topbar-actions">
            {result && (
              <button className="button ghost" onClick={() => exportBundle(result)}>
                <Download size={17} />
                Export audit
              </button>
            )}
            <button className="button primary" onClick={runAnalysis} disabled={isLoading || !historyFile || !targetingFile}>
              {isLoading ? <RefreshCw className="spin" size={17} /> : <LineChart size={17} />}
              Analyze
            </button>
          </div>
        </header>

        <section className="upload-strip" aria-label="Upload reports">
          <FileDrop
            title="History CSV"
            description="Amazon Ads bid-change export"
            accept=".csv"
            file={historyFile}
            onChange={(file) => {
              setHistoryFile(file);
              setHistoryRaw(null);
              setResult(null);
            }}
          />
          <FileDrop
            title="Targeting XLSX"
            description="Sponsored Products targeting performance"
            accept=".xlsx,.xls"
            file={targetingFile}
            onChange={(file) => {
              setTargetingFile(file);
              setTargetingRaw(null);
              setResult(null);
            }}
          />
          <ThresholdPanel thresholds={thresholds} onChange={updateThresholds} />
        </section>

        {error && <div className="error-banner"><AlertTriangle size={18} />{error}</div>}

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
  accept,
  file,
  onChange
}: {
  title: string;
  description: string;
  accept: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="file-drop">
      <input
        type="file"
        accept={accept}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <UploadCloud size={20} />
      <span>
        <strong>{file ? file.name : title}</strong>
        <small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : description}</small>
      </span>
    </label>
  );
}

function ThresholdPanel({ thresholds, onChange }: { thresholds: Thresholds; onChange: (next: Thresholds) => void }) {
  function setField<K extends keyof Thresholds>(field: K, value: Thresholds[K]) {
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
            onChange={(event) => onChange(thresholdsForMode(event.target.value as Mode, thresholds))}
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
            onChange={(event) => setField("targetAcos", Number(event.target.value) / 100)}
          />
        </label>
        <label>
          Min clicks
          <input type="number" value={thresholds.minClicks} min={0} onChange={(event) => setField("minClicks", Number(event.target.value))} />
        </label>
        <label>
          Min spend
          <input type="number" value={thresholds.minSpend} min={0} onChange={(event) => setField("minSpend", Number(event.target.value))} />
        </label>
        <label>
          Min orders
          <input type="number" value={thresholds.minOrders} min={0} onChange={(event) => setField("minOrders", Number(event.target.value))} />
        </label>
        <label>
          Lookback
          <input type="number" value={thresholds.lookbackDays} min={3} max={30} onChange={(event) => setField("lookbackDays", Number(event.target.value))} />
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
        <p>The dashboard will calculate match confidence, bid-change behavior, target performance, missed scale opportunities, waste leakage, and exportable action lists.</p>
      </div>
      <div className="empty-checklist">
        <div><CheckCircle2 size={18} /> History CSV with bid changes</div>
        <div><CheckCircle2 size={18} /> Sponsored Products targeting XLSX</div>
        <div><CheckCircle2 size={18} /> Adjustable target ACoS and data thresholds</div>
        <div><CheckCircle2 size={18} /> Local browser-side processing</div>
      </div>
    </section>
  );
}

function Dashboard({
  activeSection,
  result,
  rows,
  thresholds,
  onExport
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
      {activeSection === "Executive" && <ExecutiveView result={result} thresholds={thresholds} onExport={onExport} />}
      {activeSection !== "Executive" && activeSection !== "Campaigns" && activeSection !== "Data Quality" && (
        <ActionView rows={rows} activeSection={activeSection} onExport={onExport} />
      )}
      {activeSection === "Campaigns" && <CampaignView result={result} onExport={onExport} />}
      {activeSection === "Data Quality" && <DataQuality result={result} onExport={onExport} />}
    </div>
  );
}

function StatusStrip({ result }: { result: AnalysisResult }) {
  return (
    <section className="status-strip">
      <StatusItem label="History" value={result.historyStatus.reportType} sub={`${result.historyStatus.rowCount.toLocaleString()} rows · ${result.historyStatus.dateRange}`} />
      <StatusItem label="Targeting" value={result.targetingStatus.reportType} sub={`${result.targetingStatus.rowCount.toLocaleString()} rows · ${result.targetingStatus.dateRange}`} />
      <StatusItem label="Match rate" value={`${percent(result.summary.matchedTargets / Math.max(1, result.summary.totalTargets), 1)}`} sub={`${result.summary.matchedTargets.toLocaleString()} of ${result.summary.totalTargets.toLocaleString()} targets`} />
      <StatusItem label="Unsupported" value={`${result.summary.sbHistoryRows.toLocaleString()} SB rows`} sub="Isolated until SB performance is uploaded" />
    </section>
  );
}

function StatusItem({ label, value, sub }: { label: string; value: string; sub: string }) {
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
    { label: "Decision score", value: `${result.summary.decisionScore}`, sub: "0-100 quality score", tone: "score" },
    { label: "Targets analyzed", value: number(result.summary.totalTargets), sub: `${number(result.summary.matchedTargets)} matched`, tone: "neutral" },
    { label: "Winners not scaled", value: number(result.summary.winnersNotScaled), sub: money(result.summary.estimatedMissedSales), tone: "good" },
    { label: "Waste not reduced", value: number(result.summary.losersNotReduced), sub: money(result.summary.estimatedWastedSpend), tone: "warn" },
    { label: "Wrong bid changes", value: number(result.summary.wrongIncreases + result.summary.wrongReductions), sub: `${result.summary.wrongIncreases} inc · ${result.summary.wrongReductions} red`, tone: "bad" },
    { label: "Too many changes", value: number(result.summary.tooManyBidChanges), sub: "Repeated bid edits", tone: "amber" }
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

function ExecutiveView({ result, thresholds, onExport }: { result: AnalysisResult; thresholds: Thresholds; onExport: (kind: string) => void }) {
  return (
    <div className="executive-grid">
      <section className="panel wide">
        <div className="panel-header">
          <div>
            <h2>Decision quality story</h2>
            <p>Target ACoS is set to {percent(thresholds.targetAcos, 0)} using {thresholds.mode.toLowerCase()} thresholds.</p>
          </div>
          <button className="button ghost" onClick={() => onExport("executive")}>
            <Download size={16} />
            Summary
          </button>
        </div>
        <Charts result={result} />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>What needs attention</h2>
            <p>Plain-English audit signals</p>
          </div>
        </div>
        <div className="insight-list">
          {result.warnings.map((warning) => (
            <div className="insight warning" key={warning}><AlertTriangle size={17} />{warning}</div>
          ))}
          {topReasons(result.auditRows).map((row) => (
            <div className="insight" key={`${row.campaign}-${row.targeting}-${row.category}`}>
              <Flame size={17} />
              <span>{row.reason}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel full">
        <div className="panel-header">
          <div>
            <h2>Highest-priority actions</h2>
            <p>Sorted by financial impact, confidence, and urgency.</p>
          </div>
          <button className="button ghost" onClick={() => onExport("actions")}>
            <Download size={16} />
            Actions CSV
          </button>
        </div>
        <ActionTable rows={result.auditRows.filter((row) => row.priority !== "Low" && row.priority !== "Watch").slice(0, 18)} compact />
      </section>
    </div>
  );
}

function Charts({ result }: { result: AnalysisResult }) {
  return (
    <div className="charts-grid">
      <div className="chart-box">
        <h3>ACoS vs bid action</h3>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 10, right: 16, bottom: 20, left: 0 }}>
            <CartesianGrid stroke="#E5E7EB" />
            <XAxis type="number" dataKey="acos" tickCount={5} tickFormatter={(v) => `${Math.round(v * 100)}%`} name="ACoS" />
            <YAxis type="number" dataKey="bidChange" tickCount={5} tickFormatter={(v) => `${Math.round(v * 100)}%`} name="Bid change" />
            <Tooltip formatter={(value: number, name) => name === "acos" || name === "bidChange" ? percent(value, 1) : money2(value)} />
            <Scatter data={result.charts.scatter}>
              {result.charts.scatter.map((entry, index) => <Cell key={index} fill={categoryColors[entry.category] ?? "#475569"} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-box">
        <h3>Spend vs sales</h3>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 10, right: 16, bottom: 20, left: 0 }}>
            <CartesianGrid stroke="#E5E7EB" />
            <XAxis type="number" dataKey="spend" tickCount={5} tickFormatter={(v) => `$${Math.round(v)}`} />
            <YAxis type="number" dataKey="sales" tickCount={5} tickFormatter={(v) => `$${Math.round(v)}`} />
            <Tooltip formatter={(value: number) => money2(value)} />
            <Scatter data={result.charts.spendSales}>
              {result.charts.spendSales.map((entry, index) => <Cell key={index} fill={categoryColors[entry.category] ?? "#475569"} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-box">
        <h3>Priority breakdown</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={result.charts.priorityBreakdown}>
            <CartesianGrid stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#0F766E" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-box">
        <h3>Before/after impact</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={result.charts.beforeAfter}>
            <CartesianGrid stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="name" hide />
            <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} />
            <Tooltip formatter={(value: number) => percent(value, 1)} />
            <Legend />
            <Bar dataKey="preAcos" name="Pre ACoS" fill="#94A3B8" radius={[6, 6, 0, 0]} />
            <Bar dataKey="postAcos" name="Post ACoS" fill="#0F766E" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ActionView({ rows, activeSection, onExport }: { rows: AuditRow[]; activeSection: Section; onExport: (kind: string) => void }) {
  return (
    <section className="panel full">
      <div className="panel-header">
        <div>
          <h2>{activeSection === "Actions" ? "Action dashboard" : activeSection}</h2>
          <p>{rows.length.toLocaleString()} target combinations match this view.</p>
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

function ActionTable({ rows, compact = false }: { rows: AuditRow[]; compact?: boolean }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [priority, setPriority] = useState("All");
  const [sort, setSort] = useState<"priorityScore" | "spend" | "sales" | "acos" | "bidChanges">("priorityScore");

  const filtered = useMemo(() => {
    return rows
      .filter((row) => category === "All" || row.category === category)
      .filter((row) => priority === "All" || row.priority === priority)
      .filter((row) => {
        const haystack = `${row.campaign} ${row.adGroup} ${row.targeting} ${row.reason}`.toLowerCase();
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
            <input placeholder="Search campaign, target, reason" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label>
            <Filter size={15} />
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option>All</option>
              {unique(rows.map((row) => row.category)).map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option>All</option>
              {(["Critical", "High", "Medium", "Low", "Watch"] as Priority[]).map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            Sort
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
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
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, compact ? 18 : 500).map((row) => (
              <tr key={`${row.campaign}-${row.adGroup}-${row.targeting}-${row.matchType}`}>
                <td><Badge tone={priorityTone(row.priority)}>{row.priority}</Badge></td>
                <td><strong>{row.recommendation}</strong><small>{row.category}</small></td>
                <td className="reason-cell">{row.reason}</td>
                <td><span>{row.campaign}</span><small>{row.adGroup}</small></td>
                <td><span>{row.targeting}</span><small>{row.matchType}</small></td>
                <td>{money2(row.spend)}</td>
                <td>{money2(row.sales)}</td>
                <td>{number(row.orders)}</td>
                <td>{percent(row.acos)}</td>
                <td><span>{money2(row.previousBid)} → {money2(row.latestBid)}</span><small>{percent(row.bidChangePct)}</small></td>
                <td><span>{row.bidChanges}</span><small>{dateShort(row.lastBidChangeDate)}</small></td>
                <td><Badge tone="slate">{row.confidence}</Badge><small>{row.matchLevel}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CampaignView({ result, onExport }: { result: AnalysisResult; onExport: (kind: string) => void }) {
  return (
    <section className="panel full">
      <div className="panel-header">
        <div>
          <h2>Campaign breakdown</h2>
          <p>Issue concentration by campaign and ad group.</p>
        </div>
        <button className="button ghost" onClick={() => onExport("campaigns")}>
          <Download size={16} />
          Campaign CSV
        </button>
      </div>
      <div className="campaign-grid">
        <div className="chart-box heatmap">
          <h3>Campaign issue heatmap</h3>
          <div className="heatmap-table">
            {result.campaignSummary.slice(0, 22).map((row) => (
              <div className="heatmap-row" key={row.campaign}>
                <span>{row.campaign}</span>
                <Meter value={row.winnersNotScaled} max={8} color="#0F766E" />
                <Meter value={row.losersNotReduced} max={8} color="#B45309" />
                <Meter value={row.wrongBidChanges} max={8} color="#DC2626" />
                <Meter value={row.tooManyBidChanges} max={14} color="#92400E" />
                <strong>{money(row.spend)}</strong>
              </div>
            ))}
          </div>
        </div>
        <SummaryTable rows={result.campaignSummary} title="Campaigns" />
        <SummaryTable rows={result.adGroupSummary} title="Ad groups" />
      </div>
    </section>
  );
}

function SummaryTable({ rows, title }: { rows: CampaignSummary[]; title: string }) {
  return (
    <div className="summary-table">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Spend</th>
            <th>ACoS</th>
            <th>Issues</th>
            <th>Unmatched</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 16).map((row) => (
            <tr key={row.campaign}>
              <td>{row.campaign}</td>
              <td>{money(row.spend)}</td>
              <td>{percent(row.acos)}</td>
              <td>{row.issueCount}</td>
              <td>{row.unmatched}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataQuality({ result, onExport }: { result: AnalysisResult; onExport: (kind: string) => void }) {
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
        <FileStatusBlock title="Targeting XLSX" status={result.targetingStatus} />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Match confidence</h2>
            <p>Rows are never silently discarded.</p>
          </div>
          <button className="button ghost" onClick={() => onExport("unmatched")}>
            <Download size={16} />
            Unmatched
          </button>
        </div>
        <div className="match-grid">
          <StatusItem label="High exact" value={number(result.summary.highExact)} sub="Campaign + ad group + target + match" />
          <StatusItem label="High canonical" value={number(result.summary.highCanonical)} sub="Product/auto target normalized" />
          <StatusItem label="Medium" value={number(result.summary.mediumMatch)} sub="Matched without match type" />
          <StatusItem label="Unmatched" value={number(result.summary.unmatchedTargets)} sub="Visible for review" />
        </div>
        <div className="warning-stack">
          {result.warnings.map((warning) => (
            <div className="insight warning" key={warning}><AlertTriangle size={17} />{warning}</div>
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

function FileStatusBlock({ title, status }: { title: string; status: AnalysisResult["historyStatus"] }) {
  return (
    <div className="file-status">
      <h3>{title}</h3>
      <p><strong>{status.fileName}</strong></p>
      <p>{status.reportType}</p>
      <p>{status.rowCount.toLocaleString()} rows · {status.dateRange}</p>
      <details>
        <summary>{status.columns.length} detected columns</summary>
        <div className="column-list">{status.columns.map((column) => <span key={column}>{column}</span>)}</div>
      </details>
    </div>
  );
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Meter({ value, max, color }: { value: number; max: number; color: string }) {
  return <span className="meter" title={`${value}`}><i style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} /></span>;
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
    downloadText("amazon-ppc-executive-summary.md", executiveSummaryMarkdown(result.summary), "text/markdown;charset=utf-8");
    return;
  }
  if (kind === "campaigns") {
    downloadText("amazon-ppc-campaign-summary.csv", toCsv(result.campaignSummary.map(campaignToExport)));
    return;
  }
  if (kind === "unmatched") {
    downloadText("amazon-ppc-unmatched-rows.csv", toCsv(result.unmatchedPerformanceRows.map(auditRowToExport)));
    return;
  }
  const filtered = kind === "actions"
    ? rows.filter((row) => ["Increase bid", "Reduce bid", "Pause / review", "Review match"].includes(row.recommendation))
    : kind === "winners"
      ? rows.filter((row) => row.category === "Winners Not Scaled")
      : kind === "waste"
        ? rows.filter((row) => row.category === "Losers Not Reduced")
        : kind === "wrong"
          ? rows.filter((row) => row.category === "Profitable Terms Reduced" || row.category === "Unprofitable Terms Increased")
          : rows;
  downloadText(`amazon-ppc-${kind}-audit.csv`, toCsv(filtered.map(auditRowToExport)));
}

function exportBundle(result: AnalysisResult) {
  handleExport("actions", result);
}
