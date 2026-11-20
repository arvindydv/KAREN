/**
 * Landing-page copy. Sourced from the product spec (karen.md §1, §5–§24). Availability labels
 * mirror the spec's priorities — KAREN is pre-release, so nothing here is described as live.
 */
import type { IconName } from './icons';

export type Availability = 'First release' | 'Next' | 'Later';

export const pillars: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'memory',
    title: 'Life memory',
    body: 'Remembers the facts, people, preferences and dates you choose to share — every memory is viewable, editable and deletable.',
  },
  {
    icon: 'pattern',
    title: 'Pattern understanding',
    body: 'Learns your routines from data you have consented to, shows its confidence, and lets you correct or switch it off.',
  },
  {
    icon: 'bell',
    title: 'Proactive intelligence',
    body: 'Notices deadlines, renewals and changes before you ask — useful nudges, never spam.',
  },
  {
    icon: 'bolt',
    title: 'Authorised execution',
    body: 'Acts through legitimate partners only after your explicit approval of the exact plan, amount and people.',
  },
  {
    icon: 'check',
    title: 'Follow-through',
    body: 'Tracks every accepted task until the provider confirms it, it fails with a clear reason, or a human steps in.',
  },
];

export const steps: { title: string; body: string }[] = [
  {
    title: 'You tell KAREN',
    body: 'Type or speak the outcome you want, in English, Hindi or Hinglish.',
  },
  { title: 'KAREN plans', body: 'It clarifies, researches options and explains the trade-offs.' },
  {
    title: 'You approve',
    body: 'Nothing consequential happens until you approve the exact details.',
  },
  {
    title: 'KAREN acts',
    body: 'It works with supported providers, safely and without duplicates.',
  },
  {
    title: 'Verified',
    body: 'Done means the provider confirmed it — with evidence in your timeline.',
  },
];

export const features: {
  icon: IconName;
  title: string;
  body: string;
  availability: Availability;
}[] = [
  {
    icon: 'chat',
    title: 'Conversation-first assistant',
    body: 'Chat naturally; KAREN understands intent, plans steps and shows exactly what it is doing.',
    availability: 'First release',
  },
  {
    icon: 'memory',
    title: 'Personal memory',
    body: 'Capture what matters, see where each memory came from, and correct or delete it anytime.',
    availability: 'First release',
  },
  {
    icon: 'target',
    title: 'Goals & reminders',
    body: 'Set personal goals, track milestones and get reminders that arrive at the right moment.',
    availability: 'First release',
  },
  {
    icon: 'list',
    title: 'Tasks with verified completion',
    body: 'A live timeline for every task — from planning to approval to provider confirmation.',
    availability: 'First release',
  },
  {
    icon: 'shield',
    title: 'Approvals & consent',
    body: 'Risk-aware approvals bound to the exact amount, people and expiry. Revoke consent anytime.',
    availability: 'First release',
  },
  {
    icon: 'mic',
    title: 'Voice & documents',
    body: 'Speak instead of typing, and share receipts, tickets or screenshots for KAREN to understand.',
    availability: 'Next',
  },
  {
    icon: 'scale',
    title: 'Decision intelligence',
    body: 'Fair, normalised comparisons including hidden costs, refund rules and your preferences.',
    availability: 'Next',
  },
  {
    icon: 'plane',
    title: 'Travel',
    body: 'Find flights, trains and stays that fit your constraints, with repricing before you approve.',
    availability: 'Next',
  },
  {
    icon: 'receipt',
    title: 'Refunds & disputes',
    body: 'Opens follow-ups for late refunds or broken orders and keeps chasing until resolved.',
    availability: 'Next',
  },
  {
    icon: 'mail',
    title: 'Personal admin',
    body: 'Bills, subscriptions, appointments and email drafts — sent only when you approve.',
    availability: 'Next',
  },
  {
    icon: 'cart',
    title: 'Food & groceries',
    body: 'Prepare your usual grocery order or a meal for the family, ready for your sign-off.',
    availability: 'Later',
  },
  {
    icon: 'car',
    title: 'Cabs & transport',
    body: 'Coordinate the airport ride and remind you when it is time to leave.',
    availability: 'Later',
  },
  {
    icon: 'bag',
    title: 'Shopping & price watch',
    body: 'Compare products, watch prices and handle returns where partners allow it.',
    availability: 'Later',
  },
  {
    icon: 'wallet',
    title: 'Money organisation',
    body: 'Organise spending and savings goals with realistic options — never regulated advice.',
    availability: 'Later',
  },
  {
    icon: 'users',
    title: 'Family & household',
    body: 'Shared tasks and delegated permissions for the people you plan life with.',
    availability: 'Later',
  },
];

export const commands: string[] = [
  'Remember that my parents prefer AC 2-tier trains and avoid overnight flights.',
  'What do I have pending this week?',
  'My car insurance expires next month — compare suitable renewal options.',
  'Find the best flight for my Bengaluru trip, including luggage and cancellation costs.',
  'My refund is late. Open a follow-up and keep me updated.',
  'Prepare my weekly grocery order based on what we usually buy.',
  'Coordinate my airport ride tomorrow and remind me when to leave.',
  'Help our family plan a weekend within ₹5,000.',
  'I want to save ₹10,000 a month — show me realistic options.',
  "Don't proactively monitor my email anymore.",
];

export const trustPoints: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'shield',
    title: 'Your permission, every time',
    body: 'Payments, bookings and messages need your explicit approval of the exact details.',
  },
  {
    icon: 'lock',
    title: 'Never your PIN or OTP',
    body: 'KAREN never asks for your UPI PIN, card CVV, OTP or bank password.',
  },
  {
    icon: 'eye',
    title: 'You stay in control of data',
    body: 'Granular consent, visible memories, export and deletion — no silent data collection.',
  },
  {
    icon: 'check',
    title: 'Honest outcomes',
    body: '“Submitted” is not “done”. KAREN only says done when the provider confirms it.',
  },
];
