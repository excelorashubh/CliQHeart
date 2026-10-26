# API

All endpoints are under `/api/v1`. Responses are JSON. The API does not expose
account mutation endpoints in Phase 0.

## `GET /api/v1`

Identifies the API, version, and the repository documentation path
(`docs/API.md`) without revealing server configuration.

## `GET /api/v1/health`

Returns readiness information: application name, API status, ISO timestamp,
runtime environment, database connectivity, and application version. The
database status is limited to a safe connected/disconnected indicator. When a
mandatory database dependency is unavailable, the endpoint returns HTTP 503.
It does not return a URI, host, username, password, IP allowlist, stack trace,
or internal path.

Example response when ready:

```json
{
  "application": "CliQHeart",
  "status": "ok",
  "timestamp": "2026-10-26T00:00:00.000Z",
  "environment": "development",
  "database": "connected",
  "version": "0.1.0"
}
```

The API root includes `application`, `apiVersion`, `documentation`, `status`,
and `version`. The timestamp is generated when the health request is handled.
The health example is illustrative and does not claim an Atlas connection is
configured.

## Status codes and errors

- `200`: API identity or ready health response.
- `400`: malformed JSON or invalid request payload.
- `404`: unknown route.
- `429`: request rate limit exceeded.
- `500`: unexpected server error, returned without internals.
- `503`: readiness dependency unavailable.

No User API endpoints are exposed in Phase 0. The User model and validation
boundaries are preparatory only.
