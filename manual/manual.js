/* Chinese: Local search and chapter navigation; no network or persistence.
 * English: Progressive enhancement keeps the entire manual readable without JavaScript. */
(() => {
  "use strict";
  document.documentElement.classList.add("has-js");
  const toc = document.querySelector("#toc");
  const mobile = window.matchMedia("(max-width: 820px)");
  const chapters = [...document.querySelectorAll(".chapter")];
  const links = [...document.querySelectorAll('.toc nav a[href^="#"]')];
  const form = document.querySelector("#manual-search");
  const input = document.querySelector("#search-input");
  const clear = document.querySelector("#clear-search");
  const results = document.querySelector("#search-results");
  const list = document.querySelector("#search-list");
  const status = document.querySelector("#search-status");
  const printButton = document.querySelector("#print-manual");
  const normalize = (value) => value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const index = chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.querySelector("h2").textContent,
    text: chapter.textContent.replace(/\s+/g, " ").trim(),
    keywords: chapter.dataset.keywords || "",
  }));
  const applyTocLayout = () => { toc.open = !mobile.matches; };
  applyTocLayout();
  mobile.addEventListener("change", applyTocLayout);
  form.hidden = false;
  printButton.hidden = false;

  function renderSearch() {
    const query = normalize(input.value);
    clear.hidden = !query;
    results.hidden = !query;
    list.replaceChildren();
    if (!query) { status.textContent = ""; return; }
    const tokens = query.split(" ");
    const matches = index.filter((entry) => tokens.every((token) => normalize(`${entry.title} ${entry.keywords} ${entry.text}`).includes(token)))
      .sort((a, b) => Number(normalize(b.title).includes(query)) - Number(normalize(a.title).includes(query)));
    status.textContent = matches.length ? `找到 ${matches.length} 个相关章节，点击跳转。` : "没有找到相关章节。试试「传书」「字体」「Anki」或使用目录。";
    for (const entry of matches) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${entry.id}`;
      const title = document.createElement("strong");
      title.textContent = entry.title;
      const snippet = document.createElement("span");
      const matchAt = normalize(entry.text).indexOf(tokens[0]);
      const from = Math.max(0, matchAt - 28);
      snippet.textContent = `${from ? "…" : ""}${entry.text.slice(from, from + 100)}${entry.text.length > from + 100 ? "…" : ""}`;
      link.append(title, snippet);
      link.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        for (const detail of document.querySelectorAll(`#${entry.id} details`)) detail.open = true;
        resetSearch();
        navigateToChapter(event, entry.id);
      });
      item.append(link);
      list.append(item);
    }
  }
  function resetSearch() { input.value = ""; renderSearch(); }
  function navigateToChapter(event, id) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const chapter = document.getElementById(id);
    const heading = chapter?.querySelector("h2");
    if (!chapter || !heading) return;
    event.preventDefault();
    if (mobile.matches) toc.open = false;
    if (window.location.hash !== `#${id}`) window.history.pushState(null, "", `#${id}`);
    chapter.scrollIntoView({ block: "start" });
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  input.addEventListener("input", renderSearch);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); resetSearch(); }
  });
  clear.addEventListener("click", () => { resetSearch(); input.focus(); });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const first = list.querySelector("a");
    if (first) first.click();
  });
  for (const link of links) {
    link.addEventListener("click", (event) => navigateToChapter(event, link.hash.slice(1)));
  }

  let framePending = false;
  function updateChapter() {
    framePending = false;
    let current = chapters[0].id;
    for (const chapter of chapters) {
      if (chapter.getBoundingClientRect().top <= (mobile.matches ? 180 : 145)) current = chapter.id;
    }
    for (const link of links) {
      if (link.hash === `#${current}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  }
  function scheduleChapter() {
    if (!framePending) { framePending = true; requestAnimationFrame(updateChapter); }
  }
  window.addEventListener("scroll", scheduleChapter, { passive: true });
  window.addEventListener("resize", scheduleChapter, { passive: true });
  updateChapter();

  let closedBeforePrint = [];
  function preparePrint() {
    if (closedBeforePrint.length) return;
    closedBeforePrint = [...document.querySelectorAll("main details:not([open])")];
    for (const detail of closedBeforePrint) detail.open = true;
  }
  window.addEventListener("beforeprint", preparePrint);
  window.addEventListener("afterprint", () => {
    for (const detail of closedBeforePrint) detail.open = false;
    closedBeforePrint = [];
  });
  printButton.addEventListener("click", () => { preparePrint(); window.print(); });
})();
