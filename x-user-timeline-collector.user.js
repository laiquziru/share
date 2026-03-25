// ==UserScript==
// @name         X 用户主页推文采集器
// @namespace    https://example.local/
// @version      0.3.0
// @description  合并宽屏布局、搜索、关键词过滤与时间线采集导出功能的 X userscript。
// @author       Codex
// @match        https://x.com/*
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @connect      abs.twimg.com
// @connect      ton.twimg.com
// @connect      x.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

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
  };

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
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  }

  function parseCount(label) {
    if (!label) {
      return "";
    }

    const match = String(label).match(/([\d,.]+(?:[KMB])?)/i);
    return match ? match[1] : "";
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
    const urlMatch = String(tweetUrl).match(/x\.com\/([^/]+)\/status\/\d+/i);
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
    return (textNodes[0].innerText || "").trim();
  }

  function getQuotedText(article) {
    const textNodes = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
    if (textNodes.length <= 1) {
      return "";
    }
    return textNodes
      .slice(1)
      .map((node) => (node.innerText || "").trim())
      .filter(Boolean)
      .join("\n---\n");
  }

  function getMediaUrls(article) {
    const urls = new Set();

    Array.from(article.querySelectorAll('a[href*="/photo/"] img[src]')).forEach((img) => {
      if (img.src) {
        urls.add(img.src);
      }
    });

    Array.from(article.querySelectorAll("video")).forEach((video) => {
      if (video.poster) {
        urls.add(video.poster);
      }
      if (video.currentSrc) {
        urls.add(video.currentSrc);
      }
      Array.from(video.querySelectorAll("source")).forEach((source) => {
        if (source.src) {
          urls.add(source.src);
        }
      });
    });

    Array.from(article.querySelectorAll('img[src*="pbs.twimg.com/media"]')).forEach((img) => {
      if (img.src) {
        urls.add(img.src);
      }
    });

    return Array.from(urls);
  }

  function getMetricMap(article) {
    const metricMap = {
      replies: "",
      reposts: "",
      likes: "",
      views: "",
    };

    const buttonLabels = Array.from(article.querySelectorAll("button"))
      .map((button) => button.getAttribute("aria-label") || "")
      .filter(Boolean);

    buttonLabels.forEach((label) => {
      if (/Replies?/.test(label)) {
        metricMap.replies = parseCount(label);
      } else if (/reposts?/i.test(label)) {
        metricMap.reposts = parseCount(label);
      } else if (/Likes?/.test(label)) {
        metricMap.likes = parseCount(label);
      }
    });

    const analyticsAnchor = article.querySelector('a[href$="/analytics"]');
    if (analyticsAnchor) {
      metricMap.views = parseCount(analyticsAnchor.innerText || analyticsAnchor.getAttribute("aria-label") || "");
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
    const rawText = (article.innerText || "").trim();

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
      rawText,
    };
  }

  function collectVisibleTweets() {
    const targetHandle = getCollectionScope().mode === "profile" ? getTargetHandle() : "";
    const articles = Array.from(document.querySelectorAll("article"));
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

    return lines.join("\r\n");
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

  function exportAll() {
    if (!state.tweets.length) {
      window.alert("当前没有可导出的采集结果。");
      return;
    }

    const handle = sanitizeFilePart(getCollectionScope().key);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonName = `x-${handle}-tweets-${stamp}.json`;
    const csvName = `x-${handle}-tweets-${stamp}.csv`;

    triggerDownload(jsonName, JSON.stringify(state.tweets, null, 2), "application/json;charset=utf-8");
    triggerDownload(csvName, buildCsv(state.tweets), "text/csv;charset=utf-8");
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
    }
    if (searchToggle) {
      searchToggle.classList.toggle("active", state.openPanel === "search");
    }
    if (layoutToggle) {
      layoutToggle.classList.toggle("active", state.openPanel === "layout");
    }
    if (collectorToggle) {
      collectorToggle.classList.toggle("active", state.openPanel === "collector");
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
        background: rgba(255, 255, 255, 0.025) !important;
      }

      #${CONFIG.toolbarId} {
        position: fixed !important;
        left: 20px !important;
        bottom: 20px !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-start !important;
        gap: 12px !important;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-buttons {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn {
        width: 48px !important;
        height: 48px !important;
        border: none !important;
        border-radius: 999px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        color: #fff !important;
        background: rgba(83, 100, 113, 0.92) !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28) !important;
        transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease !important;
        backdrop-filter: blur(10px) !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn:hover {
        transform: translateY(-1px) scale(1.04) !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn svg {
        width: 22px !important;
        height: 22px !important;
        fill: currentColor !important;
      }

      #${CONFIG.toolbarId} .xuc-sidebar-toggle.sidebar-enabled {
        background: #00ba7c !important;
      }

      #${CONFIG.toolbarId} .xuc-toolbar-btn.active {
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.2), 0 10px 26px rgba(0, 0, 0, 0.32) !important;
      }

      #${CONFIG.toolbarId} .xuc-panel {
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
          left: 12px !important;
          right: 12px !important;
          bottom: 12px !important;
        }

        #${CONFIG.toolbarId} .xuc-panel {
          width: min(100vw - 24px, 340px) !important;
        }
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

  function resetHiddenTweets() {
    document.querySelectorAll('[data-xuc-hidden-by-keyword="true"]').forEach((node) => {
      node.style.display = "";
      node.removeAttribute("data-xuc-hidden-by-keyword");
    });
  }

  function applyKeywordFilters() {
    resetHiddenTweets();

    if (!state.blockedKeywords.length) {
      return;
    }

    const loweredKeywords = state.blockedKeywords.map((keyword) => keyword.toLowerCase());
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');

    tweets.forEach((tweet) => {
      const text = (tweet.innerText || "").toLowerCase();
      if (!text) {
        return;
      }

      const matched = loweredKeywords.some((keyword) => text.includes(keyword));
      if (!matched) {
        return;
      }

      const container = tweet.closest('[data-testid="cellInnerDiv"]') || tweet;
      container.style.display = "none";
      container.setAttribute("data-xuc-hidden-by-keyword", "true");
    });
  }

  function autoExpandTweets() {
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
    });
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
        applyKeywordFilters();
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
    applyKeywordFilters();
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
    return {
      menu: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"></path>
        </svg>
      `,
      search: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10.25 3.75a6.5 6.5 0 1 0 4.58 11.12l4.65 4.66 1.41-1.42-4.65-4.65a6.5 6.5 0 0 0-5.99-9.71zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z"></path>
        </svg>
      `,
      layout: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 6h10V4H10v2zM4 7.5A1.5 1.5 0 1 0 4 4.5a1.5 1.5 0 0 0 0 3zm10 6h6v-2h-6v2zM4 14.5A1.5 1.5 0 1 0 4 11.5a1.5 1.5 0 0 0 0 3zm6 5h10v-2H10v2zM4 20.5A1.5 1.5 0 1 0 4 17.5a1.5 1.5 0 0 0 0 3z"></path>
        </svg>
      `,
      collector: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.29 1.4 1.41-4.7 4.7-4.7-4.7 1.4-1.41 2.3 2.29V4a1 1 0 0 1 1-1zm-7 14h14v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-2z"></path>
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
        <div class="xuc-panel-title">布局与过滤</div>
        <div class="xuc-panel-subtitle">关键词过滤会隐藏当前时间线中命中的推文。</div>
        <div class="xuc-input-row" style="margin-top:10px;">
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
    renderKeywordTags();
    updateWidthControls();
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

    ensureToolbar();
    applyKeywordFilters();
    autoExpandTweets();
    updateButtons();
  }, 120);

  function installHistoryWatcher() {
    if (historyWatcherInstalled) {
      return;
    }

    historyWatcherInstalled = true;
    const wrap = (methodName) => {
      const original = history[methodName];
      history[methodName] = function wrappedHistoryMethod(...args) {
        const result = original.apply(this, args);
        window.setTimeout(refreshInterface, 0);
        return result;
      };
    };

    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", refreshInterface);
    window.addEventListener("hashchange", refreshInterface);
    document.addEventListener("click", closePanels);
  }

  function startDomObserver() {
    if (!document.body || domObserver) {
      return;
    }

    domObserver = new MutationObserver(refreshInterface);
    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
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
