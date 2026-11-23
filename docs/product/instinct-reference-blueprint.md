













































KAREN --- Complete Product Investigation & Build Blueprint
An India-first Personal AI Life Agent inspired by Instinct
Document type: Product discovery, competitive teardown, functional
specification, architecture investigation, and implementation blueprint
Version: 1.0
Prepared: 23 November 2026
Product: KAREN --- Personal AI Life Agent
Strategic reference: Instinct (instinct.com)
Audience: Product owner, engineering leads, AI/ML engineers,
mobile/web engineers, security, QA, DevOps, and future integration
partners
Status: Investigation and planning artifact --- not implementation
approval and not production launch approval

0. How to use this document
This document translates the Instinct research into a concrete
investigation and build blueprint for KAREN. It is not a proposal to
copy Instinct's branding, interface, proprietary implementation, or
unverified capabilities.

KAREN already has a defined product direction and a documented technical
foundation. This investigation therefore preserves the existing KAREN
decisions rather than starting a second architecture from scratch.

Existing KAREN decisions carried forward
Product: KAREN --- Personal AI Life Agent.
Market: India-first, designed for international expansion.
Experience: Premium, conversational, proactive, permission-based
personal assistant.
Core product capabilities: Chat and voice, long-term memory,
life-pattern detection, goals, proactive suggestions, Responsibility
Engine, integrations, bookings, payments, email, family assistance,
refunds, and task follow-through.
Client applications: React Native / Expo mobile; Next.js web and
admin.
Business API: NestJS on Fastify.
AI service: Python / FastAPI with LangGraph.
Model access: Vercel AI Gateway as the primary multi-model
inference gateway, with a thin KAREN Model Router.
Durable workflows: Temporal.
Data: PostgreSQL with pgvector initially; Redis for ephemeral
coordination; private encrypted S3 for files and artifacts.
Infrastructure: AWS, initially ECS/Fargate; SQS/EventBridge for
event fan-out; Terraform and GitHub Actions.
Voice: LiveKit / WebRTC, with audio-provider and gateway
compatibility to be validated before committing to a production
voice path.
Observability/evaluation: OpenTelemetry, Grafana or managed
equivalents, Sentry, Langfuse, and a dedicated evaluation harness.
The current repository foundation has been reported as completed, while
actual user-facing product features remain to be implemented. The
existing architecture document is
KAREN_WORLD_CLASS_TECH_ARCHITECTURE_2026.md (Architecture v2.0, 19
November 2026).

Governance status to preserve
The latest Phase 01 review recorded formal Phase 01 closure: NO-GO
and production launch: NO-GO, while Phase 02 planning: GO
subject to written approval and six entry conditions. This document is
suitable for Phase 02 planning and design. It does not override those
gates, approve implementation, or declare the platform production-ready.

Evidence labels
Every important claim should be interpreted using one of these labels:

Publicly documented: Stated in official Instinct material,
terms, or privacy policy.
Reported: Described by a third-party publication or hands-on
tester.
KAREN decision: A decision already made for KAREN.
Recommendation: A proposed KAREN product or engineering
requirement.
Unverified: Requires direct product access, vendor confirmation,
legal review, or a technical experiment.
1. Executive summary
1.1 What KAREN should become
KAREN should be a goal-driven, permission-based, accountable AI Life
Agent.

A user should be able to explain an outcome in natural language. KAREN
should understand the request, retrieve relevant context, identify
missing details, make a plan, present choices, obtain appropriate
permission, execute supported actions, verify authoritative results,
monitor the consequences, and follow through until the responsibility is
resolved or explicitly handed back to the user.

The product is not simply a chatbot with a large collection of tools.

It is a system made up of:

A natural conversational interface.
A trusted personal context and memory layer.
An intent and planning layer.
A policy and authorization layer.
A durable task-execution engine.
A provider integration and computer-use layer.
A verification and reconciliation layer.
A proactive notification and responsibility layer.
A privacy, audit, and user-control layer.
KAREN's central promise: If KAREN accepts responsibility for a task,
it should track that task, communicate its status, verify the result,
and escalate honestly when it cannot complete it. It must never pretend
that an attempted action is a completed outcome.

1.2 What KAREN should learn from Instinct
Instinct is useful as a reference for:

Conversational task delegation.
Minimal-friction interaction.
Cross-service execution.
Browser/computer use.
Persistent personal context.
Proactive follow-up.
Messaging and voice as the primary interface.
A personal concierge positioning.
Instinct's public material and reporting also demonstrate why KAREN must
be designed carefully:

External websites and emails can contain malicious instructions.
Connected account data creates significant privacy obligations.
An agent can take an action that the user did not intend.
A website can block or change its automation flow.
A task can be partially completed while the assistant mistakenly
reports success.
A task can continue after the user has disconnected an integration
unless revocation is enforced across all cached data and active
workflows.
KAREN should adopt the useful product principles while setting a
stricter standard for permissions, accountability, privacy, and
verifiable completion.

1.3 KAREN's proposed differentiators
Differentiator Product meaning

Responsibility Engine Tasks are tracked through
completion, failure, cancellation,
or explicit handoff

Trusted personal memory KAREN remembers only useful,
permitted, correctly sourced
context

India-first execution Indian languages, time zones, local
service workflows, and payment
realities are considered from the
beginning

Approval-bound actions Important actions require precise,
user-visible approval

Verified outcomes The system distinguishes attempted,
submitted, accepted, confirmed, and
completed

Family assistance Users can delegate within explicit
family roles and permissions

Proactive intelligence Suggestions are useful,
explainable, configurable, and
non-intrusive

Provider-neutral architecture KAREN owns its orchestration and
policy; model and integration
vendors remain replaceable
2. Product vision, mission, and positioning
2.1 Vision
Become the trusted AI layer that helps people manage their personal
lives, responsibilities, and digital services through one natural
interface.

2.2 Mission
Reduce the mental load of everyday life by helping users understand what
needs attention, make better decisions, and complete tasks safely.

2.3 Positioning statement
KAREN is a personal AI Life Agent that understands your context, helps
you make decisions, and takes responsibility for approved tasks ---
from planning and reminders to connected services and real-world
follow-through.

2.4 Product principles
User intent before automation. Understand the outcome, not
merely the literal words.
Permission before consequence. The model cannot grant itself
authority.
Truth before confidence. Never claim a result without evidence.
Continuity before isolated chat. A task can continue across
messages and days.
Memory with user control. Remember useful context with
provenance and deletion controls.
Human judgment for high impact. Users remain in control of
financial, sensitive, and irreversible decisions.
Graceful failure. If KAREN cannot complete a task, it must
explain what happened and what remains.
Privacy by design. Collect and retain only what is necessary.
India-first, not India-only. Build localization and regional
policy into the domain model.
Measure real outcomes. Optimize verified task success and trust,
not message volume.
2.5 What KAREN is not
Not an unrestricted autonomous bot.
Not a replacement for banks, payment providers, airlines, hospitals,
or government systems.
Not a system that bypasses CAPTCHA, OTP, identity checks, provider
controls, or terms of service.
Not a financial adviser or legal/medical professional.
Not a product that promises every third-party website can be
automated.
Not a system that stores every conversation as permanent memory.
Not a system that silently sends messages, makes purchases, or
creates binding commitments.
3. Target users and initial market
3.1 Primary user segments
A. Busy professionals
Needs: - Email and calendar organization. - Meeting preparation and
follow-up. - Travel planning. - Reminders and deadlines. - Personal task
tracking.

