# opentui VNode Proxy スタブ参照バグ

types:
  - finding

tags:
  - airgent
  - opentui
  - lifecycle
  - vnode
  - proxy
  - rendering
  - bug-fix
  - stale-reference

## What

opentui の ScrollBox/Input/Box/Select ファクトリ関数は VNode Proxy を返す。
`renderer.root.add(vnode)` 後、VNode は実レンダラブルにインスタンス化されるが、保持参照は古い Proxy を指したまま。
`.add()`, `.on()`, `.focus()`, `.value=` は `__pendingCalls` にキューされ再生されない。

## Why

post-mount でコンポーネントと対話する opentui ベースの UI すべてが暗黙に失敗する。1時間以上デバッグを要した。

## How

VNode と実レンダラブルを分離:

1. `vnode` 変数で `renderer.root.add(vnode)` を実行
2. add 後に `renderer.root.findDescendantById(id)` で実体を取得
3. `.on()` / `.focus()` は add **前**に VNode に対して呼ぶ (pending calls がインスタンス化時に再生される)
4. プロパティ書き込みは実レンダラブルに対して行う

**パターン:**
```typescript
const vnode = ScrollBox({id:'x'});
root.add(vnode);
const actual = root.findDescendantById('x');
```

## regression_risk

- opentui renderer 内部のリファクタリング
- VNode ライフサイクル変更
- add() 後のプロキシ動作変更
- post-mount でコンポーネントを操作する新機能追加

## verified_against

- opentui: 0.2.12

## Notes

- Select, Box, その他 opentui ファクトリ関数すべてに適用
- add() 後の focus は `setTimeout(0)` が必要な場合がある
