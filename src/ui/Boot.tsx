import { useEffect, useRef, useState } from "react";
import type { ClusterStore } from "../engine/store";
import { employers } from "../engine/cv";
import { nameOf, nsOf, podReady, podStatus } from "../kubectl/resources";
import logo from "../assets/k8s/logo.svg";
import nodeIcon from "../assets/k8s/node.svg";
import nsIcon from "../assets/k8s/ns.svg";
import podIcon from "../assets/k8s/pod.svg";

const MIN_MS = 6500;
const EXPECTED = employers.reduce((n, e) => n + e.workloads.reduce((m, w) => m + w.replicas, 0), 0);

const PREFLIGHT: Array<[number, string]> = [
  [0.00, "[preflight] Running pre-flight checks"],
  [0.04, "[certs] Generating \"ca\" certificate and key"],
  [0.08, "[etcd] Creating static Pod manifest for local etcd"],
  [0.12, "[control-plane] kube-apiserver manifest created"],
  [0.16, "[control-plane] kube-scheduler manifest created"],
  [0.20, "[apiserver] control-plane is healthy"],
];
// layout: hub on top, three nodes, namespaces under their node
const NODES = ["node-1", "node-2", "node-3"];
const LEAVES: Array<{ ns: string; node: number; x: number }> = [
  { ns: "mobees", node: 0, x: 35 }, { ns: "savigo", node: 0, x: 145 }, { ns: "iceo", node: 1, x: 280 },
  { ns: "axb-hub", node: 2, x: 415 }, { ns: "incident-lab", node: 2, x: 525 },
];
const NODE_X = [90, 280, 470];

export function Boot({ store, instant, onDone }: { store: ClusterStore | undefined; instant: boolean; onDone: () => void }) {
  const t0 = useRef(performance.now());
  const [tick, setTick] = useState(0);
  const [done, setDone] = useState(false);
  const [skip, setSkip] = useState(false);
  const finished = useRef(false);
  const progress = useRef(0);

  useEffect(() => {
    if (instant) return;
    const id = setInterval(() => setTick((n) => n + 1), 80);
    return () => clearInterval(id);
  }, [instant]);

  const pods = store ? store.list("pods") : [];
  const own = pods.filter((p) => employers.some((e) => e.ns === nsOf(p)));
  const ready = own.filter((p) => podStatus(p) === "Running" && !podReady(p).startsWith("0/")).length;
  const crashing = own.filter((p) => podStatus(p) === "CrashLoopBackOff").length;
  const real = store ? (skip ? 1 : Math.min(1, (ready + crashing) / EXPECTED)) : 0;
  const elapsed = performance.now() - t0.current;
  const time = skip ? 1 : Math.min(1, elapsed / MIN_MS);
  const target = Math.min(time, store ? 0.1 + 0.9 * real : 0.1);
  progress.current = progress.current + (target - progress.current) * 0.35;
  const p = Math.min(1, progress.current);
  const pct = p > 0.995 && time >= 1 && real >= 1 ? 100 : Math.min(99, Math.floor(p * 100));

  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (finished.current || (!instant && pct < 100)) return;
    finished.current = true;
    closeTimer.current = setTimeout(() => { setDone(true); onDone(); }, instant ? 0 : 700);
  }, [pct, instant, onDone, tick]);

  if (instant) return null;

  const phase = p < 0.2 ? "Provisioning control plane" : p < 0.5 ? "Joining worker nodes" : p < 0.9 ? "Scheduling workloads" : pct < 100 ? "Verifying health" : "Cluster ready";
  const events = store ? store.list("events").filter((e) => ["Scheduled", "Started", "ScalingReplicaSet", "BackOff"].includes(e.reason ?? "")).sort((a, b) => String(a.lastTimestamp ?? a.eventTime ?? "").localeCompare(String(b.lastTimestamp ?? b.eventTime ?? ""))).slice(-14) : [];
  const fixed = PREFLIGHT.filter(([at]) => p >= at).map(([, l]) => ({ l, good: l.includes("healthy") }));
  const logs = [...fixed, ...events.map((e) => ({ l: `${e.reason} ${String(e.involvedObject?.kind ?? "").toLowerCase()}/${e.involvedObject?.name}: ${e.message ?? ""}`, good: e.reason === "Started" }))].slice(-22);

  const hubOn = p >= 0.03;
  const nodeOn = (i: number) => store ? store.list("nodes").length > i && p >= 0.2 + i * 0.05 : false;
  const readyIn = (ns: string) => own.filter((x) => nsOf(x) === ns && podStatus(x) === "Running").length;
  const wantIn = (ns: string) => employers.find((e) => e.ns === ns)!.workloads.reduce((m, w) => m + w.replicas, 0);

  return (
    <div className={`boot${done ? " done" : ""}`} role="status" aria-label="Deploying cluster">
      <div className="boot-stage">
        <svg viewBox="-24 -14 616 352" aria-hidden="true">
          {NODE_X.map((x, i) => <line key={`h${i}`} className="be" x1={280} y1={50} x2={x} y2={150} style={{ opacity: nodeOn(i) ? 1 : 0, transition: "opacity .6s" }} />)}
          {LEAVES.map((l) => <line key={`l${l.ns}`} className="be" x1={NODE_X[l.node]} y1={150} x2={l.x} y2={250} style={{ opacity: p >= 0.45 ? 1 : 0, transition: "opacity .6s" }} />)}
          <g transform="translate(280 50)"><g className={`bn${hubOn ? " on" : ""}${p >= 0.2 ? " ready" : ""}`}><circle className="core" r="34" /><image href={logo} x={-22} y={-22} width="44" height="44" /><text y="-46" textAnchor="middle">control-plane</text></g></g>
          {NODES.map((n, i) => <g key={n} transform={`translate(${NODE_X[i]} 150)`}><g className={`bn${nodeOn(i) ? " on" : ""}${nodeOn(i) ? " ready" : ""}`}><circle className="core" r="26" /><image href={nodeIcon} x={-17} y={-17} width="34" height="34" /><text y="-40" textAnchor="middle">{n}</text></g></g>)}
          {LEAVES.map((l) => {
            const on = p >= 0.45; const r = readyIn(l.ns) >= wantIn(l.ns) - (l.ns === "incident-lab" ? 1 : 0) && real > 0;
            return (
              <g key={l.ns} transform={`translate(${l.x} 250)`}>
                <g className={`bn${on ? " on" : ""}${on && r ? " ready" : ""}${l.ns === "incident-lab" ? " lab" : ""}`}>
                  <circle className="core" r="22" /><image href={nsIcon} x={-14} y={-14} width="28" height="28" />
                  <text y="64" textAnchor="middle">{l.ns}</text>
                  {[-20, 0, 20].map((px, i) => <image key={i} href={podIcon} x={px - 7} y={31} width="14" height="14" style={{ opacity: on && readyIn(l.ns) > i ? 1 : 0.2, filter: on && readyIn(l.ns) > i ? "none" : "grayscale(1)", transition: "opacity .4s" }} />)}
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="boot-logs" aria-hidden="true">{logs.map((x, i) => <div key={i} className={x.good ? "good" : undefined}>{x.l}</div>)}</div>
      <div className="boot-bar">
        <div className="pct">{pct}%</div>
        <div className="boot-meta"><div className="boot-phase">{phase}</div><div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div></div>
        {elapsed > 2000 && !skip && <button className="skip-intro" onClick={() => setSkip(true)}>Skip intro →</button>}
      </div>
    </div>
  );
}
export { nameOf };
