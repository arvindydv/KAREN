# Secret CONTAINERS only. Terraform never writes secret values (they would end
# up in state). Values are set out-of-band by an authorised operator, e.g.
#   aws secretsmanager put-secret-value --secret-id <arn> --secret-string file://value
# See docs/runbooks/terraform-state-bootstrap.md.

resource "aws_secretsmanager_secret" "this" {
  for_each = var.secrets

  name                    = "${var.name_prefix}/${each.key}"
  description             = each.value.description
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days

  tags = { DataClassification = "secret" }
}
