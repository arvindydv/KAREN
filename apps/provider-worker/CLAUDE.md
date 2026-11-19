# apps/provider-worker — rules

- Every adapter declares a `ProviderDescriptor` that must pass `providerDescriptorSchema`; never declare capabilities the provider does not contractually support. Search-only means search-only.
- Real adapters require approved legal/commercial access and credentials (docs/integrations/provider-adapter-contract.md). Until then only the SANDBOX mock exists; SANDBOX results must stay labelled.
- Side-effecting operations must be idempotent on the supplied key; throw `ProviderAmbiguousError` for ambiguous outcomes.
- Webhooks: verify the signature over the **raw body**, enforce timestamp tolerance, claim the event id in the replay guard, then hand to the sink. Webhooks are hints; workflows verify via status.
- Never log payloads containing personal data or provider credentials.
