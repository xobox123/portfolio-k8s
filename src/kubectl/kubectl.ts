import { readLogs } from "../engine/logs";
import { age, clean, labelsStr, seeded, table, ts, yaml } from "./format";
import { RESOURCES, findResource, nameOf, nsOf, podReady, podRestarts, podStatus, type Ctx, type Obj, type Res } from "./resources";
import { describeObject } from "./describe";
import { SANDBOX, createDeployment, createPod, deleteResource, exposeDeployment, restartDeployment, scaleDeployment, setWorkerEnv } from "../engine/actions";

export interface Session { ns: string }

const USER = "visitor";
const FORBIDDEN_VERBS = ["apply", "edit", "patch", "label", "annotate", "drain", "cordon", "uncordon", "taint", "cp", "port-forward", "attach", "debug", "replace", "autoscale", "proxy"];

interface Flags {
  ns?: string; all: boolean; out?: string; sel?: string; showLabels: boolean; noHeaders: boolean;
  image?: string; port?: number; targetPort?: number; svcType?: string; tail?: number; previous: boolean; replicas?: number; help: boolean; container?: string; rest: string[]; unknown?: string;
}

export function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function parse(tokens: string[]): { pos: string[]; f: Flags } {
  const f: Flags = { all: false, showLabels: false, noHeaders: false, previous: false, help: false, rest: [] };
  const pos: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const val = (long: string, short?: string): string | undefined => {
      if (t === `--${long}` || (short && t === `-${short}`)) return tokens[++i];
      if (t.startsWith(`--${long}=`)) return t.slice(long.length + 3);
      if (short && t.startsWith(`-${short}=`)) return t.slice(short.length + 2);
      return undefined;
    };
    let v: string | undefined;
    if (t === "--") { f.rest = tokens.slice(i + 1); break; }
    else if (t === "-A" || t === "--all-namespaces") f.all = true;
    else if ((v = val("namespace", "n")) !== undefined) f.ns = v;
    else if (/^-n.+/.test(t) && !t.startsWith("--")) f.ns = t.slice(2);
    else if ((v = val("output", "o")) !== undefined) f.out = v;
    else if (/^-o.+/.test(t) && !t.startsWith("--")) f.out = t.slice(2);
    else if ((v = val("selector", "l")) !== undefined) f.sel = v;
    else if ((v = val("tail")) !== undefined) f.tail = Number(v);
    else if ((v = val("replicas")) !== undefined) f.replicas = Number(v);
    else if ((v = val("image")) !== undefined) f.image = v;
    else if ((v = val("port")) !== undefined) f.port = Number(v);
    else if ((v = val("target-port")) !== undefined) f.targetPort = Number(v);
    else if ((v = val("type")) !== undefined) f.svcType = v;
    else if ((v = val("container", "c")) !== undefined) f.container = v;
    else if (t === "--show-labels") f.showLabels = true;
    else if (t === "--no-headers") f.noHeaders = true;
    else if (t === "-p" || t === "--previous") f.previous = true;
    else if (t === "-h" || t === "--help") f.help = true;
    else if (["-w", "--watch", "-i", "-t", "-it", "--stdin", "--tty", "--current", "-f", "--follow", "--timestamps", "--prefix"].includes(t)) { /* accepted, no effect */ }
    else if (t.startsWith("-") && t.length > 1) f.unknown ??= t;
    else pos.push(t);
  }
  return { pos, f };
}

const selectorMatch = (sel: string | undefined, labels: Record<string, string> = {}): boolean => {
  if (!sel) return true;
  return sel.split(",").every((term) => {
    const t = term.trim();
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^([^!=\s]+)\s*(?:==?)\s*(.+)$/))) return labels[m[1]] === m[2];
    if ((m = t.match(/^([^!=\s]+)\s*!=\s*(.+)$/))) return labels[m[1]] !== m[2];
    if (t.startsWith("!")) return !(t.slice(1) in labels);
    return t in labels;
  });
};

