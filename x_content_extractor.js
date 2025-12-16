// ==UserScript==
// @name         X.com Content Extractor
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Extract content from spans with specific classes on x.com
// @author       You
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    let extractedData = [];
    let checkCount = 0;
    const maxChecks = 50;
    let isCollecting = false;
    let scrollInterval = null;
    let db = null;

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
            collectBtn.style.background = '#17bf63';
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
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            display: flex;
            gap: 10px;
            flex-direction: column;
        `;

        const collectBtn = document.createElement('button');
        collectBtn.textContent = '采集';
        collectBtn.style.cssText = `
            background: #17bf63;
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
            if (!isCollecting) collectBtn.style.background = '#15a752';
        };
        collectBtn.onmouseout = () => {
            if (!isCollecting) collectBtn.style.background = '#17bf63';
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
            background: #1d9bf0;
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
        downloadBtn.onmouseover = () => downloadBtn.style.background = '#1a8cd8';
        downloadBtn.onmouseout = () => downloadBtn.style.background = '#1d9bf0';
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
            background: #657786;
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
        historyBtn.onmouseover = () => historyBtn.style.background = '#546e7a';
        historyBtn.onmouseout = () => historyBtn.style.background = '#657786';
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

        container.appendChild(collectBtn);
        container.appendChild(downloadBtn);
        container.appendChild(historyBtn);
        document.body.appendChild(container);
    }

    let lastCheck = Date.now();
    const observer = new MutationObserver(() => {
        const now = Date.now();
        if (now - lastCheck > 1000) {
            extractContent();
            lastCheck = now;
        }
    });

    observer.observe(document.body, {
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
})();
