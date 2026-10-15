import { useEffect, useMemo, useRef, useState } from "react";
import type { ClusterStore } from "../engine/store";
import { logStream, type LogEntry } from "../engine/logs";
import type { Sample } from "../engine/metrics";
import { nameOf, nsOf, podStatus } from "../kubectl/resources";

export type DashTab = "overview" | "logs";
interface Props { store: ClusterStore; tab: DashTab; query?: string; onClose: () => void }

const PALETTE = ["#6ee7a8", "#7aa2f7", "#f0b565", "#c4a7e7", "#f2a3a3"];

function useTicker(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => { const id = setInterval(() => setN((x) => x + 1), ms); return () => clearInterval(id); }, [ms]);
  return n;
}

/* ---------- charts ---------- */
interface Series { name: string; color: string; values: number[] }

function Chart({ title, unit, series, empty }: { title: string; unit: string; series: Series[]; empty?: string }) {
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const nice = max <= 4 ? Math.ceil(max) : Math.ceil(max / 5) * 5;
  const pts = (v: number[]) => v.map((y, i) => `${(((i + (n - v.length)) / (n - 1)) * 300).toFixed(1)},${(88 - (y / nice) * 80).toFixed(1)}`).join(" ");
  return (
    <figure className="chart">
      <figcaption><span>{title}</span><span className="legend-inline">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</span></figcaption>
      <div className="chart-box">
        <span className="ymax">{nice}{unit}</span>
        <svg viewBox="0 0 300 90" preserveAspectRatio="none" role="img" aria-label={`${title}: ${series.map((s) => `${s.name} ${s.values[s.values.length - 1] ?? 0}${unit}`).join(", ")}`}>
          {[8, 36, 64, 88].map((y) => <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="#232326" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          {series.map((s) => s.values.length > 1 && (
            <g key={s.name}>
              <polygon points={`${pts(s.values)} 300,88 ${(((n - s.values.length) / (n - 1)) * 300).toFixed(1)},88`} fill={s.color} opacity="0.08" />
              <polyline points={pts(s.values)} fill="none" stroke={s.color} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </svg>
        {series.every((s) => s.values.length < 2 || s.values.every((v) => v === 0)) && empty && <span className="chart-empty">{empty}</span>}
      </div>
    </figure>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  return <div className={`tile${tone ? ` ${tone}` : ""}`}><span>{label}</span><b>{value}</b></div>;
}

/* ---------- LogQL-lite ---------- */
type Matcher = { key: string; op: "=" | "!=" | "=~"; value: string };
type Filter = { op: "|=" | "!=" | "|~"; text: string };
type Parsed = { ok: true; matchers: Matcher[]; filters: Filter[] } | { ok: false; error: string };

export function parseQuery(q: string): Parsed {
  const src = q.trim();
  if (!src) return { ok: true, matchers: [], filters: [] };
  const sel = src.match(/^\{([^}]*)\}\s*(.*)$/s);
  if (!sel) return { ok: false, error: 'parse error: query must start with a selector, e.g. {namespace="iceo"}' };
  const matchers: Matcher[] = [];
  for (const part of sel[1].split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(namespace|app|pod|level)\s*(=~|!=|=)\s*"([^"]*)"$/);
    if (!m) return { ok: false, error: `parse error: unexpected selector "${part}" (labels: namespace, app, pod, level)` };
    if (m[2] === "=~") { try { new RegExp(m[3]); } catch { return { ok: false, error: `parse error: invalid regex "${m[3]}"` }; } }
    matchers.push({ key: m[1], op: m[2] as Matcher["op"], value: m[3] });
  }
  const filters: Filter[] = [];
  let rest = sel[2].trim();
  const f = /^(\|=|!=|\|~)\s*"([^"]*)"\s*/;
  while (rest) {
    const m = rest.match(f);
    if (!m) return { ok: false, error: `parse error: unexpected "${rest.slice(0, 20)}" (use |= "text", != "text" or |~ "regex")` };
    if (m[1] === "|~") { try { new RegExp(m[2]); } catch { return { ok: false, error: `parse error: invalid regex "${m[2]}"` }; } }
    filters.push({ op: m[1] as Filter["op"], text: m[2] });
    rest = rest.slice(m[0].length);
  }
  return { ok: true, matchers, filters };
}

export function matches(e: LogEntry, p: Extract<Parsed, { ok: true }>): boolean {
  const labels: Record<string, string> = { namespace: e.ns, app: e.app, pod: e.pod, level: e.level };
  for (const m of p.matchers) {
    const v = labels[m.key];
    if (m.op === "=" && v !== m.value) return false;
    if (m.op === "!=" && v === m.value) return false;
    if (m.op === "=~" && !new RegExp(`^(?:${m.value})$`).test(v)) return false;
  }
  for (const f of p.filters) {
    if (f.op === "|=" && !e.line.includes(f.text)) return false;
    if (f.op === "!=" && e.line.includes(f.text)) return false;
    if (f.op === "|~" && !new RegExp(f.text).test(e.line)) return false;
  }
  return true;
}

const PRESETS = [
  ["everything", '{namespace=~".+"}'],
  ["incident-lab", '{namespace="incident-lab"}'],
  ["errors", '{level="FATAL"}'],
  ["warnings + errors", '{level=~"WARN|FATAL"}'],
  ["iceo requests", '{namespace="iceo"} |= "GET"'],
] as const;

function LogExplorer({ initial }: { initial?: string }) {
  const [query, setQuery] = useState(initial ?? '{namespace=~".+"}');
  const [paused, setPaused] = useState(false);
  const frozen = useRef<readonly LogEntry[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useTicker(500);
  const parsed = parseQuery(query);
  const all = paused ? frozen.current : logStream();
  const lines = useMemo(() => (parsed.ok ? all.filter((e) => matches(e, parsed)).slice(-150) : []), [all, query, parsed.ok]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!paused) box.current?.scrollTo({ top: box.current.scrollHeight }); });

  const time = (t: number) => new Date(t).toISOString().slice(11, 23);
  return (
    <div className="explore">
      <div className="q-row">
        <label htmlFor="logql">LogQL</label>
        <input id="logql" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} aria-invalid={!parsed.ok} aria-describedby="logql-help" />
        <button className="chip" onClick={() => { frozen.current = [...logStream()]; setPaused(!paused); }}>{paused ? "▶ Resume" : "❚❚ Pause"}</button>
      </div>
      <div className="chips presets">{PRESETS.map(([n, q]) => <button key={n} className="chip" aria-pressed={query === q} onClick={() => setQuery(q)}>{n}</button>)}</div>
      <p id="logql-help" className={parsed.ok ? "muted small" : "err small"} role={parsed.ok ? undefined : "alert"}>
        {parsed.ok ? `Labels: namespace, app, pod, level. Filters: |= "text"  != "text"  |~ "regex". ${lines.length} lines${paused ? " (paused)" : ", live"}.` : parsed.error}
      </p>
      <div className="loglines" ref={box} role="log" aria-live="off" tabIndex={0}>
        {lines.length === 0 && parsed.ok && <p className="muted">No logs match yet.</p>}
        {lines.map((e) => (
          <div key={e.id} className={`ll ${e.level}`}>
            <span className="t">{time(e.ts)}</span>
            <span className="lv">{e.level}</span>
            <span className="lb">{e.ns}/{e.app}</span>
            <span className="msg">{e.line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- overview ---------- */
function Overview({ store, goLogs }: { store: ClusterStore; goLogs: (q: string) => void }) {
  useTicker(1000);
  const samples: Sample[] = store.metrics.samples;
  const last = samples[samples.length - 1];
  const nsKeys = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of samples) for (const [k, v] of Object.entries(s.rpsByNs)) totals.set(k, (totals.get(k) ?? 0) + v);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  }, [samples.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const restartNs = useMemo(() => [...new Set(samples.flatMap((s) => Object.keys(s.restartsByNs)))].slice(0, 5), [samples.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const crashing = store.list("pods").filter((p) => podStatus(p) === "CrashLoopBackOff");
  const firing = [...new Set(crashing.map((p) => `${nsOf(p)}/${p.metadata?.labels?.app ?? nameOf(p)}`))];

  return (
    <div className="ov">
      {firing.length > 0 ? (
        <div className="alert" role="alert">
          <span className="badge-fire">FIRING</span>
          <span><b>KubePodCrashLooping</b> · {firing.join(", ")} · {crashing.length} pod{crashing.length > 1 ? "s" : ""} restarting repeatedly</span>
          <button className="chip" onClick={() => goLogs(`{namespace="${nsOf(crashing[0])}", level="FATAL"}`)}>Investigate logs →</button>
        </div>
      ) : (
        <div className="alert ok" role="status"><span className="badge-ok">OK</span><span>No alerts firing.</span></div>
      )}
      <div className="tiles">
        <Tile label="Pods ready" value={last ? `${last.ready}/${last.total}` : "-"} tone={last && last.ready === last.total ? "ok" : "warn"} />
        <Tile label="Requests / s" value={last ? String(last.rps) : "-"} />
        <Tile label="Latency p95" value={last ? `${last.p95} ms` : "-"} />
        <Tile label="Crash-looping" value={String(crashing.length)} tone={crashing.length ? "warn" : "ok"} />
      </div>
      <div className="charts">
        <Chart title="Requests per second" unit="" series={nsKeys.map((k, i) => ({ name: k, color: PALETTE[i % PALETTE.length], values: samples.map((s) => s.rpsByNs[k] ?? 0) }))} empty="Waiting for traffic…" />
        <Chart title="Request latency" unit=" ms" series={[{ name: "p50", color: "#6ee7a8", values: samples.map((s) => s.p50) }, { name: "p95", color: "#f0b565", values: samples.map((s) => s.p95) }]} />
        <Chart title="Pods" unit="" series={[{ name: "ready", color: "#6ee7a8", values: samples.map((s) => s.ready) }, { name: "total", color: "#7aa2f7", values: samples.map((s) => s.total) }]} />
        <Chart title="Container restarts" unit="" series={restartNs.map((k, i) => ({ name: k, color: PALETTE[(i + 2) % PALETTE.length], values: samples.map((s) => s.restartsByNs[k] ?? 0) }))} empty="No restarts. Everything is calm." />
      </div>
    </div>
  );
}

/* ---------- window ---------- */
export function Dashboard({ store, tab: initialTab, query, onClose }: Props) {
  const [tab, setTab] = useState<DashTab>(initialTab);
  const [q, setQ] = useState<string | undefined>(query);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dash-back" onClick={onClose}>
      <div className="dash" role="dialog" aria-modal="true" aria-label="Cluster dashboards" onClick={(e) => e.stopPropagation()}>
        <header className="dash-head">
          <div><h2>Dashboards</h2><p className="muted small">Grafana-style view of this cluster. Metrics and logs come live from the simulator.</p></div>
          <div className="dash-tabs" role="tablist">
            <button aria-pressed={tab === "overview"} onClick={() => setTab("overview")}>Overview</button>
            <button aria-pressed={tab === "logs"} onClick={() => setTab("logs")}>Logs</button>
          </div>
          <button ref={closeBtn} className="x" aria-label="Close dashboards" onClick={onClose}>×</button>
        </header>
        <div className="dash-body">
          {tab === "overview" ? <Overview store={store} goLogs={(nq) => { setQ(nq); setTab("logs"); }} /> : <LogExplorer key={q} initial={q} />}
        </div>
      </div>
    </div>
  );
}
