import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useCluster, useStoreVersion } from "./engine/useCluster";
import { employers } from "./engine/cv";
import { Boot } from "./ui/Boot";
import { Graph } from "./ui/Graph";
import { Resources } from "./ui/Resources";
import { Inspector } from "./ui/Inspector";
import { Terminal } from "./ui/Terminal";
import { Solved } from "./ui/Solved";
import type { DashTab } from "./ui/Dashboard";
import { HowBuilt } from "./ui/HowBuilt";
import { chaosKill } from "./engine/actions";

const Dashboard = lazy(() => import("./ui/Dashboard").then((m) => ({ default: m.Dashboard })));
import { labEvents } from "./engine/events";
import type { Sel } from "./ui/model";
import type { Ctx } from "./kubectl/resources";

const FLAG = "cluster.deployed";
const readFlag = (): boolean => { try { return localStorage.getItem(FLAG) === "1"; } catch { return false; } };
const writeFlag = () => { try { localStorage.setItem(FLAG, "1"); } catch { /* storage optional */ } };

export function App() {
  const { state, redeploy } = useCluster();
  const store = state.status === "ready" ? state.store : undefined;
  const version = useStoreVersion(store);
  const [intro, setIntro] = useState(() => !readFlag());
  const [deployKey, setDeployKey] = useState(0);
  const [view, setView] = useState<"graph" | "table">("graph");
  const [ns, setNs] = useState("all");
  const [sel, setSel] = useState<Sel | undefined>();
  const [dash, setDash] = useState<DashTab | undefined>();
  const [chaos, setChaos] = useState<string | undefined>();
  const [solvedSecs, setSolvedSecs] = useState<number | undefined>();

  const ctx: Ctx | undefined = useMemo(() => (state.status === "ready" ? { store: state.store, bootedAt: state.bootedAt } : undefined), [state]);

  useEffect(() => { document.body.style.overflow = intro ? "hidden" : ""; }, [intro]);
  useEffect(() => {
    const onSolved = () => { const t0 = state.status === "ready" ? new Date(state.bootedAt).getTime() : Date.now(); setSolvedSecs(Math.max(1, Math.round((Date.now() - t0) / 1000))); };
    labEvents.addEventListener("solved", onSolved);
    return () => labEvents.removeEventListener("solved", onSolved);
  }, [state]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSel(undefined); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const introDone = useCallback(() => {
    writeFlag();
    setIntro(false);
    requestAnimationFrame(() => document.getElementById("explore")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
  }, []);

  const onChaos = async () => {
    if (!store) return;
    setChaos("Chaos is killing pods…");
    const killed = await chaosKill(store);
    setChaos(`Chaos killed ${killed.length} pods. Watch them come back: graph, Dashboards, kubectl get pods -A.`);
    setTimeout(() => setChaos(undefined), 12000);
  };

  const onRedeploy = () => { setChaos(undefined); setDash(undefined); setSolvedSecs(undefined); setSel(undefined); setNs("all"); setDeployKey((k) => k + 1); setIntro(true); window.scrollTo({ top: 0 }); void redeploy(); };

  const podCount = store ? store.list("pods").filter((p) => employers.some((e) => e.ns === p.metadata?.namespace)).length : 0;

  return (
    <>
      {dash && store && <Suspense fallback={null}><Dashboard store={store} tab={dash} onClose={() => setDash(undefined)} /></Suspense>}
      {solvedSecs !== undefined && <Solved seconds={solvedSecs} onClose={() => setSolvedSecs(undefined)} />}
      {intro && <Boot key={deployKey} store={store} instant={false} onDone={introDone} />}
      <a className="skip" href="#explore">Skip to the cluster</a>
      <div className={`wrap${sel ? " has-drawer" : ""}`}>
        <nav className="nav" aria-label="Main">
          <a href="#top">Jarosław Gryczan</a>
          <div className="links"><a href="#explore">Cluster</a><a href="#terminal">Terminal</a><a href="#how">How it's built</a><a href="#contact">Contact</a></div>
          <div className="right"><button className="redeploy" onClick={() => setDash("overview")} disabled={!store}>Dashboards</button><a className="cv" href="#">Download CV</a><button className="redeploy" onClick={onRedeploy} title="Tear the cluster down and deploy it again">↻ Redeploy</button></div>
        </nav>

        <main id="main">
        <header className="hero" id="top">
          <div className="status-line"><span className={`dot${state.status === "ready" ? "" : " warn"}`} />{state.status === "ready" ? `cluster Ready · ${podCount} pods · simulated in your browser` : state.status === "error" ? "cluster failed to start" : "deploying cluster…"}</div>
          <h1>Platforms that quietly <em>keep running.</em></h1>
          <p>Senior DevOps Engineer. I built platforms on GCP, migrated the same stack to AWS and ran everything as code. My experience is deployed below as a small Kubernetes cluster: every employer is a namespace, everything I built is a workload you can inspect. Available immediately.</p>
          <div className="cta"><a className="btn primary" href="#explore">Explore the cluster</a><a className="btn" href="#terminal">Open the terminal</a></div>
        </header>

        <section className="block" id="explore">
          <div className="sec-head"><h2>Explore the cluster</h2><span className="idx">01 / experience as infrastructure</span></div>
          <p className="sec-lede">Namespaces are employers, deployments are the things I built there, pods are their replicas. Lines are service calls and moving dots are real requests flowing through a Kubernetes simulator running in this tab. Click anything.</p>
          {state.status === "error" && <p className="err">The cluster simulator failed to start: {state.error}</p>}
          {ctx && store && (
            <>
              <div className="toolbar">
                <div className="seg" role="group" aria-label="View">
                  <button aria-pressed={view === "graph"} onClick={() => setView("graph")}>Graph</button>
                  <button aria-pressed={view === "table"} onClick={() => setView("table")}>Resources</button>
                </div>
                <label>namespace <select value={ns} onChange={(e) => { setNs(e.target.value); setSel(undefined); }}><option value="all">All namespaces</option>{employers.map((e) => <option key={e.ns} value={e.ns}>{e.ns}</option>)}</select></label>
                <button className="chaos" onClick={onChaos} title="Kill a random slice of pods and watch Kubernetes heal itself">⚡ Chaos</button>
                <span className="note" role="status">{chaos ?? "demo state · everything is local to your browser"}</span>
              </div>
              <div className="explorer">
                {view === "graph" ? <Graph store={store} ctx={ctx} version={version} ns={ns} sel={sel} onSel={setSel} /> : <Resources ctx={ctx} version={version} ns={ns} sel={sel} onSel={setSel} />}
                {sel && <Inspector key={`${sel.key}/${sel.ns}/${sel.name}`} store={store} ctx={ctx} sel={sel} onSel={setSel} version={version} onDash={setDash} />}
              </div>
              <aside className="term-cta" aria-label="Terminal shortcut">
                <div><b>Prefer the command line?</b><span>The same cluster answers real kubectl. Create your own workloads in the sandbox namespace.</span></div>
                <a className="btn primary" href="#terminal">Open the terminal ↓</a>
              </aside>
            </>
          )}
        </section>

        <section className="block" id="terminal">
          <div className="sec-head"><h2>Ask the cluster anything</h2><span className="idx">02 / terminal</span></div>
          <p className="sec-lede">A real-feeling kubectl against the same cluster. Read everything, restart and scale things, and create your own workloads in the sandbox namespace. Try <span className="mono">kubectl get cm -n skills</span>.</p>
          {ctx && <Terminal key={deployKey} ctx={ctx} version={version} />}
        </section>

        <HowBuilt />

        </main>

        <footer className="contact" id="contact">
          <h2>Let's talk.</h2>
          <a className="mail" href="mailto:jaroslav.gryczan@gmail.com">jaroslav.gryczan@gmail.com</a>
          <div className="foot"><span>© 2026 Jarosław Gryczan</span><span>Simulated by ngrok/webernetes (Apache-2.0) · Kubernetes icons by the Kubernetes project</span><a href="#top">Back to top ↑</a></div>
        </footer>
      </div>
    </>
  );
}
