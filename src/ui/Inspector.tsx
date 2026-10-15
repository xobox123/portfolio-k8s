import { useState } from "react";
import type { ClusterStore } from "../engine/store";
import { employers } from "../engine/cv";
import { SANDBOX, deleteResource, deletePod, restartDeployment, scaleDeployment } from "../engine/actions";
import { readLogs } from "../engine/logs";
import { clean, ts, age, yaml } from "../kubectl/format";
import { describeObject } from "../kubectl/describe";
import { nameOf, nsOf, podReady, podRestarts, podStatus, type Ctx, type Obj } from "../kubectl/resources";
import { EditTab } from "./EditTab";
import { podTone, podsOfDeployment, resolve, toneClass, type Sel } from "./model";

interface Props { store: ClusterStore; ctx: Ctx; sel: Sel; onSel: (s: Sel | undefined) => void; version: number; onDash?: (tab: "overview" | "logs") => void }
type Tab = "overview" | "edit" | "logs" | "events" | "describe" | "yaml";

const KIND: Record<string, string> = { pods: "Pod", deployments: "Deployment", services: "Service", configmaps: "ConfigMap", ingresses: "Ingress", nodes: "Node", namespaces: "Namespace", replicasets: "ReplicaSet", endpointslices: "EndpointSlice", events: "Event" };

