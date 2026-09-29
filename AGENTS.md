# AGENTS.md

## 概要

- このリポジトリは、X / Twitter のタイムラインを監視して投稿を非表示化する Tampermonkey 用ユーザースクリプトです。ただし現在は後述の「安全モード」で動いており、非表示化は無効です。
- 開発用の実装入口は [`src/index.js`](./src/index.js)、配布物は [`dist/main.js`](./dist/main.js) です。
- 実装追加は `src/` 配下の機能別モジュールへ寄せ、入口ロジックは [`src/index.js`](./src/index.js) に集約してください。

## ビルド

- 依存導入は `npm install`、配布物生成は `npm run build`、監視ビルドは `npm run watch` です。
- Userscript のメタデータブロックは [`rollup.config.js`](./rollup.config.js) の `banner` で付与しています。`dist/main.js` を手編集すると次回ビルドで上書きされます。

## 安全モード（現在の動作状態）

- `aeb60bf fix: enable safety mode on develop` 以降、[`src/index.js`](./src/index.js) の `init()` は安全モード専用の構成です。フラグによる切り替えはなく、無効機能の import と初期化呼び出しを外すことで止めています（`rollup.config.js` の `@description` も同趣旨）。
- 有効: ユーザー分類色（[`src/features/userLabelObserver.js`](./src/features/userLabelObserver.js) が `article` 追加だけを監視し、`applyUserLabelsFromDom()` で DOM 上の `@userId` 表示から着色）、設定ダイアログ、Tampermonkey メニュー、`XObserver` API による設定の追加・削除・インポート / エクスポート。
- 無効: 投稿の非表示（`dom/processor.js` / `dom/observers.js` / `filters/shouldHide.js`）、自動更新（`features/autoRefresh.js`）、X 標準メニューへの「このポストを非表示」注入（`features/dropdownHideMenu.js`）、X UI 非表示・レイアウト圧縮（`features/hideUi.js`）、React 内部データ参照（`extractors/`）。ファイルは残っていますが `src/index.js` から呼ばれていません。設定ダイアログの UI 非表示 / 自動更新トグルと、API の `setHideUI` / `toggleHideUI` / `start|stop|toggleAutoRefresh` も削除済みです。
- 非表示ユーザー・キーワード等の設定は保存できますが画面には反映されません。安全モードでの `reapplyFilters` は `reapplyUserLabels`（分類色の再適用のみ）を指します。分類は画面上の screen name だけで行うため、数字の内部 ID で登録したユーザーは着色されません。保存値 `hideUIEnabled` / `autoRefreshEnabled`（既定 `true`）も読み込み・エクスポートは続きますが参照されません。
- 理由: コードコメントでは、X の標準 UI 変更・React 内部参照・スクロールやクリックによる追加読込の誘発を避け、`display` やスクロール位置に影響する処理を行わないため、とされています。
- 無効機能は不具合ではありません。ユーザーの明示的な指示がない限り再有効化しないでください。以下の非表示・メディア判定・メニュー注入・自動更新に関する注意点は、再有効化時のためのものです。

## セッション運用メモ

- コメント追加や関数説明の粒度で迷ったら、[`doc/comment-style.md`](./doc/comment-style.md) を参照してください。
- 実サイト依存の情報、特に DOM 構造や属性値が必要な変更では、推測で埋めずにユーザーへ確認してください。
- コミットメッセージは `feat:` や `fix:` などの Conventional Commits スタイルで記述してください。

## 変更時に優先して守ること

- X 側の DOM 構造と `data-testid` / `role` / React Fiber への依存が強いです。セレクタ変更は見た目が動いても一部機能だけ壊れやすいため、投稿抽出、メニュー注入、ドロップダウンのクローズ、自動更新の4系統をまとめて確認してください（安全モード中に動くのは分類色の `@userId` 抽出のみ）。
- （安全モードで無効）投稿の非表示は `article` 自体ではなく、絶対配置された祖先セルを `display: none` にしています。ここを崩すと仮想スクロールの空白や高さズレが起きます。
- （安全モードで無効）メディア判定は引用ポスト内の画像・動画を差し引いています。単純に `tweetPhoto` や動画要素の総数だけで判定しないでください。
- （安全モードで無効）初回処理後にメディアが遅延挿入されるため、`processNewArticles` だけでは不十分です。メディア追加監視と `handleLateMedia` の再判定経路は維持してください。
- 設定変更後は保存だけでは画面に反映されません。UI からの追加・削除・インポートの後は `reapplyFilters()` を呼ぶ前提です（安全モード中は分類色の再適用のみ）。

## 永続化と互換性

- 設定は Tampermonkey ストレージへ分散保存しています。キー名を変える変更は既存ユーザーの設定移行方針を同時に決めてください。
- `hiddenStatuses` は `expiresAt` を持つ期限付きデータで、起動時に期限切れを掃除します。単なる文字列配列へ戻す変更は既存仕様を壊します。
- インポート / エクスポートは `version` 付き JSON です。形式変更時は `EXPORT_VERSION` と `normalizeImportedConfig()` をセットで更新してください。
- `hiddenUserIds` は保存時に先頭の `@` を除去します。入出力の表記ゆれを吸収しているので、この正規化は残してください。

## 外部公開 API

- `unsafeWindow.XObserver` をコンソール操作用 API として公開しています。名前変更や削除は README の操作手順も更新してください。
- Tampermonkey メニューと `XObserver` API は同じ設定データを触ります。片方だけ更新して挙動が分岐しないようにしてください。

## 変更確認の観点

- 安全モード中: 分類色がタイムライン追加読込分にも付き、設定変更・インポート後に `reapplyFilters()` で色が同期するか。非表示・自動更新・X UI 変更が起動していないか。
- （再有効化時）通常投稿、引用投稿、画像投稿、動画投稿で抽出結果と非表示判定が崩れていないか。
- （再有効化時）「このポストを非表示」メニューが X 標準メニュー表示後に追加され、選択後にメニューが閉じるか。
- （再有効化時）タイムライン上部でのみ自動更新が走り、途中までスクロールした状態では勝手に更新しないか。
- 設定のエクスポート、インポート、期限切れデータの掃除後に `reapplyFilters()` で表示が同期するか。