B. Founders and operators
Needs: - High-volume communication management. - Scheduling and
coordination. - Follow-up tracking. - Research and decision support. -
Delegation of repetitive administrative tasks.

C. Families and caregivers
Needs: - Shared reminders. - Family scheduling. - Appointment
coordination. - Household errands. - Controlled delegation between
family members.

D. Students and early-career users
Needs: - Study plans. - Application and interview tracking. - Deadline
reminders. - Document organization. - Travel and everyday assistance.

E. Frequent travellers
Needs: - Itinerary management. - Booking comparisons. - Check-in
reminders. - Disruption monitoring. - Document and reservation
organization.

3.2 India-first requirements
KAREN should plan for:

Asia/Kolkata as a common default time zone, but always store
time-zone-aware timestamps.
INR formatting and Indian number conventions.
English and Hindi first, followed by carefully evaluated Hinglish
and additional Indian languages.
Indian addresses, landmarks, PIN codes, and location ambiguity.
UPI and Indian payment-provider rules, without ever collecting UPI
PINs or banking passwords.
WhatsApp Business Platform policies and template/consent
requirements.
Indian travel and service providers, subject to formal integration
approval.
Indian privacy and consumer protection obligations, reviewed by
qualified counsel.
Network variability and low-bandwidth mobile experiences.
Regional availability and language-specific speech evaluation.
Do not assume that a provider has a public API or permits automated
booking merely because its website is accessible.

3.3 Initial ideal customer profile
Start with users who: - Already use email and calendar heavily. - Have
recurring personal tasks. - Value time savings. - Are comfortable
connecting selected services. - Understand that some actions require
approval. - Can give structured feedback on task quality.

Avoid launching first to users who expect completely autonomous control
over all financial, legal, medical, or family decisions.

4. Product scope and feature map
The feature map below separates foundational features from higher-risk
capabilities.

Domain Capability Initial priority External
dependency

Identity Account, P0 Auth
session, infrastructure
recovery, MFA

Onboarding Profile, P0 None
language, time
zone, consent

Conversation Text chat, P0 Model gateway
streaming,
history

Memory Explicit facts P0 PostgreSQL /
and preferences pgvector

Responsibility Task state, P0 Temporal
Engine reminders,
approvals, audit

Goals Goal creation P1 None
and progress

Proactive Opt-in P1 Scheduler / event
intelligence suggestions and sources
reminders

Calendar Read, propose, P1 Calendar provider
create with
permission

Email Read, summarize, P1/P2 OAuth and provider
draft, approved review
send

Voice Speech P1 pilot LiveKit and audio
interaction model/provider

Family Members, roles, P2 Identity and
shared tasks policy

Travel Search, compare, P2 Contracted travel
book, monitor providers

Shopping Search, compare, P2 Merchant
cart, purchase integrations

Payments Payment P2, gated Licensed PSP /
initiation bank flow
through PSP

Refunds Track and P2, gated Provider/payment
reconcile refund partner
lifecycle

Concierge Business calls P3 Telephony and
and appointment legal review
requests

Browser/computer Controlled P3 Sandboxed workers
use fallback
execution
P0 means the minimum trustworthy foundation. It does not mean every
feature is production-ready.

5. Feature specifications --- end to end
5.1 Authentication, identity, and account security
User value
Users must be able to trust that their private context and connected
services are accessible only to the correct person.

Functional requirements
Account registration and sign-in.
Email and/or phone verification.
Secure session management.
Refresh-token rotation and revocation.
MFA or passkeys where supported.
Device and active-session management.
Account recovery with risk controls.
Account deletion and data export requests.
Login and security notifications.
Rate limiting and abuse detection.
End-to-end flow
User starts registration.
KAREN validates the identifier.
Verification challenge is sent through an approved provider.
User completes verification.
Account and profile are created.
User accepts required terms and privacy disclosures.
Session is issued with appropriate expiry.
User completes onboarding.
Sensitive actions may require step-up authentication.
User can inspect and revoke active sessions.
Acceptance criteria
No session is issued before verification where verification is
required.
Refresh tokens are rotated and replay is detected.
A revoked session cannot continue using protected APIs.
Account recovery cannot be used to bypass stronger authentication.
Sensitive events are audited without storing passwords, OTPs, or
secrets.
5.2 Onboarding and personal profile
User value
Capture enough context to make KAREN useful without creating a long,
exhausting setup process.

Profile fields
Display name.
Preferred language.
Time zone.
Home city or user-selected region.
Communication preferences.
Accessibility preferences.
Notification settings.
Optional personal preferences.
Consent and connected-service status.
Onboarding flow
Welcome and explain what KAREN can and cannot do.
Create or verify account.
Collect essential profile details.
Select language and time zone.
Explain memory and privacy controls.
Ask which capabilities the user wants to enable.
Request each integration permission separately.
Show a clear summary of connected accounts and permissions.
Start with a safe example task.
Let the user edit profile and consent later.
UX rules
Do not require every integration during onboarding.
Do not ask for sensitive details without a concrete feature need.
Explain why each permission is requested.
Allow users to skip optional setup.
Never treat onboarding consent as blanket authorization for future
payments or external messages.
5.3 Conversation and AI chat
User value
Provide a natural, reliable interface for questions, planning, task
delegation, and follow-up.

Core capabilities
Text messages.
Streaming assistant responses.
Conversation history.
Conversation titles and search.
Attachments where supported.
Context continuity.
Clarification questions.
Task cards and progress.
Approval cards.
Error and recovery messages.
User feedback.
Message types
USER_TEXT
USER_AUDIO
ASSISTANT_TEXT
ASSISTANT_PROGRESS
TASK_CREATED
TASK_STATUS
APPROVAL_REQUEST
APPROVAL_RESULT
TOOL_RESULT_SUMMARY
ERROR
SYSTEM_NOTICE
End-to-end flow
Client sends message with conversation ID and request ID.
API authenticates user and checks quotas.
Conversation service persists the message.
AI service classifies the request.
Context service retrieves only authorized relevant memories.
Agent decides whether to answer, clarify, or propose a task.
If it is a task, create a durable task record.
Stream response or progress to client.
Persist assistant output and references.
Update task status and conversation state.
Acceptance criteria
Duplicate client retries do not create duplicate messages or tasks.
Streaming disconnect does not lose the persisted request.
A conversation cannot be read by another user.
The assistant can distinguish a question from an instruction to act.
The assistant asks for missing critical fields rather than inventing
them.
5.4 Personal memory
User value
KAREN should remember useful preferences and context so the user does
not repeat the same information.

Memory types
Type Example Default handling

Explicit profile Preferred language Retain while profile is
active

Preference Likes morning meetings Retain with user
control

Relationship "Rahul is my colleague" Store only if useful
and appropriate

Episodic Previous trip details Retention-limited

Task context Pending booking Keep until resolved
plus policy-based
retention

