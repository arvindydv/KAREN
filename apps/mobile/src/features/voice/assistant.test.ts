import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  FOLLOW_UP_SILENCE_MS,
  VoiceAssistant,
  type AssistantDeps,
  type AssistantPhase,
  type AssistantStage,
  type Playback,
} from './assistant';
import type { ListenEvent } from './live-conversation';

const tick = (ms = 0) => jest.advanceTimersByTimeAsync(ms);

class FakeWake {
  listener: ((text: string, isFinal: boolean) => void) | null = null;
  starts = 0;
  failStart = false;
  async start(onHeard: (text: string, isFinal: boolean) => void) {
    this.starts += 1;
    if (this.failStart) throw new Error('SPEECH_RECOGNIZER_LANGUAGE_NOT_SUPPORTED');
    this.listener = onHeard;
  }
  async stop() {
    this.listener = null;
  }
  say(text: string, isFinal = true) {
    this.listener?.(text, isFinal);
  }
}

class FakeListener {
  onEvent: ((e: ListenEvent) => void) | null = null;
  opens = 0;
  closes = 0;
  failOpen = false;
  async open(onEvent: (e: ListenEvent) => void) {
    this.opens += 1;
    if (this.failOpen) throw new Error('VOICE_LIVE_UNAVAILABLE');
    this.onEvent = onEvent;
  }
  async close() {
    this.closes += 1;
    this.onEvent = null;
  }
  emit(e: ListenEvent) {
    this.onEvent?.(e);
  }
  turn(text: string, key = `k-${text}`) {
    this.emit({ type: 'turn', text, key });
  }
}

class FakePlayback implements Playback {
  stopped = 0;
  private startResolve!: () => void;
  private doneResolve!: (r: 'ended' | 'error') => void;
  started = new Promise<void>((r) => {
    this.startResolve = r;
  });
  done = new Promise<'ended' | 'error'>((r) => {
    this.doneResolve = r;
  });
  start() {
    this.startResolve();
  }
  end(r: 'ended' | 'error' = 'ended') {
    this.doneResolve(r);
  }
  async stop() {
    this.stopped += 1;
    this.doneResolve('ended');
  }
}

