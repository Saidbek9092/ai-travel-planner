/** Dev/CI-only scripted agent speaking the SSE contract. Never imported from `src/`. */
import {
  MessagePayloadSchema,
  OWNER_ID_HEADER,
  OwnerIdSchema,
  type ErrorCode,
  type MessagePayload,
  type ResultPayload,
  type TripListResponse,
  type TripRecord,
} from '@ai-travel/contracts';
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
  /** `X-Owner-Id` of the request that started it ("My trips"). */
  ownerId: string | null;
  /** Signed-in account that started it (`Authorization: Bearer mock-session:<id>`); `null` for a guest. */
  userId: string | null;
  createdAt: string;
}
const runs = new Map<string, Run>();
/** What the agent reports for a run that has not finished (its `/record` and `GET /api/trips/:id` read it as a failed trip). */
const STOPPED_ERROR = 'Trip planning stopped before it finished, resume to continue';

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, Accept, Last-Event-ID, Authorization, ${OWNER_ID_HEADER}`);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Thread-Id, Retry-After');
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/** JSON error in the agent's `ErrorBody` shape; codes are the contract's. */
function fail(res: ServerResponse, status: number, code: ErrorCode, message: string, extra: { retryAfterSeconds?: number } = {}, headers: Record<string, string> = {}) {
  json(res, status, { error: { code, message, ...extra } }, headers);
}

function ownerOf(req: IncomingMessage): string | null {
  const parsed = OwnerIdSchema.safeParse(req.headers[OWNER_ID_HEADER.toLowerCase()]);
  return parsed.success ? parsed.data : null;
}

/** The account of a request. The mock trusts `Bearer mock-session:<id>` (e2e seeds one); the real agent verifies a signed token. */
function userOf(req: IncomingMessage): string | null {
  return /^Bearer mock-session:(\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
}

/** An account's trip is hidden from everyone else, like the agent does. */
const hiddenFrom = (run: Run | undefined, req: IncomingMessage) => !!run?.userId && run.userId !== userOf(req);

/** The chat of a run, from its MESSAGE packets (what the agent stores with the trip). */
function messagesOf(run: Run): MessagePayload[] {
  return run.events.flatMap(({ data }) => {
    try {
      const packet = JSON.parse(data) as { type?: string; payload?: unknown };
      const parsed = packet.type === 'MESSAGE' ? MessagePayloadSchema.safeParse(packet.payload) : null;
      return parsed?.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
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

function startRun(res: ServerResponse, threadId: string, steps: Step[], ownerId: string | null, userId: string | null) {
  const previous = runs.get(threadId);
  const run: Run = {
    events: [],
    subscribers: new Set(),
    done: false,
    lost: false,
    cancelled: false,
    result: null,
    refuse: steps.some((step) => 'drop' in step) ? 2 : 0,
    ownerId: previous?.ownerId ?? ownerId,
    userId: previous?.userId ?? userId,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
  };
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
      return fail(res, 400, 'VALIDATION_ERROR', 'Describe your trip in a few words.');
    }
    if (/#rate[lL]imit(ed)?/.test(prompt)) {
      return fail(res, 429, 'RATE_LIMITED', 'Too many requests', { retryAfterSeconds: 42 }, { 'Retry-After': '42' });
    }
    if (prompt.includes('#dailyLimit')) {
      return fail(res, 429, 'RATE_LIMITED', "You've reached today's limit of trips from this address, please try again tomorrow", { retryAfterSeconds: 75_600 }, { 'Retry-After': '75600' });
    }
    const threadId = newThreadId();
    return startRun(res, threadId, scenarios[pickScenario(prompt)]!(threadId), ownerOf(req), userOf(req));
  }

  if (req.method === 'GET' && url.pathname === '/api/trips') {
    const ownerId = ownerOf(req);
    const userId = userOf(req);
    if (!ownerId && !userId) return fail(res, 400, 'VALIDATION_ERROR', `${OWNER_ID_HEADER} header must be a UUID`);
    const trips: TripListResponse['trips'] = [...runs.values()]
      .filter((run) => (userId ? run.userId === userId : run.ownerId === ownerId && run.userId === null) && run.result !== null)
      .map((run) => {
        const result = run.result as ResultPayload;
        const { threadId, status, origin, destination, durationDays, startDate, totalCost, budget } = result;
        return { threadId, status, origin, destination, durationDays, startDate, totalCost, budget, createdAt: run.createdAt, updatedAt: run.createdAt };
      })
      .reverse();
    return json(res, 200, { trips } satisfies TripListResponse);
  }

  if (req.method === 'GET' && url.pathname === '/api/trip-context') {
    const destination = url.searchParams.get('destination') ?? '';
    if (destination.trim().length < 2 || destination.includes('#unknowncity')) {
      return fail(res, 404, 'NOT_FOUND', 'Unknown place');
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
    if (!run || run.lost || hiddenFrom(run, req)) return fail(res, 404, 'NOT_FOUND', 'Run not found');
    if (run.refuse > 0) {
      run.refuse -= 1;
      return fail(res, 503, 'INTERNAL', 'Agent restarting');
    }
    return attach(res, threadId, run, Number(req.headers['last-event-id'] ?? 0) || 0);
  }

  const cancel = /^\/api\/trips\/([^/]+)\/cancel$/.exec(url.pathname);
  if (req.method === 'POST' && cancel) {
    const run = runs.get(cancel[1]!);
    if (!run || hiddenFrom(run, req)) return fail(res, 404, 'NOT_FOUND', 'Run not found');
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
    // Like the agent: a run that is still going can't be resumed (the client follows its stream instead), and an id that
    // can't be a thread is unknown.
    if (runs.get(threadId)?.done === false) return fail(res, 409, 'CONFLICT', 'This trip is still running');
    if (!runs.has(threadId) && !/^[0-9a-f-]{36}$/i.test(threadId)) return fail(res, 404, 'NOT_FOUND', 'Trip not found');
    return startRun(res, threadId, scenarios.happy!(threadId), ownerOf(req), userOf(req));
  }

  const record = /^\/api\/trips\/([^/]+)\/record$/.exec(url.pathname);
  if (req.method === 'GET' && record) {
    const run = runs.get(record[1]!);
    if (!run || hiddenFrom(run, req)) return fail(res, 404, 'NOT_FOUND', 'Trip not found');
    const result = (run.result as ResultPayload | null) ?? resultPayload(record[1]!, { status: 'failed', error: STOPPED_ERROR });
    return json(res, 200, { result, messages: messagesOf(run), createdAt: run.createdAt, updatedAt: run.createdAt } satisfies TripRecord);
  }

  const lookup = /^\/api\/trips\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'DELETE' && lookup) {
    const run = runs.get(lookup[1]!);
    if (!run || hiddenFrom(run, req)) return fail(res, 404, 'NOT_FOUND', 'Trip not found');
    runs.delete(lookup[1]!);
    res.writeHead(204).end();
    return;
  }
  if (req.method === 'GET' && lookup) {
    const threadId = lookup[1]!;
    const run = runs.get(threadId);
    if (hiddenFrom(run, req)) return fail(res, 404, 'NOT_FOUND', 'Trip not found');
    if (run) {
      return json(res, 200, run.result ?? resultPayload(threadId, { status: 'failed', error: STOPPED_ERROR }));
    }
    if (!/^[0-9a-f-]{36}$/i.test(threadId)) return fail(res, 404, 'NOT_FOUND', 'Trip not found');
    // Unknown but well-formed id (e.g. after a mock restart): pretend it finished, so deep links keep working.
    return json(res, 200, resultPayload(threadId));
  }

  fail(res, 404, 'NOT_FOUND', 'Not found');
}).listen(port, () => console.log(`mock agent on http://localhost:${port} (scenarios: ${Object.keys(scenarios).join(', ')})`));