Inferred pattern Often schedules Do not silently promote
meetings after lunch to confirmed fact
Memory lifecycle
Extract a memory candidate from an interaction or authorized source.
Identify its source and confidence.
Classify sensitivity.
Apply consent and retention policy.
Ask the user to confirm uncertain or consequential memories.
Store with provenance and timestamps.
Retrieve only when relevant to a new request.
Allow correction, expiry, and deletion.
Propagate deletion to derived indexes and caches.
Non-negotiable rules
Memory must be user-scoped.
External email and website instructions are not trusted memory
instructions.
Inferences must not be presented as user-confirmed facts.
Sensitive information must not be retained by default.
A disconnected provider must not continue supplying fresh data.
Deletion must cover primary storage, vector indexes, caches, derived
summaries, and applicable backups under the documented retention
policy.
5.5 Goals and life planning
User value
Help users turn broad intentions into measurable goals and manageable
next steps.

Capabilities
Create a goal.
Define a target and deadline.
Break goal into milestones.
Create tasks.
Track progress.
Identify blockers.
Suggest adjustments.
Review progress periodically.
Pause, archive, or delete goals.
Example
User: "I want to prepare for a full-stack engineering interview in six
weeks."

KAREN: 1. Clarifies available time and focus areas. 2. Creates a goal.
3. Suggests milestones. 4. Builds a weekly plan. 5. Adds tasks and
reminders. 6. Tracks completion. 7. Reviews progress. 8. Suggests
adjustments when the user falls behind.

Guardrails
Suggestions are not commitments until accepted.
Do not shame users for missed goals.
Avoid creating too many reminders.
Let users pause or change the plan.
Do not infer health or psychological conditions from productivity
behavior.
5.6 Responsibility Engine
Product importance
This is a core KAREN differentiator. It converts an AI suggestion or
user instruction into a durable, accountable task lifecycle.

Responsibility object
A responsibility is more than a reminder. It has: - A desired outcome. -
An owner. - A due date or condition. - A plan. - Current state. -
Required approvals. - External dependencies. - Evidence of completion. -
Follow-up rules. - Escalation path.

Responsibility states
CREATED
  -> UNDERSTANDING
  -> NEEDS_CLARIFICATION
  -> PLANNED
  -> AWAITING_APPROVAL
  -> READY
  -> IN_PROGRESS
  -> WAITING_ON_EXTERNAL
  -> VERIFYING
  -> COMPLETED

Alternative terminal or recovery states:
PARTIALLY_COMPLETED
FAILED
CANCELLED
EXPIRED
HANDED_OFF
Lifecycle
User asks KAREN to do something.
KAREN extracts the desired outcome and constraints.
It asks for missing information.
It creates a responsibility record.
It proposes a plan with steps.
Policy engine evaluates permissions and risk.
User approves the exact action when required.
Temporal executes the durable workflow.
Provider adapters execute external operations.
Verification checks authoritative provider state.
Responsibility is marked completed only with evidence.
If a dependency fails, the workflow retries safely or waits.
If human intervention is needed, KAREN explains exactly what
remains.
User can inspect, pause, cancel, or resume the responsibility.
Acceptance criteria
Every accepted task has a durable ID and status.
Every external side effect has a traceable action record.
No high-impact action runs without valid approval.
Approval is bound to exact parameters and expires.
Duplicate webhook delivery does not duplicate side effects.
Task state survives worker restart.
Completion requires evidence.
Partial completion is represented honestly.
5.7 Reminders and notifications
Capabilities
One-time reminders.
Recurring reminders.
Deadline reminders.
Task-status notifications.
Quiet hours.
Channel preferences.
Snooze and dismiss.
Escalation for explicitly configured tasks.
Flow
User requests reminder or accepts a suggested reminder.
KAREN resolves time zone and recurrence.
Reminder is stored durably.
Scheduler triggers delivery.
Notification service selects permitted channel.
Delivery provider returns status.
KAREN records success or failure.
User can snooze, edit, or dismiss.
Rules
Never assume local time when the date/time is ambiguous.
Store UTC timestamps plus original time zone and user-facing intent.
Prevent duplicate notification delivery.
Respect quiet hours except for user-defined critical alerts.
Do not send proactive messages without consent.
5.8 Proactive intelligence and life-pattern detection
User value
KAREN should identify useful opportunities to help, but must not become
intrusive or overconfident.

Proactive categories
Upcoming deadlines.
Incomplete accepted tasks.
Calendar conflicts.
Travel disruptions.
Repeatedly postponed tasks.
A user-configured recurring activity.
A relevant price or availability change, where a trusted source
exists.
Proactive decision pipeline
An authorized event or scheduled check occurs.
Candidate insight is generated.
Policy checks consent, relevance, sensitivity, and notification
settings.
Evidence and freshness are evaluated.
A confidence threshold is applied.
KAREN either suppresses, queues, or sends a suggestion.
User can accept, dismiss, correct, or disable similar suggestions.
Feedback updates future relevance ranking within consent limits.
Requirements
Every suggestion should explain why it appeared.
Distinguish facts from predictions.
Never claim that a user has a pattern based on insufficient data.
Avoid sensitive inference.
Provide per-category controls.
Measure useful suggestion rate, not just notification open rate.
5.9 Email assistant
Initial capabilities
Connect supported email account through OAuth.
Read authorized messages.
Search and summarize.
Extract action items and deadlines.
Draft responses.
Prepare follow-up reminders.
Send only after action-specific authorization.
Track send result.
End-to-end send flow
User asks to reply.
KAREN identifies the source thread.
It drafts a response.
It shows recipient, subject, body, attachments, and account.
User approves the exact draft.
Backend verifies approval, current permission, and recipient.
Provider adapter sends message.
Provider response is stored.
KAREN verifies sent state where available.
User receives confirmation.
Security
Treat email body and attachments as untrusted content.
Do not follow instructions embedded in email that conflict with user
intent or policy.
Never forward private data because an email requested it.
Use narrow OAuth scopes.
Revoke access and stop active jobs when integration is disconnected.
Avoid retaining full mailbox content unnecessarily.
5.10 Calendar and scheduling
Capabilities
Read calendar availability.
Summarize schedule.
Detect conflicts.
Suggest times.
Create and update events with permission.
Add attendees.
Set reminders.
Cancel events with confirmation.
Track event changes.
End-to-end event creation
Extract title, attendees, duration, date, and time.
Resolve time zone.
Read free/busy data.
Present available slots.
User selects a slot.
Show final invite details.
Obtain required approval.
Create event.
Verify provider event ID and status.
Notify user.
5.11 Voice assistant
Capabilities
Voice input.
Speech transcription.
Natural spoken response.
Interruptions and turn-taking.
Voice-to-task creation.
Voice task status.
Language and accent support.
Optional transcript and summary.
Architecture
Mobile client captures audio with user permission.
LiveKit manages realtime transport/session where selected.
Voice worker coordinates audio input/output.
KAREN AI service handles intent, context, and tool planning.
Model/audio provider is selected only after end-to-end latency,
language, privacy, and SDK compatibility testing.
Task execution remains in the same permissioned Responsibility
Engine.
Voice safety
Read back critical values such as dates, amounts, recipients, and
locations.
Do not interpret background speech as approval.
Require explicit confirmation for financial and irreversible
actions.
Provide a visible way to mute, stop, and end the session.
Test Hindi, English, Hinglish, accents, noisy environments, and
numbers/currency.
5.12 Family assistance and delegated access
Purpose
Allow a user to coordinate selected responsibilities with family members
without creating uncontrolled access to everyone's private data.

