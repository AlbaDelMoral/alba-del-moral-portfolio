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
  if (slides.length <= 1) return;

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
    return;
  }

  // First slide gets its own (shorter) timeout, then every slide after
  // that follows the regular interval.
  setTimeout(() => {
    advance();
    setInterval(advance, intervalMs);
  }, firstIntervalMs);
}

function initHorizontalScroll(container) {
  // Turns vertical wheel input into horizontal scroll on this container.
  // Only intercepts the wheel event while there's still room to scroll in
  // that direction — once the strip hits its start/end edge, the event is
  // left alone so the page's normal vertical scroll takes back over.
  container.addEventListener(
    "wheel",
    (event) => {
      const atStart = container.scrollLeft <= 0;
      const atEnd =
        container.scrollLeft >=
        container.scrollWidth - container.clientWidth - 1;
      const scrollingForward = event.deltaY > 0;

      if ((atEnd && scrollingForward) || (atStart && !scrollingForward)) {
        return;
      }

      event.preventDefault();
      container.scrollLeft += event.deltaY;
    },
    { passive: false },
  );
}

function initHoverCaption(caption, trigger) {
  trigger.addEventListener("mouseenter", () => {
    caption.classList.add("visible");
  });

  trigger.addEventListener("mousemove", (event) => {
    caption.style.left = `${event.clientX}px`;
    caption.style.top = `${event.clientY}px`;
  });

  trigger.addEventListener("mouseleave", () => {
    caption.classList.remove("visible");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // Any <video data-playback-rate="0.5"> plays at that speed instead of 1x.
  document.querySelectorAll("video[data-playback-rate]").forEach((video) => {
    video.playbackRate = parseFloat(video.dataset.playbackRate);
  });

  document.querySelectorAll(".slideshow").forEach((container) => {
    const intervalMs = readCssVar(container, "--slide-interval", 8000);
    const firstIntervalMs = readCssVar(
      container,
      "--first-slide-interval",
      3000,
    );
    initSlideshow(container, intervalMs, firstIntervalMs);
  });

  const caption = document.querySelector(".hover-caption");
  const trigger = document.querySelector("[data-hover-trigger]");
  if (caption && trigger) initHoverCaption(caption, trigger);

  document
    .querySelectorAll("[data-horizontal-scroll]")
    .forEach(initHorizontalScroll);
});
