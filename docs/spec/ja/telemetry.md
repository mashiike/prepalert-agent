# テレメトリ (OpenTelemetry)

prepalert-agent は OpenTelemetry を使用してログ・メトリクス・トレースを OTLP/HTTP で外部に送信できる。

## 有効化

環境変数 `OTEL_EXPORTER_OTLP_ENDPOINT` を設定すると有効になる。未設定時はテレメトリは完全に無効（オーバーヘッドなし）。

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
prepalert-agent run -p "アラートを調査して"
```

`OTEL_SDK_DISABLED=true` を設定すると、エンドポイントが設定されていても明示的に無効化できる。

## 環境変数

設定は [OpenTelemetry 標準の環境変数](https://opentelemetry.io/docs/specs/otel/protocol/exporter/) に準拠する。`prepalert.yaml` にテレメトリ固有の設定項目はない。

| 環境変数 | 説明 |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP エンドポイント（例: `http://localhost:4318`）。設定時にテレメトリが有効化される |
| `OTEL_EXPORTER_OTLP_HEADERS` | エクスポーターのヘッダー（例: `api-key=xxx`） |
| `OTEL_SDK_DISABLED` | `true` で明示的に無効化 |
| `OTEL_SERVICE_NAME` | サービス名の上書き（デフォルト: `prepalert-agent`） |
| `OTEL_RESOURCE_ATTRIBUTES` | カンマ区切りの `key=value` 形式でリソース属性を追加（例: `deployment.environment=production,service.instance.id=abc123`） |

その他の `OTEL_EXPORTER_OTLP_*` 環境変数も OpenTelemetry SDK の標準仕様に従って動作する。

## リソース属性

### デフォルト属性

コードで固定設定される属性。`OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES` で上書き可能。

| 属性 | 値 | 上書き |
|---|---|---|
| `service.name` | `prepalert-agent` | `OTEL_SERVICE_NAME` |
| `service.version` | パッケージバージョン（例: `0.0.1`） | `OTEL_RESOURCE_ATTRIBUTES` |

### 自動検出される属性

`envDetector`・`hostDetector`・`processDetector` により以下が自動付与される。

| 属性 | 例 | 検出元 |
|---|---|---|
| `host.name` | `ip-10-0-1-42` | hostDetector |
| `host.arch` | `amd64` | hostDetector |
| `process.pid` | `12345` | processDetector |
| `process.runtime.name` | `bun` | processDetector |
| `process.runtime.version` | `1.3.14` | processDetector |

### カスタム属性の追加

`OTEL_RESOURCE_ATTRIBUTES` 環境変数で自由に追加できる。

```bash
OTEL_RESOURCE_ATTRIBUTES="deployment.environment=production,service.instance.id=ecs-task-abc123"
```

キーと値に `,` や `=` を含む場合はパーセントエンコードが必要。

## トレース

セッション > ターン > ツール実行の3階層のスパンを送信する。

### スパン構造

```
session                          # セッション全体
├── turn-1                       # ユーザー入力〜結果までの1ターン
│   ├── tool/Bash                # ツール実行
│   ├── tool/Read                # ツール実行
│   └── tool/Agent               # サブエージェント実行
└── turn-2
    └── tool/mcp__mackerel__*    # MCP ツール実行
```

### スパン属性

#### session スパン

| 属性 | 型 | 説明 |
|---|---|---|
| `session.id` | string | セッション ID（transcript ディレクトリ名と同一） |
| `session.cost_usd` | float | セッション終了時の累計コスト（USD） |

#### turn スパン

| 属性 | 型 | 説明 |
|---|---|---|
| `turn.number` | int | ターン番号（1始まり） |
| `turn.cost_usd` | float | result 時点の累計コスト（USD） |
| `turn.num_turns` | int | SDK 内部のターン数 |
| `turn.is_error` | boolean | エラーで終了したか |
| `turn.input_tokens` | int | 入力トークン数 |
| `turn.output_tokens` | int | 出力トークン数 |

#### tool スパン

| 属性 | 型 | 説明 |
|---|---|---|
| `tool.id` | string | ツール呼び出し ID |
| `tool.name` | string | ツール名（例: `Bash`, `Read`, `mcp__mackerel__list_alerts`） |

### ヘッドレスモードと対話モード

- **ヘッドレスモード** (`-p` / `serve`): session スパン内に turn が1つ。ツール呼び出しはその turn の子スパンになる
- **対話モード**: ユーザー入力ごとに turn スパンが作成される。`/reset` コマンドは turn 番号に影響しない

## メトリクス

| メトリクス名 | 型 | 単位 | 説明 |
|---|---|---|---|
| `prepalert.session.cost_usd` | Histogram | usd | セッション終了時の累計コスト |
| `prepalert.session.turns` | Counter | - | SDK の累計ターン数 |
| `prepalert.session.input_tokens` | Counter | - | 累計入力トークン数 |
| `prepalert.session.output_tokens` | Counter | - | 累計出力トークン数 |

メトリクスは `PeriodicExportingMetricReader` で定期的にエクスポートされる（デフォルト間隔: 60秒）。短命なヘッドレス実行では、プロセス終了時の `shutdown()` でフラッシュされる。

## ログ

既存のファイルロガー（JSON Lines）に加えて、同じログレコードが OTel Logs API 経由で OTLP エクスポーターに送信される。

| フィールド | OTel マッピング |
|---|---|
| `level` | `severityText` (`DEBUG` / `INFO` / `WARN` / `ERROR`) + `severityNumber` |
| `msg` | `body` |
| その他のフィールド | `attributes` |

ファイルへの書き出し（`logs/` ディレクトリ）は常に行われる。OTel ログはファイルログの代替ではなく、追加の送信先として機能する。

## アーキテクチャ

```
┌───────────────────────────────────────────────┐
│  prepalert-agent                              │
│                                               │
│  FileLogger ──────────────→ logs/*.jsonl       │
│      │                                        │
│  OTelLogger (wrapper)                         │
│      ├── Logs   ──→ BatchLogRecordProcessor   │──→ OTLP/HTTP
│      │                                        │
│  SessionTelemetry                             │
│      ├── Traces ──→ BatchSpanProcessor        │──→ OTLP/HTTP
│      └── Metrics ─→ PeriodicMetricReader      │──→ OTLP/HTTP
└───────────────────────────────────────────────┘
```

- `OTelLogger`: 既存の `Logger` インターフェースをラップし、内部ロガーと OTel Logs API の両方に転送する
- `SessionTelemetry`: SDK メッセージストリームからスパンの開始/終了とメトリクス記録を管理する
- エクスポーターは HTTP（JSON）を使用。gRPC は Bun 互換性のため不使用

## 実装ファイル

| ファイル | 役割 |
|---|---|
| `src/telemetry.ts` | OTel 初期化/シャットダウン、`OTelLogger`、`SessionTelemetry` |
| `src/commands/execute.ts` | SDK メッセージストリームとテレメトリの統合 |
| `src/index.ts` | `initTelemetry()` 呼び出し、ロガーのラップ |
