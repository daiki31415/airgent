# Books System — Durable Knowledge Store

types: `decision`
tags: `airgent`, `policy`, `documentation`, `meta`

## What

`docs/books/` はプロジェクトの durable knowledge store。
バグ調査・アーキテクチャ決定・設計判断・運用設定の永続的記録。

## Why

会話のたびに同じ知識を再生成しないため。
AI は会話を忘れるが books は忘れない。

```
会話 = L1キャッシュ (揮発)
books = L2キャッシュ (永続)
```

## How

### ディレクトリ

全エントリは `docs/books/` に md ファイルとして保存。
同時に books DB (opencode の durable knowledge 機能) にも同一内容を保存し、セッション中は DB 経由で検索、永続化は md で行う。

### 命名規則

```
docs/books/NN-<type>-<slug>.md
```

- `NN`: 01, 02... の連番
- `type`: config, finding, decision, task, error
- `slug`: 英語 kebab-case

例:
- `01-finding-compression-stub.md`
- `02-finding-vnode-proxy.md`
- `03-finding-copy-fix.md`
- `04-decision-bug-fix-policy.md`
- `00-config-project-overview.md`

### Entry Types

| Type | 用途 | 例 |
|---|---|---|
| config | プロジェクト設定・概要 | プロジェクト全体像、スタック情報 |
| finding | バグ調査・原因分析 | ルート原因、修正内容 |
| decision | 設計判断・ポリシー | なぜその方式を選んだか |
| task | 実行タスク | （今は未使用） |
| error | エラー記録 | （今は未使用） |

### 必須フィールド

```markdown
types:
  - <primary-type>
  - <sub-type>          # 複数可: finding + architecture 等

tags:
  - <project>           # プロジェクト名 (e.g. airgent)
  - <technology-area>   # 技術領域 (e.g. opentui, clipboard, compression)
  - <domain-concept>    # ドメイン概念 (e.g. vnode, proxy, osc52, event-model)
  - <failure-type>      # 障害タイプ (e.g. bug-fix, architectural-debt, missing-wiring, stale-reference, missing-fallback)

regression_risk:
  - どういう変更で再発するか

verified_against:
  <library>: <version>  # finding が腐らないよう検証時のバージョン
```

### 記録判断基準

| 条件 | 記録する |
|---|---|
| 原因が非自明 | ✅ |
| アーキテクチャ上の変更を含む | ✅ |
| 同じバグが再発しうる | ✅ |
| 1文字修正・タイポのみ | ❌ |
| 純粋に表面的な問題 | ❌ |

### 運用ルール

1. **バグ修正時**は必ず books に記録するか判断する (conscious decision)
2. **finding は腐る** — ライブラリ依存・workaround・internal API 系は `verified_against` でバージョンを明記
3. **tags 分離** — 「技術領域」と「障害タイプ」は別タグにする (例: `opentui` vs `stale-reference`)
4. **書くときは簡潔に** — what/why/how/regression_risk/verified_against で十分
5. **md が source of truth** — books DB は検索キャッシュ、md が永続化

### メンテナンス

- `verified_against` のバージョンが古くなったら finding は見直し対象
- プロジェクトの大規模リファクタリング後に全 finding のレビューを推奨
