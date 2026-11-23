/**
 * "Hello KAREN" on the website, fully on-device (ADR-0031).
 *
 * A small open-source speech model (Vosk, Indian English, served from KAREN's own origin) runs
 * in a Web Worker inside the browser and only listens for the wake phrase: room audio never
 * leaves the computer and nothing is billed until the user says it. The library (~6 MB) and the
 * model (~38 MB, cached by the browser) load only when the user turns the switch on.
 *
 * The recogniser is restricted to a tiny grammar ("hello karen", "hi karen", anything else =
 * unknown), which makes it accurate and cheap; `matchWakePhrase` (shared with the phone app)
 * makes the final decision.
 */
import { matchWakePhrase } from '@karen/domain';
import type { KaldiRecognizer, Model } from 'vosk-browser';

export const WAKE_MODEL_URL = '/models/vosk-model-small-en-in-0.4.tar.gz';
/** "hey" is not in this model's vocabulary; "hi karen" is acoustically closest to "hey karen". */
const GRAMMAR = JSON.stringify(['hello karen', 'hi karen', '[unk]']);

export type WakeStatus = 'loading' | 'listening' | 'error' | 'permission_denied';

let modelPromise: Promise<Model> | null = null;
/** One model per page, shared by every listener (it is large). */
function loadModel(): Promise<Model> {
  modelPromise ??= import('vosk-browser')
    .then(({ createModel }) => createModel(WAKE_MODEL_URL, -1))
    .catch((error: unknown) => {
      modelPromise = null; // allow a retry later
      throw error;
    });
  return modelPromise;
}

export function wakeWordSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof WebAssembly !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

export class BrowserWakeWord {
  private media: MediaStream | null = null;
  private context: AudioContext | null = null;
  private recognizer: KaldiRecognizer | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stopped = false;

  constructor(
    private readonly onWake: () => void,
    private readonly onStatus: (status: WakeStatus) => void,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.onStatus('loading');
    let model: Model;
    try {
      model = await loadModel();
    } catch {
      this.onStatus('error');
      return;
    }
    if (this.stopped) return;
    try {
      this.media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      this.onStatus(
        name === 'NotAllowedError' || name === 'SecurityError' ? 'permission_denied' : 'error',
      );
      return;
    }
    if (this.stopped) {
      this.release();
      return;
    }
    const context = new AudioContext();
    this.context = context;
    const recognizer = new model.KaldiRecognizer(context.sampleRate, GRAMMAR);
    this.recognizer = recognizer;
    const check = (text: string) => {
      if (!this.stopped && text && matchWakePhrase(text)) {
        this.onWake();
      }
    };
    // React on the partial result too: KAREN starts listening while you finish the phrase.
    recognizer.on('partialresult', (m) => {
      if (m.event === 'partialresult') check(m.result.partial);
    });
    recognizer.on('result', (m) => {
      if (m.event === 'result') check(m.result.text);
    });
    const source = context.createMediaStreamSource(this.media);
    // ScriptProcessor (not AudioWorklet): no extra module file to serve or allow in the CSP.
    const processor = context.createScriptProcessor(4096, 1, 1);
    this.processor = processor;
    processor.onaudioprocess = (event) => {
      if (!this.stopped) recognizer.acceptWaveform(event.inputBuffer);
    };
    source.connect(processor);
    processor.connect(context.destination);
    this.onStatus('listening');
  }

  /** Stops listening and releases the microphone (the model stays loaded for next time). */
  stop(): void {
    this.stopped = true;
    this.release();
  }

  private release(): void {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
    }
    this.processor = null;
    this.recognizer?.remove();
    this.recognizer = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.media?.getTracks().forEach((t) => t.stop());
    this.media = null;
  }
}
