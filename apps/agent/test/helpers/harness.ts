import { SseEventSchema, type SseEvent } from '@ai-travel/contracts';
import { MemorySaver } from '@langchain/langgraph';
import type { Test } from 'supertest';
import { buildGraph } from '../../src/agent/graph.js';
import { RunRegistry } from '../../src/agent/runRegistry.js';
import { createApp } from '../../src/app.js';
import { parseConfig, type Config } from '../../src/config.js';
import { createMemoryTripStore } from '../../src/storage/tripStore.js';
import { createTravelTool } from '../../src/tools/index.js';
import { createLogger, type Logger } from '../../src/utils/logger.js';
import { createFakeLlm, type ParsedTrip } from './fakeLlm.js';

export const silentLogger: Logger = createLogger({ silent: true });

/** Test config: mock tools, memory checkpointer, no keys that reach a vendor. */
export function testConfig(env: Record<string, string> = {}): Config {
  return parseConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'test-key', TOOLS_MODE: 'mock', ...env });
}

/** The real graph on mock tools, a fake LLM and `MemorySaver`: a full run with no network. */
export function testGraph(trip: Partial<ParsedTrip> = {}, config = testConfig()) {
  const llm = createFakeLlm(trip);
  const graph = buildGraph({ checkpointer: new MemorySaver(), tools: createTravelTool(config), llm });
  return { graph, llm };
}

/** The whole Express app wired like `server.ts`, but in memory. */
export function testApp({ trip = {}, env = {} }: { trip?: Partial<ParsedTrip>; env?: Record<string, string> } = {}) {
  const config = testConfig(env);
  const { graph, llm } = testGraph(trip, config);
  const trips = createMemoryTripStore();
  const registry = new RunRegistry({ graph, config, checkpointer: 'memory', logger: silentLogger, trips });
  const app = createApp({ config, logger: silentLogger, graph, registry, trips });
  return { app, registry, trips, llm, config };
}

export interface SsePacket {
  id: number | null;
  event: SseEvent;
}

/** Parses a finished `text/event-stream` body; every packet must match the contract. */
export function parseSse(body: string): SsePacket[] {
  return body
    .split('\n\n')
    .filter((block) => block.includes('data: '))
    .map((block) => {
      const id = /^id: (\d+)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? '';
      return { id: id === undefined ? null : Number(id), event: SseEventSchema.parse(JSON.parse(data)) };
    });
}

/** supertest parser that reads a whole `text/event-stream` response as text (`.buffer(true).parse(sseText)`). */
export const sseText: Parameters<Test['parse']>[0] = (res, done) => {
  const stream = res as unknown as NodeJS.ReadableStream;
  let body = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => (body += chunk));
  stream.on('end', () => done(null, body));
};
