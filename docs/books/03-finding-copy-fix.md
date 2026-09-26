# Airgent コピー機能修正

types:
  - finding
  - design

tags:
  - airgent
  - clipboard
  - osc52
  - terminal
  - event-model
  - tui
  - bug-fix
  - missing-fallback
  - missing-feedback

## What

Airgent のコピーが動作しない — 4つの根本原因と3つの応急処置。

### 根本原因

1. **handleSelection は opentui 内部選択イベントでのみ発火**
   ターミナルのマウス選択を拾えない。イベントモデルの不一致。

2. **isOsc52Supported() が DA クエリに依存**
   多くのターミナルは OSC52 対応だが DA でアドバタイズしない → `copyToClipboardOSC52` が暗黙に false を返す。

3. **フォールバックチェーンなし**
   OSC52 しかパスがない。`xclip` / `wl-copy` / `pbcopy` / tempfile が存在しない。

4. **`_copyInProgress` フラグが再入発火をマスク**
   根本原因を解決せずに症状を隠している。

### 応急処置 (band-aids)

- "Copied!" トーストが commit `a4aafe2` で削除済み (ユーザーフィードバック喪失)
- `sel.isDragging` / `sel.isActive` ガードが削除済み
- `catch {}` がすべてのエラーを飲み込み

## Why

コピーが実使用で完全に壊れていた。マウス選択で出力なし、OSC52 は暗黙失敗、ユーザーフィードバックゼロ。

## How

1. **`src/utils/clipboard.ts`** (新規)
   フォールバックチェーン: OSC52 → pbcopy (macOS) → wl-copy (Wayland) → xclip/xsel (X11) → tempfile (`/tmp/airgent-copy-*.txt`)

2. **`src/ui/index.ts`**
   - `copy(text): CopyResult` — public API、内部で clipboard util + `renderer.osc52` を使用
   - `showCopyToast(result)` — absolute 配置トースト、緑="Copied!" / 赤="Copy failed"、3秒自動消去
   - `handleSelection` — `copyToClipboard` + `showCopyToast` を呼ぶよう更新
   - `_copyToastTimer` — `stop()` でクリーンアップ

3. **`src/Airgent.ts`**
   - `/copy [text]` コマンド追加 — 引数なしで `pipelineData.generatedOutput` をコピー、使用したメソッドを表示
   - `/help` と `/info` 更新

## regression_risk

- `handleSelection` のイベントモデル変更
- OSC52 検出ロジック変更
- `clipboard.ts` のフォールバックチェーンから一つでも削除された場合
- トースト UI のリファクタリング
- `_copyToastTimer` の cleanup 漏れ

## verified_against

- opentui: 0.2.12
- bun: 1.x

## Notes

- 全151テストパス、TypeScript ビルド正常
- clipboard.ts は新規ファイル
