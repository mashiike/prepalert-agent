---
name: verify-lambda-locally
description: Use this skill when changing anything under src/lambda.ts, the Lambda branches in src/commands/serve.ts / src/index.ts (isLambdaEnvironment()), or the Dockerfile, and you need to verify the container actually works as an AWS Lambda container image before pushing. Builds the image, runs it under the AWS Lambda Runtime Interface Emulator (RIE), and sends a synthetic invocation.
allowed-tools: Bash, Read, Write
---

# ローカルでの Lambda コンテナ検証手順

prepalert-agent は Dockerfile 由来の**同一イメージ**を ECS（`serve` を `Bun.serve` で起動）と Lambda コンテナ（`serve` が `isLambdaEnvironment()` を検知して `startLambdaRuntime` の Runtime API ループに入る）の両方で使う設計になっている。この Skill は、実際に AWS へデプロイせずに、ローカルの Docker + [AWS Lambda Runtime Interface Emulator (RIE)](https://github.com/aws/aws-lambda-runtime-interface-emulator) だけでこの Lambda 経路を検証する手順。

`src/lambda.ts`、`src/commands/serve.ts` / `src/index.ts` の `isLambdaEnvironment()` 分岐、または `Dockerfile` を変更したときは、push 前にこの手順で実際に invoke まで通すこと。

## 前提

- Docker が使えること
- ホストのアーキテクチャに合わせる（`uname -m` で確認。`arm64`/`aarch64` なら arm64、`x86_64` なら amd64）

## 手順

### 1. イメージをビルド

```bash
docker build --build-arg TARGETARCH=<arm64|amd64> -t prepalert-agent:lambda-test .
```

### 2. RIE バイナリを取得

```bash
mkdir -p /tmp/aws-lambda-rie
curl -sSL -o /tmp/aws-lambda-rie/aws-lambda-rie \
  https://github.com/aws/aws-lambda-runtime-interface-emulator/releases/latest/download/aws-lambda-rie-<arm64|amd64>
chmod +x /tmp/aws-lambda-rie/aws-lambda-rie
```

### 3. 最小のテスト用プロジェクトを用意

`name` だけが必須。`logsDir`/`sessionsDir` を明示する必要はない —
`stageProjectDirForLambda`（`src/lambda.ts`）がプロジェクトディレクトリ自体を `/tmp/prepalert-project` にステージングするため、デフォルトの相対パス（`logs`、`sessions`）もその配下に解決され自動的に書き込み可能になる。

```bash
mkdir -p /tmp/lambda-test-project
cat > /tmp/lambda-test-project/prepalert.yaml <<'EOF'
name: lambda-rie-test
model: haiku
maxTurns: 1
serve:
  port: 8080
  webhooks:
    - path: /webhook/test
      authType: none
      sync: true
EOF
```

### 4. RIE 経由でコンテナを起動

`--entrypoint` を RIE に差し替え、CMD に実際の Lambda 用コマンド（`prepalert-agent serve`）を渡す。プロジェクトディレクトリは **`:ro`（読み取り専用）でマウント**すること — Lambda コンテナの実ファイルシステム（`/tmp` 以外は読み取り専用）を忠実に再現するため、これを書き込み可能にしてしまうと本番では起きるはずのクラッシュを見逃す。

```bash
docker run -d --name lambda-rie-test \
  -p 9000:8080 \
  -v /tmp/aws-lambda-rie/aws-lambda-rie:/usr/local/bin/aws-lambda-rie:ro \
  -v /tmp/lambda-test-project:/app:ro \
  -e AWS_LAMBDA_FUNCTION_NAME=lambda-rie-test \
  -e AWS_LAMBDA_FUNCTION_TIMEOUT=30 \
  -e AWS_LAMBDA_FUNCTION_MEMORY_SIZE=512 \
  -e "AWS_LAMBDA_FUNCTION_VERSION=\$LATEST" \
  -e ANTHROPIC_API_KEY=sk-test-dummy-not-real \
  --entrypoint /usr/local/bin/aws-lambda-rie \
  prepalert-agent:lambda-test \
  prepalert-agent serve
```

`ANTHROPIC_API_KEY` はダミーでよい。目的は Runtime API の往復（invoke → ハンドラ実行 → レスポンス返却）が成立するかの確認であり、`claude` サブプロセスの認証自体を検証するものではない。認証エラーで最後まで到達すれば経路としては成功。

### 5. 合成イベントを invoke

`APIGatewayProxyEventV2` 形式のイベントを組み立てて叩く（`serve` は API Gateway v2 ペイロードを期待する。`src/lambda.ts` の `isAPIGatewayV2Event` / `apiGatewayV2EventToRequest` 参照）。

```bash
cat > /tmp/apigw-event.json <<'EOF'
{
  "version": "2.0",
  "routeKey": "$default",
  "rawPath": "/webhook/test",
  "rawQueryString": "",
  "headers": {"content-type": "application/json"},
  "requestContext": {
    "http": {"method": "POST", "path": "/webhook/test"},
    "domainName": "example.com"
  },
  "body": "{\"alert\": \"test alert from RIE\"}",
  "isBase64Encoded": false
}
EOF

curl -sS -m 60 -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -d @/tmp/apigw-event.json
```

### 6. ログを確認

```bash
docker logs lambda-rie-test 2>&1 | tail -60
```

`rapid` プレフィックスの行が RIE 自体のログ、それ以外が `prepalert-agent` の JSONL ログ。`"msg":"Lambda environment detected — starting Lambda runtime"` が出ていれば `isLambdaEnvironment()` 分岐に正しく入っている。

### 7. 後片付け

```bash
docker rm -f lambda-rie-test
```

## 既知の落とし穴（再発時にまず疑う場所）

- **`EROFS: ... mkdir '<projectDir>/logs'` や `.../sessions`** — `logsDir`/`sessionsDir` が `/tmp` 配下にリダイレクトされていない。`src/index.ts` の `resolveLogsDirForServe` と `src/commands/serve.ts` の `resolveSessionsDir` を確認する。
- **`EROFS: ... mkdir '<projectDir>/tmp'`** — Claude Agent SDK 自体が `cwd`（= プロジェクトディレクトリ）相対でスクラッチ用の `tmp` を作ろうとして失敗している。`stageProjectDirForLambda`（`src/lambda.ts`）が呼ばれているか、`src/index.ts` の `serve` アクションで `isLambdaEnvironment()` のときに `loadProjectOrExit` の**前**に呼んでいるかを確認する。
- **invoke がタイムアウトする / レスポンスが返らない** — `startLambdaRuntime`（`src/lambda.ts`）のポーリングループが `AWS_LAMBDA_RUNTIME_API` を読めていない可能性。RIE は `AWS_LAMBDA_RUNTIME_API` を自動設定するので、通常はコンテナ内のハンドラ自体が例外で落ちていないか `docker logs` を確認する。
