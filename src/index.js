import { exposeApi } from './api/exposeApi.js'
import { createSettingsDialog } from './features/settingsDialog.js'
import { registerMenuCommands } from './features/tampermonkeyMenu.js'
import { applyUserLabelStyles } from './features/userLabelColors.js'
import { createUserLabelObserver } from './features/userLabelObserver.js'
import {
  addCustomCategoryUser,
  addCustomUserCategory,
  addFollowUser,
  addHiddenStatus,
  addHiddenUser,
  addHiddenWord,
  addListUser,
  addMediaFilterList,
  clearCustomCategoryUsers,
  clearFollowUsers,
  clearHiddenUsers,
  clearListUsers,
  config,
  flushScheduledSaves,
  loadConfig,
  removeCustomCategoryUser,
  removeCustomUserCategory,
  removeFollowUser,
  removeHiddenStatus,
  removeHiddenUser,
  removeHiddenWord,
  removeListUser,
  removeMediaFilterList,
  setCustomUserCategoryColor,
  showConfig
} from './state/configStore.js'
import { exportConfigToFile, importConfigFromFile } from './state/importExport.js'
import { getConfigSummary } from './state/configSummary.js'

;(function () {
  'use strict'

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
    await loadConfig()
    console.log(
      '[X-Observer] 設定を読み込みました:',
      getConfigSummary(config)
    )

    const userLabelObserver = createUserLabelObserver()

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
      })
    }

    applyUserLabelStyles()
    userLabelObserver.processNewArticles()
    userLabelObserver.start()

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
    })

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
    })

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
    })

    window.addEventListener('pagehide', () => {
      void flushScheduledSaves()
    })
    window.addEventListener('beforeunload', () => {
      void flushScheduledSaves()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flushScheduledSaves()
      }
    })

    console.log(
      '[X-Observer] 安全モード: ユーザー分類色のみ有効、非表示・自動更新・X UI 変更は無効です'
    )
    console.log('[X-Observer] 設定操作は window.XObserver から実行できます')
  }

  init()
})()
