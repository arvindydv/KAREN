/**
 * Server-side candidate validation V1–V11 (arch §7.3). Pure and authoritative: the model proposes,
 * this code decides. The first failure decides. V12 caps are applied by the caller with database
 * counts (`MEMORY_LIMITS`).
 */
import {
  MEMORY_TEXT_MAX_CHARS,
  firstDisallowedCodePoint,
  isMemoryLabelAllowed,
  memoryTextLength,
} from './charset.js';
import type { SensitiveCategory } from './lexicons.js';
import { normaliseWhitespace } from './normalise.js';
import {
  decideTier1,
  detectSensitive,
  mentionsChild,
  selfStatesMinor,
  type Tier1Failure,
} from './policy.js';
import { detectSecrets, type SecretKind } from './secrets.js';
import {
  MEMORY_KINDS,
  MEMORY_MODEL_SENSITIVITY,
  MEMORY_SUBJECTS,
  coerceSlot,
  kindExpires,
  type MemoryKind,
  type MemoryModelSensitivity,
  type MemoryRejectionClass,
  type MemorySlot,
  type MemorySubject,
} from './vocabulary.js';

/** The fields of a model candidate the server uses (mirrors `memoryCandidateSchema`, arch §2.4). */
export interface MemoryCandidateInput {
  kind: string;
  slot: string;
  subject: string;
  subject_label?: string | null;
  source_span: string;
  value_text: string;
  explicit_request: boolean;
  sensitivity: string;
  valid_until?: string | null;
}

export interface ValidationContext {
  /** The ONE user message the job was created for (never assistant text). */
  message: string;
  /** `memory.user_settings.ask_before_saving`. */
  askBeforeSaving: boolean;
}

export type MessageRejection = { class: 'secret'; secrets: SecretKind[] } | { class: 'minor' };

/**
 * Whole-message checks (V5 SECRET and V6b self-minor): any hit means NO memory at all from this
 * message, even for unrelated candidates.
 */
export function rejectWholeMessage(message: string): MessageRejection | null {
  const secrets = detectSecrets(message);
  if (secrets.length > 0) return { class: 'secret', secrets };
  if (selfStatesMinor(message)) return { class: 'minor' };
  return null;
}

export type CandidateDecision =
  | {
      accepted: false;
      class: MemoryRejectionClass;
      /** Which check failed (content-free; for metrics/tests). */
      check: 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8';
      categories?: SensitiveCategory[];
    }
  | {
      accepted: true;
      tier: 1 | 2;
      kind: MemoryKind;
      slot: MemorySlot;
      subject: MemorySubject;
      /** Validated label, or 'contact' when the model's label failed the rule (V4). */
      subjectLabel: string | null;
      /** Verbatim user words (substring of span ⊆ message). */
      text: string;
      sourceSpan: string;
      /** context/event carry an expiry (V9). */
      expires: boolean;
      validUntil: string | null;
      /** Why not tier 1 (absent when tier 1). */
      tier2Reason?: Tier1Failure | 'label_coerced';
    };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function textOk(s: string): boolean {
  return (
    s.trim().length > 0 &&
    memoryTextLength(s) <= MEMORY_TEXT_MAX_CHARS &&
    firstDisallowedCodePoint(s) === null
  );
}

/** Validate one candidate. Call `rejectWholeMessage` first (the API does both in order). */
export function validateCandidate(
  cand: MemoryCandidateInput,
  ctx: ValidationContext,
): CandidateDecision {
  // V1 — shape (already validated by the wire schema; re-asserted on the fields used here).
  if (
    !(MEMORY_KINDS as readonly string[]).includes(cand.kind) ||
    !(MEMORY_SUBJECTS as readonly string[]).includes(cand.subject) ||
    !(MEMORY_MODEL_SENSITIVITY as readonly string[]).includes(cand.sensitivity) ||
    typeof cand.source_span !== 'string' ||
    typeof cand.value_text !== 'string' ||
    typeof cand.explicit_request !== 'boolean' ||
    (cand.valid_until !== undefined &&
      cand.valid_until !== null &&
      !ISO_DATE.test(cand.valid_until))
  ) {
    return { accepted: false, class: 'invalid', check: 'V1' };
  }
  const kind = cand.kind as MemoryKind;
  const subject = cand.subject as MemorySubject;

  // V2 — span ⊆ message; V3 — value ⊆ span (after the same NFC/whitespace normalisation).
  const message = normaliseWhitespace(ctx.message);
  const span = normaliseWhitespace(cand.source_span);
  const value = normaliseWhitespace(cand.value_text);
  if (span.length === 0 || !message.includes(span)) {
    return { accepted: false, class: 'invalid', check: 'V2' };
  }
  if (value.length === 0 || !span.includes(value)) {
    return { accepted: false, class: 'invalid', check: 'V3' };
  }

  // V4 — character policy and length; label rule or coerce to 'contact' + tier 2.
  if (!textOk(value) || !textOk(span)) return { accepted: false, class: 'invalid', check: 'V4' };
  let subjectLabel: string | null = null;
  let labelCoerced = false;
  if (subject === 'third_party') {
    const raw = cand.subject_label?.trim() ?? '';
    if (raw && isMemoryLabelAllowed(raw)) subjectLabel = raw;
    else {
      subjectLabel = 'contact';
      labelCoerced = true;
    }
  }

  // V5 — SECRET on the span (the whole message was checked by rejectWholeMessage).
  if (detectSecrets(span).length > 0 || detectSecrets(ctx.message).length > 0) {
    return { accepted: false, class: 'secret', check: 'V5' };
  }

  // V6 — minors: third-party child (label or span) and self-stated minor (whole message).
  if (selfStatesMinor(ctx.message)) return { accepted: false, class: 'minor', check: 'V6' };
  if (subject === 'third_party' && mentionsChild(span, cand.subject_label ?? null)) {
    return { accepted: false, class: 'minor', check: 'V6' };
  }

  // V7 — SENSITIVE lexicon on the span.
  const categories = detectSensitive(span);
  if (categories.length > 0) {
    return { accepted: false, class: 'sensitive', check: 'V7', categories };
  }

  // V8 — model label escalates only.
  const modelLabel = cand.sensitivity as MemoryModelSensitivity;
  if (modelLabel !== 'none') return { accepted: false, class: modelLabel, check: 'V8' };

  // V9 — slot vocabulary; expiry for context/event.
  const slot = coerceSlot(cand.slot, kind);

  // V10 / V11 — tier decision (deterministic; third-party always tier 2).
  const base = {
    accepted: true as const,
    kind,
    slot,
    subject,
    subjectLabel,
    text: value,
    sourceSpan: span,
    expires: kindExpires(kind),
    validUntil: kindExpires(kind) ? (cand.valid_until ?? null) : null,
  };
  if (labelCoerced) return { ...base, tier: 2, tier2Reason: 'label_coerced' };
  // The rule locates the stored VALUE (value ⊆ span ⊆ message): a natural source_span includes
  // the trigger itself ("Remember that I'm vegetarian"), and the trigger must precede the value
  // in the same clause. Negation / question / reminder / clause checks are unchanged (H1).
  const decision = decideTier1({
    message: ctx.message,
    span: value,
    subject,
    askBeforeSaving: ctx.askBeforeSaving,
    modelExplicit: cand.explicit_request,
  });
  return decision.tier1
    ? { ...base, tier: 1 }
    : { ...base, tier: 2, tier2Reason: decision.failure };
}

