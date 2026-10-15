import { useState } from "react";
import { RESOURCES, nameOf, nsOf, type Ctx } from "../kubectl/resources";
import { selId, toneClass, type Sel } from "./model";

interface Props { ctx: Ctx; version: number; ns: string; sel?: Sel; onSel: (s: Sel) => void }
const TABS = ["pods", "deployments", "services", "configmaps", "ingresses", "nodes", "namespaces", "events"];

export function Resources({ ctx, ns, sel, onSel }: Props) {
  const [tab, setTab] = useState("pods");
  const res = RESOURCES.find((r) => r.key === tab)!;
  const all = ns === "all";
  const items = res.list(ctx).filter((o) => !res.namespaced || all || nsOf(o) === ns).sort((a, b) => (nsOf(a) + nameOf(a)).localeCompare(nsOf(b) + nameOf(b)));
  const showNs = all && res.namespaced;
  const statusCol = res.cols.indexOf("STATUS");
  return (
    <div>
      <div className="tabs" role="tablist">
        {TABS.map((k) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{k}</button>)}
      </div>
      <div className="tw">
        {items.length === 0 ? <p className="empty">No resources found{res.namespaced && !all ? ` in ${ns} namespace` : ""}.</p> : (
          <table>
            <thead><tr>{showNs && <th>NAMESPACE</th>}{res.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {items.map((o) => {
                const s: Sel = { key: res.key, ns: nsOf(o), name: nameOf(o) };
                const row = res.row(o, false, ctx);
                return (
                  <tr key={selId(s)} className={sel && selId(sel) === selId(s) ? "sel" : ""} tabIndex={0} onClick={() => onSel(s)} onKeyDown={(e) => { if (e.key === "Enter") onSel(s); }}>
                    {showNs && <td>{nsOf(o)}</td>}
                    {row.map((c, i) => <td key={i} className={`${i === 0 ? "first " : ""}${i === statusCol ? toneClass(c) : ""}`}>{c}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
