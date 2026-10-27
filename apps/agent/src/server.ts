import express from 'express';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = express();

app.listen(config.PORT, (error) => {
  if (error) {
    console.error(`Failed to start on port ${config.PORT}: ${error.message}`);
    process.exit(1);
  }
  console.log(`ai-travel-agent listening on port ${config.PORT} (${config.NODE_ENV})`);
});
