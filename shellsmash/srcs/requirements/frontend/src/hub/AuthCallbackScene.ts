/**
 * AuthCallbackScene.ts — DEPRECATED, kept for reference only.
 *
 * The old flow stored a JWT from ?token= in localStorage and forwarded to
 * HubScene. This is no longer used:
 *
 *  • The backend's GET /auth/42/callback now sets an httpOnly auth cookie
 *    and redirects to "/" with no token in the URL.
 *  • LandingScene (registered first in main.ts) checks the session via
 *    GET /api/auth/me on every page load and transitions to HubScene if
 *    a valid cookie is present.
 *
 * This file is NOT registered in main.ts and will be removed in a
 * follow-up cleanup commit. Do NOT re-add localStorage here.
 * TODO(#2): delete this file once the team has migrated fully to cookie auth.
 */
