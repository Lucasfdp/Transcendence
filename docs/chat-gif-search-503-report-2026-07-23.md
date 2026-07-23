# Chat GIF search 503 — diagnostic report (2026-07-23)

## Summary

Opening the GIF picker in a chat and searching returns the frontend message
**"GIF search is unavailable right now."** and the browser console shows a
**503 Service Unavailable** on `GET /api/chat/gifs/search`.

The 503 is not an upstream (Klipy) outage. It is the backend refusing to call
Klipy because the `KLIPY_APP_KEY` secret is not validly provisioned. The root
cause is a **corrupted development seed file** (`secrets/vault/dev-seed.env`):
the `KLIPY_APP_KEY` and `MONITORING_DB_PASSWORD` entries have been merged onto a
single line with no newline between them. This corruption is produced by the
seed script itself (`scripts/vault-seed-dev.sh`), which appends new secrets with
`>>` without guaranteeing the existing file ends in a newline.

## How the error surfaces

The frontend GIF picker renders the error state on any failed search request.
The status string lives in `frontend/src/pages/HomePage.tsx` (around line 5491):

```tsx
) : gifSearchError ? (
    <p className="hub-modal__chat-gif-status hub-modal__chat-gif-status--error">
        GIF search is unavailable
        right now.
    </p>
```

`gifSearchError` is set whenever `hubApi.searchGifs()` rejects. That helper
(`frontend/src/features/hub/api.ts`) simply calls
`GET /chat/gifs/search?q=...`, so any non-2xx response — including the 503 —
produces this message. The message text is therefore a generic failure state,
not specific to the 503.

## Where the 503 is thrown

`backend/src/modules/chat/gif.service.ts` builds the Klipy URL and, before
making any outbound call, checks that the app key is present:

```ts
private buildUrl(path: string): URL {
    const appKey = this.configService.get<string>("KLIPY_APP_KEY");
    if (!appKey) {
        // 503, not 500: this is an operator misconfiguration (empty
        // KLIPY_APP_KEY), not an unexpected failure...
        throw new ServiceUnavailableException("GIF search is not configured");
    }
    return new URL(`${KLIPY_API_BASE}/${appKey}/${path}`);
}
```

A **503** is emitted only from this branch — when `KLIPY_APP_KEY` is falsy
(empty or unset). This is by design: it distinguishes an operator
misconfiguration from a genuine Klipy failure, which is reported separately as a
**500** (`InternalServerErrorException("GIF provider request failed")`) from the
`request()` method. The 503 in the console therefore points squarely at the app
key not reaching the backend.

## Root cause: corrupted `secrets/vault/dev-seed.env`

Line 31 of the seed file contains two secrets fused together with no separating
newline:

```
KLIPY_APP_KEY=ZuTTwAB72c5PVEtUIU5ZDwBMwpscHh4u6shvKFOQuwH5HmcmNYe3CjQJYaHxcDTGMONITORING_DB_PASSWORD=0837b0f5c0befc7a2b156335c399fadc5759330cd43387bf856aa4139e4b0d67
```

The intended values are two separate lines:

- `KLIPY_APP_KEY` should be the 64-character value
  `ZuTTwAB72c5PVEtUIU5ZDwBMwpscHh4u6shvKFOQuwH5HmcmNYe3CjQJYaHxcDTG`.
- `MONITORING_DB_PASSWORD=0837…` should be its own line, but has been appended
  directly onto the end of the key with no line break.

### Why this breaks provisioning

`scripts/vault-seed-dev.sh` sources the seed file to load the secrets before
writing them into Vault:

```sh
set -a
. "${SEED_FILE}"
set +a
```

Because line 31 has no newline before `MONITORING_DB_PASSWORD`, the shell reads
the entire string as a single assignment. The effective value becomes a
151-character garbage string:

```
KLIPY_APP_KEY = ZuTT…CjQJYaHxcDTGMONITORING_DB_PASSWORD=0837…4b0d67
```

That garbage value is then written to Vault
(`vault kv put kv/transcendence/dev/backend KLIPY_APP_KEY="$KLIPY_APP_KEY" …`),
rendered into the backend environment via
`infra/vault-agent/templates/backend.env.ctmpl`, and used verbatim as the
`{appKey}` path segment in the Klipy request URL. Klipy rejects the malformed
key, so the picker fails.

Depending on when Vault was last seeded, the same corruption presents in one of
two ways, both tracing to the same defect:

- If Vault currently holds an **empty** `KLIPY_APP_KEY` (for example it was
  seeded before the real key was ever added, using the script's
  `KLIPY_APP_KEY=` default), the backend throws the **503** documented above.
  This matches the reported symptom.
