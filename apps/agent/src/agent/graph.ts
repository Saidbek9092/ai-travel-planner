import { END, MemorySaver, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';
import type { Config } from '../config.js';
import { budgetNode } from './nodes/budget.node.js';
import { flightNode } from './nodes/flight.node.js';
import { hotelNode } from './nodes/hotel.node.js';
import { plannerNode } from './nodes/planner.node.js';
import { supervisorNode } from './nodes/supervisor.node.js';
import { TravelAgentStateAnnotation, type TravelAgentState, type TravelNode } from './state.js';

export interface TravelNodes {
  supervisorAgent: TravelNode;
  flightAgent: TravelNode;
  hotelAgent: TravelNode;
  itineraryPlanner: TravelNode;
  budgetAuditor: TravelNode;
}

export interface GraphDeps {
  checkpointer: BaseCheckpointSaver;
  /** Replaces individual nodes (tests inject failing or spying nodes); the stubs fill the rest. */
  nodes?: Partial<TravelNodes>;
}

export const routeAfterSupervisor = (state: TravelAgentState) => (state.status === 'failed' ? END : 'flightAgent');
export const routeAfterAudit = (state: TravelAgentState) => (state.status === 'searching' ? 'flightAgent' : END);

export function buildGraph({ checkpointer, nodes = {} }: GraphDeps) {
  const all: TravelNodes = {
    supervisorAgent: supervisorNode(),
    flightAgent: flightNode(),
    hotelAgent: hotelNode(),
    itineraryPlanner: plannerNode(),
    budgetAuditor: budgetNode(),
    ...nodes,
  };

  return new StateGraph(TravelAgentStateAnnotation)
    .addNode('supervisorAgent', all.supervisorAgent, { retryPolicy: { maxAttempts: 2 } })
    .addNode('flightAgent', all.flightAgent)
    .addNode('hotelAgent', all.hotelAgent)
    .addNode('itineraryPlanner', all.itineraryPlanner, { retryPolicy: { maxAttempts: 2 } })
    .addNode('budgetAuditor', all.budgetAuditor)
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