Concepts
Family group.
Member identity.
Role.
Shared responsibility.
Delegation.
Consent.
Visibility scope.
Approval authority.
Revocation.
Example
A user delegates an appointment reminder to a family member.

KAREN must: 1. Confirm the family relationship/group membership. 2.
Check whether the user can share the relevant details. 3. Create a
scoped delegated responsibility. 4. Notify the selected member. 5. Track
acknowledgement and progress. 6. Escalate only according to configured
rules. 7. Revoke access when delegation ends.

Rules
Family membership does not grant blanket access.
A member sees only explicitly shared tasks and information.
Financial actions require the correct account holder's
authorization.
Delegation must be revocable and auditable.
Avoid exposing health, financial, or private messages to other
family members by default.
5.13 Travel assistant
Capabilities, subject to approved providers
Search travel options.
Compare itineraries.
Explain baggage and cancellation rules.
Save travel preferences.
Prepare bookings.
Book after explicit approval.
Store itinerary and confirmation.
Track status and disruption updates.
Assist with check-in where provider permits.
Initiate cancellation/refund request where supported.
Reconcile final status.
Booking lifecycle
REQUESTED
-> SEARCHING
-> OPTIONS_READY
-> USER_SELECTED
-> QUOTE_REVALIDATION
-> AWAITING_APPROVAL
-> BOOKING_SUBMITTED
-> PROVIDER_PENDING
-> CONFIRMED | FAILED | UNKNOWN
-> POST_BOOKING_MONITORING
-> COMPLETED / CANCELLED / REFUND_PENDING / REFUNDED
UNKNOWN is important. If the provider times out after receiving a
request, KAREN must reconcile provider state before retrying.

India-specific caveats
Provider access and commercial contracts must be validated.
IRCTC and other regulated or restricted booking flows must use
authorized channels.
Do not bypass CAPTCHA, OTP, queueing, or identity checks.
Never claim a ticket is booked until an authoritative confirmation
exists.
5.14 Shopping and grocery assistant
Capabilities
Product discovery.
Price and feature comparison.
Availability check.
Cart preparation.
Substitution suggestions.
Delivery option comparison.
Purchase approval.
Order tracking.
Return/refund follow-up where supported.
Purchase flow
Understand the product and constraints.
Search permitted merchants.
Compare product facts and source freshness.
Present recommendations and trade-offs.
User selects.
Revalidate item, merchant, stock, delivery, taxes, and total.
Obtain exact approval.
Place order through authorized provider.
Verify order ID and state.
Track delivery or exceptions.
5.15 Payments and refunds
Product boundary
KAREN should coordinate with regulated payment providers. It should not
become a bank, store UPI PINs, ask for CVV in chat, or bypass payment
authentication.

Payment initiation flow
User requests a payment or purchase.
KAREN identifies merchant, amount, currency, and purpose.
Backend validates the provider and transaction limits.
KAREN displays exact transaction details.
User approves.
Payment provider's secure SDK/redirect/intent flow is launched.
User completes provider authentication.
Signed webhook and provider status are verified.
Internal ledger records the result.
KAREN reports success only after authoritative confirmation.
Refund lifecycle
REFUND_REQUESTED
-> ELIGIBILITY_CHECK
-> USER_APPROVAL (if needed)
-> PROVIDER_REQUESTED
-> PROVIDER_PENDING
-> REFUND_CONFIRMED | REFUND_REJECTED | UNKNOWN
-> RECONCILED
-> USER_NOTIFIED
Non-negotiable safeguards
Never store UPI PIN, card CVV, bank password, or OTP in KAREN.
Verify signed webhooks.
Reconcile ambiguous provider responses.
Prevent duplicate payment/refund requests.
Keep a transaction ledger separate from chat history.
Display fees, cancellation rules, and refund estimates.
Escalate disputes to provider/human support.
5.16 Concierge and real-world calls
This is a later-stage feature.

Potential uses: - Call a business to ask about availability. - Request
opening hours or service details. - Ask about an appointment. - Confirm
an existing reservation.

Requirements: - Legal review of call recording and AI disclosure. -
Clear identification where required. - Approved telephony provider. -
Call purpose and script constrained by user instruction. - No deceptive
impersonation. - No commitment beyond granted authority. - Call result
stored as a summary with source and timestamp. - Booking confirmation
must still be independently verified.

5.17 Browser/computer use
Browser/computer use should be a controlled fallback for workflows that
are permitted but lack an adequate API.

Requirements: - Isolated ephemeral worker. - No unrestricted shell or
filesystem access. - Per-task credentials and least privilege. - Domain
and action allowlists. - Screenshot/action traces with sensitive data
redaction. - Prompt-injection defenses. - Explicit approval for
consequential actions. - No CAPTCHA/OTP bypass. - Safe shutdown and
credential cleanup. - Verification against authoritative provider state.

6. Cross-feature end-to-end journeys
6.1 "Plan my day"
User asks for today's plan.
KAREN retrieves calendar events and accepted tasks.
It identifies deadlines and conflicts.
It ranks tasks using user-defined priorities.
It proposes a schedule.
User edits or accepts.
KAREN creates approved reminders or calendar blocks.
Responsibility Engine tracks progress.
KAREN provides a concise end-of-day review.
Success: A useful plan with accurate source data and no unauthorized
calendar changes.

6.2 "Handle this email"
User shares or selects an email.
KAREN summarizes it and identifies the requested outcome.
It extracts dates, names, and commitments.
It proposes a reply or follow-up.
User reviews the exact content.
Backend checks approval and current email scope.
Provider sends the email.
Provider state is verified.
KAREN tracks any resulting commitment.
Success: Correct recipient and content, authorized send, and
traceable result.

6.3 "Arrange my trip"
Collect destination and date.
Retrieve relevant preferences.
Search approved provider(s).
Compare options and constraints.
User selects.
Revalidate quote and availability.
Show full cost and terms.
Obtain action-specific approval.
Submit booking.
Reconcile provider result.
Store itinerary and confirmation.
Monitor only with user consent.
Notify about changes and next steps.
Success: Provider-confirmed booking and accurate itinerary.

6.4 "Help my family"
User chooses a family member.
KAREN checks membership and permissions.
User selects information/task to share.
KAREN creates scoped delegation.
Member receives a notification.
Member accepts or declines.
Responsibility Engine tracks the task.
User receives status updates within the permitted visibility scope.
Success: The right person receives only the authorized information
and can complete the delegated responsibility.

7. Technical architecture investigation
7.1 Architecture principle
Preserve KAREN Architecture v2.0. Do not introduce a new stack merely
because Instinct uses a different internal implementation.

Use a hybrid modular architecture: - Interactive plane for chat,
retrieval, and low-latency model responses. - Durable action plane for
tasks, approvals, external side effects, and reconciliation. -
Background plane for reminders, provider events, memory processing, and
proactive intelligence.

