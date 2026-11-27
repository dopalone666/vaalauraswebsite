/* VaalAuras emblem eye animation — ported directly from poe2_brand.py */
(function () {
  'use strict';

  var BASE_SIZE = 256;
  var EYE_CENTER_X = 128;
  var EYE_CENTER_Y = 121;
  var EYE_RADIUS = 28;
  var BLINK_RADIUS = 28;
  var PAD = EYE_RADIUS + 4; // 32 -> 64x64 patch
  var PATCH_SIZE = PAD * 2; // 64
  var PATCH_X0 = EYE_CENTER_X - PAD; // 96
  var PATCH_Y0 = EYE_CENTER_Y - PAD; // 89
  var BLINK_HALF = BLINK_RADIUS + 2; // 30 -> 60x60 inner patch
  var BLINK_SIZE = BLINK_HALF * 2; // 60
  var BLINK_INSET = PAD - BLINK_HALF; // 2

  var GAZE_MAX = 9.0;
  var TWITCH_MAX_RADIUS = 21.0;

  var BLINK_DURATION = 0.20;
  var BLINK_INTERVAL_MIN = 7.5;
  var BLINK_INTERVAL_MAX = 16.5;

  var TWITCH_INTERVAL_MIN = 75.0;
  var TWITCH_INTERVAL_MAX = 150.0;
  var TWITCH_PHASE_DURATION = 2.0;
  var TWITCH_BLINK_DURATION = 1.0;
  var TWITCH_LOCK_DURATION = 2.0;
  var TWITCH_TOTAL_DURATION = TWITCH_PHASE_DURATION + TWITCH_BLINK_DURATION + TWITCH_LOCK_DURATION;
  var TWITCH_STEP_INTERVAL = 0.032;

  var PHI_LIM = Math.asin(0.84);
  var TAU = Math.PI * 2;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function randRange(lo, hi) {
    return lo + Math.random() * (hi - lo);
  }

  /* ------------------------------------------------------------------ */
  /* Precomputed grids (computed once, zero per-frame allocations)       */
  /* ------------------------------------------------------------------ */

  var gazeGrid = (function buildGazeGrid() {
    var count = PATCH_SIZE * PATCH_SIZE;
    var u = new Float32Array(count);
    var v = new Float32Array(count);
    var z = new Float32Array(count);
    var alpha = new Float32Array(count);
    var rimShade = new Float32Array(count);
    var rPx = EYE_RADIUS;
    var idx = 0;
    for (var y = 0; y < PATCH_SIZE; y++) {
      var vy = (y - PAD) / rPx;
      for (var x = 0; x < PATCH_SIZE; x++, idx++) {
        var ux = (x - PAD) / rPx;
        var r2 = ux * ux + vy * vy;
        var r = Math.sqrt(r2);
        u[idx] = ux;
        v[idx] = vy;
        z[idx] = r2 < 1.0 ? Math.sqrt(1.0 - r2) : 0.0;
        alpha[idx] = clamp((1.0 - r) * (rPx / 2.2) + 0.5, 0.0, 1.0);
        rimShade[idx] = 1.0 - 0.22 * clamp((r - 0.80) / 0.20, 0.0, 1.0);
      }
    }
    return { u: u, v: v, z: z, alpha: alpha, rimShade: rimShade };
  })();

  var blinkGrid = (function buildBlinkGrid() {
    var count = BLINK_SIZE * BLINK_SIZE;
    var u = new Float32Array(count);
    var v = new Float32Array(count);
    var u2 = new Float32Array(count);
    var socketAlpha = new Float32Array(count);
    var rimIndices = [];
    var idx = 0;
    for (var y = -BLINK_HALF; y < BLINK_HALF; y++) {
      var vy = y / BLINK_RADIUS;
      for (var x = -BLINK_HALF; x < BLINK_HALF; x++, idx++) {
        var ux = x / BLINK_RADIUS;
        var dist = Math.hypot(x, y);
        u[idx] = ux;
        v[idx] = vy;
        u2[idx] = ux * ux;
        socketAlpha[idx] = clamp((BLINK_RADIUS + 0.5 - dist) / 2.5, 0.0, 1.0);
        if (dist >= BLINK_RADIUS - 2.0 && dist <= BLINK_RADIUS + 2.0) {
          rimIndices.push(idx);
        }
      }
    }
    return { u: u, v: v, u2: u2, socketAlpha: socketAlpha, rimIndices: rimIndices };
  })();

  function blinkAmount(progress) {
    if (progress <= 0.0 || progress >= 1.0) return 0.0;
    if (progress < 0.32) {
      var t1 = progress / 0.32;
      var inv = 1.0 - t1;
      return 1.0 - inv * inv * inv;
    }
    if (progress <= 0.50) return 1.0;
    var t2 = (progress - 0.50) / 0.50;
    return 1.0 - t2 * t2 * (3.0 - 2.0 * t2);
  }

  function buildTwitchSequence(steps) {
    var count = Math.max(1, steps | 0);
    var offsets = new Array(count);
    var prevX = 0;
    var prevY = 0;
    for (var idx = 0; idx < count; idx++) {
      var rLo = idx % 4 !== 2 ? 12.5 : 6.5;
      var rHi = idx % 4 !== 2 ? TWITCH_MAX_RADIUS : 13.5;
      var found = false;
      var bestX = prevX;
      var bestY = prevY;
      for (var attempt = 0; attempt < 16; attempt++) {
        var angle = Math.random() * TAU;
        var rad = randRange(rLo, rHi);
        var dx = Math.round(rad * Math.cos(angle));
        var dy = Math.round(rad * Math.sin(angle));
        if (Math.hypot(dx, dy) >= rLo - 0.5 && Math.hypot(dx - prevX, dy - prevY) >= 14.0) {
          bestX = dx;
          bestY = dy;
          found = true;
          break;
        }
      }
      if (!found) {
        var oppAngle = (prevX || prevY) ? Math.atan2(-prevY, -prevX) : Math.random() * TAU;
        var fallbackRad = randRange(14.0, TWITCH_MAX_RADIUS);
        bestX = Math.round(fallbackRad * Math.cos(oppAngle));
        bestY = Math.round(fallbackRad * Math.sin(oppAngle));
      }
      offsets[idx] = [bestX, bestY];
      prevX = bestX;
      prevY = bestY;
    }
    return offsets;
  }

  function percentile(sortedArr, p) {
    if (!sortedArr.length) return 0;
    var pos = (p / 100) * (sortedArr.length - 1);
    var lo = Math.floor(pos);
    var hi = Math.min(sortedArr.length - 1, lo + 1);
    var frac = pos - lo;
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * frac;
  }

  function sampleLidColors(srcPatch) {
    var rim = blinkGrid.rimIndices;
    if (!rim.length) {
      return { base: [24, 20, 20], highlight: [56, 48, 48] };
    }
    var rs = new Array(rim.length);
    var gs = new Array(rim.length);
    var bs = new Array(rim.length);
    for (var i = 0; i < rim.length; i++) {
      var bIdx = rim[i];
      var by = Math.floor(bIdx / BLINK_SIZE) + BLINK_INSET;
      var bx = (bIdx % BLINK_SIZE) + BLINK_INSET;
      var pOff = (by * PATCH_SIZE + bx) * 4;
      rs[i] = srcPatch[pOff];
      gs[i] = srcPatch[pOff + 1];
      bs[i] = srcPatch[pOff + 2];
    }
    var cmp = function (a, b) { return a - b; };
    rs.sort(cmp);
    gs.sort(cmp);
    bs.sort(cmp);
    return {
      base: [
        clamp(percentile(rs, 35) * 0.62, 10.0, 62.0),
        clamp(percentile(gs, 35) * 0.62, 10.0, 62.0),
        clamp(percentile(bs, 35) * 0.62, 10.0, 62.0)
      ],
      highlight: [
        clamp(percentile(rs, 70) * 0.85, 22.0, 118.0),
        clamp(percentile(gs, 70) * 0.85, 22.0, 118.0),
        clamp(percentile(bs, 70) * 0.85, 22.0, 118.0)
      ]
    };
  }

  /* ------------------------------------------------------------------ */
  /* Shared 64x64 scratch buffer & pixel-exact gaze + blink renderer     */
  /* ------------------------------------------------------------------ */

  var scratchFloat = new Float32Array(PATCH_SIZE * PATCH_SIZE * 4);

  function renderEyePatch(srcPatch, lidColors, outData, dx, dy, blink) {
    var len = PATCH_SIZE * PATCH_SIZE * 4;
    var hasGaze = Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4;
    var amount = clamp(blink || 0.0, 0.0, 1.0);

    if (!hasGaze && amount <= 0.005) {
      outData.set(srcPatch);
      return;
    }

    if (hasGaze) {
      var rPx = EYE_RADIUS;
      var mag = Math.hypot(dx, dy);
      var maxMag = rPx * 0.80;
      var gx = dx;
      var gy = dy;
      if (mag > maxMag) {
        var scaleM = maxMag / mag;
        gx *= scaleM;
        gy *= scaleM;
        mag = maxMag;
      }
      var nx = gx / Math.max(1e-6, mag);
      var ny = gy / Math.max(1e-6, mag);
      var sinT = Math.min(0.84, mag / rPx);
      var theta = Math.asin(sinT);
      var cosT = Math.cos(theta);
      var oneMC = 1.0 - cosT;

      var uArr = gazeGrid.u;
      var vArr = gazeGrid.v;
      var zArr = gazeGrid.z;
      var alphaArr = gazeGrid.alpha;
      var rimArr = gazeGrid.rimShade;
      var maxCoord = PATCH_SIZE - 1;
      var lim = 0.84;

      for (var i = 0, pOff = 0; i < PATCH_SIZE * PATCH_SIZE; i++, pOff += 4) {
        var a = alphaArr[i];
        if (a <= 0.0) {
          scratchFloat[pOff] = srcPatch[pOff];
          scratchFloat[pOff + 1] = srcPatch[pOff + 1];
          scratchFloat[pOff + 2] = srcPatch[pOff + 2];
          scratchFloat[pOff + 3] = srcPatch[pOff + 3];
          continue;
        }
        var u = uArr[i];
        var v = vArr[i];
        var z = zArr[i];
        var aDotP = -ny * u + nx * v;
        var ux = u * cosT - (nx * z) * sinT - ny * aDotP * oneMC;
        var vy = v * cosT - (ny * z) * sinT + nx * aDotP * oneMC;
        var zp = z * cosT + (ny * v + nx * u) * sinT;

        var sr = Math.hypot(ux, vy);
        var phi = Math.atan2(sr, zp);
        var safeR = sr;
        if (phi > PHI_LIM) {
          var excess = phi - PHI_LIM;
          var angleFold = Math.min(Math.PI, excess * 2.2);
          safeR = lim - 0.16 * (1.0 - Math.cos(angleFold)) * 0.5;
        }
        var rScale = sr > 1e-5 ? safeR / sr : 0.0;
        var mx = clamp(ux * rScale * rPx + PAD, 0.0, maxCoord);
        var my = clamp(vy * rScale * rPx + PAD, 0.0, maxCoord);

        var x0 = Math.floor(mx);
        var y0 = Math.floor(my);
        var x1 = x0 < maxCoord ? x0 + 1 : maxCoord;
        var y1 = y0 < maxCoord ? y0 + 1 : maxCoord;
        var fx = mx - x0;
        var fy = my - y0;
        var w00 = (1.0 - fx) * (1.0 - fy);
        var w10 = fx * (1.0 - fy);
        var w01 = (1.0 - fx) * fy;
        var w11 = fx * fy;

        var o00 = (y0 * PATCH_SIZE + x0) * 4;
        var o10 = (y0 * PATCH_SIZE + x1) * 4;
        var o01 = (y1 * PATCH_SIZE + x0) * 4;
        var o11 = (y1 * PATCH_SIZE + x1) * 4;

        var wr = srcPatch[o00] * w00 + srcPatch[o10] * w10 + srcPatch[o01] * w01 + srcPatch[o11] * w11;
        var wg = srcPatch[o00 + 1] * w00 + srcPatch[o10 + 1] * w10 + srcPatch[o01 + 1] * w01 + srcPatch[o11 + 1] * w11;
        var wb = srcPatch[o00 + 2] * w00 + srcPatch[o10 + 2] * w10 + srcPatch[o01 + 2] * w01 + srcPatch[o11 + 2] * w11;
        var wa = srcPatch[o00 + 3] * w00 + srcPatch[o10 + 3] * w10 + srcPatch[o01 + 3] * w01 + srcPatch[o11 + 3] * w11;

        var backShade = phi > PHI_LIM
          ? clamp(1.0 - 0.30 * clamp((phi - PHI_LIM) / 0.85, 0.0, 1.0), 0.68, 1.0)
          : 1.0;
        var shade = rimArr[i] * backShade;
        wr *= shade;
        wg *= shade;
        wb *= shade;

        var invA = 1.0 - a;
        scratchFloat[pOff] = srcPatch[pOff] * invA + wr * a;
        scratchFloat[pOff + 1] = srcPatch[pOff + 1] * invA + wg * a;
        scratchFloat[pOff + 2] = srcPatch[pOff + 2] * invA + wb * a;
        scratchFloat[pOff + 3] = srcPatch[pOff + 3] * invA + wa * a;
      }
    } else {
      for (var k = 0; k < len; k++) {
        scratchFloat[k] = srcPatch[k];
      }
    }

    if (amount > 0.005) {
      var bvArr = blinkGrid.v;
      var bu2Arr = blinkGrid.u2;
      var sockArr = blinkGrid.socketAlpha;
      var bR = lidColors.base[0];
      var bG = lidColors.base[1];
      var bB = lidColors.base[2];
      var dR = lidColors.highlight[0] - bR;
      var dG = lidColors.highlight[1] - bG;
      var dB = lidColors.highlight[2] - bB;
      var edgeSoft = 0.085;
      var seamStrength = amount > 0.85 ? (amount - 0.85) / 0.15 : 0.0;

      for (var by = 0, bIdx = 0; by < BLINK_SIZE; by++) {
        var rowOff = (by + BLINK_INSET) * PATCH_SIZE + BLINK_INSET;
        for (var bx = 0; bx < BLINK_SIZE; bx++, bIdx++) {
          var sAlpha = sockArr[bIdx];
          if (sAlpha <= 0.0) continue;

          var u2 = bu2Arr[bIdx];
          var bv = bvArr[bIdx];
          var meetV = 0.14 + 0.14 * u2;
          var topStart = -1.06 + 0.18 * u2;
          var botStart = 1.06 - 0.14 * u2;
          var upperV = topStart + (meetV - topStart) * amount;
          var lowerV = botStart + (meetV - botStart) * amount;

          var pOff2 = (rowOff + bx) * 4;
          var pr = scratchFloat[pOff2];
          var pg = scratchFloat[pOff2 + 1];
          var pb = scratchFloat[pOff2 + 2];

          var belowUpper = bv - upperV;
          if (belowUpper > 0.0 && bv < lowerV) {
            var castShadow = clamp(1.0 - belowUpper / 0.34, 0.0, 1.0);
            var shadowMul = 1.0 - 0.58 * amount * castShadow * sAlpha;
            pr *= shadowMul;
            pg *= shadowMul;
            pb *= shadowMul;
          }

          var upperCov = clamp((upperV - bv) / edgeSoft + 0.5, 0.0, 1.0);
          var lowerCov = clamp((bv - lowerV) / edgeSoft + 0.5, 0.0, 1.0);
          var lidCov = (upperCov > lowerCov ? upperCov : lowerCov) * sAlpha;

          if (lidCov > 0.0) {
            var sphere = clamp(1.0 - 0.45 * u2 - 0.35 * (bv * bv), 0.18, 1.0);
            var uEdgeD = (bv - (upperV - 0.04)) / 0.075;
            var lEdgeD = (bv - (lowerV + 0.04)) / 0.075;
            var upperEdge = Math.exp(-(uEdgeD * uEdgeD));
            var lowerEdge = Math.exp(-(lEdgeD * lEdgeD));
            var glintD = (bv - (upperV - 0.13)) / 0.10;
            var rimGlint = Math.exp(-(glintD * glintD)) * (1.0 - 0.5 * u2);

            var baseMul = 0.55 + 0.55 * sphere;
            var glintMul = 0.48 * rimGlint;
            var maxEdge = upperEdge > lowerEdge ? upperEdge : lowerEdge;
            var creaseDark = clamp(1.0 - 0.72 * maxEdge, 0.18, 1.0);

            var lr = (bR * baseMul + dR * glintMul) * creaseDark;
            var lg = (bG * baseMul + dG * glintMul) * creaseDark;
            var lb = (bB * baseMul + dB * glintMul) * creaseDark;

            if (seamStrength > 0.0) {
              var seamD = (bv - meetV) / 0.055;
              var seam = Math.exp(-(seamD * seamD)) * (1.0 - 0.35 * u2);
              var seamMul = 1.0 - 0.78 * seamStrength * seam;
              lr *= seamMul;
              lg *= seamMul;
              lb *= seamMul;
            }

            var invCov = 1.0 - lidCov;
            pr = pr * invCov + lr * lidCov;
            pg = pg * invCov + lg * lidCov;
            pb = pb * invCov + lb * lidCov;
          }

          scratchFloat[pOff2] = pr;
          scratchFloat[pOff2 + 1] = pg;
          scratchFloat[pOff2 + 2] = pb;
        }
      }
    }

    for (var j = 0; j < len; j++) {
      var val = Math.round(scratchFloat[j]);
      outData[j] = val < 0 ? 0 : val > 255 ? 255 : val;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Cached logo source loader (shares 256x256 pixel data across logos)  */
  /* ------------------------------------------------------------------ */

  var sourceCache = new Map();

  function loadLogoSource(url) {
    var resolved;
    try {
      resolved = new URL(url, window.location.href).href;
    } catch (_e) {
      return Promise.reject(new Error('Invalid logo URL'));
    }
    if (sourceCache.has(resolved)) return sourceCache.get(resolved);

    var promise = new Promise(function (resolve, reject) {
      var img = new Image();
      var sameOrigin = false;
      try {
        sameOrigin = new URL(resolved).origin === window.location.origin;
      } catch (_e2) {}
      if (!sameOrigin) img.crossOrigin = 'anonymous';
      img.decoding = 'async';

      img.onload = function () {
        try {
          var off = document.createElement('canvas');
          off.width = BASE_SIZE;
          off.height = BASE_SIZE;
          var octx = off.getContext('2d', { willReadFrequently: true });
          octx.imageSmoothingEnabled = true;
          octx.imageSmoothingQuality = 'high';
          octx.drawImage(img, 0, 0, BASE_SIZE, BASE_SIZE);
          var patchImg = octx.getImageData(PATCH_X0, PATCH_Y0, PATCH_SIZE, PATCH_SIZE);
          var srcPatch = new Uint8ClampedArray(patchImg.data);
          var lidColors = sampleLidColors(srcPatch);
          resolve({
            url: resolved,
            baseCanvas: off,
            srcPatch: srcPatch,
            lidColors: lidColors
          });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = function () {
        reject(new Error('Failed to load logo image'));
      };
      img.src = resolved;
    });

    promise.catch(function () {
      sourceCache.delete(resolved);
    });
    sourceCache.set(resolved, promise);
    return promise;
  }

  /* ------------------------------------------------------------------ */
  /* Per-emblem controller (matches EyeAnimationController in Python)    */
  /* ------------------------------------------------------------------ */

  var reducedMotionQuery = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function prefersReducedMotion() {
    return Boolean(reducedMotionQuery && reducedMotionQuery.matches);
  }

  var instances = [];
  var pointer = { active: false, x: 0, y: 0 };
  var rafId = 0;

  function scheduleFrame() {
    if (rafId || document.hidden || prefersReducedMotion()) return;
    rafId = window.requestAnimationFrame(tickAll);
  }

  function EyeInstance(img, options) {
    this.img = img;
    this.allowTwitch = Boolean(options && options.allowTwitch);
    this.canvas = document.createElement('canvas');
    this.canvas.width = BASE_SIZE;
    this.canvas.height = BASE_SIZE;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.className = this._canvasClassName();
    this.ctx = this.canvas.getContext('2d');
    this.patchImageData = this.ctx ? this.ctx.createImageData(PATCH_SIZE, PATCH_SIZE) : null;

    this.source = null;
    this.mounted = false;
    this.currentUrl = '';
    this.pointerDx = 0;
    this.pointerDy = 0;
    this.lastKey = '';

    this.mode = 'idle'; // 'idle' | 'blink' | 'twitch_lock'
    this.phaseStarted = 0;
    this.twitchOffsets = [];
    this.lockDx = 0;
    this.lockDy = 0;
    this.blinkTimer = 0;
    this.twitchTimer = 0;
    this.stareTimer = 0;
    this.dirty = false;
    this.createdAt = performance.now();

    this._observeSrc();
    this.syncSource();
    this._scheduleNextBlink();
    if (this.allowTwitch) this._scheduleNextTwitch();
  }

  EyeInstance.prototype._canvasClassName = function () {
    var classes = [];
    if (this.img.classList.contains('hero-logo')) classes.push('hero-logo');
    if (this.img.classList.contains('brand-logo')) classes.push('brand-logo');
    if (this.img.closest && this.img.closest('.footer-brand')) classes.push('footer-logo-canvas');
    classes.push('vaal-eye-canvas');
    return classes.join(' ');
  };

  EyeInstance.prototype._observeSrc = function () {
    var self = this;
    if (typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver(function () {
      self.syncSource();
    });
    this.observer.observe(this.img, { attributes: true, attributeFilter: ['src'] });
  };

  EyeInstance.prototype.syncSource = function () {
    var src = this.img.getAttribute('src') || this.img.src;
    if (!src) return;
    var resolved;
    try {
      resolved = new URL(src, window.location.href).href;
    } catch (_e) {
      return;
    }
    if (resolved === this.currentUrl && this.source) return;
    this.currentUrl = resolved;

    var self = this;
    loadLogoSource(resolved).then(function (data) {
      if (self.currentUrl !== resolved) return;
      self.source = data;
      self._mount();
      self._drawBase();
      self.lastKey = '';
      self.updatePointer();
      self.dirty = true;
      scheduleFrame();
    }).catch(function () {
      if (self.currentUrl !== resolved) return;
      self.source = null;
      self._unmount();
    });
  };

  EyeInstance.prototype._mount = function () {
    if (this.mounted || !this.img.parentNode) return;
    // Avoid replaying entrance animation if the static image already appeared.
    if (this.canvas.classList.contains('hero-logo') && performance.now() - this.createdAt > 150) {
      this.canvas.style.animation = 'none';
    }
    this.img.parentNode.insertBefore(this.canvas, this.img.nextSibling);
    this.img.classList.add('vaal-eye-source-hidden');
    this.mounted = true;
  };

  EyeInstance.prototype._unmount = function () {
    if (!this.mounted) return;
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.img.classList.remove('vaal-eye-source-hidden');
    this.mounted = false;
  };

  EyeInstance.prototype._drawBase = function () {
    if (!this.ctx || !this.source) return;
    this.ctx.clearRect(0, 0, BASE_SIZE, BASE_SIZE);
    this.ctx.drawImage(this.source.baseCanvas, 0, 0);
  };

  EyeInstance.prototype._isVisible = function () {
    if (!this.mounted || document.hidden) return false;
    var rect = this.canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    return rect.bottom > -40 && rect.top < window.innerHeight + 40
      && rect.right > -40 && rect.left < window.innerWidth + 40;
  };

  EyeInstance.prototype.updatePointer = function () {
    if (!this.mounted || prefersReducedMotion()) {
      this.pointerDx = 0;
      this.pointerDy = 0;
      return;
    }
    if (!pointer.active) {
      if (this.pointerDx !== 0 || this.pointerDy !== 0) {
        this.pointerDx = 0;
        this.pointerDy = 0;
        this.dirty = true;
      }
      return;
    }
    var rect = this.canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    var cx = rect.left + rect.width * (EYE_CENTER_X / BASE_SIZE);
    var cy = rect.top + rect.height * (EYE_CENTER_Y / BASE_SIZE);
    var dx = pointer.x - cx;
    var dy = pointer.y - cy;
    var size = Math.max(rect.width, rect.height, 1);
    var distance = Math.max(size, Math.hypot(dx, dy));
    var nextDx = (GAZE_MAX * dx) / distance;
    var nextDy = (GAZE_MAX * dy) / distance;
    if (Math.abs(nextDx - this.pointerDx) >= 0.08 || Math.abs(nextDy - this.pointerDy) >= 0.08) {
      this.pointerDx = nextDx;
      this.pointerDy = nextDy;
      this.dirty = true;
    }
  };

  EyeInstance.prototype._viewportCenterTarget = function () {
    var rect = this.canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return [0, 0];
    var cx = rect.left + rect.width * (EYE_CENTER_X / BASE_SIZE);
    var cy = rect.top + rect.height * (EYE_CENTER_Y / BASE_SIZE);
    var dx = window.innerWidth * 0.5 - cx;
    var dy = window.innerHeight * 0.5 - cy;
    var size = Math.max(rect.width, rect.height, 1);
    var distance = Math.max(size, Math.hypot(dx, dy));
    return [(GAZE_MAX * dx) / distance, (GAZE_MAX * dy) / distance];
  };

  EyeInstance.prototype._scheduleNextBlink = function () {
    var self = this;
    if (this.blinkTimer) window.clearTimeout(this.blinkTimer);
    var delayMs = Math.max(250, Math.round(randRange(BLINK_INTERVAL_MIN, BLINK_INTERVAL_MAX) * 1000));
    this.blinkTimer = window.setTimeout(function () {
      self.blinkTimer = 0;
      if (!prefersReducedMotion() && !document.hidden && self.mode === 'idle' && self._isVisible()) {
        self.triggerBlink();
      }
      self._scheduleNextBlink();
    }, delayMs);
  };

  EyeInstance.prototype._scheduleNextTwitch = function () {
    var self = this;
    if (this.twitchTimer) window.clearTimeout(this.twitchTimer);
    var delayMs = Math.max(1000, Math.round(randRange(TWITCH_INTERVAL_MIN, TWITCH_INTERVAL_MAX) * 1000));
    this.twitchTimer = window.setTimeout(function () {
      self.twitchTimer = 0;
      if (!prefersReducedMotion() && !document.hidden && self.mode === 'idle' && self._isVisible()) {
        self.triggerTwitchLock();
      }
      self._scheduleNextTwitch();
    }, delayMs);
  };

  EyeInstance.prototype.triggerBlink = function () {
    if (prefersReducedMotion() || this.mode === 'twitch_lock' || !this.source) return;
    if (this.stareTimer) {
      window.clearTimeout(this.stareTimer);
      this.stareTimer = 0;
    }
    this.mode = 'blink';
    this.phaseStarted = performance.now();
    this.dirty = true;
    scheduleFrame();
  };

  EyeInstance.prototype.triggerTwitchLock = function () {
    if (prefersReducedMotion() || !this.source) return;
    if (this.stareTimer) {
      window.clearTimeout(this.stareTimer);
      this.stareTimer = 0;
    }
    this.mode = 'twitch_lock';
    this.phaseStarted = performance.now();
    var steps = Math.max(10, Math.round(TWITCH_PHASE_DURATION / TWITCH_STEP_INTERVAL) + 2);
    this.twitchOffsets = buildTwitchSequence(steps);
    var lockTarget = this._viewportCenterTarget();
    this.lockDx = lockTarget[0];
    this.lockDy = lockTarget[1];
    this.dirty = true;
    scheduleFrame();
  };

  EyeInstance.prototype.renderAt = function (nowMs) {
    if (!this.source || !this.ctx || !this.patchImageData || !this.mounted) return false;

    if (prefersReducedMotion()) {
      this.mode = 'idle';
      this._emit(0, 0, 0);
      this.dirty = false;
      return false;
    }

    var dx = this.pointerDx;
    var dy = this.pointerDy;
    var blink = 0.0;
    var needsMoreFrames = false;

    if (this.mode === 'blink') {
      var bElapsed = Math.max(0, (nowMs - this.phaseStarted) / 1000);
      if (bElapsed >= BLINK_DURATION) {
        this.mode = 'idle';
        blink = 0.0;
      } else {
        blink = blinkAmount(bElapsed / BLINK_DURATION);
        needsMoreFrames = true;
      }
    } else if (this.mode === 'twitch_lock') {
      var tElapsed = Math.max(0, (nowMs - this.phaseStarted) / 1000);
      if (tElapsed >= TWITCH_TOTAL_DURATION) {
        this.mode = 'idle';
        blink = 0.0;
      } else if (tElapsed < TWITCH_PHASE_DURATION) {
        var stepIdx = Math.min(this.twitchOffsets.length - 1, Math.floor(tElapsed / TWITCH_STEP_INTERVAL));
        var pair = this.twitchOffsets[stepIdx];
        dx = pair[0];
        dy = pair[1];
        blink = 0.0;
        needsMoreFrames = true;
      } else {
        var tbElapsed = tElapsed - TWITCH_PHASE_DURATION;
        if (tbElapsed < TWITCH_BLINK_DURATION) {
          var prog = tbElapsed / TWITCH_BLINK_DURATION;
          if (prog >= 0.4) {
            dx = this.lockDx;
            dy = this.lockDy;
          } else {
            var lastPair = this.twitchOffsets[this.twitchOffsets.length - 1];
            dx = lastPair[0];
            dy = lastPair[1];
          }
          blink = blinkAmount(prog);
          needsMoreFrames = true;
        } else {
          // Dead-eyed stare: wake once at the end instead of busy-looping rAF.
          dx = this.lockDx;
          dy = this.lockDy;
          blink = 0.0;
          if (!this.stareTimer) {
            var self = this;
            var remainMs = Math.max(16, Math.round((TWITCH_TOTAL_DURATION - tElapsed) * 1000));
            this.stareTimer = window.setTimeout(function () {
              self.stareTimer = 0;
              self.dirty = true;
              scheduleFrame();
            }, remainMs);
          }
        }
      }
    }

    if (this._isVisible()) {
      this._emit(dx, dy, blink);
    }
    this.dirty = false;
    return needsMoreFrames;
  };

  EyeInstance.prototype._emit = function (dx, dy, blink) {
    var qx = Math.round(dx * 8) / 8;
    var qy = Math.round(dy * 8) / 8;
    var qb = Math.round(clamp(blink, 0.0, 1.0) * 100) / 100;
    var key = qx + ',' + qy + ',' + qb;
    if (key === this.lastKey) return;
    this.lastKey = key;
    renderEyePatch(this.source.srcPatch, this.source.lidColors, this.patchImageData.data, qx, qy, qb);
    this.ctx.putImageData(this.patchImageData, PATCH_X0, PATCH_Y0);
  };

  function tickAll(nowMs) {
    rafId = 0;
    var keepGoing = false;
    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i];
      if (inst.dirty || inst.mode !== 'idle') {
        if (inst.renderAt(nowMs)) keepGoing = true;
      }
    }
    if (keepGoing && !document.hidden && !prefersReducedMotion()) {
      rafId = window.requestAnimationFrame(tickAll);
    }
  }

  function updateAllPointers() {
    var anyDirty = false;
    for (var i = 0; i < instances.length; i++) {
      instances[i].updatePointer();
      if (instances[i].dirty) anyDirty = true;
    }
    if (anyDirty) scheduleFrame();
  }

  function attachTargets() {
    var targets = [
      { selector: '#hero-logo', allowTwitch: true },
      { selector: 'img.brand-logo', allowTwitch: false },
      { selector: '.footer-brand img', allowTwitch: false }
    ];
    targets.forEach(function (spec) {
      document.querySelectorAll(spec.selector).forEach(function (img) {
        if (img.dataset.vaalEyeBound === '1') return;
        img.dataset.vaalEyeBound = '1';
        instances.push(new EyeInstance(img, { allowTwitch: spec.allowTwitch }));
      });
    });
  }

  function wireGlobalEvents() {
    window.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch') return;
      pointer.active = true;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      updateAllPointers();
    }, { passive: true });

    window.addEventListener('scroll', function () {
      if (pointer.active) updateAllPointers();
    }, { passive: true });

    window.addEventListener('resize', function () {
      if (pointer.active) updateAllPointers();
    }, { passive: true });

    document.documentElement.addEventListener('mouseleave', function () {
      pointer.active = false;
      updateAllPointers();
    });

    window.addEventListener('blur', function () {
      pointer.active = false;
      updateAllPointers();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        for (var i = 0; i < instances.length; i++) instances[i].dirty = true;
        scheduleFrame();
      }
    });

    if (reducedMotionQuery && typeof reducedMotionQuery.addEventListener === 'function') {
      reducedMotionQuery.addEventListener('change', function () {
        for (var i = 0; i < instances.length; i++) {
          instances[i].mode = 'idle';
          instances[i].dirty = true;
        }
        tickAll(performance.now());
      });
    }
  }

  function refresh() {
    attachTargets();
    for (var i = 0; i < instances.length; i++) {
      instances[i].syncSource();
      instances[i].updatePointer();
      instances[i].dirty = true;
    }
    scheduleFrame();
  }

  function init() {
    attachTargets();
    wireGlobalEvents();
  }

  window.VaalEye = {
    refresh: refresh,
    triggerBlink: function () {
      for (var i = 0; i < instances.length; i++) instances[i].triggerBlink();
    },
    triggerTwitchLock: function () {
      for (var i = 0; i < instances.length; i++) {
        if (instances[i].allowTwitch) instances[i].triggerTwitchLock();
      }
    },
    _debugState: function () {
      return instances.map(function (inst) {
        return {
          cls: inst.canvas.className,
          mounted: inst.mounted,
          mode: inst.mode,
          dx: inst.pointerDx,
          dy: inst.pointerDy,
          lastKey: inst.lastKey
        };
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
