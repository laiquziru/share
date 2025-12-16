// ==UserScript==
// @name         炫技鼠标特效 & 悬停边框旋转
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  鼠标移动产生彩色粒子拖尾，元素停留3秒显示旋转渐变边框
// @author       Gemini Enterprise
// @match        *://*/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // --- 1. 鼠标滑动炫技特效 (彩色粒子拖尾) ---
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.id = 'canvas_mouse_trail';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none'; // 让点击事件穿透 Canvas
    canvas.style.zIndex = '999999';
    document.body.appendChild(canvas);

    let width, height;
    let particles = [];

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    class Particle {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.size = Math.random() * 5 + 2;
            this.speedX = Math.random() * 2 - 1;
            this.speedY = Math.random() * 2 - 1;
            this.color = `hsl(${Math.random() * 360}, 100%, 50%)`;
            this.life = 1.0; // 生命值
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            this.size *= 0.95; // 逐渐变小
            this.life -= 0.02; // 逐渐消失
        }
        draw() {
            ctx.fillStyle = this.color;
            ctx.globalAlpha = this.life;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function animateParticles() {
        ctx.clearRect(0, 0, width, height);
        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();
            if (particles[i].life <= 0 || particles[i].size <= 0.5) {
                particles.splice(i, 1);
                i--;
            }
        }
        requestAnimationFrame(animateParticles);
    }
    animateParticles();

    window.addEventListener('mousemove', (e) => {
        // 每次移动产生几个粒子
        for (let i = 0; i < 3; i++) {
            particles.push(new Particle(e.clientX, e.clientY));
        }
    });

    // --- 2. 元素悬停 3 秒边框旋转特效 ---

    // 注入 CSS 样式
    const css = `
        .gemini-border-effect {
            position: relative;
            z-index: 10; /* 提升层级 */
        }
        /* 使用伪元素创建旋转边框，不影响原元素布局 */
        .gemini-border-effect::after {
            content: '';
            position: absolute;
            top: -4px; left: -4px; right: -4px; bottom: -4px;
            background: linear-gradient(45deg, #ff0000, #ff7300, #fffb00, #48ff00, #00ffd5, #002bff, #7a00ff, #ff00c8, #ff0000);
            background-size: 400%;
            z-index: -1;
            filter: blur(5px);
            animation: gemini-glowing 20s linear infinite;
            border-radius: 4px;
            opacity: 0;
            transition: opacity 0.5s ease-in-out;
        }
        /* 显示边框 */
        .gemini-border-effect.active::after {
            opacity: 1;
        }

        @keyframes gemini-glowing {
            0% { background-position: 0 0; }
            50% { background-position: 400% 0; }
            100% { background-position: 0 0; }
        }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    let hoverTimer = null;
    let currentTarget = null;

    document.addEventListener('mouseover', function(e) {
        const target = e.target;
        // 过滤掉我们的 canvas 和 body/html
        if (target.id === 'canvas_mouse_trail' || target === document.body || target === document.documentElement) return;

        currentTarget = target;

        // 设置 3 秒定时器
        hoverTimer = setTimeout(() => {
            if (currentTarget === target) {
                target.classList.add('gemini-border-effect');
                // 强制重绘以触发 transition (有时需要)
                void target.offsetWidth;
                target.classList.add('active');
            }
        }, 3000);
    });

    document.addEventListener('mouseout', function(e) {
        const target = e.target;
        if (target === currentTarget) {
            // 清除定时器
            clearTimeout(hoverTimer);
            hoverTimer = null;
            currentTarget = null;

            // 移除特效
            target.classList.remove('active');
            // 稍微延迟移除基础类，等待透明度过渡完成
            setTimeout(() => {
               target.classList.remove('gemini-border-effect');
            }, 500);
        }
    });

})();
