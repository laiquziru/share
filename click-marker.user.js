// ==UserScript==
// @name         点击标记脚本
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  点击元素后在其后方标记☑️，并显示边框渐变效果
// @match        https://*.b4u.qzz.io/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const style = document.createElement('style');
    style.textContent = `
        .click-border-anim {
            animation: borderGlow 0.6s ease-out;
        }
        @keyframes borderGlow {
            0% { outline: 3px solid #00ff00; outline-offset: 2px; }
            100% { outline: 3px solid transparent; outline-offset: 2px; }
        }
    `;
    document.head.appendChild(style);

    const isClickable = el => el.matches('a, button, input[type="button"], input[type="submit"], [onclick], [role="button"], [tabindex]');

    document.addEventListener('click', e => {
        const el = e.target.closest('a, button, input[type="button"], input[type="submit"], [onclick], [role="button"], [tabindex]');
        if (!el || el.dataset.clicked) return;

        el.dataset.clicked = '1';
        el.classList.add('click-border-anim');
        el.insertAdjacentHTML('afterend', '<span class="click-mark">☑️</span>');

        el.addEventListener('animationend', () => el.classList.remove('click-border-anim'), { once: true });
    }, true);

})();
