// Scroll-driven slideshow (Archive > photography) — images stay pinned in
// place; wheel input advances/retreats through them instead of scrolling
// the page. One step per gesture: a lock blocks further advances until the
// crossfade finishes, so a single trackpad swipe doesn't skip several. The
// filmstrip (column 8) rides along: its track is translated so the current
// thumb is always vertically centered, matching the main image.
function initScrollSlideshow(container, filmstrip) {
  const slides = Array.from(container.querySelectorAll(".scroll-slide"));
  if (slides.length <= 1) return () => {};

  const track = filmstrip
    ? filmstrip.querySelector(".scroll-filmstrip-track")
    : null;
  const thumbs = track
    ? Array.from(track.querySelectorAll(".scroll-filmstrip-thumb"))
    : [];

  // Optional counter ("1/7") and shot-location overlays — not every page
  // using this component has them, so both lookups are null-safe.
  const archiveView = container.closest(".archive-view");
  const counterEl = archiveView?.querySelector(".photo-counter") ?? null;
  const locationEl = archiveView?.querySelector(".photo-location") ?? null;

  let current = 0;
  let locked = false;
  let unlockTimer = null;

  function centerThumb(index) {
    if (!track || !thumbs[index]) return;
    const thumb = thumbs[index];
    const targetCenter = thumb.offsetTop + thumb.offsetHeight / 2;
    track.style.transform = `translateY(${filmstrip.clientHeight / 2 - targetCenter}px)`;
  }

  function updateMeta(index) {
    if (counterEl) counterEl.textContent = `${index + 1}/${slides.length}`;
    if (locationEl) locationEl.textContent = slides[index].dataset.location ?? "";
  }

  function goTo(index) {
    if (index < 0 || index >= slides.length || index === current) return;
    slides[current].classList.remove("active");
    thumbs[current]?.classList.remove("active");
    current = index;
    slides[current].classList.add("active");
    thumbs[current]?.classList.add("active");
    centerThumb(current);
    updateMeta(current);
    syncVideoPlayback(slides);
  }

  // A single trackpad flick fires many wheel events over its whole
  // duration, not just one — so "unlock 600ms after the first event"
  // could still let a second step sneak in on a long/fast flick. Instead
  // every event while locked pushes the unlock back out, so the lock only
  // releases once the gesture has actually gone quiet for a beat,
  // regardless of how long the gesture itself lasted.
  function onWheel(event) {
    event.preventDefault();
    // Trackpads often lead a gesture with one or two near-zero deltaY
    // events before ramping up. `deltaY > 0 ? 1 : -1` would read one of
    // those as "up" (since 0 isn't > 0), setting the lock in the wrong
    // direction and eating the rest of the real gesture — which reads as
    // the scroll "not being recognized". Ignoring anything below a small
    // threshold means the lock only ever gets set by a delta that
    // actually indicates a direction.
    if (Math.abs(event.deltaY) < 2) return;
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => {
      locked = false;
    }, 130);
    if (locked) return;
    locked = true;
    goTo(current + (event.deltaY > 0 ? 1 : -1));
  }

  // Up/down arrow keys step through the same as one wheel notch.
  function onKeydown(event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    goTo(current + (event.key === "ArrowDown" ? 1 : -1));
  }

  // Touch swipe — mobile devices don't fire wheel events at all, so
  // without this a swipe just scrolls the page underneath instead of
  // navigating the slideshow (nothing else here claims the gesture).
  // touchmove's preventDefault is what actually stops that page scroll;
  // direction/step is decided on touchend, once the full gesture length
  // is known, same one-step-per-gesture idea as onWheel.
  let touchStartY = null;
  function onTouchStart(event) {
    touchStartY = event.touches[0].clientY;
  }
  function onTouchMove(event) {
    if (touchStartY === null) return;
    event.preventDefault();
  }
  function onTouchEnd(event) {
    if (touchStartY === null) return;
    const deltaY = touchStartY - event.changedTouches[0].clientY;
    touchStartY = null;
    if (Math.abs(deltaY) < 24) return; // ignore taps/jitter, not real swipes
    goTo(current + (deltaY > 0 ? 1 : -1));
  }

  // Clicking a thumbnail jumps straight to that photo instead of
  // scrolling one by one.
  const onThumbClick = (index) => () => goTo(index);
  const thumbClickHandlers = thumbs.map((thumb, index) => {
    const handler = onThumbClick(index);
    thumb.style.cursor = "pointer";
    thumb.addEventListener("click", handler);
    return handler;
  });

  centerThumb(current);
  updateMeta(current);
  syncVideoPlayback(slides);
  // Belt-and-suspenders alongside touchmove's preventDefault above: locks
  // html/body scroll outright for as long as this page is active, so
  // there's nothing for a swipe to fall through to and scroll even if a
  // gesture starts somewhere preventDefault doesn't fully reach (e.g. an
  // iOS rubber-band/overscroll bounce, which can trigger independent of
  // whether the page actually has real overflow to scroll).
  document.documentElement.classList.add("process-overlay-scroll-lock");
  document.body.classList.add("process-overlay-scroll-lock");
  // Listens on the whole document, not just `container` — the slideshow
  // frame only fills part of the viewport, so a listener scoped to it
  // only caught wheel events while the cursor was exactly over the image.
  document.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd);
  return () => {
    clearTimeout(unlockTimer);
    document.documentElement.classList.remove("process-overlay-scroll-lock");
    document.body.classList.remove("process-overlay-scroll-lock");
    document.removeEventListener("wheel", onWheel);
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
    thumbs.forEach((thumb, index) =>
      thumb.removeEventListener("click", thumbClickHandlers[index]),
    );
  };
}

