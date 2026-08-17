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
    // skip that uncertainty entirely and reveal immediately.
    if (isSufficientlyVisible(el)) {
      el.classList.add("is-visible");
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
function initPageEffects(root) {
  // Belt-and-suspenders: guarantee every fresh page starts fully
  // scrollable, even if a previous page's cleanup was somehow skipped.
  document.documentElement.classList.remove("process-overlay-scroll-lock");
  document.body.classList.remove("process-overlay-scroll-lock");

  const cleanups = [];

  root.querySelectorAll("video[data-playback-rate]").forEach((video) => {
    video.playbackRate = parseFloat(video.dataset.playbackRate);
  });

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
    ".project-images > img, .project-images > video, .project-images-text, .project-description, .info-image1, .info-image2, .info-content",
  );
  if (revealTargets.length > 0) {
    cleanups.push(safeInit(() => initScrollReveal(revealTargets)));
  }

  cleanups.push(safeInit(() => initProcessOverlay(root)));

  return () => cleanups.forEach((cleanup) => cleanup());
}
