import { exposeApi } from './api/exposeApi.js'
import { setupTimelineObserver } from './dom/observers.js'
import { createProcessor } from './dom/processor.js'
import { createAutoRefreshController } from './features/autoRefresh.js'
import { setupDropdownHideMenu } from './features/dropdownHideMenu.js'
import { applyBaseStyles, setHideUI, toggleHideUI } from './features/hideUi.js'
import { registerMenuCommands } from './features/tampermonkeyMenu.js'
import {
  addHiddenStatus,
  addHiddenUser,
  addHiddenWord,
  addMediaFilterList,
  config,
  loadConfig,
  removeHiddenStatus,
  removeHiddenUser,
  removeHiddenWord,
  removeMediaFilterList,
  showConfig
} from './state/configStore.js'
import { exportConfigToFile, importConfigFromFile } from './state/importExport.js'

;(function () {
  'use strict'

  /**
   * アプリ全体を初期化する。
   * 入力: なし
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 設定を読み込む
   * 2. 各機能モジュールを組み立てる
   * 3. observer・API・自動更新を開始する
   */
  async function init () {
    await loadConfig()
    console.log(
      '[X-Observer] 設定を読み込みました:',
      JSON.parse(JSON.stringify(config))
    )

    const processor = createProcessor()
    const autoRefresh = createAutoRefreshController()

    // import 後に現在画面へ再適用したいため、processor 完成後にラップ関数を作る。
    async function importConfig () {
      await importConfigFromFile({ reapplyFilters: processor.reapplyFilters })
    }

    // 起動時に必要な UI 初期化と即時反映。
    registerMenuCommands({
      addHiddenStatus,
      addHiddenUser,
      addHiddenWord,
      exportConfigToFile,
      importConfigFromFile: importConfig,
      reapplyFilters: processor.reapplyFilters
    })

    setHideUI(true)
    applyBaseStyles()
    processor.processNewArticles()

    setupDropdownHideMenu({
      addHiddenStatus,
      addHiddenUser,
      reapplyFilters: processor.reapplyFilters
    })

    setupTimelineObserver({
      scheduleProcess: processor.scheduleProcess,
      handleLateMedia: processor.handleLateMedia
    })

    autoRefresh.startAutoRefresh()

    // 公開 API は、内部モジュール参照をそのまま束ねて console から操作可能にする。
    exposeApi({
      addMediaFilterList,
      removeMediaFilterList,
      addHiddenUser,
      removeHiddenUser,
      addHiddenWord,
      removeHiddenWord,
      addHiddenStatus,
      removeHiddenStatus,
      exportConfigToFile,
      importConfigFromFile: importConfig,
      showConfig,
      reapplyFilters: processor.reapplyFilters,
      setHideUI,
      toggleHideUI,
      startAutoRefresh: autoRefresh.startAutoRefresh,
      stopAutoRefresh: autoRefresh.stopAutoRefresh,
      toggleAutoRefresh: autoRefresh.toggleAutoRefresh
    })

    console.log('[X-Observer] タイムライン監視を開始しました')
    console.log('[X-Observer] 設定変更は window.XObserver から行えます')
  }

  init()
})()
