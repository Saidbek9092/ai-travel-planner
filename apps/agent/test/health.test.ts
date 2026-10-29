import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers/harness.js';

describe('health endpoints', () => {
  it('/health stays 200 even when a dependency is down (liveness)', async () => {
    const { app } = testApp({ readiness: async () => ['database unreachable: connection refused'] });
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('/readyz is 200 when every dependency is reachable', async () => {
    const { app } = testApp({ readiness: async () => [] });
    const response = await request(app).get('/readyz');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
  });

  it('/readyz is 503 and lists the problem when the database is unreachable', async () => {
    const { app } = testApp({ readiness: async () => ['database unreachable: connection refused'] });
    const response = await request(app).get('/readyz');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'unavailable', problems: ['database unreachable: connection refused'] });
  });

  it('/readyz is 503 when the readiness check itself throws', async () => {
    const { app } = testApp({
      readiness: async () => {
        throw new Error('timed out');
      },
    });
    const response = await request(app).get('/readyz');
    expect(response.status).toBe(503);
    expect(response.body.problems).toEqual(['timed out']);
  });
});
