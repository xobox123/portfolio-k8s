import { age, labelsStr, ts, yaml, clean, table } from "./format";
import { nameOf, nsOf, podReady, podStatus, podRestarts, type Ctx, type Obj, type Res } from "./resources";

const rfc = (v: unknown) => new Date(ts(v)).toUTCString().replace("GMT", "+0000");

/** "Key:   value" with the value column aligned like kubectl describe. */
function kv(width: number, pairs: Array<[string, string | string[] | undefined]>): string {
  const out: string[] = [];
  for (const [k, v] of pairs) {
    if (v === undefined) continue;
    const lines = Array.isArray(v) ? v : [v];
    out.push(`${`${k}:`.padEnd(width)}${lines[0] ?? "<none>"}`);
    for (const extra of lines.slice(1)) out.push(`${"".padEnd(width)}${extra}`);
  }
  return out.join("\n");
}

const annotations = (o: Obj): string[] => {
  const a = Object.entries((o.metadata?.annotations ?? {}) as Record<string, string>).filter(([k]) => k !== "kubectl.kubernetes.io/last-applied-configuration").map(([k, v]) => `${k}: ${v}`);
  return a.length ? a : ["<none>"];
};
const labels = (o: Obj): string[] => {
  const l = Object.entries((o.metadata?.labels ?? {}) as Record<string, string>).map(([k, v]) => `${k}=${v}`);
  return l.length ? l : ["<none>"];
};

function eventsFor(o: Obj, ctx: Ctx): string {
  const evs = ctx.store.list("events").filter((e: Obj) => e.involvedObject?.name === nameOf(o) && (!nsOf(o) || e.involvedObject?.namespace === nsOf(o)));
  if (!evs.length) return "Events:                <none>";
  const rows = evs.map((e: Obj) => [e.type ?? "Normal", e.reason ?? "", age(Date.now() - ts(e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp)), e.source?.component ?? "kubelet", e.message ?? ""]);
  const t = table(["Type", "Reason", "Age", "From", "Message"], rows).split("\n");
  return `Events:\n${t.map((l) => `  ${l}`).join("\n")}`;
}

export function describeObject(res: Res, o: Obj, ctx: Ctx): string {
  switch (res.key) {
    case "pods": return describePod(o, ctx);
    case "deployments": return describeDeployment(o, ctx);
    case "services": return describeService(o, ctx);
    case "namespaces": return describeNamespace(o, ctx);
    case "nodes": return describeNode(o, ctx);
    case "configmaps": return describeConfigMap(o);
    default: return yaml({ apiVersion: res.api, kind: res.kind, ...clean(o) }).trimEnd();
  }
}

function describePod(p: Obj, ctx: Ctx): string {
  const c = p.spec?.containers?.[0] ?? {};
  const st = (p.status?.containerStatuses ?? [])[0];
  const state = st?.state?.running ? "Running" : st?.state?.waiting ? "Waiting" : st?.state?.terminated ? "Terminated" : "Unknown";
  const head = kv(18, [
    ["Name", nameOf(p)], ["Namespace", nsOf(p)], ["Priority", "0"], ["Service Account", "default"],
    ["Node", `${p.spec?.nodeName ?? "<none>"}/${(ctx.store.list("nodes").find((n: Obj) => nameOf(n) === p.spec?.nodeName) as Obj | undefined)?.status?.addresses?.[0]?.address ?? ""}`],
    ["Start Time", rfc(p.status?.startTime ?? p.metadata?.creationTimestamp)], ["Labels", labels(p)], ["Annotations", annotations(p)],
    ["Status", podStatus(p) === "Running" ? "Running" : (p.status?.phase ?? "Pending")], ["IP", p.status?.podIP ?? ""],
    ["Controlled By", p.metadata?.ownerReferences?.[0] ? `${p.metadata.ownerReferences[0].kind}/${p.metadata.ownerReferences[0].name}` : undefined],
  ]);
  const containerLines = [
    `Containers:`, `  ${c.name}:`,
    `    Image:          ${c.image}`,
    `    Port:           ${c.ports?.[0] ? `${c.ports[0].containerPort}/TCP` : "<none>"}`,
    `    State:          ${state}${st?.state?.waiting?.reason ? `\n      Reason:       ${st.state.waiting.reason}` : ""}`,
    `    Ready:          ${st?.ready ? "True" : "False"}`,
    `    Restart Count:  ${podRestarts(p)}`,
    `    Environment:${(c.env ?? []).length ? "" : "    <none>"}`,
    ...((c.env ?? []) as Obj[]).map((e) => `      ${e.name}: ${e.name === "SUMMARY" ? `${String(e.value).slice(0, 60)}…` : e.value}`),
  ];
  const conds = `Conditions:\n  Type              Status\n  Ready             ${podReady(p).startsWith("1/") ? "True" : "False"}\n  ContainersReady   ${podReady(p).startsWith("1/") ? "True" : "False"}`;
  return [head, containerLines.join("\n"), conds, eventsFor(p, ctx)].join("\n");
}

