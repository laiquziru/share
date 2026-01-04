// ==UserScript==
// @name         抖音推荐页过滤器与数据提取
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  提取数据；根据标题/用户名关键词、点赞数、收藏数阈值自动跳过；直播视频15s跳过。
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

    // === 配置默认值 ===
    const DEFAULT_CONFIG = {
        blockKeywords: "广告,带货,不感兴趣", // 标题关键词
        blockUsers: "营销号,卖课",          // [新增] 用户名关键词
        minLikes: 100,
        minFavorites: 0,
        liveSkipSeconds: 15,
        enableFilter: true
    };

    // === 状态变量 ===
    let config = { ...DEFAULT_CONFIG, ...GM_getValue('douyin_filter_config', {}) };
    let lastCheckedId = '';
    let liveTimer = null;
    let isSkipping = false;
    let retryCount = 0;

    // === 样式注入 ===
    GM_addStyle(`
        #douyin-filter-panel {
            position: fixed;
            top: 80px;
            left: 20px;
            z-index: 9999;
            background: rgba(20, 20, 20, 0.95);
            color: #eee;
            padding: 16px;
            border-radius: 8px;
            font-size: 14px;
            width: 280px;
            display: none;
            box-shadow: 0 4px 20px rgba(0,0,0,0.6);
            border: 1px solid rgba(255,255,255,0.1);
        }
        #douyin-filter-panel h3 { margin: 0 0 15px 0; font-size: 16px; color: #fe2c55; border-bottom: 1px solid #444; padding-bottom: 8px; }
        #douyin-filter-panel label { display: block; margin-bottom: 12px; font-size: 12px; color: #aaa;}
        #douyin-filter-panel input {
            width: 100%;
            padding: 6px;
            margin-top: 4px;
            border-radius: 4px;
            border: 1px solid #444;
            background: #333;
            color: white;
            box-sizing: border-box;
        }
        #douyin-filter-panel .btn-group { margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px; }
        #douyin-filter-panel button {
            padding: 6px 14px;
            cursor: pointer;
            border: none;
            border-radius: 4px;
            background: #444;
            color: white;
        }
        #douyin-filter-panel button.save { background: #fe2c55; }
        
        #douyin-filter-toggle {
            position: fixed;
            top: 120px;
            left: 0;
            z-index: 9998;
            background: #fe2c55;
            color: white;
            padding: 10px 4px;
            border-radius: 0 6px 6px 0;
            cursor: pointer;
            writing-mode: vertical-rl;
            text-orientation: upright;
            letter-spacing: 2px;
        }
        .filter-status-log {
            position: fixed;
            bottom: 80px;
            left: 20px;
            z-index: 9999;
            background: rgba(0,0,0,0.8);
            color: #fff;
            padding: 6px 12px;
            border-radius: 20px;
            pointer-events: none;
            transition: opacity 0.3s;
            border: 1px solid rgba(255,255,255,0.1);
            font-size: 12px;
        }
    `);

    // === UI 构建 ===
    function createUI() {
        if (document.getElementById('douyin-filter-toggle')) return;

        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'douyin-filter-toggle';
        toggleBtn.innerText = '过滤设置';
        toggleBtn.onclick = () => {
            const panel = document.getElementById('douyin-filter-panel');
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        };
        document.body.appendChild(toggleBtn);

        const panel = document.createElement('div');
        panel.id = 'douyin-filter-panel';
        panel.innerHTML = `
            <h3>抖音过滤器配置</h3>
            <label>标题屏蔽词 (逗号分隔):
                <input type="text" id="df-keywords" value="${config.blockKeywords}" />
            </label>
            <label>用户名屏蔽词 (逗号分隔):
                <input type="text" id="df-users" value="${config.blockUsers || ''}" />
            </label>
            <label>最少点赞: <input type="number" id="df-likes" value="${config.minLikes}" /></label>
            <label>最少收藏: <input type="number" id="df-favs" value="${config.minFavorites}" /></label>
            <label>直播预览停留(秒): <input type="number" id="df-livetime" value="${config.liveSkipSeconds}" /></label>
            <div class="btn-group">
                <button id="df-cancel">关闭</button>
                <button class="save" id="df-save">保存</button>
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('df-cancel').onclick = () => { panel.style.display = 'none'; };
        document.getElementById('df-save').onclick = () => {
            config.blockKeywords = document.getElementById('df-keywords').value;
            config.blockUsers = document.getElementById('df-users').value;
            config.minLikes = parseInt(document.getElementById('df-likes').value, 10) || 0;
            config.minFavorites = parseInt(document.getElementById('df-favs').value, 10) || 0;
            config.liveSkipSeconds = parseInt(document.getElementById('df-livetime').value, 10) || 15;
            GM_setValue('douyin_filter_config', config);
            panel.style.display = 'none';
            showLog('配置已保存 (重新检查)');
            lastCheckedId = '';
        };
    }

    let logTimer;
    function showLog(msg) {
        let log = document.querySelector('.filter-status-log');
        if (!log) {
            log = document.createElement('div');
            log.className = 'filter-status-log';
            document.body.appendChild(log);
        }
        log.innerText = msg;
        log.style.opacity = '1';
        clearTimeout(logTimer);
        logTimer = setTimeout(() => { log.style.opacity = '0'; }, 4000);
        console.log(`[DouyinFilter] ${msg}`);
    }

    function parseCount(text) {
        if (!text) return 0;
        text = text.trim();
        let multiplier = 1;
        if (text.endsWith('w') || text.endsWith('万')) multiplier = 10000;
        else if (text.endsWith('亿')) multiplier = 100000000;
        const num = parseFloat(text.replace(/[^\d.]/g, ''));
        return isNaN(num) ? 0 : num * multiplier;
    }

    // === 核心：跳过逻辑 v1.9 ===
    function skipVideo() {
        if (isSkipping) {
            console.log('[DouyinFilter] 跳过中，忽略');
            return;
        }
        isSkipping = true;

        console.log('[DouyinFilter] 触发跳过...');

        // 直接点击下一个按钮
        const nextBtn = document.querySelector('[data-e2e="video-switch-next-arrow"]');
        if (nextBtn) {
            console.log('[DouyinFilter] 点击下一个按钮');
            nextBtn.click();
        } else {
            console.log('[DouyinFilter] 未找到下一个按钮，尝试键盘');
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowDown',
                code: 'ArrowDown',
                keyCode: 40,
                which: 40,
                bubbles: true
            }));
        }

        // 重置 lastCheckedId，确保下一个视频能被检测
        setTimeout(() => {
            lastCheckedId = '';
            isSkipping = false;
            console.log('[DouyinFilter] 跳过完成，重置状态');
        }, 800);
    }

    function getCurrentVideoContainer() {
        return document.querySelector('[data-e2e="feed-active-video"]');
    }

    function getVideoData(container) {
        if (!container) return null;

        const getText = (val) => {
            const selectors = Array.isArray(val) ? val : [val];
            for (let s of selectors) {
                const sel = s.startsWith('.') || s.startsWith('[') ? s : `[data-e2e="${s}"]`;
                const el = container.querySelector(sel);
                if (el) return el.innerText;
            }
            return "";
        };

        let title = getText(['video-desc', '.desc-content', '.title']);
        const likesStr = getText(['video-player-digg', 'like-icon']);
        const commentsStr = getText(['feed-comment-icon', 'comment-icon']);
        const favsStr = getText(['video-player-collect', 'collection-icon']);

        // 获取用户名
        let author = getText(['video-author-uniqueid', 'video-player-avatar']);
        // 通常 author 在 .account-name 或 data-e2e="video-author-name"
        if (!author || author.match(/^\d/)) { // 如果取到的是头像旁的数字或者是空的
            const nameEl = container.querySelector('.account-name') || container.querySelector('[data-e2e="video-author-name"]');
            if (nameEl) author = nameEl.innerText;
        }

        const isLive = container.querySelector('.live-badge') !== null ||
            container.innerHTML.includes('直播中') ||
            (container.querySelector('a') && container.querySelector('a').href.slice(0, 50).includes('/live/'));

        if (!title && !likesStr && !isLive) return null;

        const videoEl = container.querySelector('video');
        const src = videoEl ? videoEl.getAttribute('src') : '';
        const id = `${title.substring(0, 10)}-${likesStr}-${src.substring(src.length > 20 ? src.length - 20 : 0)}`;

        return {
            id,
            title,
            author,
            likes: parseCount(likesStr),
            favorites: parseCount(favsStr),
            isLive,
            rawLikes: likesStr
        };
    }

    function processVideo() {
        if (!config.enableFilter) return;

        const container = getCurrentVideoContainer();
        if (!container) return;

        const data = getVideoData(container);
        const isEmptyData = !data || (data.likes === 0 && !data.rawLikes && !data.isLive);

        if (isEmptyData) {
            if (retryCount < 12) { retryCount++; return; }
        }

        if (!data) return;
        if (data.id === lastCheckedId) { retryCount = 0; return; }

        console.log(`[DouyinFilter] 视频: "${data.title.substring(0, 10)}..." | 作者: ${data.author} | 赞:${data.rawLikes}`);

        lastCheckedId = data.id;
        retryCount = 0;

        // 1. 直播
        if (data.isLive) {
            showLog(`直播检测，${config.liveSkipSeconds}s 后跳过`);
            if (liveTimer) clearTimeout(liveTimer);
            liveTimer = setTimeout(() => {
                if (window.location.href.includes('recommend') || window.location.pathname === '/' || window.location.pathname === '') {
                    showLog('直播跳过');
                    skipVideo();
                    lastCheckedId = '';
                }
            }, config.liveSkipSeconds * 1000);
            return;
        } else { if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; } }

        // 2. 关键词 (标题 + 用户名)
        if (config.blockKeywords) {
            const keywords = config.blockKeywords.split(/[,，]/);
            for (const kw of keywords) {
                const k = kw.trim();
                if (k && data.title.includes(k)) {
                    showLog(`命中标题屏蔽 [${k}] -> 跳过`);
                    skipVideo();
                    return;
                }
            }
        }
        if (config.blockUsers && data.author) {
            const users = config.blockUsers.split(/[,，]/);
            for (const u of users) {
                const user = u.trim();
                if (user && data.author.includes(user)) {
                    showLog(`命中作者屏蔽 [${user}] -> 跳过`);
                    skipVideo();
                    return;
                }
            }
        }

        // 3. 数据阈值
        if (data.likes < config.minLikes) {
            showLog(`点赞 (${data.likes}) < ${config.minLikes} -> 跳过`);
            skipVideo();
            return;
        }
        if (data.favorites < config.minFavorites) {
            showLog(`收藏 (${data.favorites}) < ${config.minFavorites} -> 跳过`);
            skipVideo();
            return;
        }
    }

    function init() {
        console.log('[DouyinFilter] 启动 v1.9');
        createUI();
        setInterval(processVideo, 600);
    }

    window.addEventListener('load', init);
    if (document.readyState === 'complete') init();
    setTimeout(init, 3000);

})();
