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

function initScrollReveal(elements) {
  // Each element starts hidden (see the CSS opposite .is-visible) and
  // fades/slides into place the first time it crosses into the viewport.
  // unobserve() after the first reveal so it doesn't re-trigger on
  // scroll-back — a one-time entrance, not a repeating scroll effect.
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.15 },
  );

  elements.forEach((el) => observer.observe(el));
  return () => observer.disconnect();
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

// Wires up every dynamic behavior scoped to `root` (either the whole
// document on first load, or just the freshly-swapped #page-content
// subtree after a client-side navigation) and returns a single cleanup
// function that undoes all of it — router.js calls this cleanup right
// before the next swap so intervals/observers/listeners never pile up
// on detached DOM from earlier page visits.
function initPageEffects(root) {
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
    cleanups.push(initSlideshow(container, intervalMs, firstIntervalMs));
  });

  const caption = root.querySelector(".hover-caption");
  const trigger = root.querySelector("[data-hover-trigger]");
  if (caption && trigger) {
    cleanups.push(initHoverCaption(caption, trigger));
  }

  const revealTargets = root.querySelectorAll(
    ".project-images > img, .project-images > video, .project-images-text, .project-description",
  );
  if (revealTargets.length > 0) {
    cleanups.push(initScrollReveal(revealTargets));
  }

  return () => cleanups.forEach((cleanup) => cleanup());
}
