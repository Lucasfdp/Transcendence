# API Documentation

## Endpoints

- `/api/docs` renders the Scalar API reference and interactive HTTP client.
- `/api/docs/scalar.js` serves the pinned Scalar bundle from the backend image.
- `/api/docs-json` serves the generated OpenAPI JSON document.
- `/api/docs-yaml` serves the equivalent YAML document.

All four endpoints are available in development and production. Nginx protects
the full `/api/docs*` family. Anonymous requests receive `401`, guest sessions
receive `403`, and registered accounts receive `200`.

## Interactive Requests

Scalar uses the current browser session with `credentials: "include"`. Before
an internal `POST`, `PUT`, `PATCH`, or `DELETE`, it requests a fresh token from
`GET /api/auth/csrf-token` and adds the returned value as `X-CSRF-Token`. Public
API mutations instead require a manually entered `X-API-Key`. No API key is
embedded in the page or stored in local storage.

The bundle, specification, fonts, and configuration use no CDN. Scalar
telemetry, external developer tools, editing, and authentication persistence
are disabled. The API client, search, schemas, downloads, and operation
identifiers remain available.

## Contract Generation And Validation

NestJS generates the document through `SwaggerModule.createDocument`. Swagger
UI is disabled while the standard JSON and YAML routes remain enabled. The
Swagger CLI plugin runs during `nest build` with `classValidatorShim` and
`introspectComments`, so DTO validation rules and comments become schema
metadata.

Run the live contract gate after starting the stack:

```bash
make validate-openapi
```

The gate rejects a non-OpenAPI 3 document, fewer than 97 paths or 108
operations, missing summaries or responses, duplicate or missing operation
identifiers, empty component schemas, and references to undefined security
schemes. WebSocket gateways are deliberately excluded because this is the REST
contract.
