import { buildGraph, createCheckpointer } from './agent/graph.js';
import { createLlmFactory } from './agent/llm.js';
import { RunRegistry } from './agent/runRegistry.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createTripStore } from './storage/tripStore.js';
import { createTravelTool } from './tools/index.js';
import { createLogger } from './utils/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;
const READINESS_TIMEOUT_MS = 2_000;

const config = loadConfig();
const logger = createLogger();
const tools = createTravelTool(config, (reason) => logger.warn('live search unavailable, using mock data', { reason }));
const checkpointer = await createCheckpointer(config, logger);
const graph = buildGraph({
  checkpointer: checkpointer.saver,
  tools,
  llm: createLlmFactory(config),
  ...(config.TAVILY_API_KEY && { tavilyApiKey: config.TAVILY_API_KEY }),
});
const trips = await createTripStore(config, logger);
const registry = new RunRegistry({ graph, config, checkpointer: checkpointer.kind, logger, trips });

/** Problems that stop this instance serving trips: an unreachable database or a missing key. Empty = ready. */
async function readiness(): Promise<string[]> {
  const problems: string[] = [];
  if (config.TOOLS_MODE === 'live' && config.SERPAPI_API_KEY === undefined) problems.push('SERPAPI_API_KEY is missing');
  try {
    await Promise.race([
      checkpointer.ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), READINESS_TIMEOUT_MS).unref()),
    ]);
  } catch (error) {
    problems.push(`database unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return problems;
}

const app = createApp({ config, logger, graph, registry, trips, readiness });

const server = app.listen(config.PORT, (error) => {
  if (error) {
    logger.error('failed to start', { port: config.PORT, error: error.message });
    process.exit(1);
  }
  logger.info('agent listening', {
    port: config.PORT,
    env: config.NODE_ENV,
    webOrigin: config.WEB_ORIGIN,
    toolsMode: config.TOOLS_MODE,
    checkpointer: checkpointer.kind,
  });
  // RunRegistry and its replay buffer live in this process, so two instances would lose each other's runs.
  logger.warn('single-instance mode: runs and replay buffers are held in process memory; do not run more than one agent instance');
});

/** Stops accepting connections, fails open runs with a "resume" message, closes the pool, exits within 10 s. */
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal, activeRuns: registry.size });
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();

  server.close(() => {
    Promise.all([checkpointer.close(), trips.close()])
      .catch((error: unknown) => logger.error('closing checkpointer failed', { error: String(error) }))
      .finally(() => process.exit(0));
  });
  server.closeIdleConnections();
  // Aborted runs still write their failed RESULT, then their streams end and the server can close.
  registry.abortAll();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
