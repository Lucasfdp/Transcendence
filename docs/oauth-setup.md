# OAuth Setup Guide

This document lists the steps needed to make local login, 42 OAuth, and GitHub OAuth work in `Shell Smash`.

## 1. Local login

The local username/password flow depends on the backend auth endpoints already present in NestJS:

- `GET /api/auth/csrf-token`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me`

Before testing the frontend flow, verify:

1. The backend container is running.
2. The reverse proxy serves the app over `https://localhost`.
3. Cookies are preserved through Nginx.
4. The backend can issue and read the auth cookie correctly.

## 2. 42 OAuth credentials

### Create the app

1. Log into the 42 developer/intra portal with the account that will own the app.
2. Create a new OAuth application.
3. Fill in the basic app metadata.
4. Set the redirect URI to:

```text
https://localhost/api/auth/42/callback
```

### Save the credentials

After creating the app, copy:

- `FORTYTWO_CLIENT_ID`
- `FORTYTWO_CLIENT_SECRET`

### Configure the project

Add these variables to your local `.env`:

```env
FORTYTWO_CLIENT_ID=your_42_client_id
FORTYTWO_CLIENT_SECRET=your_42_client_secret
FORTYTWO_CALLBACK_URL=https://localhost/api/auth/42/callback
```

Also add the same keys to `.env.example` with placeholder values.

### Backend status

The backend now expects this flow:

1. Frontend redirects to `GET /api/auth/42`.
2. Passport sends the browser to 42.
3. 42 calls back to `GET /api/auth/42/callback`.
4. The backend issues the auth cookie and redirects back to `/`.

You should still verify the full callback flow locally after setting the credentials.

## 3. GitHub OAuth credentials

### Create the GitHub OAuth app

1. Open GitHub.
2. Go to `Settings > Developer settings > OAuth Apps`.
3. Click `New OAuth App`.
4. Fill the fields:
    - `Application name`: choose your app name
    - `Homepage URL`: `https://localhost`
    - `Authorization callback URL`: `https://localhost/api/auth/github/callback`
5. Create the app.

### Save the credentials

Copy these values:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

### Configure the project

Add them to `.env`:

```env
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=https://localhost/api/auth/github/callback
VITE_GITHUB_AUTH_URL=/api/auth/github
```

Also mirror them in `.env.example` with placeholder values.

### Backend work still required

GitHub OAuth is not implemented yet in NestJS. To make the button work you still need:

1. Install a GitHub Passport strategy such as `passport-github2`.
2. Create `github.strategy.ts`.
3. Create `GithubAuthGuard`.
4. Add backend routes:
    - `GET /api/auth/github`
    - `GET /api/auth/github/callback`
5. Find or create the local user from the GitHub profile.
6. Issue the auth cookie and redirect back to `/`.

## 4. HTTPS and callback checklist

OAuth providers are strict about callback URLs. Before testing, confirm:

1. The callback URL in the provider dashboard exactly matches the backend callback URL.
2. You are really serving the app via `https://localhost`.
3. The browser trusts your local certificate or accepts it.
4. Nginx forwards `/api/auth/...` correctly to the backend.
5. The backend cookie settings are compatible with your local HTTPS setup.

## 5. Quick test order

Use this order to reduce confusion:

1. Test local login first.
2. Finish 42 backend integration and test `/api/auth/42`.
3. Implement GitHub backend integration and test `/api/auth/github`.
4. Re-test `/auth`, `/`, and `/game` route flow end-to-end.
