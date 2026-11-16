// ==UserScript==
// @name         薄水面 Water Surface
// @namespace    water.surface.userscript
// @version      1.0.0
// @description  给网页盖一层薄水:鼠标划过产生涟漪,下方页面内容随水波轻微折射变形
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CFG = {
    cell: 4,            // 水面网格精度(像素/格),越小越细腻也越耗性能
    damping: 0.972,     // 波纹衰减,越接近 1 涟漪持续越久
    refraction: 12,     // 折射强度(页面内容最大偏移像素)
    gain: 1.2,          // 波纹斜率到折射的放大倍数
    brush: 1.6,           // 鼠标划水的笔刷半径(格)
    force: 0.55,        // 划水力度
    clickForce: 1.2,    // 点击水滴力度
    highlight: 0.2,     // 水面高光强度,0 为关闭
    tint: 'rgba(120, 190, 255, 0.035)', // 水的淡淡色调
    hotkey: 'KeyW',     // Alt + W 开关
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FILTER_ID = 'tm-water-refraction';
  const canRefract =
    CSS.supports('backdrop-filter', `url(#${FILTER_ID})`) ||
    CSS.supports('-webkit-backdrop-filter', `url(#${FILTER_ID})`);

  // ---------- DOM ----------
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;';

  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', FILTER_ID);
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');

  const feImage = document.createElementNS(SVG_NS, 'feImage');
  feImage.setAttribute('x', '0');
  feImage.setAttribute('y', '0');
  feImage.setAttribute('preserveAspectRatio', 'none');
  feImage.setAttribute('result', 'map');

  const feDisp = document.createElementNS(SVG_NS, 'feDisplacementMap');
  feDisp.setAttribute('in', 'SourceGraphic');
  feDisp.setAttribute('in2', 'map');
  feDisp.setAttribute('scale', String(CFG.refraction));
  feDisp.setAttribute('xChannelSelector', 'R');
  feDisp.setAttribute('yChannelSelector', 'G');

  filter.append(feImage, feDisp);
  svg.append(filter);

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;left:0;top:0;width:100vw;height:100vh;margin:0;padding:0;border:0;' +
    'pointer-events:none;z-index:2147483647;background:' + CFG.tint + ';';

  const hiCanvas = document.createElement('canvas');
  hiCanvas.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
  overlay.append(hiCanvas);

  const mapCanvas = document.createElement('canvas');
  const mapCtx = mapCanvas.getContext('2d');
  const hiCtx = hiCanvas.getContext('2d');

  document.documentElement.append(svg, overlay);

  // ---------- 水面模拟 ----------
  let gridW = 0, gridH = 0;
  let cur, prev, mapImg, hiImg;

  function setRefraction(on) {
    if (!canRefract) return;
    const value = on ? `url(#${FILTER_ID})` : 'none';
    overlay.style.backdropFilter = value;
    overlay.style.webkitBackdropFilter = value;
  }

  function resize() {
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    gridW = Math.ceil(viewW / CFG.cell) + 2;
    gridH = Math.ceil(viewH / CFG.cell) + 2;
    cur = new Float32Array(gridW * gridH);
    prev = new Float32Array(gridW * gridH);

    mapCanvas.width = hiCanvas.width = gridW;
    mapCanvas.height = hiCanvas.height = gridH;
    mapImg = mapCtx.createImageData(gridW, gridH);
    hiImg = hiCtx.createImageData(gridW, gridH);
    const data = mapImg.data;
    for (let p = 0; p < data.length; p += 4) {
      data[p] = data[p + 1] = data[p + 2] = 128;
      data[p + 3] = 255;
    }

    filter.setAttribute('width', String(viewW));
    filter.setAttribute('height', String(viewH));
    feImage.setAttribute('width', String(viewW));
    feImage.setAttribute('height', String(viewH));
  }

  function drop(pageX, pageY, radius, force) {
    const centerX = pageX / CFG.cell;
    const centerY = pageY / CFG.cell;
    const minX = Math.max(1, Math.floor(centerX - radius));
    const maxX = Math.min(gridW - 2, Math.ceil(centerX + radius));
    const minY = Math.max(1, Math.floor(centerY - radius));
    const maxY = Math.min(gridH - 2, Math.ceil(centerY + radius));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dist = Math.hypot(x - centerX, y - centerY);
        if (dist < radius) {
          cur[y * gridW + x] -= force * (0.5 + 0.5 * Math.cos((Math.PI * dist) / radius));
        }
      }
    }
  }

  function step() {
    let energy = 0;
    for (let y = 1; y < gridH - 1; y++) {
      for (let x = 1; x < gridW - 1; x++) {
        const i = y * gridW + x;
        const value =
          ((cur[i - 1] + cur[i + 1] + cur[i - gridW] + cur[i + gridW]) * 0.5 - prev[i]) *
          CFG.damping;
        prev[i] = value;
        energy += value < 0 ? -value : value;
      }
    }
    const swap = cur;
    cur = prev;
    prev = swap;
    return energy;
  }

  function render() {
    const map = mapImg.data;
    const hi = hiImg.data;
    const slope = CFG.gain * 127;
    for (let y = 1; y < gridH - 1; y++) {
      for (let x = 1; x < gridW - 1; x++) {
        const i = y * gridW + x;
        const p = i * 4;
        const dx = cur[i - 1] - cur[i + 1];
        const dy = cur[i - gridW] - cur[i + gridW];
        map[p] = 128 + dx * slope;
        map[p + 1] = 128 + dy * slope;

        const light = (dx + dy) * CFG.highlight;
        if (light > 0) {
          hi[p] = hi[p + 1] = hi[p + 2] = 255;
          hi[p + 3] = light * 255;
        } else {
          hi[p] = hi[p + 1] = hi[p + 2] = 0;
          hi[p + 3] = -light * 110;
        }
      }
    }
    hiCtx.putImageData(hiImg, 0, 0);
    if (canRefract) {
      mapCtx.putImageData(mapImg, 0, 0);
      feImage.setAttribute('href', mapCanvas.toDataURL('image/png'));
    }
  }

  // ---------- 循环(水面平静后自动休眠) ----------
  let enabled = true;
  let running = false;
  let calmFrames = 0;
  let lastTime = 0;

  function frame(time) {
    if (!running) return;
    if (time - lastTime >= 14) {
      lastTime = time;
      const energy = step();
      render();
      calmFrames = energy < 0.02 ? calmFrames + 1 : 0;
      if (calmFrames > 40) {
        sleep();
        return;
      }
    }
    requestAnimationFrame(frame);
  }

  function wake() {
    if (running || !enabled) return;
    running = true;
    calmFrames = 0;
    setRefraction(true);
    requestAnimationFrame(frame);
  }

  function sleep() {
    running = false;
    cur.fill(0);
    prev.fill(0);
    hiCtx.clearRect(0, 0, gridW, gridH);
    setRefraction(false);
  }

  // ---------- 交互 ----------
  let lastX = null, lastY = null;

  window.addEventListener('pointermove', (event) => {
    if (!enabled) return;
    const x = event.clientX;
    const y = event.clientY;
    if (lastX !== null) {
      const dist = Math.hypot(x - lastX, y - lastY);
      if (dist > 0.5) {
        const steps = Math.min(40, Math.max(1, Math.ceil(dist / CFG.cell)));
        const force = (CFG.force * Math.min(1, dist / 30)) / CFG.brush;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          drop(lastX + (x - lastX) * t, lastY + (y - lastY) * t, CFG.brush, force);
        }
        wake();
      }
    }
    lastX = x;
    lastY = y;
  }, { passive: true, capture: true });

  window.addEventListener('pointerdown', (event) => {
    if (!enabled) return;
    drop(event.clientX, event.clientY, CFG.brush * 2, CFG.clickForce);
    wake();
  }, { passive: true, capture: true });

  document.addEventListener('pointerleave', () => { lastX = lastY = null; });

  window.addEventListener('resize', () => {
    resize();
    if (running) sleep();
  });

  window.addEventListener('keydown', (event) => {
    if (event.altKey && event.code === CFG.hotkey) {
      enabled = !enabled;
      overlay.style.display = enabled ? '' : 'none';
      if (!enabled && running) sleep();
    }
  });

  resize();
})();