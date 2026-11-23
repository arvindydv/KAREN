# KAREN Terraform

Infrastructure-as-code for the KAREN AWS footprint (architecture §1, §8, §9, §10, §15).
Primary region: **Mumbai `ap-south-1`**. Compute: **ECS on Fargate**. No Kubernetes.

> **Status: nothing in this directory has been applied to any AWS account.**
> It has been checked with `terraform fmt`, `terraform validate` and an offline
> mocked `terraform test` (no credentials, no API calls). `validate` and mocked
> tests prove the configuration is internally consistent; they do **not** prove
> it will plan or apply cleanly against a real account (service quotas, instance
> class availability, IAM/KMS interactions, naming collisions, etc.).
> Treat the first real `plan` in a sandbox account as the true first test.

## Layout

```
infra/terraform/
├── modules/                 reusable building blocks (no provider config, no backend)
│   ├── networking/          VPC, 3-AZ public/private/isolated-db subnets, NAT (single or per-AZ),
│   │                        S3 gateway endpoint, optional interface endpoints, VPC flow logs
│   ├── security-groups/     one SG per workload, SG-to-SG rules, TLS-only internet egress
│   ├── kms/                 CMKs (secrets, data, logs, messaging) with rotation
│   ├── secrets/             Secrets Manager secret CONTAINERS (never values)
│   ├── ecr/                 immutable tags, scan on push, lifecycle policy, KMS
│   ├── ecs-cluster/         cluster with Container Insights + Cloud Map private DNS namespace
│   ├── ecs-service/         generic Fargate service (secrets, read-only rootfs, non-root,
│   │                        awslogs, health check, autoscaling, circuit breaker + rollback,
│   │                        optional ALB target group, optional service discovery)
│   ├── alb/                 HTTPS listener, HTTP→HTTPS redirect, drop invalid headers,
│   │                        access logs, 120 s idle timeout (SSE), host/path rules
│   ├── rds-postgres/        PostgreSQL 17, CMK, PITR, force_ssl, IAM auth, RDS-managed master secret
│   ├── redis/               ElastiCache replication group (Valkey default), TLS + at-rest, AUTH token
│   ├── s3/                  private bucket: BPA, SSE-KMS/S3, versioning, lifecycle, TLS-only policy
│   ├── sqs/                 queue + DLQ, SSE-KMS, redrive, TLS-only policy
│   ├── eventbridge/         domain-event bus, archive, rules routing to SQS
│   ├── iam/                 per-service execution + task roles (least privilege)
│   └── monitoring/          log groups, SNS alerts topic, alarms, optional budget
└── environments/
    ├── dev/                 minimal: single NAT, single-AZ RDS, 1 task each, t4g instances
    ├── staging/             moderate: single NAT, single-AZ RDS (t4g.medium), Multi-AZ cache
    └── production/          Multi-AZ RDS + cache, NAT per AZ, interface endpoints
```

Each environment has: `main.tf` (identical across environments on purpose — differences
live in `variables.tf` defaults and tfvars), `variables.tf`, `outputs.tf`, `versions.tf`
(provider + `default_tags`), `backend.tf` (partial S3 backend), `backend.hcl.example`,
`terraform.tfvars.example`, `.terraform.lock.hcl` and `tests/mock_plan.tftest.hcl`.

Provider pins: `hashicorp/aws ~> 6.73` (6.73.0 was the newest release on the registry on
2026-11-19), `hashicorp/random ~> 3.7`; Terraform `>= 1.11` (needed for ephemeral resources
and write-only arguments, which keep the ElastiCache AUTH token out of state). Lock files
contain hashes for `linux_amd64`, `linux_arm64` and `darwin_arm64`.

## What gets deployed (per environment)

