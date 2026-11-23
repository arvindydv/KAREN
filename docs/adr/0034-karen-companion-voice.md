# 0034 — KAREN as a companion: Claude Haiku for spoken turns, chat.v4 persona, name, voice-first phone

- Status: Accepted · Date: 2026-11-22
- Builds on: ADR-0029 (spoken style), ADR-0032 (voice model), ADR-0033 (echo gate).

## Context

Owner feedback after ADR-0033: conversations did not feel like talking to a person, KAREN did not
pick up how they felt, the phone showed "Couldn't play KAREN's voice", and the app felt like a chat
app rather than the product in `karen.md` §1 (a trusted, proactive personal life agent).

## Decision

1. **Spoken-turn model**: `KAREN_MODEL_VOICE=anthropic/claude-haiku-5.5` (in the verified live
   registry, BALANCED tier, ZDR). Llama 4 Maverick (ADR-0032) was ≈0.5 s faster to the first word
   (1.07 s vs 1.56 s median) but weaker at reading emotion and holding a persona; for a companion,
   conversation quality wins. Typed chat is unchanged (BALANCED routing).
2. **Prompt `chat.v4`**: KAREN is the user's personal AI life companion, not a chatbot. She listens
   for the feeling behind the words and responds to the person first, matches their energy, treats
   small talk as small talk, refers back to the conversation, asks at most one follow-up, varies her
   phrasing, and points to 112 when someone seems in danger. Spoken turns: short like a real call,
   natural reactions used sparingly, a human first sentence. Honesty rules are unchanged (no memory
   across chats yet, no actions, no invented facts) but are said naturally, not as a disclaimer in
   every reply.
3. **Name**: internal contract v3 gains additive optional `user_name` (1–40 chars, letters/marks and
   `. ' -` only, TS + Python + fixture). The API sends the preferred name, else the first word of
   the display name, cleaned by `addressName`; the prompt marks it as "only a name".
4. **Phone playback fixed**: sentence clips are downloaded with `expo/fetch` (React Native's global
   fetch is unreliable for binary audio), the temp file write is awaited (expo-file-system 58
   `write` is async — the player could open a half-written file), a stuck clip times out after 8 s
   instead of hanging, one failed clip download is retried (nothing of it was played), and if part
   of the answer was heard the turn ends quietly rather than with an error banner.
5. **Voice-first phone**: on the landing (new chat) and empty conversations the orb _is_ the main
   control ("Tap KAREN to talk"); time-of-day greeting with the user's name ("Good evening, Asha.
   What's on your mind?"); voice-mode status reads like a person ("Go ahead, I'm listening",
   "Hmm…", "Tap me to interrupt"). Web voice mode copy aligned.

## Consequences

- Spoken replies start ≈0.5 s later than with Maverick (NOT re-measured with chat.v4).
- The system prompt is ≈1.4k tokens; at real prices this is ≈$0.001 per turn. Two cost tests used
  an artificial $100/1M price and were retuned to $40/1M.

## NOT VERIFIED

Conversation quality and emotional understanding with real users (mock-gateway evals check wiring
only); the phone playback fix on physical devices (needs a new development build); Haiku 5.5 time to
first word with the longer prompt.
