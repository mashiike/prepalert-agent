# 認証（OAuth/OIDC）

## 概要

`serve.auth` を設定すると、SPA および API エンドポイント（`/`, `/sessions/*`, `/api/*`）に OIDC 認証がかかる。
未設定時は認証なし（既存動作）。

## 設定

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

### フィールド

| フィールド | 必須 | 説明 |
|---|---|---|
| `serve.sessionSecret` | 推奨 | session cookie の JWT 署名鍵。未設定時は起動時に自動生成（再起動で無効化） |
| `serve.auth.issuer` | 必須 | OIDC プロバイダの issuer URL |
| `serve.auth.clientId` | 必須 | OAuth クライアント ID |
| `serve.auth.clientSecret` | 必須 | OAuth クライアントシークレット |
| `serve.auth.allowedDomains` | 任意 | 許可するメールドメインのリスト。未設定時は認証成功した全ユーザーを許可 |

### sessionSecret の生成方法

```bash
openssl rand -base64 32
```

## プロバイダ別の設定例

### Google Workspace

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で OAuth 2.0 クライアントを作成
2. 承認済みのリダイレクト URI に `https://<your-domain>/auth/callback` を追加
3. スコープ: `openid`, `email`, `profile`

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

## 認証フロー

1. ユーザーがブラウザで `/` にアクセス
2. session cookie がない → `/auth/login` にリダイレクト
3. OIDC プロバイダの認証画面にリダイレクト（Authorization Code Flow + PKCE）
4. 認証成功 → `/auth/callback` にリダイレクト
5. code 交換 → id_token 検証 → session cookie セット → 元のページにリダイレクト
6. 以降のリクエストは session cookie で認証

## 認証不要のパス

以下のパスは `serve.auth` が設定されていても OIDC セッション認証が適用されない:

- `GET /health` — ヘルスチェック
- `GET /export/{token}` — JWT トークンで自己認証済み
- webhook パス（`serve.webhooks[].path` で定義されたすべてのパス） — webhook 独自の認証（`authType` で制御）

webhook パスは `/webhook/` プレフィックスに限定されない。`serve.webhooks` で定義された任意のパスが対象。webhook の認証は `authType`（`none` / `basic` / `oidc`）で個別に制御され、`serve.auth` のセッション認証とは独立して動作する。

## セキュリティ

- session cookie: `HttpOnly; SameSite=Lax; Path=/`。HTTPS 環境では `Secure` 付き
- PKCE（Proof Key for Code Exchange）で認可コード横取り攻撃を防止
- state パラメータ（署名付き）で CSRF 攻撃を防止
- `allowedDomains` でドメイン制限（大文字小文字は区別しない）。`email_verified` claim も検証
- session cookie と export JWT は異なる `aud` claim で用途を区別（confused deputy 防止）
- API の POST エンドポイントは `Content-Type: application/json` を要求（CSRF 対策）
- `prepalert-dispatch-token`（webhook の非同期ディスパッチ後に自分自身のリクエストを再認証なしで受け付けるための内部トークン）は、発行元の webhook パスに `sub` claim としてスコープされる。他の webhook パスに対しては使用できない

**`serve.auth` を設定しない場合の注意:** `serve.auth` は opt-in であり、未設定時は SPA（`/`, `/sessions/*`）と API（`/api/*`）に認証がかからず、全セッションのログ・レポート・アーティファクトが誰でも読める状態で公開される。信頼できないネットワークに直接公開する場合は必ず `serve.auth` を設定すること。

## localhost 開発

localhost（`localhost` / `127.0.0.1`）では cookie の `Secure` フラグが自動的に外れるため、HTTP でも動作する。
