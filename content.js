(() => {
  "use strict";

  const OPTION_ATTR = "data-fenbi-eliminator-option";
  const ELIMINATED_ATTR = "data-fenbi-eliminated";
  const ORIGINAL_PADDING_ATTR = "data-fenbi-eliminator-original-padding";
  const BUTTON_CLASS = "fenbi-eliminator-button";
  const CANDIDATE_SELECTOR = [
    "li",
    "label",
    "[role='radio']",
    "[class*='option' i]",
    "[class*='choice' i]",
    "[class*='answer' i]"
  ].join(",");

  let enabled = true;
  let scanTimer = null;
  let toastTimer = null;
  let markerFrame = null;
  let pendingRange = null;
  let annotations = [];

  function directText(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll(`.${BUTTON_CLASS}`).forEach((node) => node.remove());
    return (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function optionLetter(element) {
    const text = directText(element);
    if (!text || text.length > 600) return null;

    const delimited = text.match(/^([A-H])[\s.、．。:：)）]/i);
    if (delimited) return delimited[1].toUpperCase();

    const first = element.firstElementChild;
    const firstText = first && (first.innerText || first.textContent || "").trim();
    if (/^[A-H]$/i.test(firstText || "") && text.length > 1) {
      return firstText.toUpperCase();
    }
    return null;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 100 && rect.height >= 24 && rect.height < 500 &&
      style.display !== "none" && style.visibility !== "hidden";
  }

  function likelyOptionGroup(element) {
    const parent = element.parentElement;
    if (!parent) return false;
    const siblings = Array.from(parent.children).filter((child) => optionLetter(child));
    const letters = new Set(siblings.map((child) => optionLetter(child)));
    return letters.size >= 2;
  }

  function toggleOption(option, announce = true) {
    const eliminated = option.getAttribute(ELIMINATED_ATTR) === "true";
    option.setAttribute(ELIMINATED_ATTR, String(!eliminated));
    const button = option.querySelector(`:scope > .${BUTTON_CLASS}`);
    if (button) {
      button.textContent = eliminated ? "×" : "↶";
      button.title = eliminated ? "排除此选项" : "恢复此选项";
      button.setAttribute("aria-label", button.title);
    }
    if (announce) showToast(eliminated ? "已恢复该选项" : "已排除该选项");
  }

  function addButton(option) {
    if (option.getAttribute(OPTION_ATTR) === "true") return;
    option.setAttribute(OPTION_ATTR, "true");

    const computedPadding = Number.parseFloat(getComputedStyle(option).paddingLeft) || 0;
    option.setAttribute(ORIGINAL_PADDING_ATTR, option.style.paddingLeft || "");
    option.style.setProperty("--fenbi-eliminator-button-left", `${computedPadding + 4}px`);
    option.style.paddingLeft = `${computedPadding + 38}px`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.textContent = "×";
    button.title = "排除此选项（Alt/Option + 点击也可）";
    button.setAttribute("aria-label", "排除此选项");
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleOption(option);
    });
    option.prepend(button);
  }

  function clearEnhancements() {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => button.remove());
    document.querySelectorAll(`[${OPTION_ATTR}]`).forEach((option) => {
      option.style.paddingLeft = option.getAttribute(ORIGINAL_PADDING_ATTR) || "";
      option.style.removeProperty("--fenbi-eliminator-button-left");
      option.removeAttribute(OPTION_ATTR);
      option.removeAttribute(ELIMINATED_ATTR);
      option.removeAttribute(ORIGINAL_PADDING_ATTR);
    });
    annotations = [];
    pendingRange = null;
    document.querySelector(".fenbi-marker-layer")?.remove();
    document.querySelector(".fenbi-marker-toolbar")?.remove();
  }

  function scan() {
    scanTimer = null;
    if (!enabled) return;

    document.querySelectorAll(CANDIDATE_SELECTOR).forEach((element) => {
      if (element.closest("header, nav, footer, [role='navigation']")) return;
      if (!isVisible(element) || !optionLetter(element) || !likelyOptionGroup(element)) return;
      addButton(element);
    });
  }

  function scheduleScan() {
    if (scanTimer || !enabled) return;
    scanTimer = window.setTimeout(scan, 180);
  }

  function showToast(message) {
    let toast = document.querySelector(".fenbi-eliminator-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "fenbi-eliminator-toast";
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1200);
  }

  function elementForNode(node) {
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  }

  function isMarkableRange(range) {
    const text = range.toString().trim();
    if (!text || text.length > 3000 || !range.startContainer.isConnected ||
        !range.endContainer.isConnected) return false;

    const start = elementForNode(range.startContainer);
    const end = elementForNode(range.endContainer);
    if (!start || !end) return false;
    if (start.closest(`.${BUTTON_CLASS}, .fenbi-marker-toolbar`) ||
        end.closest(`.${BUTTON_CLASS}, .fenbi-marker-toolbar`)) return false;
    if (start.closest(`[${OPTION_ATTR}='true']`) ||
        end.closest(`[${OPTION_ATTR}='true']`)) return false;
    return Array.from(range.getClientRects()).some((rect) => rect.width > 1 && rect.height > 1);
  }

  function ensureMarkerLayer() {
    let layer = document.querySelector(".fenbi-marker-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "fenbi-marker-layer";
      layer.setAttribute("aria-hidden", "true");
      document.documentElement.appendChild(layer);
    }
    return layer;
  }

  function scheduleMarkerRender() {
    if (markerFrame || !enabled) return;
    markerFrame = requestAnimationFrame(renderAnnotations);
  }

  function renderAnnotations() {
    markerFrame = null;
    if (!enabled) return;
    const layer = ensureMarkerLayer();
    layer.replaceChildren();
    annotations = annotations.filter(({ range }) =>
      range.startContainer.isConnected && range.endContainer.isConnected
    );

    annotations.forEach(({ range, kind }) => {
      Array.from(range.getClientRects()).forEach((rect) => {
        if (rect.width <= 1 || rect.height <= 1) return;
        const segment = document.createElement("span");
        segment.className = "fenbi-marker-segment";
        segment.dataset.kind = kind;
        segment.style.left = `${rect.left}px`;
        segment.style.top = `${rect.top}px`;
        segment.style.width = `${rect.width}px`;
        segment.style.height = `${rect.height}px`;
        layer.appendChild(segment);
      });
    });
  }

  function rangesOverlap(first, second) {
    try {
      // The constant names describe the other range first. START_TO_END
      // compares this range's end with the other range's start, while
      // END_TO_START compares this range's start with the other's end.
      const firstEndsBeforeSecond =
        first.compareBoundaryPoints(Range.START_TO_END, second) <= 0;
      const firstStartsAfterSecond =
        first.compareBoundaryPoints(Range.END_TO_START, second) >= 0;
      return !firstEndsBeforeSecond && !firstStartsAfterSecond;
    } catch {
      return false;
    }
  }

  function applyMarker(kind) {
    if (!pendingRange || !isMarkableRange(pendingRange)) return;
    if (kind === "clear") {
      annotations = annotations.filter(({ range }) => !rangesOverlap(range, pendingRange));
      showToast("已清除所选文字的标记");
    } else {
      annotations.push({ range: pendingRange.cloneRange(), kind });
      const names = { highlight: "高亮", underline: "下划线", strike: "删除线" };
      showToast(`已添加${names[kind]}`);
    }
    window.getSelection()?.removeAllRanges();
    pendingRange = null;
    hideMarkerToolbar();
    renderAnnotations();
  }

  function ensureMarkerToolbar() {
    let toolbar = document.querySelector(".fenbi-marker-toolbar");
    if (toolbar) return toolbar;

    toolbar = document.createElement("div");
    toolbar.className = "fenbi-marker-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "文字标记工具");
    toolbar.innerHTML = `
      <button type="button" data-action="highlight" title="荧光高亮">高亮</button>
      <button type="button" data-action="underline" title="添加下划线">下划线</button>
      <button type="button" data-action="strike" title="添加删除线">删除线</button>
      <span class="fenbi-marker-divider" aria-hidden="true"></span>
      <button type="button" data-action="clear" title="清除所选文字上的标记">清除</button>
    `;
    toolbar.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    toolbar.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const button = event.target.closest("button[data-action]");
      if (button) applyMarker(button.dataset.action);
    });
    document.documentElement.appendChild(toolbar);
    return toolbar;
  }

  function hideMarkerToolbar() {
    document.querySelector(".fenbi-marker-toolbar")?.classList.remove("is-visible");
  }

  function showMarkerToolbarForSelection() {
    if (!enabled) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideMarkerToolbar();
      return;
    }
    const range = selection.getRangeAt(0).cloneRange();
    if (!isMarkableRange(range)) {
      hideMarkerToolbar();
      return;
    }

    pendingRange = range;
    const rect = range.getBoundingClientRect();
    const toolbar = ensureMarkerToolbar();
    const left = Math.min(window.innerWidth - 145, Math.max(145, rect.left + rect.width / 2));
    if (rect.top > 54) {
      toolbar.style.left = `${left}px`;
      toolbar.style.top = `${rect.top - 8}px`;
      toolbar.style.transform = "translate(-50%, -100%)";
    } else {
      toolbar.style.left = `${left}px`;
      toolbar.style.top = `${rect.bottom + 8}px`;
      toolbar.style.transform = "translate(-50%, 0)";
    }
    toolbar.classList.add("is-visible");
  }

  document.addEventListener("click", (event) => {
    if (!enabled || !event.altKey) return;
    const option = event.target.closest(`[${OPTION_ATTR}='true']`);
    if (!option) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleOption(option);
  }, true);

  document.addEventListener("pointerup", (event) => {
    if (event.target.closest?.(".fenbi-marker-toolbar")) return;
    window.setTimeout(showMarkerToolbarForSelection, 0);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.(".fenbi-marker-toolbar")) hideMarkerToolbar();
  }, true);

  window.addEventListener("scroll", () => {
    hideMarkerToolbar();
    scheduleMarkerRender();
  }, true);
  window.addEventListener("resize", scheduleMarkerRender);

  chrome.storage.sync.get({ enabled: true }, (settings) => {
    enabled = settings.enabled;
    if (enabled) scan();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.enabled) return;
    enabled = changes.enabled.newValue;
    if (enabled) {
      scan();
      showToast("选项排除功能已开启");
    } else {
      clearEnhancements();
    }
  });

  new MutationObserver((mutations) => {
    const pageChanged = mutations.some(({ target }) =>
      !elementForNode(target)?.closest(
        ".fenbi-marker-layer, .fenbi-marker-toolbar, .fenbi-eliminator-toast"
      )
    );
    if (!pageChanged) return;
    scheduleScan();
    scheduleMarkerRender();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
