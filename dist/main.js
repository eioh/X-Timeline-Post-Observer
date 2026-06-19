// ==UserScript==
// @name         X Timeline Post Observer
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  安全モードでユーザー分類色と設定管理のみを行う
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValues
// @grant        GM_setValues
// @grant        unsafeWindow
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';

  /**
   * コンソール操作用 API を unsafeWindow へ公開する。
   * 入力: 公開したい関数群を持つオブジェクト
   * 出力: なし
   * 主な処理内容: Tampermonkey サンドボックス越しに window.XObserver を提供する
   */
  function exposeApi (api) {
    unsafeWindow.XObserver = api;
  }

  // DOM 上で「処理済み」と「非表示理由」を識別するための属性名。
  // CSS クラスではなく data 属性にしているのは、X 側のクラス変動と衝突しにくくするため。

  // 非表示にした投稿を一定期間で自然消滅させるための期限設定。
  // 恒久データにすると、過去の一時的な非表示が残り続けて管理しづらくなる。
  const EXPIRE_DAYS = 30;
  const EXPIRE_MS = EXPIRE_DAYS * 24 * 60 * 60 * 1000;

  // 設定 JSON の互換性判定に使う形式バージョン。
  // 形式変更時は import 側の検証と必ずセットで更新する。
  const EXPORT_VERSION = 4;

  // Tampermonkey ストレージの保存キー一覧。
  // モジュール分割後もキー名を散らさず、互換性影響をここで追えるようにしている。
  const STORAGE_KEYS = {
    mediaFilterLists: 'xtlo_mediaFilterLists',
    hiddenUserIds: 'xtlo_hiddenUserIds',
    followUserIds: 'xtlo_followUserIds',
    listUserIds: 'xtlo_listUserIds',
    customUserCategories: 'xtlo_customUserCategories',
    hiddenWords: 'xtlo_hiddenWords',
    hiddenStatuses: 'xtlo_hiddenStatuses',
    hideUIEnabled: 'xtlo_hideUIEnabled',
    autoRefreshEnabled: 'xtlo_autoRefreshEnabled'
  };

  /**
   * ユーザー ID を保存用の書式へ正規化する。
   * 入力: @ の有無どちらでもよいユーザー ID。
   * 出力: 先頭の @ を除去したユーザー ID。
   * 主な処理内容:
   * 1. 手入力と自動取得で形式を揃える
   * 2. 数字だけの内部 ID も文字列として同じ配列へ保存できるようにする
   */
  function normalizeUserId (userId) {
    return String(userId || '').trim().replace(/^@+/, '')
  }

  /**
   * ユーザー ID が数字だけの内部 ID 形式かどうかを判定する。
   * 入力: 正規化前後どちらでもよいユーザー ID。
   * 出力: 数字だけなら true。
   * 主な処理内容:
   * 1. 保存形式へ正規化する
   * 2. 空値を除外して数字だけの ID を判定する
   */
  function isNumericUserId (userId) {
    const normalizedUserId = normalizeUserId(userId);
    return Boolean(normalizedUserId) && /^\d+$/.test(normalizedUserId)
  }

  /**
   * ユーザー ID 候補のいずれかが設定リストに含まれるか判定する。
   * 入力: ユーザー ID 候補配列、設定済みユーザー ID 配列または正規化済み Set。
   * 出力: 一致したユーザー ID。無ければ null。
   * 主な処理内容:
   * 1. Set は configIndexes 由来の正規化済みデータとしてそのまま使う
   * 2. 配列は登録値も比較用に正規化する
   * 3. スクリーン名と内部数字 ID のどちらでも一致できるようにする
   */
  function findMatchingUserId (candidates, registeredUserIds) {
    if (registeredUserIds instanceof Set) {
      return candidates.find(userId => registeredUserIds.has(userId)) ?? null
    }

    const normalizedRegistered = new Set(
      registeredUserIds
        .map(userId => normalizeUserId(userId))
        .filter(Boolean)
    );

    return candidates.find(userId => normalizedRegistered.has(userId)) ?? null
  }

  // 判定用の派生インデックスを保持する。保存形式は config 側の配列を正とする。
  const configIndexes = {
    hiddenUserIds: new Set(),
    followUserIds: new Set(),
    listUserIds: new Set(),
    customUserCategoryIndexByUserId: new Map(),
    registeredInternalUserIds: new Set(),
    customCategoryIndexesByInternalUserId: new Map()
  };

  /**
   * ユーザー ID 配列から判定用 Set を作る。
   * 入力: 保存中のユーザー ID 配列。
   * 出力: 正規化済みユーザー ID の Set。
   * 主な処理内容:
   * 1. 保存済み値を比較用に正規化する
   * 2. 空値を除いて判定時にそのまま has できる形へ変換する
   */
  function createUserIdSet (userIds) {
    return new Set(
      userIds
        .map(userId => normalizeUserId(userId))
        .filter(Boolean)
    )
  }

  /**
   * 設定全体から判定用インデックスを再構築する。
   * 入力: 現在の config オブジェクト。
   * 出力: なし。
   * 主な処理内容:
   * 1. 配列保存されたユーザー ID を Set / Map へ変換する
   * 2. custom 分類は分類配列の先勝ち優先を維持して userId から分類 index を引けるようにする
   */
  function rebuildConfigIndexes (config) {
    configIndexes.hiddenUserIds = createUserIdSet(config.hiddenUserIds);
    configIndexes.followUserIds = createUserIdSet(config.followUserIds);
    configIndexes.listUserIds = createUserIdSet(config.listUserIds);
    configIndexes.customUserCategoryIndexByUserId = new Map();
    configIndexes.registeredInternalUserIds = new Set();
    configIndexes.customCategoryIndexesByInternalUserId = new Map();

    for (const userId of [
      ...config.hiddenUserIds,
      ...config.followUserIds,
      ...config.listUserIds
    ]) {
      const normalizedUserId = normalizeUserId(userId);
      if (isNumericUserId(normalizedUserId)) {
        configIndexes.registeredInternalUserIds.add(normalizedUserId);
      }
    }

    config.customUserCategories.forEach((category, categoryIndex) => {
      for (const userId of category.userIds) {
        const normalizedUserId = normalizeUserId(userId);
        if (
          normalizedUserId &&
          !configIndexes.customUserCategoryIndexByUserId.has(normalizedUserId)
        ) {
          configIndexes.customUserCategoryIndexByUserId.set(
            normalizedUserId,
            categoryIndex
          );
        }
        if (isNumericUserId(normalizedUserId)) {
          configIndexes.registeredInternalUserIds.add(normalizedUserId);
          if (!configIndexes.customCategoryIndexesByInternalUserId.has(normalizedUserId)) {
            configIndexes.customCategoryIndexesByInternalUserId.set(normalizedUserId, new Set());
          }
          configIndexes.customCategoryIndexesByInternalUserId
            .get(normalizedUserId)
            .add(categoryIndex);
        }
      }
    });
  }

  /**
   * 設定内容をログ向けの件数サマリへ変換する。
   * 入力: 現在の config オブジェクト。
   * 出力: 巨大配列を含まないサマリオブジェクト。
   * 主な処理内容:
   * 1. 大きなユーザー ID 配列は件数だけにする
   * 2. custom 分類は分類ごとの件数を残して状態確認に使えるようにする
   */
  function getConfigSummary (config) {
    return {
      mediaFilterLists: config.mediaFilterLists.length,
      hiddenUserIds: config.hiddenUserIds.length,
      followUserIds: config.followUserIds.length,
      listUserIds: config.listUserIds.length,
      customUserCategories: config.customUserCategories.map(category => ({
        id: category.id,
        label: category.label,
        color: category.color,
        userIds: category.userIds.length
      })),
      hiddenWords: config.hiddenWords.length,
      hiddenStatuses: config.hiddenStatuses.length,
      hideUIEnabled: config.hideUIEnabled,
      autoRefreshEnabled: config.autoRefreshEnabled
    }
  }

  const DEFAULT_CUSTOM_CATEGORY_COLOR$1 = '#f5c542';
  const PERSISTED_CONFIG_KEYS = [
    'mediaFilterLists',
    'hiddenUserIds',
    'followUserIds',
    'listUserIds',
    'customUserCategories',
    'hiddenWords',
    'hiddenStatuses',
    'hideUIEnabled',
    'autoRefreshEnabled'
  ];
  const saveQueues = new Map();
  const saveDebounceTimers = new Map();

  // 現在の設定を一か所に集約して持つ。
  // オブジェクト自体を差し替えると参照先が古いまま残るため、各モジュールはこの中身を書き換える前提で共有する。
  const config = {
    mediaFilterLists: [],
    hiddenUserIds: [],
    followUserIds: [],
    listUserIds: [],
    customUserCategories: [],
    hiddenWords: [],
    hiddenStatuses: [],
    hideUIEnabled: true,
    autoRefreshEnabled: true
  };

  /**
   * 設定オブジェクトの中身を丸ごと新しい値へ更新する。
   * 入力: 次に反映したい設定オブジェクト。
   * 出力: なし。
   * 主な処理内容:
   * 1. 共有中の config オブジェクトへ配列と真偽値を上書きする
   * 2. 参照を保ったまま他モジュールへ最新設定を行き渡らせる
   */
  function assignConfig (nextConfig) {
    config.mediaFilterLists = nextConfig.mediaFilterLists;
    config.hiddenUserIds = nextConfig.hiddenUserIds;
    config.followUserIds = nextConfig.followUserIds;
    config.listUserIds = nextConfig.listUserIds;
    config.customUserCategories = nextConfig.customUserCategories;
    config.hiddenWords = nextConfig.hiddenWords;
    config.hiddenStatuses = nextConfig.hiddenStatuses;
    config.hideUIEnabled = nextConfig.hideUIEnabled;
    config.autoRefreshEnabled = nextConfig.autoRefreshEnabled;

    rebuildConfigIndexes(config);
  }

  /**
   * Tampermonkey ストレージから設定を読み込み、期限切れの投稿 ID も掃除する。
   * 入力: なし。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 各設定キーを既定値つきで読み込む
   * 2. 共通の config へ反映する
   * 3. hiddenStatuses から期限切れデータを除外して必要なら保存し直す
   */
  async function loadConfig () {
    const stored = await GM_getValues({
      [STORAGE_KEYS.mediaFilterLists]: [],
      [STORAGE_KEYS.hiddenUserIds]: [],
      [STORAGE_KEYS.followUserIds]: [],
      [STORAGE_KEYS.listUserIds]: [],
      [STORAGE_KEYS.customUserCategories]: [],
      [STORAGE_KEYS.hiddenWords]: [],
      [STORAGE_KEYS.hiddenStatuses]: [],
      [STORAGE_KEYS.hideUIEnabled]: true,
      [STORAGE_KEYS.autoRefreshEnabled]: true
    });

    assignConfig({
      mediaFilterLists: stored[STORAGE_KEYS.mediaFilterLists],
      hiddenUserIds: stored[STORAGE_KEYS.hiddenUserIds],
      followUserIds: stored[STORAGE_KEYS.followUserIds],
      listUserIds: stored[STORAGE_KEYS.listUserIds],
      customUserCategories: stored[STORAGE_KEYS.customUserCategories],
      hiddenWords: stored[STORAGE_KEYS.hiddenWords],
      hiddenStatuses: stored[STORAGE_KEYS.hiddenStatuses],
      hideUIEnabled: stored[STORAGE_KEYS.hideUIEnabled],
      autoRefreshEnabled: stored[STORAGE_KEYS.autoRefreshEnabled]
    });

    // 起動時に期限切れ投稿を取り除いておくと、古い一時非表示が残留せず再適用時の判定も単純に保てる。
    const now = Date.now();
    const before = config.hiddenStatuses.length;
    config.hiddenStatuses = config.hiddenStatuses.filter(
      entry => entry.expiresAt > now
    );

    if (config.hiddenStatuses.length !== before) {
      await saveKey('hiddenStatuses');
      console.log(
        `[X-Observer] 期限切れの非表示ポストを ${
        before - config.hiddenStatuses.length
      } 件削除しました`
      );
    }
  }

  /**
   * 指定キーに対応する設定だけを保存する。
   * 入力: config オブジェクト上のキー名。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. STORAGE_KEYS から対応する保存キーを引く
   * 2. Tampermonkey ストレージへその項目だけ書き込む
   */
  async function saveKey (configKey) {
    clearScheduledSaveKey(configKey);

    const previousSave = saveQueues.get(configKey) || Promise.resolve();
    const nextSave = previousSave
      .catch(error => {
        console.error(`[X-Observer] ${configKey} の前回保存に失敗しました:`, error);
      })
      .then(async () => {
        const storageKey = STORAGE_KEYS[configKey];
        await GM_setValues({ [storageKey]: config[configKey] });
      });

    saveQueues.set(configKey, nextSave);

    try {
      await nextSave;
    } finally {
      if (saveQueues.get(configKey) === nextSave) {
        saveQueues.delete(configKey);
      }
    }
  }

  /**
   * 指定キーの遅延保存タイマーを取り消す。
   * 入力: config オブジェクト上のキー名。
   * 出力: なし。
   * 主な処理内容:
   * 1. 自動置換由来の保存予約を即時保存より前に消す
   */
  function clearScheduledSaveKey (configKey) {
    const timer = saveDebounceTimers.get(configKey);
    if (!timer) return

    clearTimeout(timer);
    saveDebounceTimers.delete(configKey);
  }

  /**
   * 永続化対象の全設定キーを保存する。
   * 入力: なし。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 予約済みの遅延保存を取り消す
   * 2. 各キーを saveKey の直列化レイヤーで保存する
   */
  async function saveAllKeys () {
    await Promise.all(PERSISTED_CONFIG_KEYS.map(configKey => saveKey(configKey)));
  }

  /**
   * 予約中の遅延保存をすぐ保存キューへ流す。
   * 入力: なし。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 自動置換で予約された保存キーを取り出す
   * 2. タイマーを取り消して通常の saveKey で保存する
   */
  async function flushScheduledSaves () {
    const scheduledKeys = [...saveDebounceTimers.keys()];
    if (scheduledKeys.length === 0) {
      return
    }

    await Promise.all(scheduledKeys.map(configKey => saveKey(configKey)));
  }

  /**
   * 新しい設定一式をメモリとストレージへまとめて反映する。
   * 入力: 完全な設定オブジェクト。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. config へ全項目を上書きする
   * 2. 永続化対象の全キーをまとめて保存する
   */
  async function replaceConfig (nextConfig) {
    assignConfig({
      mediaFilterLists: nextConfig.mediaFilterLists,
      hiddenUserIds: nextConfig.hiddenUserIds,
      followUserIds: nextConfig.followUserIds,
      listUserIds: nextConfig.listUserIds,
      customUserCategories: nextConfig.customUserCategories,
      hiddenWords: nextConfig.hiddenWords,
      hiddenStatuses: nextConfig.hiddenStatuses,
      hideUIEnabled: nextConfig.hideUIEnabled,
      autoRefreshEnabled: nextConfig.autoRefreshEnabled
    });

    await saveAllKeys();
  }

  /** メディアフィルタ対象リストを追加する。*/
  async function addMediaFilterList (listName) {
    if (!config.mediaFilterLists.includes(listName)) {
      config.mediaFilterLists.push(listName);
      await saveKey('mediaFilterLists');
      console.log(`[X-Observer] メディアフィルタリスト追加: "${listName}"`);
    }
  }

  /** メディアフィルタ対象リストを削除する。*/
  async function removeMediaFilterList (listName) {
    config.mediaFilterLists = config.mediaFilterLists.filter(n => n !== listName);
    await saveKey('mediaFilterLists');
    console.log(`[X-Observer] メディアフィルタリスト削除: "${listName}"`);
  }

  /**
   * 分類色を保存用の HEX カラーへ正規化する。
   * 入力: ユーザーが選んだ色文字列。
   * 出力: #rrggbb 形式の色。未指定や不正値は既定色。
   * 主な処理内容:
   * 1. color input とインポート値を同じ形式へ揃える
   * 2. CSS へ直接渡す値なので HEX 形式以外は既定色へ戻す
   */
  function normalizeCategoryColor$1 (color) {
    const normalized = String(color || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(normalized)
      ? normalized
      : DEFAULT_CUSTOM_CATEGORY_COLOR$1
  }


  /**
   * ユーザー定義分類 ID を生成する。
   * 入力: 分類名。
   * 出力: 保存に使う分類 ID。
   * 主な処理内容:
   * 1. 分類名を小文字化して URL セーフ寄りの文字へ置き換える
   * 2. 同名分類が重なった場合も衝突しないよう時刻を付ける
   */
  function createCustomUserCategoryId (label) {
    const base = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);

    return `custom-${base || 'category'}-${Date.now().toString(36)}`
  }

  /**
   * ユーザー定義分類を ID で探す。
   * 入力: 分類 ID。
   * 出力: 分類オブジェクト。見つからない場合は null。
   * 主な処理内容:
   * 1. customUserCategories から ID が一致する分類を返す
   */
  function findCustomUserCategory (categoryId) {
    return config.customUserCategories.find(category => category.id === categoryId) ?? null
  }

  /**
   * ユーザー定義分類の配列位置を ID で探す。
   * 入力: 分類 ID。
   * 出力: 分類の index。見つからない場合は -1。
   * 主な処理内容:
   * 1. customUserCategories の現在順から優先順位に使う index を返す
   */
  function findCustomUserCategoryIndex (categoryId) {
    return config.customUserCategories.findIndex(category => category.id === categoryId)
  }

  /**
   * ユーザー ID 配列に正規化後の一致値があるか判定する。
   * 入力: ユーザー ID 配列、正規化済み ID。
   * 出力: 一致する ID があれば true。
   * 主な処理内容:
   * 1. 保存済み値の表記ゆれを吸収して重複判定する
   */
  function hasNormalizedUserId (userIds, normalizedUserId) {
    return userIds.some(userId => normalizeUserId(userId) === normalizedUserId)
  }

  /**
   * 指定した内部 ID が設定のどこかに残っているか判定する。
   * 入力: 正規化済み内部 ID。
   * 出力: 残っていれば true。
   * 主な処理内容:
   * 1. 単純リストの判定用 Set を確認する
   * 2. custom 分類の保存配列を正規化比較する
   */
  function hasInternalUserIdAnywhere (normalizedInternalId) {
    if (!isNumericUserId(normalizedInternalId)) {
      return false
    }

    return (
      configIndexes.hiddenUserIds.has(normalizedInternalId) ||
      configIndexes.followUserIds.has(normalizedInternalId) ||
      configIndexes.listUserIds.has(normalizedInternalId) ||
      Boolean(
        configIndexes.customCategoryIndexesByInternalUserId.get(normalizedInternalId)
          ?.size
      )
    )
  }

  /**
   * 数字だけのユーザー ID を登録済み内部 ID インデックスへ追加する。
   * 入力: 正規化済みユーザー ID。
   * 出力: なし。
   * 主な処理内容: 数字 ID だけを置換候補インデックスへ入れる
   */
  function addRegisteredInternalUserId (normalizedUserId) {
    if (isNumericUserId(normalizedUserId)) {
      configIndexes.registeredInternalUserIds.add(normalizedUserId);
    }
  }

  /**
   * custom 分類内の内部 ID 位置インデックスへ分類 index を追加する。
   * 入力: 正規化済み内部 ID、分類 index。
   * 出力: なし。
   * 主な処理内容:
   * 1. 数字 ID だけを対象にする
   * 2. 内部 ID が存在する分類 index を記録する
   */
  function addCustomInternalUserIdIndex (normalizedUserId, categoryIndex) {
    if (!isNumericUserId(normalizedUserId)) {
      return
    }

    if (!configIndexes.customCategoryIndexesByInternalUserId.has(normalizedUserId)) {
      configIndexes.customCategoryIndexesByInternalUserId.set(normalizedUserId, new Set());
    }
    configIndexes.customCategoryIndexesByInternalUserId
      .get(normalizedUserId)
      .add(categoryIndex);
  }

  /**
   * custom 分類内の内部 ID 位置インデックスから分類 index を外す。
   * 入力: 正規化済み内部 ID、分類 index。
   * 出力: なし。
   * 主な処理内容:
   * 1. 指定分類に同じ内部 ID が残っていれば保持する
   * 2. 残っていなければ分類 index を削除する
   */
  function removeCustomInternalUserIdIndex (normalizedUserId, categoryIndex) {
    if (!isNumericUserId(normalizedUserId)) {
      return
    }

    const category = config.customUserCategories[categoryIndex];
    const categoryIndexes =
      configIndexes.customCategoryIndexesByInternalUserId.get(normalizedUserId);
    if (!categoryIndexes || !category) {
      return
    }

    if (hasNormalizedUserId(category.userIds, normalizedUserId)) {
      return
    }

    categoryIndexes.delete(categoryIndex);
    if (categoryIndexes.size === 0) {
      configIndexes.customCategoryIndexesByInternalUserId.delete(normalizedUserId);
    }
  }

  /**
   * 登録済み内部 ID インデックスを現在設定に合わせて更新する。
   * 入力: 正規化済みユーザー ID。
   * 出力: なし。
   * 主な処理内容:
   * 1. 数字 ID 以外は無視する
   * 2. 設定内に残っていれば保持し、残っていなければ削除する
   */
  function refreshRegisteredInternalUserId (normalizedUserId) {
    if (!isNumericUserId(normalizedUserId)) {
      return
    }

    if (hasInternalUserIdAnywhere(normalizedUserId)) {
      configIndexes.registeredInternalUserIds.add(normalizedUserId);
    } else {
      configIndexes.registeredInternalUserIds.delete(normalizedUserId);
    }
  }

  /**
   * custom 分類へ追加したユーザー ID を判定インデックスへ反映する。
   * 入力: 正規化済み ID、追加先分類 index。
   * 出力: なし。
   * 主な処理内容:
   * 1. 未登録または既存より前の分類なら Map を更新する
   * 2. custom 分類の配列順優先を維持する
   */
  function addCustomCategoryUserIndex (normalizedUserId, categoryIndex) {
    const currentIndex = configIndexes.customUserCategoryIndexByUserId.get(normalizedUserId);
    if (currentIndex === undefined || categoryIndex < currentIndex) {
      configIndexes.customUserCategoryIndexByUserId.set(normalizedUserId, categoryIndex);
    }
  }

  /**
   * custom 分類から削除したユーザー ID を判定インデックスへ反映する。
   * 入力: 正規化済み ID、削除元分類 index。
   * 出力: なし。
   * 主な処理内容:
   * 1. 削除元が現在の優先分類でなければ Map を触らない
   * 2. 後続分類に同じ ID があれば次の優先先へ差し替える
   */
  function removeCustomCategoryUserIndex (normalizedUserId, removedCategoryIndex) {
    if (
      configIndexes.customUserCategoryIndexByUserId.get(normalizedUserId) !==
      removedCategoryIndex
    ) {
      return
    }

    const nextCategoryIndex = config.customUserCategories.findIndex((category, index) =>
      index > removedCategoryIndex &&
      hasNormalizedUserId(category.userIds, normalizedUserId)
    );

    if (nextCategoryIndex >= 0) {
      configIndexes.customUserCategoryIndexByUserId.set(normalizedUserId, nextCategoryIndex);
      return
    }

    configIndexes.customUserCategoryIndexByUserId.delete(normalizedUserId);
  }

  /**
   * 非表示ユーザーを追加する。
   * 入力: @ の有無どちらでもよいユーザー ID。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 保存時の表記ゆれを防ぐため先頭の @ を除去する
   * 2. 重複しない場合だけ設定へ追加して保存する
   */
  async function addHiddenUser (userId) {
    const id = normalizeUserId(userId);
    if (id && !configIndexes.hiddenUserIds.has(id)) {
      config.hiddenUserIds.push(id);
      configIndexes.hiddenUserIds.add(id);
      addRegisteredInternalUserId(id);
      await saveKey('hiddenUserIds');
      console.log(`[X-Observer] 非表示ユーザー追加: @${id}`);
    }
  }

  /** 非表示ユーザーを削除する。*/
  async function removeHiddenUser (userId) {
    const id = normalizeUserId(userId);
    config.hiddenUserIds = config.hiddenUserIds.filter(
      user => normalizeUserId(user) !== id
    );
    configIndexes.hiddenUserIds.delete(id);
    refreshRegisteredInternalUserId(id);
    await saveKey('hiddenUserIds');
    console.log(`[X-Observer] 非表示ユーザー削除: @${id}`);
  }

  /**
   * 非表示ユーザーをすべて削除する。
   * 入力: なし。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 配列と判定用 Set を一度で空にする
   * 2. ストレージ保存も一度だけ行う
   */
  async function clearHiddenUsers () {
    config.hiddenUserIds = [];
    configIndexes.hiddenUserIds.clear();
    rebuildConfigIndexes(config);
    await saveKey('hiddenUserIds');
    console.log('[X-Observer] 非表示ユーザーをすべて削除しました');
  }

  /**
   * フォローユーザーを追加する。
   * 入力: @ の有無どちらでもよいユーザー ID。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 保存形式へ正規化して重複を避ける
   * 2. ストレージへ保存して後続表示へ使えるようにする
   */
  async function addFollowUser (userId) {
    const id = normalizeUserId(userId);
    if (id && !configIndexes.followUserIds.has(id)) {
      config.followUserIds.push(id);
      configIndexes.followUserIds.add(id);
      addRegisteredInternalUserId(id);
      await saveKey('followUserIds');
      console.log(`[X-Observer] フォローユーザー追加: @${id}`);
    }
  }

  /** フォローユーザーを削除する。*/
  async function removeFollowUser (userId) {
    const id = normalizeUserId(userId);
    config.followUserIds = config.followUserIds.filter(
      user => normalizeUserId(user) !== id
    );
    configIndexes.followUserIds.delete(id);
    refreshRegisteredInternalUserId(id);
    await saveKey('followUserIds');
    console.log(`[X-Observer] フォローユーザー削除: @${id}`);
  }

  /**
   * フォローユーザーをすべて削除する。
   * 入力: なし。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 配列と判定用 Set を一度で空にする
   * 2. ストレージ保存も一度だけ行う
   */
  async function clearFollowUsers () {
    config.followUserIds = [];
    configIndexes.followUserIds.clear();
    rebuildConfigIndexes(config);
    await saveKey('followUserIds');
    console.log('[X-Observer] フォローユーザーをすべて削除しました');
  }

  /**
   * リストインユーザーを追加する。
   * 入力: @ の有無どちらでもよいユーザー ID。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 保存形式へ正規化して重複を避ける
   * 2. ストレージへ保存して後続表示へ使えるようにする
   */
  async function addListUser (userId) {
    const id = normalizeUserId(userId);
    if (id && !configIndexes.listUserIds.has(id)) {
      config.listUserIds.push(id);
      configIndexes.listUserIds.add(id);
      addRegisteredInternalUserId(id);
      await saveKey('listUserIds');
      console.log(`[X-Observer] リストインユーザー追加: @${id}`);
    }
  }

  /** リストインユーザーを削除する。*/
  async function removeListUser (userId) {
    const id = normalizeUserId(userId);
    config.listUserIds = config.listUserIds.filter(
      user => normalizeUserId(user) !== id
    );
    configIndexes.listUserIds.delete(id);
    refreshRegisteredInternalUserId(id);
    await saveKey('listUserIds');
    console.log(`[X-Observer] リストインユーザー削除: @${id}`);
  }

  /**
   * リストインユーザーをすべて削除する。
   * 入力: なし。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 配列と判定用 Set を一度で空にする
   * 2. ストレージ保存も一度だけ行う
   */
  async function clearListUsers () {
    config.listUserIds = [];
    configIndexes.listUserIds.clear();
    rebuildConfigIndexes(config);
    await saveKey('listUserIds');
    console.log('[X-Observer] リストインユーザーをすべて削除しました');
  }


  /**
   * ユーザー定義分類を追加する。
   * 入力: 追加したい分類名と任意の分類色。
   * 出力: 作成した分類オブジェクト。空名または重複名なら null。
   * 主な処理内容:
   * 1. 分類名を trim して空入力を除外する
   * 2. 既存分類名と重複しない場合だけ ID、色、空のユーザー配列を保存する
   */
  async function addCustomUserCategory (label, color = DEFAULT_CUSTOM_CATEGORY_COLOR$1) {
    const normalizedLabel = label.trim();
    if (
      !normalizedLabel ||
      config.customUserCategories.some(category => category.label === normalizedLabel)
    ) {
      return null
    }

    const category = {
      id: createCustomUserCategoryId(normalizedLabel),
      label: normalizedLabel,
      color: normalizeCategoryColor$1(color),
      userIds: []
    };

    config.customUserCategories.push(category);
    await saveKey('customUserCategories');
    console.log(`[X-Observer] ユーザー定義分類追加: ${normalizedLabel}`);
    return category
  }

  /**
   * ユーザー定義分類を削除する。
   * 入力: 削除したい分類 ID。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. ID が一致しない分類だけを残す
   * 2. 分類に紐づくユーザー ID も分類ごと削除して保存する
   */
  async function removeCustomUserCategory (categoryId) {
    const category = findCustomUserCategory(categoryId);
    config.customUserCategories = config.customUserCategories.filter(
      item => item.id !== categoryId
    );
    rebuildConfigIndexes(config);
    await saveKey('customUserCategories');
    console.log(`[X-Observer] ユーザー定義分類削除: ${category?.label ?? categoryId}`);
  }


  /**
   * ユーザー定義分類の色を変更する。
   * 入力: 分類 ID、#rrggbb 形式の色。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 分類 ID から更新対象を探す
   * 2. 色を安全な HEX 形式へ正規化して保存する
   */
  async function setCustomUserCategoryColor (categoryId, color) {
    const category = findCustomUserCategory(categoryId);
    if (!category) {
      return
    }

    category.color = normalizeCategoryColor$1(color);
    await saveKey('customUserCategories');
    console.log(`[X-Observer] ${category.label}分類色変更: ${category.color}`);
  }

  /**
   * ユーザー定義分類へユーザー ID を追加する。
   * 入力: 分類 ID、@ の有無どちらでもよいユーザー ID。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 分類 ID から保存先を探す
   * 2. ユーザー ID を正規化し、未登録時だけ追加して保存する
   */
  async function addCustomCategoryUser (categoryId, userId) {
    const categoryIndex = findCustomUserCategoryIndex(categoryId);
    const category = config.customUserCategories[categoryIndex];
    const id = normalizeUserId(userId);
    if (!category || !id || hasNormalizedUserId(category.userIds, id)) {
      return
    }

    category.userIds.push(id);
    addCustomCategoryUserIndex(id, categoryIndex);
    addCustomInternalUserIdIndex(id, categoryIndex);
    addRegisteredInternalUserId(id);
    await saveKey('customUserCategories');
    console.log(`[X-Observer] ${category.label}ユーザー追加: @${id}`);
  }

  /**
   * ユーザー定義分類からユーザー ID を削除する。
   * 入力: 分類 ID、@ の有無どちらでもよいユーザー ID。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 分類 ID から保存先を探す
   * 2. 正規化したユーザー ID と一致しない項目だけを残す
   */
  async function removeCustomCategoryUser (categoryId, userId) {
    const categoryIndex = findCustomUserCategoryIndex(categoryId);
    const category = config.customUserCategories[categoryIndex];
    const id = normalizeUserId(userId);
    if (!category || !id) {
      return
    }

    category.userIds = category.userIds.filter(user => normalizeUserId(user) !== id);
    removeCustomCategoryUserIndex(id, categoryIndex);
    removeCustomInternalUserIdIndex(id, categoryIndex);
    refreshRegisteredInternalUserId(id);
    await saveKey('customUserCategories');
    console.log(`[X-Observer] ${category.label}ユーザー削除: @${id}`);
  }

  /**
   * ユーザー定義分類から全ユーザー ID を削除する。
   * 入力: 分類 ID。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 対象分類の userIds を一度で空にする
   * 2. custom 分類インデックスを一度だけ再構築して保存する
   */
  async function clearCustomCategoryUsers (categoryId) {
    const category = findCustomUserCategory(categoryId);
    if (!category) {
      return
    }

    category.userIds = [];
    rebuildConfigIndexes(config);
    await saveKey('customUserCategories');
    console.log(`[X-Observer] ${category.label}ユーザーをすべて削除しました`);
  }

  /**
   * 非表示キーワードを追加する。
   * 入力: 追加したいキーワード文字列。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 大文字小文字違いの重複を防ぐため比較用に小文字化する
   * 2. 実際の表示値は元の文字列を保持したまま保存する
   */
  async function addHiddenWord (word) {
    // 比較だけを小文字化するのは、画面表示やエクスポート時に入力どおりの文字列を残すため。
    const normalizedWord = word.toLowerCase();

    if (!config.hiddenWords.some(item => item.toLowerCase() === normalizedWord)) {
      config.hiddenWords.push(word);
      await saveKey('hiddenWords');
      console.log(`[X-Observer] 非表示ワード追加: "${word}"`);
    }
  }

  /** 非表示キーワードを削除する。*/
  async function removeHiddenWord (word) {
    config.hiddenWords = config.hiddenWords.filter(item => item !== word);
    await saveKey('hiddenWords');
    console.log(`[X-Observer] 非表示ワード削除: "${word}"`);
  }

  /**
   * 非表示ポストを期限付きで追加する。
   * 入力: 数字文字列の statusId。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 重複登録を避ける
   * 2. 期限つきデータとして expiresAt を付けて保存する
   */
  async function addHiddenStatus (statusId) {
    if (!config.hiddenStatuses.some(entry => entry.statusId === statusId)) {
      config.hiddenStatuses.push({
        statusId,
        expiresAt: Date.now() + EXPIRE_MS
      });
      await saveKey('hiddenStatuses');
      console.log(`[X-Observer] 非表示ポスト追加: ${statusId}`);
    }
  }

  /** 非表示ポストを削除する。*/
  async function removeHiddenStatus (statusId) {
    config.hiddenStatuses = config.hiddenStatuses.filter(
      entry => entry.statusId !== statusId
    );
    await saveKey('hiddenStatuses');
    console.log(`[X-Observer] 非表示ポスト削除: ${statusId}`);
  }

  /**
   * 現在の設定をログへ表示する。
   * 入力: full を true にすると全設定を表示するオプション。
   * 出力: なし。
   * 主な処理内容:
   * 1. 通常は巨大配列を含まない件数サマリを表示する
   * 2. 明示指定時だけ従来どおり全設定を表示する
   */
  function showConfig ({ full = false } = {}) {
    console.log(
      '[X-Observer] 現在の設定:',
      full ? JSON.parse(JSON.stringify(config)) : getConfigSummary(config)
    );
  }

  const PAGE_SIZE = 500;
  const CUSTOM_TAB_PREFIX = 'custom:';
  const DEFAULT_CUSTOM_CATEGORY_COLOR = '#f5c542';
  const TAB_DEFINITIONS = [
    { key: 'users',    label: 'ユーザー',   placeholder: '[@]user_id / internal_id', category: 'hide' },
    { key: 'statuses', label: 'ポスト',     placeholder: 'post_id / URL', category: 'hide' },
    { key: 'words',    label: 'キーワード', placeholder: 'keyword',       category: 'hide' },
    { key: 'media',    label: 'メディア',   placeholder: 'リスト名',      category: 'hide' },
    { key: 'follow',   label: 'フォロー',   placeholder: '[@]user_id / internal_id', category: 'color' },
    { key: 'list',     label: 'リスト',     placeholder: '[@]user_id / internal_id', category: 'color' },
    { key: 'settings', label: '基本',       placeholder: '',              category: 'settings' },
    { key: 'categorySettings', label: '分類', placeholder: '',             category: 'settings' }
  ];
  const CATEGORY_DEFINITIONS = [
    { key: 'hide',     label: '非表示' },
    { key: 'color',    label: '分類' },
    { key: 'settings', label: '設定' }
  ];


  /**
   * ユーザー定義分類のタブキーを作る。
   * 入力: 分類 ID。
   * 出力: 設定ダイアログ内で使うタブキー。
   * 主な処理内容:
   * 1. 既存タブと衝突しないよう専用プレフィックスを付ける
   */
  function getCustomCategoryTabKey (categoryId) {
    return `${CUSTOM_TAB_PREFIX}${categoryId}`
  }

  /**
   * タブキーからユーザー定義分類 ID を取り出す。
   * 入力: タブキー。
   * 出力: 分類 ID。ユーザー定義分類でなければ null。
   * 主な処理内容:
   * 1. 専用プレフィックスを持つタブだけ分類 ID として扱う
   */
  function getCustomCategoryIdFromTabKey (tabKey) {
    return tabKey.startsWith(CUSTOM_TAB_PREFIX)
      ? tabKey.slice(CUSTOM_TAB_PREFIX.length)
      : null
  }

  /**
   * タブキーに対応するユーザー定義分類を返す。
   * 入力: タブキー。
   * 出力: 分類オブジェクト。該当しなければ null。
   * 主な処理内容:
   * 1. タブキーから分類 ID を取り出す
   * 2. 現在の config から一致する分類を探す
   */
  function getCustomCategoryForTab (tabKey) {
    const categoryId = getCustomCategoryIdFromTabKey(tabKey);
    if (!categoryId) return null

    return config.customUserCategories.find(category => category.id === categoryId) ?? null
  }

  /**
   * 固定タブとユーザー定義分類タブを合わせて返す。
   * 入力: なし。
   * 出力: タブ定義配列。
   * 主な処理内容:
   * 1. 固定タブを先に並べる
   * 2. ユーザー定義分類を分類カテゴリの小項目として追加する
   */
  function getAllTabDefinitions () {
    return [
      ...TAB_DEFINITIONS,
      ...config.customUserCategories.map(category => ({
        key: getCustomCategoryTabKey(category.id),
        label: category.label,
        placeholder: '[@]user_id / internal_id',
        category: 'color',
        customCategoryId: category.id
      }))
    ]
  }

  const DIALOG_STYLE = `
  .xtlo-settings-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.66);
    backdrop-filter: blur(10px);
    z-index: 2147483647;
    padding: 16px;
  }

  .xtlo-settings-dialog {
    width: min(720px, calc(100vw - 24px));
    height: min(640px, calc(100vh - 24px));
    max-height: min(640px, calc(100vh - 24px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background:
      radial-gradient(circle at top left, rgba(29, 155, 240, 0.12), transparent 34%),
      linear-gradient(180deg, rgba(23, 23, 23, 0.98), rgba(9, 9, 9, 0.98));
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
    color: #f5f7fa;
    font-family: "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
  }

  .xtlo-settings-header {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 20px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .xtlo-settings-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .xtlo-settings-title {
    font-size: 16px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .xtlo-settings-close {
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.78);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }

  .xtlo-settings-category-tabs {
    display: flex;
    align-items: flex-end;
    gap: 22px;
    width: 100%;
  }

  .xtlo-settings-category-tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 34px;
    padding: 0 10px 10px;
    border: 0;
    border-radius: 8px 8px 0 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }

  .xtlo-settings-category-tab:hover {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.92);
  }

  .xtlo-settings-category-tab[data-active="true"] {
    color: #ffffff;
  }

  .xtlo-settings-category-tab[data-active="true"]::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 3px;
    border-radius: 999px;
    background: #1d9bf0;
  }

  .xtlo-settings-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 0;
  }

  .xtlo-settings-layout {
    display: grid;
    grid-template-columns: 148px minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }

  .xtlo-settings-side-tabs {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px 10px 16px 16px;
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.025);
    overflow: auto;
  }

  .xtlo-settings-side-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 36px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: rgba(255, 255, 255, 0.68);
    font-size: 13px;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
  }

  .xtlo-settings-side-tab:hover {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.9);
  }

  .xtlo-settings-side-tab[data-active="true"] {
    background: rgba(29, 155, 240, 0.16);
    color: #ffffff;
  }

  .xtlo-settings-side-icon {
    display: inline-flex;
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }

  .xtlo-settings-side-icon svg {
    width: 100%;
    height: 100%;
  }


  .xtlo-settings-side-tab-label {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .xtlo-settings-category-manager {
    display: grid;
    gap: 14px;
  }

  .xtlo-settings-category-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px auto;
    gap: 10px;
    padding: 8px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.08);
  }

  .xtlo-settings-color-input {
    width: 44px;
    height: 36px;
    padding: 4px;
    border: 0;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.12);
    cursor: pointer;
  }

  .xtlo-settings-category-list {
    display: grid;
    gap: 8px;
  }

  .xtlo-settings-category-row {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) 44px 34px;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.07);
  }

  .xtlo-settings-category-swatch {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.16);
  }

  .xtlo-settings-category-meta {
    min-width: 0;
  }

  .xtlo-settings-category-name {
    overflow: hidden;
    color: #ffffff;
    font-size: 13px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .xtlo-settings-category-count {
    color: rgba(255, 255, 255, 0.52);
    font-size: 12px;
  }

  .xtlo-settings-content {
    min-width: 0;
    overflow: auto;
    padding: 16px 20px 14px;
  }

  .xtlo-settings-add-row {
    display: flex;
    gap: 10px;
    padding: 8px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.08);
    margin-bottom: 14px;
  }

  .xtlo-settings-search-row {
    display: flex;
    padding: 8px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.05);
    margin-bottom: 10px;
  }

  .xtlo-settings-input {
    flex: 1;
    border: 0;
    outline: none;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 10px 14px;
    color: #ffffff;
    font-size: 14px;
  }

  .xtlo-settings-search-input {
    flex: 1;
    border: 0;
    outline: none;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 9px 12px;
    color: #ffffff;
    font-size: 13px;
  }

  .xtlo-settings-input::placeholder,
  .xtlo-settings-search-input::placeholder {
    color: rgba(255, 255, 255, 0.32);
  }

  .xtlo-settings-primary {
    border: 0;
    border-radius: 10px;
    background: linear-gradient(180deg, #38a3ff, #1d84d8);
    color: #ffffff;
    font-size: 14px;
    font-weight: 700;
    padding: 0 16px;
    cursor: pointer;
  }

  .xtlo-settings-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .xtlo-settings-card {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 56px;
    padding: 0 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.03);
  }

  .xtlo-settings-icon {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    color: #dce8f5;
    background: rgba(255, 255, 255, 0.11);
    flex-shrink: 0;
  }

  .xtlo-settings-item-text {
    flex: 1;
    min-width: 0;
  }

  .xtlo-settings-item-title {
    font-size: 13px;
    font-weight: 700;
    word-break: break-all;
  }

  .xtlo-settings-item-subtitle {
    margin-top: 3px;
    color: rgba(255, 255, 255, 0.54);
    font-size: 11px;
  }

  .xtlo-settings-danger-icon {
    border: 0;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
  }

  .xtlo-settings-danger-icon:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .xtlo-settings-empty {
    padding: 28px 12px;
    text-align: center;
    color: rgba(255, 255, 255, 0.54);
    font-size: 13px;
  }

  .xtlo-settings-pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 16px 0 6px;
  }

  .xtlo-settings-page-btn {
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.84);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }

  .xtlo-settings-page-btn:disabled {
    opacity: 0.28;
    cursor: default;
  }

  .xtlo-settings-page-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
  }

  .xtlo-settings-page-current {
    width: 48px;
    text-align: center;
    padding: 6px 0;
    border-radius: 8px;
    border: 0;
    background: rgba(255, 255, 255, 0.14);
    color: #ffffff;
    font-size: 13px;
    font-weight: 700;
  }

  .xtlo-settings-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 20px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .xtlo-settings-clear {
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.78);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .xtlo-settings-badge {
    border-radius: 10px;
    padding: 6px 12px;
    background: rgba(84, 95, 110, 0.72);
    color: #dce4ef;
    font-size: 12px;
    font-weight: 700;
  }

  .xtlo-settings-settings-grid {
    display: grid;
    gap: 10px;
  }

  .xtlo-settings-toggle-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.07);
  }

  .xtlo-settings-toggle-copy {
    flex: 1;
  }

  .xtlo-settings-toggle-title {
    font-size: 13px;
    font-weight: 700;
  }

  .xtlo-settings-toggle-desc {
    margin-top: 4px;
    color: rgba(255, 255, 255, 0.58);
    font-size: 11px;
    line-height: 1.5;
  }

  .xtlo-settings-switch {
    position: relative;
    width: 44px;
    height: 26px;
    border: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
    cursor: pointer;
    flex-shrink: 0;
  }

  .xtlo-settings-switch[data-enabled="true"] {
    background: #1d9bf0;
  }

  .xtlo-settings-switch::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background: #ffffff;
    transition: transform 0.18s ease;
  }

  .xtlo-settings-switch[data-enabled="true"]::after {
    transform: translateX(18px);
  }

  .xtlo-settings-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .xtlo-settings-secondary {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: #ffffff;
    border-radius: 10px;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .xtlo-settings-hint {
    color: rgba(255, 255, 255, 0.54);
    font-size: 12px;
    line-height: 1.6;
  }

  @media (max-width: 700px) {
    .xtlo-settings-overlay {
      padding: 12px;
      align-items: stretch;
    }

    .xtlo-settings-dialog {
      width: 100%;
      height: auto;
      max-height: none;
      border-radius: 22px;
    }

    .xtlo-settings-header {
      padding: 14px 14px 0;
    }

    .xtlo-settings-category-tabs {
      gap: 18px;
      overflow: auto;
    }

    .xtlo-settings-layout {
      grid-template-columns: 112px minmax(0, 1fr);
      height: auto;
    }

    .xtlo-settings-side-tabs {
      padding: 12px 8px;
    }

    .xtlo-settings-side-tab {
      min-height: 34px;
      padding: 0 8px;
      font-size: 12px;
    }

    .xtlo-settings-content {
      padding: 12px;
    }

    .xtlo-settings-add-row,
    .xtlo-settings-search-row,
    .xtlo-settings-footer,
    .xtlo-settings-toggle-card {
      flex-direction: column;
      align-items: stretch;
    }

    .xtlo-settings-primary,
    .xtlo-settings-secondary,
    .xtlo-settings-switch {
      align-self: flex-start;
    }
  }
`;

  /**
   * ステータス ID または URL を statusId へ正規化する。
   * 入力: ダイアログから受け取った文字列。
   * 出力: 数字文字列、解釈できない場合は null。
   * 主な処理内容:
   * 1. 数字のみ入力はそのまま返す
   * 2. URL からは /status/<数字> の部分だけを抜き出す
   */
  function normalizeStatusInput (value) {
    if (/^\d+$/.test(value)) {
      return value
    }

    const match = value.match(/\/status\/(\d+)/);
    return match ? match[1] : null
  }

  /**
   * 入力されたページ番号を安全な範囲へ丸める。
   * 入力: ユーザー入力値と総ページ数。
   * 出力: 1 以上 totalPages 以下の整数ページ番号。
   * 主な処理内容:
   * 1. 数値へ解釈できない値は 1 に戻す
   * 2. 小数や範囲外の値を表示可能なページへ補正する
   */
  function normalizePageNumber (value, totalPages) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
      return 1
    }

    return Math.min(Math.max(parsed, 1), totalPages)
  }

  /**
   * タブごとの一覧データモデルを返す。
   * 入力: タブキー。
   * 出力: raw 配列、表示用変換、検索判定を持つモデル。
   * 主な処理内容:
   * 1. 保存配列を表示直前まで raw のまま扱う
   * 2. ページネーション後に必要な項目だけ item 化できるようにする
   */
  function getTabListModel (tabKey) {
    if (tabKey === 'users') {
      return createUserIdListModel(config.hiddenUserIds, 'ユーザーID')
    }

    if (tabKey === 'follow') {
      return createUserIdListModel(config.followUserIds, 'フォローユーザー')
    }

    if (tabKey === 'list') {
      return createUserIdListModel(config.listUserIds, 'リストインユーザー')
    }


    const customCategory = getCustomCategoryForTab(tabKey);
    if (customCategory) {
      return createUserIdListModel(
        customCategory.userIds,
        `${customCategory.label}ユーザー`
      )
    }

    if (tabKey === 'statuses') {
      return {
        rawItems: config.hiddenStatuses,
        toItem: entry => ({
          value: entry.statusId,
          title: entry.statusId,
          subtitle: `期限: ${new Date(entry.expiresAt).toLocaleString('ja-JP')}`
        }),
        matchesQuery: (entry, normalizedQuery) => {
          const subtitle = `期限: ${new Date(entry.expiresAt).toLocaleString('ja-JP')}`;
          return [entry.statusId, subtitle].some(value =>
            String(value).toLowerCase().includes(normalizedQuery)
          )
        }
      }
    }

    if (tabKey === 'words') {
      return createTextListModel(config.hiddenWords, 'キーワード')
    }

    return createTextListModel(config.mediaFilterLists, 'メディアフィルタ')
  }

  /**
   * ユーザー ID 系の一覧モデルを作る。
   * 入力: ユーザー ID 配列、サブタイトル。
   * 出力: raw 配列を表示・検索するためのモデル。
   * 主な処理内容:
   * 1. @付きタイトルは表示時だけ生成する
   * 2. 検索時は raw 文字列と固定文言だけで判定する
   */
  function createUserIdListModel (rawItems, subtitle) {
    return {
      rawItems,
      toItem: value => ({
        value,
        title: `@${value}`,
        subtitle
      }),
      matchesQuery: (value, normalizedQuery) =>
        [value, `@${value}`, subtitle].some(item =>
          String(item).toLowerCase().includes(normalizedQuery)
        )
    }
  }

  /**
   * 単純な文字列一覧モデルを作る。
   * 入力: 文字列配列、サブタイトル。
   * 出力: raw 配列を表示・検索するためのモデル。
   * 主な処理内容:
   * 1. 表示項目はページ内だけで生成する
   * 2. 検索時は raw 文字列と固定文言だけで判定する
   */
  function createTextListModel (rawItems, subtitle) {
    return {
      rawItems,
      toItem: value => ({
        value,
        title: value,
        subtitle
      }),
      matchesQuery: (value, normalizedQuery) =>
        [value, subtitle].some(item =>
          String(item).toLowerCase().includes(normalizedQuery)
        )
    }
  }

  /**
   * 検索語に一致する raw 項目だけを返す。
   * 入力: 一覧モデルと検索語。
   * 出力: 検索語が空なら raw 配列、一致語がある場合は絞り込み後の配列。
   * 主な処理内容:
   * 1. 検索なしでは元配列をそのまま返して全件走査を避ける
   * 2. 検索ありではモデルごとの軽量判定で絞り込む
   */
  function filterRawItemsByQuery (model, query) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return model.rawItems
    }

    return model.rawItems.filter(item => model.matchesQuery(item, normalizedQuery))
  }

  /**
   * 小項目キーから所属する大分類キーを返す。
   * 入力: 小項目のタブキー。
   * 出力: 大分類キー。見つからない場合は非表示分類。
   * 主な処理内容:
   * 1. ユーザー定義分類タブは分類カテゴリへ固定する
   * 2. 固定タブは TAB_DEFINITIONS から現在タブの定義を探す
   */
  function getCategoryKeyForTab (tabKey) {
    if (getCustomCategoryIdFromTabKey(tabKey)) {
      return 'color'
    }

    return TAB_DEFINITIONS.find(tab => tab.key === tabKey)?.category ?? 'hide'
  }

  /**
   * 大分類に属する小項目定義だけを返す。
   * 入力: 大分類キー。
   * 出力: 該当する小項目定義配列。
   * 主な処理内容:
   * 1. 固定タブとユーザー定義分類タブから category が一致するものだけを抽出する
   */
  function getTabsForCategory (categoryKey) {
    return getAllTabDefinitions().filter(tab => tab.category === categoryKey)
  }

  /**
   * 大分類を開いたとき最初に選ぶ小項目キーを返す。
   * 入力: 大分類キー。
   * 出力: 先頭の小項目キー。見つからない場合は users。
   * 主な処理内容:
   * 1. 大分類内の先頭タブを取得する
   * 2. 未定義分類でも描画を続けられるよう既定値を返す
   */
  function getDefaultTabForCategory (categoryKey) {
    return getTabsForCategory(categoryKey)[0]?.key ?? 'users'
  }

  /**
   * ダイアログに使う設定 UI を生成する。
   * 入力: 各種追加・削除・保存コールバック。
   * 出力: open / close を持つオブジェクト。
   * 主な処理内容:
   * 1. モーダル DOM を初期化する
   * 2. タブ、ページネーション、追加・削除 UI を描画する
   * 3. 設定変更時に既存保存ロジックと安全モード用の分類色再適用を呼び出す
   */
  function createSettingsDialog ({
    addHiddenStatus,
    removeHiddenStatus,
    addHiddenUser,
    removeHiddenUser,
    clearHiddenUsers,
    addFollowUser,
    removeFollowUser,
    clearFollowUsers,
    addListUser,
    removeListUser,
    clearListUsers,
    addCustomUserCategory,
    removeCustomUserCategory,
    addCustomCategoryUser,
    removeCustomCategoryUser,
    clearCustomCategoryUsers,
    setCustomUserCategoryColor,
    addHiddenWord,
    removeHiddenWord,
    addMediaFilterList,
    removeMediaFilterList,
    exportConfigToFile,
    importConfigFromFile,
    reapplyFilters
  }) {
    let styleInjected = false;
    let overlay = null;
    let currentTab = 'users';
    const pageByTab = {
      users: 1,
      follow: 1,
      list: 1,
      statuses: 1,
      words: 1,
      media: 1,
      settings: 1
    };
    const searchByTab = {
      users: '',
      follow: '',
      list: '',
      statuses: '',
      words: '',
      media: ''
    };


    /**
     * 動的タブ用のページ番号と検索語を初期化する。
     * 入力: タブキー。
     * 出力: なし。
     * 主な処理内容:
     * 1. ユーザー定義分類タブが後から増えても状態オブジェクトへ初期値を入れる
     */
    function ensureTabState (tabKey) {
      if (!pageByTab[tabKey]) {
        pageByTab[tabKey] = 1;
      }
      if (tabKey !== 'settings' && searchByTab[tabKey] === undefined) {
        searchByTab[tabKey] = '';
      }
    }

    /**
     * ダイアログ共通スタイルを一度だけ挿入する。
     * 入力: なし。
     * 出力: なし。
     * 主な処理内容:
     * 1. 多重に style が増えないよう初回だけ GM_addStyle を呼ぶ
     */
    function ensureStyle () {
      if (styleInjected) return
      GM_addStyle(DIALOG_STYLE);
      styleInjected = true;
    }

    /**
     * 追加対象ごとのコールバックと文言を返す。
     * 入力: タブキー。
     * 出力: 追加や削除に必要な設定情報。
     * 主な処理内容:
     * 1. タブごとに保存関数を切り替える
     * 2. 全削除ボタンの文言もここでまとめる
     */
    function getTabActions (tabKey) {
      if (tabKey === 'users') {
        return {
          itemCount: getTabListModel(tabKey).rawItems.length,
          addLabel: 'Add',
          clearLabel: 'Clear all users',
          totalLabel: 'Active Filters',
          addItem: async value => addHiddenUser(value),
          removeItem: async value => removeHiddenUser(value),
          clearAll: async () => {
            await clearHiddenUsers();
            reapplyFilters();
          },
          normalizeInput: value => normalizeUserId(value)
        }
      }

      if (tabKey === 'follow') {
        return {
          itemCount: getTabListModel(tabKey).rawItems.length,
          addLabel: 'Add',
          clearLabel: 'Clear all follows',
          totalLabel: 'Known Users',
          addItem: async value => addFollowUser(value),
          removeItem: async value => removeFollowUser(value),
          clearAll: async () => {
            await clearFollowUsers();
            reapplyFilters();
          },
          normalizeInput: value => normalizeUserId(value)
        }
      }

      if (tabKey === 'list') {
        return {
          itemCount: getTabListModel(tabKey).rawItems.length,
          addLabel: 'Add',
          clearLabel: 'Clear all lists',
          totalLabel: 'Known Users',
          addItem: async value => addListUser(value),
          removeItem: async value => removeListUser(value),
          clearAll: async () => {
            await clearListUsers();
            reapplyFilters();
          },
          normalizeInput: value => normalizeUserId(value)
        }
      }


      const customCategory = getCustomCategoryForTab(tabKey);
      if (customCategory) {
        return {
          itemCount: getTabListModel(tabKey).rawItems.length,
          addLabel: 'Add',
          clearLabel: `Clear all ${customCategory.label}`,
          totalLabel: 'Known Users',
          addItem: async value => addCustomCategoryUser(customCategory.id, value),
          removeItem: async value => removeCustomCategoryUser(customCategory.id, value),
          clearAll: async () => {
            await clearCustomCategoryUsers(customCategory.id);
            reapplyFilters();
          },
          normalizeInput: value => normalizeUserId(value)
        }
      }

      if (tabKey === 'statuses') {
        return {
          itemCount: getTabListModel(tabKey).rawItems.length,
          addLabel: 'Add',
          clearLabel: 'Clear all posts',
          totalLabel: 'Active Filters',
          addItem: async value => addHiddenStatus(value),
          removeItem: async value => removeHiddenStatus(value),
          clearAll: async () => {
            for (const entry of [...config.hiddenStatuses]) {
              await removeHiddenStatus(entry.statusId);
            }
            reapplyFilters();
          },
          normalizeInput: value => normalizeStatusInput(value)
        }
      }

      if (tabKey === 'words') {
        return {
          itemCount: getTabListModel(tabKey).rawItems.length,
          addLabel: 'Add',
          clearLabel: 'Clear all words',
          totalLabel: 'Active Filters',
          addItem: async value => addHiddenWord(value),
          removeItem: async value => removeHiddenWord(value),
          clearAll: async () => {
            for (const value of [...config.hiddenWords]) {
              await removeHiddenWord(value);
            }
            reapplyFilters();
          },
          normalizeInput: value => value
        }
      }

      return {
        itemCount: getTabListModel(tabKey).rawItems.length,
        addLabel: 'Add',
        clearLabel: 'Clear all media',
        totalLabel: 'Media Filters',
        addItem: async value => addMediaFilterList(value),
        removeItem: async value => removeMediaFilterList(value),
        clearAll: async () => {
          for (const value of [...config.mediaFilterLists]) {
            await removeMediaFilterList(value);
          }
          reapplyFilters();
        },
        normalizeInput: value => value
      }
    }

    /**
     * タブと現在件数に応じてフッター文言を返す。
     * 入力: タブキーと件数。
     * 出力: ラベル文字列。
     * 主な処理内容:
     * 1. 設定タブだけは件数ではなく状態数として表現する
     */
    function getFooterBadgeLabel (tabKey, count) {
      if (tabKey === 'categorySettings') {
        return `${count} Categories`
      }

      if (tabKey === 'settings') {
        return `${count} Settings`
      }
      return `${count} Active Filters`
    }

    /**
     * 検索中の件数表示ラベルを返す。
     * 入力: タブキー、検索後件数、全件数。
     * 出力: フッターに表示する件数ラベル。
     * 主な処理内容:
     * 1. 検索語がある場合は一致件数と全件数を併記する
     * 2. 検索していない場合は従来どおり全件数だけを表示する
     */
    function getFilteredFooterBadgeLabel (tabKey, filteredCount, totalCount) {
      const baseLabel = getFooterBadgeLabel(tabKey, filteredCount);
      if (!searchByTab[tabKey]) {
        return baseLabel
      }

      return `${filteredCount} / ${totalCount} Active Filters`
    }

    /**
     * 現在の大分類に対応する左側小項目ナビを描画する。
     * 入力: 大分類キー。
     * 出力: 小項目ボタンの HTML 文字列。
     * 主な処理内容:
     * 1. 大分類内の小項目だけを縦並びボタンへ変換する
     * 2. 現在選択中の小項目へ active 状態を付ける
     */
    function renderSideTabs (categoryKey) {
      return getTabsForCategory(categoryKey)
        .map(tab => `
        <button class="xtlo-settings-side-tab" data-tab="${escapeAttribute(tab.key)}" data-active="${String(tab.key === currentTab)}">
          <span class="xtlo-settings-side-icon">${getListIcon(tab.key)}</span>
          <span class="xtlo-settings-side-tab-label">${escapeHtml(tab.label)}</span>
        </button>
      `)
        .join('')
    }

    /**
     * ページネーション UI を描画する。
     * 入力: 現在ページと総ページ数。
     * 出力: 前後移動ボタンとページ入力欄の HTML 文字列。
     * 主な処理内容:
     * 1. 上部と下部で同じ操作 UI を使えるよう HTML を共通化する
     * 2. 端ページでは前後移動ボタンを無効化する
     */
    function renderPagination (currentPage, totalPages) {
      return `
      <div class="xtlo-settings-pagination">
        <button class="xtlo-settings-page-btn" data-action="prev-page" ${currentPage <= 1 ? 'disabled' : ''} aria-label="前のページ">‹</button>
        <div class="xtlo-settings-page-indicator">
          <input class="xtlo-settings-page-current" data-role="page-input" inputmode="numeric" value="${currentPage}" aria-label="現在のページ" />
          <div>/ ${totalPages}</div>
        </div>
        <button class="xtlo-settings-page-btn" data-action="next-page" ${currentPage >= totalPages ? 'disabled' : ''} aria-label="次のページ">›</button>
      </div>
    `
    }

    /** ゴミ箱アイコン SVG を返す。*/
    function getTrashIcon () {
      return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M16 6V4.5A1.5 1.5 0 0 0 14.5 3h-5A1.5 1.5 0 0 0 8 4.5V6H4v2h1v10.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8h1V6h-4zm-6-.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V6h-4V5.5zm-1 4h2v7H9v-7zm4 0h2v7h-2v-7z"/>
      </svg>
    `
    }

    /** リストアイコン SVG を返す。*/
    function getListIcon (tabKey) {
      if (tabKey === 'users') {
        return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2-7 4.5V20h14v-1.5C19 16 16 14 12 14z"/>
        </svg>
      `
      }

      if (tabKey === 'statuses') {
        return `
        <svg viewBox="0 -1 24 24" aria-hidden="true">
          <path fill="currentColor" d="M20 4H4a2 2 0 0 0-2 2v12l4-4h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-2 8H6v-2h12zm0-3H6V7h12z"/>
        </svg>
      `
      }

      if (tabKey === 'words') {
        return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M5 5h14v3h-5v12h-4V8H5z"/>
        </svg>
      `
      }

      if (tabKey === 'media') {
        return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M4 6h16v12H4zm2 2v8h12V8zm2 1h4v2H8zm0 3h8v2H8z"/>
        </svg>
      `
      }

      if (tabKey === 'follow') {
        return `
        <svg viewBox="0 -2 24 24" aria-hidden="true">
          <path fill="currentColor" d="M17 7a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm-8 1a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm5 2c-2.33 0-7 1.17-7 3.5V16h14v-2.5C21 11.17 16.33 10 14 10zm-5 1c-2.67 0-8 1.34-8 4v1h4v-2.5c0-.9.37-1.72 1.03-2.4A12.7 12.7 0 0 1 9 11z"/>
        </svg>
      `
      }

      if (tabKey === 'list') {
        return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M4 6h3v3H4zm0 5h3v3H4zm0 5h3v3H4zm5-10h11v3H9zm0 5h11v3H9zm0 5h11v3H9z"/>
        </svg>
      `
      }

      if (getCustomCategoryIdFromTabKey(tabKey) || tabKey === 'categorySettings') {
        return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12 3 3 8l9 5 9-5zm-6 8.2V16l6 3 6-3v-4.8l-6 3.3z"/>
        </svg>
      `
      }

      if (tabKey === 'settings') {
        return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M19.14 12.94a7.49 7.49 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.3 7.3 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.49 7.49 0 0 0 0 1.88L2.79 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.38 1.05.7 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.57-.24 1.12-.56 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z"/>
        </svg>
      `
      }

      return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M4 6h16v12H4zm2 2v8h12V8z"/>
      </svg>
    `
    }


    /**
     * 分類管理タブの HTML を返す。
     * 入力: なし。
     * 出力: 分類追加フォームと既存分類一覧の HTML 文字列。
     * 主な処理内容:
     * 1. 分類名と色を指定して追加できるフォームを作る
     * 2. 既存分類ごとに色変更と削除ボタンを配置する
     */
    function renderCategorySettings () {
      const rows = config.customUserCategories.length
        ? config.customUserCategories.map(category => `
        <div class="xtlo-settings-category-row">
          <span class="xtlo-settings-category-swatch" style="background: ${escapeAttribute(category.color || DEFAULT_CUSTOM_CATEGORY_COLOR)}"></span>
          <div class="xtlo-settings-category-meta">
            <div class="xtlo-settings-category-name">${escapeHtml(category.label)}</div>
            <div class="xtlo-settings-category-count">${category.userIds.length} users</div>
          </div>
          <input class="xtlo-settings-color-input" type="color" data-action="set-category-color" data-category-id="${escapeAttribute(category.id)}" value="${escapeAttribute(category.color || DEFAULT_CUSTOM_CATEGORY_COLOR)}" aria-label="分類色" />
          <button class="xtlo-settings-danger-icon" data-action="remove-category" data-category-id="${escapeAttribute(category.id)}" aria-label="分類を削除">
            ${getTrashIcon()}
          </button>
        </div>
      `).join('')
        : '<div class="xtlo-settings-empty">まだ分類はありません。</div>';

      return `
      <div class="xtlo-settings-category-manager">
        <div class="xtlo-settings-category-form">
          <input class="xtlo-settings-input" type="text" data-role="category-input" placeholder="分類名" aria-label="分類名" />
          <input class="xtlo-settings-color-input" type="color" data-role="category-color-input" value="${DEFAULT_CUSTOM_CATEGORY_COLOR}" aria-label="分類色" />
          <button class="xtlo-settings-primary" data-action="add-category">Add</button>
        </div>
        <div class="xtlo-settings-category-list">${rows}</div>
      </div>
    `
    }

    /**
     * 画面を再描画する。
     * 入力: なし。
     * 出力: なし。
     * 主な処理内容:
     * 1. 現在タブから大分類と左側小項目ナビを描画する
     * 2. 現在タブに応じたリストや設定項目を右側へ描画する
     * 3. 件数とページ数からページネーション表示を更新する
     */
    function render () {
      if (!overlay) return

      ensureTabState(currentTab);

      const body = overlay.querySelector('.xtlo-settings-body');
      const footer = overlay.querySelector('.xtlo-settings-footer');
      const categoryKey = getCategoryKeyForTab(currentTab);
      const categoryButtons = overlay.querySelectorAll('.xtlo-settings-category-tab');

      categoryButtons.forEach(button => {
        button.dataset.active = String(button.dataset.category === categoryKey);
      });

      body.innerHTML = `
      <div class="xtlo-settings-layout">
        <div class="xtlo-settings-side-tabs">${renderSideTabs(categoryKey)}</div>
        <div class="xtlo-settings-content"></div>
      </div>
    `;

      const content = body.querySelector('.xtlo-settings-content');

      if (currentTab === 'settings') {
        // 安全運用中は自動更新と X UI 非表示を再有効化できないよう、設定タブにも切り替え操作を出さない。
        content.innerHTML = `
        <div class="xtlo-settings-settings-grid">
          <div class="xtlo-settings-toggle-card">
            <div class="xtlo-settings-toggle-copy">
              <div class="xtlo-settings-toggle-title">設定ファイル</div>
              <div class="xtlo-settings-toggle-desc">現在のフィルターと設定を JSON で保存、または取り込みます。</div>
            </div>
            <div class="xtlo-settings-actions">
              <button class="xtlo-settings-secondary" data-action="export-config">エクスポート</button>
              <button class="xtlo-settings-secondary" data-action="import-config">インポート</button>
            </div>
          </div>
          <div class="xtlo-settings-hint">
            ポストID は 30 日で期限切れになります。メディアタブは現在保存済みのリスト名のみを編集でき、無効な名前の入力もそのまま保存されます。
          </div>
        </div>
      `;

        footer.innerHTML = `
        <div></div>
        <div class="xtlo-settings-badge">${getFooterBadgeLabel('settings', 1)}</div>
      `;
        return
      }

      if (currentTab === 'categorySettings') {
        content.innerHTML = renderCategorySettings();
        footer.innerHTML = `
        <div></div>
        <div class="xtlo-settings-badge">${getFooterBadgeLabel('categorySettings', config.customUserCategories.length)}</div>
      `;
        return
      }

      const tabDefinition = getAllTabDefinitions().find(tab => tab.key === currentTab);
      const actions = getTabActions(currentTab);
      const listModel = getTabListModel(currentTab);
      const totalItems = listModel.rawItems.length;
      const searchQuery = searchByTab[currentTab] ?? '';
      const filteredRawItems = filterRawItemsByQuery(listModel, searchQuery);
      const totalPages = Math.max(1, Math.ceil(filteredRawItems.length / PAGE_SIZE));
      const currentPage = Math.min(pageByTab[currentTab], totalPages);
      pageByTab[currentTab] = currentPage;
      const startIndex = (currentPage - 1) * PAGE_SIZE;
      const visibleItems = filteredRawItems
        .slice(startIndex, startIndex + PAGE_SIZE)
        .map(item => listModel.toItem(item));

      const listMarkup = visibleItems.length
        ? visibleItems
            .map(
              item => `
              <div class="xtlo-settings-card">
                <div class="xtlo-settings-icon">${getListIcon(currentTab)}</div>
                <div class="xtlo-settings-item-text">
                  <div class="xtlo-settings-item-title">${escapeHtml(item.title)}</div>
                  <div class="xtlo-settings-item-subtitle">${escapeHtml(item.subtitle)}</div>
                </div>
                <button class="xtlo-settings-danger-icon" data-action="remove-item" data-value="${escapeAttribute(item.value)}" aria-label="削除">
                  ${getTrashIcon()}
                </button>
              </div>
            `
            )
            .join('')
        : '<div class="xtlo-settings-empty">まだ項目はありません。</div>';

      content.innerHTML = `
      <div class="xtlo-settings-add-row">
        <input class="xtlo-settings-input" type="text" placeholder="${escapeAttribute(tabDefinition.placeholder)}" />
        <button class="xtlo-settings-primary" data-action="add-item">${actions.addLabel}</button>
      </div>
      <div class="xtlo-settings-search-row">
        <input class="xtlo-settings-search-input" type="search" data-role="search-input" value="${escapeAttribute(searchQuery)}" placeholder="登録済み項目を検索" aria-label="登録済み項目を検索" />
      </div>
      ${renderPagination(currentPage, totalPages)}
      <div class="xtlo-settings-list">${listMarkup}</div>
      ${renderPagination(currentPage, totalPages)}
    `;

      footer.innerHTML = `
      <button class="xtlo-settings-clear" data-action="clear-all">${actions.clearLabel}</button>
      <div class="xtlo-settings-badge">${getFilteredFooterBadgeLabel(currentTab, filteredRawItems.length, totalItems)}</div>
    `;
    }

    /**
     * 現在タブの入力欄を保存処理へ渡す。
     * 入力: なし。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 入力を trim してタブごとの形式へ正規化する
     * 2. 保存後に安全モード用の分類色再適用を呼び、再描画する
     */
    async function handleAddItem () {
      const body = overlay.querySelector('.xtlo-settings-body');
      const input = body.querySelector('.xtlo-settings-input');
      if (!input) return

      const rawValue = input.value.trim();
      if (!rawValue) return

      const actions = getTabActions(currentTab);
      const normalizedValue = actions.normalizeInput(rawValue);
      if (!normalizedValue) {
        alert('入力内容を解釈できませんでした');
        return
      }

      await actions.addItem(normalizedValue);
      input.value = '';
      reapplyFilters();
      render();
    }

    /**
     * 現在タブの項目を 1 件削除する。
     * 入力: data-value に入った保存値。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. タブに応じた削除関数を呼ぶ
     * 2. 安全モード用の分類色再適用後に空ページへ残らないようページ番号も補正する
     */
    async function handleRemoveItem (value) {
      const actions = getTabActions(currentTab);
      await actions.removeItem(value);
      reapplyFilters();

      const remainingCount = filterRawItemsByQuery(
        getTabListModel(currentTab),
        searchByTab[currentTab] ?? ''
      ).length;
      const maxPage = Math.max(1, Math.ceil(remainingCount / PAGE_SIZE));
      pageByTab[currentTab] = Math.min(pageByTab[currentTab], maxPage);
      render();
    }

    /**
     * 現在タブの項目を全削除する。
     * 入力: なし。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 確認ダイアログで誤操作を防ぐ
     * 2. タブごとの clearAll を実行して再描画する
     */

    /**
     * ユーザー定義分類を追加する。
     * 入力: 分類設定タブの分類名と色入力欄。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 分類名と色を読み取って保存コールバックへ渡す
     * 2. 作成後は分類設定タブを再描画する
     */
    async function handleAddCategory () {
      const input = overlay.querySelector('[data-role="category-input"]');
      if (!input) return

      const colorInput = overlay.querySelector('[data-role="category-color-input"]');
      const label = input.value.trim();
      const color = colorInput?.value || DEFAULT_CUSTOM_CATEGORY_COLOR;
      if (!label) return

      const category = await addCustomUserCategory(label, color);
      if (!category) {
        alert('分類名が空、または既に登録済みです');
        return
      }

      input.value = '';
      if (colorInput) {
        colorInput.value = DEFAULT_CUSTOM_CATEGORY_COLOR;
      }
      render();
    }

    /**
     * ユーザー定義分類を削除する。
     * 入力: 分類 ID。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 確認ダイアログで誤削除を防ぐ
     * 2. 削除中の分類タブを開いていた場合は分類設定タブへ戻す
     */
    async function handleRemoveCategory (categoryId) {
      const category = config.customUserCategories.find(item => item.id === categoryId);
      if (!category) return

      if (!confirm(`分類「${category.label}」を削除しますか？登録ユーザーもこの分類から削除されます。`)) {
        return
      }

      await removeCustomUserCategory(categoryId);
      reapplyFilters();
      if (currentTab === getCustomCategoryTabKey(categoryId)) {
        currentTab = 'categorySettings';
      }
      render();
    }


    /**
     * ユーザー定義分類の色変更を保存する。
     * 入力: 分類 ID と color input の値。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 選択された色を保存コールバックへ渡す
     * 2. 既存 article の分類色だけを再適用する
     */
    async function handleSetCategoryColor (categoryId, color) {
      await setCustomUserCategoryColor(categoryId, color);
      reapplyFilters();
      render();
    }

    async function handleClearAll () {
      const actions = getTabActions(currentTab);
      if (actions.itemCount === 0) return

      if (!confirm('このタブの項目をすべて削除しますか？')) {
        return
      }

      await actions.clearAll();
      pageByTab[currentTab] = 1;
      render();
    }

    /**
     * ページ入力欄の値を現在タブのページ番号へ反映する。
     * 入力: ページ入力欄の文字列。
     * 出力: なし。
     * 主な処理内容:
     * 1. 総ページ数を基準に不正値を 1..totalPages へ補正する
     * 2. 補正後の値を state と表示へ反映する
     */
    function applyPageInput (rawValue) {
      const filteredItems = filterRawItemsByQuery(
        getTabListModel(currentTab),
        searchByTab[currentTab] ?? ''
      );
      const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
      const normalizedPage = normalizePageNumber(rawValue, totalPages);

      pageByTab[currentTab] = normalizedPage;
      render();
    }

    /**
     * 現在タブの検索語を更新して一覧を絞り込む。
     * 入力: 検索入力欄の文字列。
     * 出力: なし。
     * 主な処理内容:
     * 1. タブごとに検索語を保持する
     * 2. 検索結果が変わったとき空ページへ残らないようページ番号を 1 に戻す
     */
    function applySearchInput (rawValue) {
      searchByTab[currentTab] = rawValue;
      pageByTab[currentTab] = 1;
      render();

      const searchInput = overlay.querySelector('[data-role="search-input"]');
      if (searchInput) {
        searchInput.focus();
        searchInput.setSelectionRange(rawValue.length, rawValue.length);
      }
    }

    /**
     * ダイアログ内クリックをイベント委譲で処理する。
     * 入力: click イベント。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 再描画でボタンが差し替わってもリスナーを張り直さずに済むよう data-action を読む
     * 2. タブ切り替え、追加、削除、インポート/エクスポートを振り分ける
     */
    async function handleOverlayClick (event) {
      if (event.target === overlay) {
        close();
        return
      }

      const target = event.target.closest(
        '[data-action], .xtlo-settings-category-tab, .xtlo-settings-side-tab, .xtlo-settings-close'
      );
      if (!target) return

      if (target.classList.contains('xtlo-settings-close')) {
        close();
        return
      }

      if (target.classList.contains('xtlo-settings-category-tab')) {
        currentTab = getDefaultTabForCategory(target.dataset.category);
        render();
        return
      }

      if (target.classList.contains('xtlo-settings-side-tab')) {
        currentTab = target.dataset.tab;
        render();
        return
      }

      const { action } = target.dataset;
      if (!action) return

      if (action === 'add-item') {
        await handleAddItem();
        return
      }

      if (action === 'remove-item') {
        await handleRemoveItem(target.dataset.value);
        return
      }

      if (action === 'add-category') {
        await handleAddCategory();
        return
      }

      if (action === 'remove-category') {
        await handleRemoveCategory(target.dataset.categoryId);
        return
      }

      if (action === 'clear-all') {
        await handleClearAll();
        return
      }

      if (action === 'prev-page') {
        pageByTab[currentTab] = Math.max(1, pageByTab[currentTab] - 1);
        render();
        return
      }

      if (action === 'next-page') {
        pageByTab[currentTab] += 1;
        render();
        return
      }

      if (action === 'export-config') {
        exportConfigToFile();
        return
      }

      if (action === 'import-config') {
        await importConfigFromFile();
        render();
      }
    }

    /**
     * Enter キーで追加できるように入力欄のキー入力を処理する。
     * 入力: keydown イベント。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 入力欄で Enter が押されたときだけ追加処理を呼ぶ
     */
    async function handleOverlayKeydown (event) {
      if (event.key === 'Escape') {
        close();
        return
      }

      if (
        event.key === 'Enter' &&
        event.target.dataset.role === 'category-input'
      ) {
        event.preventDefault();
        await handleAddCategory();
        return
      }

      if (
        event.key === 'Enter' &&
        event.target.classList.contains('xtlo-settings-input')
      ) {
        event.preventDefault();
        await handleAddItem();
        return
      }

      if (
        event.key === 'Enter' &&
        event.target.dataset.role === 'page-input'
      ) {
        event.preventDefault();
        applyPageInput(event.target.value);
      }
    }

    /**
     * change イベントからページ入力欄や分類色の変更を反映する。
     * 入力: change イベント。
     * 出力: なし。
     * 主な処理内容:
     * 1. 分類色の変更は保存して既存 article の分類色だけを再適用する
     * 2. ページ入力欄は不正値を補正して再描画する
     */
    function handleOverlayChange (event) {
      if (event.target.dataset.action === 'set-category-color') {
        handleSetCategoryColor(event.target.dataset.categoryId, event.target.value).catch(error => {
          console.error('[X-Observer] 分類色の変更に失敗しました:', error);
          alert(`分類色の変更に失敗しました: ${error.message}`);
        });
        return
      }

      if (event.target.dataset.role === 'page-input') {
        applyPageInput(event.target.value);
        return
      }

      if (event.target.dataset.role === 'search-input') {
        applySearchInput(event.target.value);
      }
    }

    /**
     * input イベントから検索欄の入力を即時反映する。
     * 入力: input イベント。
     * 出力: なし。
     * 主な処理内容:
     * 1. 検索欄の入力だけを拾う
     * 2. 入力途中でも一覧を絞り込めるよう即時再描画する
     */
    function handleOverlayInput (event) {
      if (event.target.dataset.role !== 'search-input') {
        return
      }

      applySearchInput(event.target.value);
    }

    /**
     * ダイアログ DOM を生成して body へ挿入する。
     * 入力: なし。
     * 出力: なし。
     * 主な処理内容:
     * 1. 初回にだけ overlay を作成する
     * 2. クリックとキー入力のリスナーを委譲で登録する
     */
    function ensureOverlay () {
      if (overlay) return

      overlay = document.createElement('div');
      overlay.className = 'xtlo-settings-overlay';
      overlay.innerHTML = `
      <div class="xtlo-settings-dialog" role="dialog" aria-modal="true" aria-label="X-Observer 設定">
        <div class="xtlo-settings-header">
          <div class="xtlo-settings-header-row">
            <div class="xtlo-settings-title">X-Observer</div>
            <button class="xtlo-settings-close" aria-label="閉じる">×</button>
          </div>
          <div class="xtlo-settings-category-tabs">
            ${CATEGORY_DEFINITIONS.map(category => `
              <button class="xtlo-settings-category-tab" data-category="${category.key}" data-active="false">${category.label}</button>
            `).join('')}
          </div>
        </div>
        <div class="xtlo-settings-body"></div>
        <div class="xtlo-settings-footer"></div>
      </div>
    `;

      overlay.addEventListener('click', event => {
        handleOverlayClick(event).catch(error => {
          console.error('[X-Observer] 設定ダイアログ操作に失敗しました:', error);
          alert(`設定ダイアログ操作に失敗しました: ${error.message}`);
        });
      });
      overlay.addEventListener('keydown', event => {
        handleOverlayKeydown(event).catch(error => {
          console.error('[X-Observer] 設定ダイアログ入力処理に失敗しました:', error);
          alert(`設定ダイアログ入力処理に失敗しました: ${error.message}`);
        });
      });
      overlay.addEventListener('change', event => {
        try {
          handleOverlayChange(event);
        } catch (error) {
          console.error('[X-Observer] 設定ダイアログのページ変更に失敗しました:', error);
          alert(`設定ダイアログのページ変更に失敗しました: ${error.message}`);
        }
      });
      overlay.addEventListener('input', event => {
        try {
          handleOverlayInput(event);
        } catch (error) {
          console.error('[X-Observer] 設定ダイアログの検索に失敗しました:', error);
          alert(`設定ダイアログの検索に失敗しました: ${error.message}`);
        }
      });
    }

    /**
     * ダイアログを開く。
     * 入力: 開きたいタブキー。省略時は現在タブを維持。
     * 出力: なし。
     * 主な処理内容:
     * 1. スタイルと DOM を準備する
     * 2. body へ追加して描画する
     * 3. 最初の入力欄へフォーカスする
     */
    function open (tabKey = currentTab) {
      currentTab = tabKey;
      ensureTabState(currentTab);
      ensureStyle();
      ensureOverlay();
      if (!overlay.isConnected) {
        document.body.appendChild(overlay);
      }
      render();
      overlay.tabIndex = -1;
      overlay.focus();

      const input = overlay.querySelector('.xtlo-settings-input');
      if (input) {
        input.focus();
      }
    }

    /**
     * ダイアログを閉じる。
     * 入力: なし。
     * 出力: なし。
     * 主な処理内容:
     * 1. overlay を DOM から外す
     */
    function close () {
      overlay?.remove();
    }

    return {
      open,
      close
    }
  }

  /**
   * HTML として埋め込む文字列をエスケープする。
   * 入力: 任意の文字列。
   * 出力: 安全な HTML 文字列。
   * 主な処理内容:
   * 1. innerHTML へ入れる値の記号を実体参照へ置換する
   */
  function escapeHtml (value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  /**
   * 属性値へ入れる文字列をエスケープする。
   * 入力: 任意の文字列。
   * 出力: 属性値として安全な文字列。
   * 主な処理内容:
   * 1. 本実装では HTML エスケープと同じ規則で十分なため共通化する
   */
  function escapeAttribute (value) {
    return escapeHtml(value)
  }

  /**
   * prompt の戻り値を設定追加用に正規化する。
   * 入力: prompt が返した文字列または null。
   * 出力: trim 済み文字列、または空入力時の null。
   * 主な処理内容:
   * 1. キャンセル時は null を返す
   * 2. 前後空白を除去し、空文字は null 扱いにする
   */
  function normalizePromptInput (input) {
    if (input === null) return null

    const normalized = input.trim();
    return normalized || null
  }

  /**
   * 投稿 ID 入力から statusId を取り出す。
   * 入力: 数字文字列、または投稿 URL。
   * 出力: statusId、解釈できない場合は null。
   * 主な処理内容:
   * 1. 純粋な数字ならそのまま返す
   * 2. URL からは /status/<数字> を抽出する
   */
  function parseStatusId (input) {
    if (/^\d+$/.test(input)) {
      return input
    }

    // URL 全体を保存すると unrelated な数字まで拾う危険があるため、status パスだけを見る。
    const match = input.match(/\/status\/(\d+)/);
    return match ? match[1] : null
  }

  /**
   * Tampermonkey メニューへ設定操作コマンドを登録する。
   * 入力: 追加・表示・インポートなどに必要なコールバック群。
   * 出力: なし。
   * 主な処理内容:
   * 1. 設定ダイアログを開くメニューを登録する
   * 2. 既存の prompt ベース操作も後方互換として残す
   * 3. 追加やインポート後に画面へ再反映する
   */
  function registerMenuCommands ({
    addHiddenStatus,
    addHiddenUser,
    addFollowUser,
    addListUser,
    addHiddenWord,
    exportConfigToFile,
    importConfigFromFile,
    reapplyFilters,
    openSettingsDialog
  }) {
    GM_registerMenuCommand('設定ダイアログを開く', () => {
      openSettingsDialog();
    });

    GM_registerMenuCommand('非表示ユーザーIDを追加', async () => {
      const userId = normalizePromptInput(
        prompt('非表示にしたいユーザー ID を入力してください。@ あり/なし、または数字の内部 ID でも構いません')
      );
      if (!userId) {
        console.log('[X-Observer] 空のユーザー ID 入力はキャンセルしました');
        return
      }

      await addHiddenUser(userId);
      reapplyFilters();
    });

    GM_registerMenuCommand('フォローユーザーIDを追加', async () => {
      const userId = normalizePromptInput(
        prompt('フォローとして記録したいユーザー ID を入力してください。@ あり/なし、または数字の内部 ID でも構いません')
      );
      if (!userId) {
        console.log('[X-Observer] 空のフォローユーザー ID 入力はキャンセルしました');
        return
      }

      await addFollowUser(userId);
      reapplyFilters();
    });

    GM_registerMenuCommand('リストインユーザーIDを追加', async () => {
      const userId = normalizePromptInput(
        prompt('リストインとして記録したいユーザー ID を入力してください。@ あり/なし、または数字の内部 ID でも構いません')
      );
      if (!userId) {
        console.log('[X-Observer] 空のリストインユーザー ID 入力はキャンセルしました');
        return
      }

      await addListUser(userId);
      reapplyFilters();
    });

    GM_registerMenuCommand('非表示ポストIDを追加', async () => {
      const rawInput = normalizePromptInput(
        prompt('非表示にしたいポスト ID またはポスト URL を入力してください')
      );
      if (!rawInput) {
        console.log('[X-Observer] 空のポスト ID 入力はキャンセルしました');
        return
      }

      const statusId = parseStatusId(rawInput);
      if (!statusId) {
        console.log('[X-Observer] ポスト ID を解釈できませんでした:', rawInput);
        return
      }

      await addHiddenStatus(statusId);
      reapplyFilters();
    });

    GM_registerMenuCommand('非表示キーワードを追加', async () => {
      const word = normalizePromptInput(
        prompt('非表示にしたいキーワードを入力してください')
      );
      if (!word) {
        console.log('[X-Observer] 空のキーワード入力はキャンセルしました');
        return
      }

      await addHiddenWord(word);
      reapplyFilters();
    });

    GM_registerMenuCommand('設定をエクスポート', () => {
      exportConfigToFile();
    });

    GM_registerMenuCommand('設定をインポート', async () => {
      await importConfigFromFile();
    });
  }

  const FOLLOW_LABEL_CLASS = 'xtlo-user-label-follow';
  const LIST_LABEL_CLASS = 'xtlo-user-label-list';
  const CUSTOM_LABEL_CLASS = 'xtlo-user-label-custom';
  const CUSTOM_LABEL_COLORS = ['#f5c542', '#ff7a59', '#b17cff', '#00c2a8', '#ff6fae', '#9ad66b'];
  const USER_LABEL_CSS = `
  .${FOLLOW_LABEL_CLASS} {
    color: #1d9bf0 !important;
  }

  .${LIST_LABEL_CLASS} {
    color: #33c46a !important;
  }

  .${CUSTOM_LABEL_CLASS} {
    color: var(--xtlo-user-label-color, #f5c542) !important;
  }
`;

  let styleInjected = false;

  /**
   * ユーザー分類ラベル用のスタイルを一度だけ挿入する。
   * 入力: なし
   * 出力: なし
   * 主な処理内容:
   * 1. フォロー、リスト、ユーザー定義分類用の色を定義する
   * 2. 多重挿入を防ぐ
   */
  function applyUserLabelStyles () {
    if (styleInjected) return

    GM_addStyle(USER_LABEL_CSS);
    styleInjected = true;
  }

  /**
   * 設定から対象ユーザーの色分類を返す。
   * 入力: ユーザー ID 候補、現在設定
   * 出力: 分類種別と色。該当しない場合は null。
   * 主な処理内容:
   * 1. スクリーン名と内部数字 ID の候補を同列に扱う
   * 2. フォロー分類、リスト分類、ユーザー定義分類の順に判定する
   * 3. ユーザー定義分類は設定色を使い、未設定時だけ登録順の既定色へ戻す
   */
  function getUserLabelType (userIdCandidates, config) {
    if (userIdCandidates.length === 0) return null

    if (findMatchingUserId(userIdCandidates, configIndexes.followUserIds)) {
      return { type: 'follow' }
    }

    if (findMatchingUserId(userIdCandidates, configIndexes.listUserIds)) {
      return { type: 'list' }
    }

    let customCategoryIndex = null;
    for (const userId of userIdCandidates) {
      const candidateIndex = configIndexes.customUserCategoryIndexByUserId.get(userId);
      if (
        candidateIndex !== undefined &&
        (customCategoryIndex === null || candidateIndex < customCategoryIndex)
      ) {
        customCategoryIndex = candidateIndex;
      }
    }

    if (customCategoryIndex !== null) {
      const customCategory = config.customUserCategories[customCategoryIndex];
      return {
        type: 'custom',
        color: customCategory.color || CUSTOM_LABEL_COLORS[customCategoryIndex % CUSTOM_LABEL_COLORS.length]
      }
    }

    return null
  }

  /**
   * プロフィール系リンクかどうかを userId 基準で判定する。
   * 入力: href 文字列、対象 userId
   * 出力: 一致時 true
   * 主な処理内容:
   * 1. /<userId> または /<userId>/status/... を受け入れる
   * 2. クエリやハッシュ付きリンクも拾う
   */
  function isUserProfileLink (href, userId) {
    return (
      href === `/${userId}` ||
      href.startsWith(`/${userId}/`) ||
      href.startsWith(`/${userId}?`) ||
      href.startsWith(`/${userId}#`)
    )
  }

  /**
   * ユーザー ID 表示用の span をリンク内から探す。
   * 入力: プロフィールリンク要素、対象 userId
   * 出力: マッチした span 要素、無ければ null
   * 主な処理内容:
   * 1. @userId と完全一致する表示だけを対象にする
   * 2. displayName 側を誤って着色しない
   */
  function findUserIdSpan (link, userId) {
    const expectedText = `@${userId}`;
    const spans = link.querySelectorAll('span');

    for (const span of spans) {
      const text = span.textContent?.trim().replace(/\u200b/g, '');
      if (text === expectedText) {
        return span
      }
    }

    return null
  }

  /**
   * プロフィールリンク内の @userId 表示から画面上のユーザー ID を取り出す。
   * 入力: プロフィールリンク候補の a 要素。
   * 出力: screen name 形式のユーザー ID。解釈できない場合は null。
   * 主な処理内容:
   * 1. リンク内の span から @userId 表示だけを探す
   * 2. href と表示 ID が対応する場合だけ採用し、表示名や別リンクの誤着色を避ける
   */
  function getUserIdFromProfileLink (link) {
    const href = link.getAttribute('href') || '';
    const spans = link.querySelectorAll('span');

    for (const span of spans) {
      const text = span.textContent?.trim().replace(/\u200b/g, '') || '';
      if (!/^@[A-Za-z0-9_]{1,20}$/.test(text)) {
        continue
      }

      const userId = normalizeUserId(text);
      if (isUserProfileLink(href, userId)) {
        return userId
      }
    }

    return null
  }

  /**
   * コンテナ内の既存分類クラスを除去する。
   * 入力: article または引用カードの要素
   * 出力: なし
   * 主な処理内容:
   * 1. 再適用時に古い色が残らないようクラスを外す
   */
  function clearUserLabelClasses (container) {
    container
      .querySelectorAll(`.${FOLLOW_LABEL_CLASS}, .${LIST_LABEL_CLASS}, .${CUSTOM_LABEL_CLASS}`)
      .forEach(element => {
        element.classList.remove(FOLLOW_LABEL_CLASS, LIST_LABEL_CLASS, CUSTOM_LABEL_CLASS);
        element.style.removeProperty('--xtlo-user-label-color');
      });
  }

  /**
   * 対象コンテナ内で特定ユーザーの @userId 表示へ色分類を反映する。
   * 入力: 描画対象コンテナ、ユーザー ID、分類情報
   * 出力: なし
   * 主な処理内容:
   * 1. 対応するプロフィールリンクを探す
   * 2. @userId 表示用 span へ分類クラスを付ける
   */
  function applyLabelToUserInContainer (container, userId, labelType) {
    if (!userId || !labelType) return

    const className = labelType.type === 'follow'
      ? FOLLOW_LABEL_CLASS
      : labelType.type === 'list'
        ? LIST_LABEL_CLASS
        : CUSTOM_LABEL_CLASS;
    const links = container.querySelectorAll('a[href^="/"]');

    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (!isUserProfileLink(href, userId)) {
        continue
      }

      const userIdSpan = findUserIdSpan(link, userId);
      if (userIdSpan) {
        userIdSpan.classList.add(className);
        if (labelType.type === 'custom') {
          userIdSpan.style.setProperty('--xtlo-user-label-color', labelType.color);
        }
      }
    }
  }

  /**
   * React 内部データを読まず、DOM 上の @userId 表示だけへ分類色を反映する。
   * 入力: article 要素、現在設定。
   * 出力: なし。
   * 主な処理内容:
   * 1. 既存の分類クラスを消してから再適用する
   * 2. プロフィールリンク内の @userId 表示を screen name だけで分類する
   */
  function applyUserLabelsFromDom (article, config) {
    clearUserLabelClasses(article);

    const links = article.querySelectorAll('a[href^="/"]');
    for (const link of links) {
      const userId = getUserIdFromProfileLink(link);
      if (!userId) {
        continue
      }

      const labelType = getUserLabelType([userId], config);
      applyLabelToUserInContainer(article, userId, labelType);
    }
  }

  const LABEL_PROCESSED_ATTR = 'data-xtlo-label-processed';

  /**
   * DOM 上の article へユーザー分類色だけを反映する制御オブジェクトを作る。
   * 入力: なし。
   * 出力: processNewArticles / reapplyUserLabels / scheduleProcess / start を持つオブジェクト。
   * 主な処理内容:
   * 1. React 内部データや非表示判定を使わず、表示済み article の @userId だけを着色する
   * 2. MutationObserver の多発を requestAnimationFrame でまとめる
   * 3. 設定変更時は既存 article の分類色だけを再適用する
   */
  function createUserLabelObserver () {
    let pendingRAF = false;
    let observer = null;

    /**
     * 未処理 article へ分類色を反映する。
     * 入力: なし。
     * 出力: なし。
     * 主な処理内容:
     * 1. 未処理 article だけを対象にする
     * 2. 投稿の非表示や X の内部データ参照は行わず、分類色だけを付ける
     */
    function processNewArticles () {
      const articles = document.querySelectorAll(`article:not([${LABEL_PROCESSED_ATTR}])`);
      articles.forEach(article => {
        article.setAttribute(LABEL_PROCESSED_ATTR, 'true');
        applyUserLabelsFromDom(article, config);
      });
    }

    /**
     * 既存 article へ分類色を再適用する。
     * 入力: なし。
     * 出力: なし。
     * 主な処理内容:
     * 1. 設定変更後に分類色のクラスだけを更新する
     * 2. display やスクロール位置に影響する非表示処理は呼ばない
     */
    function reapplyUserLabels () {
      const articles = document.querySelectorAll(`article[${LABEL_PROCESSED_ATTR}]`);
      articles.forEach(article => {
        applyUserLabelsFromDom(article, config);
      });
      console.log(`[X-Observer] 安全モード: ${articles.length} 件のユーザー分類色を再適用しました`);
    }

    /**
     * 新規 article 処理を次の描画タイミングへまとめて予約する。
     * 入力: なし。
     * 出力: なし。
     * 主な処理内容: DOM 変化が連続しても分類色処理を 1 フレームにまとめる
     */
    function scheduleProcess () {
      if (pendingRAF) return
      pendingRAF = true;
      requestAnimationFrame(() => {
        pendingRAF = false;
        processNewArticles();
      });
    }

    /**
     * article 追加だけを監視してユーザー分類色を反映する。
     * 入力: なし。
     * 出力: MutationObserver。
     * 主な処理内容:
     * 1. タイムラインの追加読込を誘発しないようクリックやスクロール操作は行わない
     * 2. 追加された article を検知した場合だけ分類色処理を予約する
     */
    function start () {
      if (observer) return observer

      observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue

            if (
              (node.matches && node.matches('article')) ||
              (node.querySelector && node.querySelector('article'))
            ) {
              scheduleProcess();
              return
            }
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      return observer
    }

    return {
      processNewArticles,
      reapplyUserLabels,
      scheduleProcess,
      start
    }
  }

  /**
   * 現在の設定をエクスポート用オブジェクトへ整形する。
   * 入力: なし。
   * 出力: version 付きのプレーンオブジェクト。
   * 主な処理内容:
   * 1. 配列を複製して参照共有を避ける
   * 2. 設定画面で扱う真偽値設定も一緒に含める
   */
  function createExportData () {
    return {
      version: EXPORT_VERSION,
      mediaFilterLists: [...config.mediaFilterLists],
      hiddenUserIds: [...config.hiddenUserIds],
      followUserIds: [...config.followUserIds],
      listUserIds: [...config.listUserIds],
      customUserCategories: config.customUserCategories.map(category => ({
        id: category.id,
        label: category.label,
        color: category.color,
        userIds: [...category.userIds]
      })),
      hiddenWords: [...config.hiddenWords],
      hiddenStatuses: config.hiddenStatuses.map(entry => ({
        statusId: entry.statusId,
        expiresAt: entry.expiresAt
      })),
      settings: {
        hideUIEnabled: config.hideUIEnabled,
        autoRefreshEnabled: config.autoRefreshEnabled
      }
    }
  }

  /**
   * インポートされた分類色を HEX カラーへ正規化する。
   * 入力: JSON 内の色文字列。
   * 出力: #rrggbb 形式の色。不正値は既定色。
   * 主な処理内容:
   * 1. 旧 v4 の color なし分類を既定色で補完する
   * 2. CSS へ反映する値を HEX 形式へ制限する
   */
  function normalizeCategoryColor (color) {
    const normalized = String(color || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : '#f5c542'
  }

  /**
   * JSON から読み込んだ設定を検証し、内部で使う形式へ正規化する。
   * 入力: JSON.parse 後の値。
   * 出力: 保存可能な設定オブジェクト。
   * 主な処理内容:
   * 1. バージョンと配列構造を検証する
   * 2. 古いバージョンに無かった分類や settings を既定値で補完する
   * 3. ユーザー ID や重複値を正規化する
   */
  function normalizeImportedConfig (raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('設定 JSON のルートはオブジェクトである必要があります')
    }

    if (![1, 2, 3, EXPORT_VERSION].includes(raw.version)) {
      throw new Error(`未対応の設定バージョンです: ${raw.version}`)
    }

    const {
      mediaFilterLists,
      hiddenUserIds,
      hiddenWords,
      hiddenStatuses
    } = raw;
    const followUserIds = raw.version >= 3 ? raw.followUserIds : [];
    const listUserIds = raw.version >= 3 ? raw.listUserIds : [];
    const customUserCategories = raw.version >= 4 ? raw.customUserCategories : [];

    if (
      !Array.isArray(mediaFilterLists) ||
      !Array.isArray(hiddenUserIds) ||
      !Array.isArray(followUserIds) ||
      !Array.isArray(listUserIds) ||
      !Array.isArray(customUserCategories) ||
      !Array.isArray(hiddenWords) ||
      !Array.isArray(hiddenStatuses)
    ) {
      throw new Error('設定 JSON の配列項目が不正です')
    }

    const normalizedStatuses = hiddenStatuses.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`hiddenStatuses[${index}] はオブジェクトである必要があります`)
      }
      if (typeof entry.statusId !== 'string' || !/^\d+$/.test(entry.statusId)) {
        throw new Error(`hiddenStatuses[${index}].statusId が不正です`)
      }
      if (typeof entry.expiresAt !== 'number' || !Number.isFinite(entry.expiresAt)) {
        throw new Error(`hiddenStatuses[${index}].expiresAt が不正です`)
      }

      return {
        statusId: entry.statusId,
        expiresAt: entry.expiresAt
      }
    });


    const normalizedCustomUserCategories = customUserCategories.map((category, index) => {
      if (!category || typeof category !== 'object' || Array.isArray(category)) {
        throw new Error(`customUserCategories[${index}] はオブジェクトである必要があります`)
      }
      if (typeof category.id !== 'string' || !category.id) {
        throw new Error(`customUserCategories[${index}].id が不正です`)
      }
      if (typeof category.label !== 'string' || !category.label.trim()) {
        throw new Error(`customUserCategories[${index}].label が不正です`)
      }
      if (!Array.isArray(category.userIds)) {
        throw new Error(`customUserCategories[${index}].userIds は配列である必要があります`)
      }

      return {
        id: category.id,
        label: category.label.trim(),
        color: normalizeCategoryColor(category.color),
        userIds: [
          ...new Set(
            category.userIds
              .filter(item => typeof item === 'string')
              .map(item => normalizeUserId(item))
              .filter(Boolean)
          )
        ]
      }
    });

    const rawSettings = raw.version >= 2 ? raw.settings : null;
    if (
      rawSettings !== null &&
      (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings))
    ) {
      throw new Error('settings はオブジェクトである必要があります')
    }

    return {
      mediaFilterLists: [
        ...new Set(mediaFilterLists.filter(item => typeof item === 'string'))
      ],
      hiddenUserIds: [
        ...new Set(
          hiddenUserIds
            .filter(item => typeof item === 'string')
            .map(item => normalizeUserId(item))
            .filter(Boolean)
        )
      ],
      followUserIds: [
        ...new Set(
          followUserIds
            .filter(item => typeof item === 'string')
            .map(item => normalizeUserId(item))
            .filter(Boolean)
        )
      ],
      listUserIds: [
        ...new Set(
          listUserIds
            .filter(item => typeof item === 'string')
            .map(item => normalizeUserId(item))
            .filter(Boolean)
        )
      ],
      customUserCategories: normalizedCustomUserCategories.filter(
        (category, index, categories) =>
          categories.findIndex(item => item.id === category.id) === index
      ),
      hiddenWords: [...new Set(hiddenWords.filter(item => typeof item === 'string'))],
      hiddenStatuses: normalizedStatuses.filter(
        (entry, index, entries) =>
          entries.findIndex(item => item.statusId === entry.statusId) === index
      ),
      hideUIEnabled:
        typeof rawSettings?.hideUIEnabled === 'boolean'
          ? rawSettings.hideUIEnabled
          : true,
      autoRefreshEnabled:
        typeof rawSettings?.autoRefreshEnabled === 'boolean'
          ? rawSettings.autoRefreshEnabled
          : true
    }
  }

  /**
   * 現在の設定を JSON ファイルとしてダウンロードさせる。
   * 入力: なし。
   * 出力: なし。
   * 主な処理内容:
   * 1. 設定を整形して Blob 化する
   * 2. 一時的なリンクを作成してダウンロードを開始する
   */
  function exportConfigToFile () {
    const exportText = JSON.stringify(createExportData(), null, 2);
    const blob = new Blob([exportText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    anchor.href = url;
    anchor.download = `xtlo-config-${timestamp}.json`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    console.log('[X-Observer] 設定をエクスポートしました');
    alert('設定をエクスポートしました');
  }

  /**
   * JSON ファイルを選ばせて設定を取り込み、画面へ再反映する。
   * 入力: 再適用コールバックを持つオブジェクト。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. ファイル選択ダイアログを開く
   * 2. JSON を検証して保存する
   * 3. 最新設定を再読込して reapplyFilters を呼ぶ
   */
  async function importConfigFromFile ({ reapplyFilters }) {
    const file = await new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';

      input.addEventListener(
        'change',
        () => {
          resolve(input.files && input.files[0] ? input.files[0] : null);
        },
        { once: true }
      );
      input.click();
    });

    if (!file) {
      console.log('[X-Observer] 設定インポートはキャンセルされました');
      return
    }

    const text = await file.text();

    try {
      const parsed = JSON.parse(text);
      const normalized = normalizeImportedConfig(parsed);

      await replaceConfig(normalized);
      await loadConfig();
      reapplyFilters();

      console.log(
        '[X-Observer] 設定をインポートしました:',
        getConfigSummary(config)
      );
      alert('設定をインポートしました');
    } catch (error) {
      // パース失敗時も理由を明示しておくと、ファイル形式の不一致と実装不具合を切り分けやすい。
      console.error('[X-Observer] 設定インポートに失敗しました:', error);
      alert(`設定インポートに失敗しました: ${error.message}`);
    }
  }

  (function () {

    /**
     * アプリ全体を初期化する。
     * 入力: なし。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. 設定を読み込んでユーザー分類色だけを画面へ反映する
     * 2. 設定ダイアログ、Tampermonkey メニュー、コンソール API を接続する
     * 3. 安全運用中はタイムライン非表示、自動更新、X 標準 UI 変更、React 内部参照を起動しない
     */
    async function init () {
      await loadConfig();
      console.log(
        '[X-Observer] 設定を読み込みました:',
        getConfigSummary(config)
      );

      const userLabelObserver = createUserLabelObserver();

      /**
       * インポート後に設定だけを更新し、ユーザー分類色だけを再適用する。
       * 入力: なし。
       * 出力: Promise<void>
       * 主な処理内容:
       * 1. JSON から設定を取り込む
       * 2. 投稿の非表示や自動更新は再開せず、表示済み article の色だけを更新する
       */
      async function importConfig () {
        await importConfigFromFile({
          reapplyFilters: userLabelObserver.reapplyUserLabels
        });
      }

      applyUserLabelStyles();
      userLabelObserver.processNewArticles();
      userLabelObserver.start();

      const settingsDialog = createSettingsDialog({
        addHiddenStatus,
        removeHiddenStatus,
        addHiddenUser,
        removeHiddenUser,
        clearHiddenUsers,
        addFollowUser,
        removeFollowUser,
        clearFollowUsers,
        addListUser,
        removeListUser,
        clearListUsers,
        addCustomUserCategory,
        removeCustomUserCategory,
        addCustomCategoryUser,
        removeCustomCategoryUser,
        clearCustomCategoryUsers,
        setCustomUserCategoryColor,
        addHiddenWord,
        removeHiddenWord,
        addMediaFilterList,
        removeMediaFilterList,
        exportConfigToFile,
        importConfigFromFile: importConfig,
        reapplyFilters: userLabelObserver.reapplyUserLabels
      });

      registerMenuCommands({
        addHiddenStatus,
        addHiddenUser,
        addFollowUser,
        addListUser,
        addHiddenWord,
        exportConfigToFile,
        importConfigFromFile: importConfig,
        reapplyFilters: userLabelObserver.reapplyUserLabels,
        openSettingsDialog: () => settingsDialog.open()
      });

      // 公開 API は設定管理と分類色の再適用に絞り、X の内部構造や自動読込へ触れる操作は安全モード中は公開しない。
      exposeApi({
        addMediaFilterList,
        removeMediaFilterList,
        addHiddenUser,
        removeHiddenUser,
        addFollowUser,
        removeFollowUser,
        addListUser,
        removeListUser,
        addCustomUserCategory,
        removeCustomUserCategory,
        addCustomCategoryUser,
        removeCustomCategoryUser,
        setCustomUserCategoryColor,
        addHiddenWord,
        removeHiddenWord,
        addHiddenStatus,
        removeHiddenStatus,
        exportConfigToFile,
        importConfigFromFile: importConfig,
        showConfig,
        reapplyFilters: userLabelObserver.reapplyUserLabels,
        openSettingsDialog: () => settingsDialog.open()
      });

      window.addEventListener('pagehide', () => {
        void flushScheduledSaves();
      });
      window.addEventListener('beforeunload', () => {
        void flushScheduledSaves();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          void flushScheduledSaves();
        }
      });

      console.log(
        '[X-Observer] 安全モード: ユーザー分類色のみ有効、非表示・自動更新・X UI 変更は無効です'
      );
      console.log('[X-Observer] 設定操作は window.XObserver から実行できます');
    }

    init();
  })();

})();
