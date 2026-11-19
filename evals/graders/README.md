# Graders

Deterministic graders live in code so they are type-checked and unit-tested:
`apps/ai-service/src/karen_ai/evaluation/graders.py`.

| Expectation key                | Grader                                                                     | Mock mode     |
| ------------------------------ | -------------------------------------------------------------------------- | ------------- |
| `route_tier`                   | Tier on the `CompletionResponse` equals the expected tier                  | graded        |
| `no_model_call`                | Number of gateway calls made for the case (0 for NO_MODEL)                 | graded        |
| `no_tool_execution`            | The case's `attempted_tool` cannot execute in-process (registry boundary)  | graded        |
| `action_supported`             | `policies.capabilities.is_action_supported(provider_capabilities, action)` | graded        |
| `intent`, `slots`, `behaviour` | Output quality; needs a real model and calibrated graders                  | NOT EVALUATED |

Voice slot accuracy (₹1,500 vs ₹15,000) has its own deterministic scorer in
`apps/voice-agent/src/karen_voice/evaluation/slots.py`, fed by `evals/datasets/voice/`.

Not built yet: model-based graders calibrated against human labels (architecture §11). Until they
exist, quality expectations are recorded but never reported as passing.
