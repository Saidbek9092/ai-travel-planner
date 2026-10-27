/** Dev/CI-only scripted agent speaking the SSE contract. Never imported from `src/`. */
import { createServer, type ServerResponse } from 'node:http';
import { newThreadId, resultPacket, scenarios, type Step } from '../fixtures/packets.ts';

const port = Number(process.env.PORT ?? (process.env.CONDUCTOR_PORT ? Number(process.env.CONDUCTOR_PORT) + 1 : 4000));
const trips = new Map<string, unknown>();
const delayScale = Number(process.env.MOCK_DELAY_SCALE ?? 1);

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Last-Event-ID');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Thread-Id');
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

async function stream(res: ServerResponse, threadId: string, steps: Step[]) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Thread-Id': threadId,
  });
  res.write(': ping\n\n');
  let closed = false;
  res.on('close', () => (closed = true));
  let id = 0;
  for (const step of steps) {
    if (closed) return;
    if ('end' in step) break;
    await sleep(step.delayMs ?? 0);
    if (closed) return;
    if (Math.random() < 0.2) res.write(': ping\n\n');
    const data = 'raw' in step ? step.raw : JSON.stringify(step.packet);
    if ('packet' in step && step.packet.type === 'RESULT') trips.set(threadId, step.packet.payload);
    res.write(`id: ${++id}\ndata: ${data}\n\n`);
  }
  res.end();
}

async function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
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
    if (prompt.includes('#rateLimited')) {
      return json(res, 429, { error: { code: 'RATE_LIMITED', message: 'Too many requests', retryAfterSeconds: 42 } }, { 'Retry-After': '42' });
    }
    const threadId = newThreadId();
    return void (await stream(res, threadId, scenarios[pickScenario(prompt)]!(threadId)));
  }

  const resume = /^\/api\/trips\/([^/]+)\/resume$/.exec(url.pathname);
  if (req.method === 'POST' && resume) {
    const threadId = resume[1]!;
    return void (await stream(res, threadId, scenarios.happy!(threadId)));
  }

  const lookup = /^\/api\/trips\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && lookup) {
    const result = trips.get(lookup[1]!) ?? resultPacket(lookup[1]!).payload;
    return json(res, 200, result);
  }

  json(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
}).listen(port, () => console.log(`mock agent on http://localhost:${port} (scenarios: ${Object.keys(scenarios).join(', ')})`));