function describeDeployment(d: Obj, ctx: Ctx): string {
  const c = d.spec?.template?.spec?.containers?.[0] ?? {};
  const rs = ctx.store.list("replicasets").filter((r: Obj) => r.metadata?.ownerReferences?.some((x: Obj) => x.name === nameOf(d)));
  const newest = rs.sort((a: Obj, b: Obj) => ts(b.metadata?.creationTimestamp) - ts(a.metadata?.creationTimestamp))[0];
  const want = d.spec?.replicas ?? 0;
  const head = kv(24, [
    ["Name", nameOf(d)], ["Namespace", nsOf(d)], ["CreationTimestamp", rfc(d.metadata?.creationTimestamp)], ["Labels", labels(d)],
    ["Annotations", annotations(d)], ["Selector", labelsStr(d.spec?.selector?.matchLabels)],
    ["Replicas", `${want} desired | ${d.status?.updatedReplicas ?? 0} updated | ${d.status?.replicas ?? 0} total | ${d.status?.availableReplicas ?? 0} available | ${d.status?.unavailableReplicas ?? 0} unavailable`],
    ["StrategyType", d.spec?.strategy?.type ?? "RollingUpdate"], ["RollingUpdateStrategy", "25% max unavailable, 25% max surge"],
  ]);
  const tpl = [`Pod Template:`, `  Labels:  ${labelsStr(d.spec?.template?.metadata?.labels)}`, `  Containers:`, `   ${c.name}:`, `    Image:      ${c.image}`, `    Port:       ${c.ports?.[0] ? `${c.ports[0].containerPort}/TCP` : "<none>"}`,
    `    Environment:${(c.env ?? []).length ? "" : "  <none>"}`, ...((c.env ?? []) as Obj[]).map((e) => `      ${e.name}: ${e.name === "SUMMARY" ? `${String(e.value).slice(0, 60)}…` : e.value}`)];
  const conds = `Conditions:\n  Type           Status  Reason\n  ----           ------  ------\n  Available      ${(d.status?.availableReplicas ?? 0) >= 1 || want === 0 ? "True " : "False"}   ${(d.status?.availableReplicas ?? 0) >= 1 ? "MinimumReplicasAvailable" : "MinimumReplicasUnavailable"}\n  Progressing    True    NewReplicaSetAvailable`;
  const olds = rs.filter((r: Obj) => r !== newest && (r.spec?.replicas ?? 0) > 0).map(nameOf).join(", ") || "<none>";
  const tail = `OldReplicaSets:  ${olds}\nNewReplicaSet:   ${newest ? `${nameOf(newest)} (${newest.status?.replicas ?? 0}/${newest.spec?.replicas ?? 0} replicas created)` : "<none>"}`;
  return [head, tpl.join("\n"), conds, tail, eventsFor(d, ctx)].join("\n");
}

function describeService(s: Obj, ctx: Ctx): string {
  const slice = ctx.store.list("endpointslices").find((e: Obj) => e.metadata?.labels?.["kubernetes.io/service-name"] === nameOf(s) && nsOf(e) === nsOf(s)) as Obj | undefined;
  const eps = (slice?.endpoints ?? []).map((e: Obj) => `${e.addresses?.[0]}:${s.spec?.ports?.[0]?.targetPort ?? ""}`).join(",") || "<none>";
  const p = s.spec?.ports?.[0];
  return [kv(19, [
    ["Name", nameOf(s)], ["Namespace", nsOf(s)], ["Labels", labels(s)], ["Annotations", annotations(s)], ["Selector", labelsStr(s.spec?.selector)],
    ["Type", s.spec?.type ?? "ClusterIP"], ["IP Family Policy", "SingleStack"], ["IP Families", "IPv4"], ["IP", s.spec?.clusterIP ?? ""], ["IPs", s.spec?.clusterIP ?? ""],
    ["Port", p ? `<unset>  ${p.port}/TCP` : "<none>"], ["TargetPort", p ? `${p.targetPort}/TCP` : "<none>"], ["Endpoints", eps], ["Session Affinity", "None"],
  ]), eventsFor(s, ctx)].join("\n");
}

function describeNamespace(n: Obj, ctx: Ctx): string {
  const pods = ctx.store.list("pods").filter((p: Obj) => nsOf(p) === nameOf(n)).length;
  return [kv(14, [["Name", nameOf(n)], ["Labels", labels(n)], ["Annotations", annotations(n)], ["Status", n.status?.phase ?? "Active"]]), `\nResource Quotas\n  <none>\nPods: ${pods}\n\nNo LimitRange resource.`].join("\n");
}

function describeNode(n: Obj, ctx: Ctx): string {
  const pods = ctx.store.list("pods").filter((p: Obj) => p.spec?.nodeName === nameOf(n));
  const rows = pods.map((p: Obj) => [nsOf(p), nameOf(p), age(Date.now() - ts(p.metadata?.creationTimestamp))]);
  return [kv(20, [["Name", nameOf(n)], ["Roles", Object.keys(n.metadata?.labels ?? {}).filter((k) => k.startsWith("node-role")).map((k) => k.split("/")[1]).join(",") || "<none>"], ["Labels", labels(n)],
    ["CreationTimestamp", rfc(n.metadata?.creationTimestamp)], ["Addresses", (n.status?.addresses ?? []).map((a: Obj) => `${a.type}: ${a.address}`)]]),
    `Non-terminated Pods:          (${pods.length} in total)`, table(["Namespace", "Name", "Age"], rows).split("\n").map((l) => `  ${l}`).join("\n")].join("\n");
}

function describeConfigMap(m: Obj): string {
  const data = Object.entries((m.data ?? {}) as Record<string, string>).map(([k, v]) => `${k}:\n----\n${v}\n`).join("\n");
  return [kv(14, [["Name", nameOf(m)], ["Namespace", nsOf(m)], ["Labels", labels(m)], ["Annotations", annotations(m)]]), `\nData\n====\n${data}\nBinaryData\n====\n\nEvents:  <none>`].join("\n");
}
