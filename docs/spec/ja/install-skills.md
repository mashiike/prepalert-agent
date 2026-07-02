# `skills` サブコマンド

## 概要

prepalert-agent が提供するスキルファイルを、Claude Code やその他のエージェントツールにインストール・管理するコマンド。AI（Anthropic API）を必要としない。

スキルファイルは prepalert-agent のバイナリに同梱されており、このコマンドで指定先のディレクトリに配置する。

## 使い方

```bash
prepalert-agent skills <subcommand> [options]
```

### サブコマンド

| コマンド | 説明 |
|---|---|
| `list` | 同梱されているスキルの一覧を表示 |
| `install` | スキルをインストール |
| `update` | インストール済みスキルを最新版に更新 |
| `uninstall` | インストール済みスキルを削除 |
| `status` | インストール済みスキルの状態を表示 |

### `skills install`

```bash
prepalert-agent skills install [--scope <scope>] [--dry-run] [--force]
```

### オプション

#### `--scope`

- **型:** `string`
- **必須:** No
- **説明:** スキルのインストール先。省略時は対話的に選択を求める。

| 値 | インストール先 |
|---|---|
| `project` | `.claude/skills/` （プロジェクトローカル） |
| `user` | `~/.claude/skills/` （ユーザーグローバル） |

対話的選択時の選択肢:

```
? スキルのインストール先を選択してください
  (1) project — .claude/skills/ (プロジェクトローカル)
  (2) user    — ~/.claude/skills/ (ユーザーグローバル)
  (3) other   — パスを直接入力
```

#### `--dry-run`

変更を適用せずプレビューのみ表示する。

#### `--force`

既存のスキルファイルを上書きする。

### `skills update`

```bash
prepalert-agent skills update [--scope <scope>] [--dry-run]
```

インストール済みスキルを最新版に更新する。`--scope` でスコープを指定、省略時は対話的に選択。

### `skills uninstall`

```bash
prepalert-agent skills uninstall [--scope <scope>] [--dry-run]
```

インストール済みスキルを削除する。

### `skills status`

```bash
prepalert-agent skills status [--scope <scope>]
```

インストール済みスキルのバージョンと更新状態を表示する。

## インストールされるスキル

### `prepalert-agent`

プロジェクトの設定、runbook 作成、webhook サーバーの構成を AI が支援するスキル。

**インストール先のファイル構造:**

```
<scope>/prepalert-agent/
├── SKILL.md
└── references/
    ├── instructions-guide.md
    └── runbook-template.md
```

## 対話モードとの関係

対話モード (`prepalert-agent run`) のビルトインコマンド `/init` は、同等の処理を内部的に実行する。

- `skills install` でインストールしたスキルは Claude Code 上で直接使用できる
- prepalert-agent の対話モードでは `/init` コマンドで同じスキル定義を内部的に呼び出す
