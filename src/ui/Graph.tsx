import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClusterStore } from "../engine/store";
import { employers } from "../engine/cv";
import { virtualConfigMaps, virtualIngresses } from "../engine/virtual";
import { nameOf, nsOf, type Ctx } from "../kubectl/resources";
import { NS_ORDER, deploymentsIn, employerOf, podTone, podsOfDeployment, selId, type Sel } from "./model";

/** Plain heptagon glyph (the official icon has a white inner outline that looks like a glitch at small sizes). */
const NsGlyph = () => (
  <svg className="ns-glyph" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><polygon points="12,2 20,5.8 22,14.5 16.5,21.5 7.5,21.5 2,14.5 4,5.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="12" cy="12" r="2.2" fill="currentColor" /></svg>
);

interface Props { store: ClusterStore; ctx: Ctx; version: number; ns: string; sel?: Sel; onSel: (s: Sel) => void }
interface Edge { id: string; d: string }
interface Particle { id: number; d: string }

const BULGE = 22;
function edgePath(a: DOMRect, b: DOMRect, root: DOMRect): string {
  const x1 = a.right - root.left; const y1 = a.top + a.height / 2 - root.top;
  const x2 = b.right - root.left; const y2 = b.top + b.height / 2 - root.top;
  const bulge = BULGE + Math.min(30, Math.abs(y2 - y1) / 8);
  return `M${x1} ${y1} C${x1 + bulge} ${y1} ${x2 + bulge} ${y2} ${x2} ${y2}`;
}

