/**
 * Client-side deterministic runtime driving hybrid scenes, SVG animations,
 * oversized pointer clicks, animated counters, and word-synced captions.
 */

/** Build the deterministic client script injected into timeline.html. */
export function buildClientRuntimeScript(): string {
  return `
(() => {
  const data = window.__TIMELINE_DATA__;
  const canvas = document.getElementById("bg-canvas");
  const ctx = canvas.getContext("2d");
  const brollLayer = document.getElementById("broll-layer");
  const sceneHost = document.getElementById("scene-host");
  const captionRail = document.getElementById("caption-rail");
  const progressFill = document.getElementById("progress-fill");
  const cursorEl = document.getElementById("pointer-cursor");
  let activeSceneId = "";

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  function easeOutCubic(t) {
    const c = Math.max(0, Math.min(1, t));
    return 1 - Math.pow(1 - c, 3);
  }

  function esc(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function drawBackground(tSec, scheduled) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = data.theme.backgroundHex;
    ctx.fillRect(0, 0, w, h);

    const orbX = w * (0.28 + 0.14 * Math.sin(tSec * 0.45));
    const orbY = h * (0.3 + 0.12 * Math.cos(tSec * 0.35));
    const g1 = ctx.createRadialGradient(orbX, orbY, 10, orbX, orbY, Math.max(w, h) * 0.56);
    g1.addColorStop(0, data.theme.primaryHex + "38");
    g1.addColorStop(1, "transparent");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);

    const orb2X = w * (0.76 + 0.1 * Math.cos(tSec * 0.3));
    const orb2Y = h * (0.72 + 0.1 * Math.sin(tSec * 0.4));
    const g2 = ctx.createRadialGradient(orb2X, orb2Y, 10, orb2X, orb2Y, Math.max(w, h) * 0.48);
    g2.addColorStop(0, data.theme.accentHex + "2e");
    g2.addColorStop(1, "transparent");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.038)";
    ctx.lineWidth = 1;
    const step = 64;
    const offset = (tSec * 14) % step;
    for (let x = -step + offset; x < w + step; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    if (scheduled && scheduled.scene.brollImageUrl) {
      const localP = Math.min(1, Math.max(0, (tSec - scheduled.startSec) / Math.max(1, scheduled.durationSec)));
      brollLayer.style.backgroundImage = 'url("' + scheduled.scene.brollImageUrl + '")';
      brollLayer.style.opacity = "0.55";
      brollLayer.style.transform = "scale(" + (1.02 + localP * 0.08).toFixed(4) + ")";
    } else {
      brollLayer.style.opacity = "0";
    }
  }

  function buildVisualColumnHtml(s) {
    const blocks = [];
    if (s.metricValue) {
      blocks.push('<div class="metric-box anim-item" data-target="metric" data-delay="0.2"><div class="metric-value" data-metric-raw="' + esc(s.metricValue) + '">' + esc(s.metricValue) + '</div><div class="metric-label">' + esc(s.metricLabel || "") + '</div></div>');
    }
    if (s.codeSnippet) {
      const lines = String(s.codeSnippet).split(/\\r?\\n/).map((line, idx) => '<span class="code-line" data-line-idx="' + idx + '">' + esc(line) + '</span>').join("");
      blocks.push('<pre class="code-box anim-item" data-target="code" data-delay="0.22">' + lines + '</pre>');
    }
    if (Array.isArray(s.steps) && s.steps.length > 0) {
      blocks.push('<div class="steps-grid">' + s.steps.map((st, idx) => '<div class="step-pill anim-item" data-target="step" data-delay="' + (0.2 + idx * 0.09) + '">' + (idx + 1) + '. ' + esc(st) + '</div>').join("") + '</div>');
    }
    if (s.customSvg) {
      blocks.push('<div class="svg-frame anim-item" data-target="visual" data-delay="0.18">' + s.customSvg + '</div>');
    }
    return blocks.join("");
  }

  function mountSceneDom(scheduled) {
    const s = scheduled.scene;
    const visualHtml = buildVisualColumnHtml(s);
    const useSplit = (s.layoutMode === "split" || (s.layoutMode !== "centered" && visualHtml.length > 0)) && visualHtml.length > 0;
    const layoutClass = useSplit ? "scene-split" : "scene-centered";
    const scale = (data.scaleOverrides && data.scaleOverrides[s.id]) || 1;

    const copyHtml = [
      '<div class="copy-col">',
      s.eyebrow ? '<div class="eyebrow anim-item" data-delay="0">' + esc(s.eyebrow) + '</div>' : '',
      '<h1 class="headline anim-item" data-delay="0.07">' + esc(s.headline) + '</h1>',
      '<p class="display-text anim-item" data-delay="0.15">' + esc(s.displayText) + '</p>',
      !useSplit && visualHtml ? visualHtml : '',
      s.archetype === "OutroCTA" ? '<div class="cta-pill anim-item" data-target="cta" data-delay="0.26">' + esc(s.ctaLabel || "Get Started Today") + '</div>' : '',
      '</div>',
    ].join("");

    const inner = useSplit ? copyHtml + '<div class="visual-col">' + visualHtml + '</div>' : copyHtml;
    sceneHost.innerHTML = '<div class="scene-card ' + layoutClass + '" data-scene-id="' + s.id + '" data-base-scale="' + scale + '">' + inner + '</div>';
  }

  function animateDynamicElements(card, scheduled, localSec) {
    const metricEl = card.querySelector("[data-metric-raw]");
    if (metricEl) {
      const raw = metricEl.getAttribute("data-metric-raw") || "";
      const match = raw.match(/^([^0-9.-]*)([0-9]+(?:\\.[0-9]+)?)(.*)$/);
      if (match) {
        const target = Number(match[2]);
        const decimals = (match[2].split(".")[1] || "").length;
        const p = easeOutCubic((localSec - 0.15) / 1.1);
        metricEl.textContent = match[1] + (target * p).toFixed(decimals) + match[3];
      }
    }

    const codeLines = card.querySelectorAll(".code-line");
    if (codeLines.length > 0) {
      const activeIdx = Math.floor((localSec / Math.max(0.8, scheduled.durationSec - 0.5)) * codeLines.length);
      codeLines.forEach((line, idx) => {
        line.classList.toggle("active", idx === Math.min(codeLines.length - 1, activeIdx));
      });
    }

    const drawPaths = card.querySelectorAll(".svg-draw");
    const drawP = easeOutCubic((localSec - 0.2) / 0.9);
    for (const pEl of drawPaths) {
      pEl.style.strokeDasharray = "400";
      pEl.style.strokeDashoffset = String(Math.round(400 * (1 - drawP)));
    }
    const pulseEls = card.querySelectorAll(".svg-pulse");
    const pulseScale = 1 + 0.05 * Math.sin(localSec * 4.2);
    for (const nEl of pulseEls) {
      nEl.style.transformBox = "fill-box";
      nEl.style.transformOrigin = "center";
      nEl.style.transform = "scale(" + pulseScale.toFixed(3) + ")";
    }
  }

  function animateCursor(card, scheduled, localSec) {
    const targetName = scheduled.scene.cursorTarget;
    if (!targetName || targetName === "none") {
      cursorEl.style.opacity = "0";
      return;
    }
    const targetEl = card.querySelector('[data-target="' + targetName + '"]');
    if (!targetEl) {
      cursorEl.style.opacity = "0";
      return;
    }
    const rect = targetEl.getBoundingClientRect();
    const goalX = rect.left + rect.width * 0.72;
    const goalY = rect.top + rect.height * 0.58;
    const startX = window.innerWidth + 60;
    const startY = window.innerHeight * 0.85;

    const enterP = easeOutCubic((localSec - 0.35) / 0.65);
    const exitP = localSec > scheduled.durationSec - 0.45 ? easeOutCubic((localSec - (scheduled.durationSec - 0.45)) / 0.4) : 0;
    const x = startX + (goalX - startX) * enterP + exitP * 140;
    const y = startY + (goalY - startY) * enterP - exitP * 80;

    const clickPhase = localSec >= 1.0 && localSec <= 1.25 ? Math.sin(((localSec - 1.0) / 0.25) * Math.PI) : 0;
    const cursorScale = 1 - clickPhase * 0.22;
    cursorEl.style.opacity = enterP > 0.05 ? String(Math.min(1, enterP * (1 - exitP))) : "0";
    cursorEl.style.left = x.toFixed(1) + "px";
    cursorEl.style.top = y.toFixed(1) + "px";
    cursorEl.style.transform = "scale(" + cursorScale.toFixed(3) + ")";
    if (clickPhase > 0.3) {
      targetEl.style.outline = "2px solid " + data.theme.primaryHex;
    } else {
      targetEl.style.outline = "none";
    }
  }

  function applySceneMotion(scheduled, localSec) {
    const card = sceneHost.querySelector(".scene-card");
    if (!card) return;
    const baseScale = Number(card.getAttribute("data-base-scale") || "1");
    const enterP = easeOutCubic(localSec / 0.42);
    const exitRem = scheduled.durationSec - localSec;
    const exitP = exitRem < 0.28 ? easeOutCubic((0.28 - exitRem) / 0.28) : 0;

    let offsetX = 0;
    let offsetY = 0;
    let motionScale = 1;
    if (scheduled.entryDirection === "from-right") offsetX += (1 - enterP) * 65;
    if (scheduled.entryDirection === "from-left") offsetX -= (1 - enterP) * 65;
    if (scheduled.entryDirection === "from-bottom") offsetY += (1 - enterP) * 50;
    if (scheduled.entryDirection === "zoom-in") motionScale *= 0.93 + 0.07 * enterP;

    if (scheduled.scene.exitVector === "left") offsetX -= exitP * 65;
    if (scheduled.scene.exitVector === "right") offsetX += exitP * 65;
    if (scheduled.scene.exitVector === "up") offsetY -= exitP * 50;
    if (scheduled.scene.exitVector === "zoom-in") motionScale *= 1 + exitP * 0.07;

    const alpha = Math.min(enterP, 1 - exitP);
    card.style.opacity = String(Math.max(0, Math.min(1, alpha)));
    card.style.transform = "translate3d(" + offsetX.toFixed(1) + "px," + offsetY.toFixed(1) + "px,0) scale(" + (baseScale * motionScale).toFixed(4) + ")";

    const items = card.querySelectorAll(".anim-item");
    for (const item of items) {
      const delay = Number(item.getAttribute("data-delay") || "0");
      const itemP = easeOutCubic((localSec - delay) / 0.36);
      item.style.opacity = String(itemP);
      item.style.transform = "translateY(" + ((1 - itemP) * 18).toFixed(1) + "px)";
    }

    animateDynamicElements(card, scheduled, localSec);
    animateCursor(card, scheduled, localSec);
  }

  function renderCaptions(tSec, currentSceneId) {
    const sceneWords = data.captions.filter((c) => c.sceneId === currentSceneId);
    if (sceneWords.length === 0) {
      captionRail.style.display = "none";
      return;
    }
    const activeIdx = sceneWords.findIndex((c) => tSec >= c.startSec && tSec <= c.endSec);
    const anchorIdx = activeIdx >= 0 ? activeIdx : sceneWords.findIndex((c) => c.startSec >= tSec);
    const safeIdx = anchorIdx >= 0 ? anchorIdx : sceneWords.length - 1;
    const chunkStart = Math.floor(safeIdx / 6) * 6;
    const windowWords = sceneWords.slice(chunkStart, chunkStart + 6);
    if (windowWords.length === 0 || tSec < sceneWords[0].startSec - 0.1) {
      captionRail.style.display = "none";
      return;
    }
    captionRail.style.display = "block";
    const active = activeIdx >= 0 ? sceneWords[activeIdx] : null;
    captionRail.innerHTML = windowWords.map((w) => {
      const isActive = active && w.startSec === active.startSec && w.word === active.word;
      return isActive ? '<span class="word-active">' + esc(w.word) + '</span>' : esc(w.word);
    }).join(" ");
  }

  window.__VIDGEN_CLOCK__.onFrame((_ms, tSec) => {
    const pct = Math.min(100, (tSec / Math.max(0.1, data.totalDurationSec)) * 100);
    progressFill.style.width = pct.toFixed(2) + "%";

    const current = data.scenes.find((s) => tSec >= s.startSec && tSec < s.endSec) || data.scenes[data.scenes.length - 1];
    drawBackground(tSec, current);
    if (current) {
      if (activeSceneId !== current.scene.id) {
        activeSceneId = current.scene.id;
        mountSceneDom(current);
      }
      applySceneMotion(current, tSec - current.startSec);
      renderCaptions(tSec, current.scene.id);
    }
  });

  window.__VIDGEN_CLOCK__.seekToMs(0);
})();
`.trim();
}
