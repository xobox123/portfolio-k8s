const FLOW: Array<{ title: string; body: string }> = [
  { title: "This page", body: "React, TypeScript and Vite. Graph, inspector, dashboards and terminal are plain components." },
  { title: "kubectl layer", body: "My own parser and printers: get, describe, logs, rollout, -o yaml, Forbidden errors like a locked-down cluster." },
  { title: "Cluster API", body: "Informers stream every pod, deployment, service and event into one store the whole UI reads." },
  { title: "Kubernetes simulator", body: "ngrok/webernetes: API server, etcd, scheduler, controllers, kubelet and a simulated network, all in TypeScript." },
  { title: "Workloads", body: "Tiny programs standing in for containers. They log what I did at each employer and call each other over HTTP." },
];

export function HowBuilt() {
  return (
    <section className="block" id="how" aria-labelledby="how-title">
      <div className="sec-head"><h2 id="how-title">How this was built</h2><span className="idx">03 / under the hood</span></div>
      <p className="sec-lede">Everything on this page runs in your browser. There is no backend and no real cluster, just a faithful simulation I wired up to tell my story.</p>

      <ol className="flow" aria-label="Architecture, from the page down to the workloads">
        {FLOW.map((f, i) => (
          <li key={f.title}>
            <span className="n" aria-hidden="true">{i + 1}</span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </li>
        ))}
      </ol>
      <p className="flow-side"><b>Side channel:</b> a sampler turns request events and pod states into metrics once a second, and workloads write a shared log stream. The dashboards read both, so what you see there is what the cluster is really doing.</p>

      <div className="how-cols">
        <div>
          <h3>Real behaviour</h3>
          <ul>
            <li>Deployments, ReplicaSets and rolling updates</li>
            <li>Scheduling pods onto three nodes</li>
            <li>CrashLoopBackOff with exponential back-off</li>
            <li>Services load-balancing HTTP between pods</li>
            <li>Events, restarts, self-healing after Chaos</li>
          </ul>
        </div>
        <div>
          <h3>Simulated or added by me</h3>
          <ul>
            <li>Containers are JavaScript, not Linux processes</li>
            <li>ConfigMaps and the Ingress are a read-only layer</li>
            <li>Metrics and logs are collected in-process, the dashboards are Grafana-style, not Grafana</li>
            <li>kubectl is my own implementation, with a limited verb list</li>
            <li>Resource ages are minutes, not years: tenure lives in the descriptions</li>
          </ul>
        </div>
      </div>

      <p className="credit">Simulator: <a href="https://github.com/ngrok/webernetes" target="_blank" rel="noopener noreferrer">ngrok/webernetes</a> (Apache-2.0), pinned to 0.6.1. Icons from the Kubernetes project. Type: Inter Tight and JetBrains Mono.</p>
    </section>
  );
}
