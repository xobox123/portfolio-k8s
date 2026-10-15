import { useEffect, useRef, useState } from "react";
import { runKubectl, tokenize, type Session } from "../kubectl/kubectl";
import { RESOURCES, nameOf, type Ctx } from "../kubectl/resources";

interface Line { cmd?: string; out?: string }
const SUGGESTIONS = [
  "kubectl get ns",
  "kubectl get pods -A",
  "kubectl get deploy -n iceo",
  "kubectl describe deploy otel-tracing -n iceo",
  "kubectl logs deploy/worker -n incident-lab",
  "kubectl get cm -n skills",
  "kubectl get cm cka -n about -o yaml",
  "kubectl create deployment web --image=nginx --replicas=2 -n sandbox",
  "help",
];
const SHELL_HELP = `Supported:
  kubectl get|describe|logs|top|rollout|scale|set env|create|run|expose|delete
  kubectl config|auth can-i|version|cluster-info|api-resources
  clear · history · whoami · help      (alias: k = kubectl)

Tips:
  kubectl get pods -A                    all namespaces
  kubectl get deploy -n iceo -o wide     one employer
  kubectl get cm -n skills               my skills, as ConfigMaps
  kubectl create deployment web --image=nginx -n sandbox   make your own
  Tab completes commands, resources and names; ↑/↓ browse history.`;

export function Terminal({ ctx, version, onRan }: { ctx: Ctx; version: number; onRan?: () => void }) {
  const [lines, setLines] = useState<Line[]>([{ out: 'Connected to portfolio.cluster as "visitor". Type "help", or click a suggestion below.' }]);
  const [value, setValue] = useState("");
  const session = useRef<Session>({ ns: "default" });
  const history = useRef<string[]>([]);
  const cursor = useRef(-1);
  const out = useRef<HTMLDivElement>(null);
  const [ns, setNs] = useState("default");
  void version;

  useEffect(() => { out.current?.scrollTo({ top: out.current.scrollHeight }); }, [lines]);

  const exec = async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;
    history.current.push(cmd); cursor.current = -1;
    let result = "";
    const first = tokenize(cmd)[0];
    if (cmd === "clear") { setLines([]); return; }
    if (cmd === "help") result = SHELL_HELP;
    else if (cmd === "history") result = history.current.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join("\n");
    else if (cmd === "whoami") result = "visitor";
    else if (first === "kubectl" || first === "k") {
      try { result = await runKubectl(cmd, session.current, ctx); } catch (e) { result = `error: ${String(e)}`; }
      setNs(session.current.ns);
    } else result = `bash: ${first}: command not found`;
    setLines((l) => [...l, { cmd }, { out: result }]);
    onRan?.();
  };

  const complete = () => {
    const toks = value.split(/\s+/);
    const last = toks[toks.length - 1] ?? "";
    const verbs = ["get", "describe", "logs", "top", "rollout", "scale", "set", "create", "run", "expose", "delete", "config", "auth", "version", "cluster-info", "api-resources"];
    let pool: string[] = [];
    if (toks.length === 1) pool = ["kubectl", "help", "clear", "history"];
    else if (toks.length === 2) pool = verbs;
    else if (toks[toks.length - 2] === "-n") pool = ctx.store.list("namespaces").map(nameOf);
    else if (toks.length === 3) pool = RESOURCES.flatMap((r) => r.names.slice(0, 2));
    else { const r = RESOURCES.find((x) => x.names.includes(toks[2])); if (r) pool = r.list(ctx).map(nameOf); }
    const hits = [...new Set(pool)].filter((p) => p.startsWith(last));
    if (!hits.length) return;
    const common = hits.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });
    if (hits.length > 1 && common === last) setLines((l) => [...l, { out: hits.join("   ") }]);
    toks[toks.length - 1] = hits.length === 1 ? `${hits[0]} ` : common;
    setValue(toks.join(" ").replace(/ {2,}/g, " "));
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") { e.preventDefault(); complete(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (!history.current.length) return; cursor.current = cursor.current < 0 ? history.current.length - 1 : Math.max(0, cursor.current - 1); setValue(history.current[cursor.current]); }
    else if (e.key === "ArrowDown") { e.preventDefault(); if (cursor.current < 0) return; cursor.current += 1; if (cursor.current >= history.current.length) { cursor.current = -1; setValue(""); } else setValue(history.current[cursor.current]); }
  };

  const prompt = `visitor@portfolio${ns === "default" ? "" : `:${ns}`} $`;
  return (
    <div>
      <div className="shell" onClick={() => document.getElementById("term-input")?.focus()}>
        <div className="shell-out" ref={out} role="log" aria-live="polite">
          {lines.map((l, i) => l.cmd !== undefined ? <div className="cmd" key={i}><span className="pp">{prompt}</span> {l.cmd}</div> : <div key={i}>{l.out}</div>)}
        </div>
        <form className="shell-form" onSubmit={(e) => { e.preventDefault(); const v = value; setValue(""); void exec(v); }}>
          <label className="pp" htmlFor="term-input">{prompt}</label>
          <input id="term-input" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" placeholder="kubectl get pods -A" />
        </form>
      </div>
      <div className="term-chips">{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => { setValue(""); void exec(s); }}>{s}</button>)}</div>
    </div>
  );
}
