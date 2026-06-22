# `install-skills` サブコマンド

## 概要

prepalert-agent が提供するスキルファイルを、Claude Code やその他のエージェントツールにインストールするコマンド。AI（Anthropic API）を必要としない。

スキルファイルは prepalert-agent のバイナリに同梱されており、このコマンドで指定先のディレクトリに配置する。

## 使い方

```bash
prepalert-agent install-skills [--target <target>]
```

## オプション

### `--target`

- **型:** `string`
- **必須:** No
- **説明:** スキルのインストール先。省略時は対話的に選択を求める。

| 値 | インストール先 |
|---|---|
| `project` | `.claude/skills/` （プロジェクトローカル） |
| `user` | `~/.claude/skills/` （ユーザーグローバル） |
| 任意のパス | 指定されたパスに直接配置 |

対話的選択時の選択肢:

```
? スキルのインストール先を選択してください
  (1) project — .claude/skills/ (プロジェクトローカル)
  (2) user    — ~/.claude/skills/ (ユーザーグローバル)
  (3) other   — パスを直接入力
```

## インストールされるスキル

### `initialize-prepalert-project`

プロジェクトの初期化を AI が支援するスキル。

**インストール先のファイル構造:**

```
<target>/initialize-prepalert-project/SKILL.md
```

**スキルの動作:**

1. `prepalert-agent init` 相当の scaffolding を実行（未初期化の場合）
2. `.mcp.json` の MCP サーバー構成を読み取る
3. プロジェクトの文脈（ディレクトリ構成、既存の設定ファイル等）を分析
4. MCP サーバーで利用可能なツールに基づいて、実用的な runbook を生成
5. `prepalert.yaml` の `instructions` を必要に応じて調整

## 対話モードとの関係

対話モード (`prepalert-agent run`) のビルトインコマンド `/init` は、`initialize-prepalert-project` スキルと同等の処理を内部的に実行する。

- `install-skills` でインストールしたスキルは Claude Code 上で `/initialize-prepalert-project` として直接使用できる
- prepalert-agent の対話モードでは `/init` コマンドで同じスキル定義を内部的に呼び出す
- どちらの入口でも同じスキル定義に基づいて動作するため、結果は同等

## 将来の拡張

現在は `initialize-prepalert-project` のみ提供。将来的に以下のようなスキルの追加を想定する:

- `generate-runbook` — 既存のアラート履歴や MCP サーバー情報から runbook を生成
- `analyze-alert` — アラート内容を分析して対応方針を提示

スキルが複数になった場合、`--skill <name>` オプションで個別指定、省略時は全スキルをインストールする形を想定する。
