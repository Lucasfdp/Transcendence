# Public API

La API publica expone acceso controlado a datos de perfil mediante la cabecera `X-API-Key`.

## Requisitos

- Configurar `PUBLIC_API_KEY` en el entorno del backend.
- Enviar siempre la cabecera `X-API-Key`.
- Respetar el rate limit por IP. Si se supera, la API responde `429`.

## Endpoints

Base URL: `/api/public`

### GET `/users`

Lista perfiles publicos.

```bash
curl -X GET "https://localhost:42424/api/public/users?limit=10" \
  -H "X-API-Key: change-me-public-api-key"
```

### GET `/users/:username`

Obtiene un perfil publico concreto.

```bash
curl -X GET "https://localhost:42424/api/public/users/KameMaster" \
  -H "X-API-Key: change-me-public-api-key"
```

### POST `/users/query`

Consulta varios usuarios en lote.

```bash
curl -X POST "https://localhost:42424/api/public/users/query" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: change-me-public-api-key" \
  -d '{"usernames":["KameMaster","dojo_guest"]}'
```

### PUT `/users/:username`

Actualiza campos publicos del perfil.

```bash
curl -X PUT "https://localhost:42424/api/public/users/KameMaster" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: change-me-public-api-key" \
  -d '{"turtleName":"Kame Master","tag":"strategist","showcasedAchievements":["first-blood"]}'
```

### DELETE `/users/:username/avatar`

Limpia el avatar almacenado del perfil.

```bash
curl -X DELETE "https://localhost:42424/api/public/users/KameMaster/avatar" \
  -H "X-API-Key: change-me-public-api-key"
```