const withKind = (res: Res, o: Obj): Obj => ({ apiVersion: res.api, kind: res.kind, ...clean(o) });
const resLabel = (res: Res) => `${res.key}${res.group ? `.${res.group}` : ""}`;
const forbid = (verb: string, res: Res | undefined, name: string, ns: string) =>
  res
    ? `Error from server (Forbidden): ${resLabel(res)} "${name}" is forbidden: User "${USER}" cannot ${verb} resource "${res.key}" in API group "${res.group}" in the namespace "${ns}"`
    : `Error from server (Forbidden): User "${USER}" cannot ${verb} resources in this cluster`;

function nsList(ctx: Ctx, s: Session, f: Flags): { ns: string | null; label: string } {
  if (f.all) return { ns: null, label: "" };
  const ns = f.ns ?? s.ns;
  return { ns, label: ns };
}

function listItems(ctx: Ctx, res: Res, ns: string | null, f: Flags): Obj[] {
  return res.list(ctx)
    .filter((o) => !res.namespaced || !ns || nsOf(o) === ns)
    .filter((o) => selectorMatch(f.sel, o.metadata?.labels))
    .sort((a, b) => (nsOf(a) + nameOf(a)).localeCompare(nsOf(b) + nameOf(b)));
}

function render(ctx: Ctx, res: Res, items: Obj[], f: Flags, all: boolean, prefix: boolean): string {
  const out = f.out ?? "";
  if (out === "name") return items.map((o) => `${res.qualified}/${nameOf(o)}`).join("\n");
  if (out === "yaml" || out === "json") {
    const objs = items.map((o) => withKind(res, o));
    const body = objs.length === 1 && !f.sel && !all && f.rest.length === 0 && (f as Flags & { single?: boolean }).single ? objs[0] : { apiVersion: "v1", items: objs, kind: "List", metadata: { resourceVersion: "" } };
    return out === "json" ? JSON.stringify(body, null, 2) : yaml(body).trimEnd();
  }
  if (out && out !== "wide") return `error: unable to match a printer suitable for the output format "${out}", allowed formats are: json,name,wide,yaml`;
  const wide = out === "wide";
  const showNs = all && res.namespaced;
  const header = [...(showNs ? ["NAMESPACE"] : []), ...res.cols, ...(wide ? res.wide : []), ...(f.showLabels ? ["LABELS"] : [])];
  const rows = items.map((o) => {
    const r = res.row(o, wide, ctx);
    if (prefix) r[0] = `${res.qualified}/${r[0]}`;
    return [...(showNs ? [nsOf(o)] : []), ...r, ...(f.showLabels ? [labelsStr(o.metadata?.labels)] : [])];
  });
  return f.noHeaders ? table(header, rows).split("\n").slice(1).join("\n") : table(header, rows);
}

function get(pos: string[], f: Flags, s: Session, ctx: Ctx): string {
  if (!pos.length) return `error: You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.\n\nUse "kubectl get --help" for more information.`;
  const { ns, label } = nsList(ctx, s, f);
  let specs = pos[0].split(",");
  let names = pos.slice(1);
  if (specs.length === 1 && specs[0].includes("/")) { const [t, n] = specs[0].split("/"); specs = [t]; names = [n, ...names]; }
  if (specs[0] === "all") specs = ["pods", "services", "deployments", "replicasets"];
  if (/^(secrets?|serviceaccounts?|sa|roles?|rolebindings?)$/i.test(specs[0])) {
    return `Error from server (Forbidden): ${specs[0].toLowerCase().replace(/s?$/, "s")} is forbidden: User "${USER}" cannot list resource "${specs[0].toLowerCase().replace(/s?$/, "s")}" in API group "" in the namespace "${ns ?? "default"}"`;
  }
  const blocks: string[] = [];
  const multi = specs.length > 1;
  for (const spec of specs) {
    const res = findResource(spec);
    if (!res) return `error: the server doesn't have a resource type "${spec}"`;
    let items = listItems(ctx, res, ns, f);
    if (names.length) {
      const picked: Obj[] = [];
      for (const n of names) {
        const hit = items.find((o) => nameOf(o) === n);
        if (!hit) return `Error from server (NotFound): ${resLabel(res)} "${n}" not found`;
        picked.push(hit);
      }
      items = picked;
    }
    if (!items.length) {
      blocks.push(res.namespaced && ns ? `No resources found in ${label} namespace.` : "No resources found");
      continue;
    }
    const ff = { ...f } as Flags & { single?: boolean };
    ff.single = names.length === 1;
    blocks.push(render(ctx, res, items, ff, f.all, multi));
  }
  return blocks.join("\n\n");
}