7.2 High-level topology
7.3 Deployables
Start with the existing repository's planned deployables, not a large
microservice explosion:

Mobile application.
Web application.
Admin application.
NestJS API / BFF and core business domains.
Python AI service.
Temporal worker(s).
Provider connector worker(s).
Voice worker when voice is ready.
Notification/background worker where separation is operationally
useful.
Some workers can share a deployable initially while retaining separate
queues, permissions, and runtime configuration.

7.4 Technology responsibilities
Technology KAREN responsibility

React Native / Expo iOS and Android client

Next.js Web app and admin

NestJS / Fastify Authentication, profiles,
conversation API, task APIs,
permissions

Python / FastAPI AI reasoning, retrieval,
evaluations, model routing

LangGraph Bounded agent state graph and
controlled tool proposal

Vercel AI Gateway Primary supported model inference
and provider routing

Temporal Durable execution, timers,
approvals, retries, workflow
recovery

PostgreSQL Source of truth for users, tasks,
permissions, approvals, audit
metadata

pgvector Initial semantic retrieval

Redis Ephemeral cache, rate limits,
short-lived coordination

S3 Private files, audio, documents,
evidence artifacts

SQS/EventBridge Event fan-out and background
processing

LiveKit Voice transport/session layer

AWS ECS/Fargate Initial container hosting

Terraform Infrastructure as code

OpenTelemetry Distributed traces and metrics

Langfuse AI tracing and evaluation workflows

Sentry Client and application error
monitoring
7.5 Model routing
The KAREN Model Router must be an application policy layer, not a second
paid gateway.

Suggested route types:

NO_MODEL: deterministic operations.
ECONOMY: classification and extraction.
BALANCED: regular chat and summaries.
REASONING: complex planning.
VISION: image/document interpretation.
EMBEDDING: semantic memory.
AUDIO: transcription, speech, or realtime tasks where
compatibility is validated.
Model IDs must be pinned from the live Vercel AI Gateway catalog and
tested. Do not assume an OpenAI-compatible endpoint supports every
model's tool, vision, structured output, audio, or realtime features.

7.6 Why Temporal is important
A personal agent must survive: - Worker restarts. - Network timeouts. -
Provider outages. - User approval waits. - Multi-hour or multi-day
external processes. - Duplicate webhooks. - Delayed confirmation. -
Refund waiting periods.

Temporal should orchestrate durable business workflows. External I/O and
nondeterministic operations should execute in Activities, while workflow
code controls state and progression.

Official reference: https://docs.temporal.io/durable-execution

8. Data architecture and core entities
PostgreSQL remains the source of truth. Vector search must never become
the authority for permissions, money, bookings, or task status.

8.1 Core entity map
8.2 Proposed tables
Identity and consent
users
user_profiles
user_devices
user_sessions
auth_events
consent_records
privacy_requests
Conversation and AI
conversations
messages
message_attachments
model_requests
model_usage_records
agent_runs
agent_tool_proposals
Memory and goals
memories
memory_embeddings
memory_access_events
goals
goal_milestones
goal_progress_events
Responsibility Engine
tasks
task_steps
task_dependencies
task_events
task_schedules
approvals
approval_events
action_records
action_evidence
reconciliation_records
Integrations
connected_accounts
integration_permissions
provider_capabilities
provider_operations
provider_webhook_events
provider_sync_cursors
Family and delegation
family_groups
family_memberships
delegations
shared_resources
delegation_events
Payments and refunds
payment_intents
payment_transactions
refund_requests
financial_ledger_entries
provider_reconciliation_items
Platform operations
notifications
notification_deliveries
audit_events
feature_flags
rate_limit_buckets where persistence is appropriate
support_cases
8.3 Data ownership rules
users and consent are authoritative for identity and permissions.
tasks and task_events are authoritative for Responsibility
Engine state.
approvals are authoritative for user authorization.
action_records and provider reconciliation are authoritative for
external side effects.
payment_transactions and provider records are authoritative for
payment status.
memories are contextual data, never authoritative for account
permissions.
Chat text is not the source of truth for a booking, payment, or
refund.
8.4 Multi-tenant and isolation controls
Even if KAREN launches as a consumer product, design data isolation
explicitly:

Every user-owned row has a user/tenant scope.
Enforce ownership in backend queries.
Add PostgreSQL Row-Level Security where suitable and test it.
Do not trust a client-supplied user ID.
Background workers must carry a verified actor/tenant context.
Vector queries must filter by user before ranking.
Object storage keys must be scoped and access-controlled.
Admin access must be audited and least-privilege.
9. API design and event contracts
All endpoints below are proposed contracts. They should be finalized in
OpenAPI and shared schemas before implementation.

9.1 Authentication and profile
POST   /v1/auth/register
POST   /v1/auth/verify
POST   /v1/auth/login
POST   /v1/auth/refresh
POST   /v1/auth/logout
GET    /v1/me
PATCH  /v1/me
GET    /v1/me/sessions
DELETE /v1/me/sessions/:sessionId
GET    /v1/me/consents
POST   /v1/me/consents
DELETE /v1/me/consents/:consentId
POST   /v1/me/privacy/export
POST   /v1/me/privacy/delete
9.2 Conversation
POST   /v1/conversations
GET    /v1/conversations
GET    /v1/conversations/:conversationId
DELETE /v1/conversations/:conversationId
POST   /v1/conversations/:conversationId/messages
GET    /v1/conversations/:conversationId/messages
Streaming should use SSE or WebSocket according to the client and
infrastructure requirements. Each request needs an idempotency/request
ID.

9.3 Memory
GET    /v1/memories
POST   /v1/memories
PATCH  /v1/memories/:memoryId
DELETE /v1/memories/:memoryId
POST   /v1/memories/:memoryId/confirm
POST   /v1/memories/:memoryId/forget
9.4 Goals and responsibilities
GET    /v1/goals
POST   /v1/goals
GET    /v1/goals/:goalId
PATCH  /v1/goals/:goalId
POST   /v1/goals/:goalId/milestones

GET    /v1/tasks
POST   /v1/tasks
GET    /v1/tasks/:taskId
POST   /v1/tasks/:taskId/approve
POST   /v1/tasks/:taskId/reject
POST   /v1/tasks/:taskId/cancel
POST   /v1/tasks/:taskId/resume
GET    /v1/tasks/:taskId/events
9.5 Integrations
GET    /v1/integrations/catalog
GET    /v1/integrations/connections
POST   /v1/integrations/:provider/connect
GET    /v1/integrations/:provider/callback
GET    /v1/integrations/:connectionId/permissions
PATCH  /v1/integrations/:connectionId/permissions
DELETE /v1/integrations/:connectionId
POST   /v1/webhooks/:provider
Webhook signatures must be verified before processing. Events must be
idempotent.

9.6 Payments and refunds
POST   /v1/payment-intents
GET    /v1/payment-intents/:paymentIntentId
POST   /v1/payment-intents/:paymentIntentId/approve
POST   /v1/refunds
GET    /v1/refunds/:refundId
GET    /v1/transactions
Do not expose provider secrets or trust client-supplied payment status.
The provider is authoritative for its transaction.

9.7 Standard response and error shape
Use a consistent envelope, with trace identifiers and safe error codes.
Avoid returning raw provider errors, stack traces, tokens, or sensitive
model context.

