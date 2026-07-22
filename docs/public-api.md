# Public API

The public API exposes controlled profile data under `/api/public`. `GET`,
`HEAD`, and `OPTIONS` requests are public. State-changing requests require the
`X-API-Key` header and are compared against `PUBLIC_API_KEY` in constant time.
Every endpoint is rate-limited by client IP through Redis.

## Examples

List public profiles without an API key:

```bash
curl --insecure "https://localhost:42424/api/public/users?limit=10"
```

Fetch one public profile without an API key:

```bash
curl --insecure "https://localhost:42424/api/public/users/KameMaster"
```

Query several users. This is a mutation-style bulk request and requires the
public API key:

```bash
curl --insecure --request POST \
  "https://localhost:42424/api/public/users/query" \
  --header "Content-Type: application/json" \
  --header "X-API-Key: your-public-api-key" \
  --data '{"usernames":["KameMaster","dojo_guest"]}'
```

Update public profile fields:

```bash
curl --insecure --request PUT \
  "https://localhost:42424/api/public/users/KameMaster" \
  --header "Content-Type: application/json" \
  --header "X-API-Key: your-public-api-key" \
  --data '{"turtleName":"Kame Master","tag":"strategist"}'
```

Clear a public profile avatar:

```bash
curl --insecure --request DELETE \
  "https://localhost:42424/api/public/users/KameMaster/avatar" \
  --header "X-API-Key: your-public-api-key"
```

Missing or incorrect keys on mutations receive `401`. If the key is not
configured, mutations receive `503`. Rate-limit exhaustion receives `429`.
