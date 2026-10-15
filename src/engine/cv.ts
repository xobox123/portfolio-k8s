// CV content expressed as cluster resources. Namespaces are employers,
// workloads are things done there. Wording follows the CV.
export interface Workload {
  name: string;
  replicas: number;
  what: string;
  tags: string[];
  /** services in the same namespace this workload calls (drives traffic) */
  calls?: string[];
  crash?: boolean;
  /** service port (defaults to 80) */
  port?: number;
}
export interface Employer {
  ns: string;
  company: string;
  role: string;
  period: string;
  place: string;
  workloads: Workload[];
}

export const employers: Employer[] = [
  {
    ns: "axb-hub", company: "AXB Hub LTD", role: "Senior DevOps Engineer", period: "11.2025 – 09.2026", place: "remote",
    workloads: [
      { name: "aws-landing-zone", replicas: 1, what: "Designed and built the company's AWS platform from scratch: multi-account landing zone (Organizations, IAM Identity Center SSO, VPC, peerings, PrivateLink).", tags: ["AWS Organizations", "IAM Identity Center", "VPC", "PrivateLink"] },
      { name: "eks-platform", replicas: 2, what: "Ran EKS clusters with the addon layer managed as Terraform code.", tags: ["EKS", "Terraform"], calls: ["aws-landing-zone"] },
      { name: "gcp-to-aws-migration", replicas: 1, what: "Led the migration from GCP to AWS, closer to the crypto exchanges.", tags: ["GCP", "AWS", "Terraform"], calls: ["eks-platform"] },
      { name: "sdlc-pipeline", replicas: 2, what: "Established the end-to-end SDLC: GitLab CI building images and artifacts, ArgoCD GitOps and a shared Helm library, plus branching and release standards.", tags: ["GitLab CI", "ArgoCD", "Helm"], calls: ["eks-platform"] },
      { name: "trading-vm-fleet", replicas: 3, what: "Operated a low-latency, multi-region fleet of EC2 trading VMs running trading strategies and exchange connectors, optimised for speed (CPU and kernel tuning, Terraform + Ansible).", tags: ["EC2", "Terraform", "Ansible"], calls: ["datalake-kafka"] },
      { name: "datalake-kafka", replicas: 3, what: "Built the datalake platform on EKS: Kafka (MSK and Strimzi) with automated backups.", tags: ["Kafka", "MSK", "Strimzi"] },
      { name: "datalake-clickhouse", replicas: 2, what: "ClickHouse analytics layer of the datalake, with automated backups.", tags: ["ClickHouse"], calls: ["datalake-kafka"] },
      { name: "observability", replicas: 3, what: "Observability with on-call (Grafana Mimir/Loki/Tempo, Alertmanager, GoAlert) and cloud cost management (FinOps).", tags: ["Grafana", "Mimir", "Loki", "Tempo", "GoAlert", "FinOps"], calls: ["trading-vm-fleet", "datalake-clickhouse"] },
    ],
  },
  {
    ns: "iceo", company: "ICEO - Venture Builder", role: "Senior DevOps Engineer (08.2024 – 10.2025) · DevOps Engineer (04.2023 – 07.2024)", period: "04.2023 – 10.2025", place: "Kraków / remote",
    workloads: [
      { name: "terraform-monorepo", replicas: 1, what: "Managed all GCP resources as Terraform code: a monorepo of ~60 reusable modules (GKE, VPC networking, IAM, databases, messaging).", tags: ["Terraform", "GCP"], calls: ["gke-platform"] },
      { name: "gke-platform", replicas: 3, what: "Part of the platform team behind the shared GCP platform used by the venture builder's product companies (trading, fintech, SaaS); ran the GKE clusters.", tags: ["GKE", "GCP"] },
      { name: "kafka-pipelines", replicas: 3, what: "Built Kafka-based data pipelines for analytics (Strimzi, Kafka Connect, PostgreSQL replication).", tags: ["Kafka", "Strimzi", "Kafka Connect"], calls: ["cloudnative-pg"] },
      { name: "cloudnative-pg", replicas: 2, what: "Operated PostgreSQL (Cloud SQL, CloudNativePG) and NATS.", tags: ["PostgreSQL", "CloudNativePG", "Cloud SQL", "NATS"] },
      { name: "istio-mesh", replicas: 2, what: "Deployed the Istio service mesh and Velero-based cluster backups across the platform.", tags: ["Istio", "Velero"], calls: ["gke-platform"] },
      { name: "argocd-delivery", replicas: 2, what: "Established the end-to-end SDLC on Kubernetes (GKE), standardised across ventures: ArgoCD, shared Helm charts, Bitbucket Pipelines.", tags: ["ArgoCD", "Helm", "Bitbucket Pipelines"], calls: ["gke-platform"] },
      { name: "otel-tracing", replicas: 2, what: "Ran observability as code, including distributed tracing built from scratch across the organization (Grafana Mimir/Loki/Tempo, OpenTelemetry Collector, OpsGenie).", tags: ["OpenTelemetry", "Mimir", "Loki", "Tempo", "OpsGenie"], calls: ["gke-platform"] },
      { name: "kyverno-hardening", replicas: 1, what: "Platform hardening: IAM as code, secrets management, Kyverno policies; cloud cost management; mentored developers.", tags: ["Kyverno", "IAM", "FinOps"], calls: ["gke-platform"] },
    ],
  },
  {
    ns: "savigo", company: "SAVIGO", role: "DevOps Tech Lead (12.2022 – 04.2023) · DevOps Engineer (11.2021 – 12.2022)", period: "11.2021 – 04.2023", place: "Warsaw / remote",
    workloads: [
      { name: "etl-pipelines", replicas: 3, what: "Maintained ETL pipelines built on Kafka, Apache Spark (PySpark), Debezium and Python.", tags: ["Kafka", "Spark", "Debezium", "Python"], calls: ["patroni-postgres"] },
      { name: "patroni-postgres", replicas: 3, what: "Managed Postgres HA clusters (Patroni) and Kubernetes clusters.", tags: ["PostgreSQL", "Patroni", "Kubernetes"] },
      { name: "elk-logging", replicas: 2, what: "Maintained and developed a central logging platform based on the ELK stack.", tags: ["ELK"] },
      { name: "jupyterhub", replicas: 1, what: "Deployed and maintained JupyterHub on Kubernetes with custom OpenStack integrations; developed new solutions using JupyterLab.", tags: ["JupyterHub", "JupyterLab", "OpenStack"], calls: ["patroni-postgres"] },
      { name: "tech-lead", replicas: 1, what: "Technical point of contact for the client (demos, acceptance of deliverables, requirements) and coordinator of the DevOps team (planning, review, delivery).", tags: ["Leadership"] },
    ],
  },
  {
    ns: "mobees", company: "Mobees", role: "DevOps Engineer", period: "09.2020 – 11.2021", place: "remote",
    workloads: [
      { name: "smsc-microservices", replicas: 3, what: "Internal systems of a telco operator (SMSC project): Kubernetes deployments and Helm charts for microservices.", tags: ["Kubernetes", "Helm"], calls: ["rabbitmq", "cassandra"] },
      { name: "jenkins", replicas: 1, what: "Ran CI/CD pipelines in Jenkins; tested releases and deployed within service windows.", tags: ["Jenkins"], calls: ["smsc-microservices"] },
      { name: "cassandra", replicas: 3, what: "Operated Cassandra.", tags: ["Cassandra"] },
      { name: "rabbitmq", replicas: 2, what: "Operated RabbitMQ.", tags: ["RabbitMQ"] },
      { name: "efk-logging", replicas: 2, what: "Operated the EFK stack; provisioned environments with Ansible.", tags: ["EFK", "Ansible"] },
      { name: "zabbix", replicas: 1, what: "Python/Bash automation and monitoring of environments with Zabbix.", tags: ["Python", "Bash", "Zabbix"], calls: ["smsc-microservices"] },
    ],
  },
  {
    ns: "observability", company: "Observability", role: "A small Prometheus, Loki and Grafana stack watching this very cluster", period: "", place: "",
    workloads: [
      { name: "alloy", replicas: 1, what: "Collector agent: scrapes metrics and tails pod logs, shipping them to Prometheus and Loki.", tags: ["Alloy", "OpenTelemetry"], calls: ["prometheus", "loki"] },
      { name: "prometheus", replicas: 1, what: "Metrics: stores time series (request rate, latency, restarts) and fires alerts when pods crash-loop.", tags: ["Prometheus", "Alertmanager"], port: 9090 },
      { name: "loki", replicas: 1, what: "Log aggregation, queried with LogQL: filter by namespace, app or level.", tags: ["Loki", "LogQL"], port: 3100 },
      { name: "grafana", replicas: 1, what: "Dashboards over Prometheus and Loki. Open the dashboard to watch this cluster live and debug the incident-lab.", tags: ["Grafana", "Dashboards"], calls: ["prometheus", "loki"], port: 3000 },
    ],
  },
  { ns: "skills", company: "Skills", role: "Tools I work with, as ConfigMaps", period: "", place: "", workloads: [] },
  {
    ns: "about", company: "About", role: "Summary, certification, education, side project", period: "", place: "Poland",
    workloads: [
      { name: "fotowrzutka", replicas: 2, what: "Fotowrzutka (2026): public photo-sharing SaaS designed, built and run solo, from idea to public users, including Stripe payments, SEO and Google Ads (OVH, Claude Code).", tags: ["SaaS", "Stripe", "SEO", "Google Ads", "OVH", "Claude Code"] },
    ],
  },
  {
    ns: "open-to-work", company: "Contact", role: "Available immediately", period: "", place: "Poland, remote",
    workloads: [
      { name: "jaroslaw", replicas: 1, what: "Senior DevOps Engineer, available immediately. Remote, Poland. See configmap/contact.", tags: ["Available now"] },
    ],
  },
  { ns: "sandbox", company: "Sandbox", role: "Create your own workloads here", period: "", place: "browser", workloads: [] },
  {
    ns: "incident-lab", company: "Playground", role: "Fix the worker", period: "now", place: "browser",
    workloads: [
      { name: "worker", replicas: 1, what: "Intentionally broken workload. It needs DATABASE_URL to reach the database, and right now it crashes. Find out why and fix it (logs, kubectl, or the edit tab).", tags: ["Troubleshooting"], crash: true, calls: ["postgres"] },
      { name: "postgres", replicas: 1, what: "Database for the lab. Reachable inside the cluster as postgres:5432.", tags: ["PostgreSQL"], port: 5432 },
    ],
  },
];
