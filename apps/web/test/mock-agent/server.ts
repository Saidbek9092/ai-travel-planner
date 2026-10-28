/** Dev/CI-only scripted agent speaking the SSE contract. Never imported from `src/`. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { newThreadId, resultPacket, resultPayload, scenarios, type Step } from '../fixtures/packets.ts';

const port = Number(process.env.PORT ?? (process.env.CONDUCTOR_PORT ? Number(process.env.CONDUCTOR_PORT) + 1 : 4000));
const delayScale = Number(process.env.MOCK_DELAY_SCALE ?? 1);

/**
 * A run lives on the server independently of the connection (like the agent's RunRegistry): packets are numbered,
 * kept for replay, and a reconnect with `Last-Event-ID` gets what it missed, then follows live.
 */
interface Run {
  events: { id: number; data: string }[];
  subscribers: Set<ServerResponse>;
  done: boolean;
  /** The run itself died (`#dropped`): reconnects get 404. */
  lost: boolean;
  cancelled: boolean;
  result: unknown;
  /** Reattach attempts to refuse with 503 first (`#drop`), so the "Reconnecting" state is visible. */
  refuse: number;
}
const runs = new Map<string, Run>();

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Last-Event-ID');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Thread-Id, Retry-After');
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function pickScenario(prompt: string): string {
  const tag = /#(\w+)/.exec(prompt)?.[1];
  if (tag && tag in scenarios) return tag;
  const fromEnv = process.env.MOCK_SCENARIO;
  return fromEnv && fromEnv in scenarios ? fromEnv : 'happy';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms * delayScale));

function publish(run: Run, data: string) {
  const event = { id: run.events.length + 1, data };
  run.events.push(event);
  for (const res of run.subscribers) res.write(`id: ${event.id}\ndata: ${event.data}\n\n`);
}

function closeAll(run: Run, how: 'end' | 'destroy') {
  for (const res of run.subscribers) {
    if (how === 'end') res.end();
    else res.destroy();
  }
  run.subscribers.clear();
}

/** Plays the scenario into the run; keeps going when nobody is listening. */
async function produce(run: Run, steps: Step[]) {
  for (const step of steps) {
    if (run.cancelled) return;
    if ('end' in step) {
      run.lost = true;
      run.done = true;
      closeAll(run, 'end');
      return;
    }
    if ('drop' in step) {
      closeAll(run, 'destroy');
      continue;
    }
    await sleep(step.delayMs ?? 0);
    if (run.cancelled) return;
    const data = 'raw' in step ? step.raw : JSON.stringify(step.packet);
    if ('packet' in step && step.packet.type === 'RESULT') run.result = step.packet.payload;
    publish(run, data);
  }
  run.done = true;
  closeAll(run, 'end');
}

/** Sends the stream head, replays packets after `lastId`, then follows the live run. */
function attach(res: ServerResponse, threadId: string, run: Run, lastId: number) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Thread-Id': threadId,
  });
  res.write(': ping\n\n');
  for (const event of run.events) if (event.id > lastId) res.write(`id: ${event.id}\ndata: ${event.data}\n\n`);
  if (run.done) return void res.end();
  run.subscribers.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 10_000);
  res.on('close', () => {
    clearInterval(ping);
    run.subscribers.delete(res);
  });
}

function startRun(res: ServerResponse, threadId: string, steps: Step[]) {
  const run: Run = { events: [], subscribers: new Set(), done: false, lost: false, cancelled: false, result: null, refuse: steps.some((step) => 'drop' in step) ? 2 : 0 };
  runs.set(threadId, run);
  attach(res, threadId, run, 0);
  void produce(run, steps);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    return {};
  }
}

