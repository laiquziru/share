// ==UserScript==
// @name         Twitter/X 宽屏优化
// @namespace    http://tampermonkey.net/
// @version      2.8
// @description  隐藏左右侧栏，搜索框悬浮左下角，推文宽度可调节，斑马纹区分推文，文字紧凑排版，自定义关键词屏蔽，自动展开长文
// @author       You
// @match        https://twitter.com/*
// @match        https://x.com/*
// @match        https://mobile.twitter.com/*
// @match        https://mobile.x.com/*
// @icon         https://abs.twimg.com/favicons/twitter.3.ico
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // 左侧栏状态
    let sidebarVisible = GM_getValue('sidebarVisible', false);
    // 屏蔽词列表
    let blockedKeywords = GM_getValue('blockedKeywords', []);
    // 推文宽度 (500-1400px)
    let tweetWidth = GM_getValue('tweetWidth', 900);

    // 添加自定义样式
    const customStyles = `
        /* ========== 隐藏右侧栏 ========== */
        [data-testid="sidebarColumn"] {
            display: none !important;
        }

        /* ========== 隐藏左侧栏（默认） ========== */
        header[role="banner"] {
            display: none !important;
        }

        /* 左侧栏显示状态 */
        body.tw-sidebar-visible header[role="banner"] {
            display: flex !important;
        }

        /* ========== 左侧栏隐藏时，内容居中 ========== */
        
        /* main 是 column 布局，用 align-items 控制水平方向 */
        body:not(.tw-sidebar-visible) main[role="main"] {
            width: 100% !important;
            max-width: 100% !important;
            align-items: center !important;
        }

        /* 确保内部容器也居中 */
        body:not(.tw-sidebar-visible) main[role="main"] > div {
            width: 100% !important;
            max-width: 100% !important;
            display: flex !important;
            justify-content: center !important;
        }

        body:not(.tw-sidebar-visible) main[role="main"] > div > div {
            display: flex !important;
            justify-content: center !important;
        }

        /* primaryColumn 居中 */
        body:not(.tw-sidebar-visible) [data-testid="primaryColumn"] {
            margin: 0 auto !important;
            float: none !important;
        }

        /* 当左侧栏显示时，保持原始布局 */
        body.tw-sidebar-visible main[role="main"] {
            align-items: flex-start !important;
        }

        body.tw-sidebar-visible main[role="main"] > div {
            justify-content: flex-start !important;
        }

        body.tw-sidebar-visible main[role="main"] > div > div {
            justify-content: flex-start !important;
        }

        body.tw-sidebar-visible [data-testid="primaryColumn"] {
            margin: 0 !important;
        }

        /* ========== 核心：让主内容区域和推文真正变宽 ========== */
        
        /* 主列容器 - 移除最大宽度限制 */
        [data-testid="primaryColumn"] {
            max-width: none !important;
            width: 100% !important;
            flex-grow: 1 !important;
        }

        /* 推文时间线容器 */
        [data-testid="primaryColumn"] > div > div {
            max-width: none !important;
        }

        /* 每条推文的外层容器 */
        [data-testid="cellInnerDiv"] {
            max-width: none !important;
            width: 100% !important;
        }

        /* 推文文章本身 */
        article[data-testid="tweet"] {
            max-width: none !important;
            width: 100% !important;
        }

        /* 推文内容区域 */
        [data-testid="tweetText"] {
            max-width: none !important;
        }

        /* Twitter 使用的 600px 限制容器 */
        div[style*="max-width: 600px"] {
            max-width: none !important;
        }

        /* 覆盖内联样式的 max-width */
        [data-testid="primaryColumn"] * {
            max-width: none !important;
        }

        /* 但保留头像等小元素的尺寸 */
        [data-testid="Tweet-User-Avatar"],
        img[draggable="true"],
        [data-testid="UserAvatar-Container-unknown"] {
            max-width: fit-content !important;
        }

        /* 调整布局容器 */
        main[role="main"] > div > div > div {
            max-width: 100% !important;
            width: 100% !important;
        }

        /* 限制最大宽度，使用 CSS 变量动态控制 */
        :root {
            --tw-tweet-width: 900px;
        }

        [data-testid="primaryColumn"] {
            max-width: var(--tw-tweet-width) !important;
            margin: 0 auto !important;
        }

        /* ========== 文字排版优化：居中和紧凑 ========== */
        
        /* 推文文字占满宽度再换行，不满一行居中 */
        [data-testid="tweetText"] {
            word-break: break-word !important;
            overflow-wrap: break-word !important;
            white-space: normal !important;
            width: 100% !important;
            text-align: center !important; /* 核心：让短文本居中 */
            line-height: 1.4 !important;
        }

        [data-testid="tweetText"] span {
            word-break: break-word !important;
            overflow-wrap: break-word !important;
            white-space: normal !important;
            line-height: 1.4 !important;
        }

        /* 段落间距缩小 */
        [data-testid="tweetText"] > span {
            display: inline !important;
        }

        /* ========== 斑马纹效果 ========== */
        article[data-testid="tweet"]:nth-child(even) {
            background-color: rgba(255, 255, 255, 0.03) !important;
        }

        article[data-testid="tweet"]:nth-child(odd) {
            background-color: transparent !important;
        }

        /* ========== 悬浮工具栏 ========== */
        .tw-floating-toolbar {
            position: fixed !important;
            bottom: 24px !important;
            left: 20px !important;
            z-index: 99999 !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 12px !important;
        }

        .tw-toolbar-buttons {
            display: flex !important;
            align-items: center !important;
            gap: 10px !important;
        }

        /* 通用按钮样式 */
        .tw-toolbar-btn {
            width: 48px !important;
            height: 48px !important;
            border-radius: 50% !important;
            border: none !important;
            cursor: pointer !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            color: white !important;
            transition: all 0.2s ease !important;
        }

        .tw-toolbar-btn svg {
            width: 22px !important;
            height: 22px !important;
            fill: white !important;
        }

        /* 搜索按钮 */
        .tw-search-btn {
            background: rgb(29, 155, 240) !important;
            box-shadow: 0 4px 12px rgba(29, 155, 240, 0.4) !important;
        }

        .tw-search-btn:hover {
            background: rgb(26, 140, 216) !important;
            transform: scale(1.08) !important;
        }

        /* 屏蔽按钮 */
        .tw-filter-btn {
            background: #f91880 !important;
            box-shadow: 0 4px 12px rgba(249, 24, 128, 0.4) !important;
        }

        .tw-filter-btn:hover {
            background: #d71771 !important;
            transform: scale(1.08) !important;
        }

        /* 侧边栏开关按钮 */
        .tw-sidebar-btn {
            background: #536471 !important;
            box-shadow: 0 4px 12px rgba(83, 100, 113, 0.4) !important;
        }

        .tw-sidebar-btn:hover {
            background: #6b7d8a !important;
            transform: scale(1.08) !important;
        }

        .tw-sidebar-btn.active {
            background: #00ba7c !important;
            box-shadow: 0 4px 12px rgba(0, 186, 124, 0.4) !important;
        }

        .tw-sidebar-btn.active:hover {
            background: #00a06b !important;
        }

        /* 浮窗容器通用样式 */
        .tw-tool-panel {
            display: none;
            background: #16181c !important;
            border-radius: 16px !important;
            padding: 16px !important;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5) !important;
            width: 320px !important;
            color: #e7e9ea !important;
            border: 1px solid #333639 !important;
        }

        .tw-tool-panel.active {
            display: block !important;
        }

        /* 搜索输入框 */
        .tw-search-input-box {
            padding: 0 !important;
            overflow: hidden !important;
            border-radius: 25px !important;
            display: none;
            flex-direction: row !important;
            align-items: center !important;
            background: #16181c !important;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
        }

        .tw-search-input-box.active {
            display: flex !important;
        }

        .tw-search-input-box input {
            width: 200px !important;
            padding: 12px 16px !important;
            border: none !important;
            background: transparent !important;
            color: #e7e9ea !important;
            font-size: 15px !important;
            outline: none !important;
        }

        .tw-search-submit {
            padding: 12px 16px !important;
            background: transparent !important;
            border: none !important;
            cursor: pointer !important;
            color: rgb(29, 155, 240) !important;
            font-weight: bold !important;
        }

        /* 过滤管理面板 */
        .tw-filter-panel h3 {
            margin: 0 0 12px 0 !important;
            font-size: 16px !important;
            color: #fff !important;
        }

        .tw-filter-input-wrapper {
            display: flex !important;
            gap: 8px !important;
            margin-bottom: 12px !important;
        }

        .tw-filter-input-wrapper input {
            flex-grow: 1 !important;
            background: #000 !important;
            border: 1px solid #333639 !important;
            border-radius: 8px !important;
            padding: 8px 12px !important;
            color: #fff !important;
            outline: none !important;
        }

        .tw-filter-input-wrapper input:focus {
            border-color: rgb(29, 155, 240) !important;
        }

        .tw-filter-add-btn {
            background: rgb(29, 155, 240) !important;
            color: #fff !important;
            border: none !important;
            padding: 0 16px !important;
            border-radius: 8px !important;
            cursor: pointer !important;
            font-weight: bold !important;
        }

        .tw-keyword-list {
            max-height: 200px !important;
            overflow-y: auto !important;
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 8px !important;
        }

        .tw-keyword-tag {
            background: #2f3336 !important;
            color: #e7e9ea !important;
            padding: 4px 10px !important;
            border-radius: 16px !important;
            font-size: 13px !important;
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
        }

        .tw-keyword-tag .remove-btn {
            cursor: pointer !important;
            color: #71767b !important;
            font-weight: bold !important;
            font-size: 14px !important;
        }

        .tw-keyword-tag .remove-btn:hover {
            color: #f91880 !important;
        }

        /* ========== 宽度调节滑动条 ========== */
        .tw-width-section {
            margin-top: 16px !important;
            padding-top: 16px !important;
            border-top: 1px solid #333639 !important;
        }

        .tw-width-section h4 {
            margin: 0 0 12px 0 !important;
            font-size: 14px !important;
            color: #fff !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
        }

        .tw-width-value {
            color: rgb(29, 155, 240) !important;
            font-weight: bold !important;
        }

        .tw-width-slider {
            width: 100% !important;
            height: 6px !important;
            -webkit-appearance: none !important;
            appearance: none !important;
            background: #333639 !important;
            border-radius: 3px !important;
            outline: none !important;
            cursor: pointer !important;
        }

        .tw-width-slider::-webkit-slider-thumb {
            -webkit-appearance: none !important;
            appearance: none !important;
            width: 18px !important;
            height: 18px !important;
            background: rgb(29, 155, 240) !important;
            border-radius: 50% !important;
            cursor: pointer !important;
            transition: transform 0.1s ease !important;
        }

        .tw-width-slider::-webkit-slider-thumb:hover {
            transform: scale(1.2) !important;
        }

        .tw-width-slider::-moz-range-thumb {
            width: 18px !important;
            height: 18px !important;
            background: rgb(29, 155, 240) !important;
            border-radius: 50% !important;
            border: none !important;
            cursor: pointer !important;
        }

        .tw-width-presets {
            display: flex !important;
            justify-content: space-between !important;
            margin-top: 10px !important;
            gap: 6px !important;
        }

        .tw-width-preset-btn {
            flex: 1 !important;
            padding: 6px 8px !important;
            background: #2f3336 !important;
            border: none !important;
            border-radius: 6px !important;
            color: #e7e9ea !important;
            font-size: 12px !important;
            cursor: pointer !important;
            transition: background 0.2s ease !important;
        }

        .tw-width-preset-btn:hover {
            background: #3a3f44 !important;
        }

        .tw-width-preset-btn.active {
            background: rgb(29, 155, 240) !important;
            color: #fff !important;
        }
    `;

    // 注入样式
    GM_addStyle(customStyles);

    // 更新侧边栏显示状态
    function updateSidebarState() {
        if (sidebarVisible) {
            document.body.classList.add('tw-sidebar-visible');
        } else {
            document.body.classList.remove('tw-sidebar-visible');
        }
    }

    // 还原所有已隐藏的推文
    function resetHiddenTweets() {
        const hiddenTweets = document.querySelectorAll('[data-testid="cellInnerDiv"][style*="display: none"]');
        hiddenTweets.forEach(el => {
            el.style.display = '';
        });
        const hiddenArticles = document.querySelectorAll('article[data-testid="tweet"][style*="display: none"]');
        hiddenArticles.forEach(el => {
            el.style.display = '';
        });
    }

    // 关键词过滤逻辑
    function filterTweets() {
        if (blockedKeywords.length === 0) return;

        const tweets = document.querySelectorAll('article[data-testid="tweet"]');
        tweets.forEach(tweet => {
            const tweetText = tweet.innerText;
            if (tweetText) {
                const hasKeyword = blockedKeywords.some(keyword =>
                    tweetText.toLowerCase().includes(keyword.toLowerCase())
                );

                if (hasKeyword) {
                    const container = tweet.closest('[data-testid="cellInnerDiv"]');
                    if (container) {
                        container.style.display = 'none';
                    } else {
                        tweet.style.display = 'none';
                    }
                }
            }
        });
    }

    // 自动展开长文功能
    function autoExpandTweets() {
        const showMoreButtons = document.querySelectorAll('[data-testid="tweet-text-show-more-link"]');

        showMoreButtons.forEach(btn => {
            if (!btn.dataset.clicked) {
                if (btn.tagName === 'A') {
                    const href = btn.getAttribute('href');
                    if (href && href.length > 1 && href !== '#') {
                        return;
                    }
                }
                btn.click();
                btn.dataset.clicked = "true";
                btn.style.display = 'none';
            }
        });
    }

    // 创建悬浮工具栏
    function createFloatingToolbar() {
        if (document.querySelector('.tw-floating-toolbar')) {
            return;
        }

        const container = document.createElement('div');
        container.className = 'tw-floating-toolbar';

        // 菜单图标 SVG
        const menuIcon = `
            <svg viewBox="0 0 24 24">
                <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
            </svg>
        `;

        // 搜索图标 SVG
        const searchIcon = `
            <svg viewBox="0 0 24 24">
                <path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z"/>
            </svg>
        `;

        // 过滤图标 SVG
        const filterIcon = `
            <svg viewBox="0 0 24 24">
                <path d="M6 13h12v-2H6v2zm-2 5h16v-2H4v2zM1 6v2h22V6H1z"/>
            </svg>
        `;

        container.innerHTML = `
            <div class="tw-toolbar-buttons">
                <button class="tw-toolbar-btn tw-sidebar-btn ${sidebarVisible ? 'active' : ''}" title="显示/隐藏左侧栏">
                    ${menuIcon}
                </button>
                <button class="tw-toolbar-btn tw-search-btn" title="搜索 Twitter">
                    ${searchIcon}
                </button>
                <button class="tw-toolbar-btn tw-filter-btn" title="关键词屏蔽设置">
                    ${filterIcon}
                </button>
            </div>
            
            <div class="tw-tool-panel tw-search-input-box">
                <input type="text" placeholder="搜索 Twitter...">
                <button class="tw-search-submit">搜索</button>
            </div>

            <div class="tw-tool-panel tw-filter-panel">
                <h3>屏蔽关键词管理</h3>
                <div class="tw-filter-input-wrapper">
                    <input type="text" placeholder="添加关键词..." id="tw-keyword-input">
                    <button class="tw-filter-add-btn">添加</button>
                </div>
                <div class="tw-keyword-list"></div>

                <div class="tw-width-section">
                    <h4>推文宽度 <span class="tw-width-value">${tweetWidth}px</span></h4>
                    <input type="range" class="tw-width-slider" min="500" max="1400" step="50" value="${tweetWidth}">
                    <div class="tw-width-presets">
                        <button class="tw-width-preset-btn" data-width="600">窄</button>
                        <button class="tw-width-preset-btn" data-width="800">中</button>
                        <button class="tw-width-preset-btn" data-width="1000">宽</button>
                        <button class="tw-width-preset-btn" data-width="1200">超宽</button>
                    </div>
                </div>
            </div>
        `;

        const sidebarBtn = container.querySelector('.tw-sidebar-btn');
        const searchBtn = container.querySelector('.tw-search-btn');
        const filterBtn = container.querySelector('.tw-filter-btn');

        const searchPanel = container.querySelector('.tw-search-input-box');
        const filterPanel = container.querySelector('.tw-filter-panel');

        const searchInput = container.querySelector('.tw-search-input-box input');
        const keywordInput = container.querySelector('#tw-keyword-input');
        const addKeywordBtn = container.querySelector('.tw-filter-add-btn');
        const keywordListContainer = container.querySelector('.tw-keyword-list');

        // 宽度调节相关
        const widthSlider = container.querySelector('.tw-width-slider');
        const widthValue = container.querySelector('.tw-width-value');
        const presetBtns = container.querySelectorAll('.tw-width-preset-btn');

        // 更新推文宽度
        function updateTweetWidth(width) {
            tweetWidth = width;
            GM_setValue('tweetWidth', width);
            document.documentElement.style.setProperty('--tw-tweet-width', width + 'px');
            widthValue.textContent = width + 'px';
            widthSlider.value = width;

            // 更新预设按钮状态
            presetBtns.forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.dataset.width) === width);
            });
        }

        // 初始化宽度
        updateTweetWidth(tweetWidth);

        // 滑动条事件
        widthSlider.addEventListener('input', (e) => {
            updateTweetWidth(parseInt(e.target.value));
        });

        // 预设按钮事件
        presetBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                updateTweetWidth(parseInt(btn.dataset.width));
            });
        });

        // 更新关键词列表 UI
        function renderKeywords() {
            keywordListContainer.innerHTML = '';
            blockedKeywords.forEach((kw, index) => {
                const tag = document.createElement('div');
                tag.className = 'tw-keyword-tag';
                tag.innerHTML = `
                    <span>${kw}</span>
                    <span class="remove-btn" data-index="${index}">×</span>
                `;
                keywordListContainer.appendChild(tag);
            });

            // 绑定删除事件
            keywordListContainer.querySelectorAll('.remove-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.target.dataset.index);
                    blockedKeywords.splice(idx, 1);
                    GM_setValue('blockedKeywords', blockedKeywords);
                    renderKeywords();
                    resetHiddenTweets();
                    filterTweets();
                });
            });
        }

        // 初始渲染
        renderKeywords();

        // 点击侧边栏按钮切换显示
        sidebarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebarVisible = !sidebarVisible;
            GM_setValue('sidebarVisible', sidebarVisible);
            updateSidebarState();
            sidebarBtn.classList.toggle('active', sidebarVisible);
        });

        // 切换搜索面板
        searchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            filterPanel.classList.remove('active');
            searchPanel.classList.toggle('active');
            if (searchPanel.classList.contains('active')) {
                setTimeout(() => searchInput.focus(), 50);
            }
        });

        // 切换过滤面板
        filterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            searchPanel.classList.remove('active');
            filterPanel.classList.toggle('active');
            if (filterPanel.classList.contains('active')) {
                setTimeout(() => keywordInput.focus(), 50);
            }
        });

        // 添加关键词逻辑
        function addKeyword() {
            const val = keywordInput.value.trim();
            if (val && !blockedKeywords.includes(val)) {
                blockedKeywords.push(val);
                GM_setValue('blockedKeywords', blockedKeywords);
                renderKeywords();
                keywordInput.value = '';
                filterTweets();
            }
        }

        addKeywordBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addKeyword();
        });

        keywordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addKeyword();
            }
        });

        // 执行搜索
        function doSearch() {
            const query = searchInput.value.trim();
            if (query) {
                const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query`;
                window.location.href = searchUrl;
            }
        }

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doSearch();
            }
        });

        container.querySelector('.tw-search-submit').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            doSearch();
        });

        // 阻止点击冒泡
        searchPanel.addEventListener('click', e => e.stopPropagation());
        filterPanel.addEventListener('click', e => e.stopPropagation());

        // 点击外部关闭
        document.addEventListener('click', () => {
            searchPanel.classList.remove('active');
            filterPanel.classList.remove('active');
        });

        document.body.appendChild(container);
    }

    // 强制覆盖内联样式
    function forceWideScreen() {
        const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
        if (primaryColumn) {
            const allElements = primaryColumn.querySelectorAll('*');
            allElements.forEach(el => {
                if (el.style.maxWidth && el.style.maxWidth !== 'none') {
                    el.style.maxWidth = 'none';
                }
            });
        }
    }

    // 初始化标志，防止重复初始化
    let initialized = false;

    // 防抖函数
    function debounce(fn, delay) {
        let timer = null;
        return function (...args) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    // 初始化
    function init() {
        if (initialized && document.querySelector('.tw-floating-toolbar')) {
            return;
        }
        initialized = true;
        // 设置初始宽度
        document.documentElement.style.setProperty('--tw-tweet-width', tweetWidth + 'px');
        updateSidebarState();
        createFloatingToolbar();
        forceWideScreen();
        filterTweets();
        autoExpandTweets();
    }

    // DOM 变化时的处理（防抖优化）
    const handleMutation = debounce(() => {
        if (!document.querySelector('.tw-floating-toolbar')) {
            createFloatingToolbar();
        }
        updateSidebarState();
        forceWideScreen();
        filterTweets();
        autoExpandTweets();
    }, 100);

    // 监听 DOM 变化
    const observer = new MutationObserver(handleMutation);

    // 启动观察器
    function startObserver() {
        if (document.body) {
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            init();
        }
    }

    // 等待页面加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        startObserver();
    }

    console.log('🐦 Twitter/X 宽屏优化脚本 v2.8 已加载');
})();
