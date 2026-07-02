# Copilot Code Review Instructions

このファイルは GitHub Copilot によるコードレビューのガイドラインです。
レビューコメントは**日本語**で記述してください。

---

## プロジェクト概要

prepalert-agent は、アラート発火時にログや関連情報を自動収集する CLI / Webhook サーバー。
TypeScript (ESM) + Bun ランタイムで、Claude Agent SDK を使った AI エージェント実行基盤。

- **ランタイム:** Bun
- **認証:** none / Basic / OIDC (JWT)
- **外部連携:** MCP サーバー、S3/GCS ストレージ、Cloud Tasks、ECS

---

## セキュリティレビューガイドライン

### 重大度の定義

| レベル | 意味 | 対応 |
|--------|------|------|
| **CRITICAL** | 本番環境で即座に悪用可能な脆弱性 | マージ前に必ず修正 |
| **HIGH** | 条件次第で悪用可能、またはデータ漏洩リスク | マージ前に修正を強く推奨 |
| **MEDIUM** | セキュリティ上の懸念はあるが直接的な攻撃経路は限定的 | 同一スプリント内で対応 |
| **LOW** | ベストプラクティスからの逸脱 | 次回以降で改善 |

---

### 1. シークレット・認証情報の漏洩防止 [CRITICAL]

- ハードコードされた API キー、トークン、パスワード、秘密鍵を検出した場合は即座に指摘する
- `.env` ファイル、認証情報ファイル（`credentials.json` 等）がコミットに含まれていないか確認する
- エラーメッセージやログ出力にシークレットが含まれていないか確認する
- 環境変数名に `SECRET`、`TOKEN`、`PASSWORD`、`KEY`、`CREDENTIAL` を含む値がソースコードにリテラルとして存在しないか確認する

```typescript
// NG: シークレットのハードコード
const apiKey = "sk-ant-xxxxxxxx";

// OK: 環境変数から取得
const apiKey = process.env.ANTHROPIC_API_KEY;
```

### 2. コマンドインジェクション [CRITICAL]

- ユーザー入力や外部データを `child_process.exec`、`Bun.spawn`、テンプレートリテラルによるシェルコマンド構築に渡していないか確認する
- シェルコマンドの構築には必ず配列形式の引数を使用する

```typescript
// NG: コマンドインジェクションの危険
const proc = Bun.spawn(["sh", "-c", `grep ${userInput} /var/log/app.log`]);

// OK: 引数を分離
const proc = Bun.spawn(["grep", "--", userInput, "/var/log/app.log"]);
```

### 3. パストラバーサル [CRITICAL]

- ユーザー入力からファイルパスを構築する箇所で `../` を含む入力を検証しているか確認する
- `path.resolve()` 後にベースディレクトリ内に収まることを検証する
- セッション ID やファイル名パラメータからの任意ファイル読み取りを防止する

```typescript
// NG: パストラバーサルの危険
const filePath = path.join(sessionsDir, sessionId, filename);

// OK: 正規化後にベースディレクトリを検証
const resolved = path.resolve(sessionsDir, sessionId, filename);
if (!resolved.startsWith(path.resolve(sessionsDir) + path.sep)) {
  throw new Error("Invalid path");
}
```

### 4. 認証・認可の不備 [CRITICAL]

- Webhook エンドポイントに認証が適用されているか確認する
- JWT の検証で以下を確認する:
  - 署名検証を行っている（`alg: "none"` を受け入れていない）
  - `exp`（有効期限）を検証している
  - `aud`（audience）を検証している
  - `iss`（issuer）を検証している（OIDC の場合）
- Basic 認証の比較がタイミングセーフか確認する（`crypto.timingSafeEqual` の使用）
- 認証バイパスが可能なルートが存在しないか確認する

### 5. インジェクション攻撃全般 [HIGH]

- SQL インジェクション: プレースホルダ/パラメータバインディングを使用しているか
- NoSQL インジェクション: ユーザー入力をクエリオブジェクトに直接展開していないか
- YAML インジェクション: `yaml.parse()` にユーザー制御の入力を渡す場合、スキーマバリデーションを行っているか
- ログインジェクション: ログ出力にユーザー入力を含める場合、改行文字をサニタイズしているか

### 6. サーバーサイドリクエストフォージェリ (SSRF) [HIGH]

- ユーザー入力から URL を構築して `fetch` する箇所がないか確認する
- MCP サーバーの URL 設定が外部から操作可能でないか確認する
- 許可リスト方式で接続先を制限しているか確認する