export function Inspector({ store, ctx, sel, onSel, version, onDash }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | undefined>();
  const hit = resolve(sel, ctx);
  const close = () => onSel(undefined);
  if (!hit) {
    return (
      <aside className="inspector" aria-label="Resource details">
        <div className="insp-head"><h3>{sel.name}</h3><button className="x" aria-label="Close details" onClick={close}>×</button></div>
        <p className="summary">This resource no longer exists.</p>
      </aside>
    );
  }
  const { res, o } = hit;
  const ns = nsOf(o);
  const ann = (o.metadata?.annotations ?? {}) as Record<string, string>;
  const summary = ann["cv.portfolio/summary"];
  const tags = ann["cv.portfolio/stack"]?.split(", ").filter(Boolean) ?? [];
  const sandboxOwned = ns === SANDBOX && ["pods", "deployments", "services"].includes(res.key);
  const tabs: Tab[] = res.key === "deployments" ? ["overview", "edit", "logs", "events", "describe", "yaml"] : res.key === "pods" ? ["overview", "logs", "events", "describe", "yaml"] : ["overview", "describe", "yaml"];
  const active: Tab = tabs.includes(tab) ? tab : "overview";
  const say = (text: string, bad = false) => setMsg({ text, bad });
  const run = async (fn: () => Promise<void>, ok: string) => { try { await fn(); say(ok); } catch (e) { say(String(e), true); } };

  const isDep = res.key === "deployments";
  const pods = isDep ? podsOfDeployment(store, ns, nameOf(o)) : [];
  const logPod: Obj | undefined = res.key === "pods" ? o : pods[0];
  const want = o.spec?.replicas ?? 0;

  // relations from the CV model: who this workload calls and who calls it
  const cv = employers.find((e) => e.ns === ns);
  const depName = isDep ? nameOf(o) : res.key === "pods" ? o.metadata?.labels?.app : undefined;
  const calls = cv?.workloads.find((w) => w.name === depName)?.calls ?? [];
  const calledBy = cv?.workloads.filter((w) => w.calls?.includes(depName ?? "")).map((w) => w.name) ?? [];
  const goDep = (name: string): Sel => ({ key: "deployments", ns, name });

  // headline status
  let statusText = ""; let statusTone = "";
  if (isDep) {
    const ready = o.status?.readyReplicas ?? 0;
    const bad = pods.some((p) => podTone(p) === "warn" || podTone(p) === "bad");
    statusText = bad ? `${ready}/${want} ready · crashing` : `${ready}/${want} ready`;
    statusTone = bad ? "warn-t" : ready === want && want > 0 ? "ok-t" : "";
  } else if (res.key === "pods") { statusText = `${podStatus(o)} · ${podReady(o)}`; statusTone = toneClass(podStatus(o)); }

  const actions = [];
  if (res.key === "pods") {
    actions.push(<button key="r" onClick={() => run(() => deletePod(store, ns, nameOf(o)), "Pod deleted. The ReplicaSet creates a replacement.")}>↻ Restart</button>);
    actions.push(<button key="e" onClick={() => say(`Error from server (Forbidden): pods "${nameOf(o)}" is forbidden: User "visitor" cannot create resource "pods/exec" in API group "" in the namespace "${ns}". exec is disabled in this public demo.`, true)}>&gt;_ Exec</button>);
  }
  if (isDep) {
    actions.push(<button key="r" onClick={() => run(() => restartDeployment(store, ns, nameOf(o)), "Rollout restart started.")}>↻ Rollout restart</button>);
    actions.push(<button key="m" aria-label="Scale down" disabled={want <= 0} onClick={() => run(() => scaleDeployment(store, ns, nameOf(o), want - 1), `Scaled to ${want - 1}.`)}>−</button>);
    actions.push(<span key="n" className="repl" aria-live="polite">{want} replicas</span>);
    actions.push(<button key="p" aria-label="Scale up" disabled={want >= 5} onClick={() => run(() => scaleDeployment(store, ns, nameOf(o), want + 1), `Scaled to ${want + 1}.`)}>+</button>);
  }
  if (res.key === "ingresses") {
    const host = o.spec?.rules?.[0]?.host as string | undefined;
    if (host) actions.push(<a key="open" className="btn-link" href={`https://${host}`} target="_blank" rel="noopener noreferrer">Open {host} ↗</a>);
  }
  if (isDep && ns === "observability" && onDash) {
    const logs = nameOf(o) === "loki";
    actions.push(<button key="dash" className="primary-b" onClick={() => onDash(logs ? "logs" : "overview")}>{logs ? "Open log explorer" : "Open dashboard"} ↗</button>);
  }
  if (sandboxOwned) actions.push(<button key="d" className="danger" onClick={() => run(async () => { await deleteResource(store, res.key as "pods" | "deployments" | "services", nameOf(o)); onSel(undefined); }, "Deleted.")}>Delete</button>);
  else if (res.key === "pods" || isDep) actions.push(<button key="d" className="danger" onClick={() => say(`Error from server (Forbidden): ${res.key} "${nameOf(o)}" is forbidden: User "visitor" cannot delete resource "${res.key}" in the namespace "${ns}". You can delete things in the "${SANDBOX}" namespace.`, true)}>Delete</button>);

  const events = store.list("events").filter((e: Obj) => e.involvedObject?.name === nameOf(o) && e.involvedObject?.namespace === ns)
    .sort((a: Obj, b: Obj) => ts(a.lastTimestamp ?? a.eventTime ?? a.metadata?.creationTimestamp) - ts(b.lastTimestamp ?? b.eventTime ?? b.metadata?.creationTimestamp));

  const facts: Array<[string, string]> = [];
  if (res.key === "pods") facts.push(["Status", podStatus(o)], ["Restarts", String(podRestarts(o))], ["Node", o.spec?.nodeName ?? "-"], ["Pod IP", o.status?.podIP ?? "-"], ["Age", age(Date.now() - ts(o.metadata?.creationTimestamp))]);
  if (isDep) facts.push(["Image", o.spec?.template?.spec?.containers?.[0]?.image ?? "-"], ["Strategy", o.spec?.strategy?.type ?? "RollingUpdate"]);
  if (res.key === "services") facts.push(["Type", o.spec?.type ?? "ClusterIP"], ["Cluster IP", o.spec?.clusterIP ?? "-"], ["Port", (o.spec?.ports ?? []).map((p: Obj) => `${p.port}→${p.targetPort}`).join(", ")], ["Selector", Object.entries(o.spec?.selector ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")]);
  if (res.key === "namespaces") for (const k of ["company", "role", "period", "location"]) if (ann[`cv.portfolio/${k}`]) facts.push([k[0].toUpperCase() + k.slice(1), ann[`cv.portfolio/${k}`]]);
  if (res.key === "ingresses") facts.push(["Host", o.spec?.rules?.[0]?.host ?? "-"], ["Class", o.spec?.ingressClassName ?? "-"], ["Backend", `service/${o.spec?.rules?.[0]?.http?.paths?.[0]?.backend?.service?.name ?? "-"}`], ["Path", o.spec?.rules?.[0]?.http?.paths?.[0]?.path ?? "/"]);
  if (res.key === "configmaps") for (const [k, v] of Object.entries((o.data ?? {}) as Record<string, string>)) facts.push([k, v]);

  return (
    <aside className="inspector" aria-label="Resource details">
      <div className="insp-head">
        <div className="insp-title">
          <div className="insp-kind">{KIND[res.key] ?? res.key}{ns ? ` · ${ns}` : ""}</div>
          <h3>{nameOf(o)}</h3>
          {statusText && <div className={`badge ${statusTone}`}><i className={`pd ${statusTone === "ok-t" ? "ok" : statusTone === "warn-t" ? "warn" : ""}`} />{statusText}</div>}
        </div>
        <button className="x" aria-label="Close details" onClick={close}>×</button>
      </div>

      {actions.length > 0 && <div className="acts">{actions}</div>}
      {msg && <div className={msg.bad ? "err" : "ok-msg"} role={msg.bad ? "alert" : "status"}>{msg.text}</div>}

      <div className="itabs" role="tablist">{tabs.map((t) => <button key={t} aria-pressed={active === t} onClick={() => setTab(t)}>{t}</button>)}</div>

      {active === "overview" && (
        <div className="stack">
          {summary && <p className="lead">{summary}</p>}
          {tags.length > 0 && <div className="tags">{tags.map((t) => <span key={t}>{t}</span>)}</div>}
          {facts.length > 0 && <dl className="facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={k === "Status" ? toneClass(v) : ""}>{v}</dd></div>)}</dl>}

          {isDep && (
            <section>
              <h4>Pods <span>{pods.length}</span></h4>
              {pods.length === 0 ? <p className="muted">No pods (scaled to zero).</p> : (
                <ul className="rows">{pods.map((p) => (
                  <li key={nameOf(p)}><button onClick={() => onSel({ key: "pods", ns, name: nameOf(p) })}>
                    <i className={`pd ${podTone(p)}`} /><span className="mono">{nameOf(p).slice(nameOf(o).length + 1)}</span><span className={toneClass(podStatus(p))}>{podStatus(p)}</span><span className="muted">{age(Date.now() - ts(p.metadata?.creationTimestamp))}</span>
                  </button></li>
                ))}</ul>
              )}
            </section>
          )}

          {isDep && calls.length > 0 && (
            <section><h4>Calls <span>{calls.length}</span></h4><div className="chips">{calls.map((c) => <button key={c} className="chip" onClick={() => onSel(goDep(c))}>→ {c}</button>)}</div></section>
          )}
          {isDep && calledBy.length > 0 && (
            <section><h4>Called by <span>{calledBy.length}</span></h4><div className="chips">{calledBy.map((c) => <button key={c} className="chip" onClick={() => onSel(goDep(c))}>← {c}</button>)}</div></section>
          )}
          {res.key === "pods" && depName && <section><h4>Belongs to</h4><div className="chips"><button className="chip" onClick={() => onSel(goDep(depName))}>deployment/{depName}</button></div></section>}
        </div>
      )}
      {active === "edit" && isDep && <EditTab store={store} o={o} ns={ns} say={say} />}
      {active === "describe" && <pre className="pre">{describeObject(res, o, ctx)}</pre>}
      {active === "yaml" && <pre className="pre">{yaml({ apiVersion: res.api, kind: res.kind, ...clean(o) })}</pre>}
      {active === "logs" && <pre className="pre" data-v={version}>{logPod ? (isDep && pods.length > 1 ? `# pod/${nameOf(logPod)} (1 of ${pods.length})\n` : "") + (readLogs(nsOf(logPod), nameOf(logPod)).join("\n") || "(no logs yet)") : "(no pods)"}</pre>}
      {active === "events" && <pre className="pre">{events.length ? events.map((e: Obj) => `${age(Date.now() - ts(e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp)).padEnd(6)}${(e.type ?? "Normal").padEnd(9)}${(e.reason ?? "").padEnd(20)}${e.message ?? ""}`).join("\n") : "No events."}</pre>}
    </aside>
  );
}