Example:

{
  "success": true,
  "data": {
    "taskId": "task_...",
    "status": "AWAITING_APPROVAL"
  },
  "meta": {
    "requestId": "req_...",
    "traceId": "trace_..."
  }
}
9.8 Domain events
Examples:

user.created
consent.granted
consent.revoked
integration.connected
integration.disconnected
conversation.message.created
memory.created
memory.deleted
goal.created
task.created
task.approval.requested
task.approval.granted
task.approval.rejected
task.execution.started
task.step.completed
provider.operation.accepted
provider.operation.failed
provider.webhook.received
task.verification.completed
task.completed
task.escalated
notification.delivery.failed
payment.confirmed
refund.confirmed
Use a transactional outbox so database state and event publication
cannot silently diverge.

10. Authorization and action policy
10.1 Separate proposal from permission
The LLM may propose:

{
  "tool": "calendar.create_event",
  "arguments": {
    "title": "Project review",
    "start": "2026-12-01T10:00:00+05:30",
    "durationMinutes": 60
  }
}
The LLM does not decide whether this action is allowed. Backend policy
independently checks: - Authenticated actor. - Ownership of the target
account. - Connected provider. - Granted scopes. - User's current
consent. - Action risk. - Exact parameters. - Approval status. - Expiry
and replay status. - Rate and financial limits.

10.2 Approval must bind to the exact action
An approval record should contain:

approval_id
user_id
task_id
action_id
tool_name
provider
target_resource
normalized_parameters_hash
displayed_summary
amount and currency, where relevant
created_at
expires_at
decision
decided_at
consumed_at
actor_session_id
If recipient, amount, date, target, or other material parameters change,
the old approval is invalid.

Approval must be consumed atomically immediately before the action
executes. A client-supplied approved: true flag is never sufficient.

10.3 Risk classification
Risk Examples Default policy

Low Public search, Automatic within
summarization, draft granted read scope
creation

Medium Create a non-binding Policy-based; notify or
reminder or calendar confirm
hold

High Send an external email, Explicit
create a reservation action-specific
approval

Critical Payment, non-refundable Strong confirmation and
purchase, irreversible step-up authentication
deletion, legal where appropriate
commitment
Unknown or unclassified actions must fail closed.

11. Security and privacy threat model
11.1 Threats
Account takeover.
OAuth token theft.
Cross-user data leakage.
Prompt injection through email, documents, websites, or tool output.
Memory poisoning.
Unauthorized tool execution.
Approval replay or parameter substitution.
Duplicate payments or bookings.
Secret leakage through logs or model prompts.
Malicious or compromised provider webhook.
Browser sandbox escape.
Excessive model or tool loops causing cost abuse.
Admin misuse.
Data retained after integration disconnection or deletion request.
11.2 Required controls
OIDC/passkeys/MFA where appropriate.
Short-lived sessions and refresh-token rotation.
KMS-backed encryption and secrets management.
Narrow OAuth scopes.
Tenant and user isolation.
PostgreSQL RLS where appropriate.
Server-side tool authorization.
Action-bound approvals.
Atomic approval consumption.
Idempotency keys.
Signed webhook verification.
Prompt-injection defense in depth.
Sandboxed browser workers.
Redacted structured logs.
Data retention and deletion workflows.
Rate, token, cost, and recursion limits.
Audit trail for sensitive actions.
Incident response and security testing.
11.3 External content is untrusted
Emails, websites, uploaded documents, search results, and provider
responses can contain instructions. They must be treated as data, not as
trusted instructions.

A webpage cannot grant itself permission to send an email. An email
cannot authorize a payment. A document cannot override the user's
preferences or system policy.

11.4 Data lifecycle
For every data category, document: - Why it is collected. - Which
service processes it. - Whether it is sent to a model provider. - Where
it is stored. - How long it is retained. - Who can access it. - How it
is exported. - How it is deleted. - What remains in backups and for how
long.

Review India's Digital Personal Data Protection requirements and all
applicable rules with qualified counsel before launch. Global expansion
requires additional regional analysis.

12. Observability, evaluation, and product analytics
12.1 Correlation IDs
Carry these identifiers through the entire system:

user_id (internal, never expose unnecessarily)
conversation_id
message_id
request_id
trace_id
agent_run_id
task_id
approval_id
action_id
provider_operation_id
provider_reference (masked where appropriate)
12.2 Product metrics
Metric Definition

Task acceptance rate Accepted proposals / proposals
shown

Verified task success Provider-verified successful tasks
/ attempted tasks

Partial completion rate Tasks with at least one completed
step but incomplete goal

Human intervention rate Tasks requiring manual
user/provider help

Approval rejection rate Rejected approvals / approval
requests

Duplicate side-effect rate Duplicate external operations

Recovery rate Failed/transient tasks safely
recovered

User trust score User feedback after task completion

Useful proactive rate Proactive suggestions accepted or
rated useful

Memory correction rate Memories users correct or delete

Cost per verified task Model + infrastructure + provider
cost for completed outcome

p95 task latency Time from accepted request to
verified result
Do not optimize solely for autonomous completion. A safe request for
clarification is better than an incorrect action.

12.3 AI evaluation suite
Create a versioned dataset covering: - Intent classification. - Date and
time extraction. - Currency and amount extraction. - Recipient and
entity resolution. - Tool selection. - Planning quality. - Memory
retrieval relevance. - Permission denial. - Prompt injection. - Approval
binding. - Factual grounding. - Provider timeout. - Duplicate webhook. -
Partial completion. - Cancellation. - Multilingual voice recognition.

Every change to prompts, tools, model routes, memory retrieval, or
policy must run regression tests.

13. Reliability and failure recovery
13.1 External action ambiguity
A timeout does not mean the provider failed. It may mean the provider
accepted the action but the response was lost.

For payment, booking, email, and refund operations: 1. Persist operation
intent. 2. Use provider idempotency if available. 3. Submit once. 4. If
response is ambiguous, query provider status. 5. Reconcile webhook and
polling results. 6. Retry only if safe. 7. Escalate unresolved
ambiguity. 8. Do not tell the user the action succeeded until verified.

13.2 Saga and compensation
Multi-provider workflows are not one atomic database transaction. Use
explicit compensation where possible.

Example: - Hold inventory. - Create booking. - Confirm payment. - If
booking fails after payment, initiate refund or release. - Track refund
separately until provider confirmation.

Compensation is not always a true reversal. The user must be informed
when a step cannot be undone automatically.

13.3 Operational runbooks
Prepare runbooks for: - Model gateway outage. - Model budget
exhaustion. - Temporal outage. - PostgreSQL failover. - Redis outage. -
OAuth provider outage. - Payment provider timeout. - Duplicate
webhook. - Booking state mismatch. - Voice provider degradation. - Data
deletion failure. - Suspected prompt injection. - Account compromise. -
Cross-tenant data incident.

14. UX and interaction design requirements
14.1 Primary navigation
A proposed mobile structure:

Home --- overview, important tasks, quick actions.
Chat --- conversational interface.
Responsibilities --- task list, status, deadlines, approvals.
Goals --- longer-term plans and progress.
Profile --- memory, integrations, privacy, settings.
The exact navigation should be validated with user research before
finalizing.