export function Graph({ store, ctx, version, ns, sel, onSel }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pills = useRef(new Map<string, HTMLElement>());
  const [edges, setEdges] = useState<Edge[]>([]);
  const [parts, setParts] = useState<Particle[]>([]);
  const lastFlow = useRef(0);
  const partId = useRef(0);

  // focus: the selected deployment (or the deployment owning the selected pod) plus its neighbours
  const selDep = sel ? (sel.key === "deployments" ? sel.name : sel.key === "pods" ? store.data.pods.get(`${sel.ns}/${sel.name}`)?.metadata?.labels?.app : undefined) : undefined;
  const selWl = employerOf(sel?.ns ?? "")?.workloads;
  const related = new Set<string>();
  if (selDep && selWl) {
    related.add(selDep);
    for (const w of selWl) { if (w.name === selDep) w.calls?.forEach((c) => related.add(c)); if (w.calls?.includes(selDep)) related.add(w.name); }
  }
  const focus = !!selDep;
  const shown = NS_ORDER.filter((n) => ns === "all" || n === ns);
  const sandboxDeps = deploymentsIn(store, "sandbox");

  // layout signature: which deployments exist where
  const signature = useMemo(() => shown.map((n) => `${n}:${deploymentsIn(store, n).map(nameOf).join(",")}`).join("|"), [store, version, ns]); // eslint-disable-line react-hooks/exhaustive-deps

  const measure = () => {
    const root = rootRef.current;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    const next: Edge[] = [];
    for (const e of employers) {
      if (!shown.includes(e.ns)) continue;
      for (const w of e.workloads) {
        for (const c of w.calls ?? []) {
          const a = pills.current.get(`${e.ns}/${w.name}`); const b = pills.current.get(`${e.ns}/${c}`);
          if (a && b) next.push({ id: `${e.ns}/${w.name}>${c}`, d: edgePath(a.getBoundingClientRect(), b.getBoundingClientRect(), rr) });
        }
      }
    }
    setEdges(next);
  };

  useLayoutEffect(measure, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  // turn real network flows into particles travelling along the matching edge
  useEffect(() => {
    const fresh = store.flows.filter((f) => f.id > lastFlow.current);
    if (!fresh.length) return;
    lastFlow.current = fresh[fresh.length - 1].id;
    const edgeMap = new Map(edges.map((e) => [e.id, e.d]));
    const add: Particle[] = [];
    for (const f of fresh.slice(-6)) {
      const pod = (h: string) => store.data.pods.get(h.replace(/^pod\//, ""));
      const podHops = f.hops.filter((h) => h.startsWith("pod/"));
      if (podHops.length < 2) continue;
      const from = pod(podHops[0])?.metadata; const to = pod(podHops[podHops.length - 1])?.metadata;
      if (!from || !to) continue;
      const d = edgeMap.get(`${from.namespace}/${from.labels?.app}>${to.labels?.app}`);
      if (d) add.push({ id: ++partId.current, d });
    }
    if (!add.length) return;
    setParts((p) => [...p, ...add].slice(-24));
    const ids = new Set(add.map((a) => a.id));
    setTimeout(() => setParts((p) => p.filter((x) => !ids.has(x.id))), 1100);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const configMaps = virtualConfigMaps(ctx.bootedAt);
  const chip = (cm: { metadata: { name: string; namespace: string } }, label?: string) => {
    const s: Sel = { key: "configmaps", ns: cm.metadata.namespace, name: cm.metadata.name };
    return <button key={cm.metadata.name} className="chip" aria-pressed={sel ? selId(sel) === selId(s) : false} onClick={() => onSel(s)}>{label ?? cm.metadata.name}</button>;
  };

  return (
    <div className="graph" ref={rootRef}>
      <svg className="graph-svg" aria-hidden="true">
        {edges.map((e) => {
          const [from, to] = e.id.split(">"); const [eNs, a] = from.split("/");
          const hot = focus && eNs === sel?.ns && (a === selDep || to === selDep);
          return <path key={e.id} d={e.d} fill="none" stroke={hot ? "#6ee7a8" : "#2c2c30"} strokeWidth={hot ? 1.8 : 1.2} opacity={focus && !hot ? 0.35 : 1} />;
        })}
        {parts.map((p) => (
          <circle key={p.id} r="3.2" fill="#6ee7a8">
            <animateMotion dur="0.9s" path={p.d} fill="freeze" />
          </circle>
        ))}
      </svg>
      <div className="panels">
        {shown.map((n) => {
          const meta = employerOf(n);
          const deps = n === "sandbox" ? sandboxDeps : deploymentsIn(store, n);
          const cms = configMaps.filter((c) => c.metadata.namespace === n);
          const ings = virtualIngresses(ctx.bootedAt).filter((i) => i.metadata.namespace === n);
          return (
            <div className="panel" key={n} style={{ paddingRight: 40 }}>
              <div className="panel-head"><NsGlyph /><h3>{n}</h3></div>
              {meta && (meta.company !== meta.ns) && <p className="panel-meta">{meta.role}{meta.period ? ` · ${meta.period}` : ""}{meta.place ? ` · ${meta.place}` : ""}</p>}
              {n === "sandbox" && !deps.length && <p className="panel-meta">Empty. Create something: <span className="mono">kubectl create deployment web --image=nginx -n sandbox</span></p>}
              {deps.map((d) => {
                const pods = podsOfDeployment(store, n, nameOf(d));
                const s: Sel = { key: "deployments", ns: n, name: nameOf(d) };
                return (
                  <div key={nameOf(d)} className={`pill${focus && !(n === sel?.ns && related.has(nameOf(d))) ? " dim" : ""}`} data-on={sel ? selId(sel) === selId(s) : false} ref={(el) => { const k = `${n}/${nameOf(d)}`; if (el) pills.current.set(k, el); else pills.current.delete(k); }}>
                    <button className="nm" aria-pressed={sel ? selId(sel) === selId(s) : false} aria-label={`deployment ${nameOf(d)}, ${pods.length} pods`} onClick={() => onSel(s)}>{nameOf(d)}</button>
                    <span className="pods">
                      {pods.map((p) => {
                        const ps: Sel = { key: "pods", ns: n, name: nameOf(p) };
                        return <button key={nameOf(p)} aria-label={`pod ${nameOf(p)}, ${podTone(p) === "ok" ? "running" : podTone(p) === "warn" ? "crash looping" : "not ready"}`} className={`pd ${podTone(p)}${sel && selId(sel) === selId(ps) ? " sel" : ""}`} onClick={() => onSel(ps)} />;
                      })}
                    </span>
                  </div>
                );
              })}
              {(cms.length > 0 || ings.length > 0) && (
                <div className="chips">
                  {ings.map((i) => {
                    const s: Sel = { key: "ingresses", ns: n, name: i.metadata.name };
                    return <button key={i.metadata.name} className="chip" aria-pressed={sel ? selId(sel) === selId(s) : false} onClick={() => onSel(s)}>ingress · {String((i.spec as { rules: Array<{ host: string }> }).rules[0].host)} ↗</button>;
                  })}
                  {cms.map((c) => chip(c))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="legend">
        <span><i className="pd ok" /> Running</span><span><i className="pd warn" /> CrashLoopBackOff</span><span><i className="pd" /> Pending</span><span>lines = service calls · moving dots = live requests</span>
      </div>
    </div>
  );
}

export { nsOf };