function setup(options: { wake?: boolean } = {}) {
  const wake = new FakeWake();
  const listener = new FakeListener();
  const playbacks: FakePlayback[] = [];
  const asked: { text: string; key: string }[] = [];
  const cancelled: string[] = [];
  const phases: AssistantPhase[] = [];
  const errors: AssistantStage[] = [];
  const answers = new Map<string, string>();
  const deps: AssistantDeps = {
    wake: options.wake === false ? null : wake,
    listener,
    ask: jest.fn(async (text: string, key: string) => {
      asked.push({ text, key });
      return `m${asked.length}`;
    }),
    speak: jest.fn(async () => {
      const p = new FakePlayback();
      playbacks.push(p);
      return p;
    }),
    answerText: (id) => answers.get(id) ?? '',
    cancelAnswer: jest.fn(async (id: string) => {
      cancelled.push(id);
    }),
    cue: jest.fn(),
    newKey: () => 'generated-key',
  };
  const assistant = new VoiceAssistant(deps, {
    onState: (s) => {
      if (phases.at(-1) !== s.phase) phases.push(s.phase);
    },
    onError: (_e, stage) => errors.push(stage),
  });
  return { assistant, wake, listener, playbacks, asked, cancelled, phases, errors, answers, deps };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('VoiceAssistant (natural conversation on the phone)', () => {
  it('"Hello KAREN" → live listening → answers out loud → follow-up → silence → wake', async () => {
    const t = setup();
    t.assistant.startHandsFree();
    await tick();
    expect(t.assistant.current.phase).toBe('wake');
    t.wake.say('hello karen');
    await tick();
    expect(t.listener.opens).toBe(1);
    expect(t.assistant.current.phase).toBe('listening');
    expect(t.deps.cue).toHaveBeenCalled();

    t.listener.emit({ type: 'partial', text: 'kal ka plan' });
    await tick();
    expect(t.assistant.current.heard).toBe('kal ka plan');
    t.listener.turn('kal ka plan batao', 'voice-s1-0');
    await tick();
    expect(t.asked).toEqual([{ text: 'kal ka plan batao', key: 'voice-s1-0' }]);
    expect(t.assistant.current.phase).toBe('thinking');
    t.playbacks[0]!.start(); // first sentence plays while the answer is still being written
    await tick();
    expect(t.assistant.current.phase).toBe('speaking');
    t.playbacks[0]!.end();
    await tick();
    expect(t.assistant.current).toMatchObject({ phase: 'listening', followUp: true });
    await tick(FOLLOW_UP_SILENCE_MS + 10);
    expect(t.listener.closes).toBe(1);
    expect(t.phases).toEqual(['wake', 'listening', 'thinking', 'speaking', 'listening', 'wake']);
  });

  it('answers a question said in the same breath as the wake phrase', async () => {
    const t = setup();
    t.assistant.startHandsFree();
    await tick();
    t.wake.say('Hey KAREN what time is it in Delhi');
    await tick();
    expect(t.asked).toEqual([{ text: 'what time is it in Delhi', key: 'generated-key' }]);
    expect(t.listener.opens).toBe(1); // the conversation stays open for follow-ups
  });

  it('a follow-up question needs no wake word and keeps the same live session', async () => {
    const t = setup();
    t.assistant.startHandsFree();
    await tick();
    t.wake.say('hey karen kal ka mausam kaisa hoga');
    await tick();
    t.playbacks[0]!.start();
    t.playbacks[0]!.end();
    await tick();
    t.listener.turn('aur parso ka?');
    await tick();
    expect(t.asked.map((a) => a.text)).toEqual(['kal ka mausam kaisa hoga', 'aur parso ka?']);
    expect(t.listener.opens).toBe(1);
  });

  it('talking over KAREN interrupts her; the new question is answered', async () => {
    const t = setup();
    t.answers.set('m1', 'Ek baar ki baat hai, ek raja tha jiske paas bahut saare ghode the.');
    t.assistant.startHandsFree();
    await tick();
    t.wake.say('hey karen ek lambi kahani sunao');
    await tick();
    t.playbacks[0]!.start();
    await tick();
    t.listener.emit({ type: 'partial', text: 'nahi nahi chhoti' });
    await tick();
    expect(t.playbacks[0]!.stopped).toBe(1);
    expect(t.assistant.current.phase).toBe('listening');
    t.listener.turn('nahi nahi chhoti kahani sunao');
    await tick();
    expect(t.asked.map((a) => a.text)).toEqual([
      'ek lambi kahani sunao',
      'nahi nahi chhoti kahani sunao',
    ]);
  });

  it('ignores KAREN’s own voice from the speaker (no interruption, no new turn)', async () => {
    const t = setup();
    t.answers.set('m1', 'Kal subah office jaane se pehle paani piyo aur kapde tayyar rakho.');
    t.assistant.startHandsFree();
    await tick();
    t.wake.say('hey karen kya karun kal');
    await tick();
    t.playbacks[0]!.start();
    await tick();
    t.listener.emit({ type: 'partial', text: 'office jaane se pehle paani' });
    t.listener.turn('office jaane se pehle paani piyo');
    await tick();
    expect(t.playbacks[0]!.stopped).toBe(0);
    expect(t.asked).toHaveLength(1);
    expect(t.assistant.current.heard).toBe('');
  });

  it('"ruko" stops KAREN without sending anything', async () => {
    const t = setup();
    t.assistant.startHandsFree();
    await tick();
    t.wake.say('hey karen kuch bhi bolo');
    await tick();
    t.playbacks[0]!.start();
    await tick();
    t.listener.turn('ruko');
    await tick();
    expect(t.playbacks[0]!.stopped).toBe(1);
    expect(t.asked).toHaveLength(1);
    expect(t.assistant.current.phase).toBe('listening');
  });

  it('interrupting before she speaks also stops her writing the answer', async () => {
    const t = setup();
    t.assistant.startHandsFree();
    await tick();
    t.wake.say('hey karen ek essay likho');
    await tick();
    expect(t.assistant.current.phase).toBe('thinking');
    t.listener.emit({ type: 'partial', text: 'wait cancel that' });
    await tick();
    expect(t.cancelled).toEqual(['m1']);
  });

  it('tap to talk without the wake word; tapping while listening ends the conversation', async () => {
    const t = setup({ wake: false });
    expect(t.assistant.wakeWordAvailable).toBe(false);
    t.assistant.talkNow();
    await tick();
    expect(t.assistant.current.phase).toBe('listening');
    t.assistant.talkNow();
    await tick();
    expect(t.listener.closes).toBe(1);
    expect(t.assistant.current.phase).toBe('off');
  });

  it('a tap while KAREN speaks interrupts her and listens', async () => {
    const t = setup({ wake: false });
    t.assistant.askNow('aaj ka schedule batao');
    await tick();
    t.playbacks[0]!.start();
    await tick();
    t.assistant.talkNow();
    await tick();
    expect(t.playbacks[0]!.stopped).toBe(1);
    expect(t.assistant.current.phase).toBe('listening');
  });

  it('reopens the live session when it reaches its length cap mid-conversation', async () => {
    const t = setup({ wake: false });
    t.assistant.talkNow();
    await tick();
    t.listener.emit({ type: 'ended', reason: 'max_duration' });
    await tick();
    expect(t.listener.opens).toBe(2);
    expect(t.assistant.current.phase).toBe('listening');
  });

  it('turns hands-free off (no retry loop) when the on-device recogniser cannot start', async () => {
    const t = setup();
    t.wake.failStart = true;
    t.assistant.startHandsFree();
    await tick();
    expect(t.errors).toEqual(['wake']);
    expect(t.assistant.current).toMatchObject({ phase: 'off', handsFree: false });
    expect(t.wake.starts).toBe(1);
  });

  it('reports a live-session failure and returns to listening for the wake word', async () => {
    const t = setup();
    t.listener.failOpen = true;
    t.assistant.startHandsFree();
    await tick();
    t.wake.say('hey karen');
    await tick();
    expect(t.errors).toEqual(['listen']);
    expect(t.assistant.current.phase).toBe('wake');
  });

  it('hands the conversation to the chat screen from the new-chat screen', async () => {
    const t = setup();
    const handed: (string | null)[] = [];
    t.deps.handoff = (q) => {
      handed.push(q);
      return true;
    };
    t.assistant.startHandsFree();
    await tick();
    t.wake.say('hey karen aaj ka schedule batao');
    await tick();
    expect(handed).toEqual(['aaj ka schedule batao']);
    expect(t.listener.opens).toBe(0);
    expect(t.assistant.current.phase).toBe('off');
  });

  it('stop() releases the microphone and speaker immediately', async () => {
    const t = setup();
    t.assistant.startHandsFree();
    await tick();
    t.wake.say('hey karen something long please');
    await tick();
    t.playbacks[0]!.start();
    await tick();
    await t.assistant.stop();
    expect(t.playbacks[0]!.stopped).toBe(1);
    expect(t.listener.closes).toBe(1);
    expect(t.assistant.current).toMatchObject({ phase: 'off', handsFree: false });
  });

  it('ignores a turn that is only the wake phrase; sends just the question otherwise', async () => {
    const t = setup({ wake: false });
    t.assistant.talkNow();
    await tick();
    t.listener.turn('Hello, KAREN.');
    await tick();
    expect(t.asked).toEqual([]);
    expect(t.assistant.current.phase).toBe('listening');
    t.listener.turn('Hey KAREN, kal ka mausam batao');
    await tick();
    expect(t.asked.map((a) => a.text)).toEqual(['kal ka mausam batao']);
  });

  it('hangUp ends the conversation but keeps listening for the wake word', async () => {
    const t = setup();
    t.assistant.startHandsFree();
    await tick();
    t.wake.say('hey karen kuch batao');
    await tick();
    t.playbacks[0]!.start();
    await tick();
    t.assistant.hangUp();
    await tick();
    expect(t.playbacks[0]!.stopped).toBe(1);
    expect(t.listener.closes).toBe(1);
    expect(t.assistant.current.phase).toBe('wake');
  });

  it('a microphone barge-in while KAREN speaks stops her and listens (ADR-0033)', async () => {
    const t = setup({ wake: false });
    t.assistant.talkNow();
    await tick();
    t.listener.turn('aaj ka mausam kaisa hai');
    await tick();
    t.playbacks[0]!.start();
    await tick();
    expect(t.assistant.current.phase).toBe('speaking');
    t.assistant.bargeIn();
    await tick();
    expect(t.playbacks[0]!.stopped).toBe(1);
    expect(t.assistant.current.phase).toBe('listening');
    // Outside speaking, a barge-in does nothing.
    t.assistant.bargeIn();
    await tick();
    expect(t.assistant.current.phase).toBe('listening');
  });

  it('drops an echo of KAREN’s last sentence that arrives just after she finished', async () => {
    const t = setup({ wake: false });
    t.assistant.talkNow();
    await tick();
    t.listener.turn('kal subah kya karna hai');
    await tick();
    t.answers.set('m1', 'Kal subah aapki doctor ke saath meeting hai, das baje.');
    t.playbacks[0]!.start();
    await tick();
    t.playbacks[0]!.end();
    await tick();
    expect(t.assistant.current.phase).toBe('listening');
    // Recognition reports the echoed sentence ~1 s after playback ended: not a user turn.
    await tick(1_000);
    t.listener.turn('doctor ke saath meeting hai das baje');
    await tick();
    expect(t.asked).toHaveLength(1);
    // A real follow-up is still answered.
    t.listener.turn('aur shaam ko?');
    await tick();
    expect(t.asked.map((a) => a.text)).toEqual(['kal subah kya karna hai', 'aur shaam ko?']);
  });

  it('ignores a turn that is only the tail of the wake phrase, and strips it from a question', async () => {
    const t = setup({ wake: false });
    t.assistant.talkNow();
    await tick();
    t.listener.turn('Karen');
    await tick();
    expect(t.asked).toHaveLength(0);
    expect(t.assistant.current.phase).toBe('listening');
    t.listener.turn('Karen, kal ka mausam kaisa hai');
    await tick();
    expect(t.asked.map((a) => a.text)).toEqual(['kal ka mausam kaisa hai']);
  });
});
