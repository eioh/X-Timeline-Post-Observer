# X Timeline Post Observer

X / Twitter のタイムラインを監視し、条件に一致する投稿を非表示にする Tampermonkey 用ユーザースクリプトです。  
ユーザー ID、ポスト ID、キーワード、メディア用リストを使ったフィルターに対応し、加えてフォロー / リストイン / ユーザー定義分類に登録したユーザー ID の色分け表示も行えます。設定ダイアログから一覧表示・追加・削除・設定変更を行えます。

## できること

- 指定したユーザー ID の投稿を非表示にする
- 指定したキーワードを含む投稿を非表示にする
- 指定したポスト ID の投稿を非表示にする
- 指定したリスト名で「メディアなし投稿」を非表示にする
- フォロー中ユーザーの `@userId` を青、リストインユーザーの `@userId` を緑、ユーザー定義分類の `@userId` を分類別の色で表示する
- X の投稿メニューに「このポストを非表示」を追加する
- タイムライン最上部にいるときだけ新着読み込みを自動実行する
- 設定を JSON でエクスポート / インポートする

## 対応環境

- ブラウザ: Tampermonkey が動作する Chromium 系ブラウザ / Firefox 系ブラウザ
- 対象 URL: `https://x.com/*`, `https://twitter.com/*`
- 実行タイミング: `document-idle`

## インストール

1. ブラウザに Tampermonkey をインストールします。
2. 開発時は `npm install` を実行します。
3. `npm run build` で [`dist/main.js`](./dist/main.js) を生成します。
4. 生成した [`dist/main.js`](./dist/main.js) を Tampermonkey へ登録します。
5. X / Twitter を開き、スクリプトが有効になっていることを確認します。

## 開発

- 開発用エントリポイント: [`src/index.js`](./src/index.js)
- 配布用ビルド: [`dist/main.js`](./dist/main.js)
- 本番ビルド: `npm run build`
- 監視ビルド: `npm run watch`
- 設定ダイアログの軽量プレビュー: ローカルサーバーを起動し、[`dev/settings-dialog-preview.html`](./dev/settings-dialog-preview.html) を開く

## 使い方

### 設定ダイアログ

Tampermonkey メニューから `設定ダイアログを開く` を選ぶと、設定画面を開けます。  
ダイアログでは次の操作ができます。

- `ユーザーID` タブ: 非表示ユーザーの一覧表示、追加、削除
- `フォロー` タブ: フォローユーザーの一覧表示、追加、削除
- `リスト` タブ: リストインユーザーの一覧表示、追加、削除
- `分類 > 分類` タブ: フォロー / リスト以外の分類作成、削除、色の設定
- 追加した分類タブ: 分類ごとのユーザー一覧表示、追加、削除
- `ポストID` タブ: 非表示ポストの一覧表示、追加、削除
- `キーワード` タブ: 非表示キーワードの一覧表示、追加、削除
- `メディア` タブ: メディアフィルタ対象リストの一覧表示、追加、削除
- `設定` タブ: UI 非表示、自動更新の ON/OFF、設定のエクスポート / インポート

一覧は 1 ページあたり 500 件表示です。ページネーションの現在ページ欄へ直接ページ番号を入力できます。不正な値を入れた場合は、表示可能な範囲へ自動補正されます。

### Tampermonkey メニュー

ダイアログ以外に、従来どおり Tampermonkey メニューから個別操作もできます。

- `設定ダイアログを開く`
- `非表示ユーザーIDを追加`
- `フォローユーザーIDを追加`
- `リストインユーザーIDを追加`
- `非表示ポストIDを追加`
- `非表示キーワードを追加`
- `設定をエクスポート`
- `設定をインポート`

ポスト ID は数値だけでなく、`/status/<数字>` を含む投稿 URL でも追加できます。

### 投稿メニューからの非表示

各投稿の `...` メニューを開くと、`フォローとして追加`、`リストインとして追加`、作成済みユーザー定義分類への追加、`このユーザーを非表示`、`このポストを非表示` を追加表示します。  
選択すると対象ユーザーや投稿 ID が設定へ追加され、現在のタイムラインにも即時反映されます。

### コンソール API

`window.XObserver` から主要操作を実行できます。

```js
XObserver.addHiddenUser('@example')
XObserver.addHiddenUser('2006652807877931008')
XObserver.addFollowUser('@example')
XObserver.addListUser('@example')
XObserver.addCustomUserCategory('分類名', '#f5c542')
XObserver.setCustomUserCategoryColor('custom-category-id', '#ff7a59')
XObserver.addCustomCategoryUser('custom-category-id', '@example')
XObserver.addHiddenWord('spoiler')
XObserver.addHiddenStatus('1234567890123456789')
XObserver.addMediaFilterList('リスト名')
XObserver.openSettingsDialog()
XObserver.showConfig()
XObserver.reapplyFilters()
XObserver.toggleHideUI()
XObserver.toggleAutoRefresh()
```

## 設定仕様

- 非表示ポスト ID は 30 日で期限切れになります
- ユーザー ID は保存時に先頭の `@` を除去して正規化します。数字だけの内部 ID も同じユーザー ID 設定として扱います
- ユーザー色分けの自動学習は `https://x.com/home` のホームタイムラインでのみ行います
- `フォロー中` タブの通常投稿はフォローユーザーとして自動記録します
- `おすすめ` 以外かつ `フォロー中` 以外のタブの通常投稿はリストインユーザーとして自動記録します
- 色分けの優先度は `フォロー > リストイン > ユーザー定義分類 > 色なし` です
- ユーザー定義分類の色は設定ダイアログの `設定 > 分類` から変更できます
- キーワードは比較時のみ大文字小文字を無視します
- 設定ファイルは `version` 付き JSON です
- 設定ファイルにはフィルター一覧に加えて `UI 非表示` と `自動更新` の設定も含まれます

## 注意点

- X 側の DOM 構造変更に強く依存しているため、一部機能だけ壊れる可能性があります
- メディア判定は引用ポスト内の画像・動画を差し引く前提で実装しています
- 非表示処理は `article` ではなく祖先セルを `display: none` にしているため、関連ロジックの変更は慎重に行ってください
- UI 非表示機能は X のヘッダーや投稿フォームを隠すため、通常の閲覧 UI とは見え方が変わります
