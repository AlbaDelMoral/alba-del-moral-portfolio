// Client-side content swap — keeps .menu (the persistent nav overlay)
// completely untouched across navigations and only ever replaces
// #page-content. Every page is still a fully standalone, correct HTML
// document on its own (direct loads / no-JS all work normally); this is
// progressive enhancement on top of that.

let currentCleanup = () => {};
let inFlightController = null;

// Shown for a link-driven navigation that's actually taking a moment
// (fetch + DOM swap), so the visitor sees a loading frame instead of a
// blank page during that gap. Lives outside #page-content (see
// .page-loader in styles.css), so it's untouched by the swap itself.
//
// scheduleLoader doesn't show it immediately — it waits LOADER_SHOW_DELAY_MS
// first, so a navigation that finishes before that delay (the common case
// for local fetches) never flashes the loader at all. hideLoader always
// cancels that pending timer, so a fast load just never shows it; a slow
// one shows it and then fades it out (via .page-loader's own opacity
// transition) the moment the swap is ready — no artificial minimum stay.
const LOADER_SHOW_DELAY_MS = 150;
let loaderShowTimer = null;

function scheduleLoader() {
  clearTimeout(loaderShowTimer);
  loaderShowTimer = setTimeout(() => {
    document.getElementById("pageLoader")?.classList.add("is-visible");
  }, LOADER_SHOW_DELAY_MS);
}

function hideLoader() {
  clearTimeout(loaderShowTimer);
  document.getElementById("pageLoader")?.classList.remove("is-visible");
}

// Downloads every <img> the new page needs into the browser's HTTP cache
// *before* the swap happens — not after. A detached DOMParser node
// doesn't fetch its images at all, so this uses plain `new Image()`
// requests instead (resolved against `baseHref`, since a parsed
// document's own base URL isn't reliable across browsers). This is what
// makes the swap (and the reveal animation initPageEffects kicks off
// as part of it) only happen once everything is actually ready: the
// <img> elements that land in the live DOM a moment later just paint
// instantly from cache, instead of trickling in underneath — and behind
// — an entrance animation that already started. Capped at `timeoutMs` so
// one stuck/failed image can't leave the loader on screen forever.
function preloadImages(root, baseHref, timeoutMs = 15000) {
  const srcs = Array.from(root.querySelectorAll("img"))
    .map((img) => img.getAttribute("src"))
    .filter(Boolean)
    .map((src) => new URL(src, baseHref).href);

  if (srcs.length === 0) return Promise.resolve();

  return Promise.race([
    Promise.all(
      srcs.map(
        (src) =>
          new Promise((resolve) => {
            const img = new Image();
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
            img.src = src;
          }),
      ),
    ),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function updateActiveNav(pathname) {
  document
    .querySelectorAll(".menu .active")
    .forEach((el) => el.classList.remove("active"));

  const file = pathname.split("/").pop() || "index.html";

  if (file === "index.html") {
    document.querySelector(".logo-link")?.classList.add("active");
  }
  if (file === "index.html" || file.startsWith("project-")) {
    document.querySelector(".nav-works")?.classList.add("active");
  }
  if (file === "archive.html") {
    document.querySelector(".nav-archive")?.classList.add("active");
  }
  if (file === "info.html") {
    document.querySelector(".nav-info")?.classList.add("active");
  }

  document
    .querySelector(`.nav-work-item[href="${file}"]`)
    ?.classList.add("active");
}

async function navigateTo(href, { push }) {
  if (inFlightController) inFlightController.abort();
  const controller = new AbortController();
  inFlightController = controller;

  let html;
  try {
    const response = await fetch(href, { signal: controller.signal });
    if (!response.ok) throw new Error(`Bad response: ${response.status}`);
    html = await response.text();
  } catch (err) {
    if (err.name === "AbortError") return;
    window.location.href = href;
    return;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const newContent = doc.getElementById("page-content");
  const currentContent = document.getElementById("page-content");
  if (!newContent || !currentContent) {
    window.location.href = href;
    return;
  }

  if (push) history.pushState(null, "", href);

  // Wait for the new page's images before swapping at all — see
  // preloadImages above for why this has to happen before, not after.
  await preloadImages(newContent, href);

  // A newer navigation may have started (and aborted this one's fetch)
  // while that preload was in flight; bail instead of swapping in now
  // out-of-date content.
  if (controller.signal.aborted) return;

  const applySwap = () => {
    currentCleanup();
    document.title = doc.title;
    document.body.dataset.page = doc.body.dataset.page || "";
    currentContent.replaceWith(newContent);
    window.scrollTo(0, 0);
    currentCleanup = initPageEffects(newContent);
    updateActiveNav(new URL(href, window.location.href).pathname);
  };

  if (document.startViewTransition) {
    document.startViewTransition(applySwap);
  } else {
    applySwap();
  }

  hideLoader();
}

function handleClick(event) {
  const link = event.target.closest("a");
  if (!link) return;
  if (link.target && link.target !== "_self") return;
  if (link.hasAttribute("download")) return;
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  const href = link.getAttribute("href");
  if (!href || href.startsWith("#")) return;

  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return;
  if (url.pathname === window.location.pathname) return;

  event.preventDefault();
  scheduleLoader();
  navigateTo(url.href, { push: true });
}

document.addEventListener("click", handleClick);
window.addEventListener("popstate", () => {
  navigateTo(window.location.href, { push: false });
});

document.addEventListener("DOMContentLoaded", () => {
  currentCleanup = initPageEffects(document);
  updateActiveNav(window.location.pathname);
});
