// ==UserScript==
// @name         赛博朋克：数字神经 & 目标锁定
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  鼠标移动显示科技感数字星云，悬停3秒触发赛博朋克目标锁定特效，不影响阅读
// @author       Gemini Enterprise
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ================= 配置区域 =================
    const CONFIG = {
        themeColor: '0, 243, 255', // 赛博青 (R, G, B)
        secondaryColor: '188, 19, 254', // 霓虹紫
        particleCount: 60,         // 粒子数量上限
        connectDistance: 120,      // 连线距离阈值
        lockTime: 3000             // 悬停锁定时间 (ms)
    };

    // ================= 1. 数字星云 (Canvas 背景层) =================
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none; z-index: 999999; opacity: 0.8;
    `;
    document.body.appendChild(canvas);

    let w, h;
    const particles = [];
    const mouse = { x: null, y: null };

    // 初始化尺寸
    const resize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
    window.addEventListener('resize', resize);
    resize();

    // 粒子类
    class Particle {
        constructor() {
            this.x = mouse.x || Math.random() * w;
            this.y = mouse.y || Math.random() * h;
            this.vx = (Math.random() - 0.5) * 1.5; // 速度更平滑
            this.vy = (Math.random() - 0.5) * 1.5;
            this.size = Math.random() * 1.5 + 0.5; // 粒子微小化，不抢眼
            this.life = 1; // 生命值
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
            this.life -= 0.01;
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${CONFIG.themeColor}, ${this.life})`;
            ctx.fill();
        }
    }

    // 动画循环
    function animate() {
        ctx.clearRect(0, 0, w, h);

        // 鼠标移动时生成新粒子
        if (mouse.x && Math.random() > 0.5 && particles.length < CONFIG.particleCount) {
            particles.push(new Particle());
        }

        // 更新和绘制粒子
        for (let i = 0; i < particles.length; i++) {
            let p = particles[i];
            p.update();
            p.draw();

            // 连线逻辑 (Neural Network Effect)
            for (let j = i; j < particles.length; j++) {
                let p2 = particles[j];
                let dx = p.x - p2.x;
                let dy = p.y - p2.y;
                let distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < CONFIG.connectDistance) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(${CONFIG.themeColor}, ${0.15 * p.life})`; // 线条非常淡
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }

            // 移除死亡粒子
            if (p.life <= 0) {
                particles.splice(i, 1);
                i--;
            }
        }
        requestAnimationFrame(animate);
    }
    animate();

    window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
    window.addEventListener('mouseout', () => { mouse.x = null; mouse.y = null; });


    // ================= 2. 目标锁定特效 (CSS) =================
    // 注入 CSS
    const style = document.createElement('style');
    style.textContent = `
        /* 基础容器：不影响布局 */
        .cyber-lock-target {
            position: relative;
        }

        /* 锁定框容器：浮动在元素上方 */
        .cyber-lock-overlay {
            position: absolute;
            top: -6px; left: -6px; right: -6px; bottom: -6px;
            pointer-events: none; /* 点击穿透，不影响操作 */
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.3s ease;
        }

        /* 激活状态 */
        .cyber-lock-overlay.active {
            opacity: 1;
        }

        /* 四个角的机械边框 */
        .cyber-lock-corner {
            position: absolute;
            width: 15px;
            height: 15px;
            border: 2px solid transparent;
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); /* 弹性动画 */
        }

        /* 初始状态：稍微散开 */
        .cyber-lock-overlay .tl { top: -10px; left: -10px; border-top-color: rgb(${CONFIG.themeColor}); border-left-color: rgb(${CONFIG.themeColor}); }
        .cyber-lock-overlay .tr { top: -10px; right: -10px; border-top-color: rgb(${CONFIG.themeColor}); border-right-color: rgb(${CONFIG.themeColor}); }
        .cyber-lock-overlay .bl { bottom: -10px; left: -10px; border-bottom-color: rgb(${CONFIG.themeColor}); border-left-color: rgb(${CONFIG.themeColor}); }
        .cyber-lock-overlay .br { bottom: -10px; right: -10px; border-bottom-color: rgb(${CONFIG.themeColor}); border-right-color: rgb(${CONFIG.themeColor}); }

        /* 锁定状态：收缩贴合 */
        .cyber-lock-overlay.active .tl { top: 0; left: 0; }
        .cyber-lock-overlay.active .tr { top: 0; right: 0; }
        .cyber-lock-overlay.active .bl { bottom: 0; left: 0; }
        .cyber-lock-overlay.active .br { bottom: 0; right: 0; }

        /* 扫描线特效 */
        .cyber-scan-line {
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: linear-gradient(to bottom, transparent, rgba(${CONFIG.themeColor}, 0.2), transparent);
            transform: translateY(-100%);
            animation: cyber-scan 2s linear infinite;
            display: none;
        }
        .cyber-lock-overlay.active .cyber-scan-line {
            display: block;
        }

        /* 数据标签 (右下角的小字) */
        .cyber-tag {
            position: absolute;
            bottom: -20px; right: 0;
            font-family: 'Courier New', monospace;
            font-size: 10px;
            color: rgb(${CONFIG.themeColor});
            text-shadow: 0 0 5px rgb(${CONFIG.themeColor});
            opacity: 0;
            transform: translateX(-10px);
            transition: all 0.3s ease 0.2s; /* 延迟显示 */
        }
        .cyber-lock-overlay.active .cyber-tag {
            opacity: 1;
            transform: translateX(0);
        }

        @keyframes cyber-scan {
            0% { transform: translateY(-100%); }
            100% { transform: translateY(100%); }
        }
    `;
    document.head.appendChild(style);

    // ================= 逻辑控制 =================
    let hoverTimer = null;
    let overlayElement = null;

    // 创建浮层 DOM 结构
    function createOverlay(target) {
        if (overlayElement) overlayElement.remove();

        overlayElement = document.createElement('div');
        overlayElement.className = 'cyber-lock-overlay';
        overlayElement.innerHTML = `
            <div class="cyber-lock-corner tl"></div>
            <div class="cyber-lock-corner tr"></div>
            <div class="cyber-lock-corner bl"></div>
            <div class="cyber-lock-corner br"></div>
            <div class="cyber-scan-line"></div>
            <div class="cyber-tag">TARGET_LOCKED // [${target.tagName}]</div>
        `;

        // 必须将浮层插入到 target 的父级，或者 append 到 body 并计算坐标
        // 为了简单且不破坏布局，我们 append 到 target 内部，但要注意 target 必须是 relative/absolute
        // 如果 target 是 img 或 input，这种方法会失败。
        // 所以这里使用更稳健的方法：Append 到 Body 并绝对定位。

        const rect = target.getBoundingClientRect();
        overlayElement.style.width = rect.width + 'px';
        overlayElement.style.height = rect.height + 'px';
        overlayElement.style.top = (rect.top + window.scrollY) + 'px';
        overlayElement.style.left = (rect.left + window.scrollX) + 'px';

        document.body.appendChild(overlayElement);

        // 强制重绘
        void overlayElement.offsetWidth;
        overlayElement.classList.add('active');
    }

    document.addEventListener('mouseover', (e) => {
        const target = e.target;
        // 忽略 Canvas、Body、HTML 和极小的元素
        if (target === canvas || target === document.body || target === document.documentElement || target.className.includes('cyber')) return;
        if (target.offsetWidth < 20 || target.offsetHeight < 20) return;

        // 只有当元素看起来像是交互元素时才触发 (可选，为了演示效果目前对所有大元素生效)
        // if (!['A', 'BUTTON', 'INPUT', 'IMG', 'DIV'].includes(target.tagName)) return;

        hoverTimer = setTimeout(() => {
            createOverlay(target);
        }, CONFIG.lockTime);
    });

    document.addEventListener('mouseout', (e) => {
        clearTimeout(hoverTimer);
        // 如果移出的不是 overlay 且存在 overlay
        if (overlayElement) {
             overlayElement.classList.remove('active');
             // 动画结束后移除 DOM
             setTimeout(() => {
                 if (overlayElement && !overlayElement.classList.contains('active')) {
                     overlayElement.remove();
                     overlayElement = null;
                 }
             }, 300);
        }
    });

    // 页面滚动时移除锁定框，防止错位
    window.addEventListener('scroll', () => {
        if (overlayElement) {
             overlayElement.remove();
             overlayElement = null;
        }
    });

})();
