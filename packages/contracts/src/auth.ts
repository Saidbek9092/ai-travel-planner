import { z } from 'zod';

/** The signed-in traveller, as the agent read it from Google. `id` is Google's stable `sub`. */
export const AuthUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  name: z.string().nullable(),
  picture: z.string().nullable(),
});

/** Body of `POST /api/auth/google`: the ID token ("credential") that Google Identity Services gives the browser. */
export const GoogleLoginRequestSchema = z.object({
  credential: z.string().min(1).max(8_192),
});

/**
 * Response of `POST /api/auth/google`. `token` is the agent's own session token; the browser sends it as
 * `Authorization: Bearer <token>`. It is the only proof of who a request is from; the owner id header is not.
 */
export const GoogleLoginResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
  user: AuthUserSchema,
});

/** Response of `POST /api/trips/claim`: how many of this browser's guest trips now belong to the account. */
export const ClaimTripsResponseSchema = z.object({
  claimed: z.number().int().nonnegative(),
});

/** Response of `GET /api/usage`: how many of the account's plans are used (`USER_MAX_RUNS` in total). */
export const UsageResponseSchema = z.object({
  used: z.number().int().nonnegative(),
  max: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
});

export type AuthUser = z.infer<typeof AuthUserSchema>;
export type GoogleLoginRequest = z.infer<typeof GoogleLoginRequestSchema>;
export type GoogleLoginResponse = z.infer<typeof GoogleLoginResponseSchema>;
export type UsageResponse = z.infer<typeof UsageResponseSchema>;
export type ClaimTripsResponse = z.infer<typeof ClaimTripsResponseSchema>;