### 7. サービス拒否 (DoS) 対策 [HIGH]

- リクエストボディのサイズ制限が設定されているか確認する
- 正規表現に ReDoS（Regular expression Denial of Service）の危険がないか確認する
- 無制限のループ、再帰、メモリ確保がないか確認する
- Webhook の同期処理でタイムアウトが設定されているか確認する

### 8. 依存関係のセキュリティ [HIGH]

- 既知の脆弱性がある npm パッケージを追加していないか確認する
- `package.json` の依存追加時にライセンスの互換性を確認する（GPL 系は MIT と非互換）
- ロックファイル（`bun.lock`）の変更が意図的なものか確認する
- postinstall スクリプトを持つ未知のパッケージに注意する

### 9. 機微情報の取り扱い [HIGH]

- ログ出力に以下が含まれていないか確認する:
  - API キー、トークン、パスワード
  - 個人識別情報（PII）
  - セッショントークンや認証ヘッダの生値
- OpenTelemetry のスパン属性やメトリクスラベルにシークレットが含まれていないか確認する
- エラーレスポンスにスタックトレースや内部実装の詳細を含めていないか確認する

```typescript
// NG: ログにシークレットを出力
logger.info(`Auth header: ${request.headers.get("authorization")}`);

// OK: マスキングして出力
logger.info(`Auth: ${authType} (credentials redacted)`);
```

### 10. HTTP セキュリティヘッダ [MEDIUM]

- レスポンスに適切なセキュリティヘッダが設定されているか確認する:
  - `Content-Type` が正しく設定されている
  - `X-Content-Type-Options: nosniff`
  - `Strict-Transport-Security`（HTTPS 環境の場合）
- Cookie を使用する場合:
  - `Secure` フラグ（HTTPS 環境）
  - `HttpOnly` フラグ
  - `SameSite` 属性

### 11. エラーハンドリングと情報漏洩 [MEDIUM]

- catch ブロックでエラーを握りつぶしていないか確認する
- 外部向けエラーレスポンスに内部情報（ファイルパス、DB スキーマ等）を含めていないか確認する
- 未処理の Promise rejection がないか確認する

### 12. 暗号化・ハッシュ [MEDIUM]

- 非推奨のアルゴリズム（MD5、SHA-1）をセキュリティ目的で使用していないか確認する
- 乱数生成に `Math.random()` ではなく `crypto.getRandomValues()` を使用しているか確認する
- JWT の署名アルゴリズムが適切か確認する（HS256 以上）

### 13. 型安全性とバリデーション [MEDIUM]

- 外部入力（HTTP リクエスト、環境変数、ファイル読み込み）に対して Zod 等によるランタイムバリデーションを行っているか確認する
- `as` による型アサーションで実行時の型チェックを迂回していないか確認する
- `any` 型の使用が最小限か確認する

### 14. プロトタイプ汚染 [LOW]

- `Object.assign` や spread 演算子でユーザー入力をマージする際に `__proto__`、`constructor`、`prototype` キーを除外しているか確認する
- 深いマージ処理でプロトタイプチェーンの汚染が起きないか確認する

---

## レビューコメントの書式

レビューコメントは以下の形式で記述する:

```
[重大度] カテゴリ: 指摘事項の要約

問題の説明と修正方針。
```

例:

```
[CRITICAL] コマンドインジェクション: ユーザー入力がシェルコマンドに直接展開されている

`userInput` を `sh -c` 経由で実行しており、任意コマンド実行が可能です。
`Bun.spawn` の配列形式引数に変更し、シェル展開を回避してください。
```

---

## TypeScript レビューガイドライン

本プロジェクトは `strict: true` に加え、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax` を有効にしている。これらの設定を前提としたレビューを行う。

### 1. 型安全性 [HIGH]

- `as` による型アサーションを安易に使用していないか確認する。特に `as any` は原則禁止
- `any` 型の導入は最小限に留め、`unknown` + 型ガードで代替できないか確認する
- `!`（non-null assertion）の使用箇所で、実際に null/undefined にならない保証があるか確認する

```typescript
// NG: 型アサーションで型チェックを迂回
const data = JSON.parse(body) as Config;

// OK: ランタイムバリデーション
const data = configSchema.parse(JSON.parse(body));
```

```typescript
// NG: non-null assertion の濫用
const value = map.get(key)!;