| Service | Port | Exposure | Health |
|---|---|---|---|
| `api` (NestJS) | 4100 | ALB host rule `api_hostname` | `/health/ready` |
| `ai-service` (FastAPI) | 8100 | internal only: SG allows `api` + `voice-agent`; Cloud Map `ai-service.karen-<env>.internal` | `/health/ready` |
| `temporal-worker` | — | none (egress to Temporal Cloud :7233) | — |
| `provider-worker` | 4200 | ALB rule `/webhooks/*` (priority 10, before api) | `/health/ready` |
| `voice-agent` (LiveKit worker) | 8200 (health only) | none (egress to LiveKit Cloud, UDP media) | `/health/ready` on 8200 |
| `web` (Next.js, optional) | 3000 | ALB host rule `web_hostname`, `enable_web` | `/` |
| `admin` (Next.js, optional) | 3000 | ALB host rule + **source-IP allowlist**, `enable_admin` | `/` |

See `docs/architecture/infrastructure.md` for the diagram, trust boundaries and per-environment sizing.

## Bootstrapping remote state (once per account)

The state bucket is created **out-of-band** (not by this code — chicken-and-egg), following
`docs/runbooks/terraform-state-bootstrap.md`: an S3 bucket with versioning, SSE-KMS, Block
Public Access, a TLS-only policy, and S3-native locking (`use_lockfile = true`; no DynamoDB).

Then, per environment:

```bash
cd infra/terraform/environments/dev
cp backend.hcl.example backend.hcl            # fill in bucket / kms key; git-ignored
cp terraform.tfvars.example terraform.tfvars  # fill in placeholders; git-ignored; no secrets
terraform init -backend-config=backend.hcl
```

## Planning safely

1. Authenticate with short-lived credentials for the **target account only** (SSO/OIDC role);
   set `allowed_account_ids` in tfvars so the provider refuses any other account.
2. `terraform fmt -check -recursive infra/terraform` and `terraform validate`.
3. `terraform plan -out=tfplan` and review it — especially any `destroy`/`replace` of RDS,
   ElastiCache, KMS keys, S3 buckets or secrets. Never apply a plan you did not read.
4. Apply only the saved plan (`terraform apply tfplan`) from CI with an approval gate for
   staging/production. Plan files can contain sensitive values: don't upload them as public
   CI artifacts.
5. First apply ordering: ECR repositories must contain the images referenced in `image_tags`
   before services can reach steady state. Either push images first
   (`terraform apply -target=module.ecr`, push, then full apply) or accept that services
   roll back until images exist. Populate the secret containers (runbook) before tasks start;
   tasks fail to launch if a referenced secret has no value.

Offline checks that need no AWS credentials:

```bash
cd infra/terraform/environments/<env>
terraform init -backend=false
terraform validate
terraform test          # mocked AWS provider: variable validation + wiring only
```

## Integration contract for application images

- Containers run as UID/GID `1000:1000` with a **read-only root filesystem**, all Linux
  capabilities dropped, and a writable `/tmp`. Images must not need to write elsewhere
  (set `readonly_root_filesystem = false` in the ecs-service call only with justification —
  LiveKit agent model caches are the likely candidate).
- Health checks avoid curl: Node services are probed with `node -e fetch(...)`, Python
  services with `python -c urllib...`. The binaries must be on `PATH`.
- `DATABASE_URL` is a per-service secret container (each service gets its **own** Postgres
  role, created by migrations; the RDS master secret is never given to services). Use
  `sslmode=verify-full` with the RDS CA bundle (`rds.force_ssl=1`).
- Redis: services receive `REDIS_HOST`, `REDIS_PORT`, `REDIS_TLS=true` and the secret
  `REDIS_AUTH_TOKEN`; the app composes `rediss://:<token>@host:port`. (The `@karen/config`
  schema currently expects `REDIS_URL`; the app must build it from these parts.)
- Temporal: `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_API_KEY` come from Secrets
  Manager; `TEMPORAL_TLS_ENABLED=true`.
- Image tags are immutable; deploy by changing `image_tags` (git SHA) and applying.

## Cost notes (rough, **unverified estimates**)

Verify with the AWS Pricing Calculator for `ap-south-1` before committing to budgets.
The dominant fixed costs are:

