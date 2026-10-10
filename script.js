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
      finishTurn();
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
      if (kind === "pdf") $("#pdf-controls").hidden = kind !== format;
      $(`[data-description="${kind}"]`).hidden = kind !== format;
    });
    animate($(`[data-description="${format}"]`), [
      { opacity: 0, transform: "translateY(12px)" },
      { opacity: 1, transform: "translateY(0)" },
    ]);
  });
  const pdfViews = {
    reading: "真机 PDF 整页阅读：固定排版与图表",
    zoom: "真机 PDF 同一页放大细节，保留文档原版面",
  };
  $$("[data-pdf-view]").forEach((button) => button.addEventListener("click", () => {
    $$("[data-pdf-view]").forEach((option) => option.setAttribute("aria-pressed", String(option === button)));
    const src = `./assets/screens/pdf-${button.dataset.pdfView}.png`;
    $("#pdf-capture").src = src;
    $("#pdf-capture").alt = pdfViews[button.dataset.pdfView];
    $("#pdf-capture-link").href = src;
    animate($("#pdf-capture"), [{ opacity: 0.6 }, { opacity: 1 }], { duration: 250 });
  }));

  const readerMenuTabs = $$(".menu-tabs button");
  bindTabs(readerMenuTabs, (_, selected) => {
    readerMenuTabs.forEach((tab, index) => {
      tab.setAttribute("aria-selected", String(index === selected));
      tab.tabIndex = index === selected ? 0 : -1;
      $(`#menu-panel-${index}`).hidden = index !== selected;
    });
    $$(".menu-screen").forEach((image, index) => {
      image.classList.toggle("active", index === selected);
      image.setAttribute("aria-hidden", String(index !== selected));
    });
    animate($(`#menu-panel-${selected}`), [
      { opacity: 0, transform: "translateY(12px)" },
      { opacity: 1, transform: "translateY(0)" },
    ]);
  });

  $$("[data-font]").forEach((button) => button.addEventListener("click", () => {
    $$("[data-font]").forEach((option) => option.setAttribute("aria-pressed", String(option === button)));
    const src = `./assets/screens/font-${button.dataset.font}.png`;
    $("#font-capture").src = src;
    $("#font-capture").alt = button.dataset.font === "serif"
      ? "真机 DejaVu Serif 衬线字体，同一段原创正文"
      : "真机 DejaVu Sans 无衬线字体，同一段原创正文";
    $("#font-capture-link").href = src;
    animate($("#font-capture"), [{ opacity: 0.6 }, { opacity: 1 }], { duration: 250 });
  }));

  let pageIndex = 0;
  let turnFrame = null;
  let turnState = null;
  const turnImages = $$(".turn-source");
  const turnCanvas = $("#turn-canvas");
  const turnContext = turnCanvas.getContext("2d");
  function finishTurn() {
    if (turnFrame !== null) cancelAnimationFrame(turnFrame);
    turnFrame = null;
    turnState = null;
    turnCanvas.hidden = true;
  }
  function updateTurnControls() {
    $("#turn-previous").disabled = pageIndex === 0;
    $("#turn-next").disabled = pageIndex === turnImages.length - 1;
  }
  Promise.all(turnImages.map((image) => image.decode().catch(() => {}))).then(updateTurnControls);
  function turn(direction) {
    const next = Math.max(0, Math.min(turnImages.length - 1, pageIndex + direction));
    if (next === pageIndex) return;
    const ready = turnContext && turnImages.every((image) => image.complete && image.naturalWidth);
    const previous = document.createElement("canvas");
    previous.width = turnCanvas.width;
    previous.height = turnCanvas.height;
    const previousContext = previous.getContext("2d");
    if (ready && previousContext) {
      // Keep the current content, but do not bake the old ripple into a new turn.
      previousContext.drawImage(turnState ? turnState.previous : turnImages[pageIndex], 0, 0);
      if (turnState?.covered) {
        const { target, x, covered } = turnState;
        previousContext.drawImage(target, x, 0, covered, previous.height, x, 0, covered, previous.height);
      }
    }
    finishTurn();
    pageIndex = next;
    turnImages.forEach((image, index) => {
      image.classList.toggle("active", index === pageIndex);
      image.setAttribute("aria-hidden", String(index !== pageIndex));
    });
    $("#turn-counter").textContent = `${String(pageIndex + 1).padStart(2, "0")} / 02`;
    updateTurnControls();
    if (!ready || !previousContext || !motionEnabled()) return;
    const { width, height } = turnCanvas;
    const target = turnImages[pageIndex];
    const duration = 750;
    const started = performance.now();
    const state = { previous, target, x: 0, covered: 0 };
    turnState = state;
    turnContext.drawImage(previous, 0, 0);
    turnCanvas.hidden = false;
    function draw(now) {
      const progress = Math.max(0, Math.min(1, (now - started) / duration));
      const covered = Math.round(width * progress);
      const x = direction > 0 ? 0 : width - covered;
      state.x = x;
      state.covered = covered;
      turnContext.drawImage(previous, 0, 0);
      // Pixels stay in place; a single full-height boundary sweeps horizontally.
      if (covered) turnContext.drawImage(target, x, 0, covered, height, x, 0, covered, height);
      if (progress > 0 && progress < 1) {
        const edge = direction > 0 ? covered : width - covered;
        const ripple = Math.min(16, edge, width - edge);
        turnContext.fillStyle = `rgba(70,70,70,${0.14 * Math.sin(progress * Math.PI)})`;
        turnContext.fillRect(edge - ripple, 0, ripple * 2, height);
      }
      if (progress < 1) {
        turnFrame = requestAnimationFrame(draw);
      } else {
        finishTurn();
      }
    }
    turnFrame = requestAnimationFrame(draw);
  }
  $("#turn-previous").addEventListener("click", () => turn(-1));
  $("#turn-next").addEventListener("click", () => turn(1));

  const ankiViews = {
    decks: "原创 Anki 卡组 · 新卡与待复习数量",
    front: "原创问答 · 回忆后再看答案",
    answer: "同一张卡片 · 答案与四档评分",
    stats: "学习统计 · 本次采集未进行评分",
  };
  $$("[data-anki-view]").forEach((button) => button.addEventListener("click", () => {
    $$("[data-anki-view]").forEach((option) => option.setAttribute("aria-pressed", String(option === button)));
    const src = `./assets/screens/anki-${button.dataset.ankiView}.png`;
    $("#anki-capture").src = src;
    $("#anki-capture").alt = `真机 Anki 截图：${ankiViews[button.dataset.ankiView]}`;
    $("#anki-capture-link").href = src;
    $("#anki-caption").textContent = `真机截图 · ${ankiViews[button.dataset.ankiView]}`;
    animate($("#anki-capture"), [{ opacity: 0.6 }, { opacity: 1 }], { duration: 250 });
  }));
  updateMotion();
})();
