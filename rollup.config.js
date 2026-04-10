export default {
  input: 'src/index.js',
  output: {
    file: 'dist/main.js',
    format: 'iife',
    banner: `// ==UserScript==
// @name         X Timeline Post Observer
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  MutationObserverで新着ポストを監視し、フィルタリングする
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
