// ==UserScript==
// @name         真实水面透镜波纹特效 - 局部放大缩小版 (Water Lens & Ripple Surface)
// @namespace    https://scriptcat.org/
// @version      4.0.0
// @description  专为 ScriptCat / Tampermonkey 优化：100%全透明水面，仅在鼠标中心周围小范围产生【水波凸透镜慢慢放大 → 凹透镜缩小 → 恢复正常】的真实光学透视变化，越往外影响越小，绝不干扰全屏阅读。支持右下角💧面板与 Alt+W 快捷键。
// @author       Gemini
// @match        *://*/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // 避免在嵌套 iframe 中重复运行
    if (window.top !== window.self) return;
    const oldRoot = document.getElementById('tm-water-surface-root');
    if (oldRoot) oldRoot.remove();
    const oldPanel = document.getElementById('tm-water-ctrl-host');
    if (oldPanel) oldPanel.remove();

    // ==================== 三档预设与默认参数 ====================
    const PRESETS = {
        lens: {
            name: '🔍 局部水透镜 (默认推荐)',
            radiusPx: 85,                // 影响半径 (像素)：仅在鼠标周围 85px 小圈内生效，外部 100% 不动
            zoomStrength: 22,            // 中心放大/缩小透视强度 (中心变化大，向外平滑衰减为0)
            rippleRingRatio: 0.28,       // 伴随透镜缩放的细腻水波环比例
            cycleDuration: 0.95,         // 慢慢变大 → 再缩小 → 恢复正常 的完整周期时长 (秒)
            clickBoost: 1.45,            // 点击时的水滴透镜增强倍数
            specularIntensity: 0.32,     // 波峰边缘极淡晶莹高光 (0 为纯折射无高光)
            chromaticDispersion: false   // 关闭色散重影，保持文字清晰
        },
        gentle: {
            name: '💎 微距轻柔 (极小范围)',
            radiusPx: 62,
            zoomStrength: 15,
            rippleRingRatio: 0.18,
            cycleDuration: 0.80,
            clickBoost: 1.35,
            specularIntensity: 0.18,
            chromaticDispersion: false
        },
        vivid: {
            name: '🌊 灵动水珠 (明显缩放)',
            radiusPx: 115,
            zoomStrength: 32,
            rippleRingRatio: 0.42,
            cycleDuration: 1.15,
            clickBoost: 1.65,
            specularIntensity: 0.50,
            chromaticDispersion: true
        }
    };

    const DEFAULT_CONFIG = Object.assign({
        enabled: true,
        preset: 'lens',
        renderMode: 'backdrop',      // 'backdrop' (视口折射层) | 'dom' (全局DOM滤镜，兼容模式)
        readingGuard: true,          // 静止时自动解除滤镜，保持 100% 原生清晰度
        soundEnabled: false,
        panelMinimized: false        // 首次安装默认展开面板，方便立即确认与调节
    }, PRESETS.lens);

    const STORAGE_KEY = 'tm_water_lens_cfg_v4';

    function loadConfig() {
        try {
            if (typeof GM_getValue === 'function') {
                const saved = GM_getValue(STORAGE_KEY, null);
                if (saved) {
                    return Object.assign({}, DEFAULT_CONFIG, typeof saved === 'string' ? JSON.parse(saved) : saved);
                }
            }
            const local = localStorage.getItem(STORAGE_KEY);
            if (local) return Object.assign({}, DEFAULT_CONFIG, JSON.parse(local));
        } catch (e) {
            // 忽略存储读取异常
        }
        return Object.assign({}, DEFAULT_CONFIG);
    }

    function saveConfig(cfg) {
        try {
            const serialized = JSON.stringify(cfg);
            if (typeof GM_setValue === 'function') {
                GM_setValue(STORAGE_KEY, serialized);
            }
            localStorage.setItem(STORAGE_KEY, serialized);
        } catch (e) {
            // 忽略存储写入异常
        }
    }

    const config = loadConfig();

    // ==================== 局部水波透镜算子队列 ====================
    // 每个算子代表鼠标划过或点击处的一团局部水体，经历：凸起放大(慢慢变大) -> 凹陷缩小(再缩小) -> 平复(恢复正常)
    const MAX_NODES = 36;
    const waterNodes = [];

    let simWidth = 240;
    let simHeight = 150;
    let isWaterActive = false;
    let idleFrames = 0;

    // 离屏位移贴图画布 (R通道=X偏移, G通道=Y偏移, 128=完全静止不偏移)
    const dispCanvas = document.createElement('canvas');
    const dispCtx = dispCanvas.getContext('2d', { willReadFrequently: true });
    let dispImageData = null;

    // 离屏波峰晶莹高光画布 (全透明底 Alpha=0)
    const lightCanvas = document.createElement('canvas');
    const lightCtx = lightCanvas.getContext('2d');
    let lightImageData = null;

    // 累加缓冲数组 (仅计算活跃节点包围盒，极速高效)
    let accumDx = new Float32Array(simWidth * simHeight);
    let accumDy = new Float32Array(simWidth * simHeight);

    function syncSimulationSizes() {
        const vw = Math.max(1, window.innerWidth);
        const vh = Math.max(1, window.innerHeight);
        const aspect = Math.max(0.4, Math.min(3.0, vw / vh));
        simHeight = 156;
        simWidth = Math.round(simHeight * aspect);
        if (simWidth % 2 !== 0) simWidth += 1;

        dispCanvas.width = simWidth;
        dispCanvas.height = simHeight;
        dispImageData = dispCtx.createImageData(simWidth, simHeight);
        const d = dispImageData.data;
        for (let i = 0; i < d.length; i += 4) {
            d[i] = 128;
            d[i + 1] = 128;
            d[i + 2] = 128;
            d[i + 3] = 255;
        }
        dispCtx.putImageData(dispImageData, 0, 0);

        lightCanvas.width = simWidth;
        lightCanvas.height = simHeight;
        lightImageData = lightCtx.createImageData(simWidth, simHeight);
        lightCtx.clearRect(0, 0, simWidth, simHeight);

        accumDx = new Float32Array(simWidth * simHeight);
        accumDy = new Float32Array(simWidth * simHeight);
    }

    syncSimulationSizes();

    // ==================== Web Audio API 轻柔水滴音效 ====================
    let audioCtx = null;
    function playWaterSound(intensity = 1.0, isClick = false) {
        if (!config.soundEnabled) return;
        try {
            if (!audioCtx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                audioCtx = new AudioCtx();
            }
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';

            const f0 = isClick ? 300 + Math.random() * 140 : 480 + Math.random() * 220;
            const f1 = f0 * (isClick ? 2.1 : 1.6);
            const dur = isClick ? 0.13 : 0.07;

            osc.frequency.setValueAtTime(f0, now);
            osc.frequency.exponentialRampToValueAtTime(f1, now + dur);

            const vol = Math.min(0.08, Math.max(0.01, intensity * (isClick ? 0.055 : 0.02)));
            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(vol, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + dur + 0.01);
        } catch (e) {
            // 忽略音频限制
        }
    }

    // ==================== 构建 SVG 局部透镜折射滤镜与视口层 ====================
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const XLINK_NS = 'http://www.w3.org/1999/xlink';

    const rootContainer = document.createElement('div');
    rootContainer.id = 'tm-water-surface-root';
    rootContainer.style.cssText = [
        'position: fixed',
        'inset: 0',
        'width: 100vw',
        'height: 100vh',
        'pointer-events: none',
        'z-index: 2147483640',
        'overflow: hidden',
        'margin: 0',
        'padding: 0',
        'border: none',
        'background: transparent'
    ].join(';');

    const refractionLayer = document.createElement('div');
    refractionLayer.id = 'tm-water-refraction-layer';
    refractionLayer.style.cssText = [
        'position: absolute',
        'inset: 0',
        'width: 100%',
        'height: 100%',
        'pointer-events: none',
        'background: transparent'
    ].join(';');

    lightCanvas.id = 'tm-water-light-canvas';
    lightCanvas.style.cssText = [
        'position: absolute',
        'inset: 0',
        'width: 100%',
        'height: 100%',
        'pointer-events: none',
        'background: transparent',
        'mix-blend-mode: screen'
    ].join(';');

    const svgEl = document.createElementNS(SVG_NS, 'svg');
    svgEl.setAttribute('id', 'tm-water-svg-defs');
    svgEl.setAttribute('width', '0');
    svgEl.setAttribute('height', '0');
    svgEl.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;overflow:hidden;';

    function buildSvgFilterMarkup() {
        const vw = Math.max(1, window.innerWidth);
        const vh = Math.max(1, window.innerHeight);
        // SVG 位移最大尺度固定为可覆盖局部放大/缩小的像素范围
        const maxScale = Math.max(8, Math.round(config.zoomStrength * 2.2));
        const scaleR = config.chromaticDispersion ? +(maxScale * 0.93).toFixed(2) : maxScale;
        const scaleB = config.chromaticDispersion ? +(maxScale * 1.07).toFixed(2) : maxScale;

        svgEl.innerHTML = `
            <defs>
                <filter id="tm-water-filter" x="0%" y="0%" width="100%" height="100%"
                        filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse"
                        color-interpolation-filters="sRGB">
                    <feImage id="tm-water-feimage" x="0" y="0" width="${vw}" height="${vh}"
                             preserveAspectRatio="none" result="lensMap" />
                    ${config.chromaticDispersion ? `
                        <feDisplacementMap in="SourceGraphic" in2="lensMap"
                                           scale="${scaleR}" xChannelSelector="R" yChannelSelector="G" result="dispR" />
                        <feColorMatrix in="dispR" type="matrix"
                                       values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chanR" />

                        <feDisplacementMap in="SourceGraphic" in2="lensMap"
                                           scale="${maxScale}" xChannelSelector="R" yChannelSelector="G" result="dispG" />
                        <feColorMatrix in="dispG" type="matrix"
                                       values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chanG" />

                        <feDisplacementMap in="SourceGraphic" in2="lensMap"
                                           scale="${scaleB}" xChannelSelector="R" yChannelSelector="G" result="dispB" />
                        <feColorMatrix in="dispB" type="matrix"
                                       values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="chanB" />

                        <feComposite in="chanR" in2="chanG" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg" />
                        <feComposite in="rg" in2="chanB" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="finalOut" />
                    ` : `
                        <feDisplacementMap id="tm-disp-main" in="SourceGraphic" in2="lensMap"
                                           scale="${maxScale}" xChannelSelector="R" yChannelSelector="G" result="finalOut" />
                    `}
                </filter>
            </defs>
        `;
    }

    buildSvgFilterMarkup();

    rootContainer.appendChild(svgEl);
    rootContainer.appendChild(refractionLayer);
    rootContainer.appendChild(lightCanvas);
    (document.body || document.documentElement).appendChild(rootContainer);

    const globalStyle = document.createElement('style');
    globalStyle.textContent = `
        html.tm-water-dom-mode > body {
            filter: url(#tm-water-filter) !important;
        }
    `;
    (document.head || document.documentElement).appendChild(globalStyle);

    function setFilterActiveState(active) {
        if (!config.enabled) {
            rootContainer.style.display = 'none';
            refractionLayer.style.backdropFilter = 'none';
            refractionLayer.style.webkitBackdropFilter = 'none';
            document.documentElement.classList.remove('tm-water-dom-mode');
            return;
        }
        rootContainer.style.display = 'block';

        const shouldEngage = active || !config.readingGuard;
        if (!shouldEngage) {
            refractionLayer.style.backdropFilter = 'none';
            refractionLayer.style.webkitBackdropFilter = 'none';
            document.documentElement.classList.remove('tm-water-dom-mode');
            return;
        }

        if (config.renderMode === 'backdrop') {
            document.documentElement.classList.remove('tm-water-dom-mode');
            if (refractionLayer.style.backdropFilter !== 'url(#tm-water-filter)') {
                refractionLayer.style.backdropFilter = 'url(#tm-water-filter)';
                refractionLayer.style.webkitBackdropFilter = 'url(#tm-water-filter)';
            }
        } else {
            refractionLayer.style.backdropFilter = 'none';
            refractionLayer.style.webkitBackdropFilter = 'none';
            document.documentElement.classList.add('tm-water-dom-mode');
        }
    }

    setFilterActiveState(false);

    // ==================== 添加局部水波透镜节点 ====================
    function spawnWaterLensNode(clientX, clientY, strengthMult = 1.0, radiusMult = 1.0, durationMult = 1.0) {
        if (!config.enabled) return;
        const vw = Math.max(1, window.innerWidth);
        const vh = Math.max(1, window.innerHeight);

        const gx = (clientX / vw) * simWidth;
        const gy = (clientY / vh) * simHeight;
        // 将屏幕像素半径换算为物理网格半径
        const gridRadiusX = Math.max(3, (config.radiusPx * radiusMult / vw) * simWidth);
        const gridRadiusY = Math.max(3, (config.radiusPx * radiusMult / vh) * simHeight);

        if (waterNodes.length >= MAX_NODES) {
            waterNodes.shift();
        }

        waterNodes.push({
            gx,
            gy,
            rx: gridRadiusX,
            ry: gridRadiusY,
            strength: strengthMult,
            born: performance.now(),
            durationMs: Math.max(350, config.cycleDuration * durationMult * 1000)
        });

        idleFrames = 0;
        if (!isWaterActive) {
            isWaterActive = true;
            setFilterActiveState(true);
        }
    }

    // 鼠标移动：按固定空间步长生成局部水波透镜，中心放大 -> 缩小 -> 恢复正常
    let lastSpawnX = null;
    let lastSpawnY = null;
    let lastSoundTime = 0;

    window.addEventListener('mousemove', (e) => {
        if (!config.enabled) return;
        // 鼠标在控制面板上移动时不触发水波
        if (e.target && e.target.id === 'tm-water-ctrl-host') return;

        const cx = e.clientX;
        const cy = e.clientY;

        if (lastSpawnX === null || lastSpawnY === null) {
            lastSpawnX = cx;
            lastSpawnY = cy;
            spawnWaterLensNode(cx, cy, 0.75, 0.9, 0.9);
            return;
        }

        const dx = cx - lastSpawnX;
        const dy = cy - lastSpawnY;
        const dist = Math.hypot(dx, dy);

        // 移动距离超过 12px 才生成新透镜节点，防止原地微动叠加过度
        const minStep = 12;
        if (dist < minStep) return;

        const speedFactor = Math.min(1.35, 0.65 + dist / 90);
        const steps = Math.min(5, Math.max(1, Math.floor(dist / 18)));

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const ix = lastSpawnX + dx * t;
            const iy = lastSpawnY + dy * t;
            spawnWaterLensNode(ix, iy, speedFactor / Math.sqrt(steps), 1.0, 1.0);
        }

        if (dist > 42) {
            const now = performance.now();
            if (now - lastSoundTime > 110) {
                playWaterSound(speedFactor * 0.5, false);
                lastSoundTime = now;
            }
        }

        lastSpawnX = cx;
        lastSpawnY = cy;
    }, { passive: true });

    // 鼠标点击：在点击中心产生更饱满的【慢慢放大 -> 缩小 -> 恢复正常】水滴透镜效果
    window.addEventListener('mousedown', (e) => {
        if (!config.enabled) return;
        if (e.target && e.target.id === 'tm-water-ctrl-host') return;

        spawnWaterLensNode(
            e.clientX,
            e.clientY,
            config.clickBoost,
            1.22,
            1.20
        );
        playWaterSound(1.0, true);
    }, { passive: true });

    window.addEventListener('resize', () => {
        syncSimulationSizes();
        buildSvgFilterMarkup();
        setFilterActiveState(isWaterActive);
    }, { passive: true });

    // ==================== 核心光学透镜解算与渲染循环 ====================
    let isEncodingDisp = false;
    const preloaderImg = new Image();

    function updateSvgDisplacementMap() {
        if (isEncodingDisp) return;
        isEncodingDisp = true;
        const dataUrl = dispCanvas.toDataURL('image/png');
        preloaderImg.onload = () => {
            const feImg = document.getElementById('tm-water-feimage');
            if (feImg) {
                feImg.setAttribute('href', dataUrl);
                feImg.setAttributeNS(XLINK_NS, 'xlink:href', dataUrl);
            }
            isEncodingDisp = false;
        };
        preloaderImg.onerror = () => {
            isEncodingDisp = false;
        };
        preloaderImg.src = dataUrl;
    }

    function renderWaterLensFrame(now) {
        if (!config.enabled) {
            requestAnimationFrame(renderWaterLensFrame);
            return;
        }

        if (!isWaterActive && waterNodes.length === 0) {
            requestAnimationFrame(renderWaterLensFrame);
            return;
        }

        const w = simWidth;
        const h = simHeight;
        accumDx.fill(0);
        accumDy.fill(0);

        let minDirtyX = w - 1;
        let maxDirtyX = 0;
        let minDirtyY = h - 1;
        let maxDirtyY = 0;

        const ringRatio = config.rippleRingRatio;

        // 遍历所有活跃的局部水透镜节点
        for (let i = waterNodes.length - 1; i >= 0; i--) {
            const node = waterNodes[i];
            const ageMs = now - node.born;
            if (ageMs >= node.durationMs) {
                waterNodes.splice(i, 1);
                continue;
            }

            // 归一化生命周期 t ∈ [0, 1]
            const t = ageMs / node.durationMs;

            // 核心时间曲线 S(t) = sin(2πt) * (1 - t)^1.55
            // 阶段 1 (t = 0 ~ 0.50): S(t) > 0 缓慢上升再回落 -> 水面凸起，下方页面元素【慢慢变大】
            // 阶段 2 (t = 0.50 ~ 0.85): S(t) < 0 凹陷回弹 -> 水面凹陷，下方页面元素【再缩小】
            // 阶段 3 (t = 0.85 ~ 1.00): S(t) -> 0 平滑衰减归零 -> 下方页面元素【恢复到正常】
            const zoomEnvelope = Math.sin(t * Math.PI * 2.0) * Math.pow(1 - t, 1.55) * node.strength;

            const rx = node.rx;
            const ry = node.ry;
            const invRx = 1 / rx;
            const invRy = 1 / ry;

            const x0 = Math.max(1, Math.floor(node.gx - rx));
            const x1 = Math.min(w - 2, Math.ceil(node.gx + rx));
            const y0 = Math.max(1, Math.floor(node.gy - ry));
            const y1 = Math.min(h - 2, Math.ceil(node.gy + ry));

            if (x0 < minDirtyX) minDirtyX = x0;
            if (x1 > maxDirtyX) maxDirtyX = x1;
            if (y0 < minDirtyY) minDirtyY = y0;
            if (y1 > maxDirtyY) maxDirtyY = y1;

            for (let y = y0; y <= y1; y++) {
                const dyNorm = (y - node.gy) * invRy;
                const dySq = dyNorm * dyNorm;
                const rowOffset = y * w;

                for (let x = x0; x <= x1; x++) {
                    const dxNorm = (x - node.gx) * invRx;
                    const uSq = dxNorm * dxNorm + dySq;
                    if (uSq >= 1.0) continue;

                    const u = Math.sqrt(uSq);
                    // 空间径向衰减曲线 (1 - u^2)^3：
                    // 鼠标中心 (u=0) 曲率与放大/缩小变化最大，越往外影响越小，到达半径边界 (u=1) 精确衰减为 0
                    const oneMinusUSq = 1.0 - uSq;
                    const radialFalloff = oneMinusUSq * oneMinusUSq * oneMinusUSq;

                    // 1. 径向凸/凹透镜缩放分量：
                    // 当 zoomEnvelope > 0 时，位移指向圆心 (-dxNorm, -dyNorm)，feDisplacementMap 采样圆心附近像素实现【中心放大】
                    // 当 zoomEnvelope < 0 时，位移背离圆心 (+dxNorm, +dyNorm)，feDisplacementMap 采样外围像素实现【中心缩小】
                    let dispX = -dxNorm * radialFalloff * zoomEnvelope * 95;
                    let dispY = -dyNorm * radialFalloff * zoomEnvelope * 95;

                    // 2. 局部伴随水波纹环分量 (限制在同一小半径内，绝不扩散到全屏)
                    if (ringRatio > 0.01 && u > 0.001) {
                        const wavePhase = (u * 2.2 - t * 2.6) * Math.PI * 2.0;
                        const ringWave = Math.sin(wavePhase) * u * oneMinusUSq * oneMinusUSq * Math.pow(1 - t, 1.8) * node.strength * ringRatio * 55;
                        dispX += (dxNorm / u) * ringWave;
                        dispY += (dyNorm / u) * ringWave;
                    }

                    const idx = rowOffset + x;
                    accumDx[idx] += dispX;
                    accumDy[idx] += dispY;
                }
            }
        }

        // 将位移与波峰微光写入画布
        const dispData = dispImageData.data;
        const lightData = lightImageData.data;
        const specScale = config.specularIntensity;

        // 先将整张贴图重置为 100% 静止透明状态 (RGB=128, Alpha=0)
        for (let i = 0; i < dispData.length; i += 4) {
            dispData[i] = 128;
            dispData[i + 1] = 128;
            dispData[i + 2] = 128;
            dispData[i + 3] = 255;

            lightData[i] = 0;
            lightData[i + 1] = 0;
            lightData[i + 2] = 0;
            lightData[i + 3] = 0;
        }

        // 仅在活跃包围盒内计算像素，保证 60FPS 满帧与极致平滑
        if (minDirtyX <= maxDirtyX && minDirtyY <= maxDirtyY) {
            for (let y = minDirtyY; y <= maxDirtyY; y++) {
                const row = y * w;
                for (let x = minDirtyX; x <= maxDirtyX; x++) {
                    const idx = row + x;
                    const rawDx = accumDx[idx];
                    const rawDy = accumDy[idx];
                    if (Math.abs(rawDx) < 0.05 && Math.abs(rawDy) < 0.05) continue;

                    // 使用 tanh 软饱和限制最大偏移，防止快速连续划水时文字撕裂
                    const normDx = Math.tanh(rawDx / 85) * 115;
                    const normDy = Math.tanh(rawDy / 85) * 115;

                    const pIdx = idx << 2;
                    dispData[pIdx] = Math.max(0, Math.min(255, Math.round(128 + normDx)));
                    dispData[pIdx + 1] = Math.max(0, Math.min(255, Math.round(128 + normDy)));
                    dispData[pIdx + 2] = 128;
                    dispData[pIdx + 3] = 255;

                    // 仅在水波透镜斜面迎光处绘制一丝清澈高光 (默认极清淡)
                    if (specScale > 0.01) {
                        const lightDot = -(normDx * 0.6 + normDy * 0.6);
                        if (lightDot > 2.0) {
                            const glintAlpha = Math.min(115, Math.round(Math.pow(lightDot / 90, 1.6) * 140 * specScale));
                            if (glintAlpha > 1) {
                                lightData[pIdx] = 225;
                                lightData[pIdx + 1] = 248;
                                lightData[pIdx + 2] = 255;
                                lightData[pIdx + 3] = glintAlpha;
                            }
                        }
                    }
                }
            }
        }

        dispCtx.putImageData(dispImageData, 0, 0);
        lightCtx.putImageData(lightImageData, 0, 0);
        updateSvgDisplacementMap();

        if (waterNodes.length === 0) {
            idleFrames++;
            if (idleFrames > 4) {
                isWaterActive = false;
                lightCtx.clearRect(0, 0, w, h);
                setFilterActiveState(false);
            }
        } else {
            idleFrames = 0;
        }

        requestAnimationFrame(renderWaterLensFrame);
    }

    // ==================== ScriptCat / Tampermonkey 兼容 Shadow DOM 控制面板 ====================
    // 使用独立 Shadow DOM 挂载控制面板，彻底隔离原网页 CSS 冲突，解决在 ScriptCat 中点击打不开的问题
    const panelHost = document.createElement('div');
    panelHost.id = 'tm-water-ctrl-host';
    panelHost.style.cssText = [
        'position: fixed',
        'right: 16px',
        'bottom: 16px',
        'z-index: 2147483647',
        'pointer-events: auto'
    ].join(';');
    (document.body || document.documentElement).appendChild(panelHost);

    const shadow = panelHost.attachShadow({ mode: 'open' });

    function applyPreset(presetKey) {
        const p = PRESETS[presetKey];
        if (!p) return;
        config.preset = presetKey;
        Object.assign(config, p);
        saveConfig(config);
        buildSvgFilterMarkup();
        spawnWaterLensNode(window.innerWidth * 0.5, window.innerHeight * 0.5, 1.2, 1.1, 1.1);
        renderShadowPanel();
    }

    function togglePanelMinimized() {
        config.panelMinimized = !config.panelMinimized;
        saveConfig(config);
        const wrapper = shadow.querySelector('.tm-ctrl-wrap');
        if (wrapper) {
            wrapper.classList.toggle('minimized', config.panelMinimized);
        }
    }

    function renderShadowPanel() {
        shadow.innerHTML = `
            <style>
                * {
                    box-sizing: border-box;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
                    user-select: none;
                }
                .tm-ctrl-wrap {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    font-size: 12px;
                    color: #f0f9ff;
                }
                .tm-ctrl-wrap.minimized .tm-panel-body {
                    display: none !important;
                }
                .tm-droplet-btn {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, rgba(56, 189, 248, 0.88), rgba(3, 105, 161, 0.92));
                    box-shadow: 0 4px 14px rgba(2, 132, 199, 0.45), inset 0 1px 2px rgba(255, 255, 255, 0.7);
                    border: 1px solid rgba(186, 230, 253, 0.75);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    font-size: 18px;
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                    pointer-events: auto;
                }
                .tm-droplet-btn:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 18px rgba(56, 189, 248, 0.7);
                }
                .tm-panel-body {
                    width: 304px;
                    background: rgba(12, 26, 44, 0.90);
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                    border: 1px solid rgba(125, 211, 252, 0.4);
                    border-radius: 14px;
                    padding: 14px 16px;
                    margin-bottom: 10px;
                    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.5);
                    pointer-events: auto;
                }
                .tm-panel-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    font-weight: 600;
                    font-size: 13px;
                    margin-bottom: 10px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid rgba(125, 211, 252, 0.22);
                    color: #ffffff;
                }
                .tm-header-actions {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .tm-btn-min {
                    background: rgba(255, 255, 255, 0.12);
                    border: none;
                    color: #bae6fd;
                    border-radius: 5px;
                    padding: 2px 7px;
                    font-size: 11px;
                    cursor: pointer;
                }
                .tm-btn-min:hover {
                    background: rgba(255, 255, 255, 0.25);
                    color: #fff;
                }
                .tm-preset-bar {
                    display: flex;
                    gap: 6px;
                    margin-bottom: 10px;
                }
                .tm-preset-btn {
                    flex: 1;
                    padding: 5px 4px;
                    border-radius: 7px;
                    border: 1px solid rgba(125, 211, 252, 0.3);
                    background: rgba(255, 255, 255, 0.07);
                    color: #bae6fd;
                    font-size: 11px;
                    cursor: pointer;
                    text-align: center;
                }
                .tm-preset-btn.active,
                .tm-preset-btn:hover {
                    background: rgba(56, 189, 248, 0.32);
                    border-color: #38bdf8;
                    color: #ffffff;
                    font-weight: 600;
                }
                .tm-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin: 7px 0;
                    gap: 8px;
                }
                .tm-row label {
                    flex: 1;
                    color: #e0f2fe;
                    font-size: 12px;
                }
                input[type="range"] {
                    width: 115px;
                    accent-color: #38bdf8;
                    cursor: pointer;
                }
                select {
                    background: rgba(15, 40, 68, 0.95);
                    color: #f0f9ff;
                    border: 1px solid rgba(125, 211, 252, 0.4);
                    border-radius: 6px;
                    padding: 2px 6px;
                    font-size: 11px;
                    cursor: pointer;
                }
                input[type="checkbox"] {
                    accent-color: #38bdf8;
                    width: 15px;
                    height: 15px;
                    cursor: pointer;
                }
                .tm-hint {
                    margin-top: 8px;
                    padding-top: 6px;
                    border-top: 1px solid rgba(125, 211, 252, 0.16);
                    font-size: 11px;
                    color: #7dd3fc;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
            </style>
            <div class="tm-ctrl-wrap ${config.panelMinimized ? 'minimized' : ''}">
                <div class="tm-panel-body">
                    <div class="tm-panel-header">
                        <span>💧 局部水波透镜 v4.0</span>
                        <div class="tm-header-actions">
                            <input type="checkbox" id="tm-cfg-enabled" title="开启/关闭特效" ${config.enabled ? 'checked' : ''} />
                            <button class="tm-btn-min" id="tm-btn-collapse" title="收起面板">收起</button>
                        </div>
                    </div>

                    <div class="tm-preset-bar">
                        <button class="tm-preset-btn ${config.preset === 'lens' ? 'active' : ''}" data-preset="lens">🔍 局部水透镜</button>
                        <button class="tm-preset-btn ${config.preset === 'gentle' ? 'active' : ''}" data-preset="gentle">💎 微距轻柔</button>
                        <button class="tm-preset-btn ${config.preset === 'vivid' ? 'active' : ''}" data-preset="vivid">🌊 灵动水珠</button>
                    </div>

                    <div class="tm-row">
                        <label>影响半径范围 (<span id="val-radius">${config.radiusPx}</span>px)</label>
                        <input type="range" id="tm-cfg-radius" min="40" max="180" step="5" value="${config.radiusPx}" />
                    </div>

                    <div class="tm-row">
                        <label>中心放大/缩小强度 (<span id="val-zoom">${config.zoomStrength}</span>)</label>
                        <input type="range" id="tm-cfg-zoom" min="5" max="45" step="1" value="${config.zoomStrength}" />
                    </div>

                    <div class="tm-row">
                        <label>放大→缩小周期 (<span id="val-dur">${config.cycleDuration.toFixed(2)}</span>s)</label>
                        <input type="range" id="tm-cfg-dur" min="0.50" max="1.80" step="0.05" value="${config.cycleDuration}" />
                    </div>

                    <div class="tm-row">
                        <label>伴随水波环比例 (<span id="val-ring">${config.rippleRingRatio.toFixed(2)}</span>)</label>
                        <input type="range" id="tm-cfg-ring" min="0" max="0.80" step="0.04" value="${config.rippleRingRatio}" />
                    </div>

                    <div class="tm-row">
                        <label>波峰晶莹高光 (<span id="val-spec">${config.specularIntensity.toFixed(2)}</span>)</label>
                        <input type="range" id="tm-cfg-spec" min="0" max="1.0" step="0.05" value="${config.specularIntensity}" />
                    </div>

                    <div class="tm-row">
                        <label>折射渲染模式</label>
                        <select id="tm-cfg-mode">
                            <option value="backdrop" ${config.renderMode === 'backdrop' ? 'selected' : ''}>视口折射层 (推荐)</option>
                            <option value="dom" ${config.renderMode === 'dom' ? 'selected' : ''}>全局DOM滤镜 (兼容)</option>
                        </select>
                    </div>

                    <div class="tm-row">
                        <label>合成水滴声效</label>
                        <input type="checkbox" id="tm-cfg-sound" ${config.soundEnabled ? 'checked' : ''} />
                    </div>

                    <div class="tm-hint">
                        <span>快捷键: Alt + W 开关面板</span>
                        <span>中心变大→缩小→恢复</span>
                    </div>
                </div>
                <div class="tm-droplet-btn" id="tm-droplet-toggle" title="点击展开/收起水面设置 (Alt+W)">
                    💧
                </div>
            </div>
        `;

        // 直接在 Shadow DOM 内部通过 shadow.getElementById 绑定事件，彻底解决 ScriptCat 中打不开面板的问题
        const on = (id, evt, fn) => {
            const el = shadow.getElementById(id);
            if (el) el.addEventListener(evt, fn);
        };

        on('tm-droplet-toggle', 'click', (e) => {
            e.stopPropagation();
            togglePanelMinimized();
        });

        on('tm-btn-collapse', 'click', (e) => {
            e.stopPropagation();
            togglePanelMinimized();
        });

        shadow.querySelectorAll('.tm-preset-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                applyPreset(btn.getAttribute('data-preset'));
            });
        });

        on('tm-cfg-enabled', 'change', (e) => {
            config.enabled = e.target.checked;
            setFilterActiveState(isWaterActive);
            saveConfig(config);
        });

        on('tm-cfg-radius', 'input', (e) => {
            config.radiusPx = Number(e.target.value);
            config.preset = 'custom';
            shadow.getElementById('val-radius').textContent = config.radiusPx;
            saveConfig(config);
        });

        on('tm-cfg-zoom', 'input', (e) => {
            config.zoomStrength = Number(e.target.value);
            config.preset = 'custom';
            shadow.getElementById('val-zoom').textContent = config.zoomStrength;
            buildSvgFilterMarkup();
            saveConfig(config);
        });

        on('tm-cfg-dur', 'input', (e) => {
            config.cycleDuration = Number(e.target.value);
            config.preset = 'custom';
            shadow.getElementById('val-dur').textContent = config.cycleDuration.toFixed(2);
            saveConfig(config);
        });

        on('tm-cfg-ring', 'input', (e) => {
            config.rippleRingRatio = Number(e.target.value);
            config.preset = 'custom';
            shadow.getElementById('val-ring').textContent = config.rippleRingRatio.toFixed(2);
            saveConfig(config);
        });

        on('tm-cfg-spec', 'input', (e) => {
            config.specularIntensity = Number(e.target.value);
            config.preset = 'custom';
            shadow.getElementById('val-spec').textContent = config.specularIntensity.toFixed(2);
            saveConfig(config);
        });

        on('tm-cfg-mode', 'change', (e) => {
            config.renderMode = e.target.value;
            setFilterActiveState(isWaterActive);
            saveConfig(config);
        });

        on('tm-cfg-sound', 'change', (e) => {
            config.soundEnabled = e.target.checked;
            saveConfig(config);
        });
    }

    renderShadowPanel();

    // 快捷键 Alt + W 切换面板
    window.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'w' || e.key === 'W')) {
            e.preventDefault();
            togglePanelMinimized();
        }
    });

    // 注册 ScriptCat / Tampermonkey 扩展菜单命令
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('💧 展开/收起水面控制面板 (Alt+W)', () => {
            togglePanelMinimized();
        });
        GM_registerMenuCommand('🔍 恢复默认【局部水透镜】预设', () => {
            applyPreset('lens');
        });
    }

    requestAnimationFrame(renderWaterLensFrame);
})();