createServer(async (req, res) => {
  cors(res);
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'OPTIONS') return void res.writeHead(204).end();

  if (req.method === 'POST' && url.pathname === '/api/trips') {
    const body = await readBody(req);
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    if (prompt.trim().length < 3 || prompt.includes('#validationError')) {
      return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'Describe your trip in a few words.' } });
    }
    if (/#rate[lL]imit(ed)?/.test(prompt)) {
      return json(res, 429, { error: { code: 'RATE_LIMITED', message: 'Too many requests', retryAfterSeconds: 42 } }, { 'Retry-After': '42' });
    }
    const threadId = newThreadId();
    return startRun(res, threadId, scenarios[pickScenario(prompt)]!(threadId));
  }

  if (req.method === 'GET' && url.pathname === '/api/trip-context') {
    const destination = url.searchParams.get('destination') ?? '';
    if (destination.trim().length < 2 || destination.includes('#unknowncity')) {
      return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown place' } });
    }
    const origin = url.searchParams.get('origin');
    return json(res, 200, {
      location: 'Paris, France',
      weather: destination.includes('#noweather')
        ? null
        : { temperatureC: 12, condition: 'Partly cloudy', icon: 'partly-cloudy', todayLowC: 9, todayHighC: 14, outlook: 'rain Saturday' },
      currency: { code: 'EUR', symbol: '€' },
      exchangeRate: destination.includes('#norate') ? null : { base: 'USD', quote: 'EUR', rate: 0.92, asOf: new Date().toISOString() },
      timeZone: 'Europe/Paris',
      originTimeZone: origin ? 'Asia/Tashkent' : null,
      source: 'mock',
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/places') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const all = [
      { label: 'Paris, France', name: 'Paris', detail: 'Île-de-France, France', kind: 'city' },
      { label: 'France', name: 'France', detail: null, kind: 'country' },
      { label: 'London, United Kingdom', name: 'London', detail: 'England, United Kingdom', kind: 'city' },
      { label: 'United Kingdom', name: 'United Kingdom', detail: null, kind: 'country' },
      { label: 'Istanbul, Türkiye', name: 'Istanbul', detail: 'Istanbul, Türkiye', kind: 'city' },
      { label: 'Tokyo, Japan', name: 'Tokyo', detail: 'Tokyo, Japan', kind: 'city' },
      { label: 'Tashkent, Uzbekistan', name: 'Tashkent', detail: 'Tashkent, Uzbekistan', kind: 'city' },
    ];
    return json(res, 200, { places: all.filter((place) => place.label.toLowerCase().includes(q)) });
  }

  const reattach = /^\/api\/trips\/([^/]+)\/stream$/.exec(url.pathname);
  if (req.method === 'GET' && reattach) {
    const threadId = reattach[1]!;
    const run = runs.get(threadId);
    if (!run || run.lost) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Run not found' } });
    if (run.refuse > 0) {
      run.refuse -= 1;
      return json(res, 503, { error: { code: 'INTERNAL', message: 'Agent restarting' } });
    }
    return attach(res, threadId, run, Number(req.headers['last-event-id'] ?? 0) || 0);
  }

  const cancel = /^\/api\/trips\/([^/]+)\/cancel$/.exec(url.pathname);
  if (req.method === 'POST' && cancel) {
    const run = runs.get(cancel[1]!);
    if (!run) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Run not found' } });
    console.log(`cancel ${cancel[1]}`);
    if (!run.done) {
      run.cancelled = true;
      run.done = true;
      publish(run, JSON.stringify(resultPacket(cancel[1]!, { status: 'failed', error: 'Run stopped' })));
      closeAll(run, 'end');
    }
    return void res.writeHead(204).end();
  }

  const resume = /^\/api\/trips\/([^/]+)\/resume$/.exec(url.pathname);
  if (req.method === 'POST' && resume) {
    const threadId = resume[1]!;
    return startRun(res, threadId, scenarios.happy!(threadId));
  }

  const lookup = /^\/api\/trips\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && lookup) {
    const threadId = lookup[1]!;
    const run = runs.get(threadId);
    if (run) {
      return run.result ? json(res, 200, run.result) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Trip not finished' } });
    }
    if (!/^[0-9a-f-]{36}$/i.test(threadId)) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Trip not found' } });
    // Unknown but well-formed id (e.g. after a mock restart): pretend it finished, so deep links keep working.
    return json(res, 200, resultPayload(threadId));
  }

  json(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
}).listen(port, () => console.log(`mock agent on http://localhost:${port} (scenarios: ${Object.keys(scenarios).join(', ')})`));
