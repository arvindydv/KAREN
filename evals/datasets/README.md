# Eval datasets

- Every file states whether it is `synthetic`. All current data is synthetic and hand-written.
- Never commit real user content. Production-derived cases must be consented, redacted and
  pseudonymised before they land here (architecture §10, §11).
- `voice/` — transcript-level slot-accuracy fixtures for the voice agent (Hindi/Hinglish amounts).
  They test the deterministic scorer, not any speech model.

Golden cases for the AI service live in `../golden-cases/`; run them with `pnpm evals`
(mock gateway only — results say nothing about model accuracy).
