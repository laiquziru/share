// ==UserScript==
// @name         Twitter/X 宽屏优化
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  隐藏右侧栏，搜索框悬浮到左下角，推文内容宽屏显示
// @author       You
// @match        https://twitter.com/*
// @match        https://x.com/*
// @match        https://mobile.twitter.com/*
// @match        https://mobile.x.com/*
// @icon         https://abs.twimg.com/favicons/twitter.3.ico
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // 添加自定义样式
    const customStyles = `
        /* ========== 隐藏右侧栏 ========== */
        [data-testid="sidebarColumn"] {
            display: none !important;
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

        /* ========== 搜索框悬浮左下角 ========== */
        .tw-floating-search {
            position: fixed !important;
            bottom: 24px !important;
            left: 90px !important;
            z-index: 99999 !important;
            display: flex !important;
            align-items: center !important;
            gap: 10px !important;
        }

        .tw-search-btn {
            width: 48px !important;
            height: 48px !important;
            border-radius: 50% !important;
            background: rgb(29, 155, 240) !important;
            border: none !important;
            cursor: pointer !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            color: white !important;
            box-shadow: 0 4px 12px rgba(29, 155, 240, 0.4) !important;
            transition: all 0.2s ease !important;
        }

        .tw-search-btn:hover {
            background: rgb(26, 140, 216) !important;
            transform: scale(1.08) !important;
            box-shadow: 0 6px 16px rgba(29, 155, 240, 0.5) !important;
        }

        .tw-search-btn svg {
            width: 22px !important;
            height: 22px !important;
            fill: white !important;
        }

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

    // 创建悬浮搜索框
    function createFloatingSearch() {
        if (document.querySelector('.tw-floating-search')) {
            return;
        }

        const container = document.createElement('div');
        container.className = 'tw-floating-search';

        container.innerHTML = `
            <button class="tw-search-btn" title="搜索 Twitter">
                <svg viewBox="0 0 24 24">
                    <path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z"/>
                </svg>
            </button>
            <div class="tw-search-input-box">
                <input type="text" placeholder="搜索 Twitter...">
                <button class="tw-search-submit">搜索</button>
            </div>
        `;

        const searchBtn = container.querySelector('.tw-search-btn');
        const inputBox = container.querySelector('.tw-search-input-box');
        const searchInput = container.querySelector('input');
        const submitBtn = container.querySelector('.tw-search-submit');

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

        // 点击外部关闭
        document.addEventListener('click', () => {
            inputBox.classList.remove('active');
        });

        document.body.appendChild(container);
        console.log('✅ 悬浮搜索框已创建');
    }

    // 强制覆盖内联样式
    function forceWideScreen() {
        // 查找所有有 max-width 内联样式的元素
        const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
        if (primaryColumn) {
            // 移除可能的内联样式限制
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
        createFloatingSearch();
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
        if (!document.querySelector('.tw-floating-search')) {
            createFloatingSearch();
        }
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

    console.log('🐦 Twitter/X 宽屏优化脚本 v1.1 已加载');
})();
