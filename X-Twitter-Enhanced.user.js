// ==UserScript==
// @name         X/Twitter 增强工具 (宽屏 + 内容提取)
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  默认隐藏左右侧栏，内容超宽显示，右上角按钮可切换左侧栏、深色模式，并提供内容采集导出功能
// @author       You
// @match        https://twitter.com/*
// @match        https://x.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ========================================
    // 立即应用深色模式（页面加载前）
    // ========================================

    // 尽早加载并应用主题，避免闪烁
    const savedDarkMode = localStorage.getItem('x-enhanced-dark-mode');
    let initialDarkMode = false;

    if (savedDarkMode !== null) {
        initialDarkMode = savedDarkMode === 'true';
    } else {
        // 首次加载，检测系统主题
        const checkDarkBg = (bg) => {
            const match = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
                const [, r, g, b] = match.map(Number);
                return (r + g + b) / 3 < 128;
            }
            return false;
        };

        if (document.body) {
            const bgColor = window.getComputedStyle(document.body).backgroundColor;
            initialDarkMode = checkDarkBg(bgColor);
        }
    }

    // 立即应用主题到页面（带重试机制）
    function applyInitialTheme(isDark) {
        const applyTheme = () => {
            const body = document.body;
            const html = document.documentElement;

            if (body) {
                if (isDark) {
                    body.style.setProperty('background-color', 'rgb(0, 0, 0)', 'important');
                    body.style.setProperty('color', 'rgb(231, 233, 234)', 'important');
                    html.style.colorScheme = 'dark';

                    const themeColor = document.querySelector('meta[name="theme-color"]');
                    if (themeColor) {
                        themeColor.setAttribute('content', '#000000');
                    }
                } else {
                    body.style.setProperty('background-color', 'rgb(255, 255, 255)', 'important');
                    body.style.setProperty('color', 'rgb(15, 20, 25)', 'important');
                    html.style.colorScheme = 'light';

                    const themeColor = document.querySelector('meta[name="theme-color"]');
                    if (themeColor) {
                        themeColor.setAttribute('content', '#ffffff');
                    }
                }
                return true;
            }
            return false;
        };

        // 立即尝试应用
        applyTheme();

        // 延迟再次应用，防止被 Twitter 覆盖
        setTimeout(applyTheme, 100);
        setTimeout(applyTheme, 300);
        setTimeout(applyTheme, 500);
        setTimeout(applyTheme, 1000);
        setTimeout(applyTheme, 2000);
    }

    // 监听 body 样式变化，防止被覆盖
    function watchBodyStyles(isDark) {
        const targetBg = isDark ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
        const targetColor = isDark ? 'rgb(231, 233, 234)' : 'rgb(15, 20, 25)';

        bodyStyleObserver = new MutationObserver(() => {
            const body = document.body;
            if (body) {
                const currentBg = window.getComputedStyle(body).backgroundColor;
                // 如果背景色不对，重新应用
                if (currentBg !== targetBg) {
                    if (isDark) {
                        body.style.setProperty('background-color', 'rgb(0, 0, 0)', 'important');
                        body.style.setProperty('color', 'rgb(231, 233, 234)', 'important');
                    } else {
                        body.style.setProperty('background-color', 'rgb(255, 255, 255)', 'important');
                        body.style.setProperty('color', 'rgb(15, 20, 25)', 'important');
                    }
                }
            }
        });

        // 开始监听 body 的属性变化
        if (document.body) {
            bodyStyleObserver.observe(document.body, {
                attributes: true,
                attributeFilter: ['style']
            });
        }
    }

    // 页面加载时立即应用
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            applyInitialTheme(initialDarkMode);
            watchBodyStyles(initialDarkMode);
        });
    } else {
        applyInitialTheme(initialDarkMode);
        watchBodyStyles(initialDarkMode);
    }

    // ========================================
    // 功能 1: 超宽视图 - 隐藏左右侧边栏
    // ========================================

    // 添加自定义样式
    const style = document.createElement('style');
    style.textContent = `
        /* 隐藏右侧边栏 */
        [data-testid="sidebarColumn"],
        div[class*="css-175oi2r"] > div:last-child:has([aria-label*="订阅"]),
        aside[role="complementary"] {
            display: none !important;
        }

        /* 让主内容区域变宽 */
        main[role="main"] {
            max-width: 100% !important;
        }

        /* 调整主容器宽度 */
        div[data-testid="primaryColumn"] {
            max-width: 1400px !important;
            width: 100% !important;
        }

        /* 扩展中间内容区域 */
        .css-175oi2r.r-kemksi.r-1kqtdi0.r-1ljd8xs.r-13l2t4g.r-1phboty.r-16y2uox.r-1jgb5lz.r-11wrixw.r-61z16t.r-1ye8kvj.r-13qz1uu.r-184en5c {
            max-width: none !important;
        }

        /* 调整时间线宽度 */
        div[data-testid="cellInnerDiv"] {
            max-width: 100% !important;
        }

        /* 扩展推文容器宽度 */
        article[data-testid="tweet"] {
            max-width: none !important;
        }

        /* 扩展整体布局容器 */
        div[class*="css-175oi2r"] {
            max-width: none !important;
        }

        /* 调整时间线内容宽度 */
        section[role="region"] > div > div {
            max-width: 1400px !important;
        }

        /* 默认隐藏左侧导航栏 */
        header[role="banner"] {
            transform: translateX(-100%) !important;
            transition: transform 0.3s ease !important;
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            z-index: 9999 !important;
            height: 100vh !important;
        }

        /* 显示左侧导航栏的状态 - 增强优先级 */
        header[role="banner"].sidebar-visible,
        header.sidebar-visible[role="banner"] {
            transform: translateX(0) !important;
            visibility: visible !important;
            opacity: 1 !important;
            display: flex !important;
        }

        /* 确保左侧栏容器显示 */
        header[role="banner"].sidebar-visible > div,
        header.sidebar-visible[role="banner"] > div {
            display: flex !important;
            visibility: visible !important;
        }

        /* 调整主内容区域 - 居中显示 */
        body > div[id="react-root"] > div > div {
            margin-left: auto !important;
            margin-right: auto !important;
        }

        /* 主容器居中对齐 */
        main[role="main"] {
            margin-left: auto !important;
            margin-right: auto !important;
        }

        /* 调整主要内容容器 - 居中 */
        div[data-testid="primaryColumn"] {
            margin-left: auto !important;
            margin-right: auto !important;
        }
    `;

    // 在页面加载时插入样式
    if (document.head) {
        document.head.appendChild(style);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            document.head.appendChild(style);
        });
    }

    // 监听动态加载的元素（Twitter 是单页应用）
    const styleObserver = new MutationObserver((mutations) => {
        // 确保样式始终存在
        if (!document.contains(style)) {
            document.head.appendChild(style);
        }
    });

    // 开始监听样式
    if (document.body) {
        styleObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            styleObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        });
    }

    // ========================================
    // 功能 2: 内容提取器
    // ========================================

    let extractedData = [];
    let checkCount = 0;
    const maxChecks = 50;
    let isCollecting = false;
    let scrollInterval = null;
    let db = null;
    let buttonsCreated = false; // 防止按钮重复创建的标志
    let extractorInitialized = false; // 防止内容提取器重复初始化
    let isDarkMode = false; // 深色模式状态

    // 检测系统/Twitter 深色模式
    function detectDarkMode() {
        // 检查 HTML 的 style 属性中是否有深色背景
        const bgColor = window.getComputedStyle(document.body).backgroundColor;
        const html = document.documentElement;
        const htmlBg = window.getComputedStyle(html).backgroundColor;

        // 检查是否为深色背景（RGB 值较低）
        const checkDarkBg = (bg) => {
            const match = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
                const [, r, g, b] = match.map(Number);
                return (r + g + b) / 3 < 128; // 平均值小于128认为是深色
            }
            return false;
        };

        // 也检查 body 的 style 属性
        const bodyStyle = document.body.getAttribute('style') || '';
        const hasLightBg = bodyStyle.includes('background-color: rgb(255, 255, 255)');
        const hasDarkBg = bodyStyle.includes('background-color: rgb(0, 0, 0)');

        if (hasLightBg) return false;
        if (hasDarkBg) return true;

        return checkDarkBg(bgColor) || checkDarkBg(htmlBg);
    }

    // 全局样式监听器
    let bodyStyleObserver = null;

    // 切换 Twitter/X 页面主题
    function togglePageTheme(toDark) {
        const body = document.body;
        const html = document.documentElement;

        if (!body) return;

        // 添加过渡效果
        body.style.transition = 'background-color 0.3s ease, color 0.3s ease';

        if (toDark) {
            // 切换到深色模式
            body.style.setProperty('background-color', 'rgb(0, 0, 0)', 'important');
            body.style.setProperty('color', 'rgb(231, 233, 234)', 'important');
            html.style.colorScheme = 'dark';

            // 尝试触发 Twitter 的深色模式
            const themeColor = document.querySelector('meta[name="theme-color"]');
            if (themeColor) {
                themeColor.setAttribute('content', '#000000');
            }
        } else {
            // 切换到浅色模式
            body.style.setProperty('background-color', 'rgb(255, 255, 255)', 'important');
            body.style.setProperty('color', 'rgb(15, 20, 25)', 'important');
            html.style.colorScheme = 'light';

            // 尝试触发 Twitter 的浅色模式
            const themeColor = document.querySelector('meta[name="theme-color"]');
            if (themeColor) {
                themeColor.setAttribute('content', '#ffffff');
            }
        }

        // 300ms 后移除过渡效果，避免影响其他动画
        setTimeout(() => {
            body.style.transition = '';
        }, 300);

        // 更新或创建监听器
        if (bodyStyleObserver) {
            bodyStyleObserver.disconnect();
        }
        watchBodyStyles(toDark);
    }

    // 从 localStorage 加载深色模式偏好
    function loadDarkModePreference() {
        // 使用已经在页面加载时读取的值
        isDarkMode = initialDarkMode;
        return isDarkMode;
    }

    // 保存深色模式偏好
    function saveDarkModePreference(dark) {
        localStorage.setItem('x-enhanced-dark-mode', dark);
    }

    // 获取深色模式的颜色方案
    function getColorScheme() {
        if (isDarkMode) {
            return {
                toggle: { bg: '#6366f1', hover: '#4f46e5' },
                collect: { bg: '#059669', hover: '#047857' },
                download: { bg: '#0284c7', hover: '#0369a1' },
                history: { bg: '#475569', hover: '#334155' },
                darkMode: { bg: '#eab308', hover: '#ca8a04', icon: '☀️' }
            };
        } else {
            return {
                toggle: { bg: '#8b5cf6', hover: '#7c3aed' },
                collect: { bg: '#17bf63', hover: '#15a752' },
                download: { bg: '#1d9bf0', hover: '#1a8cd8' },
                history: { bg: '#657786', hover: '#546e7a' },
                darkMode: { bg: '#1e293b', hover: '#0f172a', icon: '🌙' }
            };
        }
    }

    // 更新所有按钮颜色
    function updateButtonColors(buttons) {
        const colors = getColorScheme();

        buttons.toggle.style.background = colors.toggle.bg;
        buttons.toggle.onmouseover = () => buttons.toggle.style.background = colors.toggle.hover;
        buttons.toggle.onmouseout = () => buttons.toggle.style.background = colors.toggle.bg;

        if (!isCollecting) {
            buttons.collect.style.background = colors.collect.bg;
            buttons.collect.onmouseover = () => {
                if (!isCollecting) buttons.collect.style.background = colors.collect.hover;
            };
            buttons.collect.onmouseout = () => {
                if (!isCollecting) buttons.collect.style.background = colors.collect.bg;
            };
        }

        buttons.download.style.background = colors.download.bg;
        buttons.download.onmouseover = () => buttons.download.style.background = colors.download.hover;
        buttons.download.onmouseout = () => buttons.download.style.background = colors.download.bg;

        buttons.history.style.background = colors.history.bg;
        buttons.history.onmouseover = () => buttons.history.style.background = colors.history.hover;
        buttons.history.onmouseout = () => buttons.history.style.background = colors.history.bg;

        buttons.darkMode.style.background = colors.darkMode.bg;
        buttons.darkMode.textContent = colors.darkMode.icon;
        buttons.darkMode.onmouseover = () => buttons.darkMode.style.background = colors.darkMode.hover;
        buttons.darkMode.onmouseout = () => buttons.darkMode.style.background = colors.darkMode.bg;
    }

    function initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('XComExtractor', 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                db = request.result;
                resolve(db);
            };

            request.onupgradeneeded = (event) => {
                const database = event.target.result;
                if (!database.objectStoreNames.contains('collections')) {
                    database.createObjectStore('collections', { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    }

    function saveToIndexedDB() {
        return new Promise((resolve, reject) => {
            if (!db) {
                reject(new Error('数据库未初始化'));
                return;
            }

            const timestamp = new Date().toISOString();
            const data = {
                timestamp: timestamp,
                count: extractedData.length,
                data: extractedData
            };

            const transaction = db.transaction(['collections'], 'readwrite');
            const store = transaction.objectStore('collections');
            const request = store.add(data);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    function getAllHistories() {
        return new Promise((resolve, reject) => {
            if (!db) {
                reject(new Error('数据库未初始化'));
                return;
            }

            const transaction = db.transaction(['collections'], 'readonly');
            const store = transaction.objectStore('collections');
            const request = store.getAll();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    function loadFromIndexedDB(id) {
        return new Promise((resolve, reject) => {
            if (!db) {
                reject(new Error('数据库未初始化'));
                return;
            }

            const transaction = db.transaction(['collections'], 'readonly');
            const store = transaction.objectStore('collections');
            const request = store.get(id);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    function deleteFromIndexedDB(id) {
        return new Promise((resolve, reject) => {
            if (!db) {
                reject(new Error('数据库未初始化'));
                return;
            }

            const transaction = db.transaction(['collections'], 'readwrite');
            const store = transaction.objectStore('collections');
            const request = store.delete(id);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }

    function isAd(element) {
        let parent = element.parentElement;

        for (let i = 0; i < 15 && parent; i++) {
            if (parent.className && parent.className.includes('r-eqz5dr') && parent.className.includes('r-16y2uox') && parent.className.includes('r-1wbh5a2')) {
                const adSpans = parent.querySelectorAll('span.css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3');
                for (let span of adSpans) {
                    if (span.textContent.trim() === 'Ad') {
                        return true;
                    }
                }
            }
            parent = parent.parentElement;
        }
        return false;
    }

    function extractContent() {
        const containers = document.querySelectorAll('div[data-testid="tweetText"]');

        containers.forEach((tweetText) => {
            if (isAd(tweetText)) return;

            const content = tweetText.querySelector('span.css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3');
            if (!content) return;

            const contentText = content.textContent.trim();
            if (!contentText) return;

            let timeText = '未知时间';
            let parent = tweetText.parentElement;

            for (let i = 0; i < 20 && parent; i++) {
                const timeLink = parent.querySelector('a[href*="/status/"][dir="ltr"]');
                if (timeLink) {
                    const timeSpan = timeLink.querySelector('span');
                    if (timeSpan) {
                        timeText = timeSpan.textContent.trim();
                        break;
                    }
                }
                parent = parent.parentElement;
            }

            if (!extractedData.some(item => item.content === contentText && item.time === timeText)) {
                extractedData.push({
                    time: timeText,
                    content: contentText
                });
            }
        });

        checkCount++;
    }

    function startAutoScroll(collectBtn) {
        isCollecting = true;
        let lastScrollHeight = 0;
        let noChangeCount = 0;
        const maxNoChange = 3;
        const intervals = [500, 500, 500];
        let currentIntervalIndex = 0;
        let scrollTimer = null;

        function scheduleNextScroll() {
            const currentInterval = intervals[Math.min(currentIntervalIndex, intervals.length - 1)];

            scrollTimer = setTimeout(() => {
                const currentScrollHeight = document.documentElement.scrollHeight;

                if (currentScrollHeight === lastScrollHeight) {
                    noChangeCount++;
                } else {
                    noChangeCount = 0;
                    currentIntervalIndex = 0;
                }

                lastScrollHeight = currentScrollHeight;
                window.scrollBy(0, window.innerHeight);
                extractContent();

                const interval = intervals[Math.min(currentIntervalIndex, intervals.length - 1)];
                collectBtn.textContent = `采集中... (${extractedData.length}) - 无新内容${noChangeCount}/${maxNoChange} [${(interval/1000).toFixed(0)}s]`;

                if (noChangeCount >= maxNoChange) {
                    window.scrollTo(0, 0);
                    setTimeout(() => {
                        extractContent();
                        collectBtn.textContent = `采集中... (${extractedData.length}) - 最终检查`;
                        saveToIndexedDB().then(() => {
                            collectBtn.textContent = `采集中... (${extractedData.length}) - 保存成功`;
                        }).catch(() => {
                            collectBtn.textContent = `采集中... (${extractedData.length}) - 保存失败`;
                        });
                        setTimeout(() => {
                            stopAutoScroll(collectBtn);
                        }, 1500);
                    }, 500);
                } else {
                    currentIntervalIndex = Math.min(currentIntervalIndex + 1, intervals.length - 1);
                    scheduleNextScroll();
                }
            }, currentInterval);
        }

        scheduleNextScroll();
    }

    function stopAutoScroll(collectBtn) {
        isCollecting = false;
        if (collectBtn) {
            collectBtn.textContent = '采集';
            const colors = getColorScheme();
            collectBtn.style.background = colors.collect.bg;
        }
    }

    function exportToCSV() {
        if (extractedData.length === 0) return;

        let csv = '时间,内容\n';
        extractedData.forEach(item => {
            const time = `"${item.time.replace(/"/g, '""')}"`;
            const content = `"${item.content.replace(/"/g, '""')}"`;
            csv += `${time},${content}\n`;
        });

        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `x_content_${Date.now()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function createButtons() {
        // 检查是否已经创建过按钮，避免重复
        if (buttonsCreated) {
            return;
        }

        // 彻底移除所有可能存在的旧按钮容器
        document.querySelectorAll('#x-enhanced-buttons').forEach(el => el.remove());

        buttonsCreated = true;

        // 加载深色模式偏好
        loadDarkModePreference();
        const colors = getColorScheme();

        const container = document.createElement('div');
        container.id = 'x-enhanced-buttons';
        container.setAttribute('data-script-version', '2.2');
        container.style.cssText = `
            position: fixed;
            top: 80px;
            right: 30px;
            z-index: 9998;
            display: flex;
            gap: 10px;
            flex-direction: column;
        `;

        // 添加切换左侧栏的按钮
        const toggleSidebarBtn = document.createElement('button');
        toggleSidebarBtn.textContent = '☰';
        toggleSidebarBtn.title = '显示/隐藏左侧栏';
        toggleSidebarBtn.style.cssText = `
            background: ${colors.toggle.bg};
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 20px;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            transition: background 0.2s;
        `;
        toggleSidebarBtn.onmouseover = () => toggleSidebarBtn.style.background = colors.toggle.hover;
        toggleSidebarBtn.onmouseout = () => toggleSidebarBtn.style.background = colors.toggle.bg;
        toggleSidebarBtn.onclick = () => {
            const sidebar = document.querySelector('header[role="banner"]');
            console.log('Left sidebar element:', sidebar); // 调试信息
            if (sidebar) {
                const isVisible = sidebar.classList.contains('sidebar-visible');
                if (isVisible) {
                    sidebar.classList.remove('sidebar-visible');
                    toggleSidebarBtn.textContent = '☰';
                    // 强制使用内联样式确保隐藏
                    sidebar.style.transform = 'translateX(-100%)';
                } else {
                    sidebar.classList.add('sidebar-visible');
                    toggleSidebarBtn.textContent = '✕';
                    // 强制使用内联样式确保显示
                    sidebar.style.transform = 'translateX(0)';
                    sidebar.style.visibility = 'visible';
                    sidebar.style.opacity = '1';
                    sidebar.style.display = 'flex';
                }
                console.log('Sidebar visible:', !isVisible); // 调试信息
                console.log('Transform:', sidebar.style.transform); // 调试 transform
            } else {
                console.warn('Left sidebar not found!');
                alert('左侧栏元素未找到，请刷新页面重试');
            }
        };

        const collectBtn = document.createElement('button');
        collectBtn.textContent = '采集';
        collectBtn.style.cssText = `
            background: ${colors.collect.bg};
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            transition: background 0.2s;
        `;
        collectBtn.onmouseover = () => {
            if (!isCollecting) collectBtn.style.background = colors.collect.hover;
        };
        collectBtn.onmouseout = () => {
            if (!isCollecting) collectBtn.style.background = colors.collect.bg;
        };
        collectBtn.onclick = () => {
            if (isCollecting) {
                stopAutoScroll(collectBtn);
            } else {
                extractedData = [];
                checkCount = 0;
                extractContent();
                collectBtn.textContent = `采集中... (${extractedData.length})`;
                collectBtn.style.background = '#f5a623';
                startAutoScroll(collectBtn);
            }
        };

        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = '下载 CSV';
        downloadBtn.style.cssText = `
            background: ${colors.download.bg};
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            transition: background 0.2s;
        `;
        downloadBtn.onmouseover = () => downloadBtn.style.background = colors.download.hover;
        downloadBtn.onmouseout = () => downloadBtn.style.background = colors.download.bg;
        downloadBtn.onclick = () => {
            if (extractedData.length > 0) {
                exportToCSV();
                downloadBtn.textContent = '已下载!';
                setTimeout(() => downloadBtn.textContent = '下载 CSV', 1500);
            } else {
                downloadBtn.textContent = '无数据';
                setTimeout(() => downloadBtn.textContent = '下载 CSV', 1500);
            }
        };

        const historyBtn = document.createElement('button');
        historyBtn.textContent = '历史记录';
        historyBtn.style.cssText = `
            background: ${colors.history.bg};
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            transition: background 0.2s;
        `;
        historyBtn.onmouseover = () => historyBtn.style.background = colors.history.hover;
        historyBtn.onmouseout = () => historyBtn.style.background = colors.history.bg;
        historyBtn.onclick = async () => {
            try {
                const histories = await getAllHistories();
                if (histories.length === 0) {
                    alert('没有历史记录');
                    return;
                }

                const latest = histories[histories.length - 1];
                extractedData = latest.data;
                downloadBtn.textContent = `下载 CSV (${extractedData.length})`;
                historyBtn.textContent = `已恢复 ${latest.count} 条 (${new Date(latest.timestamp).toLocaleString()})`;
                setTimeout(() => historyBtn.textContent = '历史记录', 3000);
            } catch (e) {
                alert('读取历史记录失败: ' + e.message);
            }
        };

        // 添加深色模式切换按钮
        const darkModeBtn = document.createElement('button');
        darkModeBtn.textContent = colors.darkMode.icon;
        darkModeBtn.title = '切换深色模式';
        darkModeBtn.style.cssText = `
            background: ${colors.darkMode.bg};
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 20px;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            transition: background 0.2s;
        `;
        darkModeBtn.onmouseover = () => darkModeBtn.style.background = colors.darkMode.hover;
        darkModeBtn.onmouseout = () => darkModeBtn.style.background = colors.darkMode.bg;
        darkModeBtn.onclick = () => {
            isDarkMode = !isDarkMode;
            saveDarkModePreference(isDarkMode);

            // 切换页面主题
            togglePageTheme(isDarkMode);

            // 更新所有按钮颜色
            const buttons = {
                toggle: toggleSidebarBtn,
                collect: collectBtn,
                download: downloadBtn,
                history: historyBtn,
                darkMode: darkModeBtn
            };
            updateButtonColors(buttons);
        };

        container.appendChild(toggleSidebarBtn);
        container.appendChild(collectBtn);
        container.appendChild(downloadBtn);
        container.appendChild(historyBtn);
        container.appendChild(darkModeBtn);
        document.body.appendChild(container);
    }

    let lastCheck = Date.now();
    const contentObserver = new MutationObserver(() => {
        const now = Date.now();
        if (now - lastCheck > 1000) {
            extractContent();
            lastCheck = now;
        }
    });

    // 等待 DOM 加载完成后初始化内容提取器
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initContentExtractor);
    } else {
        initContentExtractor();
    }

    function initContentExtractor() {
        // 防止重复初始化
        if (extractorInitialized) {
            return;
        }
        extractorInitialized = true;

        // 清理所有可能存在的旧按钮（包括旧版本脚本创建的）
        document.querySelectorAll('#x-enhanced-buttons').forEach(el => el.remove());

        contentObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: false
        });

        initIndexedDB().then(() => {
            extractContent();
            createButtons();
        }).catch((e) => {
            console.warn('IndexedDB 初始化失败:', e.message);
            extractContent();
            createButtons();
        });
    }
})();
