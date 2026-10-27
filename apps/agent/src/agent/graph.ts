import { END, MemorySaver, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';
import type { Config } from '../config.js';
import type { TravelSearchTool } from '../tools/index.js';
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
    .addNode('flightAgent', flightNode({ tools }))
    .addNode('hotelAgent', hotelNode({ tools }))
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

/** In-memory checkpoints for now; PostgresSaver replaces it when `DATABASE_URL` is set (B16). */
export function createCheckpointer(_config: Pick<Config, 'DATABASE_URL'>): BaseCheckpointSaver {
  return new MemorySaver();
}
