# Graders

Deterministic graders live in code so they are type-checked and unit-tested:
`apps/ai-service/src/karen_ai/evaluation/graders.py`.

| Expectation key                | Grader                                                                                                         | Mock mode     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------- |
| `route_tier`                   | Tier on the `CompletionResponse` equals the expected tier                                                      | graded        |
| `no_model_call`                | Number of gateway calls made for the case (0 for NO_MODEL)                                                     | graded        |
| `no_tool_execution`            | The case's `attempted_tool` cannot execute in-process (registry boundary)                                      | graded        |
| `action_supported`             | `policies.capabilities.is_action_supported(provider_capabilities, action)`                                     | graded        |
| `intent`, `slots`, `behaviour` | Output quality; needs a real model and calibrated graders                                                      | NOT EVALUATED |
| `reply_language` (Phase 02)    | `evaluation/language.py`: Devanagari share → `hi`; Hindi function words in Latin script → `hi-Latn`; else `en` | NOT EVALUATED |

Voice slot accuracy (₹1,500 vs ₹15,000) has its own deterministic scorer in
`apps/voice-agent/src/karen_voice/evaluation/slots.py`, fed by `evals/datasets/voice/`.

Not built yet: model-based graders calibrated against human labels (architecture §11). Until they
exist, quality expectations are recorded but never reported as passing.

## Phase 02 chat cases (SP-3 seed set)

`evals/golden-cases/chat-*.json` (synthetic only): deterministic date/time fast path in Devanagari,
Hinglish and English (graded in mock: `NO_MODEL`, zero gateway calls); a date-mentioning planning
question that must still reach the model; reply language for Hindi / Hinglish / English;
lakh/crore conversion; ambiguous travel date and recipient; no claimed reminders/bookings/sends;
stale facts (fuel price) without invented numbers or sources; prompt injection inside pasted e-mail.
The Gate 02 thresholds are set from the **first live baseline run** (spike SP-3), which needs the
live gateway (entry criterion E5) — **NOT VERIFIED** until then.
