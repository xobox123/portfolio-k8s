# portfolio-k8s

An interactive portfolio where my experience is deployed as a Kubernetes cluster that runs entirely in the browser.
Every employer is a namespace, everything I built there is a workload you can inspect, restart, scale, break and fix.

- **Graph and inspector:** live topology with real HTTP traffic between workloads.
- **kubectl:** a faithful in-browser kubectl (`get`, `describe`, `logs`, `rollout`, `-o yaml`, Forbidden errors, a writable `sandbox` namespace).
- **Dashboards:** Grafana-style metrics and a Loki-style log explorer with LogQL-lite, fed by the simulator.
- **Incident lab:** a broken worker to debug and fix.
- **Chaos:** kill random pods and watch Kubernetes heal itself.

There is no backend and no real cluster. The Kubernetes behaviour comes from
[ngrok/webernetes](https://github.com/ngrok/webernetes) (Apache-2.0, pinned to 0.6.1), a simulator that ports Kubernetes controllers to TypeScript.
Containers are small JavaScript programs, ConfigMaps and the Ingress are a read-only layer added here, and metrics and logs are collected in-process.

## Run

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # static files in dist/
```

## Stack

React 19, TypeScript, Vite, `@ngrok/webernetes`.

## Credits

Simulator by ngrok (Apache-2.0). Kubernetes icons from the Kubernetes project. Fonts: Inter Tight and JetBrains Mono.
