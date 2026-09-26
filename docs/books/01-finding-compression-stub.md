# CompressionManager スタブバグ修正

types:
  - finding
  - architecture

tags:
  - airgent
  - compression
  - storage
  - memory
  - bug-fix
  - architectural-debt
  - missing-wiring

## What

CompressionManager.findEntry() が常に null を返すスタブ。findForDecompression() は空配列。
decompress() が常に 'Compressed entry not found' を throw — 圧縮サブシステムの取得側が Storage 層に配線されておらず、稼働していなかった。

## Why

CompressionManager は MemorySystem 経由のストレージアクセスを想定していたが、findEntry/decompress も findForDecompression も実際の Storage をクエリしていなかった。アーキテクチャ上の配線ミス。

## How

1. CompressionManager に `private storage: Storage` 追加
2. コンストラクタ第2引数から注入: `new CompressionManager(memory, storage)`
3. `findEntry()` を `storage.getCompressedByOriginalId()` で実装
4. `findForDecompression()` を `storage.getCompressedByTopics()` で実装、JSON.parse マッピング

## regression_risk

- Storage の API 変更 (`getCompressedByOriginalId` / `getCompressedByTopics` のシグネチャ変更)
- CompressionManager のコンストラクタ変更
- MemorySystem リファクタリングによる依存関係変更
- 新たな CompressionManager サブクラスの作成

## verified_against

- bun: 1.x
- sqlite: WAL

## Notes

- compressSession (書き込み側) は正常動作。問題は取得側のみ。
- 未使用パラメータ `_id` プレフィックスが未完成のシグナルだった。
