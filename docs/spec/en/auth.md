# Authentication (OAuth/OIDC)

## Overview

When `serve.auth` is configured, OIDC authentication is applied to the SPA and API endpoints (`/`, `/sessions/*`, `/api/*`).
When not configured, no authentication is applied (existing behavior).

## Configuration

```yaml
serve:
  sessionSecret: ${SESSION_SECRET}
  auth:
    issuer: https://accounts.google.com
    clientId: ${OAUTH_CLIENT_ID}
    clientSecret: ${OAUTH_CLIENT_SECRET}
    allowedDomains:
      - kayac.com
```

### Fields

| Field | Required | Description |
|---|---|---|
| `serve.sessionSecret` | Recommended | JWT signing key for session cookies. Auto-generated at startup if not set (invalidated on restart) |
| `serve.auth.issuer` | Required | OIDC provider issuer URL |
| `serve.auth.clientId` | Required | OAuth client ID |
| `serve.auth.clientSecret` | Required | OAuth client secret |
| `serve.auth.allowedDomains` | Optional | List of allowed email domains. When not set, all successfully authenticated users are allowed |

### Generating a sessionSecret

```bash
openssl rand -base64 32
```

## Provider-specific Configuration Examples

### Google Workspace

1. Create an OAuth 2.0 client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Add `https://<your-domain>/auth/callback` to the authorized redirect URIs
3. Scopes: `openid`, `email`, `profile`

```yaml
serve:
  sessionSecret: ${SESSION_SECRET}
  baseUrl: https://prepalert.example.com
  auth:
    issuer: https://accounts.google.com
    clientId: ${GOOGLE_CLIENT_ID}
    clientSecret: ${GOOGLE_CLIENT_SECRET}
    allowedDomains:
      - example.com
```

### Auth0

```yaml
serve:
  sessionSecret: ${SESSION_SECRET}
  baseUrl: https://prepalert.example.com
  auth:
    issuer: https://your-tenant.auth0.com/
    clientId: ${AUTH0_CLIENT_ID}
    clientSecret: ${AUTH0_CLIENT_SECRET}
```

### Keycloak

```yaml
serve:
  sessionSecret: ${SESSION_SECRET}
  baseUrl: https://prepalert.example.com
  auth:
    issuer: https://keycloak.example.com/realms/your-realm
    clientId: ${KEYCLOAK_CLIENT_ID}
    clientSecret: ${KEYCLOAK_CLIENT_SECRET}
```

## Authentication Flow

1. User accesses `/` in the browser
2. No session cookie present → redirect to `/auth/login`
3. Redirect to the OIDC provider's authentication screen (Authorization Code Flow + PKCE)
4. Authentication succeeds → redirect to `/auth/callback`
5. Code exchange → id_token verification → set session cookie → redirect to the original page
6. Subsequent requests are authenticated via the session cookie

## Paths Exempt from Authentication

The following paths are not subject to OIDC session authentication even when `serve.auth` is configured:

- `GET /health` — Health check
- `GET /export/{token}` — Self-authenticated via JWT token
- Webhook paths (all paths defined in `serve.webhooks[].path`) — Webhook-specific authentication (controlled by `authType`)

Webhook paths are not limited to the `/webhook/` prefix. Any path defined in `serve.webhooks` is exempt. Webhook authentication is controlled independently by `authType` (`none` / `basic` / `oidc`) and operates separately from `serve.auth` session authentication.

## Security

- Session cookie: `HttpOnly; SameSite=Lax; Path=/`. `Secure` flag is added in HTTPS environments
- PKCE (Proof Key for Code Exchange) prevents authorization code interception attacks
- Signed state parameter prevents CSRF attacks
- `allowedDomains` restricts by domain (case-insensitive). The `email_verified` claim is also verified
- Session cookies and export JWTs use different `aud` claims to distinguish their purposes (confused deputy prevention)
- API POST endpoints require `Content-Type: application/json` (CSRF mitigation)
- `prepalert-dispatch-token` (an internal token that lets a webhook's own re-delivered request skip re-authentication after async dispatch) is scoped to its originating webhook path via the `sub` claim and cannot be used against other webhook paths

**Note on running without `serve.auth`:** `serve.auth` is opt-in. When unset, the SPA (`/`, `/sessions/*`) and API (`/api/*`) have no authentication, exposing every session's logs, reports, and artifacts to anyone who can reach the server. Always configure `serve.auth` before exposing `serve` to an untrusted network.

## localhost Development

On localhost (`localhost` / `127.0.0.1`), the cookie `Secure` flag is automatically removed, allowing it to work over HTTP.
