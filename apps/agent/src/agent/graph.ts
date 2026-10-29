import { END, MemorySaver, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { Config } from '../config.js';
import type { TravelSearchTool } from '../tools/index.js';
import type { Logger } from '../utils/logger.js';
import type { LlmFactory } from './llm.js';
import { budgetNode } from './nodes/budget.node.js';
import { flightNode } from './nodes/flight.node.js';
import { hotelNode } from './nodes/hotel.node.js';
import { plannerNode } from './nodes/planner.node.js';
import { supervisorNode } from './nodes/supervisor.node.js';
import { TravelAgentStateAnnotation, type TravelAgentState } from './state.js';

export interface GraphDeps {
  checkpointer: BaseCheckpointSaver;
  tools: TravelSearchTool;
  llm: LlmFactory;
  tavilyApiKey?: string;
}

export const routeAfterSupervisor = (state: TravelAgentState) => (state.status === 'failed' ? END : 'flightAgent');
export const routeAfterAudit = (state: TravelAgentState) => (state.status === 'searching' ? 'flightAgent' : END);

export function buildGraph({ checkpointer, tools, llm, tavilyApiKey }: GraphDeps) {
  return new StateGraph(TravelAgentStateAnnotation)
    .addNode('supervisorAgent', supervisorNode({ llm }), { retryPolicy: { maxAttempts: 2 } })
    .addNode('flightAgent', flightNode({ tools, llm }))
    .addNode('hotelAgent', hotelNode({ tools, llm }))
    .addNode('itineraryPlanner', plannerNode({ tools, llm, ...(tavilyApiKey && { tavilyApiKey }) }), { retryPolicy: { maxAttempts: 2 } })
    .addNode('budgetAuditor', budgetNode())
    .addEdge(START, 'supervisorAgent')
    .addConditionalEdges('supervisorAgent', routeAfterSupervisor, ['flightAgent', END])
    .addEdge('flightAgent', 'hotelAgent')
    .addEdge('hotelAgent', 'itineraryPlanner')
    .addEdge('itineraryPlanner', 'budgetAuditor')
    .addConditionalEdges('budgetAuditor', routeAfterAudit, ['flightAgent', END])
    .compile({ checkpointer });
}

export type CompiledTravelGraph = ReturnType<typeof buildGraph>;

export interface Checkpointer {
  saver: BaseCheckpointSaver;
  kind: 'memory' | 'postgres';
  /** Rejects when the store cannot be reached; resolves at once for memory. */
  ping(): Promise<void>;
  /** Releases the Postgres pool; a no-op for memory. */
  close(): Promise<void>;
}

/** `PostgresSaver` when `DATABASE_URL` is set (tables created on boot), `MemorySaver` otherwise (never in production). */
export async function createCheckpointer(
  config: Pick<Config, 'DATABASE_URL' | 'NODE_ENV'>,
  logger?: Logger,
): Promise<Checkpointer> {
  if (config.DATABASE_URL === undefined) {
    // `loadConfig` already refuses this in production; guard here too for callers that build a config by hand.
    if (config.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production');
    logger?.info('DATABASE_URL not set: runs are kept in memory and cannot be resumed after a restart');
    return { saver: new MemorySaver(), kind: 'memory', ping: async () => {}, close: async () => {} };
  }
  const saver = PostgresSaver.fromConnString(config.DATABASE_URL);
  await saver.setup();
  // Reading a thread that does not exist is a cheap round trip through the pool.
  const ping = async () => void (await saver.getTuple({ configurable: { thread_id: '__readyz__' } }));
  return { saver, kind: 'postgres', ping, close: () => saver.end() };
}
