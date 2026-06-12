// ==UserScript==
// @name         linux.do 标签新帖关键词提醒
// @namespace    https://linux.do/
// @version      1.0.0
// @description  监控 linux.do 指定标签最近 N 分钟的新帖，命中关键词后弹出可点击提醒
// @match        https://linux.do/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      linux.do
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    tagUrl: "https://linux.do/tag/444-tag/444.json?ascending=false&order=created",
    topicBaseUrl: "https://linux.do/t/topic/",
    keywords: ["公益站", "注册", "fable"],
    lookbackMinutes: 10,
    checkEverySeconds: 60,
    notifyOnStart: false,
  };

  const seenKey = "linux-do-keyword-monitor-seen-topic-ids";
  const maxSeen = 300;

  function loadSeen() {
    try {
      const value = GM_getValue(seenKey, "[]");
      return new Set(JSON.parse(value));
    } catch {
      return new Set();
    }
  }

  function saveSeen(seen) {
    GM_setValue(seenKey, JSON.stringify([...seen].slice(-maxSeen)));
  }

  function requestJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: {
          Accept: "application/json",
        },
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status}`));
            return;
          }

          try {
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            reject(error);
          }
        },
        onerror: reject,
        ontimeout: reject,
      });
    });
  }

  function normalizeText(value) {
    return String(value || "").toLowerCase();
  }

  function matchedKeywords(topic) {
    const haystack = normalizeText(`${topic.title} ${topic.fancy_title}`);
    return CONFIG.keywords.filter((keyword) =>
      haystack.includes(normalizeText(keyword))
    );
  }

  function getTopicUrl(topic) {
    return `${CONFIG.topicBaseUrl}${topic.id}`;
  }

  function isRecentTopic(topic, now) {
    const createdAt = new Date(topic.created_at);
    if (Number.isNaN(createdAt.getTime())) return false;

    const ageMs = now.getTime() - createdAt.getTime();
    return ageMs >= 0 && ageMs <= CONFIG.lookbackMinutes * 60 * 1000;
  }

  function notify(topic, keywords) {
    const url = getTopicUrl(topic);
    const title = `linux.do 新帖命中：${keywords.join(", ")}`;
    const text = topic.title || topic.fancy_title || url;

    if (typeof GM_notification === "function") {
      GM_notification({
        title,
        text,
        timeout: 15000,
        onclick() {
          window.open(url, "_blank", "noopener,noreferrer");
        },
      });
    }

    showToast(title, text, url);
  }

  function showToast(title, text, url) {
    const rootId = "linux-do-keyword-monitor-toasts";
    let root = document.getElementById(rootId);
    if (!root) {
      root = document.createElement("div");
      root.id = rootId;
      root.style.cssText = [
        "position:fixed",
        "right:18px",
        "bottom:18px",
        "z-index:2147483647",
        "display:flex",
        "flex-direction:column",
        "gap:10px",
        "max-width:min(420px,calc(100vw - 36px))",
      ].join(";");
      document.documentElement.appendChild(root);
    }

    const item = document.createElement("div");
    item.style.cssText = [
      "display:block",
      "position:relative",
      "box-sizing:border-box",
      "padding:12px 42px 12px 14px",
      "border:1px solid rgba(0,0,0,.14)",
      "border-radius:8px",
      "background:#fff",
      "color:#1f2937",
      "box-shadow:0 12px 28px rgba(0,0,0,.18)",
      "font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    ].join(";");

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.cssText = "display:block;color:inherit;text-decoration:none;";

    const titleEl = document.createElement("div");
    titleEl.textContent = title;
    titleEl.style.cssText = "font-weight:700;margin-bottom:4px;color:#111827;";

    const textEl = document.createElement("div");
    textEl.textContent = text;
    textEl.style.cssText = "overflow-wrap:anywhere;";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "×";
    closeButton.title = "关闭提醒";
    closeButton.style.cssText = [
      "position:absolute",
      "top:8px",
      "right:8px",
      "width:26px",
      "height:26px",
      "border:0",
      "border-radius:6px",
      "background:transparent",
      "color:#6b7280",
      "font:22px/22px system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "cursor:pointer",
    ].join(";");
    closeButton.addEventListener("click", () => item.remove());

    link.append(titleEl, textEl);
    item.append(link, closeButton);
    root.appendChild(item);
  }

  async function checkTopics(isInitialCheck) {
    const seen = loadSeen();
    const now = new Date();
    const data = await requestJson(CONFIG.tagUrl);
    const topics = data?.topic_list?.topics || [];

    for (const topic of topics) {
      if (!topic?.id || seen.has(topic.id)) continue;

      const keywords = matchedKeywords(topic);
      if (keywords.length > 0 && isRecentTopic(topic, now)) {
        if (!isInitialCheck || CONFIG.notifyOnStart) {
          notify(topic, keywords);
        }
      }

      seen.add(topic.id);
    }

    saveSeen(seen);
  }

  function start() {
    checkTopics(true).catch(console.error);
    window.setInterval(() => {
      checkTopics(false).catch(console.error);
    }, CONFIG.checkEverySeconds * 1000);
  }

  start();
})();