- If Vault currently holds the **garbage** concatenated value, the outbound
  Klipy call fails and the backend throws a **500**. Either way the picker shows
  "GIF search is unavailable right now."

### How the file got corrupted (self-inflicted by the seed script)

The seed script self-heals missing keys by appending them:

```sh
if [ -z "${MONITORING_DB_PASSWORD:-}" ]; then
    MONITORING_DB_PASSWORD="$(generate_secret)"
    printf 'MONITORING_DB_PASSWORD=%s\n' "${MONITORING_DB_PASSWORD}" >> "${SEED_FILE}"
    ...
fi
```

If the seed file's last line (`KLIPY_APP_KEY=…`) did not end in a newline at the
time this ran, the `>>` append concatenated `MONITORING_DB_PASSWORD=…` straight
onto the key line — producing exactly the corruption on line 31. On the next
run, the now-embedded `MONITORING_DB_PASSWORD` is no longer visible to the
shell, so the self-heal fires again and adds a second, standalone
`MONITORING_DB_PASSWORD` (line 32, value `36f4998…`). The presence of two
monitoring passwords in the file is corroborating evidence of this sequence. The
original `0837…` monitoring password is now orphaned and effectively lost.

## Remediation

### 1. Repair the seed file

Split line 31 back into two lines in `secrets/vault/dev-seed.env`:

Before:
```
KLIPY_APP_KEY=ZuTTwAB72c5PVEtUIU5ZDwBMwpscHh4u6shvKFOQuwH5HmcmNYe3CjQJYaHxcDTGMONITORING_DB_PASSWORD=0837b0f5c0befc7a2b156335c399fadc5759330cd43387bf856aa4139e4b0d67
MONITORING_DB_PASSWORD=36f49981880cec1e79c615a9011c1211d0e13a267ac1431ca1824a7e3ed8ea9c
```

After:
```
KLIPY_APP_KEY=ZuTTwAB72c5PVEtUIU5ZDwBMwpscHh4u6shvKFOQuwH5HmcmNYe3CjQJYaHxcDTG
MONITORING_DB_PASSWORD=36f49981880cec1e79c615a9011c1211d0e13a267ac1431ca1824a7e3ed8ea9c
```

Keep the single valid `MONITORING_DB_PASSWORD` (`36f4998…`, the one the running
stack was seeded with) and drop the orphaned `0837…` fragment. Confirm the
`KLIPY_APP_KEY` value is the correct one issued by the Klipy dashboard before
re-seeding.

### 2. Re-seed Vault and restart the backend

```sh
make vault-seed-dev     # rewrites kv/transcendence/dev/backend with the repaired values
make restart-back       # backend re-reads the rendered secret
```

### 3. Harden the seed script so this cannot recur

The append blocks should guarantee a leading newline. A minimal, portable fix
is to ensure the file ends in a newline before any `>>` append, for example by
normalising once after sourcing:

```sh
# Ensure the seed file ends in a newline before any append, so a value-less
# final line can never fuse with the next appended secret.
[ -s "${SEED_FILE}" ] && [ "$(tail -c1 "${SEED_FILE}")" != "" ] && printf '\n' >> "${SEED_FILE}"
```

Alternatively, prefix each appended line with a guard newline. Either approach
prevents the `KLIPY_APP_KEY` / `MONITORING_DB_PASSWORD` fusion from reoccurring.

## Verification

After applying the fix, confirm end to end:

1. `make vault-seed-dev` completes without adding a duplicate
   `MONITORING_DB_PASSWORD`, and
   `sed -n '31,32p' secrets/vault/dev-seed.env` shows two clean, separate lines.
2. In the backend container, the rendered env has the correct 64-character key:
   `make shell SERVICE=backend` then `printenv KLIPY_APP_KEY` (length 64, no
   `MONITORING_DB_PASSWORD` substring).
3. `GET /api/chat/gifs/search?q=cat` returns **200** with a populated array
   (authenticated request), not 503/500.
4. In the running app, open a chat, open the GIF picker, search — thumbnails
   render and a GIF can be sent.
5. `cd backend && npm run test -- gif.service` (existing
   `gif.service.spec.ts`) still passes.

## Notes

- No application (TypeScript) code change is required; the defect is entirely in
  secret provisioning. `GifService` behaved correctly — the 503 is its intended
  signal for a missing app key.
- Treat the exposed dev key and monitoring passwords as compromised if this
  report or the seed file has left the local environment, and rotate them.
- Per the repository Core Rules, once the fix is applied and the GIF flow is
  verified, review and update `docs/modules-progress.md` for the chat/social
  module in the same task, and archive any related completed working document
  (for example `docs/social-tab-redesign-and-gif-fix-plan-2026-07-17.md`) if its
  work is fully closed.