// ── User-authored memory text (manual create, edit, confirm-with-edit; arch §3.6, §7.3) ──────

export interface UserAuthoredMemoryInput {
  kind: string;
  slot: string;
  subject: string;
  subjectLabel?: string | null;
  text: string;
}

export type UserAuthoredDecision =
  | {
      accepted: false;
      class: MemoryRejectionClass;
      /** Which rule failed (content-free; safe for responses and metrics). */
      check: 'V1' | 'V4' | 'V5' | 'V6' | 'V7';
      /** Machine-readable field the client should highlight. */
      field: 'kind' | 'subject' | 'subject_label' | 'text';
    }
  | {
      accepted: true;
      kind: MemoryKind;
      slot: MemorySlot;
      subject: MemorySubject;
      subjectLabel: string | null;
      /** NFC + whitespace-normalised text that will be stored. */
      text: string;
      expires: boolean;
    };

/**
 * Validation for text the USER typed into a memory (not model output). V2/V3 (verbatim substring)
 * do not apply — the user is the author, so provenance says "added/edited by you" — but V4–V7 do:
 * the character policy, SECRET, minors and SENSITIVE rules are the same as for extracted
 * candidates (D9 applies to every stored memory, whoever typed it). V9 coerces the slot.
 */
export function validateUserAuthoredMemory(input: UserAuthoredMemoryInput): UserAuthoredDecision {
  if (!(MEMORY_KINDS as readonly string[]).includes(input.kind)) {
    return { accepted: false, class: 'invalid', check: 'V1', field: 'kind' };
  }
  if (!(MEMORY_SUBJECTS as readonly string[]).includes(input.subject)) {
    return { accepted: false, class: 'invalid', check: 'V1', field: 'subject' };
  }
  const kind = input.kind as MemoryKind;
  const subject = input.subject as MemorySubject;
  const text = normaliseWhitespace(input.text);
  if (!textOk(text)) return { accepted: false, class: 'invalid', check: 'V4', field: 'text' };
  let subjectLabel: string | null = null;
  if (subject === 'third_party') {
    const raw = input.subjectLabel?.trim() ?? '';
    if (!raw || !isMemoryLabelAllowed(raw)) {
      return { accepted: false, class: 'invalid', check: 'V4', field: 'subject_label' };
    }
    subjectLabel = raw;
  } else if (input.subjectLabel) {
    return { accepted: false, class: 'invalid', check: 'V1', field: 'subject_label' };
  }
  if (detectSecrets(text).length > 0 || (subjectLabel && detectSecrets(subjectLabel).length > 0)) {
    return { accepted: false, class: 'secret', check: 'V5', field: 'text' };
  }
  if (selfStatesMinor(text)) return { accepted: false, class: 'minor', check: 'V6', field: 'text' };
  if (subject === 'third_party' && mentionsChild(text, subjectLabel)) {
    return { accepted: false, class: 'minor', check: 'V6', field: 'subject_label' };
  }
  if (detectSensitive(text).length > 0) {
    return { accepted: false, class: 'sensitive', check: 'V7', field: 'text' };
  }
  return {
    accepted: true,
    kind,
    slot: coerceSlot(input.slot, kind),
    subject,
    subjectLabel,
    text,
    expires: kindExpires(kind),
  };
}
