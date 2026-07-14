# OAuth Setup Guide

Shell Smash supports two OAuth providers: 42 and Google. No other OAuth
provider is exposed or configured by the application.

## Credential storage

OAuth client credentials must not be stored in `.env.example`.

- Public callback URLs stay in `.env` and `.env.example`.
- `CLIENT_ID` and `CLIENT_SECRET` values belong in
  `secrets/vault/dev-seed.env`.
- `make vault-seed-dev` writes the credentials to Vault.
- The backend receives them through `/vault/secrets/backend.env`.

## Bootstrap order

```bash
cp .env.example .env
make vault-init
make vault-unseal
make vault-seed-dev
make up
```

If `secrets/vault/dev-seed.env` does not exist, `make vault-seed-dev` creates it
with empty credential slots for both providers. After filling them in, rerun:

```bash
make vault-seed-dev
```

## Credentials

```env
FORTYTWO_CLIENT_ID=
FORTYTWO_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

## Callback URLs

```env
FORTYTWO_CALLBACK_URL=https://localhost:42424/api/auth/42/callback
GOOGLE_CALLBACK_URL=https://localhost:42424/api/auth/google/callback
```

Register these exact callback URLs with each provider. For non-local
deployments, replace the origin while keeping the callback paths unchanged.

## Validation

Test each provider end to end after changing its credentials:

1. Update `secrets/vault/dev-seed.env`.
2. Run `make vault-seed-dev`.
3. Restart the affected services.
4. Start the flow from the sign-in page.
5. Confirm that the callback creates or reuses the account and redirects to the
   authenticated home page.
