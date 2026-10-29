import { GoogleLoginResponseSchema, TripListResponseSchema } from '@ai-travel/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { verifyGoogleCredential } from '../src/auth/google.js';
import { SESSION_TTL_MS, signSession, verifySession } from '../src/auth/session.js';
import { parseSse, sseText, testApp } from './helpers/harness.js';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const SECRET = 'x'.repeat(40);
const OWNER = '0b6f8f9e-2c1d-4c3b-9a8e-7f6d5c4b3a21';
const ALICE = { id: 'google-alice', email: 'alice@example.com', name: 'Alice', picture: null };

/** A fake Google `tokeninfo`: the credential "alice-token" / "bob-token" is valid, "wrong-aud" is for another app. */
const googleFetch: typeof fetch = async (input) => {
  const credential = new URL(String(input)).searchParams.get('id_token') ?? '';
  const exp = String(Math.floor(Date.now() / 1000) + 3600);
  const base = { iss: 'https://accounts.google.com', exp, email_verified: 'true', aud: CLIENT_ID };
  const users: Record<string, object> = {
    'alice-token': { ...base, sub: 'google-alice', email: 'alice@example.com', name: 'Alice' },
    'bob-token': { ...base, sub: 'google-bob', email: 'bob@example.com' },
    'wrong-aud': { ...base, aud: 'someone-else', sub: 'google-eve', email: 'eve@example.com' },
    'unverified': { ...base, sub: 'google-x', email: 'x@example.com', email_verified: 'false' },
  };
  const body = users[credential];
  return body ? Response.json(body) : new Response('{"error":"invalid_token"}', { status: 400 });
};

const authedApp = () => testApp({ env: { GOOGLE_CLIENT_ID: CLIENT_ID, SESSION_SECRET: SECRET }, fetch: googleFetch });

async function signIn(app: ReturnType<typeof testApp>['app'], credential: string) {
  const response = await request(app).post('/api/auth/google').send({ credential });
  return { response, token: response.status === 200 ? GoogleLoginResponseSchema.parse(response.body).token : '' };
}

describe('session token', () => {
  it('round-trips a user', () => {
    expect(verifySession(signSession(ALICE, SECRET).token, SECRET)).toEqual(ALICE);
  });

  it('rejects a tampered, foreign or expired token', () => {
    const { token } = signSession(ALICE, SECRET);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'google-bob', email: 'b', name: null, picture: null, exp: 9_999_999_999 })).toString('base64url');
    expect(verifySession(`${header}.${forged}.${signature}`, SECRET)).toBeNull();
    expect(verifySession(token, 'y'.repeat(40))).toBeNull();
    expect(verifySession(token, SECRET, Date.now() + SESSION_TTL_MS + 1_000)).toBeNull();
    expect(verifySession('garbage', SECRET)).toBeNull();
  });
});

describe('Google credential check', () => {
  it('accepts a credential for our client and refuses the rest', async () => {
    expect(await verifyGoogleCredential('alice-token', CLIENT_ID, googleFetch)).toMatchObject({ id: 'google-alice' });
    expect(await verifyGoogleCredential('wrong-aud', CLIENT_ID, googleFetch)).toBeNull();
    expect(await verifyGoogleCredential('unverified', CLIENT_ID, googleFetch)).toBeNull();
    expect(await verifyGoogleCredential('nope', CLIENT_ID, googleFetch)).toBeNull();
  });
});

describe('POST /api/auth/google', () => {
  it('signs the user in', async () => {
    const { response } = await signIn(authedApp().app, 'alice-token');
    expect(response.status).toBe(200);
    expect(GoogleLoginResponseSchema.parse(response.body).user).toMatchObject({ id: 'google-alice', email: 'alice@example.com' });
  });

  it('answers 401 for a credential meant for another app', async () => {
    const { response } = await signIn(authedApp().app, 'wrong-aud');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('answers 404 when sign-in is not configured', async () => {
    const { response } = await signIn(testApp().app, 'alice-token');
    expect(response.status).toBe(404);
  });

  it('rejects a bad token on any route with 401', async () => {
    const response = await request(authedApp().app).get('/api/trips').set('Authorization', 'Bearer nope').set('X-Owner-Id', OWNER);
    expect(response.status).toBe(401);
  });
});

describe('own trips only', () => {
  async function plan(app: ReturnType<typeof testApp>['app'], token?: string) {
    const post = request(app).post('/api/trips').set('X-Owner-Id', OWNER).send({ prompt: '3 days in Paris from Tashkent' });
    if (token) post.set('Authorization', `Bearer ${token}`);
    const response = await post.buffer(true).parse(sseText);
    parseSse(response.body as string);
    return response.headers['x-thread-id'] as string;
  }
  const list = async (app: ReturnType<typeof testApp>['app'], token: string) =>
    TripListResponseSchema.parse((await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`)).body).trips.map((trip) => trip.threadId);

  it('lists only the signed-in user’s trips and hides them from other accounts and guests', async () => {
    const { app } = authedApp();
    const alice = (await signIn(app, 'alice-token')).token;
    const bob = (await signIn(app, 'bob-token')).token;
    const aliceTrip = await plan(app, alice);
    const bobTrip = await plan(app, bob);

    expect(await list(app, alice)).toEqual([aliceTrip]);
    expect(await list(app, bob)).toEqual([bobTrip]);

    for (const path of [`/api/trips/${aliceTrip}`, `/api/trips/${aliceTrip}/record`]) {
      expect((await request(app).get(path).set('Authorization', `Bearer ${bob}`)).status).toBe(404);
      expect((await request(app).get(path)).status).toBe(404);
      expect((await request(app).get(path).set('Authorization', `Bearer ${alice}`)).status).toBe(200);
    }
    expect((await request(app).post(`/api/trips/${aliceTrip}/resume`).set('Authorization', `Bearer ${bob}`)).status).toBe(404);
    // Signed-in trips never show up in the guest list of the same browser.
    const guest = TripListResponseSchema.parse((await request(app).get('/api/trips').set('X-Owner-Id', OWNER)).body);
    expect(guest.trips).toEqual([]);
  });

  it('keeps guest trips open by link and moves them to the account on claim', async () => {
    const { app } = authedApp();
    const guestTrip = await plan(app);
    expect((await request(app).get(`/api/trips/${guestTrip}/record`)).status).toBe(200);

    const alice = (await signIn(app, 'alice-token')).token;
    expect(await list(app, alice)).toEqual([]);

    const claim = await request(app).post('/api/trips/claim').set('Authorization', `Bearer ${alice}`).set('X-Owner-Id', OWNER);
    expect(claim.body).toEqual({ claimed: 1 });
    expect(await list(app, alice)).toEqual([guestTrip]);
    expect((await request(app).get(`/api/trips/${guestTrip}/record`)).status).toBe(404);
    expect((await request(app).post('/api/trips/claim').set('X-Owner-Id', OWNER)).status).toBe(401);
  });
});
