export interface SseMessage {
  /** The event's `id:` value, or `null` when it has none. */
  id: string | null;
  /** All `data:` lines of the event joined with `\n`. */
  data: string;
}

const EVENT_BOUNDARY = /\r?\n\r?\n/;

function parseEvent(raw: string): SseMessage | null {
  let id: string | null = null;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
  }
  return data.length > 0 ? { id, data: data.join('\n') } : null;
}

/** Yields one message per SSE event; heartbeats (`: ping`) and non-data events are skipped. */
export async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  const reader = body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  let buffer = '';
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let match = EVENT_BOUNDARY.exec(buffer);
      while (match) {
        const message = parseEvent(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (message) yield message;
        match = EVENT_BOUNDARY.exec(buffer);
      }
    }
    // A trailing event without its final blank line still counts.
    const last = signal?.aborted ? null : parseEvent(buffer);
    if (last) yield last;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
