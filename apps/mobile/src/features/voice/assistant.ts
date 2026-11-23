import {
  ECHO_TAIL_MS,
  isLikelyEcho,
  isStopCommand,
  isUsableQuestion,
  matchWakePhrase,
  shouldInterrupt,
  stripLeadingWakeWords,
} from '@karen/domain';
import type { ListenEvent } from './live-conversation';

/**
 * Talking to KAREN on the phone (ADR-0030, ADR-0031): a natural, hands-free conversation.
 *
 *   wake ──"Hey/Hello KAREN"──▶ conversation: listening ⇄ thinking ⇄ speaking ──silence──▶ wake
 *
 * - `wake`: the phone's ON-DEVICE recogniser listens for the wake phrase. No audio leaves the
 *   phone. "Hey KAREN, <question>" in one breath is answered straight away.
 * - conversation: the microphone streams to KAREN's live speech recognition, which detects the
 *   end of each turn by itself (~1 s after you stop). The turn is sent at once; KAREN starts
 *   speaking her first sentence while the rest of the answer is still being written.
 * - Speaking over KAREN interrupts her (real words only — her own voice from the speaker and
 *   coughs are ignored); "ruko" / "stop" just stops her. Follow-ups need no wake word.
 * - A few seconds of silence ends the conversation: back to `wake` (hands-free) or `off`.
 *
 * Everything native is injected; this state machine is unit-tested without a device.
 */
export type AssistantPhase = 'off' | 'wake' | 'listening' | 'thinking' | 'speaking';

export interface AssistantState {
  phase: AssistantPhase;
  /** True while hands-free ("Hey KAREN") mode is on, whatever the current phase. */
  handsFree: boolean;
  /** `listening` after KAREN answered: no wake word needed. */
  followUp: boolean;
  /** What the user is saying right now (live transcript), for the screen. */
  heard: string;
}

export type AssistantStage = 'wake' | 'listen' | 'ask' | 'speak';

/** On-device listening for the wake phrase. */
export interface WakeListener {
  start(onHeard: (text: string, isFinal: boolean) => void): Promise<void>;
  stop(): Promise<void>;
}

/** The live conversation: microphone → cloud recognition with turn detection. */
export interface ConversationListener {
  open(onEvent: (event: ListenEvent) => void): Promise<void>;
  close(): Promise<void>;
}

export interface Playback {
  /** Resolves when the first audio starts playing. */
  started: Promise<void>;
  /** Resolves when everything has played (`ended`) or playback failed (`error`). */
  done: Promise<'ended' | 'error'>;
  stop(): Promise<void>;
}

export interface AssistantDeps {
  /** null when on-device wake-word listening is unavailable (tap-to-talk still works). */
  wake: WakeListener | null;
  listener: ConversationListener;
  /** Sends a spoken turn (idempotency `key`); returns the assistant message id. */
  ask: (text: string, key: string) => Promise<string>;
  /** Starts speaking that answer (it may still be being written). */
  speak: (messageId: string) => Promise<Playback>;
  /** The answer's text so far (to recognise KAREN's own voice coming back from the speaker). */
  answerText: (messageId: string) => string;
  /** Stops KAREN writing an answer the user talked over. */
  cancelAnswer: (messageId: string) => Promise<void>;
  /** A short cue (vibration) when KAREN starts listening. */
  cue?: () => void;
  /** New-chat screen: hand the conversation to the chat screen; true ends this assistant. */
  handoff?: (question: string | null) => boolean;
  newKey?: () => string;
  now?: () => number;
}

export interface AssistantHandlers {
  onState(state: AssistantState): void;
  onError(error: unknown, stage: AssistantStage): void;
}

/** Silence that ends a conversation (first turn / after KAREN answered). */
export const FIRST_TURN_SILENCE_MS = 8_000;
export const FOLLOW_UP_SILENCE_MS = 7_000;
/** After the last change in a "Hey KAREN …" utterance, wait this long for the rest. */
const SAME_BREATH_WAIT_MS = 900;

