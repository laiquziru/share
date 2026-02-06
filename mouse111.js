// ==UserScript==
// @name         炫酷鼠标特效
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  为鼠标添加各种炫酷的视觉特效，包括粒子轨迹、光晕、点击涟漪等
// @author       Cool Mouse Effects
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  class MouseEffects {
    constructor() {
      this.enabled = true;
      this.particles = [];
      this.mouseX = 0;
      this.mouseY = 0;
      this.canvas = null;
      this.ctx = null;

      this.settings = {
        particleTrail: true,
        glowEffect: true,
        clickRipple: true,
        clickBurst: true,
        color: '#FF69B4',
        particleSize: 4,
        particleCount: 5,
        intensity: 1,
        trailEffect: 'rainbow'
      };

      this.presets = {
        rainbow: { color: '#FF69B4', trailEffect: 'rainbow' },
        fire: { color: '#FF4500', trailEffect: 'fire' },
        ice: { color: '#00CED1', trailEffect: 'ice' },
        neon: { color: '#00FF00', trailEffect: 'neon' }
      };

      this.init();
    }

    init() {
      this.createCanvas();
      this.setupEventListeners();
      this.createSettingsPanel();
      this.animate();
    }

    createCanvas() {
      this.canvas = document.createElement('canvas');
      this.canvas.style.position = 'fixed';
      this.canvas.style.top = '0';
      this.canvas.style.left = '0';
      this.canvas.style.pointerEvents = 'none';
      this.canvas.style.zIndex = '2147483647';
      this.resizeCanvas();

      document.body.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }

    setupEventListeners() {
      document.addEventListener('mousemove', (e) => {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;

        if (this.settings.particleTrail) {
          this.createTrailParticles();
        }
      });

      document.addEventListener('click', (e) => {
        if (this.settings.clickRipple) {
          this.createRipple(e.clientX, e.clientY);
        }
        if (this.settings.clickBurst) {
          this.createBurst(e.clientX, e.clientY);
        }
      });

      document.addEventListener('dblclick', (e) => {
        this.createFireworks(e.clientX, e.clientY);
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.toggleSettings();
        }
      });
    }

    createTrailParticles() {
      for (let i = 0; i < this.settings.particleCount * this.settings.intensity; i++) {
        const particle = {
          x: this.mouseX + (Math.random() - 0.5) * 10,
          y: this.mouseY + (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * 4,
          vy: (Math.random() - 0.5) * 4 - 1,
          life: 1,
          color: this.getParticleColor(),
          size: this.settings.particleSize + Math.random() * 2
        };
        this.particles.push(particle);
      }
    }

    getParticleColor() {
      const colors = {
        rainbow: ['#FF69B4', '#FF1493', '#FF6347', '#FFD700', '#00CED1', '#9370DB'],
        fire: ['#FF4500', '#FF6347', '#FFD700', '#FFA500'],
        ice: ['#00CED1', '#00BFFF', '#87CEEB', '#B0E0E6'],
        neon: ['#00FF00', '#00FFFF', '#FF00FF', '#FFFF00']
      };

      const colorSet = colors[this.settings.trailEffect] || colors.rainbow;
      return colorSet[Math.floor(Math.random() * colorSet.length)];
    }

    createRipple(x, y) {
      const ripple = {
        x: x,
        y: y,
        radius: 0,
        maxRadius: 100,
        life: 1,
        type: 'ripple'
      };
      this.particles.push(ripple);
    }

    createBurst(x, y) {
      const burstCount = 12;
      for (let i = 0; i < burstCount; i++) {
        const angle = (i / burstCount) * Math.PI * 2;
        const particle = {
          x: x,
          y: y,
          vx: Math.cos(angle) * 8,
          vy: Math.sin(angle) * 8,
          life: 1,
          color: this.getParticleColor(),
          size: this.settings.particleSize,
          type: 'burst'
        };
        this.particles.push(particle);
      }
    }

    createFireworks(x, y) {
      const fireworkCount = 40;
      for (let i = 0; i < fireworkCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 10 + 5;
        const particle = {
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          color: this.getParticleColor(),
          size: Math.random() * 4 + 2,
          type: 'firework',
          gravity: 0.15
        };
        this.particles.push(particle);
      }
    }

    animate() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= 0.02;

        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }

        if (p.type === 'ripple') {
          this.drawRipple(p);
        } else {
          this.updateParticle(p);
          this.drawParticle(p);
        }
      }

      if (this.settings.glowEffect) {
        this.drawGlow();
      }

      requestAnimationFrame(() => this.animate());
    }

    updateParticle(p) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;

      if (p.gravity) {
        p.vy += p.gravity;
      }
    }

    drawParticle(p) {
      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, p.life);
      this.ctx.fillStyle = p.color;
      this.ctx.shadowBlur = 10;
      this.ctx.shadowColor = p.color;

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.restore();
    }

    drawRipple(ripple) {
      ripple.radius = (1 - ripple.life) * ripple.maxRadius;

      this.ctx.save();
      this.ctx.globalAlpha = ripple.life * 0.5;
      this.ctx.strokeStyle = this.settings.color;
      this.ctx.lineWidth = 2;
      this.ctx.shadowBlur = 10;
      this.ctx.shadowColor = this.settings.color;

      this.ctx.beginPath();
      this.ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.restore();
    }

    drawGlow() {
      this.ctx.save();
      this.ctx.globalAlpha = 0.6;

      const gradient = this.ctx.createRadialGradient(
        this.mouseX, this.mouseY, 0,
        this.mouseX, this.mouseY, 30
      );
      gradient.addColorStop(0, this.settings.color);
      gradient.addColorStop(1, 'transparent');

      this.ctx.fillStyle = gradient;
      this.ctx.shadowBlur = 20;
      this.ctx.shadowColor = this.settings.color;
      this.ctx.beginPath();
      this.ctx.arc(this.mouseX, this.mouseY, 30, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.restore();
    }

    createSettingsPanel() {
      const panel = document.createElement('div');
      panel.id = 'cool-mouse-panel';
      panel.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        width: 300px;
        background: rgba(20, 20, 30, 0.95);
        border: 2px solid #FF69B4;
        border-radius: 10px;
        padding: 20px;
        font-family: Arial, sans-serif;
        color: #fff;
        z-index: 2147483646;
        box-shadow: 0 8px 32px rgba(255, 105, 180, 0.3);
        display: none;
        backdrop-filter: blur(10px);
      `;

      panel.innerHTML = `
        <div style="margin-bottom: 15px; font-size: 16px; font-weight: bold; border-bottom: 1px solid #FF69B4; padding-bottom: 10px;">
          炫酷鼠标特效 ✨
        </div>

        <div style="margin-bottom: 10px;">
          <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 8px;">
            <input type="checkbox" id="particleTrail" style="margin-right: 10px; cursor: pointer;">
            <span>粒子轨迹</span>
          </label>
        </div>

        <div style="margin-bottom: 10px;">
          <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 8px;">
            <input type="checkbox" id="glowEffect" style="margin-right: 10px; cursor: pointer;">
            <span>光晕效果</span>
          </label>
        </div>

        <div style="margin-bottom: 10px;">
          <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 8px;">
            <input type="checkbox" id="clickRipple" style="margin-right: 10px; cursor: pointer;">
            <span>点击涟漪</span>
          </label>
        </div>

        <div style="margin-bottom: 15px;">
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="clickBurst" style="margin-right: 10px; cursor: pointer;">
            <span>爆裂效果</span>
          </label>
        </div>

        <div style="margin-bottom: 15px;">
          <label style="font-size: 12px; margin-bottom: 5px; display: block;">颜色主题</label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
            <button data-preset="rainbow" style="background: linear-gradient(90deg, #FF69B4, #FFD700); border: none; padding: 8px; border-radius: 5px; cursor: pointer; color: #000; font-weight: bold;">彩虹</button>
            <button data-preset="fire" style="background: linear-gradient(90deg, #FF4500, #FFD700); border: none; padding: 8px; border-radius: 5px; cursor: pointer; color: #fff; font-weight: bold;">火焰</button>
            <button data-preset="ice" style="background: linear-gradient(90deg, #00CED1, #87CEEB); border: none; padding: 8px; border-radius: 5px; cursor: pointer; color: #000; font-weight: bold;">冰冷</button>
            <button data-preset="neon" style="background: linear-gradient(90deg, #00FF00, #00FFFF); border: none; padding: 8px; border-radius: 5px; cursor: pointer; color: #000; font-weight: bold;">霓虹</button>
          </div>
        </div>

        <div style="margin-bottom: 15px;">
          <label style="font-size: 12px; margin-bottom: 5px; display: block;">强度: <span id="intensityValue">1</span>x</label>
          <input type="range" id="intensitySlider" min="0.5" max="3" step="0.5" value="1" style="width: 100%; cursor: pointer;">
        </div>

        <div style="margin-bottom: 15px;">
          <label style="font-size: 12px; margin-bottom: 5px; display: block;">粒子大小: <span id="sizeValue">4</span>px</label>
          <input type="range" id="sizeSlider" min="2" max="8" step="1" value="4" style="width: 100%; cursor: pointer;">
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <button id="resetBtn" style="background: #FF69B4; border: none; padding: 10px; border-radius: 5px; cursor: pointer; color: #fff; font-weight: bold;">重置</button>
          <button id="closeBtn" style="background: #555; border: none; padding: 10px; border-radius: 5px; cursor: pointer; color: #fff; font-weight: bold;">关闭</button>
        </div>

        <div style="margin-top: 10px; font-size: 11px; color: #999; text-align: center;">
          按 ESC 打开/关闭面板
        </div>
      `;

      document.body.appendChild(panel);
      this.setupPanelListeners(panel);
    }

    setupPanelListeners(panel) {
      document.getElementById('particleTrail').checked = this.settings.particleTrail;
      document.getElementById('glowEffect').checked = this.settings.glowEffect;
      document.getElementById('clickRipple').checked = this.settings.clickRipple;
      document.getElementById('clickBurst').checked = this.settings.clickBurst;

      document.getElementById('particleTrail').addEventListener('change', (e) => {
        this.settings.particleTrail = e.target.checked;
      });

      document.getElementById('glowEffect').addEventListener('change', (e) => {
        this.settings.glowEffect = e.target.checked;
      });

      document.getElementById('clickRipple').addEventListener('change', (e) => {
        this.settings.clickRipple = e.target.checked;
      });

      document.getElementById('clickBurst').addEventListener('change', (e) => {
        this.settings.clickBurst = e.target.checked;
      });

      document.querySelectorAll('[data-preset]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const preset = e.target.dataset.preset;
          Object.assign(this.settings, this.presets[preset]);
        });
      });

      document.getElementById('intensitySlider').addEventListener('input', (e) => {
        this.settings.intensity = parseFloat(e.target.value);
        document.getElementById('intensityValue').textContent = e.target.value;
      });

      document.getElementById('sizeSlider').addEventListener('input', (e) => {
        this.settings.particleSize = parseInt(e.target.value);
        document.getElementById('sizeValue').textContent = e.target.value;
      });

      document.getElementById('resetBtn').addEventListener('click', () => {
        this.settings = {
          particleTrail: true,
          glowEffect: true,
          clickRipple: true,
          clickBurst: true,
          color: '#FF69B4',
          particleSize: 4,
          particleCount: 5,
          intensity: 1,
          trailEffect: 'rainbow'
        };
        document.getElementById('particleTrail').checked = true;
        document.getElementById('glowEffect').checked = true;
        document.getElementById('clickRipple').checked = true;
        document.getElementById('clickBurst').checked = true;
        document.getElementById('intensitySlider').value = 1;
        document.getElementById('sizeSlider').value = 4;
        document.getElementById('intensityValue').textContent = '1';
        document.getElementById('sizeValue').textContent = '4';
      });

      document.getElementById('closeBtn').addEventListener('click', () => {
        this.toggleSettings();
      });
    }

    toggleSettings() {
      const panel = document.getElementById('cool-mouse-panel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new MouseEffects();
    });
  } else {
    new MouseEffects();
  }
})();
