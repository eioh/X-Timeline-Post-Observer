# X Timeline Post Observer

X / Twitter のタイムラインを監視し、指定条件に一致する投稿を自動で非表示にする Tampermonkey 用ユーザースクリプトです。新着投稿の自動読み込み、投稿メニューからのワンクリック非表示、設定のインポート / エクスポートにも対応しています。

## できること

- 指定ユーザーの投稿を非表示にする
- 指定キーワードを含む投稿を非表示にする
- 指定した投稿 ID の投稿を非表示にする
- 特定リストのタイムラインで「メディア付き投稿だけ表示」にする
- X 標準の投稿メニューに「このポストを非表示」を追加する
- タイムライン最上部にいるときだけ「新しいポストを表示」を自動で押す
- 設定を JSON でバックアップ / 復元する

## 動作環境

- ブラウザ: Tampermonkey が動作する Chromium 系または Firefox 系ブラウザ
- 対象サイト: `https://x.com/*`, `https://twitter.com/*`
- 実行タイミング: `document-idle`

## インストール

1. ブラウザに Tampermonkey を導入します。
2. 開発者は `npm install` を実行し、`npm run build` で [`dist/main.js`](./dist/main.js) を生成します。
3. [`dist/main.js`](./dist/main.js) の内容を新規ユーザースクリプトとして登録します。
4. X または Twitter を開き、スクリプトを有効化します。

## 開発

- 開発用エントリポイントは [`src/index.js`](./src/index.js) です。
- 配布物は [`dist/main.js`](./dist/main.js) です。
- ビルドコマンドは `npm run build`、監視ビルドは `npm run watch` です。

## 使い方

### Tampermonkey メニューから設定する

Tampermonkey のメニューから次の操作ができます。

- `非表示ユーザーIDを追加`
- `非表示ポストIDを追加`
- `非表示キーワードを追加`
- `設定をエクスポート`
- `設定をインポート`

投稿 ID には数値そのものか、`/status/<数字>` を含む投稿 URL を使えます。

### 投稿メニューから直接非表示にする

各投稿の `...` メニューを開くと、`このポストを非表示 (X-Observer)` が追加されます。選ぶとその投稿 ID が非表示対象に登録され、現在のタイムラインにもすぐ反映されます。

### コンソール API を使う

開発者ツールのコンソールから `window.XObserver` を使って設定できます。

```js
XObserver.addHiddenUser('@example')
XObserver.addHiddenWord('spoiler')
XObserver.addHiddenStatus('1234567890123456789')
XObserver.addMediaFilterList('リスト名')
XObserver.showConfig()
XObserver.reapplyFilters()
XObserver.toggleHideUI()
XObserver.toggleAutoRefresh()
```

## 設定の仕様

- 非表示投稿は 30 日で期限切れになります。
- ユーザー ID は `@` の有無どちらでも登録できます。
- 設定ファイルはバージョン付き JSON です。将来フォーマットが変わる可能性があります。

## 注意点

- X 側の DOM 構造や属性名が変わると、一部機能が動かなくなることがあります。
- 自動更新はタイムラインの先頭付近にいるときだけ動作します。
- UI 非表示機能はヘッダーや投稿フォームを隠すため、通常の X の見た目とは少し変わります。
