# Network egress policy

Reviewed 2026-11-20 (`infra/terraform/modules/security-groups`, `modules/networking`).

## What is enforced today (IaC, not yet applied to any account)

- **Default deny.** Terraform-managed security groups have no implicit allow-all egress; every
  rule is explicit. RDS and ElastiCache groups have **no egress at all**; the VPC default security
  group is locked down (`aws_default_security_group` with no rules).
- **East-west** traffic is SG-to-SG only (e.g. only `api` and `voice_agent` may reach `ai_service:8100`;
  only workloads that need it may reach RDS/Redis).
- **Internet egress** is limited by port: TCP 443 for api, ai-service, workers, voice, web/admin;
  Temporal Cloud gRPC port for api/workers; UDP media range for voice-agent only. It leaves via
  NAT gateways from private subnets. S3 uses a gateway VPC endpoint; interface endpoints for AWS
  APIs are available behind `enable_interface_endpoints`.

## Gap (documented, accepted for the foundation, BLOCKER before real users)

Security groups cannot filter by hostname, so "443 to 0.0.0.0/0" lets a compromised or
prompt-injected service exfiltrate to any HTTPS host. Required destinations per service:

| Service         | Allowed destinations (FQDN allowlist)                                                             |
| --------------- | ------------------------------------------------------------------------------------------------- |
| ai-service      | OpenRouter host (`openrouter.ai`), Langfuse host (when enabled), AWS APIs via VPC endpoints       |
| api             | IdP JWKS/issuer host, Temporal Cloud, LiveKit API (token minting is local; none needed), AWS APIs |
| provider-worker | each **approved** partner API host (added per integration, reviewed), Temporal Cloud              |
| temporal-worker | Temporal Cloud, AWS APIs — **no partner hosts** (partner calls belong to provider-worker)         |
| voice-agent     | LiveKit Cloud (WSS + media), ai-service (internal)                                                |
| web / admin     | the public API host                                                                               |

**Decision for the next infra milestone:** AWS Network Firewall (stateful domain-list rule group,
`DROP` by default, TLS SNI inspection) on the NAT path, or an egress proxy (e.g. Squid/Envoy in
ECS) with per-service allowlists; plus interface VPC endpoints for Secrets Manager, ECR, Logs,
SQS, EventBridge, KMS, STS so AWS traffic never needs the internet path.

## Application-level controls (enforced today)

- ai-service live mode requires an `https://` gateway base URL and refuses direct-provider
  fallback (`KAREN_AI_ALLOW_DIRECT_PROVIDER_FALLBACK=true` fails startup).
- The LLM has no network tools: side-effecting tools are proposal-only (`tools/registry.py`);
  no tool fetches arbitrary URLs. Any future fetch tool must use a host allowlist and treat the
  response as untrusted input.
- Provider adapters are registered explicitly (`ProviderRegistry`); unknown providers → 404.