export class VoiceAssistant {
  private state: AssistantState = { phase: 'off', handsFree: false, followUp: false, heard: '' };
  private handsFree = false;
  /** Incremented whenever the assistant is (re)started or stopped; stale callbacks exit. */
  private epoch = 0;
  /** Incremented per user turn; a stale answer/playback is dropped. */
  private turn = 0;
  private conversationOpen = false;
  private wakeActive = false;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentAnswer: string | null = null;
  private playback: Playback | null = null;
  /** Until then, transcripts are still checked for KAREN's own (echoed) words. */
  private echoUntil = 0;
  private readonly newKey: () => string;
  private readonly now: () => number;

  constructor(
    private readonly deps: AssistantDeps,
    private readonly handlers: AssistantHandlers,
  ) {
    this.newKey =
      deps.newKey ?? (() => `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * The microphone heard the user clearly talking over KAREN (local level, ADR-0033): she stops
   * speaking and listens. Their words then arrive as a normal turn.
   */
  bargeIn(): void {
    if (this.state.phase === 'speaking') this.interrupt(this.epoch);
  }

  get current(): AssistantState {
    return this.state;
  }

  get wakeWordAvailable(): boolean {
    return this.deps.wake !== null;
  }

  /** Hands-free: listen for "Hey KAREN" until `stop()`. */
  startHandsFree(): void {
    if (!this.deps.wake) {
      this.handlers.onError(new Error('WAKE_WORD_UNAVAILABLE'), 'wake');
      return;
    }
    this.handsFree = true;
    if (this.state.phase === 'off') void this.enterWake(++this.epoch);
    else this.publish({});
  }

  /** Hands-free off. A conversation in progress continues until it ends. */
  stopHandsFree(): void {
    this.handsFree = false;
    if (this.state.phase === 'wake') void this.stop();
    else this.publish({});
  }

  /** The tap: start talking (no wake word), interrupt KAREN, or end the conversation. */
  talkNow(): void {
    switch (this.state.phase) {
      case 'off':
      case 'wake':
        void this.beginConversation(++this.epoch, null);
        return;
      case 'speaking':
      case 'thinking':
        this.interrupt(this.epoch);
        return;
      case 'listening':
        void this.endConversation(this.epoch);
    }
  }

  /** Leave voice mode: end the conversation; hands-free keeps listening for "Hey KAREN". */
  hangUp(): void {
    if (this.state.phase === 'off' || this.state.phase === 'wake') return;
    void this.endConversation(this.epoch);
  }

  /** Answers a question handed over from another screen, then keeps the conversation open. */
  askNow(text: string): void {
    void this.beginConversation(++this.epoch, text);
  }

  async stop(): Promise<void> {
    this.handsFree = false;
    this.epoch += 1;
    await this.releaseAll();
    this.publish({ phase: 'off', followUp: false, heard: '' });
  }

  // ---------------------------------------------------------------------------------- wake

  private async enterWake(epoch: number): Promise<void> {
    const wake = this.deps.wake;
    if (!wake || !this.handsFree) {
      this.publish({ phase: 'off', followUp: false, heard: '' });
      return;
    }
    this.publish({ phase: 'wake', followUp: false, heard: '' });
    this.wakeActive = true;
    try {
      await wake.start((heard, isFinal) => {
        if (epoch !== this.epoch) return;
        const match = matchWakePhrase(heard);
        if (!match) return;
        const go = () => {
          if (epoch !== this.epoch) return;
          this.clearWakeTimer();
          const question = isUsableQuestion(match.rest) ? match.rest : null;
          this.deps.cue?.();
          if (this.deps.handoff?.(question)) {
            this.epoch += 1;
            void this.releaseAll().then(() =>
              this.publish({ phase: 'off', followUp: false, heard: '' }),
            );
            return;
          }
          void this.beginConversation(++this.epoch, question);
        };
        this.clearWakeTimer();
        if (isFinal) go();
        else this.wakeTimer = setTimeout(go, SAME_BREATH_WAIT_MS);
      });
    } catch (error) {
      this.wakeActive = false;
      if (epoch !== this.epoch) return;
      // The recogniser itself failed: hands-free goes off (no retry loop).
      this.handsFree = false;
      this.handlers.onError(error, 'wake');
      this.publish({ phase: 'off', followUp: false, heard: '' });
    }
  }

  // -------------------------------------------------------------------------- conversation

  private async beginConversation(epoch: number, question: string | null): Promise<void> {
    await this.stopWake();
    await this.stopSpeaking();
    if (epoch !== this.epoch) return;
    this.publish({ phase: question ? 'thinking' : 'listening', followUp: false, heard: '' });
    if (!this.conversationOpen) {
      try {
        await this.deps.listener.open((event) => this.onListen(epoch, event));
        this.conversationOpen = true;
      } catch (error) {
        if (epoch !== this.epoch) return;
        this.handlers.onError(error, 'listen');
        await this.afterConversation(epoch);
        return;
      }
    }
    if (epoch !== this.epoch) return;
    if (question) void this.answer(epoch, question, this.newKey());
    else this.armSilence(epoch, FIRST_TURN_SILENCE_MS);
  }

  private onListen(epoch: number, event: ListenEvent): void {
    if (epoch !== this.epoch) return;
    const spoken = this.currentAnswer ? this.deps.answerText(this.currentAnswer) : null;
    const busy = this.state.phase === 'speaking' || this.state.phase === 'thinking';
    // Recognition reports a turn ~1 s after the audio: an echo of KAREN's last sentence can
    // arrive after she finished, so her words are still checked for a few seconds.
    const echoWindow = busy || this.now() < this.echoUntil;
    switch (event.type) {
      case 'speech_started':
        if (!busy) this.clearSilence();
        return;
      case 'partial': {
        const echo = echoWindow && isLikelyEcho(event.text, spoken);
        if (!echo) {
          this.clearSilence();
          this.publish({ heard: event.text });
        }
        if (busy && (shouldInterrupt(event.text, spoken) || isStopCommand(event.text, spoken))) {
          this.interrupt(epoch);
        }
        return;
      }
      case 'turn': {
        if (echoWindow && isLikelyEcho(event.text, spoken)) return; // KAREN hearing herself
        this.publish({ heard: '' });
        // "Hello KAREN" alone just (re)starts listening; "Hello KAREN, <question>" sends the question.
        const wake = matchWakePhrase(event.text);
        if (wake && !isUsableQuestion(wake.rest)) {
          if (busy) this.interrupt(epoch);
          else this.armSilence(epoch, FIRST_TURN_SILENCE_MS);
          return;
        }
        if (wake) {
          void this.answer(epoch, wake.rest, event.key);
          return;
        }
        // Listening starts the instant the wake phrase is heard: a turn may begin with its tail.
        const question = stripLeadingWakeWords(event.text);
        if (!question) {
          if (!busy) this.armSilence(epoch, FIRST_TURN_SILENCE_MS);
          return;
        }
        if (isStopCommand(event.text, spoken) && event.text.split(/\s+/).length <= 2) {
          // "ruko" / "bas": stop and listen, nothing to answer.
          this.interrupt(epoch);
          return;
        }
        void this.answer(epoch, question, event.key);
        return;
      }
      case 'ended':
        this.conversationOpen = false;
        if (event.reason === 'max_duration') {
          // Sessions are length-capped; keep the conversation going seamlessly.
          void this.reopen(epoch);
          return;
        }
        void this.afterConversation(epoch);
        return;
      case 'error':
        this.handlers.onError(new Error(event.code), 'listen');
    }
  }

  private async reopen(epoch: number): Promise<void> {
    try {
      await this.deps.listener.open((event) => this.onListen(epoch, event));
      this.conversationOpen = true;
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.handlers.onError(error, 'listen');
      await this.afterConversation(epoch);
    }
  }

  private async answer(epoch: number, text: string, key: string): Promise<void> {
    const turn = ++this.turn;
    this.clearSilence();
    await this.stopSpeaking();
    if (epoch !== this.epoch || turn !== this.turn) return;
    this.publish({ phase: 'thinking', heard: '' });
    let messageId: string;
    try {
      messageId = await this.deps.ask(text, key);
    } catch (error) {
      if (epoch !== this.epoch || turn !== this.turn) return;
      this.handlers.onError(error, 'ask');
      this.toListening(epoch, true);
      return;
    }
    if (epoch !== this.epoch || turn !== this.turn) return;
    this.currentAnswer = messageId;
    let playback: Playback;
    try {
      playback = await this.deps.speak(messageId);
    } catch (error) {
      if (epoch !== this.epoch || turn !== this.turn) return;
      this.handlers.onError(error, 'speak');
      this.toListening(epoch, true);
      return;
    }
    if (epoch !== this.epoch || turn !== this.turn) {
      await playback.stop();
      return;
    }
    this.playback = playback;
    void playback.started.then(() => {
      if (epoch === this.epoch && turn === this.turn) this.publish({ phase: 'speaking' });
    });
    const result = await playback.done;
    if (epoch !== this.epoch || turn !== this.turn) return;
    this.playback = null;
    this.echoUntil = this.now() + ECHO_TAIL_MS;
    if (result === 'error') this.handlers.onError(new Error('PLAYBACK_FAILED'), 'speak');
    this.toListening(epoch, true);
  }

  /** The user talked over KAREN: she stops speaking (and writing) and listens. */
  private interrupt(epoch: number): void {
    if (epoch !== this.epoch) return;
    this.turn += 1;
    const answer = this.currentAnswer;
    const wasThinking = this.state.phase === 'thinking';
    void this.stopSpeaking();
    if (answer && wasThinking) void this.deps.cancelAnswer(answer).catch(() => undefined);
    this.toListening(epoch, false);
  }

  private toListening(epoch: number, followUp: boolean): void {
    if (epoch !== this.epoch) return;
    if (!followUp) this.currentAnswer = null;
    this.publish({ phase: 'listening', followUp });
    this.armSilence(epoch, followUp ? FOLLOW_UP_SILENCE_MS : FIRST_TURN_SILENCE_MS);
  }

  private armSilence(epoch: number, ms: number): void {
    this.clearSilence();
    this.silenceTimer = setTimeout(() => {
      if (epoch === this.epoch && this.state.phase === 'listening') {
        void this.endConversation(epoch);
      }
    }, ms);
  }

  private async endConversation(epoch: number): Promise<void> {
    if (epoch !== this.epoch) return;
    const next = ++this.epoch;
    await this.closeConversation();
    await this.afterConversation(next);
  }

  private async afterConversation(epoch: number): Promise<void> {
    if (epoch !== this.epoch) return;
    await this.closeConversation();
    if (this.handsFree) await this.enterWake(epoch);
    else this.publish({ phase: 'off', followUp: false, heard: '' });
  }

  // ------------------------------------------------------------------------------ helpers

  private async stopSpeaking(): Promise<void> {
    const playback = this.playback;
    this.playback = null;
    await playback?.stop();
  }

  private async stopWake(): Promise<void> {
    this.clearWakeTimer();
    if (!this.wakeActive || !this.deps.wake) return;
    this.wakeActive = false;
    await this.deps.wake.stop();
  }

  private async closeConversation(): Promise<void> {
    this.clearSilence();
    await this.stopSpeaking();
    if (!this.conversationOpen) return;
    this.conversationOpen = false;
    await this.deps.listener.close();
  }

  private async releaseAll(): Promise<void> {
    this.currentAnswer = null;
    await this.stopWake();
    await this.closeConversation();
  }

  private clearSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private clearWakeTimer(): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
  }

  private publish(patch: Partial<Omit<AssistantState, 'handsFree'>>): void {
    const next: AssistantState = { ...this.state, ...patch, handsFree: this.handsFree };
    const prev = this.state;
    this.state = next;
    if (
      prev.phase !== next.phase ||
      prev.handsFree !== next.handsFree ||
      prev.followUp !== next.followUp ||
      prev.heard !== next.heard
    ) {
      this.handlers.onState(next);
    }
  }
}
