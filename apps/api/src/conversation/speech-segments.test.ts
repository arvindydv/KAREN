import { describe, expect, it } from 'vitest';
import { speechSegment, type SegmentOptions } from './speech-segments.js';

const OPTS: SegmentOptions = {
  firstMinChars: 12,
  firstCommaMinChars: 40,
  nextMinChars: 40,
  maxTotalChars: 4_000,
};
const seg = (text: string, i: number, final: boolean) => speechSegment(text, i, final, OPTS);
const texts = (text: string, final = true) => {
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const r = seg(text, i, final);
    if (r.kind !== 'segment') return out;
    out.push(r.text);
  }
};

describe('speech segments (speak while the answer is written)', () => {
  it('speaks the first sentence as soon as it is complete', () => {
    expect(seg('Theek hai, main batati hoon. Pehle', 0, false)).toMatchObject({
      kind: 'segment',
      text: 'Theek hai, main batati hoon.',
    });
    // The next one waits for more text.
    expect(seg('Theek hai, main batati hoon. Pehle', 1, false)).toEqual({ kind: 'wait' });
  });

  it('does not trust a full stop at the end of streaming text ("3." may become "3.5")', () => {
    expect(seg('Your total comes to 3.', 0, false)).toEqual({ kind: 'wait' });
    expect(seg('Your total comes to 3.5 lakh rupees today.', 0, false)).toEqual({ kind: 'wait' });
    expect(seg('Your total comes to 3.5 lakh rupees today. Next', 0, false)).toMatchObject({
      text: 'Your total comes to 3.5 lakh rupees today.',
    });
  });

  it('pauses at a colon: "three tips:" is spoken while the tips are written', () => {
    expect(seg('कल सुबह तीन छोटी बातें: पहले रात को', 0, false)).toMatchObject({
      text: 'कल सुबह तीन छोटी बातें:',
    });
    expect(seg('Time is 10:30 today, okay. Next', 0, false)).toMatchObject({
      text: 'Time is 10:30 today, okay.',
    });
  });

  it('starts a long first sentence at its first comma after 40 characters', () => {
    const t =
      'Jaipur mein weekend ke liye Amer Fort aur Hawa Mahal zaroor dekhna, aur shaam ko bazaar ghoomna.';
    expect(seg(t.slice(0, 80), 0, false)).toMatchObject({
      text: 'Jaipur mein weekend ke liye Amer Fort aur Hawa Mahal zaroor dekhna,',
    });
    // A short opening clause is not cut at its comma.
    expect(seg('Haan, bilkul. Kal', 0, false)).toMatchObject({ text: 'Haan, bilkul.' });
    // Only the first segment breaks at commas.
    expect(texts(t)).toEqual([
      'Jaipur mein weekend ke liye Amer Fort aur Hawa Mahal zaroor dekhna,',
      'aur shaam ko bazaar ghoomna.',
    ]);
  });

  it('handles Devanagari danda and line breaks', () => {
    expect(texts('कल सुबह तीन काम करो। पहला, कपड़े तैयार रखो।\nदूसरा, पानी पियो।')).toEqual([
      'कल सुबह तीन काम करो।',
      // Later segments group sentences up to the minimum length (fewer, steadier requests).
      'पहला, कपड़े तैयार रखो।\nदूसरा, पानी पियो।',
    ]);
    expect(seg('पहला वाक्य यहाँ है।\nदूसरा', 0, false)).toMatchObject({ text: 'पहला वाक्य यहाँ है।' });
  });

  it('groups short sentences after the first into steadier segments', () => {
    const t = 'Haan bilkul. Ek. Do. Teen. Char. Paanch. Chhe. Saat. Aath. Nau. Das, bas itna.';
    const out = texts(t);
    expect(out[0]).toBe('Haan bilkul.');
    // Every middle segment meets the minimum; the last one is whatever remains.
    expect(out.slice(1, -1).every((s) => s.length >= 40)).toBe(true);
    expect(out.join(' ')).toBe(t);
  });

  it('is deterministic: the same segments whether read while streaming or at the end', () => {
    const full =
      'Sure! Here is the plan for tomorrow morning. First, lay out your clothes tonight so you are not rushed. Then drink a glass of water when you wake up.';
    const streamed: string[] = [];
    let next = 0;
    for (let len = 1; len <= full.length; len++) {
      const r = seg(full.slice(0, len), next, false);
      if (r.kind === 'segment') {
        streamed.push(r.text);
        next++;
      }
    }
    for (let r = seg(full, next, true); r.kind === 'segment'; r = seg(full, ++next, true)) {
      streamed.push(r.text);
    }
    expect(streamed).toEqual(texts(full));
  });

  it('ends with the remainder of a finished answer and then reports done', () => {
    expect(texts('Hello there, how are you doing')).toEqual(['Hello there, how are you doing']);
    expect(seg('Short.', 0, true)).toMatchObject({ text: 'Short.' });
    expect(seg('Short.', 1, true)).toEqual({ kind: 'done' });
    expect(seg('', 0, false)).toEqual({ kind: 'wait' });
    expect(seg('', 0, true)).toEqual({ kind: 'done' });
  });

  it('never speaks beyond the maximum length', () => {
    const long = 'Yeh ek lamba vaakya hai. '.repeat(400);
    const out: string[] = [];
    for (let i = 0; ; i++) {
      const r = speechSegment(long, i, false, { ...OPTS, maxTotalChars: 200 });
      if (r.kind !== 'segment') break;
      out.push(r.text);
    }
    expect(out.join(' ').length).toBeLessThanOrEqual(200);
  });
});
