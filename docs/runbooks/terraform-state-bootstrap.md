# Runbook: Terraform state bootstrap and first-apply prerequisites

**Applies to:** `infra/terraform/environments/{dev,staging,production}`
**When:** once per AWS account (state bucket), then once per environment (secrets).
**Who:** a platform engineer with administrator access to the target account.
**Status:** written alongside the Terraform code; **not yet exercised against a real account**.
Check each command's output before you run the next one.

The Terraform state bucket is created **out-of-band** on purpose: Terraform can't store its
own state in a bucket it hasn't created yet, and keeping the bucket outside every
environment stack means a `terraform destroy` can never delete it.

## 0. Prerequisites

- AWS CLI v2, Terraform >= 1.11 (the repo was checked with 1.15.7).
- Short-lived admin credentials for the **target** account (IAM Identity Center/SSO).
  Confirm before doing anything:

  ```bash
  aws sts get-caller-identity --query Account --output text
  export AWS_REGION=ap-south-1
  export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  export STATE_BUCKET="karen-tfstate-${ACCOUNT_ID}-${AWS_REGION}"
  ```

Recommended: one AWS account per environment (dev / staging / production) under AWS
Organizations. With that setup, run this runbook in each account. If several environments
share an account, they share the bucket and are separated by `key`.

## 1. KMS key for state

```bash
KEY_ID=$(aws kms create-key \
  --description "Terraform state encryption (karen)" \
  --tags TagKey=Project,TagValue=karen TagKey=ManagedBy,TagValue=manual \
  --query KeyMetadata.KeyId --output text)
aws kms enable-key-rotation --key-id "$KEY_ID"
aws kms create-alias --alias-name alias/karen-tfstate --target-key-id "$KEY_ID"
```

The default key policy delegates to IAM in this account, so access is controlled by the IAM
policies of whoever runs Terraform (step 4).

## 2. State bucket

```bash
aws s3api create-bucket --bucket "$STATE_BUCKET" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"

aws s3api put-public-access-block --bucket "$STATE_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-ownership-controls --bucket "$STATE_BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'

aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" \
  --server-side-encryption-configuration "{
    \"Rules\": [{
      \"ApplyServerSideEncryptionByDefault\": {
        \"SSEAlgorithm\": \"aws:kms\",
        \"KMSMasterKeyID\": \"alias/karen-tfstate\"
      },
      \"BucketKeyEnabled\": true
    }]
  }"

# Keep old state versions for recovery, but not forever.
aws s3api put-bucket-lifecycle-configuration --bucket "$STATE_BUCKET" \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "expire-old-state-versions",
      "Status": "Enabled",
      "Filter": {},
      "NoncurrentVersionExpiration": {"NoncurrentDays": 90},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}
    }]
  }'

# TLS-only access.
aws s3api put-bucket-policy --bucket "$STATE_BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"DenyInsecureTransport\",
    \"Effect\": \"Deny\",
    \"Principal\": \"*\",
    \"Action\": \"s3:*\",
    \"Resource\": [\"arn:aws:s3:::${STATE_BUCKET}\", \"arn:aws:s3:::${STATE_BUCKET}/*\"],
    \"Condition\": {\"Bool\": {\"aws:SecureTransport\": \"false\"}}
  }]
}"
```

**Locking:** the backends use `use_lockfile = true` (S3-native locking with a `.tflock`
object next to the state). No DynamoDB table is needed. Don't add `dynamodb_table`; it's
deprecated.

## 3. Wire the backend

```bash
cd infra/terraform/environments/dev        # or staging / production
cp backend.hcl.example backend.hcl         # git-ignored
# edit: bucket = "$STATE_BUCKET", key = "karen/<env>/terraform.tfstate",
#       region = "ap-south-1", kms_key_id = "arn:aws:kms:ap-south-1:<acct>:alias/karen-tfstate"
terraform init -backend-config=backend.hcl
```

## 4. Who may touch state

- **CI (GitHub Actions):** use GitHub OIDC → an IAM role per environment whose trust policy
  is limited to this repository and the protected branch/environment
  (`token.actions.githubusercontent.com:sub = repo:<org>/<repo>:environment:<env>`).
  Plan roles get read-only access plus state read/lock. Apply roles are used only from
  protected environments that need reviewer approval.