function readCssVar(el, name, fallback) {
  // getComputedStyle resolves the cascade for this specific element, so
  // a slideshow container that locally overrides --slide-interval (e.g.
  // .risk-slideshow) picks up its own value instead of always falling
  // back to the :root default.
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const value = parseFloat(raw);
  return Number.isNaN(value) ? fallback : value;
}

function syncVideoPlayback(slides) {
  // Only the active slide's video should actually be decoding/playing —
  // an autoplay-looping video sitting behind an inactive (invisible)
  // slide just wastes GPU/decode resources for no visible benefit.
  slides.forEach((slide) => {
    if (slide.tagName !== "VIDEO") return;
    if (slide.classList.contains("active")) {
      slide.play().catch(() => {});
    } else {
      slide.pause();
    }
  });
}

function initSlideshow(container, intervalMs, firstIntervalMs) {
  const slides = Array.from(container.querySelectorAll(".slide"));
  if (slides.length <= 1) return () => {};

  let current = 0;
  const advance = () => {
    slides[current].classList.remove("active");
    current = (current + 1) % slides.length;
    slides[current].classList.add("active");
    syncVideoPlayback(slides);
  };

  syncVideoPlayback(slides);

  // .click-advance containers only move to the next slide when clicked —
  // no automatic timer at all.
  if (container.classList.contains("click-advance")) {
    container.addEventListener("click", advance);
    return () => container.removeEventListener("click", advance);
  }

  // First slide gets its own (shorter) timeout, then every slide after
  // that follows the regular interval.
  let intervalId;
  const timeoutId = setTimeout(() => {
    advance();
    intervalId = setInterval(advance, intervalMs);
  }, firstIntervalMs);

  return () => {
    clearTimeout(timeoutId);
    clearInterval(intervalId);
  };
}

// Mirrors the observer's own threshold (0.15): is at least 15% of `el`'s
// own height currently within the viewport? Used to reveal already-visible
// elements immediately, synchronously, instead of waiting on
// IntersectionObserver's first callback (see initScrollReveal below).
function isSufficientlyVisible(el) {
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0) return false; // not laid out yet (e.g. image still loading) — let the observer catch it once it has real size
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const visibleHeight =
    Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
  return visibleHeight / rect.height >= 0.15;
}

