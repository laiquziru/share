// ==UserScript==
// @name         X 用户主页推文采集器
// @namespace    https://example.local/
// @version      0.6.0
// @description  合并宽屏布局、搜索、关键词过滤、时间线采集导出与书签同步功能的 X userscript。
// @author       Codex
// @match        https://x.com/*
// @match        https://twitter.com/*
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @connect      abs.twimg.com
// @connect      ton.twimg.com
// @connect      x.com
// @connect      dl.lqzr.me
// @connect      lqzr.me
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  if (window.__xMergedCollectorActive) {
    return;
  }
  window.__xMergedCollectorActive = true;

  const CONFIG = {
    toolbarId: "x-merged-toolbar",
    panelId: "x-tweet-collector-panel",
    scopeId: "x-tweet-collector-scope",
    statusId: "x-tweet-collector-status",
    startButtonId: "x-tweet-collector-start",
    stopButtonId: "x-tweet-collector-stop",
    exportJsonButtonId: "x-tweet-collector-export-json",
    exportCsvButtonId: "x-tweet-collector-export-csv",
    exportMdButtonId: "x-tweet-collector-export-md",
    downloadMediaButtonId: "x-tweet-collector-download-media",
    syncConfigButtonId: "x-tweet-collector-sync-config",
    syncWidgetId: "xuc-bookmark-sync-widget",
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
    sidebarStorageKey: "xuc_sidebar_visible",
    blockedKeywordsStorageKey: "xuc_blocked_keywords",
    tweetWidthStorageKey: "xuc_tweet_width",
    themeStorageKey: "xuc_theme",
    fontSizeStorageKey: "xuc_font_size",
    lineHeightStorageKey: "xuc_line_height",
    serifStorageKey: "xuc_serif",
    focusModeStorageKey: "xuc_focus_mode",
    dimReadStorageKey: "xuc_dim_read",
    minTweetWidth: 500,
    maxTweetWidth: 1400,
    defaultTweetWidth: 900,
    maxIdleRounds: 8,
    maxScrollRounds: 400,
    maxTweets: 3000,
    scrollStepFactor: 1.7,
    scrollDelayMs: 1400,
    settleDelayMs: 1800,
    topResetDelayMs: 1500,
  };

  const TWEET_SELECTOR = 'article[data-testid="tweet"]';
  const BOOKMARK_SYNC_HOOK_FLAGS = {
    fetch: "__xucBookmarkSyncFetchWrapped",
    xhrOpen: "__xucBookmarkSyncXhrOpenWrapped",
    xhrSend: "__xucBookmarkSyncXhrSendWrapped",
    historyPushState: "__xucHistoryPushStateWrapped",
    historyReplaceState: "__xucHistoryReplaceStateWrapped",
  };


  const BOOKMARK_SYNC_STORAGE_KEYS = {
    workerUrl: "xuc_bookmark_sync_worker_url",
    apiKey: "xuc_bookmark_sync_api_key",
  };

  function storageGet(key, fallbackValue) {
    try {
      if (typeof GM_getValue === "function") {
        return GM_getValue(key, fallbackValue);
      }
    } catch (error) {
      console.warn("[X Collector] storageGet failed:", key, error);
    }
    return fallbackValue;
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
      }
    } catch (error) {
      console.warn("[X Collector] storageSet failed:", key, error);
    }
  }

  function addStyle(cssText) {
    if (typeof GM_addStyle === "function") {
      GM_addStyle(cssText);
      return;
    }

    const style = document.createElement("style");
    style.textContent = cssText;
    document.documentElement.appendChild(style);
  }

  function clampTweetWidth(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return CONFIG.defaultTweetWidth;
    }

    const clamped = Math.min(CONFIG.maxTweetWidth, Math.max(CONFIG.minTweetWidth, numeric));
    return Math.round(clamped / 50) * 50;
  }

  function normalizeBlockedKeywords(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .filter((item, index, list) => list.indexOf(item) === index);
  }

  const THEMES = ["paper", "green", "dim", "oled"];

  function normalizeTheme(value) {
    return THEMES.includes(value) ? value : "";
  }

  // 字号/行距返回 0 表示不覆盖 X 默认值
  function clampFontSize(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 14 || numeric > 20) {
      return 0;
    }
    return Math.round(numeric);
  }

  function clampLineHeight(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 1.3 || numeric > 2) {
      return 0;
    }
    return Math.round(numeric * 10) / 10;
  }

  const state = {
    running: false,
    tweets: [],
    tweetMap: new Map(),
    stopRequested: false,
    currentUrl: "",
    openPanel: "",
    toolbarReady: false,
    sidebarVisible: Boolean(storageGet(CONFIG.sidebarStorageKey, false)),
    blockedKeywords: normalizeBlockedKeywords(storageGet(CONFIG.blockedKeywordsStorageKey, [])),
    tweetWidth: clampTweetWidth(storageGet(CONFIG.tweetWidthStorageKey, CONFIG.defaultTweetWidth)),
    keywordSignature: "",
    theme: normalizeTheme(storageGet(CONFIG.themeStorageKey, "")),
    fontSize: clampFontSize(storageGet(CONFIG.fontSizeStorageKey, 0)),
    lineHeight: clampLineHeight(storageGet(CONFIG.lineHeightStorageKey, 0)),
    serifFont: Boolean(storageGet(CONFIG.serifStorageKey, false)),
    focusMode: Boolean(storageGet(CONFIG.focusModeStorageKey, false)),
    dimRead: Boolean(storageGet(CONFIG.dimReadStorageKey, false)),
    readTweetIds: new Set(),
  };

  let notificationContainer = null;
  let bookmarkSyncHooksInstalled = false;
  const bookmarkProcessingIds = new Set();
  const bookmarkSyncedCache = new Set();

  function getBookmarkSyncConfig() {
    return {
      workerUrl: String(storageGet(BOOKMARK_SYNC_STORAGE_KEYS.workerUrl, "") || "").trim().replace(/\/$/, ""),
      apiKey: String(storageGet(BOOKMARK_SYNC_STORAGE_KEYS.apiKey, "") || "").trim(),
    };
  }

  function showBookmarkSyncConfigDialog() {
    // X 页面会拦截 window.prompt，必须用自绘弹窗
    const existingMask = document.getElementById("xuc-sync-config-mask");
    if (existingMask) {
      existingMask.remove();
    }

    const current = getBookmarkSyncConfig();
    const mask = document.createElement("div");
    mask.id = "xuc-sync-config-mask";
    mask.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

    const dialog = document.createElement("div");
    dialog.style.cssText =
      "width:min(440px,calc(100vw - 32px));background:#15202b;color:#e7e9ea;border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:20px;box-shadow:0 18px 40px rgba(0,0,0,0.4);";
    dialog.innerHTML = `
      <div style="font-size:16px;font-weight:700;margin-bottom:14px;">书签同步配置</div>
      <label style="display:block;font-size:12px;color:#8b98a5;margin-bottom:6px;">Worker URL</label>
      <input id="xuc-sync-worker-input" type="text" placeholder="https://media-sync-worker.xxx.workers.dev"
        style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #2f3336;border-radius:10px;background:#0f1419;color:#fff;outline:none;margin-bottom:12px;" />
      <label style="display:block;font-size:12px;color:#8b98a5;margin-bottom:6px;">API Key</label>
      <input id="xuc-sync-key-input" type="password" placeholder="Worker 端校验密钥"
        style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #2f3336;border-radius:10px;background:#0f1419;color:#fff;outline:none;margin-bottom:8px;" />
      <div style="font-size:12px;color:#8b98a5;line-height:1.5;margin-bottom:14px;">两项均填写后书签同步才会工作；保存后刷新页面生效。若 Worker 域名不在脚本 @connect 列表中，请求时油猴会弹授权确认。</div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="xuc-sync-cancel" type="button" style="padding:8px 16px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;background:#15202b;color:#fff;cursor:pointer;">取消</button>
        <button id="xuc-sync-save" type="button" style="padding:8px 16px;border:none;border-radius:10px;background:#1d9bf0;color:#fff;cursor:pointer;">保存</button>
      </div>
    `;

    mask.appendChild(dialog);
    document.body.appendChild(mask);

    const workerInput = dialog.querySelector("#xuc-sync-worker-input");
    const keyInput = dialog.querySelector("#xuc-sync-key-input");
    workerInput.value = current.workerUrl;
    keyInput.value = current.apiKey;

    const close = () => mask.remove();
    mask.addEventListener("click", (event) => {
      if (event.target === mask) {
        close();
      }
    });
    dialog.addEventListener("click", (event) => event.stopPropagation());
    dialog.querySelector("#xuc-sync-cancel").addEventListener("click", close);
    dialog.querySelector("#xuc-sync-save").addEventListener("click", () => {
      storageSet(BOOKMARK_SYNC_STORAGE_KEYS.workerUrl, String(workerInput.value).trim().replace(/\/$/, ""));
      storageSet(BOOKMARK_SYNC_STORAGE_KEYS.apiKey, String(keyInput.value).trim());
      close();
      showNotification("书签同步配置已保存，刷新页面后生效", "success");
    });

    window.setTimeout(() => workerInput.focus(), 30);
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== "function") {
      return;
    }

    GM_registerMenuCommand("设置书签同步配置", showBookmarkSyncConfigDialog);
  }

  function ensureNotificationContainer() {
    if (!document.body) {
      return null;
    }

    if (notificationContainer && document.body.contains(notificationContainer)) {
      return notificationContainer;
    }

    notificationContainer = document.createElement("div");
    notificationContainer.id = "xuc-notification-container";
    notificationContainer.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none;";
    document.body.appendChild(notificationContainer);
    return notificationContainer;
  }

  function showNotification(text, type = "info", duration = 4000) {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", () => showNotification(text, type, duration), { once: true });
      return null;
    }

    const container = ensureNotificationContainer();
    if (!container) {
      return null;
    }

    const colors = {
      info: "#1d9bf0",
      success: "#00ba7c",
      error: "#f4212e",
      warning: "#ffad1f",
    };

    const node = document.createElement("div");
    node.style.cssText = [
      `background:${colors[type] || colors.info}`,
      "color:#fff",
      "padding:10px 16px",
      "border-radius:10px",
      "font-size:14px",
      "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "box-shadow:0 10px 24px rgba(0,0,0,0.25)",
      "max-width:360px",
      "word-break:break-word",
      "pointer-events:auto",
      "opacity:0",
      "transform:translateX(100%)",
      "transition:opacity 0.3s ease,transform 0.3s ease",
    ].join(";");
    node.textContent = text;
    container.appendChild(node);

    window.requestAnimationFrame(() => {
      node.style.opacity = "1";
      node.style.transform = "translateX(0)";
    });

    if (duration > 0) {
      window.setTimeout(() => {
        node.style.opacity = "0";
        node.style.transform = "translateX(100%)";
        window.setTimeout(() => node.remove(), 300);
      }, duration);
    }

    return node;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isUserProfilePath(pathname) {
    if (!pathname || pathname === "/") {
      return false;
    }

    const cleanPath = pathname.replace(/\/+$/, "");
    const parts = cleanPath.split("/").filter(Boolean);
    if (parts.length !== 1) {
      return false;
    }

    const blocked = new Set([
      "home",
      "explore",
      "notifications",
      "messages",
      "search",
      "compose",
      "settings",
      "i",
      "login",
      "signup",
      "tos",
      "privacy",
      "share",
      "intent",
    ]);

    return !blocked.has(parts[0].toLowerCase());
  }

  function isHomePath(pathname) {
    return pathname === "/home";
  }

  function canCollectCurrentPage(pathname) {
    return isUserProfilePath(pathname) || isHomePath(pathname);
  }

  function getCollectionScope() {
    if (isHomePath(window.location.pathname)) {
      return {
        mode: "home",
        key: "home-feed",
        label: "首页 For you / Following 时间线",
      };
    }

    if (isUserProfilePath(window.location.pathname)) {
      const handle = getTargetHandle();
      return {
        mode: "profile",
        key: handle || "profile",
        label: `@${handle}`,
      };
    }

    return {
      mode: "unsupported",
      key: "unsupported",
      label: "不支持的页面",
    };
  }

  function getTargetHandle() {
    const parts = window.location.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length !== 1) {
      return "";
    }
    return parts[0];
  }

  function sanitizeFilePart(value) {
    return String(value || "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "export";
  }

  function csvEscape(value) {
    let text = String(value ?? "");
    // 推文文本不可信，防止 Excel 公式注入
    if (/^[=+@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
  }

  function parseCount(label) {
    if (!label) {
      return "";
    }

    const match = String(label).match(/([\d,.]+\s*(?:[KMB]|万|亿)?)/i);
    return match ? match[1].replace(/\s+/g, "") : "";
  }

  function getArticleTimeAnchor(article) {
    const timeNode = article.querySelector("time");
    return timeNode ? timeNode.closest("a") : null;
  }

  function getTweetUrl(article) {
    const timeAnchor = getArticleTimeAnchor(article);
    if (timeAnchor && timeAnchor.href) {
      return timeAnchor.href;
    }

    const statusAnchor = Array.from(article.querySelectorAll('a[href*="/status/"]')).find((node) =>
      /\/status\/\d+/.test(node.href)
    );
    return statusAnchor ? statusAnchor.href : "";
  }

  function getTweetId(url) {
    const match = String(url).match(/\/status\/(\d+)/);
    return match ? match[1] : "";
  }

  function getProfileAnchors(article) {
    return Array.from(article.querySelectorAll('a[href^="/"]')).filter((anchor) => {
      const href = anchor.getAttribute("href") || "";
      if (!href || href.startsWith("/i/")) {
        return false;
      }
      if (href.includes("/status/")) {
        return false;
      }
      return /^\/[A-Za-z0-9_]+$/.test(href);
    });
  }

  function getAuthorInfo(article, tweetUrl) {
    const urlMatch = String(tweetUrl).match(/(?:x|twitter)\.com\/([^/]+)\/status\/\d+/i);
    const handleFromUrl = urlMatch ? urlMatch[1] : "";
    const timeAnchor = getArticleTimeAnchor(article);
    const authorContainer =
      (timeAnchor && timeAnchor.closest('[data-testid="User-Name"]')) ||
      article.querySelector('[data-testid="User-Name"]');

    let name = "";
    if (authorContainer) {
      const textCandidates = Array.from(authorContainer.querySelectorAll("span"))
        .map((node) => (node.textContent || "").trim())
        .filter((value) => value && !value.startsWith("@") && value !== "·");
      name = textCandidates[0] || "";
    }

    if (!handleFromUrl) {
      const anchors = getProfileAnchors(article);
      const handleAnchor = anchors.find((anchor) => /^\/[A-Za-z0-9_]+$/.test(anchor.getAttribute("href") || ""));
      const fallbackHandle = handleAnchor ? (handleAnchor.getAttribute("href") || "").slice(1) : "";
      return { handle: fallbackHandle, name };
    }

    return { handle: handleFromUrl, name };
  }

  function getTweetText(article) {
    const textNodes = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
    if (!textNodes.length) {
      return "";
    }
    return (textNodes[0].textContent || "").trim();
  }

  function getQuotedText(article) {
    const textNodes = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
    if (textNodes.length <= 1) {
      return "";
    }
    return textNodes
      .slice(1)
      .map((node) => (node.textContent || "").trim())
      .filter(Boolean)
      .join("\n---\n");
  }

  function upgradeImageUrl(url) {
    // pbs.twimg.com 的图片 src 通常是缩略图（name=small/900x900），改写为原图
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "pbs.twimg.com" && parsed.pathname.startsWith("/media/")) {
        parsed.searchParams.set("name", "orig");
        return parsed.href;
      }
    } catch {
      // 非法 URL 原样返回
    }
    return url;
  }

  function getMediaUrls(article) {
    const urls = new Set();

    Array.from(article.querySelectorAll('a[href*="/photo/"] img[src]')).forEach((img) => {
      if (img.src) {
        urls.add(upgradeImageUrl(img.src));
      }
    });

    Array.from(article.querySelectorAll("video")).forEach((video) => {
      if (video.poster) {
        urls.add(video.poster);
      }
      // X 的视频流是 blob: URL，导出后无法访问，跳过
      if (video.currentSrc && !video.currentSrc.startsWith("blob:")) {
        urls.add(video.currentSrc);
      }
      Array.from(video.querySelectorAll("source")).forEach((source) => {
        if (source.src && !source.src.startsWith("blob:")) {
          urls.add(source.src);
        }
      });
    });

    Array.from(article.querySelectorAll('img[src*="pbs.twimg.com/media"]')).forEach((img) => {
      if (img.src) {
        urls.add(upgradeImageUrl(img.src));
      }
    });

    return Array.from(urls);
  }

  function getMetricMap(article) {
    // 通过 data-testid 定位按钮，避免依赖界面语言（aria-label 在中文界面下是「回复」「喜欢」）
    const readMetric = (testId) => {
      const button = article.querySelector(`button[data-testid="${testId}"]`);
      if (!button) {
        return "";
      }
      return parseCount((button.textContent || "").trim()) || parseCount(button.getAttribute("aria-label") || "");
    };

    const metricMap = {
      replies: readMetric("reply"),
      reposts: readMetric("retweet"),
      likes: readMetric("like"),
      views: "",
    };

    const analyticsAnchor = article.querySelector('a[href$="/analytics"]');
    if (analyticsAnchor) {
      metricMap.views = parseCount(analyticsAnchor.textContent || analyticsAnchor.getAttribute("aria-label") || "");
    }

    return metricMap;
  }

  function buildTweetRecord(article, targetHandle) {
    const url = getTweetUrl(article);
    const tweetId = getTweetId(url);
    if (!url || !tweetId) {
      return null;
    }

    const { handle: authorHandle, name: authorName } = getAuthorInfo(article, url);
    const timeNode = article.querySelector("time");
    const metrics = getMetricMap(article);

    return {
      tweetId,
      url,
      targetHandle,
      authorHandle,
      authorName,
      isRepost: Boolean(authorHandle && targetHandle && authorHandle.toLowerCase() !== targetHandle.toLowerCase()),
      capturedAt: new Date().toISOString(),
      publishedAt: timeNode ? timeNode.getAttribute("datetime") || "" : "",
      text: getTweetText(article),
      quotedText: getQuotedText(article),
      mediaUrls: getMediaUrls(article),
      replies: metrics.replies,
      reposts: metrics.reposts,
      likes: metrics.likes,
      views: metrics.views,
    };
  }

  function collectVisibleTweets() {
    const targetHandle = getCollectionScope().mode === "profile" ? getTargetHandle() : "";
    const articles = Array.from(document.querySelectorAll(TWEET_SELECTOR));
    let newCount = 0;

    for (const article of articles) {
      const record = buildTweetRecord(article, targetHandle);
      if (!record) {
        continue;
      }
      if (state.tweetMap.has(record.tweetId)) {
        continue;
      }

      state.tweetMap.set(record.tweetId, record);
      state.tweets.push(record);
      newCount += 1;

      if (state.tweets.length >= CONFIG.maxTweets) {
        break;
      }
    }

    return newCount;
  }

  function buildCsv(rows) {
    const header = [
      "tweetId",
      "targetHandle",
      "authorHandle",
      "authorName",
      "isRepost",
      "publishedAt",
      "capturedAt",
      "url",
      "text",
      "quotedText",
      "mediaUrls",
      "replies",
      "reposts",
      "likes",
      "views",
    ];

    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push(
        [
          row.tweetId,
          row.targetHandle,
          row.authorHandle,
          row.authorName,
          row.isRepost,
          row.publishedAt,
          row.capturedAt,
          row.url,
          row.text,
          row.quotedText,
          (row.mediaUrls || []).join(" | "),
          row.replies,
          row.reposts,
          row.likes,
          row.views,
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    // UTF-8 BOM，避免 Excel 打开中文乱码
    return String.fromCharCode(0xfeff) + lines.join("\r\n");
  }

  function buildMarkdown(rows) {
    const scope = getCollectionScope();
    const now = new Date().toISOString();
    const lines = [];

    lines.push(`# X 推文采集导出`);
    lines.push("");
    lines.push(`- 采集范围: ${scope.label}`);
    lines.push(`- 导出时间: ${now}`);
    lines.push(`- 推文数量: ${rows.length}`);
    lines.push(`- 数据用途: 供 AI 做主题分析、情绪分析、事件梳理、观点归纳`);
    lines.push("");
    lines.push(`## 数据说明`);
    lines.push("");
    lines.push(`- \`isRepost\`: 是否为转发内容`);
    lines.push(`- \`quotedText\`: 引用推文正文，若无则为空`);
    lines.push(`- \`mediaUrls\`: 当前卡片里可提取到的媒体链接`);
    lines.push("");
    lines.push(`## 推文列表`);
    lines.push("");

    rows.forEach((row, index) => {
      lines.push(`### ${index + 1}. ${row.authorName || row.authorHandle || "Unknown"}${row.authorHandle ? ` (@${row.authorHandle})` : ""}`);
      lines.push("");
      lines.push(`- tweetId: \`${row.tweetId}\``);
      lines.push(`- publishedAt: ${row.publishedAt || ""}`);
      lines.push(`- capturedAt: ${row.capturedAt || ""}`);
      lines.push(`- isRepost: ${row.isRepost ? "true" : "false"}`);
      lines.push(`- url: ${row.url || ""}`);
      lines.push(`- replies: ${row.replies || ""}`);
      lines.push(`- reposts: ${row.reposts || ""}`);
      lines.push(`- likes: ${row.likes || ""}`);
      lines.push(`- views: ${row.views || ""}`);
      lines.push("");
      lines.push(`#### 正文`);
      lines.push("");
      lines.push(row.text ? row.text : `（无正文，可能是纯视频帖或主页流未展开正文）`);
      lines.push("");

      if (row.quotedText) {
        lines.push(`#### 引用内容`);
        lines.push("");
        lines.push(row.quotedText);
        lines.push("");
      }

      if (row.mediaUrls && row.mediaUrls.length) {
        lines.push(`#### 媒体链接`);
        lines.push("");
        row.mediaUrls.forEach((mediaUrl) => {
          lines.push(`- ${mediaUrl}`);
        });
        lines.push("");
      }

      lines.push(`---`);
      lines.push("");
    });

    return lines.join("\n");
  }

  function triggerDownload(filename, content, mimeType) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportJsonOnly() {
    if (!state.tweets.length) {
      window.alert("当前没有可导出的采集结果。");
      return;
    }
    const handle = sanitizeFilePart(getCollectionScope().key);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonName = `x-${handle}-tweets-${stamp}.json`;
    triggerDownload(jsonName, JSON.stringify(state.tweets, null, 2), "application/json;charset=utf-8");
  }

  function exportCsvOnly() {
    if (!state.tweets.length) {
      window.alert("当前没有可导出的采集结果。");
      return;
    }
    const handle = sanitizeFilePart(getCollectionScope().key);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const csvName = `x-${handle}-tweets-${stamp}.csv`;
    triggerDownload(csvName, buildCsv(state.tweets), "text/csv;charset=utf-8");
  }

  function exportMarkdownOnly() {
    if (!state.tweets.length) {
      window.alert("当前没有可导出的采集结果。");
      return;
    }
    const handle = sanitizeFilePart(getCollectionScope().key);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const mdName = `x-${handle}-tweets-${stamp}.md`;
    triggerDownload(mdName, buildMarkdown(state.tweets), "text/markdown;charset=utf-8");
  }

  function getExtensionFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
      return match ? match[1].toLowerCase() : "bin";
    } catch {
      return "bin";
    }
  }

  function guessMediaType(url) {
    const lower = String(url || "").toLowerCase();
    if (/\.(mp4|mov|m4v|webm)(?:$|[?#])/.test(lower) || lower.includes("/ext_tw_video/")) {
      return "video";
    }
    if (/\.(jpg|jpeg|png|webp|gif)(?:$|[?#])/.test(lower) || lower.includes("pbs.twimg.com/media")) {
      return "image";
    }
    return "unknown";
  }

  function gmRequestBlob(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("当前油猴环境不支持 GM_xmlhttpRequest"));
        return;
      }

      GM_xmlhttpRequest({
        url,
        method: "GET",
        responseType: "blob",
        onload: (response) => {
          if (response.status >= 200 && response.status < 300 && response.response) {
            resolve(response.response);
            return;
          }
          reject(new Error(`HTTP ${response.status}`));
        },
        onerror: reject,
        ontimeout: reject,
      });
    });
  }

  async function downloadMedia() {
    if (!state.tweets.length) {
      window.alert("当前没有可下载媒体的采集结果。");
      return;
    }

    if (typeof fflate === "undefined") {
      window.alert("fflate 未加载成功，暂时无法打包下载。");
      return;
    }

    const mediaItems = [];
    const seen = new Set();

    for (const tweet of state.tweets) {
      for (const mediaUrl of tweet.mediaUrls || []) {
        if (!mediaUrl || seen.has(mediaUrl)) {
          continue;
        }
        if (guessMediaType(mediaUrl) !== "image") {
          continue;
        }
        seen.add(mediaUrl);
        mediaItems.push({
          mediaUrl,
          tweetId: tweet.tweetId,
          authorHandle: tweet.authorHandle || "unknown",
          mediaType: guessMediaType(mediaUrl),
        });
      }
    }

    if (!mediaItems.length) {
      window.alert("当前采集结果里没有可直接下载的图片链接。");
      return;
    }

    const scope = sanitizeFilePart(getCollectionScope().key);
    const zipEntries = {};
    setStatus(`开始抓取图片，共 ${mediaItems.length} 个文件，稍后打包为 ZIP...`);

    let success = 0;
    let failed = 0;

    for (let index = 0; index < mediaItems.length; index += 1) {
      const item = mediaItems[index];
      const ext = getExtensionFromUrl(item.mediaUrl);
      const filename = `image-${item.authorHandle}-${item.tweetId}-${String(index + 1).padStart(4, "0")}.${ext}`;

      try {
        const blob = await gmRequestBlob(item.mediaUrl);
        const arrayBuffer = await blob.arrayBuffer();
        zipEntries[`x-${scope}-images/${filename}`] = new Uint8Array(arrayBuffer);
        success += 1;
      } catch (error) {
        failed += 1;
        console.warn("[X Collector] media download failed:", item.mediaUrl, error);
      }

      setStatus(`图片抓取中 ${index + 1}/${mediaItems.length} | 成功 ${success} | 失败 ${failed}`);
      await sleep(120);
    }

    if (!success) {
      setStatus(`图片打包失败，没有可写入 ZIP 的文件。失败 ${failed} 个。`);
      return;
    }

    setStatus(`图片抓取完成，正在生成 ZIP...`);
    const zipData = await new Promise((resolve, reject) => {
      try {
        fflate.zip(zipEntries, { level: 0 }, (error, data) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(data);
        });
      } catch (error) {
        reject(error);
      }
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const zipName = `x-${scope}-images-${stamp}.zip`;
    triggerDownload(zipName, new Blob([zipData], { type: "application/zip" }), "application/zip");
    setStatus(`图片 ZIP 已生成，共 ${success} 个文件打包成功，失败 ${failed} 个。`);
  }

  function bookmarkApiRequest(path, data) {
    const config = getBookmarkSyncConfig();
    if (!config.workerUrl || !config.apiKey) {
      showNotification("请先设置书签同步 Worker 配置（油猴菜单）", "warning");
      return Promise.reject(new Error("未配置书签同步 Worker"));
    }

    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("当前油猴环境不支持 GM_xmlhttpRequest"));
        return;
      }

      GM_xmlhttpRequest({
        method: "POST",
        url: `${config.workerUrl}${path}`,
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": config.apiKey,
        },
        data: JSON.stringify(data),
        responseType: "json",
        timeout: 120000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status}: ${response.responseText || ""}`));
            return;
          }

          let result = response.response;
          if (result === null || result === undefined) {
            try {
              result = JSON.parse(response.responseText);
            } catch (error) {
              reject(new Error(`响应解析失败: ${(response.responseText || "").slice(0, 200)}`));
              return;
            }
          } else if (typeof result === "string") {
            try {
              result = JSON.parse(result);
            } catch (error) {
              reject(new Error(`JSON 解析失败: ${result.slice(0, 200)}`));
              return;
            }
          }

          resolve(result);
        },
        onerror(error) {
          reject(new Error(`请求失败: ${error.error || error.statusText || "网络错误"}`));
        },
        ontimeout() {
          reject(new Error("请求超时"));
        },
      });
    });
  }

  function parseBookmarkTweetsFromResponse(data) {
    const tweets = [];

    try {
      const timeline = data?.data?.bookmark_timeline_v2?.timeline || data?.data?.bookmarkTimeline?.timeline || null;
      if (!timeline?.instructions) {
        return tweets;
      }

      for (const instruction of timeline.instructions) {
        const entries = instruction.entries || [];
        for (const entry of entries) {
          const tweet = extractBookmarkTweetFromEntry(entry);
          if (tweet) {
            tweets.push(tweet);
          }
        }

        if (instruction.moduleItems) {
          for (const item of instruction.moduleItems) {
            const tweet = extractBookmarkTweetFromItemContent(item?.item?.itemContent);
            if (tweet) {
              tweets.push(tweet);
            }
          }
        }
      }
    } catch (error) {
      console.error("[X Collector][BookmarkSync] 解析响应失败:", error);
    }

    return tweets;
  }

  function extractBookmarkTweetFromEntry(entry) {
    if (!entry?.content) {
      return null;
    }

    const content = entry.content;
    if (content.itemContent) {
      return extractBookmarkTweetFromItemContent(content.itemContent);
    }

    if (content.items) {
      for (const item of content.items) {
        const tweet = extractBookmarkTweetFromItemContent(item?.item?.itemContent);
        if (tweet) {
          return tweet;
        }
      }
    }

    return null;
  }

  function extractBookmarkTweetFromItemContent(itemContent) {
    if (!itemContent?.tweet_results?.result) {
      return null;
    }

    let result = itemContent.tweet_results.result;
    if (result.__typename === "TweetWithVisibilityResults" && result.tweet) {
      result = result.tweet;
    }
    if (result.__typename === "TweetTombstone") {
      return null;
    }

    return normalizeBookmarkTweet(result);
  }

  function normalizeBookmarkTweet(result) {
    try {
      const legacy = result?.legacy;
      if (!legacy) {
        return null;
      }

      const userResult = result?.core?.user_results?.result;
      const userLegacy = userResult?.legacy;
      const screenName = userLegacy?.screen_name || "";
      const media = [];
      const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];

      for (const item of mediaEntities) {
        if (item.type === "photo") {
          let url = item.media_url_https || item.media_url || "";
          if (url && !url.includes("format=")) {
            url = `${url}?format=jpg&name=orig`;
          }
          media.push({ type: "photo", url });
          continue;
        }

        if (item.type === "video" || item.type === "animated_gif") {
          const variants = (item.video_info?.variants || [])
            .filter((variant) => variant.content_type === "video/mp4")
            .sort((left, right) => (right.bitrate || 0) - (left.bitrate || 0));
          if (!variants.length) {
            continue;
          }

          let posterUrl = item.media_url_https || item.media_url || "";
          if (posterUrl && !posterUrl.includes("format=")) {
            posterUrl = `${posterUrl}?format=jpg&name=small`;
          }
          media.push({
            type: item.type,
            url: variants[0].url,
            poster_url: posterUrl,
          });
        }
      }

      const tweetId = result.rest_id || legacy.id_str || "";
      return {
        id: tweetId,
        text: legacy.full_text || "",
        author: {
          id: userResult?.rest_id || "",
          name: userLegacy?.name || "",
          screen_name: screenName,
        },
        created_at: legacy.created_at || "",
        url: screenName && tweetId ? `https://x.com/${screenName}/status/${tweetId}` : "",
        media,
      };
    } catch (error) {
      console.error("[X Collector][BookmarkSync] 解析单条推文失败:", error);
      return null;
    }
  }

  async function syncBookmarkTweets(tweets) {
    if (!tweets.length) {
      return;
    }

    const newTweets = tweets.filter((tweet) => !bookmarkProcessingIds.has(tweet.id) && !bookmarkSyncedCache.has(tweet.id));
    if (!newTweets.length) {
      return;
    }

    newTweets.forEach((tweet) => bookmarkProcessingIds.add(tweet.id));

    try {
      const ids = newTweets.map((tweet) => tweet.id);
      setSyncStatus("syncing", `校验 ${ids.length} 条书签...`);
      const checkResult = await bookmarkApiRequest("/api/twitter/check", { ids });
      (checkResult.synced || []).forEach((id) => bookmarkSyncedCache.add(id));

      const unsyncedIds = new Set(checkResult.unsynced || []);
      const toSync = newTweets.filter((tweet) => unsyncedIds.has(tweet.id));
      if (!toSync.length) {
        setSyncStatus("ok", `书签已是最新（${ids.length} 条已同步）`);
        showNotification(`书签已是最新（${ids.length} 条已同步）`, "success", 2000);
        return;
      }

      setSyncStatus("syncing", `发现 ${toSync.length} 条新书签，同步中...`);
      showNotification(`发现 ${toSync.length} 条新书签，开始同步...`, "info", 2500);

      const batchSize = 5;
      let totalSynced = 0;
      let totalFailed = 0;

      for (let index = 0; index < toSync.length; index += batchSize) {
        const batch = toSync.slice(index, index + batchSize);
        const batchNumber = Math.floor(index / batchSize) + 1;
        const batchTotal = Math.ceil(toSync.length / batchSize);
        setSyncStatus("syncing", `书签同步中 ${batchNumber}/${batchTotal}...`);
        showNotification(`书签同步中 ${batchNumber}/${batchTotal}...`, "info", 2000);

        try {
          const syncResult = await bookmarkApiRequest("/api/twitter/sync", { tweets: batch });
          for (const item of syncResult.results || []) {
            if (item.success) {
              totalSynced += 1;
              bookmarkSyncedCache.add(item.tweet_id);
            } else {
              totalFailed += 1;
              console.error("[X Collector][BookmarkSync] 同步失败:", item.tweet_id, item.error);
            }
          }
        } catch (error) {
          totalFailed += batch.length;
          console.error("[X Collector][BookmarkSync] 批量同步失败:", error);
        }
      }

      bookmarkSyncStatus.failed += totalFailed;
      if (totalFailed === 0) {
        setSyncStatus("ok", `同步完成：${totalSynced} 条已保存`);
        showNotification(`书签同步完成：${totalSynced} 条已保存`, "success");
      } else {
        setSyncStatus("error", `同步完成：${totalSynced} 成功，${totalFailed} 失败`);
        showNotification(
          `书签同步完成：${totalSynced} 成功，${totalFailed} 失败`,
          totalSynced > 0 ? "warning" : "error"
        );
      }
    } catch (error) {
      console.error("[X Collector][BookmarkSync] 同步流程异常:", error);
      setSyncStatus("error", `同步失败: ${error.message}`);
      showNotification(`书签同步失败: ${error.message}`, "error");
    } finally {
      newTweets.forEach((tweet) => bookmarkProcessingIds.delete(tweet.id));
    }
  }

  function handleBookmarkGraphqlPayload(data, sourceLabel) {
    const tweets = parseBookmarkTweetsFromResponse(data);
    if (!tweets.length) {
      return;
    }

    bookmarkSyncStatus.captured += tweets.length;
    updateSyncWidget();
    console.log(`[X Collector][BookmarkSync] ${sourceLabel} 捕获到 ${tweets.length} 条书签`);
    syncBookmarkTweets(tweets).catch((error) => {
      console.error("[X Collector][BookmarkSync] 同步失败:", error);
    });
  }

  function installBookmarkSyncHooks() {
    if (bookmarkSyncHooksInstalled) {
      return;
    }
    bookmarkSyncHooksInstalled = true;

    // 必须挂到页面真实 window 上，沙箱里的 window.fetch 拦截不到 X 自身的请求
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

    const originalFetch = pageWindow.fetch;
    if (typeof originalFetch === "function" && !originalFetch[BOOKMARK_SYNC_HOOK_FLAGS.fetch]) {
      const wrappedFetch = async function bookmarkSyncFetchWrapper(...args) {
        const response = await originalFetch.apply(this, args);

        try {
          const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
          if (url.includes("/graphql/") && url.includes("Bookmark")) {
            response
              .clone()
              .json()
              .then((data) => handleBookmarkGraphqlPayload(data, "fetch"))
              .catch((error) => {
                console.error("[X Collector][BookmarkSync] fetch 响应解析失败:", error);
              });
          }
        } catch (error) {
          console.error("[X Collector][BookmarkSync] fetch 拦截异常:", error);
        }

        return response;
      };
      wrappedFetch[BOOKMARK_SYNC_HOOK_FLAGS.fetch] = true;
      wrappedFetch.__xucOriginalFetch = originalFetch;
      pageWindow.fetch = wrappedFetch;
    }

    const xhrProto = pageWindow.XMLHttpRequest.prototype;
    const originalXhrOpen = xhrProto.open;
    if (!originalXhrOpen[BOOKMARK_SYNC_HOOK_FLAGS.xhrOpen]) {
      const wrappedXhrOpen = function bookmarkSyncXhrOpen(method, url, ...rest) {
        this.__xucBookmarkSyncUrl = url;
        return originalXhrOpen.apply(this, [method, url, ...rest]);
      };
      wrappedXhrOpen[BOOKMARK_SYNC_HOOK_FLAGS.xhrOpen] = true;
      wrappedXhrOpen.__xucOriginalOpen = originalXhrOpen;
      xhrProto.open = wrappedXhrOpen;
    }

    const originalXhrSend = xhrProto.send;
    if (originalXhrSend[BOOKMARK_SYNC_HOOK_FLAGS.xhrSend]) {
      return;
    }

    xhrProto.send = function bookmarkSyncXhrSend(...args) {
      if (this.__xucBookmarkSyncUrl && this.__xucBookmarkSyncUrl.includes("/graphql/") && this.__xucBookmarkSyncUrl.includes("Bookmark")) {
        this.addEventListener(
          "load",
          function onBookmarkSyncLoad() {
            try {
              const data = JSON.parse(this.responseText);
              handleBookmarkGraphqlPayload(data, "xhr");
            } catch (error) {
              console.error("[X Collector][BookmarkSync] XHR 响应解析失败:", error);
            }
          },
          { once: true }
        );
      }

      return originalXhrSend.apply(this, args);
    };
    xhrProto.send[BOOKMARK_SYNC_HOOK_FLAGS.xhrSend] = true;
    xhrProto.send.__xucOriginalSend = originalXhrSend;
  }

  const bookmarkSyncStatus = {
    state: "idle",
    captured: 0,
    synced: 0,
    failed: 0,
    message: "等待书签时间线请求",
    lastAt: "",
  };

  function isBookmarksPage() {
    return window.location.pathname.startsWith("/i/bookmarks");
  }

  function ensureSyncWidget() {
    if (!document.body) {
      return null;
    }

    let widget = document.getElementById(CONFIG.syncWidgetId);
    if (!widget) {
      widget = document.createElement("div");
      widget.id = CONFIG.syncWidgetId;
      widget.innerHTML = `
        <span class="xuc-sync-dot"></span>
        <div class="xuc-sync-text">
          <div class="xuc-sync-line1"></div>
          <div class="xuc-sync-line2"></div>
        </div>
      `;
      document.body.appendChild(widget);
    }
    return widget;
  }

  function updateSyncWidget() {
    const widget = ensureSyncWidget();
    if (!widget) {
      return;
    }

    if (!isBookmarksPage()) {
      widget.style.display = "none";
      return;
    }

    const dotColors = {
      unconfigured: "#ffad1f",
      idle: "#8b98a5",
      syncing: "#1d9bf0",
      ok: "#00ba7c",
      error: "#f4212e",
    };

    widget.style.display = "flex";
    widget.querySelector(".xuc-sync-dot").style.background = dotColors[bookmarkSyncStatus.state] || dotColors.idle;
    widget.querySelector(".xuc-sync-line1").textContent = bookmarkSyncStatus.message;
    const timeSuffix = bookmarkSyncStatus.lastAt ? ` · ${bookmarkSyncStatus.lastAt}` : "";
    widget.querySelector(".xuc-sync-line2").textContent =
      `捕获 ${bookmarkSyncStatus.captured} · 已同步 ${bookmarkSyncStatus.synced} · 失败 ${bookmarkSyncStatus.failed}${timeSuffix}`;
  }

  function setSyncStatus(stateName, message) {
    bookmarkSyncStatus.state = stateName;
    if (message) {
      bookmarkSyncStatus.message = message;
    }
    bookmarkSyncStatus.synced = bookmarkSyncedCache.size;
    bookmarkSyncStatus.lastAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    updateSyncWidget();
  }

  function initBookmarkSync() {
    const config = getBookmarkSyncConfig();
    if (!config.workerUrl || !config.apiKey) {
      showNotification("书签同步未配置，请在油猴菜单中设置 Worker 配置", "warning", 6000);
      setSyncStatus("unconfigured", "书签同步未配置");
      return;
    }

    setSyncStatus("idle", "等待书签时间线请求");
    console.log("[X Collector][BookmarkSync] 已启动，等待书签时间线请求...");
  }

  function setStatus(message) {
    const node = document.getElementById(CONFIG.statusId);
    if (node) {
      node.textContent = message;
    }
  }

  function setScopeLabel(message) {
    const node = document.getElementById(CONFIG.scopeId);
    if (node) {
      node.textContent = message;
    }
  }

  function updateButtons() {
    const canCollect = canCollectCurrentPage(window.location.pathname);
    const startButton = document.getElementById(CONFIG.startButtonId);
    const stopButton = document.getElementById(CONFIG.stopButtonId);
    const exportJsonButton = document.getElementById(CONFIG.exportJsonButtonId);
    const exportCsvButton = document.getElementById(CONFIG.exportCsvButtonId);
    const exportMdButton = document.getElementById(CONFIG.exportMdButtonId);
    const downloadMediaButton = document.getElementById(CONFIG.downloadMediaButtonId);
    const sidebarToggle = document.querySelector(".xuc-sidebar-toggle");
    const searchToggle = document.querySelector(".xuc-search-toggle");
    const layoutToggle = document.querySelector(".xuc-layout-toggle");
    const collectorToggle = document.querySelector(".xuc-collector-toggle");

    if (startButton) {
      startButton.disabled = state.running || !canCollect;
      startButton.textContent = state.running ? "采集中..." : "采集推文";
    }
    if (stopButton) {
      stopButton.disabled = !state.running;
    }
    if (exportJsonButton) {
      exportJsonButton.disabled = state.running || !state.tweets.length;
    }
    if (exportCsvButton) {
      exportCsvButton.disabled = state.running || !state.tweets.length;
    }
    if (exportMdButton) {
      exportMdButton.disabled = state.running || !state.tweets.length;
    }
    if (downloadMediaButton) {
      downloadMediaButton.disabled = state.running || !state.tweets.length;
    }

    if (sidebarToggle) {
      sidebarToggle.classList.toggle("sidebar-enabled", state.sidebarVisible);
      sidebarToggle.classList.toggle("active", state.sidebarVisible);
      sidebarToggle.setAttribute("aria-pressed", state.sidebarVisible ? "true" : "false");
    }
    if (searchToggle) {
      searchToggle.classList.toggle("active", state.openPanel === "search");
      searchToggle.setAttribute("aria-pressed", state.openPanel === "search" ? "true" : "false");
    }
    if (layoutToggle) {
      layoutToggle.classList.toggle("active", state.openPanel === "layout");
      layoutToggle.setAttribute("aria-pressed", state.openPanel === "layout" ? "true" : "false");
    }
    if (collectorToggle) {
      collectorToggle.classList.toggle("active", state.openPanel === "collector");
      collectorToggle.setAttribute("aria-pressed", state.openPanel === "collector" ? "true" : "false");
    }
  }

  async function runCollection() {
    if (state.running) {
      return;
    }

    if (!canCollectCurrentPage(window.location.pathname)) {
      window.alert("请先打开 x.com/<用户名> 用户主页，或 x.com/home 首页时间线，再点击采集。");
      return;
    }

    const scope = getCollectionScope();
    const startUrl = window.location.href;
    state.running = true;
    state.stopRequested = false;
    state.tweets = [];
    state.tweetMap = new Map();
    updateButtons();
    setStatus(`准备采集 ${scope.label} ...`);

    window.scrollTo(0, 0);
    await sleep(CONFIG.topResetDelayMs);

    let idleRounds = 0;
    let previousScrollY = -1;

    for (let round = 1; round <= CONFIG.maxScrollRounds; round += 1) {
      if (state.stopRequested) {
        setStatus(`已停止。共采集 ${state.tweets.length} 条，可手动导出 JSON / CSV 或下载媒体。`);
        break;
      }

      // 用户中途跳转到其他页面时停止，避免把不同范围的推文混进同一份数据
      if (window.location.href !== startUrl) {
        setStatus(`页面已切换，采集自动停止。共采集 ${state.tweets.length} 条，可手动导出。`);
        break;
      }

      const newCount = collectVisibleTweets();
      if (newCount === 0) {
        idleRounds += 1;
      } else {
        idleRounds = 0;
      }

      setStatus(
        `采集中 ${scope.label} | 第 ${round} 轮 | 新增 ${newCount} | 累计 ${state.tweets.length} | 空转 ${idleRounds}/${CONFIG.maxIdleRounds}`
      );

      if (state.tweets.length >= CONFIG.maxTweets) {
        setStatus(`达到上限 ${CONFIG.maxTweets} 条，已停止采集，可手动导出。`);
        break;
      }

      const currentScrollY = window.scrollY;
      if (idleRounds >= CONFIG.maxIdleRounds && Math.abs(currentScrollY - previousScrollY) < 8) {
        setStatus(`连续 ${CONFIG.maxIdleRounds} 轮无新内容，已停止采集，可手动导出。`);
        break;
      }

      previousScrollY = currentScrollY;
      window.scrollBy(0, Math.max(800, Math.floor(window.innerHeight * CONFIG.scrollStepFactor)));
      await sleep(CONFIG.scrollDelayMs);
    }

    await sleep(CONFIG.settleDelayMs);
    collectVisibleTweets();

    if (!state.stopRequested && state.tweets.length) {
      setStatus(`采集完成，共 ${state.tweets.length} 条。现在可手动导出 JSON / CSV，或下载媒体。`);
    } else if (!state.tweets.length) {
      setStatus("没有采集到任何推文，请确认当前页面是用户主页 Posts 时间线。");
    }

    state.running = false;
    state.stopRequested = false;
    updateButtons();
  }

  function stopCollection() {
    if (!state.running) {
      return;
    }
    state.stopRequested = true;
    setStatus("正在停止采集...");
  }

  let stylesInjected = false;
  let historyWatcherInstalled = false;
  let domObserver = null;
  let domObserverRoot = null;

  function debounce(fn, delay) {
    let timer = null;
    return function debounced(...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function injectAppStyles() {
    if (stylesInjected) {
      return;
    }

    addStyle(`
      :root {
        --xuc-tweet-width: ${state.tweetWidth}px;
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

      body:not(.xuc-sidebar-visible) main[role="main"] > div {
        width: 100% !important;
        max-width: 100% !important;
        display: flex !important;
        justify-content: center !important;
      }

      body:not(.xuc-sidebar-visible) main[role="main"] > div > div {
        width: 100% !important;
        max-width: 100% !important;
        display: flex !important;
        justify-content: center !important;
      }

      body.xuc-sidebar-visible main[role="main"] {
        align-items: flex-start !important;
      }

      body.xuc-sidebar-visible main[role="main"] > div {
        justify-content: flex-start !important;
      }

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
      article[data-testid="tweet"],
      [data-testid="tweetText"] {
        width: 100% !important;
        max-width: none !important;
      }

      [data-testid="tweetText"] {
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
        line-height: 1.45 !important;
      }

      div[style*="max-width: 600px"] {
        max-width: none !important;
      }

      article[data-testid="tweet"]:nth-of-type(even) {
        background: var(--xuc-stripe, rgba(255, 255, 255, 0.025)) !important;
      }

      /* 工具栏对齐 X 原生 Grok/Chat 浮动按钮：右距 20px，从 Grok 顶部（bottom 134px）再留 12px 间距 */
      #${CONFIG.toolbarId} {
        position: fixed !important;
        right: 20px !important;
        bottom: 146px !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-end !important;
        gap: 0 !important;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-buttons {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: flex-end !important;
        gap: 12px !important;
        width: auto !important;
      }

      /* 按钮样式复刻 X 的 GrokDrawerHeader / chat-drawer-main：55px、16px 圆角、同款边框与阴影 */
      #${CONFIG.toolbarId} .xuc-toolbar-btn {
        width: 55px !important;
        height: 55px !important;
        border: 1px solid rgba(159, 181, 195, 0.65) !important;
        border-radius: 16px !important;
        position: relative !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        color: #0f1419 !important;
        background: rgba(255, 255, 255, 0.85) !important;
        box-shadow: rgba(101, 119, 134, 0.2) 0 0 15px 0, rgba(101, 119, 134, 0.15) 0 0 3px 1px !important;
        transition: background 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn::after {
        display: none !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn:hover {
        background: rgba(247, 249, 249, 0.95) !important;
        box-shadow: rgba(101, 119, 134, 0.28) 0 0 15px 0, rgba(101, 119, 134, 0.2) 0 0 3px 1px !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn svg {
        width: 32px !important;
        height: 32px !important;
        fill: currentColor !important;
      }

      #${CONFIG.toolbarId} .xuc-sidebar-toggle.sidebar-enabled {
        background: rgba(255, 255, 255, 0.95) !important;
        border-color: rgba(0, 186, 124, 0.45) !important;
        color: #0f1419 !important;
        box-shadow: rgba(101, 119, 134, 0.2) 0 0 15px 0, rgba(0, 186, 124, 0.25) 0 0 0 2px !important;
      }

      #${CONFIG.toolbarId} .xuc-sidebar-toggle.sidebar-enabled::after {
        display: none !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn.active {
        background: rgba(255, 255, 255, 0.95) !important;
        border-color: rgba(29, 155, 240, 0.5) !important;
        color: #1d9bf0 !important;
        box-shadow: rgba(101, 119, 134, 0.2) 0 0 15px 0, rgba(29, 155, 240, 0.25) 0 0 0 2px !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn.active::after {
        display: none !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn.active svg {
        transform: scale(1.02) !important;
      }

      #${CONFIG.toolbarId} .xuc-panel {
        position: absolute !important;
        right: calc(100% + 14px) !important;
        bottom: 0 !important;
        display: none !important;
        width: min(340px, calc(100vw - 24px)) !important;
        max-height: min(72vh, 620px) !important;
        overflow-y: auto !important;
        padding: 16px !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        border-radius: 18px !important;
        background: rgba(15, 20, 25, 0.95) !important;
        color: #e7e9ea !important;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.38) !important;
        backdrop-filter: blur(14px) !important;
        transform-origin: bottom right !important;
        margin-right: 0 !important;
      }

      #${CONFIG.toolbarId} .xuc-panel.active {
        display: block !important;
      }
    `);

    addStyle(`
      #${CONFIG.toolbarId} .xuc-panel-title {
        margin: 0 0 8px 0 !important;
        font-size: 15px !important;
        font-weight: 700 !important;
        color: #fff !important;
      }

      #${CONFIG.toolbarId} .xuc-panel-subtitle,
      #${CONFIG.toolbarId} #${CONFIG.scopeId},
      #${CONFIG.toolbarId} #${CONFIG.statusId} {
        font-size: 12px !important;
        line-height: 1.45 !important;
        color: #8b98a5 !important;
      }

      #${CONFIG.toolbarId} .xuc-search-box,
      #${CONFIG.toolbarId} .xuc-input-row {
        display: flex !important;
        gap: 8px !important;
        align-items: center !important;
      }

      #${CONFIG.toolbarId} input[type="text"] {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        padding: 10px 12px !important;
        border: 1px solid #2f3336 !important;
        border-radius: 10px !important;
        background: #0f1419 !important;
        color: #fff !important;
        outline: none !important;
      }

      #${CONFIG.toolbarId} input[type="text"]:focus {
        border-color: #1d9bf0 !important;
      }

      #${CONFIG.toolbarId} .xuc-panel button,
      #${CONFIG.toolbarId} .xuc-preset-btn {
        border: 1px solid rgba(255, 255, 255, 0.14) !important;
        border-radius: 10px !important;
        padding: 8px 10px !important;
        background: #15202b !important;
        color: #fff !important;
        cursor: pointer !important;
        font-size: 12px !important;
        line-height: 1.25 !important;
      }

      #${CONFIG.toolbarId} .xuc-panel button:disabled {
        opacity: 0.5 !important;
        cursor: not-allowed !important;
      }

      #${CONFIG.toolbarId} .xuc-panel button.xuc-primary {
        background: #1d9bf0 !important;
        border-color: transparent !important;
        color: #fff !important;
      }

      #${CONFIG.toolbarId} .xuc-panel button.xuc-accent {
        background: #794bc4 !important;
        border-color: transparent !important;
      }

      #${CONFIG.toolbarId} .xuc-panel button.xuc-danger {
        background: #f4212e !important;
        border-color: transparent !important;
      }

      #${CONFIG.toolbarId} .xuc-keyword-list {
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 8px !important;
        margin-top: 12px !important;
      }

      #${CONFIG.toolbarId} .xuc-keyword-tag {
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        padding: 5px 10px !important;
        border-radius: 999px !important;
        background: #1f2428 !important;
        color: #e7e9ea !important;
        font-size: 12px !important;
      }

      #${CONFIG.toolbarId} .xuc-keyword-tag button {
        padding: 0 !important;
        width: 18px !important;
        height: 18px !important;
        border: none !important;
        border-radius: 999px !important;
        background: transparent !important;
        color: #8b98a5 !important;
      }

      #${CONFIG.toolbarId} .xuc-width-section {
        margin-top: 14px !important;
        padding-top: 14px !important;
        border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
      }

      #${CONFIG.toolbarId} .xuc-width-head {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        margin-bottom: 10px !important;
        font-size: 13px !important;
      }

      #${CONFIG.toolbarId} input[type="range"] {
        width: 100% !important;
      }

      #${CONFIG.toolbarId} .xuc-preset-row,
      #${CONFIG.toolbarId} .xuc-action-row {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 8px !important;
        margin-top: 10px !important;
      }

      #${CONFIG.toolbarId} #${CONFIG.statusId} {
        margin-top: 10px !important;
        padding-top: 10px !important;
        border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
        white-space: pre-wrap !important;
      }

      @media (max-width: 720px) {
        #${CONFIG.toolbarId} {
          right: 16px !important;
          left: auto !important;
          bottom: 146px !important;
        }

        #${CONFIG.toolbarId} .xuc-panel {
          right: calc(100% + 10px) !important;
          width: min(100vw - 96px, 340px) !important;
        }
      }
    `);

    addStyle(`
      /* ===== 主题系统：body 类定义变量，覆盖规则统一引用；默认主题无类、零覆盖 ===== */
      body.xuc-theme-paper { --xuc-bg: #f7f1e3; --xuc-bg-elevated: #fbf7ec; --xuc-text: #3e3428; --xuc-text-2nd: #8a7d68; --xuc-border: #e6dcc6; --xuc-stripe: rgba(0, 0, 0, 0.02); }
      body.xuc-theme-green { --xuc-bg: #cce8cf; --xuc-bg-elevated: #daf0dc; --xuc-text: #2f3e33; --xuc-text-2nd: #66796b; --xuc-border: #b4d9ba; --xuc-stripe: rgba(0, 0, 0, 0.02); }
      body.xuc-theme-dim { --xuc-bg: #15202b; --xuc-bg-elevated: #1c2732; --xuc-text: #f7f9f9; --xuc-text-2nd: #8b98a5; --xuc-border: #38444d; --xuc-stripe: rgba(255, 255, 255, 0.025); }
      body.xuc-theme-oled { --xuc-bg: #000000; --xuc-bg-elevated: #080808; --xuc-text: #e7e9ea; --xuc-text-2nd: #71767b; --xuc-border: #2f3336; --xuc-stripe: rgba(255, 255, 255, 0.03); }

      body[class*="xuc-theme-"],
      body[class*="xuc-theme-"] main[role="main"],
      body[class*="xuc-theme-"] [data-testid="primaryColumn"],
      body[class*="xuc-theme-"] [data-testid="sidebarColumn"],
      body[class*="xuc-theme-"] header[role="banner"] {
        background-color: var(--xuc-bg) !important;
      }

      /* 置顶栏（首页 Tab、页面标题）由 tagElevatedBars() 打标，X 原本是半透明白底+模糊 */
      body[class*="xuc-theme-"] [data-xuc-elevated],
      body[class*="xuc-theme-"] [data-xuc-elevated] > div {
        background-color: var(--xuc-bg-elevated) !important;
        backdrop-filter: none !important;
      }

      body[class*="xuc-theme-"] main div,
      body[class*="xuc-theme-"] header[role="banner"] div {
        border-color: var(--xuc-border) !important;
      }

      /* 深色主题需要翻转文字色；浅色主题沿用 X 自身深色文字 */
      body.xuc-theme-dim [data-testid="tweetText"], body.xuc-theme-dim [data-testid="tweetText"] span,
      body.xuc-theme-oled [data-testid="tweetText"], body.xuc-theme-oled [data-testid="tweetText"] span,
      body.xuc-theme-dim [data-testid="User-Name"] span,
      body.xuc-theme-oled [data-testid="User-Name"] span,
      body.xuc-theme-dim main h2, body.xuc-theme-dim main h2 span,
      body.xuc-theme-oled main h2, body.xuc-theme-oled main h2 span {
        color: var(--xuc-text) !important;
      }

      body.xuc-theme-dim [data-testid="tweetText"] a, body.xuc-theme-dim [data-testid="tweetText"] a span,
      body.xuc-theme-oled [data-testid="tweetText"] a, body.xuc-theme-oled [data-testid="tweetText"] a span {
        color: #1d9bf0 !important;
      }

      body.xuc-theme-dim article time, body.xuc-theme-oled article time {
        color: var(--xuc-text-2nd) !important;
      }

      /* ===== 阅读增强 ===== */
      body.xuc-font-custom [data-testid="tweetText"] {
        font-size: var(--xuc-font-size) !important;
      }

      body.xuc-lh-custom [data-testid="tweetText"] {
        line-height: var(--xuc-line-height) !important;
      }

      body.xuc-serif [data-testid="tweetText"] {
        font-family: Georgia, "Times New Roman", "Source Han Serif SC", "Noto Serif SC", STSong, serif !important;
      }

      body.xuc-focus-mode article div[role="group"] { display: none !important; }
      body.xuc-focus-mode [data-testid="socialContext"] { display: none !important; }

      article.xuc-read {
        opacity: 0.55 !important;
        transition: opacity 0.4s ease !important;
      }

      /* ===== 书签同步状态部件 ===== */
      #${CONFIG.syncWidgetId} {
        position: fixed !important;
        top: 70px !important;
        right: 20px !important;
        z-index: 2147483646 !important;
        display: none;
        align-items: center !important;
        gap: 10px !important;
        padding: 10px 14px !important;
        border-radius: 16px !important;
        border: 1px solid var(--xuc-border, rgba(159, 181, 195, 0.65)) !important;
        background: var(--xuc-bg-elevated, rgba(255, 255, 255, 0.92)) !important;
        box-shadow: rgba(101, 119, 134, 0.2) 0 0 15px 0, rgba(101, 119, 134, 0.15) 0 0 3px 1px !important;
        color: var(--xuc-text, #0f1419) !important;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        font-size: 12px !important;
        line-height: 1.4 !important;
        max-width: 320px !important;
      }

      #${CONFIG.syncWidgetId} .xuc-sync-dot {
        width: 10px !important;
        height: 10px !important;
        border-radius: 999px !important;
        background: #8b98a5;
        flex: none !important;
      }

      #${CONFIG.syncWidgetId} .xuc-sync-line1 { font-weight: 700 !important; }
      #${CONFIG.syncWidgetId} .xuc-sync-line2 { color: var(--xuc-text-2nd, #8b98a5) !important; }

      /* ===== 面板新控件：主题色块与阅读区块 ===== */
      #${CONFIG.toolbarId} .xuc-theme-row {
        display: flex !important;
        gap: 6px !important;
        margin-top: 10px !important;
      }

      #${CONFIG.toolbarId} .xuc-theme-btn {
        flex: 1 1 0 !important;
        padding: 9px 0 !important;
        border-radius: 10px !important;
        border: 1px solid rgba(255, 255, 255, 0.14) !important;
        font-size: 12px !important;
        cursor: pointer !important;
      }

      #${CONFIG.toolbarId} .xuc-theme-btn[data-theme=""] { background: #fff !important; color: #0f1419 !important; }
      #${CONFIG.toolbarId} .xuc-theme-btn[data-theme="paper"] { background: #f7f1e3 !important; color: #3e3428 !important; }
      #${CONFIG.toolbarId} .xuc-theme-btn[data-theme="green"] { background: #cce8cf !important; color: #2f3e33 !important; }
      #${CONFIG.toolbarId} .xuc-theme-btn[data-theme="dim"] { background: #15202b !important; color: #f7f9f9 !important; border-color: #38444d !important; }
      #${CONFIG.toolbarId} .xuc-theme-btn[data-theme="oled"] { background: #000 !important; color: #e7e9ea !important; border-color: #2f3336 !important; }
      #${CONFIG.toolbarId} .xuc-theme-btn.active { box-shadow: 0 0 0 2px #1d9bf0 !important; }

      #${CONFIG.toolbarId} .xuc-read-section {
        margin-top: 14px !important;
        padding-top: 14px !important;
        border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
      }

      #${CONFIG.toolbarId} .xuc-slider-head {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        margin: 10px 0 6px !important;
        font-size: 13px !important;
      }

      #${CONFIG.toolbarId} .xuc-toggle-row {
        display: grid !important;
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        gap: 8px !important;
        margin-top: 12px !important;
      }

      #${CONFIG.toolbarId} .xuc-toggle-btn.active {
        background: #1d9bf0 !important;
        border-color: transparent !important;
      }
    `);

    stylesInjected = true;
  }

  function applySidebarState() {
    document.body.classList.toggle("xuc-sidebar-visible", state.sidebarVisible);
  }

  function applyTweetWidth() {
    document.documentElement.style.setProperty("--xuc-tweet-width", `${state.tweetWidth}px`);
  }

  function applyTheme() {
    if (!document.body) {
      return;
    }
    THEMES.forEach((theme) => {
      document.body.classList.toggle(`xuc-theme-${theme}`, state.theme === theme);
    });
  }

  // X 的置顶栏（首页 Tab、页面标题）是半透明白底，CSS 选不到 position:sticky，
  // 用 h2/nav 锚点向上找 sticky 祖先打标，再由主题 CSS 统一覆盖
  function tagElevatedBars() {
    if (!state.theme) {
      return;
    }

    document.querySelectorAll('main h2, main nav[role="navigation"]').forEach((node) => {
      let el = node;
      for (let depth = 0; depth < 8 && el && el !== document.body; depth += 1) {
        if (el.hasAttribute("data-xuc-elevated")) {
          return;
        }
        if (getComputedStyle(el).position === "sticky") {
          el.setAttribute("data-xuc-elevated", "1");
          return;
        }
        el = el.parentElement;
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
    if (state.fontSize > 0) {
      rootStyle.setProperty("--xuc-font-size", `${state.fontSize}px`);
    } else {
      rootStyle.removeProperty("--xuc-font-size");
    }
    if (state.lineHeight > 0) {
      rootStyle.setProperty("--xuc-line-height", String(state.lineHeight));
    } else {
      rootStyle.removeProperty("--xuc-line-height");
    }
  }

  let readObserver = null;

  function ensureReadObserver() {
    if (!state.dimRead) {
      if (readObserver) {
        readObserver.disconnect();
        readObserver = null;
      }
      document.querySelectorAll("article.xuc-read").forEach((node) => node.classList.remove("xuc-read"));
      document.querySelectorAll('article[data-xuc-observed="true"]').forEach((node) => {
        node.removeAttribute("data-xuc-observed");
      });
      return;
    }

    // 推文详情页不做已读标记，避免把正在阅读的推文淡化
    if (/\/status\/\d+/.test(window.location.pathname)) {
      return;
    }

    if (!readObserver) {
      readObserver = new IntersectionObserver((entries) => {
        if (state.running) {
          return;
        }
        entries.forEach((entry) => {
          // 仅当卡片从视口顶部滚出（已被阅读过）才标记
          if (!entry.isIntersecting && entry.boundingClientRect.bottom < 0) {
            const id = getTweetId(getTweetUrl(entry.target));
            if (id) {
              state.readTweetIds.add(id);
            }
            entry.target.classList.add("xuc-read");
          }
        });
      });
    }

    document.querySelectorAll(TWEET_SELECTOR).forEach((article) => {
      if (article.dataset.xucObserved !== "true") {
        article.dataset.xucObserved = "true";
        readObserver.observe(article);
      }
      // 虚拟列表重挂载的卡片对照会话内已读集合补类
      if (!article.classList.contains("xuc-read")) {
        const id = getTweetId(getTweetUrl(article));
        if (id && state.readTweetIds.has(id)) {
          article.classList.add("xuc-read");
        }
      }
    });
  }

  function updateReadingControls() {
    document.querySelectorAll(`#${CONFIG.toolbarId} .xuc-theme-btn`).forEach((button) => {
      button.classList.toggle("active", (button.dataset.theme || "") === state.theme);
    });

    const fontValue = document.getElementById(CONFIG.fontSizeValueId);
    const fontSlider = document.getElementById(CONFIG.fontSizeSliderId);
    if (fontValue) {
      fontValue.textContent = state.fontSize > 0 ? `${state.fontSize}px` : "默认";
    }
    if (fontSlider) {
      fontSlider.value = String(state.fontSize > 0 ? state.fontSize : 13);
    }

    const lineHeightValue = document.getElementById(CONFIG.lineHeightValueId);
    const lineHeightSlider = document.getElementById(CONFIG.lineHeightSliderId);
    if (lineHeightValue) {
      lineHeightValue.textContent = state.lineHeight > 0 ? state.lineHeight.toFixed(1) : "默认";
    }
    if (lineHeightSlider) {
      lineHeightSlider.value = String(state.lineHeight > 0 ? Math.round(state.lineHeight * 10) : 12);
    }

    const serifToggle = document.querySelector(`#${CONFIG.toolbarId} .xuc-serif-toggle`);
    const focusToggle = document.querySelector(`#${CONFIG.toolbarId} .xuc-focus-toggle`);
    const dimReadToggle = document.querySelector(`#${CONFIG.toolbarId} .xuc-dimread-toggle`);
    if (serifToggle) {
      serifToggle.classList.toggle("active", state.serifFont);
    }
    if (focusToggle) {
      focusToggle.classList.toggle("active", state.focusMode);
    }
    if (dimReadToggle) {
      dimReadToggle.classList.toggle("active", state.dimRead);
    }
  }

  function resetHiddenTweets() {
    document.querySelectorAll('[data-xuc-hidden-by-keyword="true"]').forEach((node) => {
      node.style.display = "";
      node.removeAttribute("data-xuc-hidden-by-keyword");
    });
    document.querySelectorAll(`${TWEET_SELECTOR}[data-xuc-keyword-signature]`).forEach((node) => {
      node.removeAttribute("data-xuc-keyword-signature");
    });
  }

  function getKeywordSignature() {
    return state.blockedKeywords
      .map((keyword) => keyword.toLowerCase())
      .sort()
      .join("\n");
  }

  function applyKeywordFilters(force = false) {
    const signature = getKeywordSignature();
    if (force || state.keywordSignature !== signature) {
      state.keywordSignature = signature;
      resetHiddenTweets();
    }

    if (!state.blockedKeywords.length) {
      return;
    }

    const loweredKeywords = state.blockedKeywords.map((keyword) => keyword.toLowerCase());
    const tweets = document.querySelectorAll(TWEET_SELECTOR);

    tweets.forEach((tweet) => {
      if (!force && tweet.dataset.xucKeywordSignature === signature) {
        return;
      }

      const text = (tweet.textContent || "").toLowerCase();
      const container = tweet.closest('[data-testid="cellInnerDiv"]') || tweet;
      if (!text) {
        container.style.display = "";
        container.removeAttribute("data-xuc-hidden-by-keyword");
        tweet.dataset.xucKeywordSignature = signature;
        return;
      }

      const matched = loweredKeywords.some((keyword) => text.includes(keyword));
      if (!matched) {
        container.style.display = "";
        container.removeAttribute("data-xuc-hidden-by-keyword");
        tweet.dataset.xucKeywordSignature = signature;
        return;
      }

      container.style.display = "none";
      container.setAttribute("data-xuc-hidden-by-keyword", "true");
      tweet.dataset.xucKeywordSignature = signature;
    });
  }

  function autoExpandTweets() {
    let expandedAny = false;
    document.querySelectorAll('[data-testid="tweet-text-show-more-link"]').forEach((button) => {
      if (button.dataset.xucExpanded === "true") {
        return;
      }

      if (button.tagName === "A") {
        const href = button.getAttribute("href");
        if (href && href !== "#") {
          return;
        }
      }

      button.dataset.xucExpanded = "true";
      button.click();
      expandedAny = true;
    });
    return expandedAny;
  }

  function renderKeywordTags() {
    const list = document.getElementById(CONFIG.keywordListId);
    if (!list) {
      return;
    }

    list.replaceChildren();

    state.blockedKeywords.forEach((keyword, index) => {
      const tag = document.createElement("div");
      tag.className = "xuc-keyword-tag";

      const text = document.createElement("span");
      text.textContent = keyword;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "×";
      removeButton.title = "删除关键词";
      removeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        state.blockedKeywords.splice(index, 1);
        storageSet(CONFIG.blockedKeywordsStorageKey, state.blockedKeywords);
        renderKeywordTags();
        applyKeywordFilters(true);
      });

      tag.appendChild(text);
      tag.appendChild(removeButton);
      list.appendChild(tag);
    });
  }

  function updateWidthControls() {
    const widthValue = document.getElementById(CONFIG.widthValueId);
    const widthSlider = document.getElementById(CONFIG.widthSliderId);
    const presetButtons = document.querySelectorAll(".xuc-preset-btn");

    if (widthValue) {
      widthValue.textContent = `${state.tweetWidth}px`;
    }
    if (widthSlider) {
      widthSlider.value = String(state.tweetWidth);
    }

    presetButtons.forEach((button) => {
      const isActive = Number(button.dataset.width) === state.tweetWidth;
      button.classList.toggle("active", isActive);
      button.style.background = isActive ? "#1d9bf0" : "#15202b";
    });
  }

  function syncPanelVisibility() {
    const mapping = {
      search: document.querySelector(".xuc-search-panel"),
      layout: document.querySelector(".xuc-layout-panel"),
      collector: document.getElementById(CONFIG.panelId),
    };

    Object.entries(mapping).forEach(([name, node]) => {
      if (node) {
        node.classList.toggle("active", state.openPanel === name);
      }
    });

    updateButtons();
  }

  function togglePanel(panelName) {
    state.openPanel = state.openPanel === panelName ? "" : panelName;
    syncPanelVisibility();
  }

  function closePanels() {
    if (!state.openPanel) {
      return;
    }

    state.openPanel = "";
    syncPanelVisibility();
  }

  function updateScopeInfo() {
    const scope = getCollectionScope();
    if (canCollectCurrentPage(window.location.pathname)) {
      setScopeLabel(`当前页面: ${scope.label}`);
      return;
    }

    setScopeLabel("当前页面不支持采集，仍可使用宽屏、搜索和关键词过滤。");
  }

  function updateTweetWidth(width) {
    state.tweetWidth = clampTweetWidth(width);
    storageSet(CONFIG.tweetWidthStorageKey, state.tweetWidth);
    applyTweetWidth();
    updateWidthControls();
  }

  function addBlockedKeyword() {
    const input = document.getElementById(CONFIG.keywordInputId);
    if (!input) {
      return;
    }

    const value = String(input.value || "").trim();
    if (!value || state.blockedKeywords.includes(value)) {
      return;
    }

    state.blockedKeywords.push(value);
    storageSet(CONFIG.blockedKeywordsStorageKey, state.blockedKeywords);
    input.value = "";
    renderKeywordTags();
    applyKeywordFilters(true);
  }

  function runToolbarSearch() {
    const input = document.getElementById(CONFIG.searchInputId);
    const query = input ? String(input.value || "").trim() : "";
    if (!query) {
      return;
    }

    window.location.href = `${window.location.origin}/search?q=${encodeURIComponent(query)}&src=typed_query`;
  }

  function getToolbarIcons() {
    // 线条粗细与风格对齐 X 原生图标（搜索为 X 官方放大镜路径）
    return {
      menu: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"></path>
        </svg>
      `,
      search: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z"></path>
        </svg>
      `,
      layout: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h16v2H4V6zm3 5h10v2H7v-2zm3 5h4v2h-4v-2z"></path>
        </svg>
      `,
      collector: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.25c.55 0 1 .45 1 1v8.34l2.72-2.72 1.41 1.42-4.42 4.42a1 1 0 0 1-1.42 0l-4.42-4.42 1.41-1.42L11 12.59V4.25c0-.55.45-1 1-1z"></path>
          <path d="M4.75 14v4c0 .69.56 1.25 1.25 1.25h12c.69 0 1.25-.56 1.25-1.25v-4h2v4A3.25 3.25 0 0 1 18 21.25H6A3.25 3.25 0 0 1 2.75 18v-4h2z"></path>
        </svg>
      `,
    };
  }

  function buildToolbar() {
    if (!document.body || document.getElementById(CONFIG.toolbarId)) {
      return;
    }

    injectAppStyles();
    const icons = getToolbarIcons();
    const toolbar = document.createElement("div");
    toolbar.id = CONFIG.toolbarId;
    toolbar.innerHTML = `
      <div class="xuc-toolbar-buttons">
        <button type="button" class="xuc-toolbar-btn xuc-sidebar-toggle" title="显示或隐藏左侧导航">${icons.menu}</button>
        <button type="button" class="xuc-toolbar-btn xuc-search-toggle" title="打开搜索">${icons.search}</button>
        <button type="button" class="xuc-toolbar-btn xuc-layout-toggle" title="宽度与关键词过滤">${icons.layout}</button>
        <button type="button" class="xuc-toolbar-btn xuc-collector-toggle" title="采集与导出">${icons.collector}</button>
      </div>

      <div class="xuc-panel xuc-search-panel">
        <div class="xuc-panel-title">搜索</div>
        <div class="xuc-search-box">
          <input id="${CONFIG.searchInputId}" type="text" placeholder="搜索 X..." />
          <button id="${CONFIG.searchSubmitId}" type="button" class="xuc-primary">搜索</button>
        </div>
      </div>

      <div class="xuc-panel xuc-layout-panel">
        <div class="xuc-panel-title">布局与阅读</div>
        <div class="xuc-panel-subtitle">主题全站生效（深色主题配合 X 浅色模式效果最佳）；关键词过滤会隐藏命中的推文。</div>
        <div class="xuc-theme-row">
          <button type="button" class="xuc-theme-btn" data-theme="">默认</button>
          <button type="button" class="xuc-theme-btn" data-theme="paper">米黄</button>
          <button type="button" class="xuc-theme-btn" data-theme="green">豆绿</button>
          <button type="button" class="xuc-theme-btn" data-theme="dim">Dim</button>
          <button type="button" class="xuc-theme-btn" data-theme="oled">OLED</button>
        </div>
        <div class="xuc-read-section">
          <div class="xuc-slider-head">
            <span>正文字号</span>
            <strong id="${CONFIG.fontSizeValueId}">默认</strong>
          </div>
          <input id="${CONFIG.fontSizeSliderId}" type="range" min="13" max="20" step="1" value="13" />
          <div class="xuc-slider-head">
            <span>正文行距</span>
            <strong id="${CONFIG.lineHeightValueId}">默认</strong>
          </div>
          <input id="${CONFIG.lineHeightSliderId}" type="range" min="12" max="20" step="1" value="12" />
          <div class="xuc-toggle-row">
            <button type="button" class="xuc-toggle-btn xuc-serif-toggle">衬线字体</button>
            <button type="button" class="xuc-toggle-btn xuc-focus-toggle">聚焦模式</button>
            <button type="button" class="xuc-toggle-btn xuc-dimread-toggle">已读淡化</button>
          </div>
        </div>
        <div class="xuc-input-row" style="margin-top:14px;">
          <input id="${CONFIG.keywordInputId}" type="text" placeholder="添加屏蔽关键词" />
          <button id="${CONFIG.keywordAddButtonId}" type="button" class="xuc-primary">添加</button>
        </div>
        <div id="${CONFIG.keywordListId}" class="xuc-keyword-list"></div>
        <div class="xuc-width-section">
          <div class="xuc-width-head">
            <span>推文宽度</span>
            <strong id="${CONFIG.widthValueId}">${state.tweetWidth}px</strong>
          </div>
          <input id="${CONFIG.widthSliderId}" type="range" min="${CONFIG.minTweetWidth}" max="${CONFIG.maxTweetWidth}" step="50" value="${state.tweetWidth}" />
          <div class="xuc-preset-row">
            <button type="button" class="xuc-preset-btn" data-width="600">窄</button>
            <button type="button" class="xuc-preset-btn" data-width="800">中</button>
            <button type="button" class="xuc-preset-btn" data-width="1000">宽</button>
            <button type="button" class="xuc-preset-btn" data-width="1200">超宽</button>
          </div>
        </div>
      </div>

      <div id="${CONFIG.panelId}" class="xuc-panel">
        <div class="xuc-panel-title">采集与导出</div>
        <div id="${CONFIG.scopeId}">当前页面: 检测中...</div>
        <div class="xuc-action-row">
          <button id="${CONFIG.startButtonId}" type="button" class="xuc-primary">采集推文</button>
          <button id="${CONFIG.stopButtonId}" type="button" class="xuc-danger">停止</button>
          <button id="${CONFIG.exportJsonButtonId}" type="button">导出 JSON</button>
          <button id="${CONFIG.exportCsvButtonId}" type="button">导出 CSV</button>
          <button id="${CONFIG.exportMdButtonId}" type="button">导出 Markdown</button>
          <button id="${CONFIG.downloadMediaButtonId}" type="button" class="xuc-accent">下载图片 ZIP</button>
          <button id="${CONFIG.syncConfigButtonId}" type="button">书签同步配置</button>
        </div>
        <div id="${CONFIG.statusId}">等待开始</div>
      </div>
    `;

    toolbar.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    toolbar.querySelector(".xuc-sidebar-toggle").addEventListener("click", () => {
      state.sidebarVisible = !state.sidebarVisible;
      storageSet(CONFIG.sidebarStorageKey, state.sidebarVisible);
      applySidebarState();
      updateButtons();
    });

    toolbar.querySelector(".xuc-search-toggle").addEventListener("click", () => {
      togglePanel("search");
      if (state.openPanel === "search") {
        window.setTimeout(() => document.getElementById(CONFIG.searchInputId)?.focus(), 30);
      }
    });

    toolbar.querySelector(".xuc-layout-toggle").addEventListener("click", () => {
      togglePanel("layout");
      if (state.openPanel === "layout") {
        window.setTimeout(() => document.getElementById(CONFIG.keywordInputId)?.focus(), 30);
      }
    });

    toolbar.querySelector(".xuc-collector-toggle").addEventListener("click", () => {
      togglePanel("collector");
    });

    toolbar.querySelector(`#${CONFIG.searchSubmitId}`).addEventListener("click", runToolbarSearch);
    toolbar.querySelector(`#${CONFIG.searchInputId}`).addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runToolbarSearch();
      }
    });

    toolbar.querySelector(`#${CONFIG.keywordAddButtonId}`).addEventListener("click", addBlockedKeyword);
    toolbar.querySelector(`#${CONFIG.keywordInputId}`).addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addBlockedKeyword();
      }
    });

    toolbar.querySelector(`#${CONFIG.widthSliderId}`).addEventListener("input", (event) => {
      updateTweetWidth(event.target.value);
    });

    toolbar.querySelectorAll(".xuc-preset-btn").forEach((button) => {
      button.addEventListener("click", () => {
        updateTweetWidth(button.dataset.width);
      });
    });

    toolbar.querySelectorAll(".xuc-theme-btn").forEach((button) => {
      button.addEventListener("click", () => {
        state.theme = normalizeTheme(button.dataset.theme);
        storageSet(CONFIG.themeStorageKey, state.theme);
        applyTheme();
        tagElevatedBars();
        updateReadingControls();
      });
    });

    toolbar.querySelector(`#${CONFIG.fontSizeSliderId}`).addEventListener("input", (event) => {
      const raw = Number(event.target.value);
      state.fontSize = raw <= 13 ? 0 : clampFontSize(raw);
      storageSet(CONFIG.fontSizeStorageKey, state.fontSize);
      applyReadingPrefs();
      updateReadingControls();
    });

    toolbar.querySelector(`#${CONFIG.lineHeightSliderId}`).addEventListener("input", (event) => {
      const raw = Number(event.target.value) / 10;
      state.lineHeight = raw <= 1.2 ? 0 : clampLineHeight(raw);
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

    toolbar.querySelector(`#${CONFIG.startButtonId}`).addEventListener("click", () => {
      runCollection().catch((error) => {
        console.error("[X Collector] runCollection failed:", error);
        state.running = false;
        state.stopRequested = false;
        updateButtons();
        setStatus(`采集失败: ${error.message}`);
      });
    });

    toolbar.querySelector(`#${CONFIG.stopButtonId}`).addEventListener("click", stopCollection);
    toolbar.querySelector(`#${CONFIG.syncConfigButtonId}`).addEventListener("click", showBookmarkSyncConfigDialog);
    toolbar.querySelector(`#${CONFIG.exportJsonButtonId}`).addEventListener("click", exportJsonOnly);
    toolbar.querySelector(`#${CONFIG.exportCsvButtonId}`).addEventListener("click", exportCsvOnly);
    toolbar.querySelector(`#${CONFIG.exportMdButtonId}`).addEventListener("click", exportMarkdownOnly);
    toolbar.querySelector(`#${CONFIG.downloadMediaButtonId}`).addEventListener("click", () => {
      downloadMedia().catch((error) => {
        console.error("[X Collector] downloadMedia failed:", error);
        setStatus(`媒体下载失败: ${error.message}`);
      });
    });

    document.body.appendChild(toolbar);
    renderKeywordTags();
    updateWidthControls();
    updateReadingControls();
    updateScopeInfo();
    updateButtons();
    state.toolbarReady = true;
  }

  function ensureToolbar() {
    if (!document.body) {
      return;
    }

    buildToolbar();
    applySidebarState();
    applyTweetWidth();
    applyTheme();
    applyReadingPrefs();
    renderKeywordTags();
    updateWidthControls();
    updateReadingControls();
    updateScopeInfo();
    syncPanelVisibility();
  }

  const refreshInterface = debounce(() => {
    if (state.currentUrl !== window.location.href) {
      state.currentUrl = window.location.href;
      if (!state.running) {
        closePanels();
      }
    }

    startDomObserver();
    ensureToolbar();
    const expandedAny = autoExpandTweets();
    applyKeywordFilters(expandedAny);
    ensureReadObserver();
    tagElevatedBars();
    updateSyncWidget();
    updateButtons();
  }, 180);

  function installHistoryWatcher() {
    if (historyWatcherInstalled) {
      return;
    }

    historyWatcherInstalled = true;
    const wrap = (methodName) => {
      const original = history[methodName];
      const flag =
        methodName === "pushState"
          ? BOOKMARK_SYNC_HOOK_FLAGS.historyPushState
          : BOOKMARK_SYNC_HOOK_FLAGS.historyReplaceState;
      if (original[flag]) {
        return;
      }
      history[methodName] = function wrappedHistoryMethod(...args) {
        const result = original.apply(this, args);
        window.setTimeout(refreshInterface, 0);
        return result;
      };
      history[methodName][flag] = true;
    };

    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", refreshInterface);
    window.addEventListener("hashchange", refreshInterface);
    document.addEventListener("click", closePanels);
  }

  function startDomObserver() {
    const root = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main[role="main"]') || document.body;
    if (!root) {
      return;
    }

    if (domObserver && domObserverRoot === root) {
      return;
    }

    if (domObserver) {
      domObserver.disconnect();
    }

    domObserverRoot = root;
    domObserver = new MutationObserver(refreshInterface);
    domObserver.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  registerMenuCommands();
  installBookmarkSyncHooks();

  function bootstrap() {
    state.currentUrl = window.location.href;
    injectAppStyles();
    ensureToolbar();
    installHistoryWatcher();
    startDomObserver();
    initBookmarkSync();
    refreshInterface();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
