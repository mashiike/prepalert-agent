# Export and Handoff

## Overview

A feature to export session investigation results as a ZIP and hand them off to external tools such as Claude Code.
Export URLs are protected by JWT and issued as temporary URLs with an expiration time.

## Endpoints

### Issuing an Export URL

```
POST /api/sessions/{id}/export-url
```

Response:
```json
{
  "url": "https://example.com/export/eyJhbGciOi...",
  "expiresAt": "2026-06-18T15:00:00Z"
}
```

### Export Download

```
GET /export/{token}
```

- Valid token: Returns a ZIP file (`Content-Type: application/zip`)
- Invalid or expired token: `403 Forbidden`
- Session not found: `404 Not Found`

The same URL format is used regardless of storage type (local / S3 / GCS).

## ZIP Contents

```
report.md                              # Session Report
runbooks/{runbook-id}/{tool-use-id}/
  report.md                            # Runbook Report
artifacts/
  {filename}                           # Artifacts
transcript.jsonl                       # Agent conversation log
metadata.json                          # Session metadata
output.md                              # Agent final response (serve mode)
```

## exportSecret Configuration

The secret key used for JWT signing of export URLs. Set it via `serve.exportSecret` in `prepalert.yaml`.

```yaml
serve:
  exportSecret: ${PREPALERT_EXPORT_SECRET}
```

### Generating a Secret Key

```bash
# Generate with OpenSSL
openssl rand -base64 32

# Generate with Python
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# Generate with Node.js / Bun
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Set the generated value in the environment variable `PREPALERT_EXPORT_SECRET`:

```bash
# .env file
PREPALERT_EXPORT_SECRET=your-generated-secret-here
```

```yaml
# prepalert.yaml
serve:
  exportSecret: ${PREPALERT_EXPORT_SECRET}
```

### Behavior When Not Set

If `exportSecret` is not set, a random secret key is automatically generated at server startup and a warn log is emitted.
The auto-generated key is lost on server restart, which invalidates any previously issued export URLs.

Always set `exportSecret` in production environments.

## Handoff Flow

1. Press the "Send to Claude Code" button in the frontend
2. Obtain a temporary URL via `POST /api/sessions/{id}/export-url`
3. Generate the prompt text:
   ```
   Import this prepalert session:
   curl -sL "https://example.com/export/eyJhbGciOi..." -o session.zip && unzip -o session.zip -d ./session

   Context: Alert "web-api 5xx rate exceeded" fired at 2026-06-18T14:28Z.
   Review the report.md for investigation results.
   ```
4. The user copies and pastes the prompt into Claude Code
5. Claude Code accesses the URL to download and extract the ZIP

## baseUrl Configuration

The domain portion of the export URL. Set it via `serve.baseUrl` in `prepalert.yaml`.

```yaml
serve:
  baseUrl: https://prepalert.example.com
```

When not set, it is automatically inferred from request headers (in order: `X-Forwarded-Host` / `X-Forwarded-Proto` / `CloudFront-Forwarded-Proto`, then the `Host` header).

**Note:** `X-Forwarded-Host` can be spoofed by clients when accessed directly without going through a reverse proxy. Always explicitly set `baseUrl` in production environments. Auto-inference is intended for local development only.

## Security

**Important:** `/api/*` endpoints and the SPA currently have no authentication. Since session data may contain incident investigation logs (hostnames, internal IPs, stack traces, etc.), protect them at the network layer (VPC, IAP, ALB authentication, etc.) or introduce SSO authentication in the future.

- JWT expiration defaults to 15 minutes
- The session ID is embedded in the JWT; the session ID cannot be guessed from the URL
- The `/export/` path cannot be used as a webhook path (reserved)
- Even when using S3/GCS, presigned URLs are not exposed directly; the server acts as a proxy to return the ZIP