// OK: 存在チェック
const value = map.get(key);
if (value === undefined) {
  throw new Error(`Key not found: ${key}`);
}
```

### 2. `exactOptionalPropertyTypes` の遵守 [HIGH]

このプロジェクトでは `exactOptionalPropertyTypes: true` が有効。optional プロパティに `undefined` を明示的に代入するコードはコンパイルエラーになる。

```typescript
interface Options {
  timeout?: number;
}

// NG: コンパイルエラー
const opts: Options = { timeout: undefined };

// OK: プロパティを省略
const opts: Options = {};
```

### 3. `noUncheckedIndexedAccess` の遵守 [HIGH]

配列やオブジェクトのインデックスアクセスは `T | undefined` を返す。結果を使用する前に undefined チェックを行っているか確認する。

```typescript
const items: string[] = ["a", "b"];

// NG: items[0] は string | undefined
const first: string = items[0];

// OK: 存在チェック後に使用
const first = items[0];
if (first === undefined) {
  throw new Error("Empty array");
}
```

### 4. モジュールシステム [HIGH]

- ESM (`import`/`export`) を使用する。`require()` は使わない
- `verbatimModuleSyntax` が有効なため、型のみのインポートには `import type` を使用する
- 相対インポートには `.js` 拡張子を付ける（ESM + NodeNext 解決）

```typescript
// NG: 型を値インポートに混在
import { MyType, myFunction } from "./module.js";

// OK: 型は import type で分離
import type { MyType } from "./module.js";
import { myFunction } from "./module.js";
```

```typescript
// NG: 拡張子なし
import { foo } from "./utils";

// OK: .js 拡張子を付ける
import { foo } from "./utils.js";
```

### 5. エラーハンドリング [HIGH]

- `catch` ブロックで受け取るエラーは `unknown` 型。`instanceof` や型ガードで判別してから使用する
- Promise の戻り値を `void` で握りつぶしていないか確認する
- `async` 関数内の `try-catch` で、await なしの Promise が catch されずに漏れていないか確認する

```typescript
// NG: catch の err を any として扱う
try { ... } catch (err) {
  console.error(err.message);
}

// OK: 型ガードで判別
try { ... } catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
}
```

### 6. null / undefined の扱い [MEDIUM]

- `== null` で null と undefined を同時にチェックするのは許容するが、意図が明確であること
- Optional chaining (`?.`) の多段ネストは可読性を損なうため、早期リターンへの書き換えを検討する
- Nullish coalescing (`??`) と論理 OR (`||`) を混同していないか確認する（`0` や `""` の扱いが異なる）

```typescript
// NG: || は 0 や "" を falsy として扱う
const port = config.port || 8080;

// OK: ?? は null/undefined のみ
const port = config.port ?? 8080;
```

### 7. 非同期処理 [MEDIUM]

- `async` 関数の戻り値を await せずに捨てていないか確認する（fire-and-forget が意図的な場合はコメントで明示）
- `Promise.all` で並行実行する際、個別のエラーが他の Promise を中断しないか確認する
- `setTimeout`/`setInterval` のコールバック内で async 関数を使う場合、エラーハンドリングが漏れていないか確認する

```typescript
// NG: await 忘れ（エラーが飲み込まれる）
someAsyncFunction();

// OK: await する
await someAsyncFunction();

// OK: 意図的な fire-and-forget（void で明示）
void someAsyncFunction().catch(handleError);
```

### 8. 列挙型とユニオン型 [MEDIUM]

- `enum` よりも `const` オブジェクト + ユニオン型、または文字列リテラルユニオンを優先する
- `switch` 文で discriminated union を扱う場合、`default` で網羅性チェック（exhaustive check）を行っているか確認する

```typescript
// OK: 網羅性チェック
function handle(action: Action): string {
  switch (action.type) {
    case "create": return "created";
    case "delete": return "deleted";
    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown action: ${_exhaustive}`);
    }
  }
}
```

### 9. 不変性 [LOW]

- 変更しない変数には `const` を使用する
- 配列やオブジェクトを変更しない場合は `readonly` や `as const` を活用する
- 関数引数のオブジェクトを副作用なく扱っているか確認する（引数を直接変更していないか）

### 10. デッドコードと未使用定義 [LOW]

- 未使用の `import`、変数、関数、型定義がないか確認する
- コメントアウトされたコードが残っていないか確認する
- 到達不能コード（`return` 後の処理等）がないか確認する

---

## レビュー対象外

- コードスタイル（フォーマット、インデント等）は別途 linter / formatter で担保する
- パフォーマンス最適化はセキュリティまたは正確性に関係する場合のみ指摘する
