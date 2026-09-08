// ==UserScript==
// @name         X 界面增强工具
// @namespace    https://example.local/
// @version      1.0.0
// @description  仅提供 X 页面布局、主题、阅读设置、关键词过滤和自动滚动，不包含推文采集、导出、下载或书签同步。
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

  if (window.__xInterfaceEnhancerActive) {
    return;
  }
  window.__xInterfaceEnhancerActive = true;

  const CONFIG = {
    toolbarId: "x-merged-toolbar",
    fontSizeSliderId: "x-toolbar-font-size-slider",
    fontSizeValueId: "x-toolbar-font-size-value",
    lineHeightSliderId: "x-toolbar-line-height-slider",
    lineHeightValueId: "x-toolbar-line-height-value",
    searchInputId: "x-toolbar-search-input",
    searchSubmitId: "x-toolbar-search-submit",
    keywordInputId: "x-toolbar-keyword-input",
    keywordAddButtonId: "x-toolbar-keyword-add",
    keywordListId: "x-toolbar-keyword-list",
    widthValueId: "x-toolbar-width-value",
    widthSliderId: "x-toolbar-width-slider",
    autoScrollSecondsId: "xuc-auto-scroll-seconds",
    sidebarStorageKey: "xuc_sidebar_visible",
    blockedKeywordsStorageKey: "xuc_blocked_keywords",
    tweetWidthStorageKey: "xuc_tweet_width",
    themeStorageKey: "xuc_theme",
    fontSizeStorageKey: "xuc_font_size",
    lineHeightStorageKey: "xuc_line_height",
    serifStorageKey: "xuc_serif",
    focusModeStorageKey: "xuc_focus_mode",
    dimReadStorageKey: "xuc_dim_read",
    autoScrollStorageKey: "xuc_auto_scroll",
    autoScrollSecondsStorageKey: "xuc_auto_scroll_seconds",
    minTweetWidth: 500,
    maxTweetWidth: 1400,
    defaultTweetWidth: 900,
    minAutoScrollSeconds: 1,
    maxAutoScrollSeconds: 60,
    defaultAutoScrollSeconds: 5,
  };

  const TWEET_SELECTOR = 'article[data-testid="tweet"]';
  const THEMES = ["paper", "green", "dim", "oled"];

  function storageGet(key, fallbackValue) {
    try {
      return typeof GM_getValue === "function" ? GM_getValue(key, fallbackValue) : fallbackValue;
    } catch (error) {
      console.warn("[X 界面增强] 读取设置失败:", key, error);
      return fallbackValue;
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

  function addStyle(cssText) {
    if (typeof GM_addStyle === "function") {
      GM_addStyle(cssText);
      return;
    }
    const style = document.createElement("style");
    style.textContent = cssText;
    (document.head || document.documentElement).appendChild(style);
  }

  function debounce(fn, delay) {
    let timer = null;
    return function debounced(...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function clampTweetWidth(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return CONFIG.defaultTweetWidth;
    }
    return Math.round(Math.min(CONFIG.maxTweetWidth, Math.max(CONFIG.minTweetWidth, numeric)) / 50) * 50;
  }

  function normalizeBlockedKeywords(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => String(item || "").trim()).filter(Boolean)
      .filter((item, index, list) => list.indexOf(item) === index);
  }

  function normalizeTheme(value) {
    return THEMES.includes(value) ? value : "";
  }

  function clampFontSize(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 10 && numeric <= 20 ? Math.round(numeric) : 0;
  }

  function clampLineHeight(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0.6 && numeric <= 2
      ? Math.round(numeric * 10) / 10 : 0;
  }

  function clampAutoScrollSeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return CONFIG.defaultAutoScrollSeconds;
    }
    return Math.min(CONFIG.maxAutoScrollSeconds, Math.max(CONFIG.minAutoScrollSeconds, Math.round(numeric)));
  }

  const state = {
    openPanel: "",
    currentUrl: "",
    sidebarVisible: Boolean(storageGet(CONFIG.sidebarStorageKey, false)),
    blockedKeywords: normalizeBlockedKeywords(storageGet(CONFIG.blockedKeywordsStorageKey, [])),
    tweetWidth: clampTweetWidth(storageGet(CONFIG.tweetWidthStorageKey, CONFIG.defaultTweetWidth)),
    theme: normalizeTheme(storageGet(CONFIG.themeStorageKey, "")),
    fontSize: clampFontSize(storageGet(CONFIG.fontSizeStorageKey, 0)),
    lineHeight: clampLineHeight(storageGet(CONFIG.lineHeightStorageKey, 0)),
    serifFont: Boolean(storageGet(CONFIG.serifStorageKey, false)),
    focusMode: Boolean(storageGet(CONFIG.focusModeStorageKey, false)),
    dimRead: Boolean(storageGet(CONFIG.dimReadStorageKey, false)),
    autoScrollEnabled: Boolean(storageGet(CONFIG.autoScrollStorageKey, false)),
    autoScrollSeconds: clampAutoScrollSeconds(storageGet(CONFIG.autoScrollSecondsStorageKey, CONFIG.defaultAutoScrollSeconds)),
    keywordSignature: "",
    readTweetIds: new Set(),
  };

  let notificationContainer = null;
  let autoScrollTimer = null;
  let stylesInjected = false;
  let historyWatcherInstalled = false;
  let domObserver = null;
  let domObserverRoot = null;
  let readObserver = null;
  let readFrame = null;
  let readPageUrl = "";
  let readTimelinePath = "";
  const readCandidates = new Map();

  function ensureNotificationContainer() {
    if (!document.body) {
      return null;
    }
    if (notificationContainer && document.body.contains(notificationContainer)) {
      return notificationContainer;
    }
    notificationContainer = document.createElement("div");
    notificationContainer.id = "xuc-notification-container";
    notificationContainer.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none;";
    document.body.appendChild(notificationContainer);
    return notificationContainer;
  }

  function showNotification(message, type) {
    const container = ensureNotificationContainer();
    if (!container) {
      return;
    }
    const colors = { info: "#1685db", success: "#238b62", warning: "#a26b00", error: "#b42332" };
    const node = document.createElement("div");
    node.textContent = message;
    node.style.cssText = "max-width:360px;padding:10px 14px;border-radius:10px;background:" +
      (colors[type] || colors.info) +
      ";color:#fff;font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "box-shadow:0 10px 24px rgba(0,0,0,.22);pointer-events:auto;opacity:0;transform:translateX(100%);transition:opacity .2s ease,transform .2s ease;";
    container.appendChild(node);
    requestAnimationFrame(() => {
      node.style.opacity = "1";
      node.style.transform = "translateX(0)";
    });
    window.setTimeout(() => {
      node.style.opacity = "0";
      node.style.transform = "translateX(100%)";
      window.setTimeout(() => node.remove(), 220);
    }, 3000);
  }

  function getTweetUrl(article) {
    const time = article.querySelector("time");
    const anchor = time ? time.closest("a") : null;
    return anchor ? anchor.getAttribute("href") || "" : "";
  }

  function getTweetId(url) {
    const match = String(url || "").match(/\/status\/(\d+)/);
    return match ? match[1] : "";
  }

  function getReadScrollParents(article) {
    const parents = [];
    for (let node = article.parentElement; node && node !== document.body; node = node.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(node).overflowY)) {
        parents.push(node);
      }
    }
    return parents;
  }

  function getReadScrollOffset(parents) {
    return window.scrollY + parents.reduce((total, node) => total + node.scrollTop, 0);
  }

  function hasReadCandidatePassed(candidate) {
    const delta = getReadScrollOffset(candidate.parents) - candidate.offset;
    return delta > 0 && candidate.bottom - delta < candidate.top;
  }

  function clearReadTracking() {
    if (readObserver) {
      readObserver.disconnect();
      readObserver = null;
    }
    if (readFrame !== null) {
      window.cancelAnimationFrame(readFrame);
      readFrame = null;
    }
    document.removeEventListener("scroll", scheduleReadScan, true);
    document.removeEventListener("visibilitychange", ensureReadObserver);
    readCandidates.clear();
    document.querySelectorAll("article.xuc-read").forEach((node) => node.classList.remove("xuc-read"));
  }

  function scheduleReadScan() {
    if (readFrame === null) {
      readFrame = window.requestAnimationFrame(() => {
        readFrame = null;
        ensureReadObserver();
      });
    }
  }

  function ensureReadObserver() {
    if (readPageUrl !== window.location.href) {
      readCandidates.clear();
      const isDetailPage = /\/status\/\d+/.test(window.location.pathname);
      // 详情页属于当前时间线的临时路由，返回时保留原时间线的已读记录。
      if (!isDetailPage && readTimelinePath && readTimelinePath !== window.location.pathname) {
        state.readTweetIds.clear();
      }
      if (!isDetailPage) {
        readTimelinePath = window.location.pathname;
      }
      readPageUrl = window.location.href;
    }
    if (!state.dimRead || /\/status\/\d+/.test(window.location.pathname)) {
      clearReadTracking();
      return;
    }
    if (!readObserver && document.body) {
      readObserver = new MutationObserver(scheduleReadScan);
      readObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
      document.addEventListener("scroll", scheduleReadScan, { capture: true, passive: true });
      document.addEventListener("visibilitychange", ensureReadObserver);
    }
    if (document.hidden) {
      readCandidates.clear();
      return;
    }
    for (const [article, candidate] of readCandidates) {
      if (hasReadCandidatePassed(candidate)) {
        state.readTweetIds.add(candidate.id);
      }
      if (!article.isConnected || getTweetId(getTweetUrl(article)) !== candidate.id) {
        readCandidates.delete(article);
      }
    }
    document.querySelectorAll(TWEET_SELECTOR).forEach((article) => {
      const id = getTweetId(getTweetUrl(article));
      article.dataset.xucObserved = "true";
      article.classList.toggle("xuc-read", Boolean(id && state.readTweetIds.has(id)));
      const rect = article.getBoundingClientRect();
      const parents = getReadScrollParents(article);
      let top = 0;
      let bottom = window.innerHeight;
      for (const parent of parents) {
        const bounds = parent.getBoundingClientRect();
        top = Math.max(top, bounds.top + parent.clientTop);
        bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
      }
      const visible = id && rect.width > 0 && rect.height > 0 && rect.right > 0 &&
        rect.left < window.innerWidth && rect.bottom > top && rect.top < bottom && bottom > top;
      if (visible) {
        readCandidates.set(article, {
          id, parents, top, bottom: rect.bottom, offset: getReadScrollOffset(parents),
        });
      } else if (readCandidates.has(article)) {
        if (rect.height > 0 && rect.bottom < top) {
          state.readTweetIds.add(id);
          article.classList.toggle("xuc-read", Boolean(id));
        }
        readCandidates.delete(article);
      }
    });
  }

  function isUserProfilePath(pathname) {
    const parts = String(pathname || "").replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length !== 1) {
      return false;
    }
    return !new Set(["home", "explore", "notifications", "messages", "search", "compose",
      "settings", "i", "login", "signup", "tos", "privacy", "share", "intent"]).has(parts[0].toLowerCase());
  }

  function canAutoScrollCurrentPage() {
    return (window.location.pathname === "/home" || isUserProfilePath(window.location.pathname)) &&
      !/\/status\/\d+/.test(window.location.pathname);
  }

  function stopAutoScroll() {
    if (autoScrollTimer !== null) {
      window.clearInterval(autoScrollTimer);
      autoScrollTimer = null;
    }
  }

  function syncAutoScroll() {
    stopAutoScroll();
    if (!state.autoScrollEnabled || !canAutoScrollCurrentPage()) {
      return;
    }
    autoScrollTimer = window.setInterval(() => {
      if (!canAutoScrollCurrentPage()) {
        stopAutoScroll();
        return;
      }
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (window.scrollY >= maxScrollY - 4) {
        stopAutoScroll();
        showNotification("已到页面底部，自动滚动已停止", "success");
        return;
      }
      window.scrollBy({ top: Math.max(400, Math.floor(window.innerHeight * 0.8)), behavior: "smooth" });
    }, state.autoScrollSeconds * 1000);
  }

  function updateAutoScrollEnabled(enabled) {
    state.autoScrollEnabled = Boolean(enabled);
    storageSet(CONFIG.autoScrollStorageKey, state.autoScrollEnabled);
    syncAutoScroll();
    updateReadingControls();
  }

  function updateAutoScrollSeconds(seconds) {
    state.autoScrollSeconds = clampAutoScrollSeconds(seconds);
    storageSet(CONFIG.autoScrollSecondsStorageKey, state.autoScrollSeconds);
    syncAutoScroll();
    updateReadingControls();
  }

  function applySidebarState() {
    document.body?.classList.toggle("xuc-sidebar-visible", state.sidebarVisible);
  }

  function applyTweetWidth() {
    document.documentElement.style.setProperty("--xuc-tweet-width", state.tweetWidth + "px");
  }

  function applyTheme() {
    THEMES.forEach((theme) => document.body?.classList.toggle("xuc-theme-" + theme, state.theme === theme));
  }

  function tagElevatedBars() {
    if (!state.theme) {
      return;
    }
    document.querySelectorAll("main h2, main nav[role='navigation']").forEach((node) => {
      let current = node;
      for (let depth = 0; depth < 8 && current && current !== document.body; depth += 1) {
        if (current.hasAttribute("data-xuc-elevated")) {
          return;
        }
        if (getComputedStyle(current).position === "sticky") {
          current.setAttribute("data-xuc-elevated", "1");
          return;
        }
        current = current.parentElement;
      }
    });
  }

  function applyReadingPrefs() {
    if (!document.body) {
      return;
    }
    document.body.classList.toggle("xuc-font-custom", state.fontSize > 0);
    document.body.classList.toggle("xuc-lh-custom", state.lineHeight > 0);
    document.body.classList.toggle("xuc-serif", state.serifFont);
    document.body.classList.toggle("xuc-focus-mode", state.focusMode);
    const rootStyle = document.documentElement.style;
    if (state.fontSize > 0) rootStyle.setProperty("--xuc-font-size", state.fontSize + "px");
    else rootStyle.removeProperty("--xuc-font-size");
    if (state.lineHeight > 0) rootStyle.setProperty("--xuc-line-height", String(state.lineHeight));
    else rootStyle.removeProperty("--xuc-line-height");
  }

  function resetHiddenTweets() {
    document.querySelectorAll('[data-xuc-hidden-by-keyword="true"]').forEach((node) => {
      node.style.display = "";
      node.removeAttribute("data-xuc-hidden-by-keyword");
    });
    document.querySelectorAll(TWEET_SELECTOR + "[data-xuc-keyword-signature]").forEach((node) => {
      node.removeAttribute("data-xuc-keyword-signature");
    });
  }

  function applyKeywordFilters(force) {
    const signature = state.blockedKeywords.map((keyword) => keyword.toLowerCase()).sort().join("\n");
    if (force || state.keywordSignature !== signature) {
      state.keywordSignature = signature;
      resetHiddenTweets();
    }
    if (!state.blockedKeywords.length) {
      return;
    }
    const keywords = state.blockedKeywords.map((keyword) => keyword.toLowerCase());
    document.querySelectorAll(TWEET_SELECTOR).forEach((tweet) => {
      if (!force && tweet.dataset.xucKeywordSignature === signature) {
        return;
      }
      const container = tweet.closest('[data-testid="cellInnerDiv"]') || tweet;
      const matched = keywords.some((keyword) => (tweet.textContent || "").toLowerCase().includes(keyword));
      container.style.display = matched ? "none" : "";
      if (matched) container.setAttribute("data-xuc-hidden-by-keyword", "true");
      else container.removeAttribute("data-xuc-hidden-by-keyword");
      tweet.dataset.xucKeywordSignature = signature;
    });
  }

  function autoExpandTweets() {
    let expanded = false;
    document.querySelectorAll('[data-testid="tweet-text-show-more-link"]').forEach((button) => {
      if (button.dataset.xucExpanded === "true") return;
      if (button.tagName === "A" && button.getAttribute("href") && button.getAttribute("href") !== "#") return;
      button.dataset.xucExpanded = "true";
      button.click();
      expanded = true;
    });
    return expanded;
  }

  function renderKeywordTags() {
    const list = document.getElementById(CONFIG.keywordListId);
    if (!list) return;
    list.replaceChildren();
    state.blockedKeywords.forEach((keyword, index) => {
      const tag = document.createElement("div");
      tag.className = "xuc-keyword-tag";
      const text = document.createElement("span");
      text.textContent = keyword;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "删除关键词";
      remove.setAttribute("aria-label", "删除关键词：" + keyword);
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        state.blockedKeywords.splice(index, 1);
        storageSet(CONFIG.blockedKeywordsStorageKey, state.blockedKeywords);
        renderKeywordTags();
        applyKeywordFilters(true);
      });
      tag.append(text, remove);
      list.appendChild(tag);
    });
  }

  function updateWidthControls() {
    const value = document.getElementById(CONFIG.widthValueId);
    const slider = document.getElementById(CONFIG.widthSliderId);
    if (value) value.textContent = state.tweetWidth + "px";
    if (slider) slider.value = String(state.tweetWidth);
    document.querySelectorAll(".xuc-preset-btn").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.width) === state.tweetWidth);
    });
  }

  function updateReadingControls() {
    document.querySelectorAll(".xuc-theme-btn").forEach((button) => {
      button.classList.toggle("active", (button.dataset.theme || "") === state.theme);
    });
    const fontValue = document.getElementById(CONFIG.fontSizeValueId);
    const fontSlider = document.getElementById(CONFIG.fontSizeSliderId);
    if (fontValue) fontValue.textContent = state.fontSize > 0 ? state.fontSize + "px" : "默认";
    if (fontSlider) fontSlider.value = String(state.fontSize > 0 ? state.fontSize : 9);
    const lineValue = document.getElementById(CONFIG.lineHeightValueId);
    const lineSlider = document.getElementById(CONFIG.lineHeightSliderId);
    if (lineValue) lineValue.textContent = state.lineHeight > 0 ? state.lineHeight.toFixed(1) : "默认";
    if (lineSlider) lineSlider.value = String(state.lineHeight > 0 ? Math.round(state.lineHeight * 10) : 5);
    document.querySelector(".xuc-serif-toggle")?.classList.toggle("active", state.serifFont);
    document.querySelector(".xuc-focus-toggle")?.classList.toggle("active", state.focusMode);
    document.querySelector(".xuc-dimread-toggle")?.classList.toggle("active", state.dimRead);
    const autoToggle = document.querySelector(".xuc-auto-scroll-toggle");
    if (autoToggle) {
      autoToggle.classList.toggle("active", state.autoScrollEnabled);
      autoToggle.textContent = state.autoScrollEnabled ? "开启" : "关闭";
    }
    const seconds = document.getElementById(CONFIG.autoScrollSecondsId);
    if (seconds) seconds.value = String(state.autoScrollSeconds);
  }

  function syncPanelVisibility() {
    document.querySelector(".xuc-search-panel")?.classList.toggle("active", state.openPanel === "search");
    document.querySelector(".xuc-layout-panel")?.classList.toggle("active", state.openPanel === "layout");
    document.querySelector(".xuc-search-toggle")?.classList.toggle("active", state.openPanel === "search");
    document.querySelector(".xuc-layout-toggle")?.classList.toggle("active", state.openPanel === "layout");
  }

  function togglePanel(panelName) {
    state.openPanel = state.openPanel === panelName ? "" : panelName;
    syncPanelVisibility();
  }

  function updateTweetWidth(width) {
    state.tweetWidth = clampTweetWidth(width);
    storageSet(CONFIG.tweetWidthStorageKey, state.tweetWidth);
    applyTweetWidth();
    updateWidthControls();
  }

  function addBlockedKeyword() {
    const input = document.getElementById(CONFIG.keywordInputId);
    const value = String(input?.value || "").trim();
    if (!value || state.blockedKeywords.includes(value)) return;
    state.blockedKeywords.push(value);
    storageSet(CONFIG.blockedKeywordsStorageKey, state.blockedKeywords);
    input.value = "";
    renderKeywordTags();
    applyKeywordFilters(true);
  }

  function runToolbarSearch() {
    const query = String(document.getElementById(CONFIG.searchInputId)?.value || "").trim();
    if (query) window.location.href = window.location.origin + "/search?q=" + encodeURIComponent(query) + "&src=typed_query";
  }

  function getToolbarIcons() {
    return {
      menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"></path></svg>',
      search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.25 3.75a6.5 6.5 0 1 0 4.596 11.096l4.781 4.781 1.414-1.414-4.781-4.781A6.5 6.5 0 0 0 10.25 3.75zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z"></path></svg>',
      layout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4V6zm3 5h10v2H7v-2zm3 5h4v2h-4v-2z"></path></svg>',
    };
  }

  function injectAppStyles() {
    if (stylesInjected) return;
    const id = "#" + CONFIG.toolbarId;
    addStyle(
      ":root{--xuc-tweet-width:" + state.tweetWidth + "px}" +
      "[data-testid='sidebarColumn']{display:none!important}" +
      "body:not(.xuc-sidebar-visible) header[role='banner']{display:none!important}" +
      "body:not(.xuc-sidebar-visible) main[role='main']{width:100%!important;max-width:100%!important;align-items:center!important}" +
      "body:not(.xuc-sidebar-visible) main[role='main']>div,body:not(.xuc-sidebar-visible) main[role='main']>div>div{width:100%!important;max-width:100%!important;display:flex!important;justify-content:center!important}" +
      "body.xuc-sidebar-visible main[role='main']{align-items:flex-start!important}" +
      "body.xuc-sidebar-visible main[role='main']>div,body.xuc-sidebar-visible main[role='main']>div>div{justify-content:flex-start!important}" +
      "[data-testid='primaryColumn']{width:min(100%,var(--xuc-tweet-width))!important;max-width:var(--xuc-tweet-width)!important;margin:0 auto!important;flex-grow:1!important}" +
      "[data-testid='primaryColumn']>div,[data-testid='primaryColumn']>div>div,[data-testid='cellInnerDiv'],article[data-testid='tweet'],[data-testid='tweetText']{width:100%!important;max-width:none!important}" +
      "[data-testid='tweetText']{word-break:break-word!important;overflow-wrap:anywhere!important;line-height:1.45!important}" +
      "body[class*='xuc-theme-']{background:var(--xuc-bg)!important}" +
      "body.xuc-theme-paper{--xuc-bg:#f7f1e3;--xuc-bg-elevated:#fbf7ec;--xuc-text:#3e3428;--xuc-text-2nd:#8a7d68;--xuc-border:#e6dcc6}" +
      "body.xuc-theme-green{--xuc-bg:#cce8cf;--xuc-bg-elevated:#daf0dc;--xuc-text:#2f3e33;--xuc-text-2nd:#66796b;--xuc-border:#b4d9ba}" +
      "body.xuc-theme-dim{--xuc-bg:#15202b;--xuc-bg-elevated:#1c2732;--xuc-text:#f7f9f9;--xuc-text-2nd:#8b98a5;--xuc-border:#38444d}" +
      "body.xuc-theme-oled{--xuc-bg:#000;--xuc-bg-elevated:#080808;--xuc-text:#e7e9ea;--xuc-text-2nd:#71767b;--xuc-border:#2f3336}" +
      "body[class*='xuc-theme-'] main[role='main'],body[class*='xuc-theme-'] [data-testid='primaryColumn'],body[class*='xuc-theme-'] header[role='banner']{background-color:var(--xuc-bg)!important}" +
      "body[class*='xuc-theme-'] [data-xuc-elevated],body[class*='xuc-theme-'] [data-xuc-elevated]>div{background-color:var(--xuc-bg-elevated)!important;backdrop-filter:none!important}" +
      "body[class*='xuc-theme-'] main div,body[class*='xuc-theme-'] header[role='banner'] div{border-color:var(--xuc-border)!important}" +
      "body.xuc-theme-dim [data-testid='tweetText'],body.xuc-theme-dim [data-testid='tweetText'] span,body.xuc-theme-oled [data-testid='tweetText'],body.xuc-theme-oled [data-testid='tweetText'] span,body.xuc-theme-dim main h2,body.xuc-theme-oled main h2{color:var(--xuc-text)!important}" +
      "body.xuc-theme-dim article time,body.xuc-theme-oled article time{color:var(--xuc-text-2nd)!important}" +
      "body.xuc-font-custom [data-testid='tweetText']{font-size:var(--xuc-font-size)!important}" +
      "body.xuc-lh-custom [data-testid='tweetText']{line-height:var(--xuc-line-height)!important}" +
      "body.xuc-serif [data-testid='tweetText']{font-family:Georgia,'Times New Roman','Source Han Serif SC','Noto Serif SC',STSong,serif!important}" +
      "body.xuc-focus-mode article div[role='group'],body.xuc-focus-mode [data-testid='socialContext']{display:none!important}" +
      "article.xuc-read{opacity:.55!important;transition:opacity .4s ease!important}" +
      id + "{--xuc-panel-bg:rgba(24,29,36,.78);--xuc-control-bg:rgba(255,255,255,.08);--xuc-control-bg-hover:rgba(255,255,255,.14);--xuc-control-border:rgba(255,255,255,.16);--xuc-muted-text:#a9b3c0;position:fixed!important;right:20px!important;bottom:146px!important;z-index:2147483647!important;display:flex!important;flex-direction:column!important;align-items:flex-end!important;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;letter-spacing:0!important;color-scheme:dark;isolation:isolate}" +
      id + ", " + id + " *{box-sizing:border-box!important}" +
      id + " :is(button,input):focus-visible{outline:2px solid #69bfff!important;outline-offset:3px!important}" +
      id + " .xuc-toolbar-buttons{display:flex!important;flex-direction:column!important;align-items:center!important;gap:12px!important}" +
      id + " .xuc-toolbar-btn{width:55px!important;height:55px!important;padding:0!important;border:1px solid #d4d8de!important;border-radius:16px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important;color:#0f1419!important;background:#fff!important;box-shadow:0 3px 12px rgba(0,0,0,.12)!important;transition:background .18s ease,box-shadow .18s ease,border-color .18s ease!important}" +
      id + " .xuc-toolbar-btn:hover," + id + " .xuc-toolbar-btn.active{background:#e5f2ff!important;border-color:#1685db!important;color:#0866b0!important}" +
      id + " .xuc-sidebar-toggle.sidebar-enabled{background:#e9f8f1!important;border-color:#25875b!important;color:#146c46!important}" +
      id + " .xuc-toolbar-btn svg{width:30px!important;height:30px!important;fill:currentColor!important}" +
      id + " .xuc-panel{position:absolute!important;right:calc(100% + 14px)!important;bottom:0!important;display:none!important;width:min(380px,calc(100vw - 90px))!important;max-height:min(640px,calc(100dvh - 226px))!important;overflow-y:auto!important;padding:18px!important;border:1px solid var(--xuc-control-border)!important;border-radius:16px!important;background:var(--xuc-panel-bg)!important;color:#f2f3f5!important;box-shadow:0 22px 60px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.14)!important;-webkit-backdrop-filter:blur(18px) saturate(145%)!important;backdrop-filter:blur(18px) saturate(145%)!important;overscroll-behavior:contain;overflow-wrap:anywhere;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.28) transparent}" +
      id + " .xuc-panel.active{display:block!important}" +
      id + " .xuc-panel-title{margin:0 0 16px!important;padding-bottom:13px!important;border-bottom:1px solid rgba(255,255,255,.1)!important;font-size:17px!important;font-weight:700!important;letter-spacing:0!important;color:#fff!important}" +
      id + " .xuc-section-label{margin:16px 0 8px!important;color:var(--xuc-muted-text)!important;font-size:12px!important;font-weight:600!important}" +
      id + " .xuc-search-box," + id + " .xuc-input-row," + id + " .xuc-auto-scroll-control{display:flex!important;gap:8px!important;align-items:center!important}" +
      id + " input[type='text']," + id + " input[type='number']{min-width:0!important;padding:10px 12px!important;border:1px solid var(--xuc-control-border)!important;border-radius:6px!important;background:#121316!important;color:#fff!important;outline:none!important;min-height:40px!important;font:inherit;font-size:13px!important}" +
      id + " input[type='text']{flex:1 1 auto!important}" +
      id + " input[type='number']{width:72px!important;text-align:center!important}" +
      id + " .xuc-panel button{border:1px solid var(--xuc-control-border)!important;border-radius:9px!important;padding:8px 10px!important;min-height:38px!important;background:var(--xuc-control-bg)!important;color:#f7f9fa!important;cursor:pointer!important;font-size:12px!important;font-weight:550!important;line-height:1.5!important;transition:background-color .18s ease,border-color .18s ease,box-shadow .18s ease,transform .18s ease!important}" +
      id + " .xuc-panel button:not(:disabled):hover{border-color:rgba(124,196,255,.72)!important;background:var(--xuc-control-bg-hover)!important;box-shadow:0 5px 16px rgba(0,0,0,.16)!important;transform:translateY(-1px)!important}" +
      id + " .xuc-panel button:not(:disabled):active{transform:translateY(0)!important;box-shadow:none!important}" +
      id + " .xuc-panel button.xuc-primary{background:#096cba!important;border-color:transparent!important}" +
      id + " .xuc-panel button.active," + id + " .xuc-preset-btn.active{background:rgba(34,119,181,.42)!important;border-color:#62b8f2!important;color:#d9efff!important;box-shadow:0 0 0 1px rgba(98,184,242,.16),0 5px 16px rgba(22,133,219,.18)!important}" +
      id + " .xuc-theme-row," + id + " .xuc-toggle-row," + id + " .xuc-preset-row{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}" +
      id + " .xuc-theme-row{grid-template-columns:repeat(3,minmax(0,1fr))!important}" +
      id + " .xuc-theme-btn{display:flex!important;align-items:center!important;justify-content:center!important;gap:7px!important}" +
      id + " .xuc-theme-btn:before{content:'';width:8px!important;height:8px!important;border-radius:50%!important;background:#dbe7f0!important;box-shadow:0 0 0 2px rgba(255,255,255,.12)!important;flex:none!important}" +
      id + " .xuc-theme-btn[data-theme='paper']:before{background:#e7c98d!important}" +
      id + " .xuc-theme-btn[data-theme='green']:before{background:#8cc69a!important}" +
      id + " .xuc-theme-btn[data-theme='dim']:before{background:#65aee2!important}" +
      id + " .xuc-theme-btn[data-theme='oled']:before{background:#fff!important}" +
      id + " .xuc-toggle-row .xuc-toggle-btn{min-height:40px!important}" +
      id + " .xuc-toggle-row," + id + " .xuc-preset-row{margin-top:10px!important}" +
      id + " .xuc-slider-head," + id + " .xuc-auto-scroll-head," + id + " .xuc-width-head{display:flex!important;justify-content:space-between!important;align-items:center!important;margin:14px 0 6px!important;font-size:13px!important}" +
      id + " .xuc-slider-head strong," + id + " .xuc-width-head strong{color:#8fccfa!important;font-size:12px!important;font-variant-numeric:tabular-nums}" +
      id + " input[type='range']{width:100%!important;height:24px!important;margin:0!important;accent-color:#58b4ef;cursor:pointer}" +
      id + " .xuc-keyword-list{display:flex!important;flex-wrap:wrap!important;gap:8px!important;margin-top:12px!important}" +
      id + " .xuc-keyword-tag{display:inline-flex!important;align-items:center!important;gap:6px!important;padding:6px 9px!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:8px!important;max-width:100%!important;background:rgba(255,255,255,.09)!important;color:#e7e9ea!important;font-size:12px!important}" +
      id + " .xuc-keyword-tag button{padding:0!important;width:20px!important;height:20px!important;min-height:20px!important;border:none!important;border-radius:999px!important;background:transparent!important;color:#aeb8c4!important;font-size:16px!important;line-height:1!important}" +
      id + " .xuc-keyword-tag button:hover{background:rgba(255,255,255,.14)!important;color:#fff!important;transform:none!important;box-shadow:none!important}" +
      id + " .xuc-width-section," + id + " .xuc-auto-scroll-section{margin-top:16px!important;padding-top:16px!important;border-top:1px solid rgba(255,255,255,.1)!important}" +
      "@media(max-width:720px),(max-height:480px){" + id + "{right:12px!important;bottom:calc(76px + env(safe-area-inset-bottom,0px))!important}" +
      id + " .xuc-toolbar-buttons{flex-direction:row!important;gap:8px!important}" +
      id + " .xuc-panel{right:0!important;bottom:67px!important;width:min(380px,calc(100vw - 24px))!important;max-height:calc(100dvh - 210px - env(safe-area-inset-bottom,0px))!important;padding:16px!important}}" +
      "@media(prefers-reduced-motion:reduce){" + id + " *{transition:none!important}}"
    );
    stylesInjected = true;
  }

  function buildToolbar() {
    if (!document.body || document.getElementById(CONFIG.toolbarId)) return;
    injectAppStyles();
    const icons = getToolbarIcons();
    const toolbar = document.createElement("div");
    toolbar.id = CONFIG.toolbarId;
    toolbar.innerHTML =
      '<div class="xuc-toolbar-buttons">' +
      '<button type="button" class="xuc-toolbar-btn xuc-sidebar-toggle" title="显示或隐藏左侧导航" aria-label="显示或隐藏左侧导航">' + icons.menu + "</button>" +
      '<button type="button" class="xuc-toolbar-btn xuc-search-toggle" title="打开搜索" aria-label="打开搜索">' + icons.search + "</button>" +
      '<button type="button" class="xuc-toolbar-btn xuc-layout-toggle" title="打开布局与阅读设置" aria-label="打开布局与阅读设置">' + icons.layout + "</button></div>" +
      '<div class="xuc-panel xuc-search-panel"><div class="xuc-panel-title">搜索</div><div class="xuc-search-box">' +
      '<input id="' + CONFIG.searchInputId + '" type="text" placeholder="搜索 X..." aria-label="搜索 X" />' +
      '<button id="' + CONFIG.searchSubmitId + '" type="button" class="xuc-primary">搜索</button></div></div>' +
      '<div class="xuc-panel xuc-layout-panel"><div class="xuc-panel-title">布局与阅读</div>' +
      '<div class="xuc-section-label">主题</div><div class="xuc-theme-row">' +
      '<button type="button" class="xuc-theme-btn" data-theme="">默认</button><button type="button" class="xuc-theme-btn" data-theme="paper">米黄</button>' +
      '<button type="button" class="xuc-theme-btn" data-theme="green">豆绿</button><button type="button" class="xuc-theme-btn" data-theme="dim">Dim</button><button type="button" class="xuc-theme-btn" data-theme="oled">OLED</button></div>' +
      '<div class="xuc-slider-head"><span>正文字号</span><strong id="' + CONFIG.fontSizeValueId + '">默认</strong></div>' +
      '<input id="' + CONFIG.fontSizeSliderId + '" type="range" min="9" max="20" step="1" value="9" aria-label="正文字号 10 至 20 像素" />' +
      '<div class="xuc-slider-head"><span>正文行距</span><strong id="' + CONFIG.lineHeightValueId + '">默认</strong></div>' +
      '<input id="' + CONFIG.lineHeightSliderId + '" type="range" min="5" max="20" step="1" value="5" aria-label="正文行距 0.6 至 2.0" />' +
      '<div class="xuc-toggle-row"><button type="button" class="xuc-toggle-btn xuc-serif-toggle">衬线字体</button><button type="button" class="xuc-toggle-btn xuc-focus-toggle">聚焦模式</button><button type="button" class="xuc-toggle-btn xuc-dimread-toggle">已读淡化</button></div>' +
      '<div class="xuc-auto-scroll-section"><div class="xuc-auto-scroll-head"><span>自动滚动</span><button type="button" class="xuc-toggle-btn xuc-auto-scroll-toggle" aria-label="自动滚动">关闭</button></div>' +
      '<div class="xuc-auto-scroll-control"><label for="' + CONFIG.autoScrollSecondsId + '">每隔</label><input id="' + CONFIG.autoScrollSecondsId + '" type="number" min="1" max="60" step="1" aria-label="自动滚动间隔（秒）" /><span>秒向下滚动</span></div></div>' +
      '<div class="xuc-input-row" style="margin-top:14px;"><input id="' + CONFIG.keywordInputId + '" type="text" placeholder="添加屏蔽关键词" aria-label="屏蔽关键词" /><button id="' + CONFIG.keywordAddButtonId + '" type="button" class="xuc-primary">添加</button></div>' +
      '<div id="' + CONFIG.keywordListId + '" class="xuc-keyword-list"></div><div class="xuc-width-section"><div class="xuc-width-head"><span>推文宽度</span><strong id="' + CONFIG.widthValueId + '">' + state.tweetWidth + 'px</strong></div>' +
      '<input id="' + CONFIG.widthSliderId + '" type="range" min="' + CONFIG.minTweetWidth + '" max="' + CONFIG.maxTweetWidth + '" step="50" value="' + state.tweetWidth + '" aria-label="推文宽度" />' +
      '<div class="xuc-preset-row"><button type="button" class="xuc-preset-btn" data-width="600">窄</button><button type="button" class="xuc-preset-btn" data-width="800">中</button><button type="button" class="xuc-preset-btn" data-width="1000">宽</button><button type="button" class="xuc-preset-btn" data-width="1200">超宽</button></div></div></div>';
    toolbar.addEventListener("click", (event) => event.stopPropagation());
    toolbar.querySelector(".xuc-sidebar-toggle").addEventListener("click", () => {
      state.sidebarVisible = !state.sidebarVisible;
      storageSet(CONFIG.sidebarStorageKey, state.sidebarVisible);
      applySidebarState();
    });
    toolbar.querySelector(".xuc-search-toggle").addEventListener("click", () => {
      togglePanel("search");
      if (state.openPanel === "search") window.setTimeout(() => document.getElementById(CONFIG.searchInputId)?.focus(), 30);
    });
    toolbar.querySelector(".xuc-layout-toggle").addEventListener("click", () => {
      togglePanel("layout");
      if (state.openPanel === "layout") window.setTimeout(() => document.getElementById(CONFIG.keywordInputId)?.focus(), 30);
    });
    toolbar.querySelector("#" + CONFIG.searchSubmitId).addEventListener("click", runToolbarSearch);
    toolbar.querySelector("#" + CONFIG.searchInputId).addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); runToolbarSearch(); }
    });
    toolbar.querySelector("#" + CONFIG.keywordAddButtonId).addEventListener("click", addBlockedKeyword);
    toolbar.querySelector("#" + CONFIG.keywordInputId).addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); addBlockedKeyword(); }
    });
    toolbar.querySelector("#" + CONFIG.widthSliderId).addEventListener("input", (event) => updateTweetWidth(event.target.value));
    toolbar.querySelectorAll(".xuc-preset-btn").forEach((button) => button.addEventListener("click", () => updateTweetWidth(button.dataset.width)));
    toolbar.querySelectorAll(".xuc-theme-btn").forEach((button) => button.addEventListener("click", () => {
      state.theme = normalizeTheme(button.dataset.theme);
      storageSet(CONFIG.themeStorageKey, state.theme);
      applyTheme();
      tagElevatedBars();
      updateReadingControls();
    }));
    toolbar.querySelector("#" + CONFIG.fontSizeSliderId).addEventListener("input", (event) => {
      const raw = Number(event.target.value);
      state.fontSize = raw <= 9 ? 0 : clampFontSize(raw);
      storageSet(CONFIG.fontSizeStorageKey, state.fontSize);
      applyReadingPrefs();
      updateReadingControls();
    });
    toolbar.querySelector("#" + CONFIG.lineHeightSliderId).addEventListener("input", (event) => {
      const raw = Number(event.target.value) / 10;
      state.lineHeight = raw <= 0.5 ? 0 : clampLineHeight(raw);
      storageSet(CONFIG.lineHeightStorageKey, state.lineHeight);
      applyReadingPrefs();
      updateReadingControls();
    });
    toolbar.querySelector(".xuc-serif-toggle").addEventListener("click", () => {
      state.serifFont = !state.serifFont;
      storageSet(CONFIG.serifStorageKey, state.serifFont);
      applyReadingPrefs();
      updateReadingControls();
    });
    toolbar.querySelector(".xuc-focus-toggle").addEventListener("click", () => {
      state.focusMode = !state.focusMode;
      storageSet(CONFIG.focusModeStorageKey, state.focusMode);
      applyReadingPrefs();
      updateReadingControls();
    });
    toolbar.querySelector(".xuc-dimread-toggle").addEventListener("click", () => {
      state.dimRead = !state.dimRead;
      storageSet(CONFIG.dimReadStorageKey, state.dimRead);
      ensureReadObserver();
      updateReadingControls();
    });
    toolbar.querySelector(".xuc-auto-scroll-toggle").addEventListener("click", () => updateAutoScrollEnabled(!state.autoScrollEnabled));
    toolbar.querySelector("#" + CONFIG.autoScrollSecondsId).addEventListener("change", (event) => updateAutoScrollSeconds(event.target.value));
    document.body.appendChild(toolbar);
    renderKeywordTags();
    updateWidthControls();
    updateReadingControls();
  }

  function ensureToolbar() {
    if (!document.body) return;
    buildToolbar();
    applySidebarState();
    applyTweetWidth();
    applyTheme();
    applyReadingPrefs();
    renderKeywordTags();
    updateWidthControls();
    updateReadingControls();
    syncPanelVisibility();
    syncAutoScroll();
  }

  const refreshInterface = debounce(() => {
    if (state.currentUrl !== window.location.href) {
      state.currentUrl = window.location.href;
      state.openPanel = "";
      clearReadTracking();
    }
    startDomObserver();
    ensureToolbar();
    const expanded = autoExpandTweets();
    applyKeywordFilters(expanded);
    ensureReadObserver();
    tagElevatedBars();
    syncPanelVisibility();
    syncAutoScroll();
  }, 180);

  function installHistoryWatcher() {
    if (historyWatcherInstalled) return;
    historyWatcherInstalled = true;
    ["pushState", "replaceState"].forEach((methodName) => {
      const original = history[methodName];
      history[methodName] = function wrappedHistoryMethod(...args) {
        const result = original.apply(this, args);
        stopAutoScroll();
        window.setTimeout(refreshInterface, 0);
        return result;
      };
    });
    window.addEventListener("popstate", refreshInterface);
    window.addEventListener("hashchange", refreshInterface);
    window.addEventListener("pagehide", clearReadTracking);
    window.addEventListener("pageshow", ensureReadObserver);
    window.addEventListener("beforeunload", stopAutoScroll, { once: true });
    document.addEventListener("click", () => {
      if (state.openPanel) {
        state.openPanel = "";
        syncPanelVisibility();
      }
    });
  }

  function startDomObserver() {
    const root = document.querySelector('[data-testid="primaryColumn"]') ||
      document.querySelector('main[role="main"]') || document.body;
    if (!root) return;
    if (domObserver && domObserverRoot === root) return;
    domObserver?.disconnect();
    domObserverRoot = root;
    domObserver = new MutationObserver(refreshInterface);
    domObserver.observe(root, { childList: true, subtree: true });
  }

  function bootstrap() {
    state.currentUrl = window.location.href;
    injectAppStyles();
    ensureToolbar();
    installHistoryWatcher();
    startDomObserver();
    refreshInterface();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
