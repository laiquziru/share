// ==UserScript==
// @name         Twitter/X 宽屏优化
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  隐藏左右侧栏，搜索框悬浮左下角，推文宽屏显示，文字紧凑排版，单图居中
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
        
        /* 整体容器居中 - 默认状态（左侧栏隐藏） */
        body:not(.tw-sidebar-visible) main[role="main"] {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 auto !important;
            display: flex !important;
            justify-content: center !important;
        }

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

        /* 当左侧栏显示时，保持原始布局 */
        body.tw-sidebar-visible main[role="main"] {
            margin: 0 !important;
            justify-content: flex-start !important;
        }

        body.tw-sidebar-visible main[role="main"] > div {
            justify-content: flex-start !important;
        }

        body.tw-sidebar-visible main[role="main"] > div > div {
            justify-content: flex-start !important;
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

        /* 限制最大宽度，避免太宽影响阅读 */
        [data-testid="primaryColumn"] {
            max-width: 900px !important;
            margin: 0 auto !important;
        }

        @media (min-width: 1200px) {
            [data-testid="primaryColumn"] {
                max-width: 1000px !important;
            }
        }

        @media (min-width: 1600px) {
            [data-testid="primaryColumn"] {
                max-width: 1100px !important;
            }
        }

        /* ========== 文字排版优化 ========== */
        
        /* 推文文字占满宽度再换行 */
        [data-testid="tweetText"] {
            word-break: break-word !important;
            overflow-wrap: break-word !important;
            white-space: normal !important;
            width: 100% !important;
        }

        [data-testid="tweetText"] span {
            word-break: break-word !important;
            overflow-wrap: break-word !important;
            white-space: normal !important;
        }

        /* 行距缩小 */
        [data-testid="tweetText"] {
            line-height: 1.4 !important;
        }

        [data-testid="tweetText"] span {
            line-height: 1.4 !important;
        }

        /* 段落间距缩小 */
        [data-testid="tweetText"] > span {
            display: inline !important;
        }

        /* ========== 单张图片居中 ========== */
        
        /* 图片容器 - 只有一张图片时居中 */
        [data-testid="tweetPhoto"] {
            display: flex !important;
            justify-content: center !important;
        }

        /* 单张图片样式 */
        article [data-testid="tweetPhoto"]:only-child {
            justify-content: center !important;
        }

        /* 图片网格容器居中 */
        [aria-label*="图片"] {
            display: flex !important;
            justify-content: center !important;
        }

        /* 媒体容器居中 */
        article div[aria-labelledby] > div > div {
            display: flex !important;
            justify-content: center !important;
        }

        /* 确保单图居中显示 */
        article [data-testid="card.wrapper"] {
            display: flex !important;
            justify-content: center !important;
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
            box-shadow: 0 6px 16px rgba(29, 155, 240, 0.5) !important;
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

        /* 搜索输入框 */
        .tw-search-input-box {
            display: none;
            background: #16181c !important;
            border-radius: 25px !important;
            padding: 0 !important;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
            overflow: hidden !important;
        }

        .tw-search-input-box.active {
            display: flex !important;
        }

        .tw-search-input-box input {
            width: 280px !important;
            padding: 14px 20px !important;
            border: none !important;
            background: transparent !important;
            color: #e7e9ea !important;
            font-size: 15px !important;
            outline: none !important;
        }

        .tw-search-input-box input::placeholder {
            color: #71767b !important;
        }

        .tw-search-submit {
            padding: 14px 18px !important;
            background: transparent !important;
            border: none !important;
            cursor: pointer !important;
            color: rgb(29, 155, 240) !important;
            font-weight: bold !important;
            transition: background 0.2s !important;
        }

        .tw-search-submit:hover {
            background: rgba(29, 155, 240, 0.1) !important;
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

        container.innerHTML = `
            <div class="tw-toolbar-buttons">
                <button class="tw-toolbar-btn tw-sidebar-btn ${sidebarVisible ? 'active' : ''}" title="显示/隐藏左侧栏">
                    ${menuIcon}
                </button>
                <button class="tw-toolbar-btn tw-search-btn" title="搜索 Twitter">
                    ${searchIcon}
                </button>
            </div>
            <div class="tw-search-input-box">
                <input type="text" placeholder="搜索 Twitter...">
                <button class="tw-search-submit">搜索</button>
            </div>
        `;

        const sidebarBtn = container.querySelector('.tw-sidebar-btn');
        const searchBtn = container.querySelector('.tw-search-btn');
        const inputBox = container.querySelector('.tw-search-input-box');
        const searchInput = container.querySelector('input');
        const submitBtn = container.querySelector('.tw-search-submit');

        // 点击侧边栏按钮切换显示
        sidebarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebarVisible = !sidebarVisible;
            GM_setValue('sidebarVisible', sidebarVisible);
            updateSidebarState();
            sidebarBtn.classList.toggle('active', sidebarVisible);
            console.log('📌 左侧栏:', sidebarVisible ? '显示' : '隐藏');
        });

        // 点击搜索按钮切换输入框
        searchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            inputBox.classList.toggle('active');
            if (inputBox.classList.contains('active')) {
                setTimeout(() => searchInput.focus(), 50);
            }
        });

        // 执行搜索
        function doSearch() {
            const query = searchInput.value.trim();
            if (query) {
                const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query`;
                console.log('🔍 搜索:', query, searchUrl);
                window.location.href = searchUrl;
            }
        }

        // 回车搜索
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doSearch();
            }
        });

        // 点击搜索按钮
        submitBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            doSearch();
        });

        // 阻止输入框内点击冒泡
        inputBox.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 点击外部关闭搜索框
        document.addEventListener('click', () => {
            inputBox.classList.remove('active');
        });

        document.body.appendChild(container);
        console.log('✅ 悬浮工具栏已创建');
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

    // 初始化
    function init() {
        updateSidebarState();
        createFloatingToolbar();
        forceWideScreen();
    }

    // 等待页面加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 监听 DOM 变化
    const observer = new MutationObserver(() => {
        if (!document.querySelector('.tw-floating-toolbar')) {
            createFloatingToolbar();
        }
        updateSidebarState();
        forceWideScreen();
    });

    // 页面加载后开始监听
    setTimeout(() => {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        init();
    }, 1000);

    // 多次尝试初始化
    setTimeout(init, 500);
    setTimeout(init, 2000);
    setTimeout(init, 4000);

    console.log('🐦 Twitter/X 宽屏优化脚本 v1.3 已加载');
})();