- **NAT gateways** — hourly charge per gateway (~USD 30–45/month each) plus per-GB processing.
  Dev/staging use 1, production uses 3. Interface endpoints (production) cut NAT data
  charges for ECR/Secrets/Logs/SQS traffic but cost ~USD 7–10/month per endpoint per AZ
  (5 endpoints × 3 AZs ≈ USD 100–150/month).
- **RDS** — Multi-AZ doubles instance cost. Order of magnitude: dev `db.t4g.small` single-AZ
  tens of USD/month; production `db.m7g.large` Multi-AZ several hundred USD/month, plus storage/backups.
- **ElastiCache** — each node is billed; Multi-AZ needs ≥ 2 nodes. Valkey is priced below
  Redis OSS for the same node type.
- **ALB** — ~USD 20/month base plus LCUs.
- **Fargate** — per vCPU-hour and GB-hour, per running task; dev runs 5 small tasks.

Very rough totals before meaningful traffic: dev ≈ USD 250–450/month, staging ≈ USD
600–1,000/month, production ≈ USD 2,000–3,500/month. These are guesses for planning
orders of magnitude only. OpenRouter, Temporal Cloud, LiveKit Cloud, Cloudflare,
Sentry and Langfuse are billed separately. Set `budget_monthly_limit_usd` (requires the
`Environment` cost-allocation tag to be activated in Billing).

## Not provisioned on purpose

- **Kubernetes / EKS** — ECS/Fargate first (§9, §15).
- **Kafka / MSK** — SQS + EventBridge first; Kafka only with measured need (§8).
- **Qdrant** — pgvector in PostgreSQL (`CREATE EXTENSION vector` in migrations).
- **Neo4j**, **GPU** instances/clusters — explicitly avoided (§15).
- **Temporal server** — Temporal Cloud is used in deployed environments.
- **LiveKit server** — LiveKit Cloud is assumed; only the agent worker runs here.
- **Cloudflare** — configured outside AWS (DNS, proxy, WAF, CDN, Access). The ALB's security
  group accepts traffic only from `alb_ingress_ipv4_cidrs`; set it to Cloudflare's published
  ranges so the origin can't be reached around Cloudflare. Consider Cloudflare Authenticated
  Origin Pulls (mTLS) as a stronger second layer.
- **AWS WAF** — optional association via `waf_web_acl_arn`; Cloudflare WAF is primary.
- **RDS Proxy / read replicas** — add when connection counts or read load justify it.
- **Egress FQDN filtering** — security groups allow TLS egress to `0.0.0.0/0` because they
  can't filter by hostname; partner allowlisting (§9) needs AWS Network Firewall or an
  egress proxy (Phase B).
- **CloudTrail / GuardDuty / Security Hub / AWS Config** — account-level baselines that
  belong in an organisation/landing-zone stack, not per-app environments.

## Scanner results (trivy config 0.76.1, accepted findings)

Run: `docker run --rm -v "$PWD/infra/terraform:/src:ro" aquasec/trivy:0.76.1 config /src`.
An earlier run flagged S3 access logging (AWS-0089), which was fixed: data buckets now log to
the log bucket. tflint and checkov weren't run because they aren't installed.

| Check | Where | Decision |
|---|---|---|
| AWS-0104 unrestricted egress (CRITICAL) | `security-groups` TLS egress (443, Temporal 7233, LiveKit UDP) | Accepted: external SaaS endpoints (OpenRouter, Temporal Cloud, LiveKit Cloud, partner APIs) have no stable CIDRs. Mitigation: Network Firewall/egress proxy in Phase B. |
| AWS-0053 public load balancer (HIGH) | `alb` | Accepted: it's the public origin; ingress is limited to Cloudflare CIDRs, HTTPS-only, invalid headers dropped. |
| AWS-0177 deletion protection off (MEDIUM) | `rds-postgres` in dev | Accepted for dev only (staging/production default to `true`). |
| AWS-0133 Performance Insights off (LOW) | `rds-postgres` in dev | Accepted for dev only (cost; small burstable class). |