function resolveOne(spec: string[], s: Session, f: Flags, ctx: Ctx): { res: Res; o: Obj } | string {
  let t = spec[0];
  let name = spec[1];
  if (t?.includes("/")) [t, name] = t.split("/");
  if (!t || !name) return "error: you must specify the resource type and name";
  const res = findResource(t);
  if (!res) return `error: the server doesn't have a resource type "${t}"`;
  const ns = f.ns ?? s.ns;
  const o = res.list(ctx).find((x) => nameOf(x) === name && (!res.namespaced || nsOf(x) === ns));
  return o ? { res, o } : `Error from server (NotFound): ${resLabel(res)} "${name}" not found`;
}

function logs(pos: string[], f: Flags, s: Session, ctx: Ctx): string {
  if (!pos.length) return "error: expected 'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]'.\nPOD or TYPE/NAME is a required argument for the logs command\nSee 'kubectl logs -h' for help and examples";
  const ns = f.ns ?? s.ns;
  let target = pos[0];
  let pods: Obj[] = [];
  const pods0: Obj[] = ctx.store.list("pods").filter((p) => nsOf(p) === ns);
  const m = target.match(/^(deploy|deployment|po|pod|pods)\/(.+)$/);
  if (m && /^deploy/.test(m[1])) pods = pods0.filter((p) => p.metadata?.labels?.app === m[2]);
  else { target = m ? m[2] : target; pods = pods0.filter((p) => nameOf(p) === target); }
  if (!pods.length) return `Error from server (NotFound): pods "${m ? m[2] : target}" not found`;
  const p = pods[0];
  let head = "";
  if (pods.length > 1) head = `Found ${pods.length} pods, using pod/${nameOf(p)}\n`;
  let lines = readLogs(nsOf(p), nameOf(p));
  if (f.previous && podRestarts(p) === 0) return `Error from server (BadRequest): previous terminated container "${p.spec?.containers?.[0]?.name}" in pod "${nameOf(p)}" not found`;
  if (f.tail !== undefined && !Number.isNaN(f.tail) && f.tail >= 0) lines = lines.slice(-f.tail);
  return head + lines.join("\n");
}

function top(pos: string[], f: Flags, s: Session, ctx: Ctx): string {
  const what = pos[0] ?? "";
  if (/^(no|nodes?)$/.test(what)) {
    return table(["NAME", "CPU(cores)", "CPU%", "MEMORY(bytes)", "MEMORY%"], ctx.store.list("nodes").map((n) => {
      const r = seeded(nameOf(n)); const cpu = Math.round(120 + r() * 480); const mem = Math.round(900 + r() * 2600);
      return [nameOf(n), `${cpu}m`, `${Math.round(cpu / 40)}%`, `${mem}Mi`, `${Math.round(mem / 80)}%`];
    }));
  }
  if (/^(po|pods?)$/.test(what)) {
    const { ns } = nsList(ctx, s, f);
    const pods = ctx.store.list("pods").filter((p) => !ns || nsOf(p) === ns).sort((a, b) => (nsOf(a) + nameOf(a)).localeCompare(nsOf(b) + nameOf(b)));
    if (!pods.length) return `No resources found in ${ns} namespace.`;
    const rows = pods.map((p) => { const r = seeded(nameOf(p)); return [...(f.all ? [nsOf(p)] : []), nameOf(p), `${Math.round(1 + r() * 90)}m`, `${Math.round(18 + r() * 240)}Mi`]; });
    return table([...(f.all ? ["NAMESPACE"] : []), "NAME", "CPU(cores)", "MEMORY(bytes)"], rows);
  }
  return `error: unknown command "${what}" for "kubectl top"`;
}

