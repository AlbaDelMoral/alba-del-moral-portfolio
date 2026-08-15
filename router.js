// Client-side content swap — keeps .menu (the persistent nav overlay)
// completely untouched across navigations and only ever replaces
// #page-content. Every page is still a fully standalone, correct HTML
// document on its own (direct loads / no-JS all work normally); this is
// progressive enhancement on top of that.

let currentCleanup = () => {};
let inFlightController = null;

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
