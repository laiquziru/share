// ==UserScript==
// @name         X 界面增强工具
// @namespace    https://example.local/
// @version      1.3.0
// @description  紧凑毛玻璃面板、主题、阅读预设、关键词折叠、媒体折叠、阅读位置返回、快捷键、拖动吸边及自动滚动。不包含推文采集、导出、下载或书签同步。
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

  const C = {
    toolbarId: "x-merged-toolbar",
    notificationId: "xuc-notifications",
    styleId: "xuc-styles-v130",
    mutationDelay: 120,
    routeInterval: 800,
    manualPauseMs: 15000,
    collapseDelay: 8000,
    readMinMs: 700,
    maxReadIds: 2000,
    maxTimelines: 5,
    bottomChecks: 3,
  };

  const TWEET = 'article[data-testid="tweet"]';
  const MEDIA = '[data-testid="tweetPhoto"],[data-testid="videoPlayer"]';
  const OWN = `#${C.toolbarId},#${C.notificationId},[data-xuc-ui]`;
  const THEMES = ["", "paper", "green", "dim", "oled"];
  const MEDIA_MODES = ["normal", "limit", "collapse"];

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
    autoExpand: "xuc_auto_expand",
    autoScrollEnabled: "xuc_auto_scroll",
    autoScrollSeconds: "xuc_auto_scroll_seconds",
    scrollPercent: "xuc_scroll_percent",
    hoverPause: "xuc_hover_pause",
    mediaMode: "xuc_media_mode",
    mediaMaxHeight: "xuc_media_max_height",
    autoCollapse: "xuc_toolbar_auto_collapse",
    toolbarPosition: "xuc_toolbar_position",
    shortcutsEnabled: "xuc_shortcuts_enabled",
    shortcuts: "xuc_shortcuts",
  };

  const DEFAULT_SHORTCUTS = {
    next: "Alt+J",
    previous: "Alt+K",
    scroll: "Alt+S",
  };

  const RESERVED = new Set([
    "home", "explore", "notifications", "messages", "search",
    "compose", "settings", "i", "login", "logout", "signup",
    "tos", "privacy", "share", "intent", "account", "accounts",
    "jobs", "communities", "premium", "about", "download",
  ]);

  const PRESETS = {
    text: {
      label: "纯文字",
      values: {
        mediaMode: "collapse",
        focusMode: true,
        fontSize: 16,
        lineHeight: 1.6,
        tweetWidth: 800,
      },
    },
    comfort: {
      label: "舒适阅读",
      values: {
        mediaMode: "limit",
        mediaMaxHeight: 480,
        focusMode: false,
        fontSize: 18,
        lineHeight: 1.7,
        tweetWidth: 850,
      },
    },
    quick: {
      label: "快速浏览",
      values: {
        mediaMode: "limit",
        mediaMaxHeight: 260,
        focusMode: true,
        fontSize: 14,
        lineHeight: 1.3,
        tweetWidth: 1000,
      },
    },
  };

  function getValue(key, fallback) {
    try {
      return typeof GM_getValue === "function"
        ? GM_getValue(key, fallback)
        : fallback;
    } catch (error) {
      console.warn("[X 界面增强] 读取设置失败", key, error);
      return fallback;
    }
  }

  function setValue(key, value) {
    try {
      if (typeof GM_setValue === "function") GM_setValue(key, value);
    } catch (error) {
      console.warn("[X 界面增强] 保存设置失败", key, error);
    }
  }

  function numeric(value, fallback) {
    if (value === "" || value === null || typeof value === "boolean") {
      return fallback;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max, fallback, step = 1) {
    const n = numeric(value, fallback);
    return Math.min(max, Math.max(min, Math.round(n / step) * step));
  }

  function normalizeKeywords(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();

    return value.filter(item => {
      if (typeof item !== "string" || !item.trim()) return false;
      const key = item.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(item => item.trim());
  }

  function normalizePosition(value) {
    return {
      side: value?.side === "left" ? "left" : "right",
      y: clamp(value?.y, 0, 1, 0.7, 0.001),
    };
  }

  function normalizeShortcuts(value) {
    const result = { ...DEFAULT_SHORTCUTS };
    if (!value || typeof value !== "object") return result;

    for (const key of Object.keys(result)) {
      if (typeof value[key] === "string" && value[key].length < 50) {
        result[key] = value[key];
      }
    }
    return result;
  }

  const storedTheme = getValue(KEYS.theme, "");
  const storedMedia = getValue(KEYS.mediaMode, "normal");
  const storedFont = numeric(getValue(KEYS.fontSize, 0), 0);
  const storedLine = numeric(getValue(KEYS.lineHeight, 0), 0);

  const state = {
    sidebarVisible: Boolean(getValue(KEYS.sidebarVisible, false)),
    blockedKeywords: normalizeKeywords(
      getValue(KEYS.blockedKeywords, [])
    ),
    tweetWidth: clamp(getValue(KEYS.tweetWidth, 900), 500, 1400, 900, 50),
    theme: THEMES.includes(storedTheme) ? storedTheme : "",
    fontSize: storedFont >= 10 && storedFont <= 20
      ? Math.round(storedFont)
      : 0,
    lineHeight: storedLine >= 0.6 && storedLine <= 2
      ? clamp(storedLine, 1, 2, 1.5, 0.1)
      : 0,
    serifFont: Boolean(getValue(KEYS.serifFont, false)),
    focusMode: Boolean(getValue(KEYS.focusMode, false)),
    dimRead: Boolean(getValue(KEYS.dimRead, false)),
    autoExpand: Boolean(getValue(KEYS.autoExpand, true)),
    autoScrollEnabled: Boolean(getValue(KEYS.autoScrollEnabled, false)),
    autoScrollSeconds: clamp(
      getValue(KEYS.autoScrollSeconds, 5), 1, 60, 5
    ),
    scrollPercent: clamp(getValue(KEYS.scrollPercent, 80), 20, 100, 80, 5),
    hoverPause: Boolean(getValue(KEYS.hoverPause, false)),
    mediaMode: MEDIA_MODES.includes(storedMedia) ? storedMedia : "normal",
    mediaMaxHeight: clamp(
      getValue(KEYS.mediaMaxHeight, 400), 160, 800, 400, 20
    ),
    autoCollapse: Boolean(getValue(KEYS.autoCollapse, true)),
    toolbarPosition: normalizePosition(
      getValue(KEYS.toolbarPosition, null)
    ),
    shortcutsEnabled: Boolean(getValue(KEYS.shortcutsEnabled, true)),
    shortcuts: normalizeShortcuts(getValue(KEYS.shortcuts, null)),
    openPanel: "",
  };

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(hover:hover) and (pointer:fine)");

  let started = false;
  let stylesInjected = false;
  let appliedBody = null;
  let currentUrl = "";
  let routeTimer = null;
  let observer = null;
  let mutationTimer = null;
  let elevatedTimer = null;
  let saveTimer = null;
  let panelFrame = null;

  const pendingSaves = new Map();
  const dirtyTweets = new Set();
  const trackedTweets = new Set();
  const tweetData = new WeakMap();

  let keywordVersion = 0;
  let lowerKeywords = state.blockedKeywords.map(s => s.toLowerCase());
  const revealedIds = new Map();

  const expandedButtons = new WeakSet();
  let expandAttempts = new WeakMap();

  let timelineKey = "";
  let activeReadIds = new Set();
  const timelineReads = new Map();
  const returnPositions = new Map();

  let readObserver = null;
  let readTimer = null;
  const readObserved = new Map();
  const readCandidates = new Map();

  let autoTimer = null;
  let autoNextAt = 0;
  let autoBottomPaused = false;
  let autoBottomCount = 0;
  let autoLastHeight = 0;
  let autoStatus = "已关闭";
  let manualPauseUntil = 0;
  let hoveredTweet = null;

  let toolbarCollapsed = false;
  let collapseTimer = null;
  let toolbarHovered = false;
  let drag = null;
  let suppressHandleClickUntil = 0;

  let restoreToken = 0;
  let keyboardTweet = null;
  let keyboardTimer = null;
  let lastShortcutAt = 0;

  function elementOf(node) {
    return node?.nodeType === Node.ELEMENT_NODE
      ? node
      : node?.parentElement;
  }

  function isOwn(node) {
    return Boolean(elementOf(node)?.closest(OWN));
  }

  function ownNode(tag, className) {
    const node = document.createElement(tag);
    node.dataset.xucUi = "true";
    if (className) node.className = className;
    return node;
  }

  function queueSave(name) {
    pendingSaves.set(KEYS[name], JSON.parse(JSON.stringify(state[name])));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSaves, 250);
  }

  function flushSaves() {
    clearTimeout(saveTimer);
    saveTimer = null;
    for (const [key, value] of pendingSaves) setValue(key, value);
    pendingSaves.clear();
  }

  function putBounded(map, key, value, limit) {
    map.delete(key);
    map.set(key, value);
    while (map.size > limit) map.delete(map.keys().next().value);
  }

  function setText(id, text) {
    const node = document.getElementById(id);
    if (node && node.textContent !== text) node.textContent = text;
  }

  function setInput(id, value) {
    const node = document.getElementById(id);
    if (node && node.value !== String(value)) node.value = String(value);
  }

  function notify(text) {
    if (!document.body) return;

    let container = document.getElementById(C.notificationId);
    if (!container) {
      container = document.createElement("div");
      container.id = C.notificationId;
      container.setAttribute("role", "status");
      container.setAttribute("aria-live", "polite");
      document.body.appendChild(container);
    }

    const item = document.createElement("div");
    item.textContent = text;
    container.appendChild(item);

    setTimeout(() => {
      item.remove();
      if (!container.childElementCount) container.remove();
    }, 3200);
  }

  function tweetId(article) {
    const href = article.querySelector("time")
      ?.closest("a")?.getAttribute("href") || "";
    return href.match(/\/status\/(\d+)/)?.[1] || "";
  }

  function isDetail() {
    return /\/status\/\d+/.test(location.pathname);
  }

  function isEditing(target = document.activeElement) {
    const node = elementOf(target);
    return Boolean(
      node &&
      (
        node.closest("input,textarea,select") ||
        node.isContentEditable
      )
    );
  }

  function hasDialog() {
    return [...document.querySelectorAll(
      '[role="dialog"],[aria-modal="true"]'
    )].some(node => !isOwn(node) && node.getClientRects().length > 0);
  }

  // ==================== 样式 ====================

  function injectStyles() {
    if (stylesInjected) return;

    const css = `
      :root {
        --xuc-tweet-width: 900px;
        --xuc-media-height: 400px;
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

      ${TWEET}.xuc-read {
        opacity: .55 !important;
        transition: opacity .2s ease;
      }

      ${TWEET}.xuc-keyboard-current {
        outline: 2px solid #1d9bf0 !important;
        outline-offset: -2px !important;
      }

      /* 关键词折叠只处理 article 内部，不覆写虚拟列表 cell。 */
      ${TWEET}.xuc-filter-folded > :not(.xuc-filter-notice) {
        display: none !important;
      }

      .xuc-filter-notice {
        display: flex !important;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 10px 12px;
        margin: 4px 0;
        border: 1px solid rgba(128,128,128,.3);
        border-radius: 10px;
        background: rgba(128,128,128,.08);
        color: inherit;
        font: 12px/1.5 system-ui,sans-serif;
        box-sizing: border-box;
      }

      .xuc-filter-notice > span {
        flex: 1 1 160px;
        overflow-wrap: anywhere;
      }

      .xuc-filter-notice button,
      .xuc-media-control {
        border: 1px solid rgba(128,128,128,.35);
        border-radius: 8px;
        background: rgba(128,128,128,.1);
        color: inherit;
        padding: 5px 9px;
        font: 12px/1.5 system-ui,sans-serif;
        cursor: pointer;
      }

      .xuc-media-control {
        display: block;
        position: relative;
        z-index: 2;
        max-width: 100%;
        margin: 5px 0;
        text-align: left;
      }

      .xuc-media-hidden {
        display: none !important;
      }

      .xuc-media-limited {
        max-height: var(--xuc-media-height) !important;
        overflow: hidden !important;
      }

      .xuc-media-limited video {
        max-height: var(--xuc-media-height) !important;
        object-fit: contain !important;
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
      body.xuc-themed header[role="banner"] nav a span,
      body.xuc-themed .xuc-filter-notice,
      body.xuc-themed .xuc-media-control {
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

      /* ---------- 紧凑毛玻璃工具栏 ---------- */

      #${C.toolbarId} {
        --glass-rgb: 255,255,255;
        --panel-text: #0f1419;
        --panel-muted: #536471;
        --panel-border: rgba(15,20,25,.14);
        --panel-control: rgba(15,20,25,.045);
        --panel-hover: rgba(15,20,25,.085);
        --panel-input: rgba(255,255,255,.38);
        --panel-accent: #087ac1;
        --panel-active: rgba(29,155,240,.14);
        --panel-highlight: rgba(255,255,255,.8);
        --panel-shadow: rgba(15,20,25,.18);

        position: fixed !important;
        width: 44px !important;
        z-index: 2147483646 !important;
        color: var(--panel-text) !important;
        font: 12px/1.4 system-ui,-apple-system,
          BlinkMacSystemFont,"Segoe UI",sans-serif !important;
        letter-spacing: normal !important;
        color-scheme: light;
        isolation: isolate;
      }

      #${C.toolbarId}[data-palette="dim"] {
        --glass-rgb: 21,32,43;
        --panel-text: #f7f9f9;
        --panel-muted: #a1aebc;
        --panel-border: rgba(139,152,165,.25);
        --panel-control: rgba(247,249,249,.065);
        --panel-hover: rgba(247,249,249,.12);
        --panel-input: rgba(10,18,26,.3);
        --panel-accent: #71c2fa;
        --panel-active: rgba(29,155,240,.21);
        --panel-highlight: rgba(255,255,255,.16);
        --panel-shadow: rgba(0,0,0,.34);
        color-scheme: dark;
      }

      #${C.toolbarId}[data-palette="oled"] {
        --glass-rgb: 0,0,0;
        --panel-text: #e7e9ea;
        --panel-muted: #a0a5aa;
        --panel-border: rgba(231,233,234,.18);
        --panel-control: rgba(231,233,234,.075);
        --panel-hover: rgba(231,233,234,.13);
        --panel-input: rgba(0,0,0,.25);
        --panel-accent: #71c2fa;
        --panel-active: rgba(29,155,240,.22);
        --panel-highlight: rgba(255,255,255,.19);
        --panel-shadow: rgba(0,0,0,.42);
        color-scheme: dark;
      }

      #${C.toolbarId}[data-palette="paper"] {
        --glass-rgb: 247,241,227;
        --panel-text: #3e3428;
        --panel-muted: #746752;
        --panel-border: rgba(116,103,82,.22);
        --panel-control: rgba(116,103,82,.07);
        --panel-hover: rgba(116,103,82,.12);
        --panel-input: rgba(251,247,236,.4);
        --panel-accent: #075f9f;
        --panel-active: rgba(7,95,159,.12);
        --panel-highlight: rgba(255,252,240,.85);
        --panel-shadow: rgba(62,52,40,.2);
      }

      #${C.toolbarId}[data-palette="green"] {
        --glass-rgb: 204,232,207;
        --panel-text: #2f3e33;
        --panel-muted: #526858;
        --panel-border: rgba(82,104,88,.22);
        --panel-control: rgba(47,62,51,.055);
        --panel-hover: rgba(47,62,51,.11);
        --panel-input: rgba(218,240,220,.4);
        --panel-accent: #075f9f;
        --panel-active: rgba(7,95,159,.12);
        --panel-highlight: rgba(239,255,240,.8);
        --panel-shadow: rgba(47,62,51,.2);
      }

      #${C.toolbarId},
      #${C.toolbarId} * {
        box-sizing: border-box !important;
      }

      #${C.toolbarId} button,
      #${C.toolbarId} input {
        font: inherit !important;
      }

      #${C.toolbarId} [hidden] {
        display: none !important;
      }

      #${C.toolbarId} :is(button,input,summary):focus-visible,
      [data-xuc-ui]:focus-visible {
        outline: 2px solid #1d9bf0 !important;
        outline-offset: 2px !important;
      }

      #${C.toolbarId} .xuc-buttons,
      #${C.toolbarId} .xuc-actions {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      #${C.toolbarId}.xuc-collapsed .xuc-actions {
        display: none;
      }

      #${C.toolbarId} .xuc-tool {
        width: 44px !important;
        height: 44px !important;
        padding: 0 !important;
        border: 1px solid var(--panel-border) !important;
        border-radius: 13px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        background: rgba(var(--glass-rgb),.64) !important;
        color: var(--panel-text) !important;
        -webkit-backdrop-filter: blur(22px) saturate(170%);
        backdrop-filter: blur(22px) saturate(170%);
        box-shadow:
          0 4px 16px var(--panel-shadow),
          inset 0 1px 0 var(--panel-highlight);
      }

      #${C.toolbarId} .xuc-handle {
        touch-action: none;
        cursor: grab !important;
      }

      #${C.toolbarId}.xuc-dragging .xuc-handle {
        cursor: grabbing !important;
      }

      #${C.toolbarId} .xuc-tool svg {
        width: 22px;
        height: 22px;
        fill: currentColor;
      }

      #${C.toolbarId} .xuc-tool:hover,
      #${C.toolbarId} .xuc-tool.active {
        background: var(--panel-active) !important;
        border-color: var(--panel-accent) !important;
        color: var(--panel-accent) !important;
      }

      #${C.toolbarId} .xuc-panel {
        position: fixed !important;
        width: 340px;
        max-width: calc(100vw - 24px);
        overflow-y: auto;
        padding: 13px;
        border: 1px solid var(--panel-border);
        border-radius: 15px;
        background: rgba(var(--glass-rgb),.62);
        color: var(--panel-text);
        -webkit-backdrop-filter: blur(30px) saturate(180%);
        backdrop-filter: blur(30px) saturate(180%);
        box-shadow:
          0 16px 42px var(--panel-shadow),
          inset 0 1px 0 var(--panel-highlight);
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: var(--panel-border) transparent;
        overflow-wrap: anywhere;
      }

      #${C.toolbarId} .xuc-title {
        margin: 0 0 10px;
        padding-bottom: 9px;
        border-bottom: 1px solid var(--panel-border);
        font-size: 15px;
        font-weight: 700;
      }

      #${C.toolbarId} .xuc-row,
      #${C.toolbarId} .xuc-head {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      #${C.toolbarId} .xuc-head {
        justify-content: space-between;
        margin: 8px 0 3px;
      }

      #${C.toolbarId} .xuc-grid {
        display: grid;
        grid-template-columns: repeat(2,minmax(0,1fr));
        gap: 6px;
      }

      #${C.toolbarId} .xuc-three {
        grid-template-columns: repeat(3,minmax(0,1fr));
      }

      #${C.toolbarId} .xuc-five {
        grid-template-columns: repeat(5,minmax(0,1fr));
      }

      #${C.toolbarId} .xuc-four {
        grid-template-columns: repeat(4,minmax(0,1fr));
      }

      #${C.toolbarId} .xuc-section {
        margin-top: 10px;
        padding-top: 9px;
        border-top: 1px solid var(--panel-border);
      }

      #${C.toolbarId} .xuc-label {
        margin: 8px 0 5px;
        color: var(--panel-muted);
        font-size: 11px;
      }

      #${C.toolbarId} .xuc-hint {
        margin: 5px 0 0;
        color: var(--panel-muted);
        font-size: 11px;
        line-height: 1.45;
      }

      #${C.toolbarId} .xuc-panel button {
        min-height: 30px;
        padding: 5px 7px;
        border: 1px solid var(--panel-border);
        border-radius: 8px;
        background: var(--panel-control);
        color: var(--panel-text);
        cursor: pointer;
        line-height: 1.35 !important;
      }

      #${C.toolbarId} .xuc-panel button:hover {
        background: var(--panel-hover);
        border-color: var(--panel-accent);
      }

      #${C.toolbarId} .xuc-panel button.active {
        background: var(--panel-active);
        border-color: var(--panel-accent);
        color: var(--panel-accent);
      }

      #${C.toolbarId} .xuc-panel .xuc-primary {
        background: #1d9bf0;
        border-color: transparent;
        color: #fff;
      }

      #${C.toolbarId} input[type="text"],
      #${C.toolbarId} input[type="number"] {
        min-width: 0;
        min-height: 32px;
        padding: 6px 8px;
        border: 1px solid var(--panel-border);
        border-radius: 8px;
        background: var(--panel-input);
        color: var(--panel-text);
      }

      #${C.toolbarId} input[type="text"] {
        flex: 1 1 auto;
        width: 0;
      }

      #${C.toolbarId} input[type="number"] {
        width: 62px;
        text-align: center;
      }

      #${C.toolbarId} input::placeholder {
        color: var(--panel-muted);
        opacity: .85;
      }

      #${C.toolbarId} input[type="range"] {
        width: 100%;
        height: 20px;
        margin: 0;
        accent-color: var(--panel-accent);
      }

      #${C.toolbarId} output {
        color: var(--panel-accent);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }

      #${C.toolbarId} .xuc-keywords {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 7px;
      }

      #${C.toolbarId} .xuc-keywords:empty {
        display: none;
      }

      #${C.toolbarId} .xuc-keyword {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: 100%;
        padding: 3px 6px;
        border: 1px solid var(--panel-border);
        border-radius: 7px;
        background: var(--panel-control);
      }

      #${C.toolbarId} .xuc-keyword button {
        width: 22px;
        min-height: 22px;
        padding: 0;
        border: none;
        background: transparent;
      }

      #${C.toolbarId} summary {
        cursor: pointer;
        color: var(--panel-muted);
      }

      #${C.toolbarId} .xuc-shortcut-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 6px;
      }

      #${C.toolbarId} .xuc-shortcut-row input {
        width: 140px;
        flex: 0 1 140px;
        text-align: center;
      }

      #${C.notificationId} {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
      }

      #${C.notificationId} > div {
        max-width: min(360px,calc(100vw - 32px));
        padding: 10px 14px;
        border-radius: 10px;
        background: #176ca7;
        color: #fff;
        font: 13px/1.45 system-ui,sans-serif;
        box-shadow: 0 10px 24px rgba(0,0,0,.22);
      }

      @media(pointer:coarse) {
        #${C.toolbarId} .xuc-panel button,
        #${C.toolbarId} input[type="text"],
        #${C.toolbarId} input[type="number"] {
          min-height: 36px;
        }

        #${C.toolbarId} .xuc-keyword button {
          width: 28px;
          min-height: 28px;
        }
      }

      @media(prefers-reduced-motion:reduce) {
        ${TWEET}.xuc-read,
        #${C.toolbarId} * {
          transition: none !important;
          animation: none !important;
        }
      }

      @supports not (
        (backdrop-filter:blur(1px)) or
        (-webkit-backdrop-filter:blur(1px))
      ) {
        #${C.toolbarId} .xuc-panel,
        #${C.toolbarId} .xuc-tool {
          background: rgba(var(--glass-rgb),.96);
        }
      }
    `;

    try {
      if (typeof GM_addStyle === "function") {
        const node = GM_addStyle(css);
        if (node?.nodeType === Node.ELEMENT_NODE) node.id = C.styleId;
      } else {
        const style = document.createElement("style");
        style.id = C.styleId;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
      }
      stylesInjected = true;
    } catch (error) {
      console.warn("[X 界面增强] 注入样式失败", error);
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
    style.setProperty("--xuc-media-height", `${state.mediaMaxHeight}px`);

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

    syncPalette();
  }

  function syncPalette() {
    const toolbar = document.getElementById(C.toolbarId);
    if (!toolbar) return;

    let palette = state.theme;

    if (!palette) {
      let rgb = null;
      const nodes = [
        document.body,
        document.documentElement,
        document.querySelector('[data-testid="primaryColumn"]'),
      ];

      for (const node of nodes) {
        if (!node) continue;
        const color = getComputedStyle(node).backgroundColor;
        const match = color.match(/^rgba?\(([^)]+)\)$/i);
        const values = match?.[1].match(/[\d.]+/g)?.map(Number);
        if (!values || values.length < 3 || (values[3] ?? 1) < .9) continue;
        rgb = values.slice(0, 3);
        break;
      }

      if (rgb) {
        const colors = {
          light: [255, 255, 255],
          dim: [21, 32, 43],
          oled: [0, 0, 0],
        };

        let best = Infinity;
        palette = "light";

        for (const [name, color] of Object.entries(colors)) {
          const distance = color.reduce(
            (sum, n, i) => sum + (n - rgb[i]) ** 2,
            0
          );
          if (distance < best) {
            best = distance;
            palette = name;
          }
        }
      } else {
        palette = matchMedia("(prefers-color-scheme:dark)").matches
          ? "oled"
          : "light";
      }
    }

    if (toolbar.dataset.palette !== palette) {
      toolbar.dataset.palette = palette;
    }
  }

  function scheduleElevated() {
    if (!state.theme || elevatedTimer !== null || !started) return;

    elevatedTimer = setTimeout(() => {
      elevatedTimer = null;
      if (!state.theme || !started) return;

      document.querySelectorAll(
        'main h2,main nav[role="navigation"],main [role="tablist"]'
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

  function svg(path) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  }

  const ICON = {
    handle: svg("M7 4h3v3H7zm7 0h3v3h-3zM7 10h3v3H7zm7 0h3v3h-3zM7 16h3v3H7zm7 0h3v3h-3z"),
    menu: svg("M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"),
    search: svg("M10 3a7 7 0 1 0 4.9 12l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"),
    settings: svg("M4 6h16v2H4zm3 5h10v2H7zm3 5h4v2h-4z"),
    top: svg("M4 3h16v2H4zm7 6-5 5-1.4-1.4L12 6.2l7.4 6.4L18 14l-5-5v12h-2z"),
    back: svg("M9 4 2 11l7 7 1.4-1.4L5.8 12H15a5 5 0 0 1 5 5v3h2v-3a7 7 0 0 0-7-7H5.8l4.6-4.6z"),
    play: svg("M7 4v16l13-8z"),
    pause: svg("M6 4h4v16H6zm8 0h4v16h-4z"),
  };

  function buildToolbar() {
    if (!document.body || document.getElementById(C.toolbarId)) return;

    const toolbar = document.createElement("div");
    toolbar.id = C.toolbarId;

    // 固定模板；用户关键词使用 textContent 单独渲染。
    toolbar.innerHTML = `
      <div class="xuc-buttons">
        <button type="button" class="xuc-tool xuc-handle"
          data-action="handle"
          title="拖动吸边；点击展开或收起"
          aria-label="拖动工具栏，点击展开或收起">
          ${ICON.handle}
        </button>

        <div class="xuc-actions" role="group" aria-label="X 界面增强">
          <button type="button" class="xuc-tool" data-action="sidebar"
            title="显示或隐藏左侧导航" aria-label="显示或隐藏左侧导航">
            ${ICON.menu}
          </button>
          <button type="button" class="xuc-tool" data-panel="search"
            aria-controls="xuc-search-panel" aria-expanded="false"
            title="搜索" aria-label="搜索">
            ${ICON.search}
          </button>
          <button type="button" class="xuc-tool" data-panel="layout"
            aria-controls="xuc-layout-panel" aria-expanded="false"
            title="布局与阅读设置" aria-label="布局与阅读设置">
            ${ICON.settings}
          </button>
          <button type="button" class="xuc-tool" data-action="return"
            title="回到顶部并记住当前位置" aria-label="回到顶部">
            ${ICON.top}
          </button>
          <button type="button" class="xuc-tool" data-action="quick-scroll"
            title="开启自动滚动" aria-label="开启自动滚动">
            ${ICON.play}
          </button>
        </div>
      </div>

      <section id="xuc-search-panel" class="xuc-panel"
        aria-labelledby="xuc-search-title" hidden>
        <div id="xuc-search-title" class="xuc-title">搜索</div>
        <div class="xuc-row">
          <input id="xuc-search-input" type="text"
            placeholder="搜索 X..." aria-label="搜索 X">
          <button type="button" class="xuc-primary" data-action="search">
            搜索
          </button>
        </div>
      </section>

      <section id="xuc-layout-panel" class="xuc-panel"
        aria-labelledby="xuc-layout-title" hidden>
        <div id="xuc-layout-title" class="xuc-title">布局与阅读</div>

        <div class="xuc-label">主题 · 默认跟随 X</div>
        <div class="xuc-grid xuc-five">
          <button type="button" data-theme="">默认</button>
          <button type="button" data-theme="paper">米黄</button>
          <button type="button" data-theme="green">豆绿</button>
          <button type="button" data-theme="dim">Dim</button>
          <button type="button" data-theme="oled">OLED</button>
        </div>

        <div class="xuc-label">阅读预设 · 不改变主题</div>
        <div class="xuc-grid xuc-three">
          <button type="button" data-preset="text">纯文字</button>
          <button type="button" data-preset="comfort">舒适阅读</button>
          <button type="button" data-preset="quick">快速浏览</button>
        </div>

        <div class="xuc-grid">
          <div>
            <div class="xuc-head">
              <label for="xuc-font">字号</label>
              <output id="xuc-font-value"></output>
            </div>
            <input id="xuc-font" data-field="fontSize"
              type="range" min="9" max="20" step="1"
              aria-label="正文字号，最左侧为默认">
          </div>
          <div>
            <div class="xuc-head">
              <label for="xuc-line">行距</label>
              <output id="xuc-line-value"></output>
            </div>
            <input id="xuc-line" data-field="lineHeight"
              type="range" min="9" max="20" step="1"
              aria-label="正文行距，最左侧为默认">
          </div>
        </div>

        <div class="xuc-grid" style="margin-top:7px">
          <button type="button" data-toggle="serifFont">衬线字体</button>
          <button type="button" data-toggle="focusMode">聚焦模式</button>
          <button type="button" data-toggle="dimRead">已浏览淡化</button>
          <button type="button" data-toggle="autoExpand">自动展开正文</button>
        </div>

        <div class="xuc-section">
          <div class="xuc-label" style="margin-top:0">图片与视频</div>
          <div class="xuc-grid xuc-three">
            <button type="button" data-media="normal">正常显示</button>
            <button type="button" data-media="limit">限制高度</button>
            <button type="button" data-media="collapse">默认收起</button>
          </div>
          <div id="xuc-media-height-row">
            <div class="xuc-head">
              <label for="xuc-media-height">媒体最大高度</label>
              <output id="xuc-media-height-value"></output>
            </div>
            <input id="xuc-media-height" data-field="mediaMaxHeight"
              type="range" min="160" max="800" step="20">
          </div>
          <p class="xuc-hint">
            可逐个展开；仅改变显示，不保证阻止媒体加载。
          </p>
        </div>

        <div class="xuc-section">
          <div class="xuc-head" style="margin-top:0">
            <span>自动滚动</span>
            <button type="button" data-action="quick-scroll"
              id="xuc-auto-toggle">关闭</button>
          </div>
          <div class="xuc-row">
            <label for="xuc-seconds">每隔</label>
            <input id="xuc-seconds" type="number"
              data-field="autoScrollSeconds" min="1" max="60" step="1">
            <span>秒</span>
            <button type="button" data-toggle="hoverPause">
              悬停暂停
            </button>
          </div>
          <div class="xuc-head">
            <label for="xuc-distance">每次滚动</label>
            <output id="xuc-distance-value"></output>
          </div>
          <input id="xuc-distance" data-field="scrollPercent"
            type="range" min="20" max="100" step="5">
          <p id="xuc-auto-status" class="xuc-hint"></p>
          <p class="xuc-hint">
            仅首页与用户主页。手动滚动暂停 15 秒；输入、弹窗、后台暂停。
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
          <p class="xuc-hint">命中后折叠提示，可临时展开。</p>
        </div>

        <div class="xuc-section">
          <div class="xuc-head" style="margin-top:0">
            <label for="xuc-width">推文宽度</label>
            <output id="xuc-width-value"></output>
          </div>
          <input id="xuc-width" data-field="tweetWidth"
            type="range" min="500" max="1400" step="50">
          <div class="xuc-grid xuc-four">
            <button type="button" data-width="600">窄</button>
            <button type="button" data-width="800">中</button>
            <button type="button" data-width="1000">宽</button>
            <button type="button" data-width="1200">超宽</button>
          </div>
        </div>

        <details class="xuc-section" id="xuc-extra">
          <summary>工具栏与快捷键</summary>
          <div class="xuc-grid" style="margin-top:8px">
            <button type="button" data-toggle="autoCollapse">自动收起</button>
            <button type="button" data-action="reset-position">重置位置</button>
            <button type="button" data-toggle="shortcutsEnabled">启用快捷键</button>
            <button type="button" data-action="reset-shortcuts">重置快捷键</button>
          </div>
          <p class="xuc-hint">
            拖动六点按钮后自动吸边。无操作 8 秒收起，点击或鼠标移入展开。
          </p>
          <label class="xuc-shortcut-row">
            <span>下一条推文</span>
            <input type="text" data-shortcut="next" readonly
              aria-label="设置下一条快捷键" placeholder="点击后按键">
          </label>
          <label class="xuc-shortcut-row">
            <span>上一条推文</span>
            <input type="text" data-shortcut="previous" readonly
              aria-label="设置上一条快捷键" placeholder="点击后按键">
          </label>
          <label class="xuc-shortcut-row">
            <span>暂停／继续滚动</span>
            <input type="text" data-shortcut="scroll" readonly
              aria-label="设置自动滚动快捷键" placeholder="点击后按键">
          </label>
          <p class="xuc-hint">
            点击输入框后按组合键；Backspace 清除，Esc 取消。
            输入文字时不触发。无修饰键可能与 X 快捷键冲突。
          </p>
        </details>
      </section>
    `;

    toolbar.addEventListener("click", toolbarClick);
    toolbar.addEventListener("input", toolbarInput);
    toolbar.addEventListener("change", toolbarChange);
    toolbar.addEventListener("keydown", toolbarKeydown);

    toolbar.addEventListener("pointerenter", () => {
      toolbarHovered = true;
      clearTimeout(collapseTimer);
      if (finePointer.matches && toolbarCollapsed && !drag) {
        setToolbarCollapsed(false);
      }
    });

    toolbar.addEventListener("pointerleave", () => {
      toolbarHovered = false;
      scheduleToolbarCollapse();
    });

    toolbar.addEventListener("focusin", () => {
      clearTimeout(collapseTimer);
    });

    toolbar.addEventListener("focusout", () => {
      setTimeout(scheduleToolbarCollapse, 0);
    });

    const handle = toolbar.querySelector(".xuc-handle");
    handle.addEventListener("pointerdown", dragStart);
    handle.addEventListener("pointermove", dragMove);
    handle.addEventListener("pointerup", dragEnd);
    handle.addEventListener("pointercancel", dragEnd);
    handle.addEventListener("lostpointercapture", dragEnd);

    toolbar.querySelector("#xuc-extra")
      .addEventListener("toggle", schedulePanelPosition);

    document.body.appendChild(toolbar);

    renderKeywords();
    updateControls();
    syncPanels();
    setToolbarCollapsed(toolbarCollapsed);
    positionToolbar();
    scheduleToolbarCollapse();
  }

  function updateControls() {
    const toolbar = document.getElementById(C.toolbarId);
    if (!toolbar) return;

    toolbar.querySelectorAll("[data-toggle]").forEach(button => {
      const active = Boolean(state[button.dataset.toggle]);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    const sidebar = toolbar.querySelector('[data-action="sidebar"]');
    sidebar.classList.toggle("active", state.sidebarVisible);
    sidebar.setAttribute("aria-pressed", String(state.sidebarVisible));

    toolbar.querySelectorAll("[data-theme]").forEach(button => {
      const active = button.dataset.theme === state.theme;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    toolbar.querySelectorAll("[data-media]").forEach(button => {
      const active = button.dataset.media === state.mediaMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    toolbar.querySelectorAll("[data-width]").forEach(button => {
      const active = Number(button.dataset.width) === state.tweetWidth;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    toolbar.querySelectorAll("[data-preset]").forEach(button => {
      const preset = PRESETS[button.dataset.preset];
      const active = Object.entries(preset.values)
        .every(([name, value]) => state[name] === value);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    const fontText = state.fontSize ? `${state.fontSize}px` : "默认";
    const lineText = state.lineHeight
      ? state.lineHeight.toFixed(1)
      : "默认";

    setText("xuc-font-value", fontText);
    setText("xuc-line-value", lineText);
    setText("xuc-width-value", `${state.tweetWidth}px`);
    setText("xuc-media-height-value", `${state.mediaMaxHeight}px`);
    setText("xuc-distance-value", `${state.scrollPercent}% 屏幕`);

    setInput("xuc-font", state.fontSize || 9);
    setInput("xuc-line", state.lineHeight
      ? Math.round(state.lineHeight * 10)
      : 9);
    setInput("xuc-width", state.tweetWidth);
    setInput("xuc-media-height", state.mediaMaxHeight);
    setInput("xuc-distance", state.scrollPercent);

    if (document.activeElement?.id !== "xuc-seconds") {
      setInput("xuc-seconds", state.autoScrollSeconds);
    }

    toolbar.querySelector("#xuc-font")
      .setAttribute("aria-valuetext", fontText);
    toolbar.querySelector("#xuc-line")
      .setAttribute("aria-valuetext", lineText);

    toolbar.querySelector("#xuc-media-height-row").hidden =
      state.mediaMode !== "limit";

    toolbar.querySelectorAll("[data-shortcut]").forEach(input => {
      input.value = state.shortcuts[input.dataset.shortcut] || "";
    });

    syncQuickButtons();
    syncPalette();
    schedulePanelPosition();
  }

  function syncQuickButtons() {
    const toolbar = document.getElementById(C.toolbarId);
    if (!toolbar) return;

    const bookmark = returnPositions.has(getContextKey());
    const top = toolbar.querySelector('[data-action="return"]');
    const topMode = bookmark ? "back" : "top";

    if (top.dataset.icon !== topMode) {
      top.innerHTML = bookmark ? ICON.back : ICON.top;
      top.dataset.icon = topMode;
    }

    const topLabel = bookmark
      ? "返回刚才的阅读位置"
      : "回到顶部并记住当前位置";

    top.title = topLabel;
    top.setAttribute("aria-label", topLabel);
    top.classList.toggle("active", bookmark);

    const enabled = state.autoScrollEnabled;
    const canResume = enabled && autoBottomPaused;
    const mode = enabled && !canResume ? "pause" : "play";

    const quick = toolbar.querySelector(
      '.xuc-tool[data-action="quick-scroll"]'
    );

    if (quick.dataset.icon !== mode) {
      quick.innerHTML = mode === "pause" ? ICON.pause : ICON.play;
      quick.dataset.icon = mode;
    }

    const label = canResume
      ? "继续自动滚动"
      : enabled ? "关闭自动滚动" : "开启自动滚动";

    quick.title = `${label} · ${autoStatus}`;
    quick.setAttribute("aria-label", label);
    quick.setAttribute("aria-pressed", String(enabled));
    quick.classList.toggle("active", enabled);

    const panelToggle = document.getElementById("xuc-auto-toggle");
    if (panelToggle) {
      const text = canResume ? "继续" : enabled ? "开启" : "关闭";
      if (panelToggle.textContent !== text) panelToggle.textContent = text;
      panelToggle.classList.toggle("active", enabled);
      panelToggle.setAttribute("aria-pressed", String(enabled));
    }

    setText("xuc-auto-status", autoStatus);
  }

  function syncPanels() {
    const toolbar = document.getElementById(C.toolbarId);
    if (!toolbar) return;

    for (const name of ["search", "layout"]) {
      const open = state.openPanel === name;
      toolbar.querySelector(`#xuc-${name}-panel`).hidden = !open;

      const button = toolbar.querySelector(`[data-panel="${name}"]`);
      button.classList.toggle("active", open);
      button.setAttribute("aria-expanded", String(open));
    }

    schedulePanelPosition();
  }

  function closePanel(restoreFocus = false) {
    const previous = state.openPanel;
    state.openPanel = "";
    syncPanels();

    if (restoreFocus && previous) {
      document.querySelector(
        `#${C.toolbarId} [data-panel="${previous}"]`
      )?.focus({ preventScroll: true });
    }

    scheduleToolbarCollapse();
  }

  function togglePanel(name) {
    if (state.openPanel === name) {
      closePanel(true);
      return;
    }

    setToolbarCollapsed(false);
    state.openPanel = name;
    clearTimeout(collapseTimer);
    syncPalette();
    syncPanels();

    const target = name === "search"
      ? document.getElementById("xuc-search-input")
      : document.querySelector("#xuc-layout-panel [data-theme]");

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

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "×";
      button.dataset.removeKeyword = keyword;
      button.setAttribute("aria-label", `删除关键词：${keyword}`);

      tag.append(text, button);
      fragment.appendChild(tag);
    }

    list.replaceChildren(fragment);
    schedulePanelPosition();
  }

  function changeKeywords(keywords) {
    state.blockedKeywords = normalizeKeywords(keywords);
    lowerKeywords = state.blockedKeywords.map(s => s.toLowerCase());
    keywordVersion++;
    revealedIds.clear();

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
      notify("该关键词已存在");
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
    const url = new URL("/search", location.origin);
    url.searchParams.set("q", query);
    url.searchParams.set("src", "typed_query");
    location.assign(url.href);
  }

  function changeSettings(values, message = "") {
    const changed = [];

    for (const [name, value] of Object.entries(values)) {
      if (state[name] === value) continue;
      state[name] = value;
      queueSave(name);
      changed.push(name);
    }

    if (!changed.length) {
      if (message) notify(message);
      return;
    }

    const appearance = [
      "sidebarVisible", "tweetWidth", "theme", "fontSize",
      "lineHeight", "serifFont", "focusMode", "mediaMaxHeight",
    ];

    if (changed.some(name => appearance.includes(name))) {
      applyAppearance();
      refreshReadGeometry();
      scheduleElevated();
    }

    if (changed.includes("dimRead")) {
      resetReadTracking();
      syncReadMode();
    }

    if (changed.includes("autoExpand")) {
      expandAttempts = new WeakMap();
      markAllTweets();
    }

    if (changed.includes("mediaMode")) {
      readCandidates.clear();
      markAllTweets();
    }

    if (changed.some(name => [
      "autoScrollEnabled", "autoScrollSeconds",
      "scrollPercent", "hoverPause",
    ].includes(name))) {
      restartAutoScroll();
    }

    if (changed.includes("autoCollapse")) {
      if (!state.autoCollapse) setToolbarCollapsed(false);
      scheduleToolbarCollapse();
    }

    updateControls();
    if (message) notify(message);
  }

  function toolbarClick(event) {
    event.stopPropagation();

    const button = elementOf(event.target)?.closest("button");
    if (!button) return;

    if (button.hasAttribute("data-panel")) {
      togglePanel(button.dataset.panel);
    } else if (button.hasAttribute("data-theme")) {
      changeSettings({ theme: button.dataset.theme });
    } else if (button.hasAttribute("data-media")) {
      changeSettings({ mediaMode: button.dataset.media });
    } else if (button.hasAttribute("data-width")) {
      changeSettings({
        tweetWidth: clamp(button.dataset.width, 500, 1400, 900, 50),
      });
    } else if (button.hasAttribute("data-preset")) {
      const preset = PRESETS[button.dataset.preset];
      changeSettings(preset.values, `已切换：${preset.label}`);
    } else if (button.hasAttribute("data-toggle")) {
      const name = button.dataset.toggle;
      changeSettings({ [name]: !state[name] });
    } else if (button.hasAttribute("data-remove-keyword")) {
      changeKeywords(state.blockedKeywords.filter(
        word => word !== button.dataset.removeKeyword
      ));
    } else {
      switch (button.dataset.action) {
        case "handle":
          if (Date.now() < suppressHandleClickUntil) return;
          setToolbarCollapsed(!toolbarCollapsed);
          break;
        case "sidebar":
          changeSettings({ sidebarVisible: !state.sidebarVisible });
          break;
        case "search":
          runSearch();
          break;
        case "add-keyword":
          addKeyword();
          break;
        case "quick-scroll":
          toggleAutoScroll();
          break;
        case "return":
          toggleReturnPosition();
          break;
        case "reset-position":
          state.toolbarPosition = { side: "right", y: .7 };
          queueSave("toolbarPosition");
          positionToolbar();
          notify("工具栏位置已重置");
          break;
        case "reset-shortcuts":
          state.shortcuts = { ...DEFAULT_SHORTCUTS };
          queueSave("shortcuts");
          updateControls();
          notify("快捷键已重置");
          break;
      }
    }
  }

  function toolbarInput(event) {
    const input = event.target;

    switch (input.dataset.field) {
      case "tweetWidth":
        changeSettings({
          tweetWidth: clamp(input.value, 500, 1400, 900, 50),
        });
        break;
      case "fontSize":
        changeSettings({
          fontSize: Number(input.value) <= 9
            ? 0
            : clamp(input.value, 10, 20, 16),
        });
        break;
      case "lineHeight":
        changeSettings({
          lineHeight: Number(input.value) <= 9
            ? 0
            : clamp(Number(input.value) / 10, 1, 2, 1.5, .1),
        });
        break;
      case "mediaMaxHeight":
        changeSettings({
          mediaMaxHeight: clamp(input.value, 160, 800, 400, 20),
        });
        break;
      case "scrollPercent":
        changeSettings({
          scrollPercent: clamp(input.value, 20, 100, 80, 5),
        });
        break;
    }
  }

  function toolbarChange(event) {
    const input = event.target;
    if (input.dataset.field !== "autoScrollSeconds") return;

    if (!input.value.trim() || !Number.isFinite(input.valueAsNumber)) {
      input.value = String(state.autoScrollSeconds);
      return;
    }

    const value = clamp(input.valueAsNumber, 1, 60, 5);
    input.value = String(value);
    changeSettings({ autoScrollSeconds: value });
  }

  function toolbarKeydown(event) {
    if (event.isComposing || event.keyCode === 229) return;
    event.stopPropagation();

    const shortcutName = event.target.dataset?.shortcut;

    if (shortcutName) {
      if (event.key === "Tab") return;

      event.preventDefault();

      if (event.key === "Escape") {
        event.target.blur();
        return;
      }

      if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;

      const chord = event.key === "Backspace" || event.key === "Delete"
        ? ""
        : eventChord(event);

      if (
        chord &&
        Object.entries(state.shortcuts).some(
          ([name, value]) => name !== shortcutName && value === chord
        )
      ) {
        notify("该快捷键已被其他功能使用");
        return;
      }

      state.shortcuts = { ...state.shortcuts, [shortcutName]: chord };
      queueSave("shortcuts");
      updateControls();
      return;
    }

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

  // ==================== 拖动、吸边、收起 ====================

  function positionToolbar() {
    const toolbar = document.getElementById(C.toolbarId);
    if (!toolbar || drag?.moved) return;

    const gap = 12;
    const height = toolbar.offsetHeight || 44;
    const width = 44;
    const availableY = Math.max(0, innerHeight - height - gap * 2);
    const top = gap + state.toolbarPosition.y * availableY;
    const left = state.toolbarPosition.side === "left"
      ? gap
      : Math.max(gap, innerWidth - width - gap);

    toolbar.style.left = `${Math.round(left)}px`;
    toolbar.style.top = `${Math.round(top)}px`;
    schedulePanelPosition();
  }

  function schedulePanelPosition() {
    if (panelFrame !== null || !started) return;

    panelFrame = requestAnimationFrame(() => {
      panelFrame = null;
      positionPanel();
    });
  }

  function positionPanel() {
    if (!state.openPanel) return;

    const toolbar = document.getElementById(C.toolbarId);
    const panel = document.getElementById(`xuc-${state.openPanel}-panel`);
    if (!toolbar || !panel || panel.hidden) return;

    const gap = 12;
    const rect = toolbar.getBoundingClientRect();
    const width = Math.max(180, Math.min(340, innerWidth - gap * 2));
    const maxHeight = Math.max(100, innerHeight - gap * 2);

    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${maxHeight}px`;

    const leftSpace = rect.left - gap * 2;
    const rightSpace = innerWidth - rect.right - gap * 2;
    let left;

    if (rightSpace >= width) {
      left = rect.right + gap;
    } else if (leftSpace >= width) {
      left = rect.left - width - gap;
    } else {
      left = rightSpace >= leftSpace
        ? rect.right + gap
        : rect.left - width - gap;
      left = Math.min(
        Math.max(gap, left),
        Math.max(gap, innerWidth - width - gap)
      );
    }

    const height = panel.getBoundingClientRect().height;
    const top = Math.min(
      Math.max(gap, rect.top + rect.height / 2 - height / 2),
      Math.max(gap, innerHeight - height - gap)
    );

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  function setToolbarCollapsed(collapsed) {
    const toolbar = document.getElementById(C.toolbarId);
    toolbarCollapsed = Boolean(collapsed);

    if (toolbarCollapsed) {
      closePanel(false);
      if (
        toolbar?.contains(document.activeElement) &&
        !document.activeElement.matches(".xuc-handle")
      ) {
        toolbar.querySelector(".xuc-handle")
          ?.focus({ preventScroll: true });
      }
    }

    toolbar?.classList.toggle("xuc-collapsed", toolbarCollapsed);
    toolbar?.querySelector(".xuc-handle")?.setAttribute(
      "aria-expanded",
      String(!toolbarCollapsed)
    );

    positionToolbar();
    if (!toolbarCollapsed) scheduleToolbarCollapse();
  }

  function scheduleToolbarCollapse() {
    clearTimeout(collapseTimer);
    collapseTimer = null;

    const toolbar = document.getElementById(C.toolbarId);

    if (
      !started || !state.autoCollapse || toolbarCollapsed ||
      state.openPanel || toolbarHovered || drag ||
      toolbar?.contains(document.activeElement)
    ) return;

    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      setToolbarCollapsed(true);
    }, C.collapseDelay);
  }

  function dragStart(event) {
    if (event.button !== 0 || !event.isPrimary) return;

    const toolbar = document.getElementById(C.toolbarId);
    const rect = toolbar.getBoundingClientRect();

    clearTimeout(collapseTimer);
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragMove(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;

    const distance = Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY
    );

    if (!drag.moved && distance < 5) return;

    event.preventDefault();

    if (!drag.moved) {
      drag.moved = true;
      closePanel(false);
    }

    const toolbar = document.getElementById(C.toolbarId);
    toolbar.classList.add("xuc-dragging");

    const left = Math.min(
      Math.max(0, event.clientX - drag.offsetX),
      Math.max(0, innerWidth - 44)
    );

    const top = Math.min(
      Math.max(0, event.clientY - drag.offsetY),
      Math.max(0, innerHeight - toolbar.offsetHeight)
    );

    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
  }

  function dragEnd(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;

    const toolbar = document.getElementById(C.toolbarId);
    const moved = drag.moved;
    const pointerId = drag.pointerId;
    drag = null;

    toolbar?.classList.remove("xuc-dragging");

    if (moved && toolbar) {
      const rect = toolbar.getBoundingClientRect();
      const available = Math.max(1, innerHeight - rect.height - 24);

      state.toolbarPosition = {
        side: rect.left + rect.width / 2 < innerWidth / 2
          ? "left"
          : "right",
        y: Math.min(1, Math.max(0, (rect.top - 12) / available)),
      };

      queueSave("toolbarPosition");
      suppressHandleClickUntil = Date.now() + 400;
    }

    if (event.currentTarget.hasPointerCapture?.(pointerId)) {
      event.currentTarget.releasePointerCapture(pointerId);
    }

    positionToolbar();
    scheduleToolbarCollapse();
  }

  // ==================== 推文处理、关键词折叠 ====================

  function newTweetData(id) {
    return {
      id,
      text: "",
      keywordVersion: -1,
      matches: [],
      localRevealed: false,
      notice: null,
      media: new Map(),
      mediaMode: "",
    };
  }

  function disposeTweetData(article, data) {
    data?.notice?.remove();

    if (data) {
      for (const [node, record] of data.media) {
        node.classList.remove("xuc-media-hidden", "xuc-media-limited");
        record.button?.remove();
      }
      data.media.clear();
    }

    article.classList.remove("xuc-filter-folded", "xuc-read");
  }

  function textWithoutOurUI(article) {
    const walker = document.createTreeWalker(
      article,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return node.parentElement?.closest(
            "[data-xuc-ui],script,style"
          )
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const parts = [];
    while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
    return parts.join(" ").toLowerCase();
  }

  function isRevealed(data) {
    return data.id
      ? revealedIds.has(data.id)
      : data.localRevealed;
  }

  function renderFilter(article, data) {
    if (!data.matches.length) {
      article.classList.remove("xuc-filter-folded");
      data.notice?.remove();
      data.notice = null;
      return;
    }

    if (!data.notice || data.notice.parentElement !== article) {
      data.notice?.remove();

      const notice = ownNode("div", "xuc-filter-notice");
      const label = document.createElement("span");
      const button = document.createElement("button");
      button.type = "button";

      notice.append(label, button);

      notice.addEventListener("click", event => {
        event.stopPropagation();
        event.preventDefault();

        if (!elementOf(event.target)?.closest("button")) return;

        const current = tweetData.get(article);
        if (!current) return;

        const next = !isRevealed(current);

        if (current.id) {
          if (next) {
            putBounded(revealedIds, current.id, true, 1000);
          } else {
            revealedIds.delete(current.id);
          }
        } else {
          current.localRevealed = next;
        }

        readCandidates.clear();
        renderFilter(article, current);
        syncMedia(article, current);
        syncReadArticle(article, current.id);
      });

      data.notice = notice;
      article.prepend(notice);
    }

    const revealed = isRevealed(data);
    const label = data.notice.querySelector("span");
    const button = data.notice.querySelector("button");
    const matched = data.matches.slice(0, 3).join("、");

    label.textContent = `${revealed ? "已临时展开" : "已屏蔽"} · 命中「${matched}」`;
    button.textContent = revealed ? "收起" : "展开";
    button.setAttribute("aria-expanded", String(revealed));

    article.classList.toggle("xuc-filter-folded", !revealed);
  }

  function applyFilter(article, data) {
    if (!lowerKeywords.length) {
      data.matches = [];
      data.keywordVersion = keywordVersion;
      renderFilter(article, data);
      return;
    }

    const text = textWithoutOurUI(article);

    if (data.text !== text || data.keywordVersion !== keywordVersion) {
      data.text = text;
      data.keywordVersion = keywordVersion;
      data.matches = state.blockedKeywords.filter(
        (_, index) => text.includes(lowerKeywords[index])
      );
    }

    renderFilter(article, data);
  }

  function autoExpandTweet(article, data) {
    if (
      !state.autoExpand ||
      article.classList.contains("xuc-filter-folded")
    ) return;

    const old = expandAttempts.get(article);
    const count = old?.id === data.id ? old.count : 0;
    if (count >= 2) return;

    const button = article.querySelector(
      '[data-testid="tweet-text-show-more-link"]'
    );

    if (!button || expandedButtons.has(button)) return;

    const href = button.closest("a")?.getAttribute("href");
    if (href && href !== "#") return;
    if (button.disabled || button.getAttribute("aria-disabled") === "true") {
      return;
    }

    expandedButtons.add(button);
    expandAttempts.set(article, { id: data.id, count: count + 1 });
    button.click();
  }

  // ==================== 媒体折叠与高度限制 ====================

  function renderMediaRecord(node, record) {
    const collapse = state.mediaMode === "collapse" && !record.expanded;
    const limited = state.mediaMode === "limit" && !record.expanded;

    node.classList.toggle("xuc-media-hidden", collapse);
    node.classList.toggle("xuc-media-limited", limited);

    if (!record.button) return;

    const type = node.matches('[data-testid="videoPlayer"]')
      ? "视频 / GIF"
      : "图片";

    record.button.textContent = record.expanded
      ? `收起${type}`
      : state.mediaMode === "collapse"
        ? `展开${type}`
        : `展开完整${type}`;

    record.button.setAttribute("aria-expanded", String(record.expanded));
  }

  function syncMedia(article, data) {
    const candidates = [...article.querySelectorAll(MEDIA)].filter(node => {
      const parentMedia = node.parentElement?.closest(MEDIA);
      return !parentMedia || !article.contains(parentMedia);
    });

    const current = new Set(candidates);

    for (const [node, record] of data.media) {
      if (!current.has(node) || !node.isConnected) {
        node.classList.remove("xuc-media-hidden", "xuc-media-limited");
        record.button?.remove();
        data.media.delete(node);
      }
    }

    if (state.mediaMode === "normal") {
      for (const [node, record] of data.media) {
        node.classList.remove("xuc-media-hidden", "xuc-media-limited");
        record.button?.remove();
      }
      data.media.clear();
      data.mediaMode = state.mediaMode;
      return;
    }

    const modeChanged = data.mediaMode !== state.mediaMode;
    data.mediaMode = state.mediaMode;

    for (const node of candidates) {
      let record = data.media.get(node);

      if (!record) {
        record = { expanded: false, button: null };
        data.media.set(node, record);
      }

      if (modeChanged) record.expanded = false;

      if (!record.button?.isConnected) {
        const button = ownNode("button", "xuc-media-control");
        button.type = "button";

        button.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();

          record.expanded = !record.expanded;
          readCandidates.clear();

          if (!record.expanded) {
            node.querySelectorAll("video").forEach(video => video.pause());
          }

          renderMediaRecord(node, record);
          refreshReadGeometry();
        });

        record.button = button;
        node.before(button);
      }

      if (
        state.mediaMode === "collapse" &&
        !record.expanded
      ) {
        node.querySelectorAll("video").forEach(video => {
          if (!video.paused) video.pause();
        });
      }

      renderMediaRecord(node, record);
    }
  }

  function processTweet(article) {
    if (!article.isConnected || !article.matches(TWEET)) {
      untrackTweet(article);
      return;
    }

    trackedTweets.add(article);
    const id = tweetId(article);
    let data = tweetData.get(article);

    if (!data || data.id !== id) {
      disposeTweetData(article, data);
      data = newTweetData(id);
      tweetData.set(article, data);

      readCandidates.delete(article);
      readObserver?.unobserve(article);
      readObserved.delete(article);
    }

    applyFilter(article, data);
    autoExpandTweet(article, data);
    syncMedia(article, data);
    syncReadArticle(article, id);
  }

  function untrackTweet(article) {
    disposeTweetData(article, tweetData.get(article));
    tweetData.delete(article);
    trackedTweets.delete(article);
    dirtyTweets.delete(article);
    expandAttempts.delete(article);
    readCandidates.delete(article);
    readObserved.delete(article);
    readObserver?.unobserve(article);
  }

  function collectTweets(node) {
    if (node?.nodeType !== Node.ELEMENT_NODE || isOwn(node)) return;
    if (node.matches(TWEET)) dirtyTweets.add(node);
    node.querySelectorAll(TWEET).forEach(article => dirtyTweets.add(article));
  }

  function markAllTweets() {
    document.querySelectorAll(TWEET).forEach(article => dirtyTweets.add(article));
    scheduleMutationFlush();
  }

  // ==================== 时间线与回顶返回 ====================

  function getContextKey() {
    const url = new URL(location.href);

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

    return `${url.pathname}?${url.searchParams.toString()}#${tabKey}`;
  }

  function selectReadTimeline() {
    if (isDetail()) return false;

    const key = getContextKey();
    if (key === timelineKey) return false;

    const ids = timelineReads.get(key) || new Set();
    putBounded(timelineReads, key, ids, C.maxTimelines);
    timelineKey = key;
    activeReadIds = ids;
    return true;
  }

  function visibleArticles() {
    return [...document.querySelectorAll(TWEET)].filter(article => {
      if (article.classList.contains("xuc-filter-folded")) return false;
      const rect = article.getBoundingClientRect();
      return rect.height > 0 && rect.width > 0;
    });
  }

  function toggleReturnPosition() {
    const key = getContextKey();
    const saved = returnPositions.get(key);

    manualPauseUntil = Date.now() + C.manualPauseMs;
    const token = ++restoreToken;

    if (saved) {
      returnPositions.delete(key);
      syncQuickButtons();

      window.scrollTo({ top: saved.y, behavior: "instant" });

      let attempts = 0;
      let found = false;

      const restore = () => {
        if (!started || token !== restoreToken || getContextKey() !== key) {
          return;
        }

        const article = saved.id
          ? [...document.querySelectorAll(TWEET)]
            .find(node => tweetId(node) === saved.id)
          : null;

        if (article) {
          const delta = article.getBoundingClientRect().top - saved.offset;
          if (Math.abs(delta) > 2) {
            window.scrollBy({ top: delta, behavior: "instant" });
          }
          found = true;
        }

        attempts++;

        if (attempts < 8 && (!found || attempts < 3)) {
          setTimeout(restore, 160);
        } else {
          notify(found ? "已返回原推文附近" : "已尝试返回之前的阅读位置");
        }
      };

      setTimeout(restore, 120);
      return;
    }

    if (window.scrollY < 100) {
      notify("当前已接近页面顶部");
      return;
    }

    const candidates = visibleArticles()
      .map(article => ({ article, rect: article.getBoundingClientRect() }))
      .filter(item => item.rect.bottom > 80 && item.rect.top < innerHeight);

    const anchor = candidates[0];

    putBounded(returnPositions, key, {
      y: window.scrollY,
      id: anchor ? tweetId(anchor.article) : "",
      offset: anchor?.rect.top || 0,
    }, C.maxTimelines);

    syncQuickButtons();

    window.scrollTo({
      top: 0,
      behavior: reducedMotion.matches ? "instant" : "smooth",
    });

    notify("已记住阅读位置，再点返回按钮可回去");
  }

  // ==================== 已浏览淡化 ====================

  function rememberRead(id) {
    if (!id || activeReadIds.has(id)) return;

    activeReadIds.add(id);
    while (activeReadIds.size > C.maxReadIds) {
      activeReadIds.delete(activeReadIds.values().next().value);
    }
  }

  function readEnabledHere() {
    return state.dimRead && !isDetail() && !document.hidden;
  }

  function scrollParents(article) {
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

  function scrollOffset(parents) {
    return window.scrollY + parents.reduce(
      (sum, node) => sum + node.scrollTop,
      0
    );
  }

  function visibleBounds(parents) {
    let top = 0;
    let bottom = innerHeight;
    let left = 0;
    let right = innerWidth;

    for (const parent of parents) {
      if (!parent.isConnected) continue;
      const rect = parent.getBoundingClientRect();
      top = Math.max(top, rect.top + parent.clientTop);
      bottom = Math.min(
        bottom, rect.top + parent.clientTop + parent.clientHeight
      );
      left = Math.max(left, rect.left + parent.clientLeft);
      right = Math.min(
        right, rect.left + parent.clientLeft + parent.clientWidth
      );
    }
    return { top, bottom, left, right };
  }

  function resetReadTracking() {
    readObserver?.disconnect();
    readObserver = null;
    clearTimeout(readTimer);
    readTimer = null;
    readObserved.clear();
    readCandidates.clear();

    document.querySelectorAll(`${TWEET}.xuc-read`).forEach(article => {
      article.classList.remove("xuc-read");
    });
  }

  function syncReadMode() {
    if (!state.dimRead || isDetail()) {
      if (readObserver || readObserved.size) resetReadTracking();
      return;
    }

    if (!("IntersectionObserver" in window)) return;

    if (!readObserver) {
      readObserver = new IntersectionObserver(readIntersections, {
        root: null,
        threshold: [0, .01],
      });
    }

    document.querySelectorAll(TWEET).forEach(article => {
      syncReadArticle(article, tweetId(article));
    });
  }

  function syncReadArticle(article, id) {
    const enabled = state.dimRead && !isDetail();
    const folded = article.classList.contains("xuc-filter-folded");
    const read = Boolean(enabled && !folded && id && activeReadIds.has(id));

    article.classList.toggle("xuc-read", read);

    if (!enabled || !readObserver || !id || read || folded) {
      readObserver?.unobserve(article);
      readObserved.delete(article);
      readCandidates.delete(article);
      return;
    }

    if (readObserved.get(article)?.id === id) return;

    readObserver.unobserve(article);
    readCandidates.delete(article);

    readObserved.set(article, {
      id,
      parents: scrollParents(article),
    });

    readObserver.observe(article);
  }

  function readIntersections(entries) {
    if (!readEnabledHere()) return;

    const now = performance.now();

    for (const entry of entries) {
      const article = entry.target;
      const info = readObserved.get(article);

      if (!info || !article.isConnected || tweetId(article) !== info.id) {
        readCandidates.delete(article);
        continue;
      }

      if (
        entry.isIntersecting &&
        entry.intersectionRect.height > 0 &&
        !readCandidates.has(article)
      ) {
        const offset = scrollOffset(info.parents);
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
    if (!readEnabledHere() || !readCandidates.size || readTimer !== null) {
      return;
    }

    readTimer = setTimeout(() => {
      readTimer = null;
      scanReadCandidates();
    }, 100);
  }

  function scanReadCandidates() {
    if (!readEnabledHere()) return;

    const now = performance.now();
    const remove = [];
    const mark = [];

    for (const [article, candidate] of readCandidates) {
      if (
        !article.isConnected ||
        tweetId(article) !== candidate.id ||
        article.classList.contains("xuc-filter-folded")
      ) {
        remove.push(article);
        continue;
      }

      const rect = article.getBoundingClientRect();
      const bounds = visibleBounds(candidate.parents);
      const offset = scrollOffset(candidate.parents);

      const area = rect.width > 0 && rect.height > 0 &&
        bounds.bottom > bounds.top && bounds.right > bounds.left;

      const visible = area &&
        rect.bottom > bounds.top && rect.top < bounds.bottom &&
        rect.right > bounds.left && rect.left < bounds.right;

      const passed = area && rect.bottom <= bounds.top + 1;
      const movedDown = offset > candidate.lastOffset + .5;
      const movedSinceEntry = offset > candidate.startOffset + 2;
      const oldEnough = now - candidate.since >= C.readMinMs;

      if (passed && movedDown && movedSinceEntry && oldEnough) {
        mark.push([article, candidate.id]);
        remove.push(article);
      } else if (!visible) {
        remove.push(article);
      } else {
        candidate.lastOffset = offset;
      }
    }

    for (const article of remove) readCandidates.delete(article);

    for (const [article, id] of mark) {
      rememberRead(id);
      article.classList.add("xuc-read");
      readObserver?.unobserve(article);
      readObserved.delete(article);
    }
  }

  function refreshReadGeometry() {
    if (!readObserver) return;

    readCandidates.clear();

    for (const [article, info] of readObserved) {
      if (!article.isConnected) continue;
      info.parents = scrollParents(article);
      readObserver.unobserve(article);
      readObserver.observe(article);
    }
  }

  // ==================== 自动滚动 ====================

  function canAutoScroll() {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/home") return true;
    if (isDetail()) return false;

    const parts = path.split("/").filter(Boolean);

    return parts.length === 1 &&
      /^[A-Za-z0-9_]{1,15}$/.test(parts[0]) &&
      !RESERVED.has(parts[0].toLowerCase());
  }

  function documentHeight() {
    const root = document.scrollingElement || document.documentElement;
    return Math.max(root.scrollHeight, document.body?.scrollHeight || 0);
  }

  function autoPauseReason() {
    if (document.hidden) return "后台暂停";
    if (state.openPanel) return "面板打开，已暂停";
    if (document.fullscreenElement) return "全屏期间暂停";
    if (isEditing()) return "输入期间暂停";
    if (hasDialog()) return "弹窗打开，已暂停";

    if (Date.now() < manualPauseUntil) {
      const seconds = Math.ceil((manualPauseUntil - Date.now()) / 1000);
      return `手动操作暂停：${seconds} 秒后恢复`;
    }

    if (
      state.hoverPause &&
      hoveredTweet?.isConnected &&
      !hoveredTweet.classList.contains("xuc-filter-folded")
    ) {
      return "鼠标停在推文上，已暂停";
    }

    return "";
  }

  function setAutoStatus(text) {
    if (autoStatus === text) return;
    autoStatus = text;
    syncQuickButtons();
  }

  function stopAutoTimer() {
    clearTimeout(autoTimer);
    autoTimer = null;
  }

  function scheduleAutoTick() {
    if (!started || autoTimer !== null || !state.autoScrollEnabled) return;

    autoTimer = setTimeout(() => {
      autoTimer = null;
      autoTick();
    }, 500);
  }

  function restartAutoScroll() {
    stopAutoTimer();
    autoBottomPaused = false;
    autoBottomCount = 0;
    autoLastHeight = documentHeight();
    autoNextAt = Date.now() + state.autoScrollSeconds * 1000;

    if (!state.autoScrollEnabled) {
      setAutoStatus("已关闭");
      syncQuickButtons();
      return;
    }

    if (!canAutoScroll()) {
      setAutoStatus("当前页面不启用自动滚动");
      syncQuickButtons();
      return;
    }

    setAutoStatus("等待下一次滚动");
    syncQuickButtons();
    scheduleAutoTick();
  }

  function toggleAutoScroll() {
    if (state.autoScrollEnabled && autoBottomPaused) {
      manualPauseUntil = 0;
      restartAutoScroll();
      return;
    }

    changeSettings({
      autoScrollEnabled: !state.autoScrollEnabled,
    });
  }

  function autoTick() {
    if (!started || !state.autoScrollEnabled || autoBottomPaused) return;

    if (currentUrl !== location.href) {
      checkRoute();
      return;
    }

    if (!canAutoScroll()) {
      setAutoStatus("当前页面不启用自动滚动");
      return;
    }

    const pause = autoPauseReason();

    if (pause) {
      autoBottomCount = 0;
      autoNextAt = Date.now() + state.autoScrollSeconds * 1000;
      setAutoStatus(pause);
      scheduleAutoTick();
      return;
    }

    const remaining = autoNextAt - Date.now();

    if (remaining > 0) {
      setAutoStatus(`${Math.ceil(remaining / 1000)} 秒后滚动`);
      scheduleAutoTick();
      return;
    }

    autoNextAt = Date.now() + state.autoScrollSeconds * 1000;

    const height = documentHeight();
    const maxY = Math.max(0, height - innerHeight);

    if (window.scrollY >= maxY - 6) {
      autoBottomCount = height > autoLastHeight + 4
        ? 1
        : autoBottomCount + 1;
      autoLastHeight = height;

      if (autoBottomCount >= C.bottomChecks) {
        autoBottomPaused = true;
        setAutoStatus("底部暂无新内容；点击播放按钮继续");
        syncQuickButtons();
        notify("底部暂未加载新内容，自动滚动已暂停");
        return;
      }

      setAutoStatus(`等待底部加载（${autoBottomCount}/${C.bottomChecks}）`);
      scheduleAutoTick();
      return;
    }

    autoBottomCount = 0;
    autoLastHeight = height;

    window.scrollBy({
      top: Math.max(100, Math.floor(innerHeight * state.scrollPercent / 100)),
      behavior: reducedMotion.matches ? "instant" : "smooth",
    });

    setAutoStatus("正在滚动");
    scheduleAutoTick();
  }

  function pauseForManualInput() {
    manualPauseUntil = Date.now() + C.manualPauseMs;
    restoreToken++;
  }

  function onWheel(event) {
    if (!isOwn(event.target)) pauseForManualInput();
  }

  function onTouchMove(event) {
    if (!isOwn(event.target)) pauseForManualInput();
  }

  function onPointerMove(event) {
    if (event.pointerType && event.pointerType !== "mouse") return;
    hoveredTweet = isOwn(event.target)
      ? null
      : elementOf(event.target)?.closest(TWEET) || null;
  }

  function onPointerOut(event) {
    if (!event.relatedTarget) hoveredTweet = null;
  }

  function onPointerDown(event) {
    if (!isOwn(event.target)) {
      restoreToken++;
      if (
        event.target === document.documentElement ||
        event.target === document.body
      ) {
        manualPauseUntil = Date.now() + C.manualPauseMs;
      }
    }
  }

  // ==================== 快捷键 ====================

  function eventChord(event) {
    const parts = [];

    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");

    let key = event.key;
    if (key === " ") key = "Space";
    else if (key.length === 1) key = key.toUpperCase();

    parts.push(key);
    return parts.join("+");
  }

  function navigateTweet(direction) {
    const articles = visibleArticles();
    if (!articles.length) return;

    let index = -1;

    if (keyboardTweet?.isConnected) {
      const rect = keyboardTweet.getBoundingClientRect();
      if (rect.bottom > 60 && rect.top < innerHeight) {
        index = articles.indexOf(keyboardTweet);
      }
    }

    if (index < 0) {
      index = articles.findIndex(article => {
        const rect = article.getBoundingClientRect();
        return rect.bottom > 100 && rect.top < innerHeight;
      });
      if (index < 0) index = 0;
      if (direction < 0) index--;
    } else {
      index += direction;
    }

    index = Math.min(articles.length - 1, Math.max(0, index));
    const target = articles[index];

    keyboardTweet?.classList.remove("xuc-keyboard-current");
    keyboardTweet = target;
    target.classList.add("xuc-keyboard-current");

    manualPauseUntil = Date.now() + C.manualPauseMs;
    restoreToken++;

    const top = Math.max(
      0,
      window.scrollY + target.getBoundingClientRect().top - 80
    );

    window.scrollTo({
      top,
      behavior: reducedMotion.matches ? "instant" : "smooth",
    });

    clearTimeout(keyboardTimer);
    keyboardTimer = setTimeout(() => {
      target.classList.remove("xuc-keyboard-current");
    }, 1800);
  }

  function globalKeydown(event) {
    if (event.isComposing || event.keyCode === 229) return;

    // 面板中的快捷键录入交给工具栏自身处理。
    if (isOwn(event.target)) return;

    if (event.key === "Escape" && state.openPanel) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closePanel(true);
      return;
    }

    if (isEditing(event.target)) return;

    if (
      ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]
        .includes(event.key)
    ) {
      pauseForManualInput();
    }

    if (
      !state.shortcutsEnabled ||
      event.ctrlKey && event.altKey ||
      hasDialog()
    ) return;

    const chord = eventChord(event);
    const action = Object.entries(state.shortcuts)
      .find(([, value]) => value && value === chord)?.[0];

    if (!action) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (Date.now() - lastShortcutAt < 180) return;
    lastShortcutAt = Date.now();

    if (action === "next") navigateTweet(1);
    else if (action === "previous") navigateTweet(-1);
    else if (action === "scroll") {
      toggleAutoScroll();
      notify(state.autoScrollEnabled ? "自动滚动已开启" : "自动滚动已关闭");
    }
  }

  // ==================== DOM 增量监听 ====================

  function scheduleMutationFlush() {
    if (!started || mutationTimer !== null) return;
    mutationTimer = setTimeout(flushMutations, C.mutationDelay);
  }

  function mutations(records) {
    let relevant = false;

    for (const record of records) {
      if (isOwn(record.target)) continue;

      // 插入、删除脚本自己的提示控件，不重新扫描推文。
      if (record.type === "childList") {
        const changed = [...record.addedNodes, ...record.removedNodes];

        if (
          changed.length &&
          changed.every(node => isOwn(node)) &&
          !changed.some(node => node.id === C.toolbarId)
        ) continue;
      }

      const target = elementOf(record.target);
      if (!target) continue;

      const article = target.closest(TWEET);
      if (article) {
        dirtyTweets.add(article);
        relevant = true;
      }

      if (
        record.type === "attributes" &&
        record.attributeName === "aria-selected"
      ) {
        relevant = true;
      }

      if (record.type !== "childList") continue;

      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE || isOwn(node)) continue;
        collectTweets(node);
        relevant = true;
      }

      for (const node of record.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (
          !isOwn(node) ||
          node.id === C.toolbarId ||
          node.querySelector?.(`#${C.toolbarId}`)
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
      syncQuickButtons();
    }

    const pending = [...dirtyTweets];
    dirtyTweets.clear();

    for (const article of pending) processTweet(article);

    scheduleElevated();
  }

  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver(mutations);

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["href", "data-testid", "aria-selected"],
    });
  }

  // ==================== 路由与生命周期 ====================

  function checkRoute() {
    if (!started || !document.body) return;

    if (appliedBody !== document.body) applyAppearance();

    if (currentUrl !== location.href) {
      currentUrl = location.href;
      restoreToken++;
      keyboardTweet?.classList.remove("xuc-keyboard-current");
      keyboardTweet = null;
      hoveredTweet = null;
      manualPauseUntil = 0;

      closePanel(false);
      resetReadTracking();
      selectReadTimeline();
      syncReadMode();
      markAllTweets();
      restartAutoScroll();
      scheduleElevated();
      syncQuickButtons();
    }

    if (!document.getElementById(C.toolbarId)) {
      toolbarHovered = false;
      buildToolbar();
    }

    syncPalette();
  }

  function onVisibilityChange() {
    readCandidates.clear();
    hoveredTweet = null;

    if (document.hidden) {
      flushSaves();
    } else {
      checkRoute();
      refreshReadGeometry();
    }
  }

  function onResize() {
    positionToolbar();
    refreshReadGeometry();
  }

  function onOutsideClick(event) {
    if (state.openPanel && !isOwn(event.target)) closePanel(false);
  }

  function start() {
    if (started || !document.body) return;
    started = true;

    injectStyles();
    applyAppearance();
    buildToolbar();

    currentUrl = location.href;

    selectReadTimeline();
    syncReadMode();
    startObserver();
    markAllTweets();
    scheduleElevated();
    restartAutoScroll();

    routeTimer = setInterval(checkRoute, C.routeInterval);

    document.addEventListener("scroll", scheduleReadScan, {
      capture: true,
      passive: true,
    });
    document.addEventListener("wheel", onWheel, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("click", onOutsideClick);
    document.addEventListener("keydown", globalKeydown, true);

    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("popstate", checkRoute);
    window.addEventListener("hashchange", checkRoute);
  }

  function suspend() {
    if (!started) return;
    started = false;

    restoreToken++;
    flushSaves();
    stopAutoTimer();
    resetReadTracking();
    observer?.disconnect();
    observer = null;

    clearInterval(routeTimer);
    clearTimeout(mutationTimer);
    clearTimeout(elevatedTimer);
    clearTimeout(collapseTimer);
    clearTimeout(keyboardTimer);

    if (panelFrame !== null) cancelAnimationFrame(panelFrame);

    routeTimer = null;
    mutationTimer = null;
    elevatedTimer = null;
    collapseTimer = null;
    keyboardTimer = null;
    panelFrame = null;
    drag = null;
    dirtyTweets.clear();

    document.removeEventListener("scroll", scheduleReadScan, true);
    document.removeEventListener("wheel", onWheel);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerout", onPointerOut);
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("click", onOutsideClick);
    document.removeEventListener("keydown", globalKeydown, true);

    window.removeEventListener("resize", onResize);
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
