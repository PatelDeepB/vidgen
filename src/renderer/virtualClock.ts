/**
 * Client-side deterministic Virtual Clock injected into headless Chromium.
 * Eliminates real-time requestAnimationFrame drift during frame-by-frame capture.
 */

/** Return the JavaScript snippet injected via Playwright addInitScript. */
export function buildVirtualClockInitScript(): string {
  return `
(() => {
  let virtualNowMs = 0;
  const frameListeners = [];
  const rafQueue = new Map();
  let nextRafId = 1;

  Date.now = () => Math.floor(virtualNowMs);
  if (typeof performance !== "undefined") {
    performance.now = () => virtualNowMs;
  }

  window.requestAnimationFrame = (callback) => {
    const id = nextRafId++;
    rafQueue.set(id, callback);
    return id;
  };

  window.cancelAnimationFrame = (id) => {
    rafQueue.delete(id);
  };

  window.__VIDGEN_CLOCK__ = {
    getNowMs: () => virtualNowMs,
    onFrame: (listener) => {
      frameListeners.push(listener);
    },
    seekToMs: (targetMs) => {
      virtualNowMs = Math.max(0, targetMs);
      if (typeof document !== "undefined" && document.getAnimations) {
        for (const anim of document.getAnimations()) {
          if (anim.playState !== "paused") {
            anim.pause();
          }
          anim.currentTime = virtualNowMs;
        }
      }
      for (const listener of frameListeners) {
        listener(virtualNowMs, virtualNowMs / 1000);
      }
      const pending = Array.from(rafQueue.entries());
      rafQueue.clear();
      for (const [, cb] of pending) {
        cb(virtualNowMs);
      }
    }
  };
})();
`.trim();
}
