export default {
  input: 'src/index.js',
  output: {
    file: 'dist/main.js',
    format: 'iife',
    banner: `// ==UserScript==
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
// ==/UserScript==`
  }
}