14.2 Task card
Every delegated task should show: - Task title. - Desired outcome. -
Current state. - Next step. - Due date or expected wait. - Whether KAREN
is waiting for the user. - Approval status. - Evidence or source. -
Cancel/pause/resume actions where supported.

14.3 Approval card
Show: - Action in plain language. - Exact target. - Exact date/time. -
Exact amount/currency, if relevant. - Provider. - Cancellation/refund
terms. - Data to be shared. - Why approval is required. - Approve and
reject controls. - Expiry.

Avoid vague buttons such as "Continue" for a payment or external
commitment.

14.4 Trust center
A dedicated area should let users see: - Connected services. -
Permissions and scopes. - Active tasks. - Pending approvals. - Memory
entries. - Data retention settings. - Export/delete controls. - Recent
sensitive actions. - Security events and active sessions.

14.5 Communication tone
Clear and concise.
Natural, not robotic.
Transparent about uncertainty.
No false confidence.
No exaggerated promises.
No unnecessary progress spam.
Explain blockers and next steps.
15. Product roadmap and stage gates
This roadmap is for planning. It does not grant permission to start
implementation.

Stage 0 --- Governance and entry conditions
Close or formally disposition Phase 01 review findings.
Obtain written approval for the next implementation phase.
Verify the six Phase 02 entry conditions from the current review
artifact.
Confirm security and data ownership decisions.
Confirm repository and CI status.
Validate initial provider access and sandbox availability.
Freeze the initial P0 scope.
Gate: Written approval and all required entry conditions satisfied.

Stage 1 --- Trusted core
Build: - Authentication and onboarding. - Consent and privacy
controls. - Conversation and streaming. - Basic profile. - Explicit
memory CRUD. - Task and Responsibility Engine foundation. - Durable task
execution. - Approval records and audit trail. - Cost and model usage
tracking.

Gate: No acknowledged task is silently lost; task state and
approvals survive worker restart; cross-user isolation tests pass.

Stage 2 --- Useful personal assistant
Build: - Read-only email/calendar integrations after provider
approval. - Summaries and action-item extraction. - Draft creation. -
Goals and reminders. - Proactive suggestions with opt-in controls. -
Hindi/English interaction quality.

Gate: Retrieval quality, permission correctness, deletion/revocation
behavior, and user usefulness meet defined thresholds.

Stage 3 --- Controlled external actions
Build: - Approved calendar writes. - Approved email send. - One selected
transactional provider integration. - Quote/approval/revalidation. -
Provider webhooks and reconciliation. - Human escalation.

Gate: No duplicate external side effects in fault-injection tests;
provider-confirmed outcomes; security review complete.

Stage 4 --- Voice and family
Build: - Voice pilot and evaluation. - Family group and delegated
tasks. - Scoped sharing. - Member approval and revocation. -
Notification channels.

Gate: Voice task extraction meets language-specific targets; family
permission tests pass.

Stage 5 --- Expanded ecosystem
Build only after evidence: - Additional travel providers. - Shopping and
grocery. - Payment and refund workflows. - Concierge calls. -
Browser/computer-use workers. - Additional languages and countries.

Gate: Each new provider passes legal, security, commercial, sandbox,
reconciliation, and support readiness.

16. MVP definition --- what should actually be built first
The first release should not attempt to reproduce every Instinct
feature.

16.1 Recommended MVP
A user can: 1. Create a secure account. 2. Complete short onboarding. 3.
Chat with KAREN. 4. Receive streamed AI responses. 5. Save, review,
edit, and delete explicit memories. 6. Create goals. 7. Convert requests
into tracked responsibilities. 8. Receive reminders. 9. Approve or
reject proposed actions. 10. View task history and status. 11. See why a
task is waiting or blocked. 12. Export or delete their data through
defined workflows.

16.2 Explicitly out of MVP
Autonomous payments.
Unrestricted browser access.
Arbitrary email sending.
Universal website automation.
Unverified travel booking.
Automated refund execution.
Family access to private information.
Always-on device monitoring.
Unbounded proactive notifications.
These features can be introduced later after their provider, legal,
safety, and operational requirements are satisfied.

16.3 MVP acceptance criteria
Authentication and session tests pass.
Every user-owned query is correctly scoped.
Chat messages persist and stream reliably.
Model usage and cost are attributable.
Memory has provenance and deletion.
Tasks have durable state.
Approval cannot be replayed or modified.
Worker restart does not lose task state.
Reminder delivery is idempotent.
Audit logs contain no secrets.
Prompt-injection regression suite passes.
User can pause/cancel tasks.
User can disconnect integrations and revoke access.
No production claim is made before the release gates pass.
17. Build-vs-buy decisions
Capability Recommendation Reason

Frontier foundation Buy through Vercel AI Do not train a frontier
model Gateway model

Agent orchestration Build KAREN domain Product-specific
logic logic using LangGraph policies and context

Durable workflows Use Temporal Recovery, timers,
approvals, retries

Identity Use a proven identity Authentication is
foundation or security-critical
rigorously implemented
custom system

Payments Integrate licensed Do not handle raw
PSP/bank SDKs banking credentials

Voice transport Use LiveKit where Realtime media
validated infrastructure is
specialized

Memory domain Build KAREN memory and Core product
consent model differentiation

Vector database Start with pgvector Avoid premature
infrastructure

Browser execution Use isolated, High-risk capability
controlled workers

Observability Use OpenTelemetry plus Avoid building a
established tools proprietary telemetry
stack

Notifications Use platform/provider Delivery channels vary
services behind KAREN
abstraction

Admin/support tooling Build only required Internal accountability
operational controls
18. Cost and scaling model
Do not estimate cost from registered user count alone.

Track: - Active users. - Messages per user. - Model calls per task. -
Input/output tokens. - Model tier distribution. - Tool calls. - Browser
session duration. - Voice concurrency and duration. - Background
polling. - Storage and retrieval. - Provider fees. - Human
support/escalation.

18.1 Cost per verified task
A useful metric:

Total cost per verified task = (model + compute + storage + provider + notification + support costs) / verified completed tasks

18.2 Cost controls
No-model path for deterministic operations.
Small model for simple extraction.
Bounded context and token budgets.
Per-user and per-plan limits.
Task deadlines and tool-call limits.
Browser session timeouts.
Voice session limits.
Gateway budgets and alerts.
Per-provider rate limits.
Circuit breakers.
Cost attribution by feature and task.
A model call that is cheap per token may still create an expensive task
if it triggers many retries or browser interactions.

19. Competitive positioning and differentiation
KAREN should not compete by claiming that it is "more autonomous" or
"does everything."

A stronger promise is:

KAREN is the personal agent that keeps track of what matters, acts
only with the right permission, verifies what happened, and follows
through.

Dimension Instinct reference KAREN direction

Conversational Core product concept Adopt
delegation

Messaging/voice access Important interaction Adopt with India-first
model localization

Browser/computer use Broadens service Controlled later-stage
coverage fallback

Persistent context Personal assistant Explicit memory,
proposition consent, provenance

Proactive help Important proposition Opt-in and
relevance-scored