function initScrollReveal(elements) {
  // Each element starts hidden (see the CSS opposite .is-visible) and
  // fades/slides into place the first time it crosses into the viewport.
  // unobserve() after the first reveal so it doesn't re-trigger on
  // scroll-back — a one-time entrance, not a repeating scroll effect.
  const pending = new Set();

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) reveal(entry.target);
      });
    },
    { threshold: 0.15 },
  );

  function reveal(el) {
    el.classList.add("is-visible");
    pending.delete(el);
    observer.unobserve(el);
  }

  elements.forEach((el) => {
    // IntersectionObserver's first callback for a freshly-observed element
    // is asynchronous and can be delayed under main-thread load (e.g. a
    // big image still decoding right after a page navigation) — long
    // enough that above-the-fold content can sit invisible for a
    // noticeable beat. Elements already in view when we land on the page
    // skip that uncertainty entirely instead of waiting on the observer —
    // but reveal after --reveal-delay (0 on desktop), not instantly:
    // on mobile especially, this fires right as the new page's content is
    // still settling in, so an instant class-add can coincide with (and
    // get swallowed by) that same repaint, making the entrance look like
    // it never played at all rather than an actual fade/slide-in.
    if (isSufficientlyVisible(el)) {
      const delay = readCssVar(el, "--reveal-delay", 0);
      setTimeout(() => el.classList.add("is-visible"), delay);
      return;
    }
    pending.add(el);
    observer.observe(el);
  });

  // Backstop for cases where IntersectionObserver's callback never fires
  // or gets delayed indefinitely (browsers can throttle it heavily for a
  // backgrounded/unfocused tab, and it's not the only way this could go
  // wrong) — re-checks every still-hidden element directly against actual
  // viewport geometry on scroll, independent of the observer entirely.
  // Throttled with setTimeout rather than requestAnimationFrame — rAF is
  // fully paused (not just throttled) on a backgrounded tab, which would
  // silently defeat the very case this backstop exists for. Only does
  // anything while elements are still pending, and stops listening the
  // moment everything's revealed.
  let ticking = false;
  function onScroll() {
    if (ticking || pending.size === 0) return;
    ticking = true;
    setTimeout(() => {
      ticking = false;
      pending.forEach((el) => {
        if (isSufficientlyVisible(el)) reveal(el);
      });
      if (pending.size === 0) {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      }
    }, 100);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  return () => {
    observer.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
  };
}


function initHoverCaption(caption, trigger) {
  const onEnter = () => caption.classList.add("visible");
  const onMove = (event) => {
    caption.style.left = `${event.clientX}px`;
    caption.style.top = `${event.clientY}px`;
  };
  const onLeave = () => caption.classList.remove("visible");

  trigger.addEventListener("mouseenter", onEnter);
  trigger.addEventListener("mousemove", onMove);
  trigger.addEventListener("mouseleave", onLeave);

  return () => {
    trigger.removeEventListener("mouseenter", onEnter);
    trigger.removeEventListener("mousemove", onMove);
    trigger.removeEventListener("mouseleave", onLeave);
  };
}

// Project pages' background videos (autoplay, muted, no audio track).
// Chrome's power-saving policy actively pauses "video-only" autoplaying
// media it considers backgrounded — confirmed via the exact rejection:
// `AbortError: ... paused to save power`. That's separate from the usual
// autoplay-permission story (muted+autoplay is otherwise honored fine)
// and isn't a one-time thing to just retry harder up front: it can fire
// any time the tab loses/regains focus. So this keeps trying — once on
// init, again whenever the tab becomes visible, and again whenever a
// video actually scrolls into view (the two situations Chrome's policy
// cares about) — rather than a single attempt that silently gives up.
function initAutoplayVideos(root) {
  const videos = Array.from(
    root.querySelectorAll(".project-images video[autoplay]"),
  );
  if (videos.length === 0) return () => {};

  const tryPlay = (video) => {
    video.muted = true;
    if (video.paused) video.play().catch(() => {});
  };

  videos.forEach(tryPlay);

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") videos.forEach(tryPlay);
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) tryPlay(entry.target);
    });
  });
  videos.forEach((video) => observer.observe(video));

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    observer.disconnect();
  };
}

