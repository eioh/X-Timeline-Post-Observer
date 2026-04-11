import { exposeApi } from './api/exposeApi.js'
import { setupTimelineObserver } from './dom/observers.js'
import { createProcessor } from './dom/processor.js'
import { createAutoRefreshController } from './features/autoRefresh.js'
import { setupDropdownHideMenu } from './features/dropdownHideMenu.js'
import {
  applyBaseStyles,
  isHideUIEnabled,
  setHideUI
} from './features/hideUi.js'
import { createSettingsDialog } from './features/settingsDialog.js'
import { registerMenuCommands } from './features/tampermonkeyMenu.js'
import {
  addFollowUser,
  addHiddenStatus,
  addHiddenUser,
  addHiddenWord,
  addListUser,
  addMediaFilterList,
  config,
  loadConfig,
  removeFollowUser,
  removeHiddenStatus,
  removeHiddenUser,
  removeHiddenWord,
  removeListUser,
  removeMediaFilterList,
  setAutoRefreshEnabled,
  setHideUIEnabled,
  showConfig
} from './state/configStore.js'
import { exportConfigToFile, importConfigFromFile } from './state/importExport.js'

;(function () {
  'use strict'

  /**
   * 保存済みの UI 非表示設定を画面へ反映して永続化状態と同期させる。
   * 入力: 非表示を有効にするかどうかの真偽値。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 表示状態を即時に切り替える
   * 2. 保存値も同じ真偽値へ更新する
   */
  async function applyHideUISetting (enabled) {
    setHideUI(enabled)
    await setHideUIEnabled(enabled)
  }

  /**
   * 保存済みの自動更新設定を画面挙動へ反映して永続化状態と同期させる。
   * 入力: 自動更新を有効にするかどうかの真偽値、自動更新コントローラー。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. interval の開始または停止を行う
   * 2. 保存値も同じ真偽値へ更新する
   */
  async function applyAutoRefreshSetting (enabled, autoRefresh) {
    autoRefresh.applyEnabledState(enabled)
    await setAutoRefreshEnabled(enabled)
  }

  /**
   * アプリ全体を初期化する。
   * 入力: なし。
   * 出力: Promise<void>
   * 主な処理内容:
   * 1. 設定を読み込んで表示状態へ反映する
   * 2. 監視系とメニュー系の機能を初期化する
   * 3. コンソール API と設定ダイアログを接続する
   */
  async function init () {
    await loadConfig()
    console.log(
      '[X-Observer] 設定を読み込みました:',
      JSON.parse(JSON.stringify(config))
    )

    const processor = createProcessor()
    const autoRefresh = createAutoRefreshController()

    /**
     * インポート後に画面反映と設定依存機能の同期までまとめて行う。
     * 入力: なし。
     * 出力: Promise<void>
     * 主な処理内容:
     * 1. JSON から設定を取り込む
     * 2. UI 非表示と自動更新を最新設定へ再同期する
     */
    async function importConfig () {
      await importConfigFromFile({ reapplyFilters: processor.reapplyFilters })
      setHideUI(config.hideUIEnabled)
      autoRefresh.applyEnabledState(config.autoRefreshEnabled)
    }

    applyBaseStyles()
    setHideUI(config.hideUIEnabled)
    processor.processNewArticles()

    const settingsDialog = createSettingsDialog({
      addHiddenStatus,
      removeHiddenStatus,
      addHiddenUser,
      removeHiddenUser,
      addFollowUser,
      removeFollowUser,
      addListUser,
      removeListUser,
      addHiddenWord,
      removeHiddenWord,
      addMediaFilterList,
      removeMediaFilterList,
      setHideUI,
      setHideUIEnabled,
      applyAutoRefreshEnabled: enabled => autoRefresh.applyEnabledState(enabled),
      setAutoRefreshEnabled,
      exportConfigToFile,
      importConfigFromFile: importConfig,
      reapplyFilters: processor.reapplyFilters
    })

    registerMenuCommands({
      addHiddenStatus,
      addHiddenUser,
      addFollowUser,
      addListUser,
      addHiddenWord,
      exportConfigToFile,
      importConfigFromFile: importConfig,
      reapplyFilters: processor.reapplyFilters,
      openSettingsDialog: () => settingsDialog.open()
    })

    setupDropdownHideMenu({
      addHiddenStatus,
      addHiddenUser,
      addFollowUser,
      addListUser,
      reapplyFilters: processor.reapplyFilters
    })

    setupTimelineObserver({
      scheduleProcess: processor.scheduleProcess,
      handleLateMedia: processor.handleLateMedia
    })

    autoRefresh.applyEnabledState(config.autoRefreshEnabled)

    // 公開 API から設定を変えてもダイアログ表示や保存状態とずれないよう、永続化付きラッパーを公開する。
    exposeApi({
      addMediaFilterList,
      removeMediaFilterList,
      addHiddenUser,
      removeHiddenUser,
      addFollowUser,
      removeFollowUser,
      addListUser,
      removeListUser,
      addHiddenWord,
      removeHiddenWord,
      addHiddenStatus,
      removeHiddenStatus,
      exportConfigToFile,
      importConfigFromFile: importConfig,
      showConfig,
      reapplyFilters: processor.reapplyFilters,
      setHideUI: applyHideUISetting,
      toggleHideUI: () => applyHideUISetting(!isHideUIEnabled()),
      startAutoRefresh: () => applyAutoRefreshSetting(true, autoRefresh),
      stopAutoRefresh: () => applyAutoRefreshSetting(false, autoRefresh),
      toggleAutoRefresh: () =>
        applyAutoRefreshSetting(!config.autoRefreshEnabled, autoRefresh),
      openSettingsDialog: () => settingsDialog.open()
    })

    console.log('[X-Observer] タイムライン監視を開始しました')
    console.log('[X-Observer] 設定操作は window.XObserver から実行できます')
  }

  init()
})()
