# OAuth Setup Guide

This document lists how OAuth credentials are stored in `Shell Smash` and which
providers already have config slots prepared.

## 1. Where credentials go

OAuth client credentials are not meant to live in `.env.example`.

- Public bootstrap config stays in `.env` / `.env.example`.
- Sensitive values such as `CLIENT_ID` and `CLIENT_SECRET` go in
  `secrets/vault/dev-seed.env`.
- `make vault-seed-dev` writes those values into Vault.
- The backend receives them through `/vault/secrets/backend.env`.

## 2. Bootstrap order

Run the local stack in this order:

```bash
cp .env.example .env
make vault-init
make vault-unseal
make vault-seed-dev
make up
```

If `secrets/vault/dev-seed.env` does not exist yet, `make vault-seed-dev` will
create it with empty OAuth slots.

After editing `secrets/vault/dev-seed.env`, rerun:

```bash
make vault-seed-dev
```

## 3. Prepared providers

The repo already has `CLIENT_ID` and `CLIENT_SECRET` slots prepared for:

- `FORTYTWO`
- `GITHUB`
- `GOOGLE`
- `REDDIT`
- `STEAM`
- `XBOX`
- `NINTENDO`
- `PLAYSTATION`
- `CHATGPT`
- `CLAUDE`
- `DEEPSEEK`
- `PERPLEXITY`

For each provider, the secret names follow this pattern:

```env
<PROVIDER>_CLIENT_ID=
<PROVIDER>_CLIENT_SECRET=
```

Examples:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
```

## 4. Callback URLs

Callback URLs are public config, so they stay in `.env` / `.env.example`.

Prepared callback variables:

```env
FORTYTWO_CALLBACK_URL=https://localhost:42424/api/auth/42/callback
GITHUB_CALLBACK_URL=https://localhost:42424/api/auth/github/callback
GOOGLE_CALLBACK_URL=https://localhost:42424/api/auth/google/callback
REDDIT_CALLBACK_URL=https://localhost:42424/api/auth/reddit/callback
STEAM_CALLBACK_URL=https://localhost:42424/api/auth/steam/callback
XBOX_CALLBACK_URL=https://localhost:42424/api/auth/xbox/callback
NINTENDO_CALLBACK_URL=https://localhost:42424/api/auth/nintendo/callback
PLAYSTATION_CALLBACK_URL=https://localhost:42424/api/auth/playstation/callback
CHATGPT_CALLBACK_URL=https://localhost:42424/api/auth/chatgpt/callback
CLAUDE_CALLBACK_URL=https://localhost:42424/api/auth/claude/callback
DEEPSEEK_CALLBACK_URL=https://localhost:42424/api/auth/deepseek/callback
PERPLEXITY_CALLBACK_URL=https://localhost:42424/api/auth/perplexity/callback
```

## 5. What is already implemented

At the moment, only `42` and `GitHub` have backend strategy wiring in the repo.
The other providers are only prepared at config level for now.

That means the current work done here is:

- secret slots exist in Vault seed/bootstrap flow
- callback env vars exist in bootstrap config
- backend rendered env includes all provider credentials

It does not mean every provider route/strategy is implemented yet.

## 6. Testing one provider at a time

Recommended flow:

1. Put one provider's credentials into `secrets/vault/dev-seed.env`.
2. Rerun `make vault-seed-dev`.
3. Restart the affected services if needed.
4. Implement or adjust that provider's backend route/strategy.
5. Test the login flow end-to-end before moving to the next provider.
