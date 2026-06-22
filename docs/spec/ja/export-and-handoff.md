# Export と Handoff

## 概要

セッションの調査結果を ZIP としてエクスポートし、Claude Code 等の外部ツールに引き渡す（handoff）機能。
エクスポート URL は JWT で保護され、有効期限付きの一時 URL として発行される。

## エンドポイント

### Export URL の発行

```
POST /api/sessions/{id}/export-url
```

レスポンス:
```json
{
  "url": "https://example.com/export/eyJhbGciOi...",
  "expiresAt": "2026-06-18T15:00:00Z"
}
```

### Export ダウンロード

```
GET /export/{token}
```

- token が有効: ZIP ファイルを返す（`Content-Type: application/zip`）
- token が無効または期限切れ: `403 Forbidden`
- セッションが見つからない: `404 Not Found`

ストレージ種別（ローカル / S3 / GCS）に関係なく、同じ URL 形式でアクセスできる。

## ZIP の中身

```
report.md                              # Session Report
runbooks/{runbook-id}/{tool-use-id}/
  report.md                            # Runbook Report
artifacts/
  {filename}                           # Artifacts
transcript.jsonl                       # Agent のやり取り記録
metadata.json                          # セッションメタデータ
output.md                              # Agent の最終応答（serve モード）
```

## exportSecret の設定

Export URL の JWT 署名に使う秘密鍵。`prepalert.yaml` の `serve.exportSecret` で設定する。

```yaml
serve:
  exportSecret: ${PREPALERT_EXPORT_SECRET}
```

### 秘密鍵の生成方法

```bash
# OpenSSL で生成
openssl rand -base64 32

# Python で生成
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# Node.js / Bun で生成
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

生成した値を環境変数 `PREPALERT_EXPORT_SECRET` にセットする:

```bash
# .env ファイル
PREPALERT_EXPORT_SECRET=your-generated-secret-here
```

```yaml
# prepalert.yaml
serve:
  exportSecret: ${PREPALERT_EXPORT_SECRET}
```

### 未設定時の動作

`exportSecret` が未設定の場合、サーバー起動時にランダムな秘密鍵が自動生成され、warn ログが出力される。
自動生成された鍵はサーバー再起動で失われるため、発行済みの export URL は無効になる。

本番環境では必ず `exportSecret` を設定すること。

## Handoff フロー

1. フロントエンドで「Send to Claude Code」ボタンを押す
2. `POST /api/sessions/{id}/export-url` で一時 URL を取得
3. プロンプトテキストを生成:
   ```
   Import this prepalert session:
   curl -sL "https://example.com/export/eyJhbGciOi..." -o session.zip && unzip -o session.zip -d ./session

   Context: Alert "web-api 5xx rate exceeded" fired at 2026-06-18T14:28Z.
   Review the report.md for investigation results.
   ```
4. ユーザーがプロンプトを Claude Code にコピー&ペースト
5. Claude Code が URL にアクセスして ZIP をダウンロード・展開

## baseUrl の設定

Export URL のドメイン部分。`prepalert.yaml` の `serve.baseUrl` で設定する。

```yaml
serve:
  baseUrl: https://prepalert.example.com
```

未設定時はリクエストヘッダから自動推定する（`X-Forwarded-Host` / `X-Forwarded-Proto` / `CloudFront-Forwarded-Proto` → `Host` ヘッダの順）。

**注意:** `X-Forwarded-Host` はリバースプロキシを経由しない直アクセスではクライアントが詐称可能。本番環境では必ず `baseUrl` を明示設定すること。自動推定はローカル開発用。

## セキュリティ

**重要:** `/api/*` エンドポイントおよび SPA は現時点で認証なし。セッションデータにはインシデント調査ログ（ホスト名、内部 IP、スタックトレース等）が含まれ得るため、ネットワーク層（VPC, IAP, ALB の認証等）で保護するか、将来的に SSO 認証を導入すること。

- JWT の有効期限はデフォルト 15 分
- JWT にはセッション ID が埋め込まれており、URL からセッション ID は推測できない
- `/export/` パスは webhook パスとして使用できない（予約済み）
- S3/GCS 利用時も presigned URL を直接公開せず、サーバーがプロキシとして ZIP を返す
