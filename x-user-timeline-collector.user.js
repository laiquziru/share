// ==UserScript==
// @name         X 界面增强工具
// @namespace    https://example.local/
// @version      1.2.0
// @description  紧凑毛玻璃面板、页面主题、布局与阅读设置、关键词过滤、已浏览淡化和自动滚动。不包含推文采集、导出、下载或书签同步。
// @author       Codex
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  if (window.__xInterfaceEnhancerActive) return;
  window.__xInterfaceEnhancerActive = true;

  const CONFIG = {
    toolbarId: "x-merged-toolbar",
    notificationId: "xuc-notification-container",
    styleId: "xuc-interface-styles",
    defaultWidth: 900,
    minWidth: 500,
    maxWidth: 1400,
    defaultSeconds: 5,
    minSeconds: 1,
    maxSeconds: 60,
    readMinVisibleMs: 700,
    readScanInterval: 100,
    maxReadIds: 2000,
    maxReadTimelines: 5,
    mutationDelay: 120,
    routeCheckInterval: 800,
    manualScrollPauseMs: 15000,
    bottomConfirmations: 3,
  };

  const KEYS = {
    sidebarVisible: "xuc_sidebar_visible",
    blockedKeywords: "xuc_blocked_keywords",
    tweetWidth: "xuc_tweet_width",
    theme: "xuc_theme",
    fontSize: "xuc_font_size",
    lineHeight: "xuc_line_height",
    serifFont: "xuc_serif",
    focusMode: "xuc_focus_mode",
    dimRead: "xuc_dim_read",
    autoScrollEnabled: "xuc_auto_scroll",
    autoScrollSeconds: "xuc_auto_scroll_seconds",
    autoExpand: "xuc_auto_expand",
  };

  const TWEET = 'article[data-testid="tweet"]';
  const THEMES = ["", "paper", "green", "dim", "oled"];
  const OWNED = `#${CONFIG.toolbarId},#${CONFIG.notificationId}`;

  const RESERVED_PATHS = new Set([
    "home", "explore", "notifications", "messages", "search",
    "compose", "settings", "i", "login", "logout", "signup",
    "tos", "privacy", "share", "intent", "account", "accounts",
    "jobs", "communities", "premium", "about", "download",
  ]);

  function storageGet(key, fallback) {
    try {
      return typeof GM_getValue === "function"
        ? GM_getValue(key, fallback)
        : fallback;
    } catch (error) {
      console.warn("[X 界面增强] 读取设置失败:", key, error);
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
      }
    } catch (error) {
      console.warn("[X 界面增强] 保存设置失败:", key, error);
    }
  }

  function numberOr(value, fallback) {
    if (value === null || value === "" || typeof value === "boolean") {
      return fallback;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clampWidth(value) {
    const n = numberOr(value, CONFIG.defaultWidth);
    return Math.round(
      Math.min(CONFIG.maxWidth, Math.max(CONFIG.minWidth, n)) / 50
    ) * 50;
  }

  function clampSeconds(value) {
    return Math.min(
      CONFIG.maxSeconds,
      Math.max(
        CONFIG.minSeconds,
        Math.round(numberOr(value, CONFIG.defaultSeconds))
      )
    );
  }

  function normalizeFontSize(value) {
    const n = numberOr(value, 0);
    return n >= 10 && n <= 20 ? Math.round(n) : 0;
  }

  function normalizeLineHeight(value) {
    const n = numberOr(value, 0);
    return n >= 0.6 && n <= 2
      ? Math.max(1, Math.round(n * 10) / 10)
      : 0;
  }

  function normalizeKeywords(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const result = [];

    for (const item of value) {
      if (typeof item !== "string") continue;
      const text = item.trim();
      const key = text.toLowerCase();

      if (text && !seen.has(key)) {
        seen.add(key);
        result.push(text);
      }
    }
    return result;
  }

  const savedTheme = storageGet(KEYS.theme, "");

  const state = {
    sidebarVisible: Boolean(storageGet(KEYS.sidebarVisible, false)),
    blockedKeywords: normalizeKeywords(
      storageGet(KEYS.blockedKeywords, [])
    ),
    tweetWidth: clampWidth(
      storageGet(KEYS.tweetWidth, CONFIG.defaultWidth)
    ),
    theme: THEMES.includes(savedTheme) ? savedTheme : "",
    fontSize: normalizeFontSize(storageGet(KEYS.fontSize, 0)),
    lineHeight: normalizeLineHeight(storageGet(KEYS.lineHeight, 0)),
    serifFont: Boolean(storageGet(KEYS.serifFont, false)),
    focusMode: Boolean(storageGet(KEYS.focusMode, false)),
    dimRead: Boolean(storageGet(KEYS.dimRead, false)),
    autoScrollEnabled: Boolean(
      storageGet(KEYS.autoScrollEnabled, false)
    ),
    autoScrollSeconds: clampSeconds(
      storageGet(KEYS.autoScrollSeconds, CONFIG.defaultSeconds)
    ),
    autoExpand: Boolean(storageGet(KEYS.autoExpand, true)),
    openPanel: "",
  };

  let started = false;
  let stylesInjected = false;
  let currentUrl = "";
  let routeTimer = null;
  let domObserver = null;
  let mutationTimer = null;
  let themeTimer = null;
  let saveTimer = null;
  let appliedBody = null;

  const pendingSaves = new Map();
  const dirtyTweets = new Set();
  const trackedTweets = new Set();
  const hiddenTweets = new Set();

  let keywordVersion = 0;
  let lowerKeywords = state.blockedKeywords.map(s => s.toLowerCase());
  const tweetCache = new WeakMap();

  let expansionAttempts = new WeakMap();
  const expandedButtons = new WeakSet();

  const readTimelines = new Map();
  let activeTimelineKey = "";
  let activeReadIds = new Set();
  let readObserver = null;
  let readTimer = null;
  const readObserved = new Map();
  const readCandidates = new Map();

  let autoTimer = null;
  let autoStatus = "已关闭";
  let bottomChecks = 0;
  let lastDocumentHeight = 0;
  let manualPauseUntil = 0;
  let lastWindowScrollY = window.scrollY;

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  function queueSave(name) {
    const value = Array.isArray(state[name])
      ? [...state[name]]
      : state[name];

    pendingSaves.set(KEYS[name], value);
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushSaves, 250);
  }

  function flushSaves() {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    for (const [key, value] of pendingSaves) storageSet(key, value);
    pendingSaves.clear();
  }

  function asElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE
      ? node
      : node?.parentElement;
  }

  function isOwned(node) {
    return Boolean(asElement(node)?.closest(OWNED));
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node && node.textContent !== value) node.textContent = value;
  }

  function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input && input.value !== String(value)) {
      input.value = String(value);
    }
  }

  function showNotification(message, type = "info") {
    if (!document.body) return;

    let container = document.getElementById(CONFIG.notificationId);
    if (!container) {
      container = document.createElement("div");
      container.id = CONFIG.notificationId;
      container.setAttribute("role", "status");
      container.setAttribute("aria-live", "polite");
      document.body.appendChild(container);
    }

    const node = document.createElement("div");
    node.className = `xuc-notice xuc-notice-${type}`;
    node.textContent = message;
    container.appendChild(node);

    window.setTimeout(() => {
      node.remove();
      if (!container.childElementCount) container.remove();
    }, 3200);
  }

  function getTweetId(article) {
    const href = article.querySelector("time")
      ?.closest("a")?.getAttribute("href") || "";
    return href.match(/\/status\/(\d+)/)?.[1] || "";
  }

  function isDetailPage() {
    return /\/status\/\d+/.test(window.location.pathname);
  }

  // ==================== 页面与面板样式 ====================

  function injectStyles() {
    if (stylesInjected || document.getElementById(CONFIG.styleId)) return;

    const css = `
      :root {
        --xuc-tweet-width: 900px;
      }

      [data-testid="sidebarColumn"] {
        display: none !important;
      }

      body:not(.xuc-sidebar-visible) header[role="banner"] {
        display: none !important;
      }

      body:not(.xuc-sidebar-visible) main[role="main"] {
        width: 100% !important;
        max-width: 100% !important;
        align-items: center !important;
      }

      body:not(.xuc-sidebar-visible) main[role="main"] > div,
      body:not(.xuc-sidebar-visible) main[role="main"] > div > div {
        width: 100% !important;
        max-width: 100% !important;
        display: flex !important;
        justify-content: center !important;
      }

      body.xuc-sidebar-visible main[role="main"] {
        align-items: flex-start !important;
      }

      body.xuc-sidebar-visible main[role="main"] > div,
      body.xuc-sidebar-visible main[role="main"] > div > div {
        justify-content: flex-start !important;
      }

      [data-testid="primaryColumn"] {
        width: min(100%, var(--xuc-tweet-width)) !important;
        max-width: var(--xuc-tweet-width) !important;
        margin: 0 auto !important;
        flex-grow: 1 !important;
      }

      [data-testid="primaryColumn"] > div,
      [data-testid="primaryColumn"] > div > div,
      [data-testid="cellInnerDiv"],
      ${TWEET},
      [data-testid="tweetText"] {
        width: 100% !important;
        max-width: none !important;
      }

      [data-testid="tweetText"] {
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
      }

      body.xuc-font-custom [data-testid="tweetText"] {
        font-size: var(--xuc-font-size) !important;
      }

      body.xuc-lh-custom [data-testid="tweetText"] {
        line-height: var(--xuc-line-height) !important;
      }

      body.xuc-serif [data-testid="tweetText"] {
        font-family: Georgia, "Times New Roman", "Source Han Serif SC",
          "Noto Serif SC", STSong, serif !important;
      }

      body.xuc-focus-mode ${TWEET}
        [role="group"]:has([data-testid="reply"]),
      body.xuc-focus-mode ${TWEET} [data-testid="socialContext"] {
        display: none !important;
      }

      ${TWEET}.xuc-keyword-hidden {
        display: none !important;
      }

      ${TWEET}.xuc-read {
        opacity: .55 !important;
        transition: opacity .25s ease !important;
      }

      body.xuc-theme-paper {
        --xuc-bg: #f7f1e3;
        --xuc-elevated: #fbf7ec;
        --xuc-text: #3e3428;
        --xuc-secondary: #746752;
        --xuc-border: #e6dcc6;
        --xuc-link: #075f9f;
        color-scheme: light;
      }

      body.xuc-theme-green {
        --xuc-bg: #cce8cf;
        --xuc-elevated: #daf0dc;
        --xuc-text: #2f3e33;
        --xuc-secondary: #526858;
        --xuc-border: #b4d9ba;
        --xuc-link: #075f9f;
        color-scheme: light;
      }

      body.xuc-theme-dim {
        --xuc-bg: #15202b;
        --xuc-elevated: #1c2732;
        --xuc-text: #f7f9f9;
        --xuc-secondary: #9ba8b5;
        --xuc-border: #38444d;
        --xuc-link: #65b7f3;
        color-scheme: dark;
      }

      body.xuc-theme-oled {
        --xuc-bg: #000;
        --xuc-elevated: #080808;
        --xuc-text: #e7e9ea;
        --xuc-secondary: #91969b;
        --xuc-border: #2f3336;
        --xuc-link: #65b7f3;
        color-scheme: dark;
      }

      body.xuc-themed,
      body.xuc-themed main[role="main"],
      body.xuc-themed header[role="banner"],
      body.xuc-themed [data-testid="primaryColumn"],
      body.xuc-themed [data-testid="cellInnerDiv"],
      body.xuc-themed ${TWEET} {
        background-color: var(--xuc-bg) !important;
      }

      body.xuc-themed [data-xuc-elevated],
      body.xuc-themed [data-xuc-elevated] > div {
        background-color: var(--xuc-elevated) !important;
        backdrop-filter: none !important;
      }

      body.xuc-themed main div,
      body.xuc-themed header[role="banner"] div {
        border-color: var(--xuc-border) !important;
      }

      body.xuc-themed [data-testid="tweetText"],
      body.xuc-themed [data-testid="tweetText"] span,
      body.xuc-themed [data-testid="User-Name"] a,
      body.xuc-themed [data-testid="User-Name"] span,
      body.xuc-themed main h2,
      body.xuc-themed main h2 span,
      body.xuc-themed [data-xuc-elevated] [role="tab"],
      body.xuc-themed [data-xuc-elevated] [role="tab"] span,
      body.xuc-themed header[role="banner"] nav a,
      body.xuc-themed header[role="banner"] nav a span {
        color: var(--xuc-text) !important;
      }

      body.xuc-themed [data-testid="tweetText"] a,
      body.xuc-themed [data-testid="tweetText"] a span {
        color: var(--xuc-link) !important;
      }

      body.xuc-themed ${TWEET} time,
      body.xuc-themed [data-testid="socialContext"],
      body.xuc-themed [data-testid="socialContext"] span {
        color: var(--xuc-secondary) !important;
      }

      /* ---------- 面板主题变量 ---------- */

      #${CONFIG.toolbarId} {
        --glass-rgb: 255, 255, 255;
        --panel-text: #0f1419;
        --panel-muted: #536471;
        --panel-border: rgba(15, 20, 25, .14);
        --panel-control: rgba(15, 20, 25, .045);
        --panel-hover: rgba(15, 20, 25, .085);
        --panel-input: rgba(255, 255, 255, .38);
        --panel-accent: #087ac1;
        --panel-active: rgba(29, 155, 240, .14);
        --panel-highlight: rgba(255, 255, 255, .8);
        --panel-shadow: rgba(15, 20, 25, .18);

        position: fixed !important;
        right: 20px !important;
        bottom: 146px !important;
        z-index: 2147483646 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-end !important;
        color: var(--panel-text) !important;
        font: 12px/1.4 system-ui, -apple-system,
          BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        letter-spacing: normal !important;
        color-scheme: light;
        isolation: isolate;
      }

      #${CONFIG.toolbarId}[data-native-theme="dim"] {
        --glass-rgb: 21, 32, 43;
        --panel-text: #f7f9f9;
        --panel-muted: #a1aebc;
        --panel-border: rgba(139, 152, 165, .25);
        --panel-control: rgba(247, 249, 249, .065);
        --panel-hover: rgba(247, 249, 249, .12);
        --panel-input: rgba(10, 18, 26, .3);
        --panel-accent: #71c2fa;
        --panel-active: rgba(29, 155, 240, .21);
        --panel-highlight: rgba(255, 255, 255, .16);
        --panel-shadow: rgba(0, 0, 0, .34);
        color-scheme: dark;
      }

      #${CONFIG.toolbarId}[data-native-theme="oled"] {
        --glass-rgb: 0, 0, 0;
        --panel-text: #e7e9ea;
        --panel-muted: #a0a5aa;
        --panel-border: rgba(231, 233, 234, .18);
        --panel-control: rgba(231, 233, 234, .075);
        --panel-hover: rgba(231, 233, 234, .13);
        --panel-input: rgba(0, 0, 0, .25);
        --panel-accent: #71c2fa;
        --panel-active: rgba(29, 155, 240, .22);
        --panel-highlight: rgba(255, 255, 255, .19);
        --panel-shadow: rgba(0, 0, 0, .42);
        color-scheme: dark;
      }

      #${CONFIG.toolbarId}[data-native-theme="paper"] {
        --glass-rgb: 247, 241, 227;
        --panel-text: #3e3428;
        --panel-muted: #746752;
        --panel-border: rgba(116, 103, 82, .22);
        --panel-control: rgba(116, 103, 82, .07);
        --panel-hover: rgba(116, 103, 82, .12);
        --panel-input: rgba(251, 247, 236, .4);
        --panel-accent: #075f9f;
        --panel-active: rgba(7, 95, 159, .12);
        --panel-highlight: rgba(255, 252, 240, .85);
        --panel-shadow: rgba(62, 52, 40, .2);
      }

      #${CONFIG.toolbarId}[data-native-theme="green"] {
        --glass-rgb: 204, 232, 207;
        --panel-text: #2f3e33;
        --panel-muted: #526858;
        --panel-border: rgba(82, 104, 88, .22);
        --panel-control: rgba(47, 62, 51, .055);
        --panel-hover: rgba(47, 62, 51, .11);
        --panel-input: rgba(218, 240, 220, .4);
        --panel-accent: #075f9f;
        --panel-active: rgba(7, 95, 159, .12);
        --panel-highlight: rgba(239, 255, 240, .8);
        --panel-shadow: rgba(47, 62, 51, .2);
      }

      #${CONFIG.toolbarId},
      #${CONFIG.toolbarId} * {
        box-sizing: border-box !important;
      }

      #${CONFIG.toolbarId} button,
      #${CONFIG.toolbarId} input {
        font: inherit !important;
      }

      #${CONFIG.toolbarId} :is(button, input):focus-visible {
        outline: 2px solid var(--panel-accent) !important;
        outline-offset: 2px !important;
      }

      #${CONFIG.toolbarId} [hidden] {
        display: none !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-buttons {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn {
        width: 44px !important;
        height: 44px !important;
        padding: 0 !important;
        border: 1px solid var(--panel-border) !important;
        border-radius: 13px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        background: rgba(var(--glass-rgb), .64) !important;
        color: var(--panel-text) !important;
        -webkit-backdrop-filter: blur(22px) saturate(170%);
        backdrop-filter: blur(22px) saturate(170%);
        box-shadow:
          0 4px 16px var(--panel-shadow),
          inset 0 1px 0 var(--panel-highlight);
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn svg {
        width: 23px;
        height: 23px;
        fill: currentColor;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn:hover,
      #${CONFIG.toolbarId} .xuc-toolbar-btn.active {
        background: var(--panel-active) !important;
        border-color: var(--panel-accent) !important;
        color: var(--panel-accent) !important;
      }

      #${CONFIG.toolbarId} .xuc-panel {
        position: absolute !important;
        right: calc(100% + 10px) !important;
        bottom: 0 !important;
        width: min(340px, calc(100vw - 84px)) !important;
        max-height: min(620px, calc(100dvh - 180px)) !important;
        overflow-y: auto !important;
        padding: 13px !important;
        border: 1px solid var(--panel-border) !important;
        border-radius: 15px !important;

        /* 调小 .62 会更加透明，调大则更易阅读。 */
        background: rgba(var(--glass-rgb), .62) !important;
        color: var(--panel-text) !important;

        -webkit-backdrop-filter: blur(30px) saturate(180%) !important;
        backdrop-filter: blur(30px) saturate(180%) !important;
        box-shadow:
          0 16px 42px var(--panel-shadow),
          inset 0 1px 0 var(--panel-highlight),
          inset 0 0 0 1px rgba(255, 255, 255, .035);
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: var(--panel-border) transparent;
        overflow-wrap: anywhere;
      }

      #${CONFIG.toolbarId} .xuc-panel-title {
        margin: 0 0 10px;
        padding-bottom: 9px;
        border-bottom: 1px solid var(--panel-border);
        color: var(--panel-text);
        font-size: 15px;
        font-weight: 700;
        line-height: 1.3;
      }

      #${CONFIG.toolbarId} .xuc-label {
        margin: 10px 0 6px;
        color: var(--panel-muted);
        font-size: 11px;
      }

      #${CONFIG.toolbarId} .xuc-row,
      #${CONFIG.toolbarId} .xuc-head {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      #${CONFIG.toolbarId} .xuc-head {
        justify-content: space-between;
        margin: 10px 0 3px;
      }

      #${CONFIG.toolbarId} .xuc-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
      }

      #${CONFIG.toolbarId} .xuc-themes {
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }

      #${CONFIG.toolbarId} .xuc-panel button {
        min-height: 30px;
        padding: 5px 8px;
        border: 1px solid var(--panel-border);
        border-radius: 8px;
        background: var(--panel-control);
        color: var(--panel-text);
        cursor: pointer;
        line-height: 1.35 !important;
        transition:
          background-color .15s ease,
          border-color .15s ease;
      }

      #${CONFIG.toolbarId} .xuc-themes button {
        padding-inline: 3px;
        white-space: nowrap;
        font-size: 11px !important;
      }

      #${CONFIG.toolbarId} .xuc-panel button:hover {
        background: var(--panel-hover);
        border-color: var(--panel-accent);
      }

      #${CONFIG.toolbarId} .xuc-panel button.active {
        background: var(--panel-active);
        border-color: var(--panel-accent);
        color: var(--panel-accent);
      }

      #${CONFIG.toolbarId} .xuc-panel button.xuc-primary {
        background: #1d9bf0;
        border-color: transparent;
        color: #fff;
      }

      #${CONFIG.toolbarId} .xuc-panel button.xuc-primary:hover {
        background: #168bd8;
      }

      #${CONFIG.toolbarId} input[type="text"],
      #${CONFIG.toolbarId} input[type="number"] {
        min-width: 0;
        min-height: 32px;
        padding: 6px 8px;
        border: 1px solid var(--panel-border);
        border-radius: 8px;
        background: var(--panel-input);
        color: var(--panel-text);
      }

      #${CONFIG.toolbarId} input[type="text"] {
        flex: 1 1 auto;
        width: 0;
      }

      #${CONFIG.toolbarId} input[type="number"] {
        width: 62px;
        text-align: center;
      }

      #${CONFIG.toolbarId} input::placeholder {
        color: var(--panel-muted);
        opacity: .85;
      }

      #${CONFIG.toolbarId} input[type="range"] {
        width: 100%;
        height: 20px;
        margin: 0;
        accent-color: var(--panel-accent);
        cursor: pointer;
      }

      #${CONFIG.toolbarId} output {
        color: var(--panel-accent);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }

      #${CONFIG.toolbarId} .xuc-section {
        margin-top: 11px;
        padding-top: 10px;
        border-top: 1px solid var(--panel-border);
      }

      #${CONFIG.toolbarId} .xuc-hint {
        margin: 6px 0 0;
        color: var(--panel-muted);
        font-size: 11px;
        line-height: 1.4;
      }

      #${CONFIG.toolbarId} .xuc-keywords {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 8px;
      }

      #${CONFIG.toolbarId} .xuc-keywords:empty {
        display: none;
      }

      #${CONFIG.toolbarId} .xuc-keyword {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: 100%;
        padding: 3px 6px;
        border: 1px solid var(--panel-border);
        border-radius: 7px;
        background: var(--panel-control);
      }

      #${CONFIG.toolbarId} .xuc-keyword button {
        width: 22px;
        min-height: 22px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--panel-muted);
        font-size: 17px !important;
      }

      #${CONFIG.toolbarId} .xuc-top-gap {
        margin-top: 9px;
      }

      #${CONFIG.toolbarId} .xuc-no-top {
        margin-top: 0;
      }

      #${CONFIG.notificationId} {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
      }

      #${CONFIG.notificationId} .xuc-notice {
        max-width: min(360px, calc(100vw - 32px));
        padding: 10px 14px;
        border-radius: 10px;
        background: #176ca7;
        color: #fff;
        font: 13px/1.45 system-ui, sans-serif;
        box-shadow: 0 10px 24px rgba(0, 0, 0, .22);
      }

      #${CONFIG.notificationId} .xuc-notice-success {
        background: #238b62;
      }

      #${CONFIG.notificationId} .xuc-notice-warning {
        background: #896000;
      }

      @media(max-width:720px),(max-height:480px) {
        #${CONFIG.toolbarId} {
          right: 12px !important;
          bottom: calc(
            76px + env(safe-area-inset-bottom, 0px)
          ) !important;
        }

        #${CONFIG.toolbarId} .xuc-toolbar-buttons {
          flex-direction: row;
        }

        #${CONFIG.toolbarId} .xuc-panel {
          right: 0 !important;
          bottom: 54px !important;
          width: min(340px, calc(100vw - 24px)) !important;
          max-height: max(
            100px,
            calc(100dvh - 154px - env(safe-area-inset-bottom, 0px))
          ) !important;
          padding: 12px !important;
        }
      }

      @media(pointer:coarse) {
        #${CONFIG.toolbarId} .xuc-panel button,
        #${CONFIG.toolbarId} input[type="text"],
        #${CONFIG.toolbarId} input[type="number"] {
          min-height: 36px;
        }

        #${CONFIG.toolbarId} .xuc-keyword button {
          min-height: 28px;
          width: 28px;
        }
      }

      @media(prefers-reduced-motion:reduce) {
        ${TWEET}.xuc-read,
        #${CONFIG.toolbarId} * {
          transition: none !important;
          animation: none !important;
        }
      }

      @supports not (
        (backdrop-filter: blur(1px)) or
        (-webkit-backdrop-filter: blur(1px))
      ) {
        #${CONFIG.toolbarId} .xuc-panel,
        #${CONFIG.toolbarId} .xuc-toolbar-btn {
          background: rgba(var(--glass-rgb), .96) !important;
        }
      }
    `;

    try {
      if (typeof GM_addStyle === "function") {
        const node = GM_addStyle(css);
        if (node?.nodeType === Node.ELEMENT_NODE) {
          node.id = CONFIG.styleId;
        }
      } else {
        const style = document.createElement("style");
        style.id = CONFIG.styleId;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
      }
      stylesInjected = true;
    } catch (error) {
      console.warn("[X 界面增强] 注入样式失败:", error);
    }
  }

  function applyAppearance() {
    const body = document.body;
    if (!body) return;
    appliedBody = body;

    body.classList.toggle("xuc-sidebar-visible", state.sidebarVisible);
    body.classList.toggle("xuc-themed", Boolean(state.theme));
    body.classList.toggle("xuc-font-custom", state.fontSize > 0);
    body.classList.toggle("xuc-lh-custom", state.lineHeight > 0);
    body.classList.toggle("xuc-serif", state.serifFont);
    body.classList.toggle("xuc-focus-mode", state.focusMode);

    for (const theme of THEMES.filter(Boolean)) {
      body.classList.toggle(`xuc-theme-${theme}`, state.theme === theme);
    }

    const style = document.documentElement.style;
    style.setProperty("--xuc-tweet-width", `${state.tweetWidth}px`);

    if (state.fontSize) {
      style.setProperty("--xuc-font-size", `${state.fontSize}px`);
    } else {
      style.removeProperty("--xuc-font-size");
    }

    if (state.lineHeight) {
      style.setProperty("--xuc-line-height", String(state.lineHeight));
    } else {
      style.removeProperty("--xuc-line-height");
    }

    syncToolbarPalette();
  }

  function syncToolbarPalette() {
    const toolbar = document.getElementById(CONFIG.toolbarId);
    if (!toolbar) return;

    let theme = state.theme;

    if (!theme) {
      const nodes = [
        document.body,
        document.documentElement,
        document.querySelector('[data-testid="primaryColumn"]'),
      ];

      let rgb = null;

      for (const node of nodes) {
        if (!node) continue;

        const color = getComputedStyle(node).backgroundColor;
        const match = color.match(/^rgba?\(([^)]+)\)$/i);
        if (!match) continue;

        const values = match[1].match(/[\d.]+/g)?.map(Number);
        if (!values || values.length < 3) continue;
        if ((values[3] ?? 1) < 0.9) continue;

        rgb = values.slice(0, 3);
        break;
      }

      if (rgb) {
        const palettes = {
          light: [255, 255, 255],
          dim: [21, 32, 43],
          oled: [0, 0, 0],
        };

        let shortest = Infinity;
        theme = "light";

        for (const [name, color] of Object.entries(palettes)) {
          const distance = color.reduce(
            (sum, channel, index) => sum + (channel - rgb[index]) ** 2,
            0
          );

          if (distance < shortest) {
            shortest = distance;
            theme = name;
          }
        }
      } else {
        theme = window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "oled"
          : "light";
      }
    }

    if (toolbar.dataset.nativeTheme !== theme) {
      toolbar.dataset.nativeTheme = theme;
    }
  }

  function scheduleElevatedBars() {
    if (!state.theme || themeTimer !== null || !started) return;

    themeTimer = window.setTimeout(() => {
      themeTimer = null;
      if (!state.theme || !started) return;

      document.querySelectorAll(
        'main h2, main nav[role="navigation"], main [role="tablist"]'
      ).forEach(node => {
        let current = node;

        for (let depth = 0; current && depth < 8; depth++) {
          if (current === document.body) break;
          if (current.hasAttribute("data-xuc-elevated")) break;

          if (getComputedStyle(current).position === "sticky") {
            current.setAttribute("data-xuc-elevated", "1");
            break;
          }
          current = current.parentElement;
        }
      });
    }, 350);
  }

  // ==================== 工具栏 ====================

  const ICONS = {
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 1 0 4.9 12l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/></svg>',
    layout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4zm3 5h10v2H7zm3 5h4v2h-4z"/></svg>',
  };

  function buildToolbar() {
    if (!document.body || document.getElementById(CONFIG.toolbarId)) return;

    const toolbar = document.createElement("div");
    toolbar.id = CONFIG.toolbarId;

    // 固定模板，不将用户输入直接插入 HTML。
    toolbar.innerHTML = `
      <div class="xuc-toolbar-buttons" role="group" aria-label="X 界面增强">
        <button type="button" class="xuc-toolbar-btn"
          data-action="sidebar"
          aria-label="显示或隐藏左侧导航"
          title="显示或隐藏左侧导航">${ICONS.menu}</button>

        <button type="button" class="xuc-toolbar-btn"
          data-panel-toggle="search"
          aria-controls="xuc-search-panel"
          aria-expanded="false"
          aria-label="打开搜索"
          title="搜索">${ICONS.search}</button>

        <button type="button" class="xuc-toolbar-btn"
          data-panel-toggle="layout"
          aria-controls="xuc-layout-panel"
          aria-expanded="false"
          aria-label="打开布局与阅读设置"
          title="布局与阅读">${ICONS.layout}</button>
      </div>

      <section id="xuc-search-panel" class="xuc-panel"
        aria-labelledby="xuc-search-title" hidden>
        <div id="xuc-search-title" class="xuc-panel-title">搜索</div>
        <div class="xuc-row">
          <input id="xuc-search-input" type="text"
            placeholder="搜索 X..." aria-label="搜索 X">
          <button type="button" class="xuc-primary"
            data-action="search">搜索</button>
        </div>
      </section>

      <section id="xuc-layout-panel" class="xuc-panel"
        aria-labelledby="xuc-layout-title" hidden>
        <div id="xuc-layout-title" class="xuc-panel-title">布局与阅读</div>

        <div class="xuc-label">页面主题 · 面板同步配色</div>
        <div class="xuc-grid xuc-themes">
          <button type="button" data-theme="" title="跟随 X 页面">默认</button>
          <button type="button" data-theme="paper">米黄</button>
          <button type="button" data-theme="green">豆绿</button>
          <button type="button" data-theme="dim">Dim</button>
          <button type="button" data-theme="oled">OLED</button>
        </div>

        <div class="xuc-head">
          <label for="xuc-font">正文字号</label>
          <output id="xuc-font-value" for="xuc-font"></output>
        </div>
        <input id="xuc-font" data-field="fontSize"
          type="range" min="9" max="20" step="1"
          aria-label="正文字号，最左侧为网站默认">

        <div class="xuc-head">
          <label for="xuc-line">正文行距</label>
          <output id="xuc-line-value" for="xuc-line"></output>
        </div>
        <input id="xuc-line" data-field="lineHeight"
          type="range" min="9" max="20" step="1"
          aria-label="正文行距，最左侧为网站默认">

        <div class="xuc-grid xuc-top-gap">
          <button type="button" data-toggle="serifFont">衬线字体</button>
          <button type="button" data-toggle="focusMode">聚焦模式</button>
          <button type="button" data-toggle="dimRead">已浏览淡化</button>
          <button type="button" data-toggle="autoExpand">自动展开</button>
        </div>

        <div class="xuc-section">
          <div class="xuc-head xuc-no-top">
            <span>自动滚动</span>
            <button type="button" data-toggle="autoScrollEnabled"
              aria-label="自动滚动"></button>
          </div>
          <div class="xuc-row">
            <label for="xuc-seconds">每隔</label>
            <input id="xuc-seconds" data-field="autoScrollSeconds"
              type="number" min="1" max="60" step="1"
              aria-label="自动滚动间隔，秒">
            <span>秒向下滚动</span>
          </div>
          <p id="xuc-auto-status" class="xuc-hint"></p>
          <p class="xuc-hint">
            仅首页和用户主页；输入、弹窗、后台或上滚时暂停。
          </p>
        </div>

        <div class="xuc-section">
          <div class="xuc-row">
            <input id="xuc-keyword-input" type="text"
              placeholder="添加屏蔽关键词" aria-label="屏蔽关键词">
            <button type="button" class="xuc-primary"
              data-action="add-keyword">添加</button>
          </div>
          <div id="xuc-keywords" class="xuc-keywords"></div>
        </div>

        <div class="xuc-section">
          <div class="xuc-head xuc-no-top">
            <label for="xuc-width">推文宽度</label>
            <output id="xuc-width-value" for="xuc-width"></output>
          </div>
          <input id="xuc-width" data-field="tweetWidth"
            type="range" min="500" max="1400" step="50">
          <div class="xuc-grid xuc-top-gap">
            <button type="button" data-width="600">窄</button>
            <button type="button" data-width="800">中</button>
            <button type="button" data-width="1000">宽</button>
            <button type="button" data-width="1200">超宽</button>
          </div>
        </div>
      </section>
    `;

    toolbar.addEventListener("click", handleToolbarClick);
    toolbar.addEventListener("input", handleToolbarInput);
    toolbar.addEventListener("change", handleToolbarChange);
    toolbar.addEventListener("keydown", handleToolbarKeydown);

    document.body.appendChild(toolbar);
    renderKeywords();
    updateControls();
    syncPanels();
  }

  function updateControls() {
    const toolbar = document.getElementById(CONFIG.toolbarId);
    if (!toolbar) return;

    toolbar.querySelectorAll("[data-toggle]").forEach(button => {
      const enabled = Boolean(state[button.dataset.toggle]);
      button.classList.toggle("active", enabled);
      button.setAttribute("aria-pressed", String(enabled));

      if (button.dataset.toggle === "autoScrollEnabled") {
        const text = enabled ? "开启" : "关闭";
        if (button.textContent !== text) button.textContent = text;
      }
    });

    const sidebar = toolbar.querySelector('[data-action="sidebar"]');
    sidebar.classList.toggle("active", state.sidebarVisible);
    sidebar.setAttribute("aria-pressed", String(state.sidebarVisible));

    toolbar.querySelectorAll("[data-theme]").forEach(button => {
      const active = button.dataset.theme === state.theme;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    toolbar.querySelectorAll("[data-width]").forEach(button => {
      const active = Number(button.dataset.width) === state.tweetWidth;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    const fontText = state.fontSize ? `${state.fontSize}px` : "网站默认";
    const lineText = state.lineHeight
      ? state.lineHeight.toFixed(1)
      : "网站默认";

    setText("xuc-font-value", fontText);
    setText("xuc-line-value", lineText);
    setText("xuc-width-value", `${state.tweetWidth}px`);
    setText("xuc-auto-status", autoStatus);

    setInputValue("xuc-font", state.fontSize || 9);
    setInputValue("xuc-line", state.lineHeight
      ? Math.round(state.lineHeight * 10)
      : 9);
    setInputValue("xuc-width", state.tweetWidth);

    if (document.activeElement?.id !== "xuc-seconds") {
      setInputValue("xuc-seconds", state.autoScrollSeconds);
    }

    toolbar.querySelector("#xuc-font")
      .setAttribute("aria-valuetext", fontText);
    toolbar.querySelector("#xuc-line")
      .setAttribute("aria-valuetext", lineText);

    syncToolbarPalette();
  }

  function syncPanels() {
    const toolbar = document.getElementById(CONFIG.toolbarId);
    if (!toolbar) return;

    for (const name of ["search", "layout"]) {
      const open = state.openPanel === name;
      toolbar.querySelector(`#xuc-${name}-panel`).hidden = !open;

      const button = toolbar.querySelector(
        `[data-panel-toggle="${name}"]`
      );
      button.classList.toggle("active", open);
      button.setAttribute("aria-expanded", String(open));
    }
  }

  function closePanel(restoreFocus = false) {
    const previous = state.openPanel;
    state.openPanel = "";
    syncPanels();

    if (restoreFocus && previous) {
      document.querySelector(
        `#${CONFIG.toolbarId} [data-panel-toggle="${previous}"]`
      )?.focus({ preventScroll: true });
    }
  }

  function togglePanel(name) {
    if (state.openPanel === name) {
      closePanel(true);
      return;
    }

    state.openPanel = name;
    syncToolbarPalette();
    syncPanels();

    const target = name === "search"
      ? document.getElementById("xuc-search-input")
      : document.querySelector('#xuc-layout-panel [data-theme]');

    target?.focus({ preventScroll: true });
  }

  function renderKeywords() {
    const list = document.getElementById("xuc-keywords");
    if (!list) return;

    const fragment = document.createDocumentFragment();

    for (const keyword of state.blockedKeywords) {
      const tag = document.createElement("span");
      tag.className = "xuc-keyword";

      const text = document.createElement("span");
      text.textContent = keyword;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.dataset.removeKeyword = keyword;
      remove.setAttribute("aria-label", `删除关键词：${keyword}`);

      tag.append(text, remove);
      fragment.appendChild(tag);
    }

    list.replaceChildren(fragment);
  }

  function changeKeywords(keywords) {
    state.blockedKeywords = normalizeKeywords(keywords);
    lowerKeywords = state.blockedKeywords.map(s => s.toLowerCase());
    keywordVersion++;

    queueSave("blockedKeywords");
    renderKeywords();
    readCandidates.clear();
    markAllTweets();
  }

  function addKeyword() {
    const input = document.getElementById("xuc-keyword-input");
    const value = input?.value.trim();
    if (!value) return;

    if (lowerKeywords.includes(value.toLowerCase())) {
      showNotification("该关键词已存在", "warning");
      return;
    }

    changeKeywords([...state.blockedKeywords, value]);
    input.value = "";
    input.focus({ preventScroll: true });
  }

  function runSearch() {
    const query = document.getElementById("xuc-search-input")?.value.trim();
    if (!query) return;

    flushSaves();

    const url = new URL("/search", window.location.origin);
    url.searchParams.set("q", query);
    url.searchParams.set("src", "typed_query");
    window.location.assign(url.href);
  }

  function changeSetting(name, value) {
    if (state[name] === value) return;

    state[name] = value;
    queueSave(name);

    if ([
      "sidebarVisible", "tweetWidth", "theme", "fontSize",
      "lineHeight", "serifFont", "focusMode",
    ].includes(name)) {
      applyAppearance();
      refreshReadGeometry();
      scheduleElevatedBars();
    }

    if (name === "dimRead") {
      resetReadTracking();
      syncReadMode();
    }

    if (name === "autoExpand") {
      expansionAttempts = new WeakMap();
      markAllTweets();
    }

    if (name === "autoScrollEnabled" || name === "autoScrollSeconds") {
      restartAutoScroll();
    }

    updateControls();
  }

  function handleToolbarClick(event) {
    event.stopPropagation();
    const button = asElement(event.target)?.closest("button");
    if (!button) return;

    if (button.hasAttribute("data-panel-toggle")) {
      togglePanel(button.dataset.panelToggle);
    } else if (button.hasAttribute("data-theme")) {
      changeSetting("theme", button.dataset.theme);
    } else if (button.hasAttribute("data-width")) {
      changeSetting("tweetWidth", clampWidth(button.dataset.width));
    } else if (button.hasAttribute("data-toggle")) {
      const name = button.dataset.toggle;
      changeSetting(name, !state[name]);
    } else if (button.hasAttribute("data-remove-keyword")) {
      changeKeywords(state.blockedKeywords.filter(
        keyword => keyword !== button.dataset.removeKeyword
      ));
    } else {
      switch (button.dataset.action) {
        case "sidebar":
          changeSetting("sidebarVisible", !state.sidebarVisible);
          break;
        case "search":
          runSearch();
          break;
        case "add-keyword":
          addKeyword();
          break;
      }
    }
  }

  function handleToolbarInput(event) {
    const input = event.target;

    switch (input.dataset.field) {
      case "tweetWidth":
        changeSetting("tweetWidth", clampWidth(input.value));
        break;
      case "fontSize":
        changeSetting("fontSize", Number(input.value) <= 9
          ? 0
          : normalizeFontSize(input.value));
        break;
      case "lineHeight":
        changeSetting("lineHeight", Number(input.value) <= 9
          ? 0
          : normalizeLineHeight(Number(input.value) / 10));
        break;
    }
  }

  function handleToolbarChange(event) {
    if (event.target.dataset.field !== "autoScrollSeconds") return;

    const input = event.target;
    if (!input.value.trim() || !Number.isFinite(input.valueAsNumber)) {
      input.value = String(state.autoScrollSeconds);
      return;
    }

    const value = clampSeconds(input.valueAsNumber);
    input.value = String(value);
    changeSetting("autoScrollSeconds", value);
  }

  function handleToolbarKeydown(event) {
    if (event.isComposing || event.keyCode === 229) return;

    // 防止 X 的页面快捷键干扰面板输入。
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      closePanel(true);
    } else if (event.key === "Enter") {
      if (event.target.id === "xuc-search-input") {
        event.preventDefault();
        runSearch();
      } else if (event.target.id === "xuc-keyword-input") {
        event.preventDefault();
        addKeyword();
      }
    }
  }

  // ==================== 关键词与自动展开 ====================

  function applyTweetFilter(article, id) {
    if (!lowerKeywords.length) {
      hiddenTweets.delete(article);
      article.classList.remove("xuc-keyword-hidden");
      tweetCache.delete(article);
      return;
    }

    const text = (article.textContent || "").toLowerCase();
    const previous = tweetCache.get(article);

    if (
      previous?.id === id &&
      previous.text === text &&
      previous.version === keywordVersion
    ) return;

    const matched = lowerKeywords.some(keyword => text.includes(keyword));
    article.classList.toggle("xuc-keyword-hidden", matched);

    if (matched) hiddenTweets.add(article);
    else hiddenTweets.delete(article);

    tweetCache.set(article, { id, text, version: keywordVersion });
  }

  function autoExpandTweet(article, id) {
    if (!state.autoExpand || hiddenTweets.has(article)) return;

    const attempts = expansionAttempts.get(article);
    const count = attempts?.id === id ? attempts.count : 0;
    if (count >= 2) return;

    const button = article.querySelector(
      '[data-testid="tweet-text-show-more-link"]'
    );

    if (!button || expandedButtons.has(button)) return;

    const href = button.closest("a")?.getAttribute("href");
    if (href && href !== "#") return;
    if (button.getAttribute("aria-disabled") === "true" || button.disabled) {
      return;
    }

    expandedButtons.add(button);
    expansionAttempts.set(article, { id, count: count + 1 });
    button.click();
  }

  function processTweet(article) {
    if (!article.isConnected || !article.matches(TWEET)) {
      untrackTweet(article);
      return;
    }

    trackedTweets.add(article);

    const id = getTweetId(article);
    applyTweetFilter(article, id);
    autoExpandTweet(article, id);
    syncReadArticle(article, id);
  }

  function untrackTweet(article) {
    trackedTweets.delete(article);
    dirtyTweets.delete(article);
    hiddenTweets.delete(article);
    tweetCache.delete(article);
    expansionAttempts.delete(article);
    readCandidates.delete(article);
    readObserved.delete(article);
    readObserver?.unobserve(article);
    article.classList.remove("xuc-read", "xuc-keyword-hidden");
  }

  function collectTweets(node) {
    if (node?.nodeType !== Node.ELEMENT_NODE || isOwned(node)) return;

    if (node.matches(TWEET)) dirtyTweets.add(node);
    node.querySelectorAll(TWEET).forEach(article => dirtyTweets.add(article));
  }

  function markAllTweets() {
    document.querySelectorAll(TWEET).forEach(article => {
      dirtyTweets.add(article);
    });
    scheduleMutationFlush();
  }

  // ==================== 已浏览淡化 ====================

  function getTimelineKey() {
    const url = new URL(window.location.href);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    for (const key of ["src", "s", "t", "ref_src", "ref_url"]) {
      url.searchParams.delete(key);
    }
    url.searchParams.sort();

    const tab = document.querySelector(
      '[data-testid="primaryColumn"] [role="tab"][aria-selected="true"]'
    );

    const tabKey = tab
      ? `${tab.getAttribute("href") || ""}|${tab.textContent?.trim() || ""}`
      : "";

    return `${path}?${url.searchParams.toString()}#${tabKey}`;
  }

  function selectReadTimeline() {
    if (isDetailPage()) return false;

    const key = getTimelineKey();
    if (key === activeTimelineKey) return false;

    const ids = readTimelines.get(key) || new Set();
    readTimelines.delete(key);
    readTimelines.set(key, ids);

    while (readTimelines.size > CONFIG.maxReadTimelines) {
      readTimelines.delete(readTimelines.keys().next().value);
    }

    activeTimelineKey = key;
    activeReadIds = ids;
    return true;
  }

  function rememberRead(id) {
    if (!id || activeReadIds.has(id)) return;

    activeReadIds.add(id);
    while (activeReadIds.size > CONFIG.maxReadIds) {
      activeReadIds.delete(activeReadIds.values().next().value);
    }
  }

  function readEnabledHere() {
    return state.dimRead && !isDetailPage() && !document.hidden;
  }

  function getScrollParents(article) {
    const result = [];

    for (
      let node = article.parentElement;
      node && node !== document.body && node !== document.documentElement;
      node = node.parentElement
    ) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(node).overflowY)) {
        result.push(node);
      }
    }
    return result;
  }

  function getScrollOffset(parents) {
    return window.scrollY + parents.reduce(
      (sum, parent) => sum + parent.scrollTop,
      0
    );
  }

  function getVisibleBounds(parents) {
    let top = 0;
    let bottom = window.innerHeight;
    let left = 0;
    let right = window.innerWidth;

    for (const parent of parents) {
      if (!parent.isConnected) continue;

      const rect = parent.getBoundingClientRect();
      top = Math.max(top, rect.top + parent.clientTop);
      bottom = Math.min(
        bottom,
        rect.top + parent.clientTop + parent.clientHeight
      );
      left = Math.max(left, rect.left + parent.clientLeft);
      right = Math.min(
        right,
        rect.left + parent.clientLeft + parent.clientWidth
      );
    }

    return { top, bottom, left, right };
  }

  function resetReadTracking() {
    readObserver?.disconnect();
    readObserver = null;

    window.clearTimeout(readTimer);
    readTimer = null;

    readObserved.clear();
    readCandidates.clear();

    document.querySelectorAll(`${TWEET}.xuc-read`).forEach(article => {
      article.classList.remove("xuc-read");
    });
  }

  function syncReadMode() {
    if (!state.dimRead || isDetailPage()) {
      if (readObserver || readObserved.size) resetReadTracking();
      return;
    }

    if (!("IntersectionObserver" in window)) return;

    if (!readObserver) {
      readObserver = new IntersectionObserver(handleReadIntersections, {
        root: null,
        threshold: [0, 0.01],
      });
    }

    document.querySelectorAll(TWEET).forEach(article => {
      syncReadArticle(article, getTweetId(article));
    });
  }

  function syncReadArticle(article, id) {
    const enabled = state.dimRead && !isDetailPage();
    const read = Boolean(enabled && id && activeReadIds.has(id));

    article.classList.toggle("xuc-read", read);

    if (
      !enabled || !readObserver || !id || read ||
      hiddenTweets.has(article)
    ) {
      readObserver?.unobserve(article);
      readObserved.delete(article);
      readCandidates.delete(article);
      return;
    }

    const previous = readObserved.get(article);
    if (previous?.id === id) return;

    readObserver.unobserve(article);
    readCandidates.delete(article);
    readObserved.set(article, {
      id,
      parents: getScrollParents(article),
    });
    readObserver.observe(article);
  }

  function handleReadIntersections(entries) {
    if (!readEnabledHere()) return;

    const now = performance.now();

    for (const entry of entries) {
      const article = entry.target;
      const info = readObserved.get(article);

      if (
        !info || !article.isConnected ||
        getTweetId(article) !== info.id
      ) {
        readCandidates.delete(article);
        continue;
      }

      if (
        entry.isIntersecting &&
        entry.intersectionRect.height > 0 &&
        !readCandidates.has(article)
      ) {
        const offset = getScrollOffset(info.parents);
        readCandidates.set(article, {
          ...info,
          since: now,
          startOffset: offset,
          lastOffset: offset,
        });
      }
    }

    scanReadCandidates();
  }

  function scheduleReadScan() {
    if (
      !readEnabledHere() ||
      !readCandidates.size ||
      readTimer !== null
    ) return;

    readTimer = window.setTimeout(() => {
      readTimer = null;
      scanReadCandidates();
    }, CONFIG.readScanInterval);
  }

  function scanReadCandidates() {
    if (!readEnabledHere()) return;

    const now = performance.now();
    const toMark = [];
    const toRemove = [];

    for (const [article, candidate] of readCandidates) {
      if (
        !article.isConnected ||
        getTweetId(article) !== candidate.id ||
        hiddenTweets.has(article)
      ) {
        toRemove.push(article);
        continue;
      }

      const rect = article.getBoundingClientRect();
      const bounds = getVisibleBounds(candidate.parents);
      const offset = getScrollOffset(candidate.parents);

      const movedDown = offset > candidate.lastOffset + 0.5;
      const movedSinceEntry = offset > candidate.startOffset + 2;
      const oldEnough = now - candidate.since >= CONFIG.readMinVisibleMs;

      const hasArea = (
        rect.width > 0 && rect.height > 0 &&
        bounds.bottom > bounds.top &&
        bounds.right > bounds.left
      );

      const above = hasArea && rect.bottom <= bounds.top + 1;
      const visible = (
        hasArea &&
        rect.bottom > bounds.top && rect.top < bounds.bottom &&
        rect.right > bounds.left && rect.left < bounds.right
      );

      if (above && movedDown && movedSinceEntry && oldEnough) {
        toMark.push([article, candidate.id]);
        toRemove.push(article);
      } else if (!visible) {
        toRemove.push(article);
      } else {
        candidate.lastOffset = offset;
      }
    }

    for (const article of toRemove) readCandidates.delete(article);

    // 批量读取完成后再修改外观。
    for (const [article, id] of toMark) {
      rememberRead(id);
      article.classList.add("xuc-read");
      readObserver?.unobserve(article);
      readObserved.delete(article);
    }
  }

  function refreshReadGeometry() {
    if (!state.dimRead || !readObserver) return;

    readCandidates.clear();

    for (const [article, info] of readObserved) {
      if (!article.isConnected) continue;

      info.parents = getScrollParents(article);
      readObserver.unobserve(article);
      readObserver.observe(article);
    }
  }

  // ==================== 自动滚动 ====================

  function canAutoScrollHere() {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/home") return true;
    if (isDetailPage()) return false;

    const parts = path.split("/").filter(Boolean);
    return (
      parts.length === 1 &&
      /^[A-Za-z0-9_]{1,15}$/.test(parts[0]) &&
      !RESERVED_PATHS.has(parts[0].toLowerCase())
    );
  }

  function getDocumentHeight() {
    const root = document.scrollingElement || document.documentElement;
    return Math.max(root.scrollHeight, document.body?.scrollHeight || 0);
  }

  function getAutoPauseReason() {
    if (document.hidden) return "后台暂停";
    if (state.openPanel) return "面板打开，已暂停";
    if (document.fullscreenElement) return "全屏期间暂停";

    const active = document.activeElement;
    if (
      active &&
      (active.matches("input,textarea,select") || active.isContentEditable)
    ) {
      return "输入期间暂停";
    }

    const visibleDialog = [...document.querySelectorAll(
      '[role="dialog"],[aria-modal="true"]'
    )].some(node => node.getClientRects().length > 0);

    if (visibleDialog) return "弹窗打开，已暂停";
    if (Date.now() < manualPauseUntil) return "手动上滚后暂停 15 秒";

    return "";
  }

  function setAutoStatus(text) {
    if (autoStatus === text) return;
    autoStatus = text;
    setText("xuc-auto-status", text);
  }

  function stopAutoTimer() {
    if (autoTimer !== null) {
      window.clearTimeout(autoTimer);
      autoTimer = null;
    }
  }

  function scheduleAutoTick(delay = state.autoScrollSeconds * 1000) {
    if (autoTimer !== null || !started) return;

    autoTimer = window.setTimeout(() => {
      autoTimer = null;
      autoScrollTick();
    }, delay);
  }

  function restartAutoScroll() {
    stopAutoTimer();
    bottomChecks = 0;
    lastDocumentHeight = getDocumentHeight();

    if (!state.autoScrollEnabled) {
      setAutoStatus("已关闭");
      return;
    }

    if (!canAutoScrollHere()) {
      setAutoStatus("当前页面不启用自动滚动");
      return;
    }

    setAutoStatus("等待下一次滚动");
    scheduleAutoTick();
  }

  function autoScrollTick() {
    if (!started || !state.autoScrollEnabled) return;

    if (currentUrl !== window.location.href) {
      checkRoute();
      return;
    }

    if (!canAutoScrollHere()) {
      setAutoStatus("当前页面不启用自动滚动");
      return;
    }

    const reason = getAutoPauseReason();
    if (reason) {
      bottomChecks = 0;
      setAutoStatus(reason);
      scheduleAutoTick();
      return;
    }

    const height = getDocumentHeight();
    const maxY = Math.max(0, height - window.innerHeight);
    const atBottom = window.scrollY >= maxY - 6;

    if (atBottom) {
      bottomChecks = height > lastDocumentHeight + 4
        ? 1
        : bottomChecks + 1;
      lastDocumentHeight = height;

      if (bottomChecks >= CONFIG.bottomConfirmations) {
        setAutoStatus("底部暂无新内容；关闭再开启可继续");
        showNotification(
          "底部暂未加载新内容，自动滚动已暂停",
          "success"
        );
        return;
      }

      setAutoStatus(
        `等待底部加载（${bottomChecks}/${CONFIG.bottomConfirmations}）`
      );
      scheduleAutoTick();
      return;
    }

    bottomChecks = 0;
    lastDocumentHeight = height;
    setAutoStatus(`运行中：每 ${state.autoScrollSeconds} 秒滚动`);

    window.scrollBy({
      top: Math.max(300, Math.floor(window.innerHeight * 0.8)),
      behavior: reducedMotion.matches ? "auto" : "smooth",
    });

    scheduleAutoTick();
  }

  // ==================== DOM 增量监听 ====================

  function scheduleMutationFlush() {
    if (!started || mutationTimer !== null) return;

    mutationTimer = window.setTimeout(
      flushMutations,
      CONFIG.mutationDelay
    );
  }

  function handleMutations(records) {
    let relevant = false;

    for (const record of records) {
      if (isOwned(record.target)) continue;

      const target = asElement(record.target);
      if (!target) continue;

      const article = target.closest(TWEET);
      if (article) {
        dirtyTweets.add(article);
        relevant = true;
      }

      if (
        record.type === "attributes" &&
        record.attributeName === "aria-selected" &&
        target.matches('[role="tab"]')
      ) {
        relevant = true;
      }

      if (record.type !== "childList") continue;

      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE || isOwned(node)) continue;
        collectTweets(node);
        relevant = true;
      }

      for (const node of record.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        if (
          !isOwned(node) ||
          node.id === CONFIG.toolbarId ||
          node.querySelector?.(`#${CONFIG.toolbarId}`)
        ) {
          relevant = true;
        }
      }
    }

    if (relevant) scheduleMutationFlush();
  }

  function flushMutations() {
    mutationTimer = null;
    if (!started || !document.body) return;

    checkRoute();

    for (const article of trackedTweets) {
      if (!article.isConnected || !article.matches(TWEET)) {
        untrackTweet(article);
      }
    }

    if (selectReadTimeline()) {
      resetReadTracking();
      syncReadMode();
    }

    const pending = [...dirtyTweets];
    dirtyTweets.clear();

    for (const article of pending) processTweet(article);

    scheduleElevatedBars();
  }

  function startDomObserver() {
    domObserver?.disconnect();
    domObserver = new MutationObserver(handleMutations);

    // 监听稳定根节点；不观察 class/style，避免自身样式更新循环。
    domObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["href", "data-testid", "aria-selected"],
    });
  }

  // ==================== 路由与生命周期 ====================

  function checkRoute() {
    if (!started || !document.body) return;

    if (appliedBody !== document.body) applyAppearance();

    if (currentUrl !== window.location.href) {
      currentUrl = window.location.href;
      closePanel(false);
      manualPauseUntil = 0;
      lastWindowScrollY = window.scrollY;

      resetReadTracking();
      selectReadTimeline();
      syncReadMode();
      markAllTweets();
      restartAutoScroll();
      scheduleElevatedBars();
    }

    if (!document.getElementById(CONFIG.toolbarId)) {
      buildToolbar();
    }

    syncToolbarPalette();
  }

  function handleScroll(event) {
    const y = window.scrollY;

    if (
      event.target === document ||
      event.target === document.documentElement ||
      event.target === document.body
    ) {
      if (
        y < lastWindowScrollY - 8 &&
        state.autoScrollEnabled &&
        canAutoScrollHere()
      ) {
        manualPauseUntil = Date.now() + CONFIG.manualScrollPauseMs;
      }
      lastWindowScrollY = y;
    }

    scheduleReadScan();
  }

  function handleWheel(event) {
    if (
      event.deltaY < 0 &&
      !isOwned(event.target) &&
      state.autoScrollEnabled &&
      canAutoScrollHere()
    ) {
      manualPauseUntil = Date.now() + CONFIG.manualScrollPauseMs;
    }
  }

  function handleVisibilityChange() {
    readCandidates.clear();

    if (document.hidden) {
      flushSaves();
    } else {
      checkRoute();
      refreshReadGeometry();
    }
  }

  function handleResize() {
    refreshReadGeometry();
  }

  function handleOutsideClick(event) {
    if (state.openPanel && !isOwned(event.target)) closePanel(false);
  }

  function handleEscape(event) {
    if (
      event.key === "Escape" &&
      !event.isComposing &&
      state.openPanel
    ) {
      event.preventDefault();
      event.stopPropagation();
      closePanel(true);
    }
  }

  function start() {
    if (started || !document.body) return;
    started = true;

    injectStyles();
    applyAppearance();
    buildToolbar();

    currentUrl = window.location.href;
    lastWindowScrollY = window.scrollY;

    selectReadTimeline();
    syncReadMode();
    startDomObserver();
    markAllTweets();
    scheduleElevatedBars();
    restartAutoScroll();

    routeTimer = window.setInterval(
      checkRoute,
      CONFIG.routeCheckInterval
    );

    document.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true,
    });
    document.addEventListener("wheel", handleWheel, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("click", handleOutsideClick);
    document.addEventListener("keydown", handleEscape, true);
    window.addEventListener("resize", handleResize, { passive: true });
    window.addEventListener("popstate", checkRoute);
    window.addEventListener("hashchange", checkRoute);
  }

  function suspend() {
    if (!started) return;
    started = false;

    flushSaves();
    stopAutoTimer();
    resetReadTracking();

    domObserver?.disconnect();
    domObserver = null;

    window.clearInterval(routeTimer);
    window.clearTimeout(mutationTimer);
    window.clearTimeout(themeTimer);

    routeTimer = null;
    mutationTimer = null;
    themeTimer = null;
    dirtyTweets.clear();

    document.removeEventListener("scroll", handleScroll, true);
    document.removeEventListener("wheel", handleWheel);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.removeEventListener("click", handleOutsideClick);
    document.removeEventListener("keydown", handleEscape, true);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("popstate", checkRoute);
    window.removeEventListener("hashchange", checkRoute);
  }

  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", start);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
