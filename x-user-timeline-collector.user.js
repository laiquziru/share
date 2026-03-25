// ==UserScript==
// @name         X 用户主页推文采集器
// @namespace    https://example.local/
// @version      0.2.0
// @description  在 X 用户主页或首页点击按钮后自动滚动采集推文，并支持导出 JSON、CSV 与图片 ZIP 下载。
// @author       Codex
// @match        https://x.com/*
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
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

  const CONFIG = {
    panelId: "x-tweet-collector-panel",
    statusId: "x-tweet-collector-status",
    startButtonId: "x-tweet-collector-start",
    stopButtonId: "x-tweet-collector-stop",
    exportJsonButtonId: "x-tweet-collector-export-json",
    exportCsvButtonId: "x-tweet-collector-export-csv",
    exportMdButtonId: "x-tweet-collector-export-md",
    downloadMediaButtonId: "x-tweet-collector-download-media",
    maxIdleRounds: 8,
    maxScrollRounds: 400,
    maxTweets: 3000,
    scrollStepFactor: 1.7,
    scrollDelayMs: 1400,
    settleDelayMs: 1800,
    topResetDelayMs: 1500,
  };

  const state = {
    running: false,
    tweets: [],
    tweetMap: new Map(),
    stopRequested: false,
    currentPath: "",
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

  function updateButtons() {
    const startButton = document.getElementById(CONFIG.startButtonId);
    const stopButton = document.getElementById(CONFIG.stopButtonId);
    const exportJsonButton = document.getElementById(CONFIG.exportJsonButtonId);
    const exportCsvButton = document.getElementById(CONFIG.exportCsvButtonId);
    const exportMdButton = document.getElementById(CONFIG.exportMdButtonId);
    const downloadMediaButton = document.getElementById(CONFIG.downloadMediaButtonId);

    if (startButton) {
      startButton.disabled = state.running;
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

  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = CONFIG.panelId;
    panel.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;">X 推文采集</div>
      <button id="${CONFIG.startButtonId}" type="button">采集推文</button>
      <button id="${CONFIG.stopButtonId}" type="button">停止</button>
      <button id="${CONFIG.exportJsonButtonId}" type="button">导出 JSON</button>
      <button id="${CONFIG.exportCsvButtonId}" type="button">导出 CSV</button>
      <button id="${CONFIG.exportMdButtonId}" type="button">导出 Markdown</button>
      <button id="${CONFIG.downloadMediaButtonId}" type="button">下载图片 ZIP</button>
      <div id="${CONFIG.statusId}" style="margin-top:6px;line-height:1.35;">等待开始</div>
    `;

    Object.assign(panel.style, {
      position: "fixed",
      right: "12px",
      bottom: "12px",
      zIndex: "2147483647",
      width: "220px",
      padding: "9px",
      borderRadius: "10px",
      background: "rgba(15, 20, 25, 0.92)",
      color: "#fff",
      boxShadow: "0 8px 30px rgba(0, 0, 0, 0.35)",
      fontSize: "12px",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      backdropFilter: "blur(8px)",
    });

    const style = document.createElement("style");
    style.textContent = `
      #${CONFIG.panelId} button {
        margin-right: 6px;
        margin-bottom: 5px;
        padding: 6px 8px;
        border: 0;
        border-radius: 7px;
        background: #1d9bf0;
        color: #fff;
        cursor: pointer;
        font-size: 12px;
        line-height: 1.2;
      }

      #${CONFIG.panelId} button:last-of-type {
        background: #536471;
      }

      #${CONFIG.exportJsonButtonId},
      #${CONFIG.exportCsvButtonId},
      #${CONFIG.exportMdButtonId},
      #${CONFIG.downloadMediaButtonId} {
        background: #15202b;
        border: 1px solid rgba(255, 255, 255, 0.14);
      }

      #${CONFIG.panelId} button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
    `;

    document.documentElement.appendChild(style);
    document.body.appendChild(panel);

    document.getElementById(CONFIG.startButtonId).addEventListener("click", () => {
      runCollection().catch((error) => {
        console.error("[X Collector] runCollection failed:", error);
        state.running = false;
        state.stopRequested = false;
        updateButtons();
        setStatus(`采集失败: ${error.message}`);
      });
    });

    document.getElementById(CONFIG.stopButtonId).addEventListener("click", stopCollection);
    document.getElementById(CONFIG.exportJsonButtonId).addEventListener("click", exportJsonOnly);
    document.getElementById(CONFIG.exportCsvButtonId).addEventListener("click", exportCsvOnly);
    document.getElementById(CONFIG.exportMdButtonId).addEventListener("click", exportMarkdownOnly);
    document.getElementById(CONFIG.downloadMediaButtonId).addEventListener("click", () => {
      downloadMedia().catch((error) => {
        console.error("[X Collector] downloadMedia failed:", error);
        setStatus(`媒体下载失败: ${error.message}`);
      });
    });
    updateButtons();
  }

  function ensurePanel() {
    const shouldShow = canCollectCurrentPage(window.location.pathname);
    const existing = document.getElementById(CONFIG.panelId);

    if (!shouldShow) {
      if (existing) {
        existing.remove();
      }
      return;
    }

    if (!existing && document.body) {
      buildPanel();
      setStatus(`当前页面: ${getCollectionScope().label}`);
    } else if (existing && !state.running) {
      setStatus(`当前页面: ${getCollectionScope().label}`);
    }
  }

  function startRouterWatcher() {
    setInterval(() => {
      if (state.currentPath !== window.location.pathname) {
        state.currentPath = window.location.pathname;
        ensurePanel();
      }
    }, 1000);
  }

  function bootstrap() {
    state.currentPath = window.location.pathname;
    ensurePanel();
    startRouterWatcher();
  }

  bootstrap();
})();