const ROOT_HELP = `kubectl controls the Kubernetes cluster manager.

 Find more information at: https://kubernetes.io/docs/reference/kubectl/

Basic Commands (Beginner):
  get            Display one or many resources

Basic Commands (Intermediate):
  describe       Show details of a specific resource or group of resources
  logs           Print the logs for a container in a pod

Deploy Commands:
  rollout        Manage the rollout of a resource (restart, status, history)
  scale          Set a new size for a deployment
  set            Update fields on objects (env)

Cluster Management Commands:
  top            Display resource (CPU/memory) usage

Settings Commands:
  auth           Inspect authorization (can-i)

Other Commands:
  api-resources  Print the supported API resources on the server
  config         Modify kubeconfig files
  cluster-info   Display cluster information
  version        Print the client and server version information

This is a read-mostly demo: you are user "${USER}". You can create and delete
things in the "sandbox" namespace; elsewhere only scale, rollout restart and the
incident-lab fix are allowed, the rest is Forbidden like on a locked-down cluster.

Usage:
  kubectl [flags] [options]

Use "kubectl <command> --help" for more information about a given command.`;

const VERB_HELP: Record<string, string> = {
  get: `Display one or many resources.

Examples:
  # List all pods in all namespaces
  kubectl get pods --all-namespaces

  # List deployments in a namespace, with more detail
  kubectl get deployments -n iceo -o wide

  # Output a single resource as YAML
  kubectl get deployment gke-platform -n iceo -o yaml

Options:
  -A, --all-namespaces=false: List the requested object(s) across all namespaces.
  -n, --namespace='': If present, the namespace scope for this CLI request
  -o, --output='': Output format. One of: (json, yaml, name, wide).
  -l, --selector='': Selector (label query) to filter on.
      --show-labels=false: When printing, show all labels as the last column.
      --no-headers=false: When using the default or custom-column output format, don't print headers.`,
  describe: `Show details of a specific resource or group of resources.

Usage:
  kubectl describe (TYPE NAME | TYPE/NAME) [-n NAMESPACE]

Examples:
  kubectl describe deployment gke-platform -n iceo
  kubectl describe ns axb-hub`,
  logs: `Print the logs for a container in a pod or specified resource.

Usage:
  kubectl logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER] [--tail=N] [-n NAMESPACE]

Examples:
  kubectl logs deploy/otel-tracing -n iceo
  kubectl logs worker-5dcdd9fdcd-602s5 -n incident-lab --tail=5`,
};

const API_RESOURCES = () => table(["NAME", "SHORTNAMES", "APIVERSION", "NAMESPACED", "KIND"],
  RESOURCES.map((r) => [r.key, r.names.filter((n) => n !== r.key && n !== r.kind.toLowerCase()).join(","), r.api, String(r.namespaced), r.kind]));

