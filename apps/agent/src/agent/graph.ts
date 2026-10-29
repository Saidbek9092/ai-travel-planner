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
  /** Releases the Postgres pool; a no-op for memory. */
  close(): Promise<void>;
}

/** `PostgresSaver` when `DATABASE_URL` is set (tables created on boot), `MemorySaver` otherwise. */
export async function createCheckpointer(
  config: Pick<Config, 'DATABASE_URL' | 'NODE_ENV'>,
  logger?: Logger,
): Promise<Checkpointer> {
  if (config.DATABASE_URL === undefined) {
    if (config.NODE_ENV === 'production') {
      logger?.warn('DATABASE_URL not set: runs are kept in memory and cannot be resumed after a restart');
    }
    return { saver: new MemorySaver(), kind: 'memory', close: async () => {} };
  }
  const saver = PostgresSaver.fromConnString(config.DATABASE_URL);
  await saver.setup();
  return { saver, kind: 'postgres', close: () => saver.end() };
}
