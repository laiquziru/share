// ==UserScript==
// @name         抖音推荐页过滤器与数据提取
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  提取推荐流数据，按标题/作者关键词、点赞/评论/收藏阈值自动跳过，并支持直播延时跳过、白名单、快捷键与统计面板。
// @author       Antigravity
// @match        https://www.douyin.com/*
// @match        https://www.douyin.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_KEY = '__DOUYIN_AUTO_FILTER__';
    const CONFIG_KEY = 'douyin_filter_config';
    const PANEL_ID = 'douyin-filter-panel';
    const TOGGLE_ID = 'douyin-filter-toggle';
    const LOG_ID = 'douyin-filter-log';
    const STATUS_ID = 'douyin-filter-status';
    const VERSION = '2.0';

    const DEFAULT_CONFIG = {
        enableFilter: true,
        skipLives: true,
        blockKeywords: '广告,带货,不感兴趣',
        blockUsers: '营销号,卖课',
        allowKeywords: '',
        allowUsers: '',
        minLikes: 100,
        minComments: 0,
        minFavorites: 0,
        liveSkipSeconds: 15,
        debug: false
    };

    const state = {
        initialized: false,
        uiReady: false,
        processing: false,
        exportingComments: false,
        intervalId: null,
        liveTimer: null,
        logTimer: null,
        lastCheckedId: '',
        retryCount: 0,
        currentData: null,
        stats: {
            scanned: 0,
            skipped: 0,
            liveSkips: 0,
            keywordSkips: 0,
            userSkips: 0,
            likesSkips: 0,
            commentsSkips: 0,
            favoritesSkips: 0,
            manualSkips: 0
        },
        lastReason: '等待扫描'
    };

    let config = { ...DEFAULT_CONFIG, ...GM_getValue(CONFIG_KEY, {}) };

    const previousInstance = window[SCRIPT_KEY];
    if (previousInstance && typeof previousInstance.destroy === 'function') {
        previousInstance.destroy();
    }
    window[SCRIPT_KEY] = { destroy };

    GM_addStyle(`
        #${PANEL_ID} {
            position: fixed;
            top: 88px;
            right: 20px;
            z-index: 999999;
            width: 320px;
            max-height: calc(100vh - 120px);
            overflow-y: auto;
            display: none;
            background: rgba(18, 18, 18, 0.96);
            color: #f4f4f4;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
            padding: 16px;
            font-size: 13px;
            line-height: 1.45;
            backdrop-filter: blur(8px);
        }
        #${PANEL_ID} h3 {
            margin: 0 0 12px;
            font-size: 16px;
            color: #fe2c55;
        }
        #${PANEL_ID} .df-section {
            margin-top: 14px;
            padding-top: 12px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        #${PANEL_ID} .df-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }
        #${PANEL_ID} label {
            display: block;
            margin-bottom: 10px;
            color: #d9d9d9;
        }
        #${PANEL_ID} label.df-checkbox {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }
        #${PANEL_ID} input[type="text"],
        #${PANEL_ID} input[type="number"] {
            width: 100%;
            margin-top: 4px;
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            background: rgba(255, 255, 255, 0.06);
            color: #fff;
            box-sizing: border-box;
            outline: none;
        }
        #${PANEL_ID} input[type="checkbox"] {
            accent-color: #fe2c55;
        }
        #${PANEL_ID} button {
            cursor: pointer;
            border: none;
            border-radius: 8px;
            padding: 8px 12px;
            color: #fff;
            background: #3a3a3a;
        }
        #${PANEL_ID} button.save {
            background: #fe2c55;
        }
        #${PANEL_ID} button.ghost {
            background: rgba(255, 255, 255, 0.08);
        }
        #${PANEL_ID} .df-actions,
        #${PANEL_ID} .df-quick-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        #${PANEL_ID} .df-quick-actions {
            margin-top: 10px;
        }
        #${PANEL_ID} .df-note,
        #${PANEL_ID} .df-kv {
            color: #bfbfbf;
        }
        #${PANEL_ID} .df-note {
            font-size: 12px;
            margin-top: 8px;
        }
        #${PANEL_ID} .df-kv {
            display: grid;
            grid-template-columns: 80px 1fr;
            gap: 6px;
            margin-top: 6px;
            word-break: break-word;
        }
        #${STATUS_ID} {
            margin-top: 10px;
            padding: 10px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.05);
        }
        #${TOGGLE_ID} {
            position: fixed;
            top: 124px;
            right: 0;
            z-index: 999998;
            writing-mode: vertical-rl;
            text-orientation: upright;
            letter-spacing: 2px;
            padding: 12px 5px;
            border-radius: 8px 0 0 8px;
            cursor: pointer;
            background: #fe2c55;
            color: #fff;
            box-shadow: 0 8px 24px rgba(254, 44, 85, 0.28);
            user-select: none;
        }
        #${LOG_ID} {
            position: fixed;
            right: 20px;
            bottom: 80px;
            z-index: 999999;
            max-width: min(420px, calc(100vw - 40px));
            padding: 8px 12px;
            border-radius: 999px;
            background: rgba(0, 0, 0, 0.82);
            border: 1px solid rgba(255, 255, 255, 0.12);
            color: #fff;
            font-size: 12px;
            line-height: 1.4;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
        }
    `);

    function destroy() {
        clearInterval(state.intervalId);
        clearTimeout(state.liveTimer);
        clearTimeout(state.logTimer);
        state.intervalId = null;
        state.liveTimer = null;
        state.logTimer = null;
        document.removeEventListener('keydown', handleKeydown, true);

        const ids = [PANEL_ID, TOGGLE_ID, LOG_ID];
        ids.forEach((id) => document.getElementById(id)?.remove());
    }

    function debugLog(message, extra) {
        if (!config.debug) return;
        if (typeof extra === 'undefined') {
            console.log(`[DouyinFilter] ${message}`);
            return;
        }
        console.log(`[DouyinFilter] ${message}`, extra);
    }

    function showLog(message) {
        let node = document.getElementById(LOG_ID);
        if (!node) {
            node = document.createElement('div');
            node.id = LOG_ID;
            document.body.appendChild(node);
        }
        node.innerText = message;
        node.style.opacity = '1';
        clearTimeout(state.logTimer);
        state.logTimer = setTimeout(() => {
            node.style.opacity = '0';
        }, 3500);
        console.log(`[DouyinFilter] ${message}`);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function splitList(value) {
        return String(value || '')
            .split(/[,\n，、]+/)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    function includesAny(text, listValue) {
        const haystack = String(text || '').toLowerCase();
        if (!haystack) return '';
        const list = splitList(listValue);
        for (const item of list) {
            if (haystack.includes(item.toLowerCase())) {
                return item;
            }
        }
        return '';
    }

    function parseCount(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return 0;

        let multiplier = 1;
        if (raw.endsWith('w') || raw.endsWith('万')) multiplier = 10000;
        else if (raw.endsWith('k') || raw.endsWith('千')) multiplier = 1000;
        else if (raw.endsWith('m')) multiplier = 1000000;
        else if (raw.endsWith('亿')) multiplier = 100000000;

        const numeric = parseFloat(raw.replace(/[^\d.]/g, ''));
        return Number.isFinite(numeric) ? numeric * multiplier : 0;
    }

    function getText(scope, selectors) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        for (const selector of selectorList) {
            const node = scope.querySelector(selector);
            const text = node?.innerText?.trim();
            if (text) return text;
        }
        return '';
    }

    function getCurrentFeedItem() {
        const activeNode = document.querySelector('[data-e2e="feed-active-video"]');
        if (activeNode) {
            return activeNode.closest('[data-e2e="feed-item"]') || activeNode;
        }

        const items = [...document.querySelectorAll('[data-e2e="feed-item"]')];
        if (!items.length) return null;

        const centerY = window.innerHeight / 2;
        let bestItem = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (const item of items) {
            const rect = item.getBoundingClientRect();
            if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;

            const overlapsCenter = rect.top <= centerY && rect.bottom >= centerY;
            const midpoint = rect.top + rect.height / 2;
            const distance = overlapsCenter ? 0 : Math.abs(midpoint - centerY);

            if (distance < bestDistance) {
                bestDistance = distance;
                bestItem = item;
            }
        }

        return bestItem;
    }

    function getCurrentVideoData() {
        const container = getCurrentFeedItem();
        if (!container) return null;

        const title = getText(container, [
            '[data-e2e="video-desc"]',
            '.desc-content',
            '.title'
        ]);
        const author = getText(container, [
            '[data-e2e="feed-video-nickname"]',
            '[data-e2e="video-author-name"]',
            '[data-e2e="video-author-uniqueid"]',
            '.account-name'
        ]);
        const likesText = getText(container, [
            '[data-e2e="video-player-digg"]',
            '[data-e2e="like-icon"]'
        ]);
        const commentsText = getText(container, [
            '[data-e2e="feed-comment-icon"]',
            '[data-e2e="comment-icon"]'
        ]);
        const favoritesText = getText(container, [
            '[data-e2e="video-player-collect"]',
            '[data-e2e="collection-icon"]'
        ]);
        const shareText = getText(container, [
            '[data-e2e="video-player-share"]'
        ]);

        const isLive = Boolean(
            container.querySelector('[data-e2e="feed-live"]') ||
            container.querySelector('[data-e2e="live-slider"]') ||
            container.querySelector('.live-badge') ||
            /直播中/.test(container.innerText || '')
        );

        const videoNode = container.querySelector('video');
        const videoId = container.querySelector('[data-e2e-vid]')?.getAttribute('data-e2e-vid') || '';
        const href = container.querySelector('a[href*="/user/"], a[href*="/video/"], a[href*="/note/"]')?.href || '';
        const src = videoNode?.getAttribute('src') || '';
        const id = [
            videoId,
            href.slice(-48),
            title.slice(0, 24),
            author.slice(0, 24),
            likesText,
            src.slice(-24)
        ].filter(Boolean).join('|');

        if (!id && !title && !author && !likesText && !isLive) {
            return null;
        }

        return {
            id: id || `fallback|${Date.now()}`,
            title,
            author,
            likesText,
            commentsText,
            favoritesText,
            shareText,
            likes: parseCount(likesText),
            comments: parseCount(commentsText),
            favorites: parseCount(favoritesText),
            isLive,
            href,
            videoId
        };
    }

    function isInputElement(node) {
        if (!node) return false;
        const tag = node.tagName?.toLowerCase();
        return tag === 'input' || tag === 'textarea' || node.isContentEditable;
    }

    function isRecommendPage() {
        return location.hostname === 'www.douyin.com' && (
            location.search.includes('recommend=1') ||
            location.pathname === '/' ||
            location.pathname === ''
        );
    }

    function resetLiveTimer() {
        if (state.liveTimer) {
            clearTimeout(state.liveTimer);
            state.liveTimer = null;
        }
    }

    function saveConfig() {
        GM_setValue(CONFIG_KEY, config);
    }

    function setReason(reason) {
        state.lastReason = reason;
        refreshStatus();
    }

    function markSkip(kind, reason) {
        state.stats.skipped += 1;
        if (kind && typeof state.stats[kind] === 'number') {
            state.stats[kind] += 1;
        }
        setReason(reason);
    }

    function skipVideo(reason, kind) {
        if (state.processing) return false;
        state.processing = true;
        resetLiveTimer();

        if (reason) {
            markSkip(kind, reason);
            showLog(reason);
        }

        const nextButton = document.querySelector('[data-e2e="video-switch-next-arrow"]');
        if (nextButton) {
            nextButton.click();
        } else {
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowDown',
                code: 'ArrowDown',
                keyCode: 40,
                which: 40,
                bubbles: true
            }));
        }

        setTimeout(() => {
            state.lastCheckedId = '';
            state.processing = false;
        }, 800);

        return true;
    }

    function scheduleLiveSkip(data) {
        if (!config.skipLives) return;
        resetLiveTimer();

        const seconds = Math.max(0, Number(config.liveSkipSeconds) || 0);
        if (seconds === 0) {
            skipVideo('直播已自动跳过', 'liveSkips');
            return;
        }

        setReason(`检测到直播，${seconds}s 后自动跳过`);
        showLog(`检测到直播，${seconds}s 后自动跳过`);
        state.liveTimer = setTimeout(() => {
            const current = getCurrentVideoData();
            if (!current || current.id !== data.id || !current.isLive || !isRecommendPage()) return;
            skipVideo('直播已自动跳过', 'liveSkips');
        }, seconds * 1000);
    }

    function refreshStatus() {
        const statusNode = document.getElementById(STATUS_ID);
        if (!statusNode) return;

        const data = state.currentData;
        const title = data?.title || '未识别到标题';
        const author = data?.author || '未识别到作者';
        const counts = data
            ? `赞 ${data.likesText || 0} / 评 ${data.commentsText || 0} / 藏 ${data.favoritesText || 0}`
            : '暂无当前卡片数据';

        statusNode.innerHTML = `
            <div class="df-kv"><strong>状态</strong><span>${escapeHtml(state.lastReason)}</span></div>
            <div class="df-kv"><strong>当前作者</strong><span>${escapeHtml(author)}</span></div>
            <div class="df-kv"><strong>当前标题</strong><span>${escapeHtml(title)}</span></div>
            <div class="df-kv"><strong>当前数据</strong><span>${escapeHtml(counts)}</span></div>
            <div class="df-kv"><strong>统计</strong><span>扫描 ${state.stats.scanned} / 跳过 ${state.stats.skipped}</span></div>
            <div class="df-kv"><strong>细分</strong><span>直播 ${state.stats.liveSkips} | 标题 ${state.stats.keywordSkips} | 作者 ${state.stats.userSkips} | 点赞 ${state.stats.likesSkips} | 评论 ${state.stats.commentsSkips} | 收藏 ${state.stats.favoritesSkips} | 手动 ${state.stats.manualSkips}</span></div>
        `;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function sanitizeFilenamePart(value) {
        return String(value || 'douyin')
            .replace(/[\\/:*?"<>|]+/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 40) || 'douyin';
    }

    function buildExportBaseName() {
        const data = state.currentData || {};
        const author = sanitizeFilenamePart((data.author || '').replace(/^@/, ''));
        const title = sanitizeFilenamePart(data.title || data.videoId || 'video');
        return `douyin_${author}_${title}`;
    }

    function downloadTextFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function setCommentExportBusy(isBusy) {
        state.exportingComments = isBusy;
        const button = document.getElementById('df-export-comments');
        if (!button) return;
        button.disabled = isBusy;
        button.textContent = isBusy ? '采集中...' : '导出评论';
    }

    function pageFetchText(url) {
        return new Promise((resolve, reject) => {
            const requestId = `douyin-fetch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const eventName = `${requestId}:done`;
            const timeout = setTimeout(() => {
                window.removeEventListener(eventName, onDone);
                reject(new Error('page fetch timeout'));
            }, 10000);

            function cleanup(scriptNode) {
                clearTimeout(timeout);
                window.removeEventListener(eventName, onDone);
                scriptNode?.remove();
            }

            function onDone(event) {
                const detail = event.detail || {};
                cleanup(script);
                if (!detail.ok) {
                    reject(new Error(detail.error || 'page fetch failed'));
                    return;
                }
                resolve(detail.text || '');
            }

            window.addEventListener(eventName, onDone, { once: true });

            const script = document.createElement('script');
            script.textContent = `
                (() => {
                    const eventName = ${JSON.stringify(eventName)};
                    const url = ${JSON.stringify(url)};
                    window.fetch(url, { credentials: 'include' })
                        .then(async (response) => {
                            const text = await response.text();
                            window.dispatchEvent(new CustomEvent(eventName, {
                                detail: {
                                    ok: response.ok,
                                    status: response.status,
                                    text,
                                    error: response.ok ? '' : 'status ' + response.status
                                }
                            }));
                        })
                        .catch((error) => {
                            window.dispatchEvent(new CustomEvent(eventName, {
                                detail: {
                                    ok: false,
                                    error: String(error)
                                }
                            }));
                        });
                })();
            `;

            (document.head || document.documentElement).appendChild(script);
        });
    }

    function collectSubtitleLines() {
        const lines = [];
        const seen = new Set();
        const data = state.currentData;
        const feedItem = getCurrentFeedItem();
        const video = feedItem?.querySelector('video');

        const pushLine = (value) => {
            const line = String(value || '').trim();
            if (!line || seen.has(line)) return;
            seen.add(line);
            lines.push(line);
        };

        if (data?.author) pushLine(`作者：${data.author}`);
        if (data?.title) pushLine(`文案：${data.title}`);

        if (video?.textTracks?.length) {
            [...video.textTracks].forEach((track) => {
                if (!track?.cues?.length) return;
                [...track.cues].forEach((cue) => pushLine(`[${cue.startTime.toFixed(2)}-${cue.endTime.toFixed(2)}] ${cue.text}`));
            });
        }

        const candidates = [
            ...(feedItem ? [...feedItem.querySelectorAll('[data-e2e="video-desc"], [data-e2e="video-info"]')] : []),
            ...[...document.querySelectorAll('[class*="caption"], [class*="subtitle"], [class*="texttrack"], .xg-texttrack')]
        ];

        candidates.forEach((node) => {
            const text = node?.innerText || '';
            text.split('\n').forEach((line) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                if (/^字幕$|^不开启$|^听抖音$|^发送$|^清屏$|^连播$|^倍速$/.test(trimmed)) return;
                pushLine(trimmed);
            });
        });

        return lines;
    }

    function getCurrentAwemeId() {
        const feedItem = getCurrentFeedItem();
        return feedItem?.querySelector('[data-e2e-vid]')?.getAttribute('data-e2e-vid') || state.currentData?.videoId || '';
    }

    async function ensureCommentPanelReady() {
        const existingList = document.querySelector('[class*="comment-mainContent"]');
        if (existingList) return existingList;

        const currentItem = getCurrentFeedItem();
        const commentTrigger = currentItem?.querySelector('[data-e2e="feed-comment-icon"]');
        if (commentTrigger) {
            (commentTrigger.closest('button') || commentTrigger.parentElement || commentTrigger).click();
            await sleep(700);
        }

        const commentTab = [...document.querySelectorAll('span,div,button')]
            .find((node) => (node.innerText || '').trim() === '评论');
        if (commentTab) {
            commentTab.click();
            await sleep(500);
        }

        for (let i = 0; i < 6; i += 1) {
            const list = document.querySelector('[class*="comment-mainContent"]');
            if (list) return list;
            await sleep(400);
        }

        return null;
    }

    function parseCommentBlock(block) {
        const infoNode = block.querySelector('[class*="comment-item-info-wrap"]');
        const statsNode = block.querySelector('[class*="comment-item-stats-container"]');
        const timeNode = block.querySelector('[class*="fJhvAqos"], [class*="comment-item-time"]');
        const explicitContentNode = block.querySelector('[class*="comment-item-content"], [class*="comment-content"], [class*="comment-text"], [class*="C7LroK_h"]');
        const author = infoNode?.innerText?.split('\n').map((line) => line.trim()).find(Boolean) || '';

        let content = explicitContentNode?.innerText?.trim() || '';
        if (!content) {
            const childTexts = [...block.children]
                .map((child) => ({
                    node: child,
                    text: (child.innerText || '').trim()
                }))
                .filter((item) => item.text);

            content = childTexts.find((item) => {
                if (item.node === infoNode || item.node === statsNode || item.node === timeNode) return false;
                if (item.text === author) return false;
                if (/分享|回复|展开\d+条回复|收起回复/.test(item.text)) return false;
                if (/^\d+(分钟前|小时前|天前|月前)$/.test(item.text)) return false;
                return true;
            })?.text || '';
        }

        const time = timeNode?.innerText?.trim()
            || [...block.children]
                .map((child) => (child.innerText || '').trim())
                .find((text) => /分钟前|小时前|天前|月前|刚刚|·/.test(text))
            || '';

        const likesText = statsNode?.querySelector('[class*="_oyDzM4h"], [class*="comment-like-count"]')?.innerText?.trim()
            || statsNode?.innerText?.split('\n').map((line) => line.trim()).find((line) => /^\d+$/.test(line))
            || '0';

        return {
            source: 'dom_scroll',
            author,
            content,
            time,
            likes: parseCount(likesText)
        };
    }

    function normalizeApiComment(comment) {
        return {
            source: 'api',
            cid: comment.cid || '',
            content: comment.text || '',
            text: comment.text || '',
            likes: Number(comment.digg_count || 0),
            replyCount: Number(comment.reply_comment_total || 0),
            createTime: Number(comment.create_time || 0),
            createTimeISO: comment.create_time ? new Date(comment.create_time * 1000).toISOString() : '',
            ipLabel: comment.ip_label || '',
            isAuthorDigged: Boolean(comment.is_author_digged),
            author: comment.user?.nickname || '',
            secUid: comment.user?.sec_uid || '',
            uid: comment.user?.uid || ''
        };
    }

    async function collectCommentsViaApi() {
        const awemeId = getCurrentAwemeId();
        if (!awemeId) return [];

        const comments = [];
        const seen = new Set();
        let cursor = 0;
        let hasMore = true;
        let guard = 0;

        while (hasMore && guard < 30) {
            guard += 1;

            const url = new URL('https://www-hj.douyin.com/aweme/v1/web/comment/list/');
            url.searchParams.set('device_platform', 'webapp');
            url.searchParams.set('aid', '6383');
            url.searchParams.set('channel', 'channel_pc_web');
            url.searchParams.set('aweme_id', awemeId);
            url.searchParams.set('cursor', String(cursor));
            url.searchParams.set('count', '50');
            url.searchParams.set('item_type', '0');

            let payload = null;
            let lastError = null;

            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    const rawText = await pageFetchText(url.toString());
                    if (!rawText.trim()) {
                        throw new Error('comment api returned empty body');
                    }

                    payload = JSON.parse(rawText);
                    break;
                } catch (error) {
                    lastError = error;
                    await sleep(300 * (attempt + 1));
                }
            }

            if (!payload) {
                throw lastError || new Error('comment api parse failed');
            }

            if (payload.status_code !== 0) {
                throw new Error(`comment api status_code=${payload.status_code}`);
            }

            const list = Array.isArray(payload.comments) ? payload.comments : [];
            list.forEach((comment) => {
                const normalized = normalizeApiComment(comment);
                if (!normalized.cid || seen.has(normalized.cid)) return;
                seen.add(normalized.cid);
                comments.push(normalized);
            });

            hasMore = Boolean(payload.has_more);
            cursor = Number(payload.cursor || 0);
            if (!list.length) break;
        }

        return comments;
    }

    async function collectComments() {
        const scrollContainer = await ensureCommentPanelReady();
        if (!scrollContainer) return [];

        const originalScrollTop = scrollContainer.scrollTop;
        const comments = new Map();
        let stableRounds = 0;

        for (let round = 0; round < 8; round += 1) {
            const blocks = [...scrollContainer.querySelectorAll('[class*="comment-item-info-wrap"]')]
                .map((node) => node.parentElement)
                .filter(Boolean);

            blocks.forEach((block) => {
                const parsed = parseCommentBlock(block);
                if (!parsed.author && !parsed.content) return;
                const key = `${parsed.author}|${parsed.content}|${parsed.time}`;
                comments.set(key, parsed);
            });

            const before = comments.size;
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
            await sleep(650);
            if (comments.size === before) {
                stableRounds += 1;
            } else {
                stableRounds = 0;
            }
            if (stableRounds >= 2) break;
        }

        scrollContainer.scrollTop = originalScrollTop;
        return [...comments.values()];
    }

    async function copyCurrentData() {
        if (!state.currentData) {
            showLog('当前没有可复制的数据');
            return;
        }

        const payload = JSON.stringify({
            title: state.currentData.title,
            author: state.currentData.author,
            likes: state.currentData.likes,
            comments: state.currentData.comments,
            favorites: state.currentData.favorites,
            likesText: state.currentData.likesText,
            commentsText: state.currentData.commentsText,
            favoritesText: state.currentData.favoritesText,
            isLive: state.currentData.isLive,
            href: state.currentData.href,
            videoId: state.currentData.videoId
        }, null, 2);

        try {
            await navigator.clipboard.writeText(payload);
            showLog('当前视频信息已复制到剪贴板');
        } catch (error) {
            console.error('[DouyinFilter] 复制失败', error);
            showLog('复制失败，浏览器未允许剪贴板访问');
        }
    }

    function exportCurrentData() {
        if (!state.currentData) {
            showLog('当前没有可导出的数据');
            return;
        }

        const payload = {
            ...state.currentData,
            exportedAt: new Date().toISOString(),
            page: location.href
        };
        downloadTextFile(`${buildExportBaseName()}_info.json`, `${JSON.stringify(payload, null, 2)}\n`, 'application/json;charset=utf-8');
        showLog('当前视频信息已导出');
    }

    function exportSubtitleText() {
        const lines = collectSubtitleLines();
        if (!lines.length) {
            showLog('当前视频没有可导出的字幕或文案');
            return;
        }

        downloadTextFile(`${buildExportBaseName()}_subtitle.txt`, `${lines.join('\n')}\n`, 'text/plain;charset=utf-8');
        showLog(`已导出 ${lines.length} 行字幕/文案候选`);
    }

    async function exportComments() {
        showLog('正在整理评论...');
        let comments = [];

        try {
            comments = await collectCommentsViaApi();
        } catch (error) {
            console.error('[DouyinFilter] 评论接口导出失败', error);
            showLog('评论接口导出失败，已停止导出，避免生成错误内容');
            return;
        }

        if (comments.length) {
            showLog(`评论接口抓取成功，共 ${comments.length} 条`);
        }

        if (!comments.length) {
            showLog('评论接口没有返回评论数据');
            return;
        }

        const payload = {
            video: {
                author: state.currentData?.author || '',
                title: state.currentData?.title || '',
                videoId: state.currentData?.videoId || '',
                href: state.currentData?.href || location.href
            },
            exportedAt: new Date().toISOString(),
            total: comments.length,
            source: comments[0]?.source || 'unknown',
            comments
        };

        downloadTextFile(`${buildExportBaseName()}_comments.json`, `${JSON.stringify(payload, null, 2)}\n`, 'application/json;charset=utf-8');
        showLog(`已导出 ${comments.length} 条评论`);
    }

    function isElementVisible(node) {
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight + 40;
    }

    function clickElementSafely(node) {
        if (!node) return false;
        try {
            node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        } catch (error) {
            // ignore scroll errors from detached nodes
        }

        const target = node.closest('button, [tabindex="0"], [role="button"]') || node;
        try {
            if (typeof target.focus === 'function') {
                target.focus({ preventScroll: true });
            }
        } catch (error) {
            // ignore focus errors
        }

        try {
            if (typeof target.click === 'function') {
                target.click();
                return true;
            }
        } catch (error) {
            // fall back to synthetic events below
        }

        ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((type) => {
            target.dispatchEvent(new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                composed: true
            }));
        });
        return true;
    }

    function clickElementAtCenter(node) {
        if (!node || !isElementVisible(node)) return false;

        const rect = node.getBoundingClientRect();
        const centerX = Math.min(window.innerWidth - 2, Math.max(2, rect.left + rect.width / 2));
        const centerY = Math.min(window.innerHeight - 2, Math.max(2, rect.top + rect.height / 2));
        const hitNode = document.elementFromPoint(centerX, centerY);
        const target = hitNode?.closest?.('button, [role="button"], [data-e2e="feed-comment-icon"]')
            || node.closest?.('button, [role="button"]')
            || node;

        ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((type) => {
            target.dispatchEvent(new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                composed: true,
                clientX: centerX,
                clientY: centerY
            }));
        });
        return true;
    }

    function findPreferredCommentTrigger() {
        const currentItem = getCurrentFeedItem();
        const currentVideoId = currentItem?.querySelector('[data-e2e-vid]')?.getAttribute('data-e2e-vid') || '';
        const currentRect = currentItem?.getBoundingClientRect?.();
        const triggers = [...document.querySelectorAll('[data-e2e="feed-comment-icon"]')]
            .filter((node) => isElementVisible(node))
            .map((node) => {
                const rect = node.getBoundingClientRect();
                const nodeVideoId = node.closest('[data-e2e-vid]')?.getAttribute('data-e2e-vid')
                    || node.querySelector('[data-e2e-vid]')?.getAttribute('data-e2e-vid')
                    || '';
                let score = 0;

                score += rect.left;
                score -= Math.abs((rect.top + rect.height / 2) - window.innerHeight / 2);
                if (rect.left >= window.innerWidth * 0.7) score += 1200;
                if (rect.top >= 0 && rect.bottom <= window.innerHeight + 20) score += 800;
                if (currentRect && rect.top >= currentRect.top - 40 && rect.bottom <= currentRect.bottom + 40) score += 600;
                if (currentVideoId && nodeVideoId && currentVideoId === nodeVideoId) score += 3000;

                return { node, score };
            })
            .sort((a, b) => b.score - a.score);

        return triggers[0]?.node || null;
    }

    async function ensureCommentPanelReady() {
        const visibleExistingList = [...document.querySelectorAll('[class*="comment-mainContent"]')]
            .find((node) => isElementVisible(node));
        if (visibleExistingList) return visibleExistingList;

        const commentTrigger = findPreferredCommentTrigger();
        if (commentTrigger) {
            const triggerHolder = commentTrigger.closest('[tabindex="0"], button, [role="button"]')
                || commentTrigger.parentElement
                || commentTrigger;

            clickElementSafely(triggerHolder);
            await sleep(600);

            const openedAfterNativeClick = [...document.querySelectorAll('[class*="comment-mainContent"]')]
                .find((node) => isElementVisible(node));
            if (!openedAfterNativeClick) {
                clickElementSafely(commentTrigger);
                await sleep(500);
            }

            const openedAfterDirectClick = [...document.querySelectorAll('[class*="comment-mainContent"]')]
                .find((node) => isElementVisible(node));
            if (!openedAfterDirectClick) {
                clickElementAtCenter(commentTrigger);
                await sleep(900);
            }
        }

        const commentTab = [...document.querySelectorAll('[role="tab"],span,div,button')]
            .find((node) => isElementVisible(node) && (node.innerText || '').trim() === '\u8bc4\u8bba');
        if (commentTab && commentTab.getAttribute('aria-selected') !== 'true') {
            clickElementSafely(commentTab);
            await sleep(600);
        }

        for (let i = 0; i < 10; i += 1) {
            const list = [...document.querySelectorAll('[class*="comment-mainContent"]')]
                .find((node) => isElementVisible(node));
            if (list) return list;
            await sleep(400);
        }

        return null;
    }

    function sanitizeCommentText(text) {
        if (!text) return '';

        return String(text)
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => !/^\.{3,}$/.test(line))
            .filter((line) => !/^(?:\u52a0\u8f7d\u4e2d|\u5206\u4eab|\u56de\u590d|\u4f5c\u8005\u8d5e\u8fc7)$/.test(line))
            .join('\n')
            .trim();
    }

    function isCommentTimeText(text) {
        return /(?:\u5206\u949f\u524d|\u5c0f\u65f6\u524d|\u5929\u524d|\u5468\u524d|\u6708\u524d|\u521a\u521a|\u00b7)/.test(text || '');
    }

    function parseCommentBlock(block) {
        const infoNode = block.querySelector('[class*="comment-item-info-wrap"]');
        const statsNode = block.querySelector('[class*="comment-item-stats-container"]');
        const timeNode = block.querySelector('[class*="fJhvAqos"], [class*="comment-item-time"]');
        const explicitContentNode = block.querySelector('[class*="comment-item-content"], [class*="comment-content"], [class*="comment-text"], [class*="C7LroK_h"]');
        const author = sanitizeCommentText(
            infoNode?.querySelector('a, [class*="_uYOTNYZ"], [class*="BT7MlqJC"], [class*="uz1VJwFY"]')?.innerText
            || infoNode?.innerText?.split('\n').map((line) => line.trim()).find(Boolean)
            || ''
        );

        let content = sanitizeCommentText(explicitContentNode?.innerText || '');
        if (!content) {
            const childTexts = [...block.children]
                .map((child) => ({
                    node: child,
                    text: sanitizeCommentText(child.innerText || '')
                }))
                .filter((item) => item.text);

            content = childTexts.find((item) => {
                if (item.node === infoNode || item.node === statsNode || item.node === timeNode) return false;
                if (item.text === author) return false;
                if (/^(?:\u5c55\u5f00\d+\u6761\u56de\u590d|\u6536\u8d77\u56de\u590d)$/.test(item.text)) return false;
                if (isCommentTimeText(item.text)) return false;
                return true;
            })?.text || '';
        }

        const time = sanitizeCommentText(timeNode?.innerText || '')
            || [...block.children]
                .map((child) => sanitizeCommentText(child.innerText || ''))
                .find((text) => isCommentTimeText(text))
            || '';

        const likesText = statsNode?.querySelector('[class*="_oyDzM4h"], [class*="comment-like-count"]')?.innerText?.trim()
            || statsNode?.innerText?.split('\n').map((line) => line.trim()).find((line) => /^\d+$/.test(line))
            || '0';

        return {
            source: 'dom_scroll',
            author,
            content,
            time,
            likes: parseCount(likesText)
        };
    }

    async function collectComments() {
        const scrollContainer = await ensureCommentPanelReady();
        if (!scrollContainer) return [];

        const originalScrollTop = scrollContainer.scrollTop;
        const comments = new Map();
        const commentRootSelector = '[class*="fiDvPS80"], [class*="Vrj4Q3zT"]';
        let stableRounds = 0;
        let lastCommentCount = 0;

        const collectVisibleComments = () => {
            const blocks = new Set();
            const anchorNodes = scrollContainer.querySelectorAll([
                '[class*="comment-item-info-wrap"]',
                '[class*="comment-item-content"]',
                '[class*="comment-content"]',
                '[class*="comment-text"]',
                '[class*="C7LroK_h"]',
                '[class*="comment-item-stats-container"]'
            ].join(', '));

            anchorNodes.forEach((node) => {
                const block = node.closest(commentRootSelector);
                if (block) blocks.add(block);
            });

            blocks.forEach((block) => {
                const parsed = parseCommentBlock(block);
                if (!parsed.author && !parsed.content) return;
                if (/^\u52a0\u8f7d\u4e2d$/.test(parsed.author || '')) return;
                if (!parsed.content || /^\u52a0\u8f7d\u4e2d$/.test(parsed.content)) return;
                const key = `${parsed.author}|${parsed.content}|${parsed.time}`;
                comments.set(key, parsed);
            });
        };

        scrollContainer.scrollTop = 0;
        await sleep(350);

        for (let round = 0; round < 18; round += 1) {
            collectVisibleComments();

            const beforeTop = scrollContainer.scrollTop;
            const beforeHeight = scrollContainer.scrollHeight;
            const step = Math.max(480, Math.floor(scrollContainer.clientHeight * 0.85));
            const targetTop = Math.min(beforeTop + step, Math.max(0, beforeHeight - scrollContainer.clientHeight));

            scrollContainer.scrollTop = targetTop;
            await sleep(500);

            if ((scrollContainer.innerText || '').includes('\u52a0\u8f7d\u4e2d')) {
                await sleep(800);
            }

            collectVisibleComments();

            const reachedBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 24;
            const moved = scrollContainer.scrollTop > beforeTop;
            const grew = scrollContainer.scrollHeight > beforeHeight;
            const gained = comments.size > lastCommentCount;

            if ((!moved && !grew && !gained) || (reachedBottom && !grew && !gained)) {
                stableRounds += 1;
            } else {
                stableRounds = 0;
            }

            lastCommentCount = comments.size;
            if (stableRounds >= 3) break;
        }

        scrollContainer.scrollTop = originalScrollTop;
        return [...comments.values()];
    }

    async function exportComments() {
        if (state.exportingComments) {
            showLog('评论还在采集中，请等待当前导出完成');
            return;
        }

        setCommentExportBusy(true);

        try {
        showLog('\u6b63\u5728\u6253\u5f00\u8bc4\u8bba\u533a...');
        await ensureCommentPanelReady();

        showLog('\u6b63\u5728\u6eda\u52a8\u91c7\u96c6\u8bc4\u8bba...');
        const comments = await collectComments();

        if (!comments.length) {
            showLog('\u5f53\u524d\u9875\u9762\u6ca1\u6709\u6293\u5230\u8bc4\u8bba\u5217\u8868');
            return;
        }

        const payload = {
            video: {
                author: state.currentData?.author || '',
                title: state.currentData?.title || '',
                videoId: state.currentData?.videoId || '',
                href: state.currentData?.href || location.href
            },
            exportedAt: new Date().toISOString(),
            total: comments.length,
            source: comments[0]?.source || 'unknown',
            comments
        };

        downloadTextFile(`${buildExportBaseName()}_comments.json`, `${JSON.stringify(payload, null, 2)}\n`, 'application/json;charset=utf-8');
        showLog(`\u5df2\u5bfc\u51fa ${comments.length} \u6761\u8bc4\u8bba`);
        } finally {
            setCommentExportBusy(false);
        }
    }

    function collectConfigFromPanel() {
        config.enableFilter = document.getElementById('df-enable')?.checked ?? true;
        config.skipLives = document.getElementById('df-skip-lives')?.checked ?? true;
        config.blockKeywords = document.getElementById('df-keywords')?.value?.trim() || '';
        config.blockUsers = document.getElementById('df-users')?.value?.trim() || '';
        config.allowKeywords = document.getElementById('df-allow-keywords')?.value?.trim() || '';
        config.allowUsers = document.getElementById('df-allow-users')?.value?.trim() || '';
        config.minLikes = Math.max(0, parseInt(document.getElementById('df-likes')?.value || '0', 10) || 0);
        config.minComments = Math.max(0, parseInt(document.getElementById('df-comments')?.value || '0', 10) || 0);
        config.minFavorites = Math.max(0, parseInt(document.getElementById('df-favs')?.value || '0', 10) || 0);
        config.liveSkipSeconds = Math.max(0, parseInt(document.getElementById('df-livetime')?.value || '0', 10) || 0);
        config.debug = document.getElementById('df-debug')?.checked ?? false;
    }

    function resetConfig() {
        config = { ...DEFAULT_CONFIG };
        saveConfig();
        document.getElementById(PANEL_ID)?.remove();
        document.getElementById(TOGGLE_ID)?.remove();
        state.uiReady = false;
        createUI();
        state.lastCheckedId = '';
        setReason('配置已重置');
        showLog('配置已恢复默认值');
    }

    function togglePanel(forceDisplay) {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;

        const nextDisplay = typeof forceDisplay === 'boolean'
            ? (forceDisplay ? 'block' : 'none')
            : (panel.style.display === 'block' ? 'none' : 'block');
        panel.style.display = nextDisplay;
        refreshStatus();
    }

    function createUI() {
        if (state.uiReady) return;

        const oldPanel = document.getElementById(PANEL_ID);
        const oldToggle = document.getElementById(TOGGLE_ID);
        oldPanel?.remove();
        oldToggle?.remove();

        const toggleButton = document.createElement('div');
        toggleButton.id = TOGGLE_ID;
        toggleButton.innerText = '过滤设置';
        toggleButton.addEventListener('click', () => togglePanel());
        document.body.appendChild(toggleButton);

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <h3>抖音过滤器 v${escapeHtml(VERSION)}</h3>
            <label class="df-checkbox">
                <input type="checkbox" id="df-enable" ${config.enableFilter ? 'checked' : ''} />
                <span>启用自动过滤</span>
            </label>
            <label class="df-checkbox">
                <input type="checkbox" id="df-skip-lives" ${config.skipLives ? 'checked' : ''} />
                <span>启用直播自动跳过</span>
            </label>
            <label class="df-checkbox">
                <input type="checkbox" id="df-debug" ${config.debug ? 'checked' : ''} />
                <span>输出调试日志</span>
            </label>

            <div class="df-section">
                <label>标题屏蔽词（逗号分隔）
                    <input type="text" id="df-keywords" value="${escapeHtml(config.blockKeywords)}" />
                </label>
                <label>作者屏蔽词（逗号分隔）
                    <input type="text" id="df-users" value="${escapeHtml(config.blockUsers)}" />
                </label>
                <label>标题白名单（命中后不跳过）
                    <input type="text" id="df-allow-keywords" value="${escapeHtml(config.allowKeywords)}" />
                </label>
                <label>作者白名单（命中后不跳过）
                    <input type="text" id="df-allow-users" value="${escapeHtml(config.allowUsers)}" />
                </label>
            </div>

            <div class="df-section">
                <div class="df-grid">
                    <label>最低点赞
                        <input type="number" id="df-likes" min="0" value="${escapeHtml(config.minLikes)}" />
                    </label>
                    <label>最低评论
                        <input type="number" id="df-comments" min="0" value="${escapeHtml(config.minComments)}" />
                    </label>
                    <label>最低收藏
                        <input type="number" id="df-favs" min="0" value="${escapeHtml(config.minFavorites)}" />
                    </label>
                    <label>直播停留秒数
                        <input type="number" id="df-livetime" min="0" value="${escapeHtml(config.liveSkipSeconds)}" />
                    </label>
                </div>
            </div>

            <div class="df-section">
                <div class="df-actions">
                    <button id="df-save" class="save">保存</button>
                    <button id="df-reset" class="ghost">重置</button>
                    <button id="df-close" class="ghost">关闭</button>
                </div>
                <div class="df-quick-actions">
                    <button id="df-skip" class="ghost">跳过当前</button>
                    <button id="df-copy" class="ghost">复制当前数据</button>
                    <button id="df-export-info" class="ghost">导出信息</button>
                    <button id="df-export-subtitle" class="ghost">导出文案/字幕</button>
                    <button id="df-export-comments" class="ghost">导出评论</button>
                </div>
                <div class="df-note">快捷键：Alt+K 开关过滤，Alt+J 跳过当前，Alt+U 打开面板。评论导出会尽量自动打开评论区并抓取已加载评论。</div>
            </div>

            <div class="df-section" id="${STATUS_ID}"></div>
        `;

        document.body.appendChild(panel);

        document.getElementById('df-close')?.addEventListener('click', () => togglePanel(false));
        document.getElementById('df-save')?.addEventListener('click', () => {
            collectConfigFromPanel();
            saveConfig();
            state.lastCheckedId = '';
            setReason(config.enableFilter ? '配置已保存，等待重新扫描' : '过滤已关闭');
            showLog('配置已保存');
        });
        document.getElementById('df-reset')?.addEventListener('click', resetConfig);
        document.getElementById('df-skip')?.addEventListener('click', () => {
            skipVideo('手动跳过当前视频', 'manualSkips');
        });
        document.getElementById('df-copy')?.addEventListener('click', copyCurrentData);
        document.getElementById('df-export-info')?.addEventListener('click', exportCurrentData);
        document.getElementById('df-export-subtitle')?.addEventListener('click', exportSubtitleText);
        document.getElementById('df-export-comments')?.addEventListener('click', () => {
            exportComments().catch((error) => {
                console.error('[DouyinFilter] 导出评论失败', error);
                showLog('导出评论失败');
            });
        });

        state.uiReady = true;
        refreshStatus();
    }

    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        GM_registerMenuCommand('切换过滤开关', () => {
            config.enableFilter = !config.enableFilter;
            saveConfig();
            state.lastCheckedId = '';
            setReason(config.enableFilter ? '过滤已开启' : '过滤已关闭');
            showLog(config.enableFilter ? '过滤已开启' : '过滤已关闭');
            document.getElementById('df-enable').checked = config.enableFilter;
        });

        GM_registerMenuCommand('跳过当前视频', () => {
            skipVideo('手动跳过当前视频', 'manualSkips');
        });

        GM_registerMenuCommand('导出当前信息', exportCurrentData);
        GM_registerMenuCommand('导出文案/字幕', exportSubtitleText);
        GM_registerMenuCommand('导出评论', () => {
            exportComments().catch((error) => {
                console.error('[DouyinFilter] 导出评论失败', error);
                showLog('导出评论失败');
            });
        });

        GM_registerMenuCommand('重置过滤配置', resetConfig);
    }

    function handleKeydown(event) {
        if (isInputElement(event.target)) return;
        if (!event.altKey) return;

        const key = event.key.toLowerCase();
        if (key === 'j') {
            event.preventDefault();
            skipVideo('手动跳过当前视频', 'manualSkips');
        } else if (key === 'k') {
            event.preventDefault();
            config.enableFilter = !config.enableFilter;
            saveConfig();
            state.lastCheckedId = '';
            setReason(config.enableFilter ? '过滤已开启' : '过滤已关闭');
            showLog(config.enableFilter ? '过滤已开启' : '过滤已关闭');
            const checkbox = document.getElementById('df-enable');
            if (checkbox) checkbox.checked = config.enableFilter;
        } else if (key === 'u') {
            event.preventDefault();
            togglePanel();
        }
    }

    function shouldSkipByThreshold(data) {
        if (data.likesText && data.likes < config.minLikes) {
            return {
                reason: `点赞 ${data.likesText} 低于阈值 ${config.minLikes}`,
                kind: 'likesSkips'
            };
        }

        if (data.commentsText && data.comments < config.minComments) {
            return {
                reason: `评论 ${data.commentsText} 低于阈值 ${config.minComments}`,
                kind: 'commentsSkips'
            };
        }

        if (data.favoritesText && data.favorites < config.minFavorites) {
            return {
                reason: `收藏 ${data.favoritesText} 低于阈值 ${config.minFavorites}`,
                kind: 'favoritesSkips'
            };
        }

        return null;
    }

    function processVideo() {
        if (!isRecommendPage()) return;

        const data = getCurrentVideoData();
        state.currentData = data;
        refreshStatus();

        if (!data) {
            if (state.retryCount < 10) {
                state.retryCount += 1;
            } else {
                setReason('当前卡片信息未加载完成');
            }
            return;
        }

        state.retryCount = 0;

        if (data.id === state.lastCheckedId) return;
        state.lastCheckedId = data.id;
        state.stats.scanned += 1;
        debugLog(`扫描卡片: ${data.author || '未知作者'} | ${data.title || '无标题'}`, data);

        if (!config.enableFilter) {
            resetLiveTimer();
            setReason('过滤关闭，仅更新当前卡片数据');
            return;
        }

        if (data.isLive) {
            scheduleLiveSkip(data);
            return;
        }

        resetLiveTimer();

        const allowKeyword = includesAny(data.title, config.allowKeywords);
        if (allowKeyword) {
            setReason(`标题命中白名单：${allowKeyword}`);
            return;
        }

        const allowUser = includesAny(data.author, config.allowUsers);
        if (allowUser) {
            setReason(`作者命中白名单：${allowUser}`);
            return;
        }

        const keyword = includesAny(data.title, config.blockKeywords);
        if (keyword) {
            skipVideo(`标题命中过滤词：${keyword}`, 'keywordSkips');
            return;
        }

        const user = includesAny(data.author, config.blockUsers);
        if (user) {
            skipVideo(`作者命中过滤词：${user}`, 'userSkips');
            return;
        }

        const thresholdResult = shouldSkipByThreshold(data);
        if (thresholdResult) {
            skipVideo(thresholdResult.reason, thresholdResult.kind);
            return;
        }

        setReason('当前视频通过过滤');
    }

    function init() {
        if (state.initialized) return;
        state.initialized = true;

        createUI();
        registerMenuCommands();
        document.addEventListener('keydown', handleKeydown, true);

        state.intervalId = setInterval(processVideo, 700);
        processVideo();
        showLog(`过滤器已启动 v${VERSION}`);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init, { once: true });
    }
})();
