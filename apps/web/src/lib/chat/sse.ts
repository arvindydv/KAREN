/**
 * Incremental Server-Sent Events parser (WHATWG event-stream rules that KAREN uses): frames are
 * separated by a blank line; `data:` lines are joined with "\n"; `id:` sets the last event id;
 * lines starting with ":" are comments (heartbeats). Chunks may split anywhere, including
 * inside a CRLF pair or a multi-byte character (decode with a streaming TextDecoder).
 */
export interface SseFrame {
  id: string | null;
  event: string | null;
  data: string;
}

export class SseParser {
  private buffer = '';
  heartbeats = 0;

  /** Feeds decoded text; returns the complete frames it contained. */
  push(text: string): SseFrame[] {
    this.buffer += text;
    // Normalise line endings, but keep a trailing CR until we know whether LF follows.
    const endsWithCr = this.buffer.endsWith('\r');
    let work = endsWithCr ? this.buffer.slice(0, -1) : this.buffer;
    work = work.replace(/\r\n?/g, '\n');
    const frames: SseFrame[] = [];
    let boundary = work.indexOf('\n\n');
    while (boundary !== -1) {
      const raw = work.slice(0, boundary);
      work = work.slice(boundary + 2);
      const frame = this.parseFrame(raw);
      if (frame) frames.push(frame);
      boundary = work.indexOf('\n\n');
    }
    this.buffer = endsWithCr ? `${work}\r` : work;
    return frames;
  }

  private parseFrame(raw: string): SseFrame | null {
    let id: string | null = null;
    let event: string | null = null;
    const data: string[] = [];
    let comment = false;
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) {
        comment = true;
        continue;
      }
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'id') id = value;
      else if (field === 'event') event = value;
    }
    if (data.length === 0) {
      if (comment) this.heartbeats++;
      return null;
    }
    return { id, event, data: data.join('\n') };
  }
}