export async function runKubectl(line: string, s: Session, ctx: Ctx): Promise<string> {
  const tokens = tokenize(line);
  if (tokens[0] === "k") tokens[0] = "kubectl";
  tokens.shift(); // "kubectl"
  if (!tokens.length) return ROOT_HELP;
  const verb = tokens.shift()!;
  const { pos, f } = parse(tokens);
  if (verb === "--help" || verb === "-h" || verb === "help") return ROOT_HELP;
  if (f.unknown) return `error: unknown flag: ${f.unknown}\nSee 'kubectl ${verb} --help' for usage.`;
  if (f.help) return VERB_HELP[verb] ?? ROOT_HELP;

  switch (verb) {
    case "get": return get(pos, f, s, ctx);
    case "describe": {
      if (!pos.length) return "error: You must specify the type of resource to describe. Use \"kubectl api-resources\" for a complete list of supported resources.";
      if (pos.length === 1 && !pos[0].includes("/")) {
        const res = findResource(pos[0]);
        if (!res) return `error: the server doesn't have a resource type "${pos[0]}"`;
        const { ns } = nsList(ctx, s, f);
        const items = listItems(ctx, res, ns, f);
        return items.length ? items.map((o) => describeObject(res, o, ctx)).join("\n\n\n") : `No resources found in ${ns} namespace.`;
      }
      const r = resolveOne(pos, s, f, ctx);
      return typeof r === "string" ? r : describeObject(r.res, r.o, ctx);
    }
    case "logs": return logs(pos, f, s, ctx);
    case "top": return top(pos, f, s, ctx);
    case "exec": {
      const p = pos[0];
      return `Error from server (Forbidden): pods "${p ?? ""}" is forbidden: User "${USER}" cannot create resource "pods/exec" in API group "" in the namespace "${f.ns ?? s.ns}"\nexec is disabled in this public demo.`;
    }
    case "create": case "run": case "expose": case "delete": {
      const ns = f.ns ?? s.ns;
      const sandboxHint = `Hint: you can create and delete things in the "${SANDBOX}" namespace, e.g. kubectl create deployment web --image=nginx -n ${SANDBOX}`;
      const denied = (res: Res | undefined, name: string) => `${forbid(verb, res, name, ns)}\n${sandboxHint}`;
      const exists = (key: "deployments" | "pods" | "services", name: string) => ctx.store.list(key).some((o) => nameOf(o) === name && nsOf(o) === SANDBOX);
      const validName = (n: string | undefined): n is string => !!n && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(n) && n.length <= 40;
      if (verb === "create") {
        if (pos[0] !== "deployment" && pos[0] !== "deploy") return denied(findResource(pos[0] ?? ""), pos[1] ?? "");
        const name = pos[1];
        if (ns !== SANDBOX) return denied(findResource("deployments"), name ?? "");
        if (!validName(name)) return "error: exactly one NAME is required, got 0 (lowercase letters, digits and '-')";
        if (!f.image) return 'error: required flag(s) "image" not set';
        if (exists("deployments", name)) return `Error from server (AlreadyExists): deployments.apps "${name}" already exists`;
        const n = f.replicas ?? 1;
        if (n < 0 || n > 5) return "error: this demo only allows replicas between 0 and 5";
        if (ctx.store.list("pods").filter((p) => nsOf(p) === SANDBOX).length + n > 20) return "Error from server (Forbidden): exceeded quota: sandbox-quota, limited to 20 pods";
        await createDeployment(ctx.store, name, f.image, n);
        return `deployment.apps/${name} created`;
      }
      if (verb === "run") {
        const name = pos[0];
        if (ns !== SANDBOX) return denied(findResource("pods"), name ?? "");
        if (!validName(name)) return "error: NAME is required (lowercase letters, digits and '-')";
        if (!f.image) return 'error: required flag(s) "image" not set';
        if (exists("pods", name)) return `Error from server (AlreadyExists): pods "${name}" already exists`;
        await createPod(ctx.store, name, f.image);
        return `pod/${name} created`;
      }
      if (verb === "expose") {
        const r = resolveOne(pos, s, f, ctx);
        if (typeof r === "string") return r;
        if (r.res.key !== "deployments") return "error: this demo can only expose deployments";
        if (ns !== SANDBOX) return denied(findResource("services"), nameOf(r.o));
        const name = nameOf(r.o);
        const port = f.port ?? 80;
        if (!f.port) return 'error: couldn\'t find port via --port flag or introspection';
        if (exists("services", name)) return `Error from server (AlreadyExists): services "${name}" already exists`;
        const type = f.svcType === "NodePort" ? "NodePort" : "ClusterIP";
        await exposeDeployment(ctx.store, name, port, f.targetPort ?? port, type);
        return `service/${name} exposed`;
      }
      // delete
      let t = pos[0]; let name = pos[1];
      if (t?.includes("/")) [t, name] = t.split("/");
      const res = t ? findResource(t) : undefined;
      if (!res || !name) return "error: You must provide one or more resources by argument or filename.\nExample resource specifications include:\n   'pods foo'\n   'deployments/foo'";
      if (ns !== SANDBOX || !["deployments", "pods", "services"].includes(res.key)) return denied(res, name);
      const key = res.key as "deployments" | "pods" | "services";
      if (!exists(key, name)) return `Error from server (NotFound): ${resLabel(res)} "${name}" not found`;
      await deleteResource(ctx.store, key, name);
      return `${res.key === "deployments" ? "deployment.apps" : res.key.slice(0, -1)} "${name}" deleted`;
    }
    case "scale": {
      let t = pos[0]; let name = pos[1];
      if (t?.includes("/")) [t, name] = t.split("/");
      const res = t ? findResource(t) : undefined;
      if (!res || res.key !== "deployments" || !name) return "error: required resource not specified. Usage: kubectl scale deployment/NAME --replicas=N";
      if (f.replicas === undefined || Number.isNaN(f.replicas)) return "error: required flag(s) \"replicas\" not set";
      if (f.replicas < 0 || f.replicas > 5) return `error: this demo only allows replicas between 0 and 5 (requested ${f.replicas})`;
      const ns = f.ns ?? s.ns;
      if (!ctx.store.list("deployments").some((d) => nameOf(d) === name && nsOf(d) === ns)) return `Error from server (NotFound): deployments.apps "${name}" not found`;
      await scaleDeployment(ctx.store, ns, name, f.replicas);
      return `deployment.apps/${name} scaled`;
    }
    case "rollout": {
      const sub = pos[0];
      let t = pos[1]; let name = pos[2];
      if (t?.includes("/")) [t, name] = t.split("/");
      const ns = f.ns ?? s.ns;
      if (!sub) return "error: required subcommand not specified. Available: restart, status, history";
      const res = t ? findResource(t) : undefined;
      if (!res || res.key !== "deployments" || !name) return `error: required resource not specified. Usage: kubectl rollout ${sub} deployment/NAME`;
      const d = ctx.store.list("deployments").find((x) => nameOf(x) === name && nsOf(x) === ns);
      if (!d) return `Error from server (NotFound): deployments.apps "${name}" not found`;
      if (sub === "restart") { await restartDeployment(ctx.store, ns, name); return `deployment.apps/${name} restarted`; }
      if (sub === "status") {
        const want = d.spec?.replicas ?? 0; const upd = d.status?.updatedReplicas ?? 0; const ready = d.status?.readyReplicas ?? 0; const total = d.status?.replicas ?? 0;
        if (upd < want) return `Waiting for deployment "${name}" rollout to finish: ${upd} out of ${want} new replicas have been updated...`;
        if (total > upd) return `Waiting for deployment "${name}" rollout to finish: ${total - upd} old replicas are pending termination...`;
        if (ready < want) return `Waiting for deployment "${name}" rollout to finish: ${ready} of ${want} updated replicas are available...`;
        return `deployment "${name}" successfully rolled out`;
      }
      if (sub === "history") {
        const rs = ctx.store.list("replicasets").filter((r) => nsOf(r) === ns && r.metadata?.ownerReferences?.some((o: Obj) => o.name === name))
          .map((r) => Number(r.metadata?.annotations?.["deployment.kubernetes.io/revision"] ?? 0)).sort((a, b) => a - b);
        return `deployment.apps/${name}\n` + table(["REVISION", "CHANGE-CAUSE"], rs.map((n) => [String(n), "<none>"]));
      }
      return `error: unknown subcommand "${sub}" for "kubectl rollout"`;
    }
    case "set": {
      if (pos[0] !== "env") return `error: unknown subcommand "${pos[0] ?? ""}" for "kubectl set" (this demo supports: set env)`;
      let t = pos[1]; let rest = pos.slice(2);
      let name = "";
      if (t?.includes("/")) { [t, name] = t.split("/"); } else { name = rest.shift() ?? ""; }
      const ns = f.ns ?? s.ns;
      const res = t ? findResource(t) : undefined;
      if (!res || res.key !== "deployments") return "error: this demo supports: kubectl set env deployment/NAME KEY=VALUE";
      const kv = rest.find((x) => x.includes("="));
      if (!kv) return "error: at least one environment variable must be provided";
      const [key, ...vv] = kv.split("=");
      const allowed = (ns === "incident-lab" && name === "worker" && key === "DATABASE_URL") || ns === SANDBOX;
      if (!allowed) return forbid("patch", res, name, ns);
      const d = ctx.store.list("deployments").find((x) => nameOf(x) === name && nsOf(x) === ns);
      if (!d) return `Error from server (NotFound): deployments.apps "${name}" not found`;
      await setWorkerEnv(ctx.store, ns, name, key, vv.join("="));
      return `deployment.apps/${name} env updated`;
    }
    case "auth": {
      if (pos[0] !== "can-i") return "error: unknown subcommand for \"kubectl auth\" (this demo supports: can-i)";
      const v = pos[1] ?? ""; const r = pos[2] ?? "";
      if (["get", "list", "watch"].includes(v)) return /secret/i.test(r) ? "no" : "yes";
      if (v === "update" || v === "patch") return /deploy/i.test(r) ? "yes" : "no";
      if (["create", "delete"].includes(v) && (f.ns ?? s.ns) === SANDBOX && /(deploy|pod|svc|service)/i.test(r)) return "yes";
      return "no";
    }
    case "config": {
      const sub = pos[0];
      if (sub === "current-context") return "visitor@portfolio.cluster";
      if (sub === "get-contexts") return table(["CURRENT", "NAME", "CLUSTER", "AUTHINFO", "NAMESPACE"], [["*", "visitor@portfolio.cluster", "portfolio.cluster", USER, s.ns === "default" ? "" : s.ns]]);
      if (sub === "view") return yaml({ apiVersion: "v1", clusters: [{ cluster: { server: "https://portfolio.cluster:6443" }, name: "portfolio.cluster" }], contexts: [{ context: { cluster: "portfolio.cluster", namespace: s.ns, user: USER }, name: "visitor@portfolio.cluster" }], "current-context": "visitor@portfolio.cluster", kind: "Config", users: [{ name: USER, user: {} }] }).trimEnd();
      if (sub === "set-context") {
        const nsArg = tokens.find((x) => x.startsWith("--namespace="))?.split("=")[1] ?? f.ns;
        if (!nsArg) return "error: nothing to set";
        if (!ctx.store.list("namespaces").some((n) => nameOf(n) === nsArg)) return `Error from server (NotFound): namespaces "${nsArg}" not found`;
        s.ns = nsArg; return `Context "visitor@portfolio.cluster" modified.`;
      }
      if (sub === "use-context") return `Switched to context "${pos[1] ?? "visitor@portfolio.cluster"}".`;
      return "error: unknown subcommand for \"kubectl config\"";
    }
    case "version": return `Client Version: v1.31.2\nKustomize Version: v5.4.2\nServer Version: v1.31.2`;
    case "cluster-info": return `Kubernetes control plane is running at https://portfolio.cluster:6443\nCoreDNS is running at https://portfolio.cluster:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy\n\nTo further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.`;
    case "api-resources": return API_RESOURCES();
    case "events": return get(["events"], f, s, ctx);
    default:
      if (FORBIDDEN_VERBS.includes(verb)) {
        const res = pos[0] ? findResource(pos[0].split("/")[0]) : undefined;
        const name = pos[0]?.includes("/") ? pos[0].split("/")[1] : pos[1] ?? "";
        return forbid(verb, res, name, f.ns ?? s.ns);
      }
      return `error: unknown command "${verb}" for "kubectl"\n\nSee 'kubectl --help' for usage.`;
  }
}

export { age, ts };
export const podLine = (p: Obj) => `${nameOf(p)} ${podReady(p)} ${podStatus(p)}`;