- **Humans:** read access to state is effectively read access to infrastructure metadata.
  State holds no application secret values (secret containers only; the RDS master password
  is managed by RDS; the Redis AUTH token uses write-only arguments). It still holds ARNs,
  endpoints and configuration, so treat it as confidential.
- Minimum S3 permissions for the state key: `s3:ListBucket` on the bucket; `s3:GetObject`,
  `s3:PutObject` on `karen/<env>/terraform.tfstate`; `s3:GetObject`, `s3:PutObject`,
  `s3:DeleteObject` on `karen/<env>/terraform.tfstate.tflock`; `kms:Encrypt`,
  `kms:Decrypt`, `kms:GenerateDataKey` on the state key.

## 5. Before the first `apply` of an environment

1. **ACM certificate** in `ap-south-1` for `api_hostname` (and web/admin if enabled),
   DNS-validated in Cloudflare. Put its ARN in `terraform.tfvars`.
2. **Cloudflare IP ranges**: refresh `alb_ingress_ipv4_cidrs` from
   https://www.cloudflare.com/ips-v4.
3. **Images**: create the ECR repositories first, then push images tagged with the git SHA:

   ```bash
   terraform plan -target=module.ecr -out=ecr.tfplan && terraform apply ecr.tfplan
   # push images, then set image_tags in terraform.tfvars
   ```

4. **Full plan** → review → apply the saved plan.
5. **Populate secret containers** (Terraform never sets values). For each ARN in
   `terraform output secret_arns_to_populate`:

   ```bash
   # Read the value from a file or prompt so it never lands in shell history.
   aws secretsmanager put-secret-value --secret-id "<arn>" --secret-string file:///dev/stdin
   ```

   | Secret                                                                            | Consumers                                                      | Notes                                            |
   | --------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
   | `shared/INTERNAL_SERVICE_HMAC_SECRET`                                             | api, ai-service, temporal-worker, provider-worker, voice-agent | ≥ 32 random bytes                                |
   | `shared/LOG_PSEUDONYMIZATION_KEY`                                                 | backend services                                               | ≥ 32 random bytes                                |
   | `shared/SENTRY_DSN`                                                               | all services                                                   |                                                  |
   | `shared/TEMPORAL_ADDRESS`, `shared/TEMPORAL_NAMESPACE`, `shared/TEMPORAL_API_KEY` | api, temporal-worker, provider-worker                          | Temporal Cloud                                   |
   | `shared/LIVEKIT_API_KEY`, `shared/LIVEKIT_API_SECRET`                             | api, voice-agent                                               | LiveKit Cloud                                    |
   | `ai-service/AI_GATEWAY_API_KEY`                                                   | **ai-service only**                                            | Never in clients or other services               |
   | `ai-service/LANGFUSE_PUBLIC_KEY`, `ai-service/LANGFUSE_SECRET_KEY`                | ai-service                                                     |                                                  |
   | `provider-worker/PROVIDER_WEBHOOK_SECRETS`                                        | provider-worker                                                | JSON `{ "<provider>": "<signing secret>" }`      |
   | `<service>/DATABASE_URL`                                                          | that service only                                              | Per-service Postgres role, `sslmode=verify-full` |

   `karen/<env>/cache/REDIS_AUTH_TOKEN` is generated by Terraform. Don't set it by hand.

6. **Database roles**: using the RDS-managed master secret
   (`terraform output rds_master_secret_arn`) from a migration task inside the VPC, create one
   least-privilege role per service, run migrations (including `CREATE EXTENSION vector;`),
   then write each service's `DATABASE_URL` secret. Don't give services the master credentials.
7. Confirm the SNS email subscriptions, and activate the `Environment` cost-allocation tag
   if `budget_monthly_limit_usd` is set.

## 6. Recovery

- **Corrupted/bad state:** list versions with
  `aws s3api list-object-versions --bucket "$STATE_BUCKET" --prefix karen/<env>/terraform.tfstate`,
  download the last good version and restore it with `terraform state push` after review.
- **Stuck lock:** confirm no run is active, then `terraform force-unlock <LOCK_ID>`.
- **Redis AUTH token rotation:** increment `redis_auth_token_version` and apply. Secrets
  Manager and ElastiCache both get the new token in the same apply (`ROTATE` strategy keeps
  the old token valid). Restart services afterwards so they read the new secret.
