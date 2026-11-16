// ==UserScript==
// @name         全域清透水面波纹与真实折射 (Water Ripple & Refraction Overlay)
// @namespace    https://alma.local/userscripts/water-overlay
// @version      1.0.0
// @description  在所有网页上覆盖一层薄薄的清透水面：鼠标划过与点击产生真实物理水波纹、镜面高光与水底焦散，水面下的网页文字与图片实时产生真实折射畸变。支持自定义水色、影响范围、折射强度等全部参数（快捷键 Alt+W 打开设置面板，Alt+Shift+W 开关水面）。
// @author       Alma
// @match        *://*/*
// @match        file:///*
// @noframes
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  if (window.__ALMA_WATER_OVERLAY_LOADED__) return;
  window.__ALMA_WATER_OVERLAY_LOADED__ = true;

  const STORAGE_KEY = 'alma_water_overlay_cfg_v1';

  const PRESETS = {
    spring: {
      name: '清泉微澜',
      waterColor: '#38bdf8',
      tintOpacity: 0.04,
      refraction: 28,
      specular: 1.05,
      caustics: 0.55,
      hoverRadius: 22,
      hoverStrength: 0.75,
      clickRadius: 42,
      clickStrength: 1.85,
      damping: 0.972,
      autoRain: false,
      rainRate: 1.5
    },
    ocean: {
      name: '浅海碧波',
      waterColor: '#06b6d4',
      tintOpacity: 0.12,
      refraction: 38,
      specular: 1.25,
      caustics: 0.85,
      hoverRadius: 28,
      hoverStrength: 0.9,
      clickRadius: 54,
      clickStrength: 2.2,
      damping: 0.978,
      autoRain: true,
      rainRate: 1.8
    },
    jade: {
      name: '翡翠寒潭',
      waterColor: '#10b981',
      tintOpacity: 0.10,
      refraction: 32,
      specular: 0.95,
      caustics: 0.65,
      hoverRadius: 24,
      hoverStrength: 0.8,
      clickRadius: 46,
      clickStrength: 1.9,
      damping: 0.975,
      autoRain: false,
      rainRate: 1.2
    },
    sakura: {
      name: '樱花露水',
      waterColor: '#f472b6',
      tintOpacity: 0.08,
      refraction: 24,
      specular: 1.15,
      caustics: 0.5,
      hoverRadius: 20,
      hoverStrength: 0.7,
      clickRadius: 40,
      clickStrength: 1.7,
      damping: 0.968,
      autoRain: true,
      rainRate: 2.2
    },
    amber: {
      name: '琥珀流光',
      waterColor: '#f59e0b',
      tintOpacity: 0.09,
      refraction: 34,
      specular: 1.3,
      caustics: 0.75,
      hoverRadius: 26,
      hoverStrength: 0.85,
      clickRadius: 48,
      clickStrength: 2.0,
      damping: 0.97,
      autoRain: false,
      rainRate: 1.0
    }
  };

  const DEFAULT_CONFIG = Object.assign(
    {
      enabled: true,
      pauseInFullscreen: true,
      simScale: 6 // 物理网格缩放比（越小越细腻，6 兼顾丝滑与 60fps 低耗）
    },
    PRESETS.spring
  );

  function loadConfig() {
    try {
      if (typeof GM_getValue === 'function') {
        const raw = GM_getValue(STORAGE_KEY, null);
        if (raw) return Object.assign({}, DEFAULT_CONFIG, typeof raw === 'string' ? JSON.parse(raw) : raw);
      }
      const ls = localStorage.getItem(STORAGE_KEY);
      if (ls) return Object.assign({}, DEFAULT_CONFIG, JSON.parse(ls));
    } catch (_) {}
    return Object.assign({}, DEFAULT_CONFIG);
  }

  function saveConfig(cfg) {
    try {
      const str = JSON.stringify(cfg);
      if (typeof GM_setValue === 'function') GM_setValue(STORAGE_KEY, str);
      else localStorage.setItem(STORAGE_KEY, str);
    } catch (_) {}
  }

  const cfg = loadConfig();

  function hexToRgb(hex) {
    const clean = (hex || '#38bdf8').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const num = parseInt(full, 16) || 0x38bdf8;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  // 快速 Base64 编码表（用于直出未压缩 24-bit BMP 位移贴图，避免 PNG 压缩卡顿与异步闪烁）
  const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function uint8ToBase64(bytes) {
    let out = '';
    const len = bytes.length;
    let i = 0;
    for (; i + 2 < len; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out +=
        B64_CHARS[(n >> 18) & 63] +
        B64_CHARS[(n >> 12) & 63] +
        B64_CHARS[(n >> 6) & 63] +
        B64_CHARS[n & 63];
    }
    if (i < len) {
      const rem = len - i;
      const n = (bytes[i] << 16) | (rem === 2 ? bytes[i + 1] << 8 : 0);
      out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63];
      out += rem === 2 ? B64_CHARS[(n >> 6) & 63] + '=' : '==';
    }
    return out;
  }

  // 创建 24-bit Top-Down BMP 缓冲区（文件头只写一次，每帧直接改像素字节）
  function createBmpBuffer(w, h) {
    const rowStride = (w * 3 + 3) & ~3;
    const pixelBytes = rowStride * h;
    const fileSize = 54 + pixelBytes;
    const buf = new Uint8Array(fileSize);
    const dv = new DataView(buf.buffer);
    // 'BM'
    buf[0] = 0x42;
    buf[1] = 0x4d;
    dv.setUint32(2, fileSize, true);
    dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true);
    dv.setInt32(22, -h, true); // 负数表示 top-down，从上到下排列
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 24, true); // 24-bit BGR
    dv.setUint32(34, pixelBytes, true);
    return { buf, rowStride, headerSize: 54 };
  }

  // ==================== DOM & SVG 折射层搭建 ====================
  const uid = 'alma-water-' + Math.random().toString(36).slice(2, 8);
  const filterId = uid + '-refract';

  const rootHost = document.createElement('div');
  rootHost.id = uid + '-host';
  rootHost.style.cssText =
    'position:fixed !important;inset:0 !important;width:100vw !important;height:100vh !important;' +
    'pointer-events:none !important;z-index:2147483645 !important;overflow:hidden !important;margin:0 !important;padding:0 !important;border:0 !important;background:transparent !important;';

  // SVG 滤镜挂在主文档中以保证 Chrome backdrop-filter url(#id) 100% 识别
  const svgNS = 'http://www.w3.org/2000/svg';
  const svgEl = document.createElementNS(svgNS, 'svg');
  svgEl.setAttribute('width', '0');
  svgEl.setAttribute('height', '0');
  svgEl.setAttribute('aria-hidden', 'true');
  svgEl.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;';

  const defsEl = document.createElementNS(svgNS, 'defs');
  const filterEl = document.createElementNS(svgNS, 'filter');
  filterEl.setAttribute('id', filterId);
  filterEl.setAttribute('filterUnits', 'objectBoundingBox');
  filterEl.setAttribute('primitiveUnits', 'userSpaceOnUse');
  filterEl.setAttribute('x', '0%');
  filterEl.setAttribute('y', '0%');
  filterEl.setAttribute('width', '100%');
  filterEl.setAttribute('height', '100%');
  filterEl.setAttribute('color-interpolation-filters', 'sRGB');

  const feImageEl = document.createElementNS(svgNS, 'feImage');
  feImageEl.setAttribute('x', '0');
  feImageEl.setAttribute('y', '0');
  feImageEl.setAttribute('preserveAspectRatio', 'none');
  feImageEl.setAttribute('result', 'dispMap');

  const feDispEl = document.createElementNS(svgNS, 'feDisplacementMap');
  feDispEl.setAttribute('in', 'SourceGraphic');
  feDispEl.setAttribute('in2', 'dispMap');
  feDispEl.setAttribute('scale', '0');
  feDispEl.setAttribute('xChannelSelector', 'R');
  feDispEl.setAttribute('yChannelSelector', 'G');

  filterEl.appendChild(feImageEl);
  filterEl.appendChild(feDispEl);
  defsEl.appendChild(filterEl);
  svgEl.appendChild(defsEl);

  // 折射背景层：利用 backdrop-filter 实时扭曲下方真实网页 DOM，不破坏页面 fixed 导航栏或滚动
  const refractLayer = document.createElement('div');
  refractLayer.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;will-change:backdrop-filter;';

  // 水体底色层（超薄半透明水色）
  const tintLayer = document.createElement('div');
  tintLayer.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;transition:background-color 0.2s ease;';

  // 光学高光与焦散画布层
  const lightCanvas = document.createElement('canvas');
  lightCanvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  const lightCtx = lightCanvas.getContext('2d', { alpha: true });

  rootHost.appendChild(svgEl);
  rootHost.appendChild(refractLayer);
  rootHost.appendChild(tintLayer);
  rootHost.appendChild(lightCanvas);
  (document.documentElement || document.body).appendChild(rootHost);

  // ==================== 2D 水波物理引擎 ====================
  let simW = 0;
  let simH = 0;
  let bufCurr = new Float32Array(0);
  let bufPrev = new Float32Array(0);
  let bmpObj = null;
  let lightImgData = null;
  let isAwake = false;
  let rafId = 0;
  let filterActive = false;
  let cachedRgb = hexToRgb(cfg.waterColor);

  function applyTintAndVisibility() {
    cachedRgb = hexToRgb(cfg.waterColor);
    const paused = cfg.pauseInFullscreen && !!document.fullscreenElement;
    if (!cfg.enabled || paused) {
      rootHost.style.display = 'none';
      return;
    }
    rootHost.style.display = 'block';
    if (cfg.tintOpacity > 0.001) {
      tintLayer.style.backgroundColor = `rgba(${cachedRgb.r}, ${cachedRgb.g}, ${cachedRgb.b}, ${cfg.tintOpacity})`;
    } else {
      tintLayer.style.backgroundColor = 'transparent';
    }
  }

  function setRefractionActive(active) {
    if (active === filterActive) return;
    filterActive = active;
    if (active && cfg.refraction > 0) {
      const f = `url(#${filterId})`;
      refractLayer.style.backdropFilter = f;
      refractLayer.style.webkitBackdropFilter = f;
    } else {
      feDispEl.setAttribute('scale', '0');
      refractLayer.style.backdropFilter = 'none';
      refractLayer.style.webkitBackdropFilter = 'none';
    }
  }

  function initSimulation() {
    const vw = Math.max(window.innerWidth || 1280, 320);
    const vh = Math.max(window.innerHeight || 720, 240);
    const scale = Math.max(4, Math.min(10, Number(cfg.simScale) || 6));

    const nw = Math.max(80, Math.min(360, Math.round(vw / scale)));
    const nh = Math.max(50, Math.min(220, Math.round(vh / scale)));

    feImageEl.setAttribute('width', String(vw));
    feImageEl.setAttribute('height', String(vh));

    if (nw === simW && nh === simH && bmpObj) return;

    simW = nw;
    simH = nh;
    bufCurr = new Float32Array(simW * simH);
    bufPrev = new Float32Array(simW * simH);
    bmpObj = createBmpBuffer(simW, simH);

    // 用中性无偏移图像初始化 (R=128, G=128, B=128)
    const { buf, rowStride, headerSize } = bmpObj;
    for (let y = 0; y < simH; y++) {
      let off = headerSize + y * rowStride;
      for (let x = 0; x < simW; x++) {
        buf[off] = 128;     // B
        buf[off + 1] = 128; // G (Y 位移中性值)
        buf[off + 2] = 128; // R (X 位移中性值)
        off += 3;
      }
    }
    const initUrl = 'data:image/bmp;base64,' + uint8ToBase64(buf);
    feImageEl.setAttribute('href', initUrl);

    lightCanvas.width = simW;
    lightCanvas.height = simH;
    lightImgData = lightCtx.createImageData(simW, simH);
  }

  function clearRipples() {
    bufCurr.fill(0);
    bufPrev.fill(0);
    if (lightCtx) lightCtx.clearRect(0, 0, simW, simH);
    setRefractionActive(false);
  }

  // 在物理网格注入平滑余弦水波脉冲
  function dropAtScreen(clientX, clientY, radiusPx, strength) {
    if (!cfg.enabled) return;
    if (cfg.pauseInFullscreen && document.fullscreenElement) return;
    if (!simW || !simH) initSimulation();

    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const gx = (clientX / vw) * simW;
    const gy = (clientY / vh) * simH;
    const rGrid = Math.max(1.6, (radiusPx / vw) * simW);
    const r2 = rGrid * rGrid;

    const minX = Math.max(2, Math.floor(gx - rGrid));
    const maxX = Math.min(simW - 3, Math.ceil(gx + rGrid));
    const minY = Math.max(2, Math.floor(gy - rGrid));
    const maxY = Math.min(simH - 3, Math.ceil(gy + rGrid));

    for (let y = minY; y <= maxY; y++) {
      const dy = y - gy;
      const row = y * simW;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - gx;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2) {
          const dist = Math.sqrt(d2) / rGrid;
          // 余弦钟形凹陷 + 边缘微隆起，贴近真实手指拨水/落水物理轮廓
          const profile = Math.cos(dist * Math.PI * 0.5);
          bufPrev[row + x] -= profile * profile * strength;
        }
      }
    }
    wakeUp();
  }

  // 点击时产生带外环水花的冲击波
  function splashAtScreen(clientX, clientY, radiusPx, strength) {
    dropAtScreen(clientX, clientY, radiusPx * 0.58, strength * 1.35);
    // 外圈环状水脊
    if (!simW || !simH) return;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const gx = (clientX / vw) * simW;
    const gy = (clientY / vh) * simH;
    const rOuter = Math.max(2.5, (radiusPx / vw) * simW);
    const rInner = rOuter * 0.55;

    const minX = Math.max(2, Math.floor(gx - rOuter));
    const maxX = Math.min(simW - 3, Math.ceil(gx + rOuter));
    const minY = Math.max(2, Math.floor(gy - rOuter));
    const maxY = Math.min(simH - 3, Math.ceil(gy + rOuter));

    for (let y = minY; y <= maxY; y++) {
      const dy = y - gy;
      const row = y * simW;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - gx;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= rInner && d <= rOuter) {
          const t = (d - rInner) / (rOuter - rInner);
          bufPrev[row + x] += Math.sin(t * Math.PI) * strength * 0.48;
        }
      }
    }
    wakeUp();
  }

  function wakeUp() {
    if (!isAwake) {
      isAwake = true;
      rafId = requestAnimationFrame(stepFrame);
    }
  }

  // 光源方向（左上方斜射光，营造清透波光感）
  const lx = -0.52;
  const ly = -0.62;
  const lz = 0.587;

  function stepFrame() {
    if (!cfg.enabled || (cfg.pauseInFullscreen && document.fullscreenElement)) {
      isAwake = false;
      setRefractionActive(false);
      return;
    }

    // 自动随机落雨
    if (cfg.autoRain && Math.random() < (cfg.rainRate * 0.018)) {
      const rx = Math.random() * window.innerWidth;
      const ry = Math.random() * window.innerHeight;
      splashAtScreen(rx, ry, 18 + Math.random() * 20, 0.7 + Math.random() * 0.7);
    }

    const w = simW;
    const h = simH;
    const damp = cfg.damping;

    // 1. 求解二维阻尼波动方程（交换双缓冲）
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        // 九点各向同性拉普拉斯核，消除方形网格十字伪影，波纹正圆丝滑
        const ortho = bufPrev[i - 1] + bufPrev[i + 1] + bufPrev[i - w] + bufPrev[i + w];
        const diag = bufPrev[i - w - 1] + bufPrev[i - w + 1] + bufPrev[i + w - 1] + bufPrev[i + w + 1];
        const avg = ortho * 0.4 + diag * 0.1;
        bufCurr[i] = (avg - bufCurr[i]) * damp;
      }
    }

    // 四周 2 格平滑衰减吸收边界，确保屏幕边缘 0 位移不露黑边
    for (let x = 0; x < w; x++) {
      bufCurr[x] = 0;
      bufCurr[(h - 1) * w + x] = 0;
    }
    for (let y = 0; y < h; y++) {
      bufCurr[y * w] = 0;
      bufCurr[y * w + (w - 1)] = 0;
    }

    // 交换缓冲区：现在 bufPrev 持有最新高度场
    const tmp = bufPrev;
    bufPrev = bufCurr;
    bufCurr = tmp;

    // 2. 计算法线折射贴图 (BMP) + 水面高光与焦散画布
    const { buf: bmpBuf, rowStride, headerSize } = bmpObj;
    const pixels = lightImgData.data;
    const specGain = cfg.specular;
    const causGain = cfg.caustics;
    const wr = cachedRgb.r;
    const wg = cachedRgb.g;
    const wb = cachedRgb.b;
    const doRefract = cfg.refraction > 0.2;

    let maxEnergy = 0;

    for (let y = 0; y < h; y++) {
      const row = y * w;
      let bmpOff = headerSize + y * rowStride;

      if (y < 2 || y >= h - 2) {
        for (let x = 0; x < w; x++) {
          bmpBuf[bmpOff] = 128;
          bmpBuf[bmpOff + 1] = 128;
          bmpBuf[bmpOff + 2] = 128;
          bmpOff += 3;
          const p = (row + x) << 2;
          pixels[p + 3] = 0;
        }
        continue;
      }

      for (let x = 0; x < w; x++) {
        const i = row + x;
        const p = i << 2;

        if (x < 2 || x >= w - 2) {
          bmpBuf[bmpOff] = 128;
          bmpBuf[bmpOff + 1] = 128;
          bmpBuf[bmpOff + 2] = 128;
          bmpOff += 3;
          pixels[p + 3] = 0;
          continue;
        }

        const hc = bufPrev[i];
        const dx = (bufPrev[i - 1] - bufPrev[i + 1]) * 0.5;
        const dy = (bufPrev[i - w] - bufPrev[i + w]) * 0.5;
        const slope = Math.abs(dx) + Math.abs(dy) + Math.abs(hc) * 0.25;
        if (slope > maxEnergy) maxEnergy = slope;

        if (slope < 0.0015) {
          bmpBuf[bmpOff] = 128;
          bmpBuf[bmpOff + 1] = 128;
          bmpBuf[bmpOff + 2] = 128;
          bmpOff += 3;
          pixels[p + 3] = 0;
          continue;
        }

        // 写入位移贴图 R(X偏移), G(Y偏移), B(128)
        if (doRefract) {
          const rx = Math.max(0, Math.min(255, (128 + dx * 115) | 0));
          const ry = Math.max(0, Math.min(255, (128 + dy * 115) | 0));
          bmpBuf[bmpOff] = 128;
          bmpBuf[bmpOff + 1] = ry;
          bmpBuf[bmpOff + 2] = rx;
        }
        bmpOff += 3;

        // 计算单位法线 N = normalize(dx*2.2, dy*2.2, 1)
        const nxRaw = dx * 2.2;
        const nyRaw = dy * 2.2;
        const invLen = 1 / Math.sqrt(nxRaw * nxRaw + nyRaw * nyRaw + 1);
        const nx = nxRaw * invLen;
        const ny = nyRaw * invLen;
        const nz = invLen;

        // Blinn-Phong 高光反射（模拟清透水波迎光亮斑）
        const ndotl = nx * lx + ny * ly + nz * lz;
        let spec = 0;
        if (ndotl > 0.58 && specGain > 0) {
          const s = (ndotl - 0.58) / 0.42;
          const s2 = s * s;
          spec = s2 * s2 * specGain;
        }

        // 水底焦散（拉普拉斯曲率汇聚处产生清透亮纹）
        const lap = bufPrev[i - 1] + bufPrev[i + 1] + bufPrev[i - w] + bufPrev[i + w] - hc * 4;
        let caus = 0;
        if (lap < -0.008 && causGain > 0) {
          caus = Math.min(0.65, -lap * 1.15 * causGain);
        }

        // 背光坡面微暗影，增强立体厚度感
        let shade = 0;
        if (ndotl < 0.42) {
          shade = Math.min(0.22, (0.42 - ndotl) * 0.35);
        }

        const lightAlpha = Math.min(0.88, spec * 0.92 + caus * 0.55 + shade);
        if (lightAlpha > 0.004) {
          const brightMix = (spec + caus * 0.7) / (spec + caus * 0.7 + shade + 0.0001);
          // 亮部融合白色高光与水色微光，暗部融合深水色阴影
          const rOut = brightMix * (255 * 0.78 + wr * 0.22) + (1 - brightMix) * (wr * 0.38);
          const gOut = brightMix * (255 * 0.82 + wg * 0.18) + (1 - brightMix) * (wg * 0.42);
          const bOut = brightMix * (255 * 0.86 + wb * 0.14) + (1 - brightMix) * (wb * 0.48);

          pixels[p] = rOut | 0;
          pixels[p + 1] = gOut | 0;
          pixels[p + 2] = bOut | 0;
          pixels[p + 3] = (lightAlpha * 255) | 0;
        } else {
          pixels[p + 3] = 0;
        }
      }
    }

    lightCtx.putImageData(lightImgData, 0, 0);

    // 3. 更新 SVG 网页真实折射滤镜
    if (doRefract && maxEnergy >= 0.002) {
      setRefractionActive(true);
      // 水波将近静止时平滑收敛 scale，彻底消除静止偏移跳变
      const fade = Math.min(1, maxEnergy * 35);
      feDispEl.setAttribute('scale', (cfg.refraction * fade).toFixed(2));
      feImageEl.setAttribute('href', 'data:image/bmp;base64,' + uint8ToBase64(bmpBuf));
    } else {
      setRefractionActive(false);
    }

    // 4. 水面完全平息后自动进入 0% CPU/GPU 休眠状态
    if (maxEnergy < 0.0018 && !cfg.autoRain) {
      isAwake = false;
      clearRipples();
      updateStatusBadge(false);
      return;
    }

    updateStatusBadge(true);
    rafId = requestAnimationFrame(stepFrame);
  }

  // ==================== 鼠标与触控交互监听 ====================
  let lastX = null;
  let lastY = null;
  let lastTime = 0;

  window.addEventListener(
    'pointermove',
    (e) => {
      if (!cfg.enabled || cfg.hoverStrength <= 0) return;
      if (isEventInsidePanel(e)) return;

      const now = performance.now();
      const x = e.clientX;
      const y = e.clientY;

      if (lastX === null || now - lastTime > 140) {
        lastX = x;
        lastY = y;
        lastTime = now;
        dropAtScreen(x, y, cfg.hoverRadius, cfg.hoverStrength * 0.45);
        return;
      }

      const dx = x - lastX;
      const dy = y - lastY;
      const dist = Math.hypot(dx, dy);
      if (dist < 3) return;

      // 沿鼠标轨迹线性插值连续点水，快速甩动鼠标也能划出丝滑连续的 V 型水痕
      const stepPx = Math.max(5, cfg.hoverRadius * 0.42);
      const steps = Math.min(18, Math.ceil(dist / stepPx));
      const speedBoost = Math.min(1.55, 0.55 + dist * 0.018);
      const strength = cfg.hoverStrength * 0.48 * speedBoost;

      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        dropAtScreen(lastX + dx * t, lastY + dy * t, cfg.hoverRadius, strength);
      }

      lastX = x;
      lastY = y;
      lastTime = now;
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!cfg.enabled || cfg.clickStrength <= 0) return;
      if (isEventInsidePanel(e)) return;
      splashAtScreen(e.clientX, e.clientY, cfg.clickRadius, cfg.clickStrength);
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    'resize',
    () => {
      initSimulation();
    },
    { passive: true }
  );

  document.addEventListener('fullscreenchange', () => {
    applyTintAndVisibility();
    if (cfg.enabled && cfg.autoRain) wakeUp();
  });

  // ==================== Shadow DOM 可视化参数设置面板 ====================
  let panelHost = null;
  let panelShadow = null;
  let panelVisible = false;
  let statusDotEl = null;
  let statusTextEl = null;

  function isEventInsidePanel(e) {
    if (!panelVisible || !panelHost) return false;
    const path = e.composedPath ? e.composedPath() : [];
    return path.includes(panelHost);
  }

  function updateStatusBadge(active) {
    if (!statusDotEl || !statusTextEl) return;
    if (!cfg.enabled) {
      statusDotEl.style.background = '#94a3b8';
      statusTextEl.textContent = '已关闭';
    } else if (active) {
      statusDotEl.style.background = '#38bdf8';
      statusTextEl.textContent = '水波荡漾中 (60fps)';
    } else {
      statusDotEl.style.background = '#22c55e';
      statusTextEl.textContent = '水面平静 · 零耗电休眠';
    }
  }

  function buildSettingsPanel() {
    if (panelHost) return;

    panelHost = document.createElement('div');
    panelHost.id = uid + '-panel-host';
    panelHost.style.cssText =
      'position:fixed !important;top:20px !important;right:20px !important;z-index:2147483647 !important;display:none;';
    panelShadow = panelHost.attachShadow({ mode: 'open' });

    const quickColors = ['#38bdf8', '#06b6d4', '#10b981', '#818cf8', '#f472b6', '#f59e0b', '#ffffff'];

    panelShadow.innerHTML = `
      <style>
        :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
        .panel {
          width: 330px;
          max-height: calc(100vh - 40px);
          display: flex;
          flex-direction: column;
          background: rgba(15, 23, 42, 0.86);
          backdrop-filter: blur(18px) saturate(160%);
          -webkit-backdrop-filter: blur(18px) saturate(160%);
          color: #f1f5f9;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 16px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.12);
          overflow: hidden;
          user-select: none;
          font-size: 13px;
        }
        .header {
          padding: 13px 16px;
          background: rgba(30, 41, 59, 0.7);
          border-bottom: 1px solid rgba(148, 163, 184, 0.16);
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: move;
        }
        .title-wrap { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; color: #e0f2fe; }
        .close-btn {
          background: rgba(255,255,255,0.08); border: none; color: #cbd5e1;
          width: 26px; height: 26px; border-radius: 8px; cursor: pointer; font-size: 15px;
          display: flex; align-items: center; justify-content: center; transition: 0.15s;
        }
        .close-btn:hover { background: rgba(239, 68, 68, 0.8); color: #fff; }
        .body {
          padding: 14px 16px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .body::-webkit-scrollbar { width: 5px; }
        .body::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.35); border-radius: 4px; }
        .section-title {
          font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
          color: #7dd3fc; text-transform: uppercase; margin-bottom: 6px;
        }
        .presets { display: flex; flex-wrap: wrap; gap: 6px; }
        .preset-btn {
          padding: 5px 10px; border-radius: 999px; border: 1px solid rgba(148, 163, 184, 0.25);
          background: rgba(30, 41, 59, 0.75); color: #e2e8f0; font-size: 12px; cursor: pointer; transition: 0.15s;
        }
        .preset-btn:hover { border-color: #38bdf8; color: #fff; background: rgba(56, 189, 248, 0.22); }
        .row { display: flex; flex-direction: column; gap: 5px; margin-bottom: 8px; }
        .row:last-child { margin-bottom: 0; }
        .row-head { display: flex; justify-content: space-between; align-items: center; color: #cbd5e1; font-size: 12.5px; }
        .val { color: #38bdf8; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 12px; }
        input[type="range"] {
          -webkit-appearance: none; appearance: none; width: 100%; height: 5px;
          background: rgba(148, 163, 184, 0.25); border-radius: 999px; outline: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 15px; height: 15px; border-radius: 50%;
          background: #38bdf8; box-shadow: 0 0 8px rgba(56, 189, 248, 0.65); cursor: pointer;
        }
        .switch-row {
          display: flex; justify-content: space-between; align-items: center;
          padding: 4px 0; color: #e2e8f0; font-size: 12.5px;
        }
        input[type="checkbox"] { accent-color: #38bdf8; width: 16px; height: 16px; cursor: pointer; }
        .color-bar { display: flex; align-items: center; gap: 7px; margin-top: 4px; }
        input[type="color"] {
          width: 30px; height: 26px; border: none; padding: 0; background: none; cursor: pointer; border-radius: 6px;
        }
        .swatch {
          width: 20px; height: 20px; border-radius: 50%; cursor: pointer;
          border: 2px solid rgba(255,255,255,0.25); transition: transform 0.15s;
        }
        .swatch:hover { transform: scale(1.18); border-color: #fff; }
        .footer {
          padding: 10px 16px;
          background: rgba(15, 23, 42, 0.9);
          border-top: 1px solid rgba(148, 163, 184, 0.16);
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
        }
        .status { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #94a3b8; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
        .actions { display: flex; gap: 6px; }
        .act-btn {
          padding: 5px 9px; border-radius: 7px; border: 1px solid rgba(148, 163, 184, 0.25);
          background: rgba(51, 65, 85, 0.6); color: #e2e8f0; font-size: 11.5px; cursor: pointer;
        }
        .act-btn:hover { background: rgba(71, 85, 105, 0.9); color: #fff; }
        .hint { font-size: 11px; color: #64748b; text-align: center; padding-bottom: 4px; }
      </style>
      <div class="panel" id="panel-box">
        <div class="header" id="drag-handle">
          <div class="title-wrap">💧 水面波纹与折射设置</div>
          <button class="close-btn" id="btn-close" title="关闭面板 (Alt+W)">✕</button>
        </div>
        <div class="body">
          <div>
            <div class="switch-row">
              <span><strong>启用全域水面覆盖</strong> (Alt+Shift+W)</span>
              <input type="checkbox" id="inp-enabled">
            </div>
            <div class="switch-row">
              <span>全屏看视频时自动暂停</span>
              <input type="checkbox" id="inp-fullscreen">
            </div>
          </div>

          <div>
            <div class="section-title">一键风格预设</div>
            <div class="presets" id="preset-list"></div>
          </div>

          <div>
            <div class="section-title">水体颜色与光学质感</div>
            <div class="row">
              <div class="row-head"><span>水的颜色</span><span class="val" id="val-waterColor"></span></div>
              <div class="color-bar">
                <input type="color" id="inp-waterColor">
                ${quickColors.map(c => `<div class="swatch" data-color="${c}" style="background:${c}" title="${c}"></div>`).join('')}
              </div>
            </div>
            <div class="row">
              <div class="row-head"><span>水色浓度 (透明度)</span><span class="val" id="val-tintOpacity"></span></div>
              <input type="range" id="inp-tintOpacity" min="0" max="0.40" step="0.01">
            </div>
            <div class="row">
              <div class="row-head"><span>网页折射畸变强度</span><span class="val" id="val-refraction"></span></div>
              <input type="range" id="inp-refraction" min="0" max="80" step="1">
            </div>
            <div class="row">
              <div class="row-head"><span>波峰高光亮度</span><span class="val" id="val-specular"></span></div>
              <input type="range" id="inp-specular" min="0" max="2.5" step="0.05">
            </div>
            <div class="row">
              <div class="row-head"><span>水底焦散光斑</span><span class="val" id="val-caustics"></span></div>
              <input type="range" id="inp-caustics" min="0" max="1.8" step="0.05">
            </div>
          </div>

          <div>
            <div class="section-title">鼠标影响范围与物理波动</div>
            <div class="row">
              <div class="row-head"><span>鼠标划过影响范围</span><span class="val" id="val-hoverRadius"></span></div>
              <input type="range" id="inp-hoverRadius" min="6" max="80" step="1">
            </div>
            <div class="row">
              <div class="row-head"><span>鼠标划过推水力度</span><span class="val" id="val-hoverStrength"></span></div>
              <input type="range" id="inp-hoverStrength" min="0" max="2.2" step="0.05">
            </div>
            <div class="row">
              <div class="row-head"><span>点击水花扩散范围</span><span class="val" id="val-clickRadius"></span></div>
              <input type="range" id="inp-clickRadius" min="15" max="130" step="1">
            </div>
            <div class="row">
              <div class="row-head"><span>点击水花冲击力度</span><span class="val" id="val-clickStrength"></span></div>
              <input type="range" id="inp-clickStrength" min="0" max="3.5" step="0.05">
            </div>
            <div class="row">
              <div class="row-head"><span>水波延续时间 (阻尼)</span><span class="val" id="val-damping"></span></div>
              <input type="range" id="inp-damping" min="0.91" max="0.992" step="0.002">
            </div>
          </div>

          <div>
            <div class="section-title">环境微雨氛围</div>
            <div class="switch-row">
              <span>自动随机雨滴涟漪</span>
              <input type="checkbox" id="inp-autoRain">
            </div>
            <div class="row">
              <div class="row-head"><span>落雨密集度</span><span class="val" id="val-rainRate"></span></div>
              <input type="range" id="inp-rainRate" min="0.2" max="6.0" step="0.2">
            </div>
          </div>
          <div class="hint">快捷键：Alt + W 打开/收起面板 ｜ Alt + Shift + W 开关水面</div>
        </div>
        <div class="footer">
          <div class="status"><span class="dot" id="st-dot"></span><span id="st-text">就绪</span></div>
          <div class="actions">
            <button class="act-btn" id="btn-calm">平息水面</button>
            <button class="act-btn" id="btn-reset">恢复默认</button>
          </div>
        </div>
      </div>
    `;

    (document.documentElement || document.body).appendChild(panelHost);

    statusDotEl = panelShadow.getElementById('st-dot');
    statusTextEl = panelShadow.getElementById('st-text');

    // 渲染预设按钮
    const presetList = panelShadow.getElementById('preset-list');
    Object.keys(PRESETS).forEach((key) => {
      const btn = document.createElement('button');
      btn.className = 'preset-btn';
      btn.textContent = PRESETS[key].name;
      btn.addEventListener('click', () => {
        Object.assign(cfg, PRESETS[key]);
        saveConfig(cfg);
        syncPanelInputs();
        applyTintAndVisibility();
        splashAtScreen(window.innerWidth * 0.5, window.innerHeight * 0.5, cfg.clickRadius * 1.2, cfg.clickStrength);
      });
      presetList.appendChild(btn);
    });

    // 绑定所有滑块与开关
    const rangeFields = [
      ['tintOpacity', v => Math.round(v * 100) + '%'],
      ['refraction', v => v + ' px'],
      ['specular', v => Number(v).toFixed(2) + 'x'],
      ['caustics', v => Number(v).toFixed(2) + 'x'],
      ['hoverRadius', v => v + ' px'],
      ['hoverStrength', v => Number(v).toFixed(2)],
      ['clickRadius', v => v + ' px'],
      ['clickStrength', v => Number(v).toFixed(2)],
      ['damping', v => Number(v).toFixed(3)],
      ['rainRate', v => Number(v).toFixed(1) + '/s']
    ];

    rangeFields.forEach(([field, fmt]) => {
      const inp = panelShadow.getElementById('inp-' + field);
      const val = panelShadow.getElementById('val-' + field);
      inp.addEventListener('input', () => {
        cfg[field] = parseFloat(inp.value);
        val.textContent = fmt(cfg[field]);
        saveConfig(cfg);
        if (field === 'tintOpacity') applyTintAndVisibility();
        if (field === 'refraction' && cfg.refraction <= 0.2) setRefractionActive(false);
        wakeUp();
      });
    });

    const colorInp = panelShadow.getElementById('inp-waterColor');
    const colorVal = panelShadow.getElementById('val-waterColor');
    colorInp.addEventListener('input', () => {
      cfg.waterColor = colorInp.value;
      colorVal.textContent = cfg.waterColor.toUpperCase();
      saveConfig(cfg);
      applyTintAndVisibility();
      wakeUp();
    });

    panelShadow.querySelectorAll('.swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        cfg.waterColor = sw.getAttribute('data-color');
        saveConfig(cfg);
        syncPanelInputs();
        applyTintAndVisibility();
        wakeUp();
      });
    });

    const chkEnabled = panelShadow.getElementById('inp-enabled');
    chkEnabled.addEventListener('change', () => {
      cfg.enabled = chkEnabled.checked;
      saveConfig(cfg);
      applyTintAndVisibility();
      if (!cfg.enabled) clearRipples();
      else wakeUp();
      updateStatusBadge(isAwake);
    });

    const chkFs = panelShadow.getElementById('inp-fullscreen');
    chkFs.addEventListener('change', () => {
      cfg.pauseInFullscreen = chkFs.checked;
      saveConfig(cfg);
      applyTintAndVisibility();
    });

    const chkRain = panelShadow.getElementById('inp-autoRain');
    chkRain.addEventListener('change', () => {
      cfg.autoRain = chkRain.checked;
      saveConfig(cfg);
      if (cfg.autoRain) wakeUp();
    });

    panelShadow.getElementById('btn-close').addEventListener('click', () => togglePanel(false));
    panelShadow.getElementById('btn-calm').addEventListener('click', () => clearRipples());
    panelShadow.getElementById('btn-reset').addEventListener('click', () => {
      Object.assign(cfg, DEFAULT_CONFIG);
      saveConfig(cfg);
      syncPanelInputs();
      applyTintAndVisibility();
      splashAtScreen(window.innerWidth * 0.5, window.innerHeight * 0.5, cfg.clickRadius, cfg.clickStrength);
    });

    // 支持拖拽面板标题栏移动位置
    const handle = panelShadow.getElementById('drag-handle');
    let dragging = false;
    let startX = 0, startY = 0, origRight = 20, origTop = 20;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.id === 'btn-close') return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panelHost.getBoundingClientRect();
      origRight = window.innerWidth - rect.right;
      origTop = rect.top;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const nr = Math.max(8, Math.min(window.innerWidth - 340, origRight - (e.clientX - startX)));
      const nt = Math.max(8, Math.min(window.innerHeight - 80, origTop + (e.clientY - startY)));
      panelHost.style.right = nr + 'px';
      panelHost.style.top = nt + 'px';
    });
    handle.addEventListener('pointerup', () => { dragging = false; });

    syncPanelInputs();
    updateStatusBadge(isAwake);
  }

  function syncPanelInputs() {
    if (!panelShadow) return;
    panelShadow.getElementById('inp-enabled').checked = !!cfg.enabled;
    panelShadow.getElementById('inp-fullscreen').checked = !!cfg.pauseInFullscreen;
    panelShadow.getElementById('inp-autoRain').checked = !!cfg.autoRain;

    panelShadow.getElementById('inp-waterColor').value = cfg.waterColor;
    panelShadow.getElementById('val-waterColor').textContent = cfg.waterColor.toUpperCase();

    const map = {
      tintOpacity: Math.round(cfg.tintOpacity * 100) + '%',
      refraction: cfg.refraction + ' px',
      specular: Number(cfg.specular).toFixed(2) + 'x',
      caustics: Number(cfg.caustics).toFixed(2) + 'x',
      hoverRadius: cfg.hoverRadius + ' px',
      hoverStrength: Number(cfg.hoverStrength).toFixed(2),
      clickRadius: cfg.clickRadius + ' px',
      clickStrength: Number(cfg.clickStrength).toFixed(2),
      damping: Number(cfg.damping).toFixed(3),
      rainRate: Number(cfg.rainRate).toFixed(1) + '/s'
    };

    Object.keys(map).forEach((k) => {
      const inp = panelShadow.getElementById('inp-' + k);
      const val = panelShadow.getElementById('val-' + k);
      if (inp) inp.value = cfg[k];
      if (val) val.textContent = map[k];
    });
  }

  function togglePanel(force) {
    buildSettingsPanel();
    panelVisible = typeof force === 'boolean' ? force : !panelVisible;
    panelHost.style.display = panelVisible ? 'block' : 'none';
    if (panelVisible) syncPanelInputs();
  }

  // 注册油猴扩展菜单命令
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('💧 打开/关闭水面参数设置 (Alt+W)', () => togglePanel());
    GM_registerMenuCommand('🌊 开启/暂停水面效果 (Alt+Shift+W)', () => {
      cfg.enabled = !cfg.enabled;
      saveConfig(cfg);
      applyTintAndVisibility();
      if (!cfg.enabled) clearRipples();
      else wakeUp();
      syncPanelInputs();
    });
  }

  // 全局快捷键：Alt+W 打开设置，Alt+Shift+W 快速开关水面
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyW') {
      e.preventDefault();
      if (e.shiftKey) {
        cfg.enabled = !cfg.enabled;
        saveConfig(cfg);
        applyTintAndVisibility();
        if (!cfg.enabled) clearRipples();
        else wakeUp();
        syncPanelInputs();
      } else {
        togglePanel();
      }
    }
  });

  // 暴露调试/演示接口方便外部唤起设置面板
  window.__ALMA_WATER_API__ = {
    openSettings: () => togglePanel(true),
    toggleSettings: () => togglePanel(),
    splash: splashAtScreen,
    getConfig: () => cfg
  };

  // 启动！
  initSimulation();
  applyTintAndVisibility();
  if (cfg.enabled && cfg.autoRain) wakeUp();
})();
