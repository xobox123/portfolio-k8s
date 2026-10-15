// Read-only resources the simulator does not implement (ConfigMap, Ingress).
// They are shaped like real API objects so kubectl and the dashboard can treat them uniformly.
export interface VObject {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace: string; creationTimestamp: string; labels?: Record<string, string>; annotations?: Record<string, string> };
  data?: Record<string, string>;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

const cm = (ns: string, name: string, data: Record<string, string>, created: string, summary?: string): VObject => ({
  apiVersion: "v1", kind: "ConfigMap",
  metadata: { name, namespace: ns, creationTimestamp: created, labels: { "app.kubernetes.io/part-of": "portfolio" }, ...(summary ? { annotations: { "cv.portfolio/summary": summary } } : {}) },
  data,
});

export function virtualConfigMaps(created: string): VObject[] {
  return [
    cm("skills", "cloud", { aws: "EKS, EC2, IAM, VPC, Organizations, PrivateLink, MSK", gcp: "GKE, Cloud SQL", openstack: "OpenStack" }, created, "Cloud platforms"),
    cm("skills", "containers", { kubernetes: "EKS, GKE", docker: "Docker", helm: "Helm", istio: "Istio", velero: "Velero", kyverno: "Kyverno", eso: "External Secrets Operator (ESO)" }, created, "Containers and orchestration"),
    cm("skills", "iac-gitops", { terraform: "Terraform", ansible: "Ansible", argocd: "ArgoCD" }, created, "Infrastructure as code and GitOps"),
    cm("skills", "cicd", { gitlab: "GitLab CI", bitbucket: "Bitbucket Pipelines", jenkins: "Jenkins" }, created, "CI/CD"),
    cm("skills", "observability", { prometheus: "Prometheus", grafana: "Grafana (Mimir, Loki, Tempo)", otel: "OpenTelemetry", alerting: "Alertmanager", logging: "ELK / EFK", zabbix: "Zabbix" }, created, "Observability"),
    cm("skills", "data-messaging", { kafka: "Kafka (Strimzi, MSK, Kafka Connect)", nats: "NATS", clickhouse: "ClickHouse", postgresql: "PostgreSQL (Patroni, CloudNativePG)", cassandra: "Cassandra", rabbitmq: "RabbitMQ" }, created, "Data and messaging"),
    cm("skills", "other", { linux: "Linux administration", scripting: "Python and Bash", finops: "FinOps / cloud cost management", ai: "AI-assisted engineering (Claude Code)" }, created, "Other"),
    cm("about", "summary", { text: "DevOps engineer who likes working close to software teams and cloud providers. I built platforms on GCP, migrated the same stack to AWS, and ran the AWS platform of a crypto trading firm - everything as code, versioned and ready to reproduce. Available immediately." }, created, "Summary"),
    cm("about", "cka", { name: "CKA - Certified Kubernetes Administrator", issuer: "CNCF", year: "2024", "certificate-id": "LF-jp0z2vra32" }, created, "Certification"),
    cm("about", "education", { msc: "MSc studies in IT, Architecture and Security of Cloud Computing (Microsoft Azure), WIT Academy, Warsaw, from 10.2021 (coursework completed, thesis pending)", beng: "BEng IT, Internet Technologies, Vistula University, Warsaw, 09.2017 - 04.2021" }, created, "Education"),
    cm("about", "languages", { polish: "native", english: "B2 (professional working proficiency)" }, created, "Languages"),
    cm("about", "interests", { list: "New technologies, running, swimming, diving" }, created, "Interests"),
    cm("open-to-work", "contact", { email: "jaroslav.gryczan@gmail.com", linkedin: "linkedin.com/in/jaroslaw-gryczan", location: "Poland, remote", availability: "immediately" }, created, "How to reach me"),
  ];
}

export function virtualIngresses(created: string): VObject[] {
  return [
    {
      apiVersion: "networking.k8s.io/v1", kind: "Ingress",
      metadata: { name: "fotowrzutka", namespace: "about", creationTimestamp: created, annotations: { "cv.portfolio/summary": "Fotowrzutka (2026): public photo-sharing SaaS designed, built and run solo, from idea to public users, including Stripe payments, SEO and Google Ads (OVH, Claude Code)." } },
      spec: { ingressClassName: "nginx", rules: [{ host: "fotowrzutka.pl", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "fotowrzutka", port: { number: 80 } } } }] } }] },
      status: { loadBalancer: {} },
    },
  ];
}