// Mobile nav toggle — same persistent-markup situation as the process
// toggle below: .mobile-nav-toggle lives in .menu, which router.js never
// replaces, so this looks it up on `document` (not `root`) and re-runs
// on every navigation, resetting to closed each time. Without that
// reset, following a link from inside the open overlay would carry
// "open" into whatever page loads next, since the toggle/menu elements
// themselves never get re-created.
function initMobileNav() {
  const toggle = document.getElementById("mobileNavToggle");
  const menu = document.querySelector(".menu");
  const bar = document.querySelector(".mobile-nav-bar");
  if (!toggle || !menu) return () => {};

  menu.classList.remove("is-nav-open");
  toggle.setAttribute("aria-expanded", "false");
  // .mobile-nav-bar is position:fixed on mobile (see styles.css), so
  // .nav-column (also fixed, when open) needs its real rendered height
  // to know where to start below it — this is only reachable at runtime,
  // not something a CSS-only value could express reliably.
  if (bar) {
    document.documentElement.style.setProperty(
      "--mobile-nav-bar-height",
      `${bar.getBoundingClientRect().height}px`,
    );
  }
  // Belt-and-suspenders, same as initProcessOverlay below — guarantees a
  // fresh page never inherits a stale lock from a skipped cleanup.
  document.documentElement.classList.remove("process-overlay-scroll-lock");
  document.body.classList.remove("process-overlay-scroll-lock");

  const setLocked = (isLocked) => {
    document.documentElement.classList.toggle(
      "process-overlay-scroll-lock",
      isLocked,
    );
    document.body.classList.toggle("process-overlay-scroll-lock", isLocked);
  };

  const onToggleClick = () => {
    const isOpen = menu.classList.toggle("is-nav-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
    setLocked(isOpen);
  };

  toggle.addEventListener("click", onToggleClick);
  return () => {
    toggle.removeEventListener("click", onToggleClick);
    setLocked(false);
  };
}

// The "Look at info and process" button lives in .menu, which router.js
// never replaces — only #page-content is swapped. So this has to be
// re-run after every navigation (initPageEffects already does that) and
// has to look the button up on `document`, not `root`, since it's never
// inside the swapped-in subtree.
function initProcessOverlay(root) {
  const toggle = document.getElementById("processToggle");
  if (!toggle) return () => {};

  const label = toggle.querySelector(".process-toggle-label");

  // Reset to a clean, closed state every time — without this, a button
  // left mid-"open" on one project would carry that stale label/state
  // into whatever page loads next, since the button itself never resets.
  toggle.classList.remove("is-open");
  toggle.setAttribute("aria-pressed", "false");
  if (label) label.textContent = "Look at info and process";

  const overlay = root.querySelector(".process-overlay");
  if (!overlay) {
    // This page has no process overlay (home/archive/info) — hide the
    // button instead of leaving a dead control behind from whatever
    // project the visitor was on before navigating here.
    toggle.hidden = true;
    return () => {};
  }

  toggle.hidden = false;
  overlay.hidden = true;
  overlay.classList.remove("is-open");

  const backdrop = overlay.querySelector(".process-overlay-backdrop");
  // Only the fixed/internally-scrolling variant needs the page underneath
  // locked — the default variant is meant to scroll along with the page.
  const isFixedScroll = overlay.classList.contains(
    "process-overlay--fixed-scroll",
  );
  let hideTimer = null;

  function setOpen(isOpen) {
    clearTimeout(hideTimer);
    toggle.classList.toggle("is-open", isOpen);
    toggle.setAttribute("aria-pressed", String(isOpen));
    if (label) {
      label.textContent = isOpen
        ? "Close info and process"
        : "Look at info and process";
    }
    if (isFixedScroll) {
      // Locking body alone doesn't actually stop the page from
      // scrolling — in standards mode document.scrollingElement is
      // <html>, so that's the one that needs overflow:hidden too.
      document.documentElement.classList.toggle(
        "process-overlay-scroll-lock",
        isOpen,
      );
      document.body.classList.toggle("process-overlay-scroll-lock", isOpen);
    }

    if (isOpen) {
      overlay.hidden = false;
      // For the fixed/internally-scrolling variant (see
      // .process-overlay--fixed-scroll in styles.css), always start back
      // at the top (the text) rather than wherever it was scrolled to
      // the last time it was open.
      overlay.scrollTop = 0;
      // Force a synchronous reflow so the browser commits the
      // pre-transition (hidden) state before .is-open is added — more
      // reliable than requestAnimationFrame, which browsers can throttle
      // or pause on backgrounded/inactive tabs.
      void overlay.offsetHeight;
      overlay.classList.add("is-open");
    } else {
      overlay.classList.remove("is-open");
      hideTimer = setTimeout(() => {
        overlay.hidden = true;
      }, 500);
    }
  }

  const onToggleClick = () => setOpen(overlay.hidden);
  const onBackdropClick = () => setOpen(false);

  toggle.addEventListener("click", onToggleClick);
  backdrop.addEventListener("click", onBackdropClick);

  return () => {
    clearTimeout(hideTimer);
    toggle.removeEventListener("click", onToggleClick);
    backdrop.removeEventListener("click", onBackdropClick);
    // In case a navigation happens while the overlay is still open —
    // don't leave the page underneath permanently unscrollable.
    if (isFixedScroll) {
      document.documentElement.classList.remove("process-overlay-scroll-lock");
      document.body.classList.remove("process-overlay-scroll-lock");
    }
  };
}

// Runs `fn`, catching and logging any error instead of letting it escape.
// Without this, one initializer throwing (e.g. process overlay markup
// missing a piece on some page) would abort initPageEffects entirely —
// skipping every initializer after it (reveal animations included) and,
// worse, throwing out of the assignment in router.js's applySwap(), so
// currentCleanup never gets updated to the new page's cleanup. The next
// navigation would then run a *stale* (previous-previous page's) cleanup
// instead, leaving this page's listeners/observers/scroll-lock stuck
// around indefinitely. Each initializer is independent, so one failing
// should never take the others down with it.
function safeInit(fn) {
  try {
    return fn() || (() => {});
  } catch (err) {
    console.error(err);
    return () => {};
  }
}

// Wires up every dynamic behavior scoped to `root` (either the whole
// document on first load, or just the freshly-swapped #page-content
// subtree after a client-side navigation) and returns a single cleanup
// function that undoes all of it — router.js calls this cleanup right
// before the next swap so intervals/observers/listeners never pile up
// on detached DOM from earlier page visits.
// Injects the 8 .debug-grid-col bars into .menu once — hidden by default
// via --debug-grid-opacity (see styles.css). .menu is never replaced by
// router.js, so this only needs to run once; the check makes repeat calls
// a no-op instead of duplicating it.
function initDebugGrid() {
  const menu = document.querySelector(".menu");
  if (!menu || menu.querySelector(".debug-grid")) return;
  const grid = document.createElement("div");
  grid.className = "debug-grid";
  for (let i = 0; i < 8; i++) {
    grid.appendChild(document.createElement("div")).className =
      "debug-grid-col";
  }
  menu.prepend(grid);
}

function initPageEffects(root) {
  // Belt-and-suspenders: guarantee every fresh page starts fully
  // scrollable, even if a previous page's cleanup was somehow skipped.
  document.documentElement.classList.remove("process-overlay-scroll-lock");
  document.body.classList.remove("process-overlay-scroll-lock");

  safeInit(initDebugGrid);

  const cleanups = [];

  root.querySelectorAll("video[data-playback-rate]").forEach((video) => {
    video.playbackRate = parseFloat(video.dataset.playbackRate);
  });

  cleanups.push(safeInit(() => initAutoplayVideos(root)));

  root.querySelectorAll(".slideshow").forEach((container) => {
    const intervalMs = readCssVar(container, "--slide-interval", 8000);
    const firstIntervalMs = readCssVar(
      container,
      "--first-slide-interval",
      3000,
    );
    cleanups.push(
      safeInit(() => initSlideshow(container, intervalMs, firstIntervalMs)),
    );
  });

  const caption = root.querySelector(".hover-caption");
  const trigger = root.querySelector("[data-hover-trigger]");
  if (caption && trigger) {
    cleanups.push(safeInit(() => initHoverCaption(caption, trigger)));
  }

  const revealTargets = root.querySelectorAll(
    ".project-images > img, .project-images > video, .project-images-text, .project-description, .info-image1, .info-image2, .info-content, .scroll-slideshow, .scroll-filmstrip, .photo-meta-overlay",
  );
  // No entrance animation on mobile at all now (see styles.css) — after
  // several attempts (CSS animation-timeline, GSAP/ScrollTrigger, a
  // custom IntersectionObserver system), none held up reliably on real
  // phones, and the last version was suspected of contributing to
  // videos not autoplaying (an opacity:0, not-yet-revealed video can get
  // its playback suspended by the same mobile power-saving behavior
  // that affects backgrounded video generally). Desktop keeps its
  // original, unaffected reveal system.
  if (
    revealTargets.length > 0 &&
    !window.matchMedia("(max-width: 1100px)").matches
  ) {
    cleanups.push(safeInit(() => initScrollReveal(revealTargets)));
  }

  const scrollSlideshow = root.querySelector(".scroll-slideshow");
  if (scrollSlideshow) {
    const filmstrip = root.querySelector(".scroll-filmstrip");
    cleanups.push(
      safeInit(() => initScrollSlideshow(scrollSlideshow, filmstrip)),
    );
  }

  cleanups.push(safeInit(initMobileNav));
  cleanups.push(safeInit(() => initProcessOverlay(root)));

  return () => cleanups.forEach((cleanup) => cleanup());
}
