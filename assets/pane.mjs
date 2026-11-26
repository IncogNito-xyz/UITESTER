import { desktop, devices, dimensions, displaySettings } from "./devices.mjs";
import { icon } from "./icons.mjs";

function dragHandle(handle, axis, prepare, reset) {
  const coordinate = (event) => (axis === "x" ? event.clientX : event.clientY);
  let drag;
  let frame;

  function apply() {
    const delta = drag.position - drag.start;
    if (delta || drag.moved) {
      drag.adjust(delta);
      drag.moved = true;
    }
  }

  handle.onpointerdown = (event) => {
    if (drag || event.button !== 0 || !event.isPrimary) return;
    const position = coordinate(event);
    const adjust = prepare();
    if (!adjust) return;
    drag = { id: event.pointerId, start: position, position, adjust };
    handle.setPointerCapture(event.pointerId);
    document.body.dataset.resizing = axis;
  };
  handle.onpointermove = (event) => {
    if (drag?.id !== event.pointerId) return;
    drag.position = coordinate(event);
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = undefined;
        apply();
      });
    }
  };
  function finish(event) {
    if (drag?.id !== event.pointerId) return;
    cancelAnimationFrame(frame);
    frame = undefined;
    if (event.type === "pointerup") {
      drag.position = coordinate(event);
      apply();
    }
    drag = undefined;
    delete document.body.dataset.resizing;
  }
  handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = finish;
  handle.ondblclick = reset;
  handle.onkeydown = (event) => {
    const keys =
      axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (event.key === "Home") {
      event.preventDefault();
      reset();
    } else if (keys.includes(event.key)) {
      event.preventDefault();
      prepare()?.(event.key === keys[0] ? -24 : 24);
    }
  };
}

export function resizeColumns(views) {
  const getWidths = () =>
    [...views.querySelectorAll(":scope > .workspace")].map(
      (pane) => pane.getBoundingClientRect().width,
    );
  const minimum = parseFloat(getComputedStyle(views).getPropertyValue("--pane-min"));
  function setWidths(widths) {
    if (widths.length < 2) return;
    const total = widths.reduce((sum, width) => sum + width, 0);
    const tracks = widths.map(
      (width) => `minmax(var(--pane-min), ${width / total}fr)`,
    );
    views.style.setProperty(`--tracks-${widths.length}`, tracks.join(" var(--grip-size) "));
  }
  const handles = [...views.querySelectorAll(".column-grip")];
  for (const [index, handle] of handles.entries()) {
    dragHandle(
      handle,
      "x",
      () => {
        const widths = getWidths();
        if (!widths[index + 1]) return;
        const left = widths[index];
        const right = widths[index + 1];
        return (amount) => {
          const delta = Math.max(minimum - left, Math.min(right - minimum, amount));
          widths[index] = left + delta;
          widths[index + 1] = right - delta;
          setWidths(widths);
        };
      },
      () => views.style.removeProperty(`--tracks-${views.dataset.count}`),
    );
  }
  const main = views.parentElement;
  const layout = main.parentElement;
  const sidebars = layout.querySelectorAll(".sidebar, .sidebar-rail");
  function measureMargins() {
    const bounds = main.getBoundingClientRect();
    const outer = layout.getBoundingClientRect();
    const padding = getComputedStyle(main);
    let left = outer.left;
    if (matchMedia("(min-width: 741px)").matches) {
      for (const sidebar of sidebars) {
        const box = sidebar.getBoundingClientRect();
        if (box.width) left = Math.max(left, box.right);
      }
    }
    const right = Math.min(outer.right, document.documentElement.clientWidth);
    const start = bounds.left + parseFloat(padding.paddingLeft) - left;
    const end = right - bounds.right + parseFloat(padding.paddingRight);
    views.style.setProperty("--edge-max-left", `${Math.max(0, start - 4)}px`);
    views.style.setProperty("--edge-max-right", `${Math.max(0, end - 4)}px`);
  }
  const observer = new ResizeObserver(measureMargins);
  observer.observe(main);
  observer.observe(layout);
  for (const sidebar of sidebars) observer.observe(sidebar);
  measureMargins();
  for (const handle of views.querySelectorAll(".edge-grip")) {
    const side = handle.dataset.edge;
    const isLeft = side === "left";
    const margin = isLeft ? "marginLeft" : "marginRight";
    const property = `--edge-extra-${side}`;
    dragHandle(
      handle,
      "x",
      () => {
        const widths = getWidths();
        const index = isLeft ? 0 : widths.length - 1;
        const width = widths[index];
        const css = getComputedStyle(views);
        const before = -parseFloat(css[margin]);
        const max = parseFloat(css.getPropertyValue(`--edge-max-${side}`));
        return (amount) => {
          const delta = Math.max(Math.min(0, minimum - width), Math.min(max - before, isLeft ? -amount : amount));
          widths[index] = width + delta;
          views.style.setProperty(property, `${before + delta}px`);
          setWidths(widths);
        };
      },
      () => {
        const widths = getWidths();
        const index = isLeft ? 0 : widths.length - 1;
        widths[index] = Math.max(minimum, widths[index] + parseFloat(getComputedStyle(views)[margin]));
        views.style.removeProperty(property);
        setWidths(widths);
      },
    );
  }
}

