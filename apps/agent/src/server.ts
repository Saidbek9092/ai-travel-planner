import { buildGraph, createCheckpointer } from './agent/graph.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const logger = createLogger();
const graph = buildGraph({ checkpointer: createCheckpointer(config) });
const app = createApp({ config, logger, graph });

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
  });
});

// Active trip streams are aborted here once runs exist (B17); for now just drain and exit.
function shutdown(signal: NodeJS.Signals) {
  logger.info('shutting down', { signal });
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  server.close(() => process.exit(0));
  server.closeIdleConnections();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