Task accountability Agent execution Make Responsibility
Engine a central
differentiator

Family assistance Not the primary Dedicated permissioned
positioning domain

India-first UX Not the core public Core market strategy
positioning

Approval and Essential agent safety Strict backend-enforced
verification controls

Privacy transparency Publicly debated and Trust center and clear
documented data lifecycle
20. Key risks and mitigation plan
Risk Severity Mitigation

Prompt injection Critical Untrusted-content
boundaries, tool
policy, adversarial
tests

Unauthorized external Critical Backend policy and
action action-bound approval

Duplicate Critical Idempotency, provider
payment/booking reconciliation,
transaction ledger

Cross-user data leakage Critical Tenant isolation, RLS,
authorization tests

Stale memory High Provenance, timestamps,
expiry, user correction

Provider integration High Capability registry,
unavailable sandbox proof, phased
rollout

Browser automation High Official API first,
blocked fallback and escalation

Model hallucination High Evidence, structured
output, verification

Runaway agent cost High Budgets, recursion
limits, tool-call caps

User notification Medium Preferences, quiet
fatigue hours, relevance
scoring

Voice misunderstanding High Read-back of critical
values and
language-specific
evaluation

Deletion incomplete Critical Data inventory,
deletion orchestration,
index/cache cleanup

Operational failure High Durable workflows,
runbooks, incident
response
21. Research and validation tasks before implementation
The following are unresolved questions that require evidence.

Product validation
Which three daily tasks are most valuable to the first target users?
Which tasks are frequent enough to drive retention?
What is the acceptable approval friction?
Do users prefer chat, WhatsApp, voice, or a mix?
Which proactive notifications are genuinely useful?
What should KAREN never do autonomously?
Integration validation
For each proposed provider, document: - Official API or approved
channel. - Commercial access requirement. - OAuth scopes or credential
method. - Sandbox availability. - Production approval and KYC. - Webhook
support. - Idempotency support. - Rate limits. - Geography. - Data
retention. - Refund/cancellation support. - Support escalation path.

Technical validation
Benchmark candidate Vercel AI Gateway models on KAREN tasks.
Verify tool-call and structured-output compatibility.
Verify Hindi and Hinglish quality.
Test model fallback behavior.
Test Temporal recovery after worker termination.
Test duplicate webhook and ambiguous provider timeout.
Validate PostgreSQL RLS and vector-query isolation.
Validate deletion across derived data.
Load-test chat, background workers, and voice separately.
Security validation
Threat-model each integration.
Run OWASP agent-security test cases.
Test indirect prompt injection through email and websites.
Test approval replay and parameter substitution.
Test token revocation.
Test browser sandbox isolation.
Test cross-user memory access.
Conduct independent security review before external transactions.
22. Definition of done for a trustworthy KAREN feature
A feature is not done when the UI works or the model gives a good
answer.

It is done only when:

User value and scope are defined.
User journey is documented.
Permissions and data use are documented.
API and event contracts are versioned.
Data ownership and retention are defined.
Failure states are designed.
Authorization is enforced server-side.
External actions are idempotent where possible.
Results are verified.
Audit and observability are implemented.
Accessibility and localization are tested.
Unit, integration, contract, and end-to-end tests pass.
AI evaluation and adversarial tests pass.
Support and incident runbooks exist.
Product owner accepts the feature against explicit criteria.
23. Immediate next steps
Given the current KAREN project status, the next actions should be:

Preserve Phase 01 governance. Do not treat this document as
permission to bypass the NO-GO closure or production gate.
Review the six Phase 02 entry conditions from the latest Phase
01 review artifact and record evidence for each.
Approve a narrow P0 scope: authentication/onboarding,
conversation, explicit memory, Responsibility Engine, approvals,
audit, and reminders.
Create an architecture decision record confirming how this
investigation maps to KAREN Architecture v2.0. Do not create a
competing stack.
Validate the first real provider integration before designing a
transaction workflow around it.
Define measurable acceptance tests for authorization, durable
execution, memory deletion, and task verification.
Only then begin implementation under the approved phase and
branch strategy.
24. Sources and reference material
Instinct product and policy
Instinct official website: https://instinct.com/
Instinct application: https://app.instinct.com/
Instinct privacy policy: https://instinct.com/privacy-policy
Instinct terms of service: https://instinct.com/terms
TechCrunch, Instinct's powerful AI assistant is raising privacy and
security concerns (24 August 2026):
https://techcrunch.com/2026/08/24/instincts-powerful-ai-assistant-is-raising-privacy-and-security-concerns/
Reuters, AI agent firm Instinct raises $1 billion in latest
funding round (28 September 2026):
https://www.reuters.com/technology/ai-agent-firm-instinct-raises-1-billion-latest-funding-round-2026-09-28/
Gadgets Now hands-on review:
https://gadgetsnow.indiatimes.com/tech-news/instinct-ai-review-i-handed-my-maui-trip-to-the-2-5-billion-agent-in-whatsapp/articleshow/134516661.cms
Agent security and prompt injection
OWASP AI Agent Security Cheat Sheet:
https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
OWASP LLM Prompt Injection Prevention Cheat Sheet:
https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
OWASP Excessive Agency:
https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
Durable execution and orchestration
Temporal Durable Execution:
https://docs.temporal.io/durable-execution
Temporal AI documentation and patterns:
https://docs.temporal.io/ai
Temporal retry policies:
https://docs.temporal.io/encyclopedia/retry-policies
LangGraph documentation:
https://docs.langchain.com/oss/python/langgraph/overview
KAREN's selected platform
Vercel AI Gateway: https://vercel.com/docs/ai-gateway
Vercel AI Gateway model catalog:
https://vercel.com/ai-gateway/models
Vercel AI Gateway pricing:
https://vercel.com/docs/ai-gateway/pricing
LiveKit Agents: https://docs.livekit.io/agents/
pgvector: https://github.com/pgvector/pgvector
AWS India regions: https://aws.amazon.com/local/india/
Gmail OAuth scopes:
https://developers.google.com/workspace/gmail/api/auth/scopes
WhatsApp Business Platform:
https://developers.facebook.com/documentation/business-messaging/whatsapp/overview
NPCI UPI FAQs: https://www.npci.org.in/what-we-do/upi/faqs
India's Digital Personal Data Protection Rules:
https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa
Internal KAREN reference
KAREN_WORLD_CLASS_TECH_ARCHITECTURE_2026.md --- Architecture v2.0,
dated 19 November 2026.
Latest Phase 01 review and Phase 02 entry conditions --- use the
authoritative project review artifact and do not infer or recreate
the six conditions from memory.
Final product decision
KAREN should take inspiration from Instinct's conversational delegation
and cross-service task execution, but its defining product promise
should be responsibility with proof.

A user should never have to wonder: - Did KAREN actually do it? - Is it
waiting for me? - Did the provider confirm it? - Was I charged? - Can I
cancel it? - What information did it use? - Who else can see it? - What
happens if it fails?

The Responsibility Engine, permission system, memory governance, and
verification layer are therefore not supporting features. They are the
foundation of KAREN's product identity.

Build the trusted task-execution system first. Expand autonomy only
after the system can prove that it acts within permission, survives
failure, verifies outcomes, and tells the truth.





