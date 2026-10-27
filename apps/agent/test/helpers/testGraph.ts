import { SseEventSchema, type SseEvent } from '@ai-travel/contracts';
import { MemorySaver } from '@langchain/langgraph';
import { buildGraph, type GraphDeps } from '../../src/agent/graph.js';

/** Stub-node graph with in-memory checkpoints; `nodes` replaces individual nodes. */
export const testGraph = (nodes?: GraphDeps['nodes']) =>
  buildGraph({ checkpointer: new MemorySaver(), ...(nodes && { nodes }) });

export interface WirePacket {
  id: number;
  event: SseEvent;
}

/** Parses an SSE body block by block, validating every packet with the contract schema. */
export function parseSse(body: string): WirePacket[] {
  return body
    .split('\n\n')
    .filter((block) => block.trim() !== '' && !block.startsWith(':'))
    .map((block) => {
      const id = /^id: (\d+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (id === undefined || data === undefined) throw new Error(`Malformed SSE block: ${block}`);
      return { id: Number(id), event: SseEventSchema.parse(JSON.parse(data)) };
    });
}