function resizeStage(handle, stage) {
  const pane = stage.parentElement;
  dragHandle(
    handle,
    "y",
    () => {
      const height = stage.getBoundingClientRect().height;
      return (amount) => {
        const next = Math.max(180, Math.min(1800, Math.round(height + amount)));
        stage.style.setProperty("--stage-height", `${next}px`);
        pane.dataset.customHeight = "";
      };
    },
    () => {
      stage.style.removeProperty("--stage-height");
      delete pane.dataset.customHeight;
    },
  );
}

export function createPane(root, initialDevice, callbacks, suffix = "") {
  const elements = new Map(
    [root, ...root.querySelectorAll("[id]")].map((el) => ["#" + el.id, el]),
  );
  for (const [name, el] of elements) {
    el.dataset.part = name.slice(1);
    el.id += suffix;
  }
  for (const el of root.querySelectorAll("[data-icon]"))
    el.innerHTML = icon(el.dataset.icon);
  const $ = (selector) =>
    elements.get(selector) || root.querySelector(selector);
  const frame = $("#preview"),
    live = $("#live"),
    keyboard = $("#keyboard"),
    cursor = $("#touch-cursor");
  let device = initialDevice,
    horizontal = false,
    screenConfig = displaySettings(initialDevice),
    session = "",
    graphics,
    url = "",
    embedded = "",
    mode = "demo";
  let busy = false,
    timer,
    frameVersion = 0,
    objectUrl = "",
    lastFrame = 0,
    captureScale = 1,
    requestedScale = 1,
    lastScrollHeader = "",
    pendingFrame,
    destroyed = false;
  let operation = Promise.resolve();
  const api = callbacks.api;
  const pane = {
    root,
    get device() {
      return device;
    },
    get display() {
      return { ...screenConfig, ...dimensions(device, horizontal, screenConfig) };
    },
    get defaultDisplay() {
      return { ...displaySettings(device), ...dimensions(device, horizontal) };
    },
    get session() {
      return session;
    },
    get url() {
      return url;
    },
    get busy() {
      return busy;
    },
    idle() {
      return operation.catch(() => {});
    },
    selectProfile,
    configureDisplay,
    open,
    resume,
    close,
    navigation,
  };
  function updateUrl(next) {
    if (next === url) return;
    url = next;
    callbacks.url(pane, url);
  }

  function size() {
    const { width, height } = dimensions(device, horizontal, screenConfig),
      border = device.desktop ? 18 : device.tablet ? 30 : 22;
    const w = width + border,
      h = height + border,
      stage = $("#stage"),
      spacing = parseFloat(getComputedStyle(stage).paddingLeft) * 2 + 3;
    const factor =
      $("#zoom").value === "fit"
        ? Math.max(
            0.05,
            Math.min(
              (stage.clientWidth - spacing) / w,
              (stage.clientHeight - spacing) / h,
              1,
            ),
          )
        : Number($("#zoom").value);
    // Round up so small previews still have enough pixels for the display.
    captureScale = Math.min(1, Math.ceil(factor * devicePixelRatio * 4) / 4);
    const box = $("#device");
    box.classList.toggle("tablet", device.tablet);
    box.classList.toggle("desktop", !!device.desktop);
    Object.assign(box.style, {
      width: w + "px",
      height: h + "px",
      transform: "scale(" + factor + ")",
    });
    Object.assign($(".glass").style, {
      width: width + "px",
      height: height + "px",
    });
    Object.assign($("#scaled").style, {
      width: w * factor + "px",
      height: h * factor + "px",
    });
    $("#metrics").textContent = width + " × " + height + " px";
    $("#density").textContent = "DPR " + screenConfig.dpr;
  }
  function render() {
    $("#model-name").textContent = device.name;
    $("#model-desc").textContent =
      device.brand +
      " · " +
      (device.desktop ? "Escritorio" : device.tablet ? "Tablet" : "Móvil");
    $("#selected-icon").innerHTML = icon(
      device.desktop ? "display" : device.tablet ? "tablet" : "phone",
    );
    $("#rotate").setAttribute("aria-pressed", String(horizontal));
    let chromiumLabel = "Chromium";
    if (graphics === "gpu") chromiumLabel += " · GPU activa";
    else if (graphics === "fallback") chromiumLabel += " · GPU no disponible";
    $("#state").textContent =
      mode === "demo"
        ? "Página de prueba"
        : mode === "live"
          ? device.engine === "webkit"
            ? "WebKit"
            : chromiumLabel
          : "Vista en marco";
    $("#back").disabled = $("#forward").disabled = mode !== "live" || busy;
    callbacks.render(pane);
    size();
  }

  function invalidate() {
    frameVersion++;
    clearTimeout(timer);
    pendingFrame?.abort();
    pendingFrame = undefined;
  }
  async function refresh(stamp = frameVersion, retries = 0) {
    if (!session || stamp !== frameVersion || busy || document.hidden) return;
    try {
      const controller = new AbortController();
      pendingFrame = controller;
      if (!document.body.dataset.resizing) requestedScale = captureScale;
      const res = await api(
        "frame",
        { id: session, after: lastFrame, scale: requestedScale },
        controller.signal,
      );
      const blob = res.status === 204 ? null : await res.blob();
      if (stamp !== frameVersion) return;
      pendingFrame = undefined;
      if (blob) {
        lastFrame = Number(res.headers.get("X-Frame-Number")) || 0;
        const previous = objectUrl;
        objectUrl = URL.createObjectURL(blob);
        live.src = objectUrl;
        if (previous) URL.revokeObjectURL(previous);
        if (live.hidden) {
          frame.hidden = true;
          frame.removeAttribute("src");
          live.hidden = keyboard.hidden = false;
        }
      }
      const scrollHeader = res.headers.get("X-Scroll") || "{}";
      if (scrollHeader !== lastScrollHeader) {
        showScrollbars(JSON.parse(scrollHeader));
        lastScrollHeader = scrollHeader;
      }
      updateUrl(decodeURIComponent(res.headers.get("X-Page-Url") || ""));

      // Let the current image decode before pulling a newer one.
      if (blob) await live.decode().catch(() => {});
      if (lastFrame) void refresh(stamp);
      else if (stamp === frameVersion)
        timer = setTimeout(() => refresh(stamp), 240);
    } catch (e) {
      if (stamp !== frameVersion) return;
      pendingFrame = undefined;
      if (e.status === 410) {
        session = "";
        mode = "demo";
        showDemo();
        callbacks.notice(e.message);
        return;
      }
      if (retries >= 2)
        callbacks.notice("La vista está esperando al motor local. " + e.message);
      timer = setTimeout(() => refresh(stamp, retries + 1), 1000);
    }
  }
  function refreshWhenVisible() {
    invalidate();
    if (!document.hidden) void refresh();
  }
  function showScrollbars(position = {}) {
    for (const axis of ["x", "y"]) {
      const track = $("#scroll-" + axis);
      const values = position[axis];
      track.hidden = !values;
      if (!values) continue;
      const length = Math.max(7, values[0] * 100);
      const offset = (100 - length) * values[1];
      const thumb = track.firstElementChild;
      thumb.style[axis === "y" ? "height" : "width"] = length + "%";
      thumb.style[axis === "y" ? "top" : "left"] = offset + "%";
    }
  }

  function operate(fn) {
    if (busy || destroyed) return Promise.resolve();
    operation = perform(fn);
    return operation;
  }
  async function perform(fn) {
    invalidate();
    busy = true;
    $("#rotate").disabled = $("#reload").disabled = true;
    $("#state").textContent = "Cargando…";
    root.setAttribute("aria-busy", "true");
    try {
      await callbacks.drain();
      return await fn();
    } finally {
      busy = false;
      $("#rotate").disabled = $("#reload").disabled = false;
      root.setAttribute("aria-busy", "false");
      render();
      if (session && !destroyed) void refresh();
    }
  }
  function showDemo() {
    embedded = "";
    graphics = undefined;
    mode = "demo";
    live.hidden = cursor.hidden = keyboard.hidden = true;
    showScrollbars();
    lastFrame = 0;
    lastScrollHeader = "";
    live.removeAttribute("src");
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = "";
    frame.removeAttribute("sandbox");
    frame.title = "Página de calibración";
    frame.src = "./demo.html";
    frame.hidden = false;
    updateUrl("");
    render();
  }
  function open(target, useEngine = true, { source, gpu } = {}) {
    return operate(async () => {
      if (useEngine) {
        const reply = session
          ? await api("action", {
              id: session,
              action: "navigate",
              url: target,
              gpu,
            })
          : await api("session", {
              device: device.id,
              horizontal,
              url: target,
              source,
              gpu: gpu ?? callbacks.gpu(),
              display: screenConfig,
            });
        session = reply.id;
        graphics = reply.graphics;
        if (reply.display) screenConfig = reply.display;
        mode = "live";
        updateUrl(reply.url || target);
      } else {
        embedded = target;
        mode = "embed";
        frame.setAttribute(
          "sandbox",
          "allow-scripts allow-forms allow-same-origin allow-popups",
        );
        frame.title = "Aplicación en vista adaptable";
        frame.src = target;
        frame.hidden = false;
        updateUrl(target);
      }
    });
  }
  function resume(id) {
    return operate(async () => {
      const reply = await api("resume", { id });
      device =
        [desktop, ...devices].find((model) => model.id === reply.device) || device;
      horizontal = reply.horizontal;
      screenConfig = reply.display || displaySettings(device);
      session = reply.id;
      graphics = reply.graphics;
      mode = "live";
      updateUrl(reply.url);
    });
  }
  function selectProfile(next, landscape = horizontal) {
    return operate(async () => {
      let config = next.id === device.id ? screenConfig : displaySettings(next);
      if (session) {
        const reply = await api("action", {
          id: session,
          action: "profile",
          device: next.id,
          horizontal: landscape,
          gpu: callbacks.gpu(),
        });
        graphics = reply.graphics;
        if (reply.display) config = reply.display;
      }
      device = next;
      horizontal = landscape;
      screenConfig = config;
    });
  }
  function configureDisplay(values) {
    return operate(async () => {
      const next = displaySettings(device, {
        ...values,
        ...dimensions(device, horizontal, values),
      });
      if (session) {
        const reply = await api("action", {
          id: session,
          action: "display",
          display: next,
        });
        updateUrl(reply.url);
      }
      screenConfig = next;
    });
  }
  function navigation(action) {
    return operate(async () => {
      if (session) {
        const reply = await api("action", { id: session, action });
        updateUrl(reply.url);
      } else if (action === "reload") frame.src = embedded || "./demo.html";
    });
  }
  async function close(remove = false) {
    invalidate();
    if (remove) {
      destroyed = true;
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      observer.disconnect();
      root.remove();
    }
    const id = session;
    session = "";
    if (!remove) showDemo();
    else if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (id) await api("close", { id });
  }
  $("#rotate").onclick = () =>
    selectProfile(device, !horizontal).catch(callbacks.error);
  $("#zoom").onchange = () => {
    const previous = captureScale;
    size();
    if (device.engine === "chromium" && captureScale !== previous)
      refreshWhenVisible();
  };
  const observer = new ResizeObserver(size);
  observer.observe($("#stage"));
  resizeStage($("#height-grip"), $("#stage"));
  document.addEventListener("visibilitychange", refreshWhenVisible);
  $("#expand").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.requestFullscreen();
    } catch {
      callbacks.notice(
        "El navegador no permite la pantalla completa en esta ventana.",
      );
    }
  };
  for (const action of ["back", "forward", "reload"])
    $("#" + action).onclick = () => callbacks.navigate(pane, action);
  function sendInput(action, values) {
    if (!session || busy) return Promise.resolve();
    return callbacks.input(pane, action, values);
  }
  function point(e) {
    const r = live.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }
  function positionCursor(pos) {
    const width = horizontal ? screenConfig.height : screenConfig.width;
    const height = horizontal ? screenConfig.width : screenConfig.height;
    cursor.hidden = false;
    cursor.style.translate = `${pos.x * width}px ${pos.y * height}px`;
  }
  let drag,
    pendingScroll,
    sendingScroll = false,
    scrollTick;
  function queueScroll(origin, dx, dy) {
    if (busy || !session || (!dx && !dy)) return;
    if (pendingScroll) {
      pendingScroll.dx += dx;
      pendingScroll.dy += dy;
    } else {
      pendingScroll = { ...origin, dx, dy };
    }
    if (!sendingScroll && !scrollTick)
      scrollTick = requestAnimationFrame(flushScroll);
  }
  async function flushScroll() {
    scrollTick = undefined;
    if (!pendingScroll) return;
    const scroll = pendingScroll;
    pendingScroll = undefined;
    sendingScroll = true;
    await sendInput("scroll", scroll);
    sendingScroll = false;
    if (pendingScroll) void flushScroll();
  }
  function dragTo(pos) {
    const { width, height } = dimensions(device, horizontal, screenConfig);
    const dx = (drag.last.x - pos.x) * width;
    const dy = (drag.last.y - pos.y) * height;
    if (!drag.moved && Math.hypot(dx, dy) < 7) return;
    drag.moved = true;
    drag.last = pos;
    queueScroll(drag.origin, dx, dy);
  }
  live.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const pos = point(e);
    drag = { origin: pos, last: pos, id: e.pointerId, moved: false };
    positionCursor(pos);
    cursor.setAttribute("data-pressed", "");
    live.setPointerCapture(e.pointerId);
  };
  live.onpointermove = (e) => {
    const pos = point(e);
    positionCursor(pos);
    if (drag?.id === e.pointerId) dragTo(pos);
  };
  live.onpointerleave = () => {
    cursor.hidden = true;
  };
  live.onpointercancel = () => {
    drag = null;
    cursor.hidden = true;
    cursor.removeAttribute("data-pressed");
  };
  live.onpointerup = (e) => {
    if (drag?.id !== e.pointerId) return;
    const end = point(e);
    dragTo(end);
    if (!drag.moved) {
      keyboard.focus({ preventScroll: true });
      sendInput("tap", end);
    }
    drag = null;
    cursor.removeAttribute("data-pressed");
  };
  live.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? live.clientHeight : 1;
      const pos = point(e);
      positionCursor(pos);
      queueScroll(pos, e.deltaX * factor, e.deltaY * factor);
    },
    { passive: false },
  );
  live.onkeydown = (e) => {
    keyboard.focus();
    handleKey(e);
  };
  function handleKey(e) {
    if (
      e.isComposing ||
      e.key === "Process" ||
      ["Control", "Shift", "Alt", "Meta", "Dead", "Unidentified"].includes(
        e.key,
      )
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return;
    e.preventDefault();
    const mods = [];
    if (e.ctrlKey) mods.push("Control");
    if (e.metaKey) mods.push("Meta");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    sendInput("key", { key: [...mods, e.key].join("+") });
  }
  keyboard.onkeydown = handleKey;
  keyboard.oninput = (e) => {
    if (e.isComposing) return;
    const text = keyboard.value;
    keyboard.value = "";
    if (text) sendInput("text", { text });
  };
  keyboard.oncompositionend = () => {
    setTimeout(() => {
      if (keyboard.value) {
        sendInput("text", { text: keyboard.value });
        keyboard.value = "";
      }
    }, 0);
  };

  render();
  return pane;
}
