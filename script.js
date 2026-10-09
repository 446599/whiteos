(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobile = window.matchMedia("(max-width: 700px)");
  const shortViewport = window.matchMedia("(max-height: 650px)");
  let paused = false;
  let activeAnimations = [];
  const motionEnabled = () => !paused && !reducedMotion.matches;

  function animate(element, frames, options = {}) {
    if (!motionEnabled()) return;
    element.getAnimations().forEach((animation) => animation.cancel());
    const animation = element.animate(frames, {
      duration: 550,
      easing: "cubic-bezier(.22,1,.36,1)",
      ...options,
    });
    activeAnimations = activeAnimations.filter((item) => item.playState === "running");
    activeAnimations.push(animation);
    return animation;
  }

  if (!reducedMotion.matches) document.documentElement.classList.add("js-motion");
  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    $$(".reveal").forEach((element) => revealObserver.observe(element));
  } else {
    $$(".reveal").forEach((element) => element.classList.add("visible"));
  }

  const motionButton = $(".motion-toggle");
  function updateMotion() {
    document.documentElement.classList.toggle("motion-paused", paused || reducedMotion.matches);
    document.documentElement.classList.toggle("js-motion", !reducedMotion.matches);
    motionButton.setAttribute("aria-pressed", String(paused || reducedMotion.matches));
    const label = paused ? "恢复装饰动画" : reducedMotion.matches ? "系统已开启减少动态效果" : "暂停装饰动画";
    motionButton.setAttribute("aria-label", label);
    motionButton.title = label;
    if (!motionEnabled()) {
      activeAnimations.forEach((animation) => animation.cancel());
      activeAnimations = [];
      $(".turn-strips").replaceChildren();
    }
    scheduleScroll();
  }
  motionButton.addEventListener("click", () => {
    paused = !paused;
    updateMotion();
  });
  reducedMotion.addEventListener("change", updateMotion);

  const nav = $("#navigation");
  const menuButton = $(".menu-toggle");
  function closeMenu() {
    nav.classList.remove("open");
    document.body.classList.remove("menu-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "打开导航");
    menuButton.title = "打开导航";
  }
  menuButton.addEventListener("click", () => {
    const open = !nav.classList.contains("open");
    nav.classList.toggle("open", open);
    document.body.classList.toggle("menu-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    menuButton.title = open ? "关闭导航" : "打开导航";
    if (open) nav.querySelector("a").focus();
  });
  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("open")) {
      closeMenu();
      menuButton.focus();
    }
  });
  document.addEventListener("focusin", (event) => {
    if (nav.classList.contains("open") && !$(".site-header").contains(event.target)) closeMenu();
  });
  mobile.addEventListener("change", () => {
    closeMenu();
    manualStoryPosition = null;
    scheduleScroll();
  });

  // Arrow keys preserve one keyboard stop per tab group.
  function bindTabs(buttons, activate) {
    buttons.forEach((button, index) => {
      button.addEventListener("click", () => activate(button, index));
      button.addEventListener("keydown", (event) => {
        const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === "Home") next = 0;
        else if (event.key === "End") next = buttons.length - 1;
        else next = (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
        activate(buttons[next], next);
      });
    });
  }

  let storyStep = 0;
  let manualStoryPosition = null;
  const storyTabs = $$(".story-tabs button");
  const story = $("#weread");
  let storyVisible = false;
  if ("IntersectionObserver" in window) {
    const storyObserver = new IntersectionObserver((entries) => {
      storyVisible = entries[0].isIntersecting;
      if (storyVisible) scheduleScroll();
    });
    storyObserver.observe(story);
  } else {
    storyVisible = true;
  }
  function setStoryStep(step) {
    const changed = storyStep !== step;
    storyStep = step;
    storyTabs.forEach((button, index) => {
      button.setAttribute("aria-selected", String(index === step));
      button.tabIndex = index === step ? 0 : -1;
      $(`#story-panel-${index}`).hidden = index !== step;
    });
    $$(".story-screen").forEach((image, index) => {
      image.classList.toggle("active", index === step);
      image.setAttribute("aria-hidden", String(index !== step));
    });
    $("#story-counter").textContent = String(step + 1).padStart(2, "0");
    if (changed) animate($(`#story-panel-${step}`), [
      { opacity: 0, transform: "translateY(12px)" },
      { opacity: 1, transform: "translateY(0)" },
    ]);
  }
  bindTabs(storyTabs, (_, index) => {
    manualStoryPosition = window.scrollY;
    setStoryStep(index);
  });

  let scrollQueued = false;
  function scheduleScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(updateScroll);
  }
  function updateScroll() {
    scrollQueued = false;
    if (!storyVisible || mobile.matches || shortViewport.matches) return;
    const rect = story.getBoundingClientRect();
    const available = story.offsetHeight - $(".story-sticky").offsetHeight;
    const progress = Math.max(0, Math.min(1, (80 - rect.top) / Math.max(1, available)));
    $(".story-progress span").style.transform = `scaleX(${progress})`;
    if (manualStoryPosition !== null && Math.abs(window.scrollY - manualStoryPosition) > 110) {
      manualStoryPosition = null;
    }
    const keyboardInStory = story.contains(document.activeElement);
    if (motionEnabled() && manualStoryPosition === null && !keyboardInStory) {
      setStoryStep(Math.min(2, Math.floor(progress * 3)));
    }
  }
  window.addEventListener("scroll", scheduleScroll, { passive: true });
  window.addEventListener("resize", scheduleScroll, { passive: true });

  const formatTabs = $$(".format-tabs button");
  bindTabs(formatTabs, (button) => {
    const format = button.dataset.format;
    formatTabs.forEach((tab) => {
      const selected = tab.dataset.format === format;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    ["epub", "pdf"].forEach((kind) => {
      $(`#${kind}-demo`).hidden = kind !== format;
      $(`#${kind}-controls`).hidden = kind !== format;
      $(`[data-description="${kind}"]`).hidden = kind !== format;
    });
    animate($(`[data-description="${format}"]`), [
      { opacity: 0, transform: "translateY(12px)" },
      { opacity: 1, transform: "translateY(0)" },
    ]);
  });
  let epubSize = 20;
  function changeEpubSize(delta) {
    epubSize = Math.max(16, Math.min(28, epubSize + delta));
    $("#epub-body").style.setProperty("--epub-size", `${epubSize}px`);
    $("#epub-size").textContent = epubSize;
    $("#epub-minus").disabled = epubSize === 16;
    $("#epub-plus").disabled = epubSize === 28;
  }
  $("#epub-minus").addEventListener("click", () => changeEpubSize(-2));
  $("#epub-plus").addEventListener("click", () => changeEpubSize(2));

  let pdfScale = 1;
  let pdfRotation = 0;
  function updatePdf() {
    $("#pdf-paper").style.setProperty("--pdf-scale", pdfScale);
    $("#pdf-paper").style.setProperty("--pdf-rotation", `${pdfRotation}deg`);
    $("#pdf-zoom").textContent = `${Math.round(pdfScale * 100)}%`;
    $("#pdf-minus").disabled = pdfScale <= 0.75;
    $("#pdf-plus").disabled = pdfScale >= 1.75;
  }
  $("#pdf-minus").addEventListener("click", () => {
    pdfScale = Math.max(0.75, pdfScale - 0.25);
    updatePdf();
  });
  $("#pdf-plus").addEventListener("click", () => {
    pdfScale = Math.min(1.75, pdfScale + 0.25);
    updatePdf();
  });
  $("#pdf-rotate").addEventListener("click", () => {
    pdfRotation = (pdfRotation + 90) % 360;
    updatePdf();
  });
  $("#pdf-reset").addEventListener("click", () => {
    pdfScale = 1;
    pdfRotation = 0;
    updatePdf();
  });

  const specimen = $("#specimen-main");
  $$("[data-font]").forEach((button) => button.addEventListener("click", () => {
    $$("[data-font]").forEach((option) => option.setAttribute("aria-pressed", String(option === button)));
    specimen.style.fontFamily = button.dataset.font === "serif" ? "var(--serif)" : "var(--sans)";
    animate(specimen, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 300 });
  }));
  $("#font-weight").addEventListener("input", (event) => {
    const value = event.target.value;
    specimen.style.setProperty("--specimen-weight", value);
    $("#weight-value").textContent = value;
  });
  $("#specimen-size").addEventListener("input", (event) => {
    const value = event.target.value;
    specimen.style.setProperty("--specimen-size", `${value}px`);
    $("#specimen-value").textContent = value;
  });
  function fitSpecimen() {
    const slider = $("#specimen-size");
    slider.max = window.innerWidth <= 360 ? "64" : mobile.matches ? "76" : "88";
    slider.value = String(Math.min(Number(slider.value), Number(slider.max)));
    specimen.style.setProperty("--specimen-size", `${slider.value}px`);
    $("#specimen-value").textContent = slider.value;
  }
  window.addEventListener("resize", fitSpecimen, { passive: true });
  fitSpecimen();

  const pages = [
    { title: "慢一点，也没关系。", chapter: "第一章", paragraphs: ["沿着小路往前走，听风经过树叶。没有消息需要回复，没有日程等着完成。我们只是在这一刻，认真地读一页书。", "文字之外，还有大片留白。它们像一扇没有关上的窗，让日常的光慢慢照进来。"] },
    { title: "在一页书里，遇见远方。", chapter: "第二章", paragraphs: ["远方未必是一段漫长的旅途。也许只是书页间的一句话，让你看见一种从未想过的生活。", "翻过这一页，故事还在继续。我们带着新的目光，重新看一看身边熟悉的世界。"] },
    { title: "给自己，一点安静。", chapter: "第三章", paragraphs: ["午后的光落在桌角，时间变得缓慢。此刻不必赶路，也不必证明什么，只要和手里的书待在一起。", "读完最后一段，把书轻轻合上。那些留下来的文字，会在未来的某个日子，重新与你相遇。"] },
  ];
  let pageIndex = 0;
  const turnPage = $("#turn-page");
  const strips = $(".turn-strips");
  function turn(direction) {
    const next = Math.max(0, Math.min(pages.length - 1, pageIndex + direction));
    if (next === pageIndex) return;
    activeAnimations.forEach((animation) => {
      if (animation.effect?.target?.classList.contains("turn-strip")) animation.cancel();
    });
    strips.replaceChildren();
    const oldPage = turnPage.cloneNode(true);
    oldPage.querySelector(".turn-strips").remove();
    oldPage.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    oldPage.classList.remove("turn-page");
    oldPage.classList.add("strip-content");
    pageIndex = next;
    const page = pages[pageIndex];
    $("#turn-title").textContent = page.title;
    $("#turn-chapter").textContent = page.chapter;
    $("#turn-text").replaceChildren(...page.paragraphs.map((text) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      return paragraph;
    }));
    const number = String(pageIndex + 1).padStart(2, "0");
    $("#turn-page-number").textContent = number;
    $("#turn-counter").textContent = `${number} / 03`;
    $("#turn-previous").disabled = pageIndex === 0;
    $("#turn-next").disabled = pageIndex === pages.length - 1;
    if (!motionEnabled()) return;
    const height = turnPage.clientHeight;
    const width = turnPage.clientWidth;
    const sidePadding = getComputedStyle(turnPage).paddingLeft;
    const sequence = [];
    for (let index = 0; index < 8; index++) {
      const strip = document.createElement("div");
      strip.className = "turn-strip";
      const content = oldPage.cloneNode(true);
      content.style.top = `${-height * index / 8}px`;
      content.style.height = `${height}px`;
      content.style.paddingLeft = sidePadding;
      content.style.paddingRight = sidePadding;
      strip.append(content);
      strips.append(strip);
      const animation = animate(strip, [
        { transform: "translateX(0)" },
        { transform: `translateX(${-direction * width}px)` },
      ], { duration: 480, delay: (direction > 0 ? index : 7 - index) * 34, fill: "forwards" });
      if (animation) sequence.push(animation.finished.catch(() => {}));
    }
    const currentStrips = [...strips.children];
    Promise.all(sequence).then(() => {
      currentStrips.forEach((strip) => strip.remove());
    });
  }
  $("#turn-previous").disabled = true;
  $("#turn-previous").addEventListener("click", () => turn(-1));
  $("#turn-next").addEventListener("click", () => turn(1));

  const cards = [
    { word: "Serendipity", pronunciation: "/ˌser.ənˈdɪp.ə.ti/", meaning: "不期而遇的美好", example: "在没有期待的地方，遇见值得珍惜的事。" },
    { word: "Wander", pronunciation: "/ˈwɒn.dər/", meaning: "漫步，随意走走", example: "不必每一次出发，都有一个确定的目的地。" },
    { word: "Tranquil", pronunciation: "/ˈtræŋ.kwɪl/", meaning: "宁静的，平和的", example: "留一页书的时间，给安静的自己。" },
  ];
  const ratings = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
  let cardIndex = 0;
  let showingAnswer = false;
  function renderCard() {
    showingAnswer = false;
    const finished = cardIndex >= cards.length;
    $("#anki-answer").hidden = true;
    $("#anki-ratings").hidden = true;
    $("#anki-finished").hidden = !finished;
    $("#anki-reveal").hidden = finished;
    $("#anki-pronunciation").hidden = finished;
    $("#anki-progress").style.width = `${cardIndex / cards.length * 100}%`;
    $("#anki-tag").textContent = finished ? "03 / 03 · 完成" : `${String(cardIndex + 1).padStart(2, "0")} / 03 · 回忆`;
    $("#anki-word").textContent = finished ? "A little, every day." : cards[cardIndex].word;
    if (!finished) {
      $("#anki-pronunciation").textContent = cards[cardIndex].pronunciation;
      $("#anki-meaning").textContent = cards[cardIndex].meaning;
      $("#anki-example").textContent = cards[cardIndex].example;
    }
    animate($("#anki-card"), [
      { opacity: 0, transform: "translateX(15px)" },
      { opacity: 1, transform: "translateX(0)" },
    ]);
  }
  $("#anki-reveal").addEventListener("click", () => {
    showingAnswer = true;
    $("#anki-answer").hidden = false;
    $("#anki-ratings").hidden = false;
    $("#anki-reveal").hidden = true;
    $("#anki-tag").textContent = `${String(cardIndex + 1).padStart(2, "0")} / 03 · 答案`;
    animate($("#anki-answer"), [
      { opacity: 0, transform: "translateY(10px)" },
      { opacity: 1, transform: "translateY(0)" },
    ]);
    $("#anki-ratings button[data-rating='good']").focus({ preventScroll: true });
  });
  $$("[data-rating]").forEach((button) => button.addEventListener("click", () => {
    if (!showingAnswer || cardIndex >= cards.length) return;
    const rating = ratings[button.dataset.rating];
    cardIndex++;
    renderCard();
    $("#anki-status").textContent = cardIndex === cards.length
      ? `演示完成 · 最后一张：${rating} · 未写入设备记录`
      : `上一张：${rating} · 原创演示，不保存学习记录`;
    (cardIndex === cards.length ? $("#anki-reset") : $("#anki-reveal")).focus({ preventScroll: true });
  }));
  $("#anki-reset").addEventListener("click", () => {
    cardIndex = 0;
    renderCard();
    $("#anki-status").textContent = "原创示例牌组 · 网页演示";
  });
  updateMotion();
})();
