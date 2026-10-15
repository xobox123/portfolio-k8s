import type { ClusterStore } from "../engine/store";
import { employers, type Employer } from "../engine/cv";
import { RESOURCES, findResource, nameOf, nsOf, podReady, podStatus, type Ctx, type Obj, type Res } from "../kubectl/resources";

export interface Sel { key: string; ns: string; name: string }
export const selId = (s: Sel) => `${s.key}:${s.ns}/${s.name}`;

export const employerOf = (ns: string): Employer | undefined => employers.find((e) => e.ns === ns);
export const NS_ORDER = employers.map((e) => e.ns);

export type Tone = "ok" | "warn" | "bad" | "";
export function podTone(p: Obj): Tone {
  const s = podStatus(p);
  if (s === "Running") return podReady(p).startsWith("0/") ? "" : "ok";
  if (s === "CrashLoopBackOff") return "warn";
  if (/Err|BackOff|Error|Failed/.test(s)) return "bad";
  return "";
}

export const deploymentsIn = (store: ClusterStore, ns: string): Obj[] => {
  const order = employerOf(ns)?.workloads.map((w) => w.name) ?? [];
  return store.list("deployments").filter((d) => nsOf(d) === ns).sort((a, b) => {
    const ia = order.indexOf(nameOf(a)); const ib = order.indexOf(nameOf(b));
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || nameOf(a).localeCompare(nameOf(b));
  });
};

export const podsOfDeployment = (store: ClusterStore, ns: string, dep: string): Obj[] =>
  store.list("pods").filter((p) => nsOf(p) === ns && p.metadata?.labels?.app === dep).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

export function resolve(sel: Sel, ctx: Ctx): { res: Res; o: Obj } | undefined {
  const res = RESOURCES.find((r) => r.key === sel.key) ?? findResource(sel.key);
  if (!res) return undefined;
  const o = res.list(ctx).find((x: Obj) => nameOf(x) === sel.name && (!res.namespaced || nsOf(x) === sel.ns));
  return o ? { res, o } : undefined;
}

export const toneClass = (status: string): string =>
  /^(Running|Active|Ready|Normal|True)$/.test(status) ? "ok-t" : /CrashLoopBackOff|Warning|Pending|ContainerCreating|Terminating/.test(status) ? "warn-t" : /Err|Error|Failed|NotReady/.test(status) ? "bad-t" : "";
