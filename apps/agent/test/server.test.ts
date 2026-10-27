import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { createErrorHandler } from '../src/middlewares/errorHandler.js';
import { createRateLimiters } from '../src/middlewares/rateLimiter.js';
import { AppError } from '../src/utils/errors.js';
import { createLogger } from '../src/utils/logger.js';
import { TEST_WEB_ORIGIN, testConfig } from './helpers/testConfig.js';

const logger = createLogger({ silent: true });
const makeApp = (generalMax?: number) => {
  const config = testConfig();
  return createApp({
    config,
    logger,
    rateLimiters: createRateLimiters(config, generalMax === undefined ? {} : { generalMax }),
  });
};

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(makeApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('is not rate limited', async () => {
    const app = makeApp(1);
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/health')).status).toBe(200);
    }
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(makeApp()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('unknown routes', () => {
  it('return the standard 404 body', async () => {
    const res = await request(makeApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route GET /api/nope not found' } });
  });
});

describe('CORS', () => {
  it('allows the configured web origin and exposes X-Thread-Id', async () => {
    const res = await request(makeApp()).get('/health').set('Origin', TEST_WEB_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(res.headers['access-control-expose-headers']).toBe('X-Thread-Id');
  });

  it('answers preflight for POST with a JSON body', async () => {
    const res = await request(makeApp())
      .options('/api/trips')
      .set('Origin', TEST_WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(res.headers['access-control-allow-methods']).toBe('GET,POST');
  });

  it('does not allow other origins', async () => {
    const res = await request(makeApp()).get('/health').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('request bodies', () => {
  it('rejects bodies over 10 kb', async () => {
    const res = await request(makeApp())
      .post('/api/trips')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ prompt: 'x'.repeat(11 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON', async () => {
    const res = await request(makeApp())
      .post('/api/trips')
      .set('Content-Type', 'application/json')
      .send('{"prompt":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' } });
  });
});

describe('rate limiting', () => {
  it('returns 429 RATE_LIMITED with standard headers after the general limit', async () => {
    const app = makeApp(2);
    await request(app).get('/api/nope');
    await request(app).get('/api/nope');
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['ratelimit-policy']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('limits run-starting routes by RATE_LIMIT_MAX_RUNS', async () => {
    const { runLimiter } = createRateLimiters(testConfig({ RATE_LIMIT_MAX_RUNS: '1' }));
    const app = express();
    app.post('/run', runLimiter, (_req, res) => {
      res.json({ ok: true });
    });
    app.use(createErrorHandler(logger));

    expect((await request(app).post('/run')).status).toBe(200);
    const res = await request(app).post('/run');
    expect(res.status).toBe(429);
    expect(res.body.error).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many trips planned from this address, please try again later',
    });
  });
});

describe('error handler', () => {
  const appThrowing = (error: unknown, { streamOpen = false } = {}) => {
    const app = express();
    app.get('/boom', (_req, res) => {
      if (streamOpen) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {}\n\n');
      }
      throw error;
    });
    app.use(createErrorHandler(logger));
    return app;
  };

  it('passes AppError code, status and message through', async () => {
    const res = await request(appThrowing(new AppError('NOT_FOUND', 'Trip not found', 404))).get('/boom');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Trip not found' } });
  });

  it('maps ZodError to 400 with the issues in the message', async () => {
    const result = z.object({ prompt: z.string() }).safeParse({});
    const res = await request(appThrowing(result.error)).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('prompt');
  });

  it('hides unknown errors behind a generic 500', async () => {
    const res = await request(appThrowing(new Error('db password is hunter2'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  it('does not write JSON once a stream is open', async () => {
    const res = await request(appThrowing(new Error('mid-stream'), { streamOpen: true })).get('/boom');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.text).toBe('data: {}\n\n');
  });
});
