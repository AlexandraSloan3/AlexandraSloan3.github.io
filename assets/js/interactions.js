/*
 * Interactive visual layer.
 *
 * Three independent, deliberately quiet systems:
 *
 *   1. Side fill graphic — a large, cropped, hollow network on the right
 *      edge whose interior fills from the bottom upward as a continuous
 *      boundary tracking page scroll progress. The boundary is an SVG clip
 *      rectangle, so a node it happens to cross is filled only up to that
 *      line rather than switching state.
 *   2. Section reveal — heading opacity/offset and divider width, both
 *      mapped directly to scroll position, both resting at exactly the
 *      site's original appearance.
 *   3. Particle field — a sparse, slow, low-contrast point-and-line graph
 *      behind the content.
 *
 * Nothing here alters the typography, color, or spacing of existing
 * content, and every effect degrades to the original static design when
 * JavaScript is off or reduced motion is requested.
 */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, wait);
    };
  }

  var mqMobile = window.matchMedia("(max-width: 900px)");

  /* =====================================================================
   * 1. Side fill graphic
   * =================================================================== */
  var svg = document.getElementById("side-graphic");
  var fillGrad = document.getElementById("sg-fill-grad");

  var VB_TOP = -40;
  var VB_HEIGHT = 1080; // spans past the viewBox so the sweep never runs out
  var VB_BOTTOM = VB_TOP + VB_HEIGHT;
  var FEATHER = 46; // soft edge, so the boundary reads as material not a scanline

  var fillTarget = 0;
  var fillCurrent = 0;
  var fillRunning = false;

  function scrollProgress() {
    var docH =
      document.documentElement.scrollHeight - window.innerHeight;
    if (docH <= 0) return 0;
    return clamp(window.scrollY / docH, 0, 1);
  }

  function paintFill(p) {
    if (!fillGrad) return;
    // Bottom-up: at p = 0 the boundary sits below the graphic (nothing
    // filled); at p = 1 it has risen past the top. The gradient's two
    // endpoints straddle it, giving the edge its soft transition.
    var edge = VB_BOTTOM - VB_HEIGHT * p;
    fillGrad.setAttribute("y1", (edge - FEATHER / 2).toFixed(1));
    fillGrad.setAttribute("y2", (edge + FEATHER / 2).toFixed(1));
  }

  function fillStep() {
    var diff = fillTarget - fillCurrent;
    if (Math.abs(diff) < 0.0004) {
      fillCurrent = fillTarget;
      paintFill(fillCurrent);
      fillRunning = false;
      return;
    }
    // Light interpolation only — enough to take the stepping out of a
    // trackpad's scroll events, not enough to read as inertia.
    fillCurrent += diff * 0.2;
    paintFill(fillCurrent);
    requestAnimationFrame(fillStep);
  }

  function updateFill() {
    fillTarget = scrollProgress();
    if (reduceMotion) {
      fillCurrent = fillTarget;
      paintFill(fillCurrent);
      return;
    }
    if (!fillRunning) {
      fillRunning = true;
      requestAnimationFrame(fillStep);
    }
  }

  /* =====================================================================
   * 2. Section reveal — headings and dividers
   * =================================================================== */
  var sections = Array.prototype.slice.call(
    document.querySelectorAll("main > section")
  );
  var headings = sections
    .map(function (s) {
      return s.querySelector("h2");
    })
    .filter(Boolean);

  function updateReveal() {
    var vh = window.innerHeight;

    // Headings begin resolving once they are ~15% up from the viewport
    // bottom and are fully settled by the time they reach mid-screen.
    var hStart = vh * 0.85;
    var hEnd = vh * 0.55;
    var hSpan = hStart - hEnd || 1;

    for (var i = 0; i < headings.length; i++) {
      var top = headings[i].getBoundingClientRect().top;
      var p = clamp((hStart - top) / hSpan, 0, 1);
      headings[i].style.setProperty("--p", p.toFixed(3));
    }

    // Dividers draw across as they rise into view, over a scroll distance
    // rather than a fixed duration.
    var dSpan = vh * 0.2;
    for (var j = 0; j < sections.length; j++) {
      var bottom = sections[j].getBoundingClientRect().bottom;
      var d = clamp((vh - bottom) / dSpan, 0, 1);
      sections[j].style.setProperty("--d", d.toFixed(3));
    }
  }

  /* =====================================================================
   * 3. Parallax — side graphic only, never body text
   * =================================================================== */
  function updateParallax() {
    if (!svg || reduceMotion) return;
    var shift = scrollProgress() * 14; // total drift over the whole page
    svg.style.transform = "translateY(" + shift.toFixed(1) + "px)";
  }

  /* =====================================================================
   * Scroll orchestration — one rAF-throttled pass per frame
   * =================================================================== */
  var ticking = false;

  function frame() {
    updateReveal();
    updateFill();
    updateParallax();
    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(frame);
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", debounce(frame, 150), { passive: true });

  if (reduceMotion) {
    // Dividers and headings are already resolved by CSS; only the graphic
    // needs its one-time static fill for the current scroll position.
    updateFill();
  } else {
    frame();
  }

  /* =====================================================================
   * 4. Section entrance — each card rises into place once
   *
   * The hidden state lives behind .js-reveal on <html>, so it only ever
   * exists while this script is running and able to undo it; with
   * JavaScript off, every section is simply visible. Sections already on
   * screen at load are released immediately and without transition, so the
   * first paint is the finished page rather than an empty one filling in.
   * =================================================================== */
  (function sectionReveal() {
    if (!sections.length) return;
    // CSS already resolves these to their final state under reduced motion.
    if (reduceMotion || typeof IntersectionObserver !== "function") return;

    document.documentElement.classList.add("js-reveal");

    var vhNow = window.innerHeight;
    var settled = [];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top < vhNow * 0.92) {
        sections[i].style.transition = "none";
        sections[i].classList.add("is-in");
        settled.push(sections[i]);
      }
    }
    if (settled.length) {
      // Two frames: one for the browser to paint the settled state, one to
      // hand the transition back before any hover or resize can use it.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          for (var j = 0; j < settled.length; j++) {
            settled[j].style.transition = "";
          }
        });
      });
    }

    var io = new IntersectionObserver(
      function (entries) {
        for (var k = 0; k < entries.length; k++) {
          if (!entries[k].isIntersecting) continue;
          entries[k].target.classList.add("is-in");
          io.unobserve(entries[k].target); // one-way; never re-hides on scroll up
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
    );

    for (var m = 0; m < sections.length; m++) {
      if (!sections[m].classList.contains("is-in")) io.observe(sections[m]);
    }
  })();

  /* =====================================================================
   * 5. Research Log — show the newest three, fold the rest
   *
   * The entries themselves are built by Jekyll from the Markdown files in
   * _logs/; this only decides how many of them are on screen. The markup
   * arrives fully expanded with the toggle hidden, so a reader without
   * JavaScript sees every entry and no button that does nothing. Collapsing
   * is therefore the first thing done here, not the resting state of the
   * document.
   *
   * Height is animated rather than max-height: the content's real height is
   * measured each time, so the transition takes the same 250ms whether the
   * fold hides one short entry or forty long ones, instead of stalling on a
   * max-height guess that overshoots.
   * =================================================================== */
  (function researchLog() {
    var more = document.getElementById("log-more");
    var btn = document.getElementById("log-toggle");
    if (!more || !btn) return;

    var LABEL_MORE = "View all research logs ↓";
    var LABEL_LESS = "Show less ↑";
    var DURATION = 250;

    var open = false;
    var timer = null;

    more.style.height = "0px";
    btn.hidden = false;
    btn.textContent = LABEL_MORE;
    btn.setAttribute("aria-expanded", "false");

    function animate(from, to, done) {
      clearTimeout(timer);
      if (reduceMotion) {
        more.style.transition = "";
        more.style.height = to;
        if (done) done();
        return;
      }
      more.style.transition = "";
      more.style.height = from;
      void more.offsetHeight; // commit the start value before transitioning
      more.style.transition = "height " + DURATION + "ms cubic-bezier(0.4, 0, 0.2, 1)";
      more.style.height = to;
      timer = setTimeout(function () {
        more.style.transition = "";
        if (done) done();
      }, DURATION + 40);
    }

    btn.addEventListener("click", function () {
      var measured = more.scrollHeight + "px";
      if (open) {
        open = false;
        btn.textContent = LABEL_MORE;
        btn.setAttribute("aria-expanded", "false");
        animate(measured, "0px");
      } else {
        open = true;
        btn.textContent = LABEL_LESS;
        btn.setAttribute("aria-expanded", "true");
        animate("0px", measured, function () {
          // Released to auto once open, so the panel keeps fitting its
          // content through a resize, a font swap or a zoom change.
          if (open) more.style.height = "auto";
        });
      }
    });
  })();

  /* =====================================================================
   * 6. Particle field
   * =================================================================== */
  (function particles() {
    var canvas = document.getElementById("bg-particles");
    if (!canvas) return;
    if (reduceMotion) {
      canvas.remove();
      return;
    }

    var ctx = canvas.getContext("2d");
    var w = 0;
    var h = 0;
    var dots = [];
    var running = false;
    var queued = false;
    var pointer = { x: -9999, y: -9999, active: false };

    var INK = "64, 70, 76"; // --mesh-rgb, used only at very low opacity

    function isMobile() {
      return mqMobile.matches;
    }

    function rgba(a) {
      return "rgba(" + INK + "," + a.toFixed(3) + ")";
    }

    /* Clustered placement, so the field has genuinely empty regions
       instead of an even scatter that reads as a grid. */
    function seed() {
      var area = w * h;
      var n = isMobile()
        ? clamp(Math.round((25 * area) / (390 * 844)), 12, 25)
        : clamp(Math.round((46 * area) / (1440 * 900)), 30, 55);

      var clusterCount = Math.max(2, Math.round(n / 9));
      var clusters = [];
      for (var c = 0; c < clusterCount; c++) {
        clusters.push({
          x: Math.random() * w,
          y: Math.random() * h,
          spread: 90 + Math.random() * 190,
        });
      }

      dots = [];
      for (var i = 0; i < n; i++) {
        var x, y;
        if (Math.random() < 0.72) {
          var cl = clusters[(Math.random() * clusters.length) | 0];
          x = cl.x + (Math.random() + Math.random() - 1) * cl.spread;
          y = cl.y + (Math.random() + Math.random() - 1) * cl.spread;
        } else {
          x = Math.random() * w;
          y = Math.random() * h;
        }

        var major = Math.random() < 0.18;
        var angle = Math.random() * Math.PI * 2;
        var speed = 0.05 + Math.random() * 0.13; // px per frame

        dots.push({
          x: clamp(x, -30, w + 30),
          y: clamp(y, -30, h + 30),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          ox: 0,
          oy: 0,
          r: major ? 2 + Math.random() * 0.5 : 1 + Math.random() * 0.5,
          a: major ? 0.11 + Math.random() * 0.04 : 0.05 + Math.random() * 0.05,
        });
      }
    }

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    var LINK_R = 92;
    var MAX_LINKS = 2;
    var POINTER_R = 140;
    var MAX_OFFSET = 6;

    function step() {
      queued = false;
      if (!running) return;

      var mobile = isMobile();
      var linkR = mobile ? 95 : LINK_R;

      ctx.clearRect(0, 0, w, h);

      var i, d;

      for (i = 0; i < dots.length; i++) {
        d = dots[i];
        d.x += d.vx;
        d.y += d.vy;

        if (d.x < -30) d.x = w + 30;
        else if (d.x > w + 30) d.x = -30;
        if (d.y < -30) d.y = h + 30;
        else if (d.y > h + 30) d.y = -30;

        // Pointer nudge as a bounded offset that eases back to zero, so
        // the particle's own drift is never permanently altered.
        var tox = 0;
        var toy = 0;
        if (!mobile && pointer.active) {
          var pdx = d.x - pointer.x;
          var pdy = d.y - pointer.y;
          var pd = Math.sqrt(pdx * pdx + pdy * pdy);
          if (pd < POINTER_R && pd > 0.01) {
            var force = (1 - pd / POINTER_R) * MAX_OFFSET;
            tox = (pdx / pd) * force;
            toy = (pdy / pd) * force;
          }
        }
        d.ox += (tox - d.ox) * 0.08;
        d.oy += (toy - d.oy) * 0.08;
      }

      // Connections first, so nodes sit on top of their own lines.
      var linkCount = new Array(dots.length);
      for (i = 0; i < linkCount.length; i++) linkCount[i] = 0;

      ctx.lineWidth = 0.75;
      for (i = 0; i < dots.length; i++) {
        if (linkCount[i] >= MAX_LINKS) continue;
        var a = dots[i];
        var ax = a.x + a.ox;
        var ay = a.y + a.oy;

        for (var j = i + 1; j < dots.length; j++) {
          if (linkCount[i] >= MAX_LINKS) break;
          if (linkCount[j] >= MAX_LINKS) continue;

          var b = dots[j];
          var bx = b.x + b.ox;
          var by = b.y + b.oy;
          var dx = ax - bx;
          var dy = ay - by;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= linkR) continue;

          // Smooth falloff to zero at the threshold — no line ever pops
          // into or out of existence at a hard distance boundary.
          var op = 0.05 * Math.pow(1 - dist / linkR, 1.5);

          if (!mobile && pointer.active) {
            var mx = (ax + bx) / 2 - pointer.x;
            var my = (ay + by) / 2 - pointer.y;
            if (mx * mx + my * my < POINTER_R * POINTER_R) op *= 1.5;
          }

          if (op < 0.004) continue;

          ctx.strokeStyle = rgba(op);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();

          linkCount[i]++;
          linkCount[j]++;
        }
      }

      for (i = 0; i < dots.length; i++) {
        d = dots[i];
        ctx.fillStyle = rgba(d.a);
        ctx.beginPath();
        ctx.arc(d.x + d.ox, d.y + d.oy, d.r, 0, Math.PI * 2);
        ctx.fill();
      }

      request();
    }

    function request() {
      if (running && !queued) {
        queued = true;
        requestAnimationFrame(step);
      }
    }

    function start() {
      if (running) return;
      running = true;
      request();
    }

    function stop() {
      running = false;
    }

    window.addEventListener("resize", debounce(resize, 150), {
      passive: true,
    });

    window.addEventListener(
      "pointermove",
      function (e) {
        if (isMobile() || e.pointerType !== "mouse") return;
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        pointer.active = true;
      },
      { passive: true }
    );

    window.addEventListener("pointerleave", function () {
      pointer.active = false;
    });

    // A hidden tab should not be spending frames on decoration.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else start();
    });

    resize();
    if (!document.hidden) start();
  })();
})();
