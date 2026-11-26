import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { chromium, webkit, devices as presets } from "playwright-core";
import { devices, desktop, dimensions, displaySettings } from "./assets/devices.mjs";
import { normalizeUrl } from "./assets/urls.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const launcherPorts = [4317, 4318];
const originFor = (port) => `http://127.0.0.1:${port}`;
const statusOrigins = new Set(launcherPorts.flatMap((port) => [
  originFor(port), `http://localhost:${port}`,
]));
const sessions = new Map();
const engines = new Map();
const castIdleTime = 2500;
const types = {
  html: "text/html",
  css: "text/css",
  mjs: "text/javascript",
  svg: "image/svg+xml",
  woff2: "font/woff2",
};
const publicFiles = new Set([
  "index.html",
  "demo.html",
  "assets/app.mjs",
  "assets/pane.mjs",
  "assets/profile-picker.mjs",
  "assets/devices.mjs",
  "assets/urls.mjs",
  "assets/style.css",
  "assets/icons.mjs",
  "assets/mark.svg",
]);
const okHosts = new Set();

async function hasHardwareGraphics(browser) {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { gpu } = await cdp.send("SystemInfo.getInfo");
    const renderer = gpu?.auxAttributes?.glRenderer;
    const compositing = gpu?.featureStatus?.gpu_compositing;
    return Boolean(
      renderer &&
        !/swiftshader|llvmpipe|lavapipe|software|warp|basic render/i.test(renderer) &&
        /^enabled(?:_|$)/.test(compositing),
    );
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function browserFor(engine) {
  if (!engines.has(engine)) {
    const gpu = engine === "chromium-gpu";
    const type = engine === "webkit" ? webkit : chromium;
    const options = { headless: true };
    if (type === chromium) options.chromiumSandbox = true;
    if (type === chromium && !existsSync(chromium.executablePath())) {
      const executable = [
        join(
          process.env.ProgramFiles || "",
          "Google/Chrome/Application/chrome.exe",
        ),
        join(
          process.env["ProgramFiles(x86)"] || "",
          "Microsoft/Edge/Application/msedge.exe",
        ),
      ].find(existsSync);
      if (executable) options.executablePath = executable;
    }
    if (gpu) {
      if (!options.executablePath) options.channel = "chromium";
      options.args = ["--enable-gpu"];
      options.timeout = 8000;
    }
    const promise = type
      .launch(options)
      .then(async (browser) => {
        if (gpu && !(await hasHardwareGraphics(browser).catch(() => false))) {
          await browser.close().catch(() => {});
          return;
        }
        browser.on("disconnected", () => engines.delete(engine));
        return browser;
      })
      .catch(() => {
        if (gpu) return;
        engines.delete(engine);
        throw new Error(
          "Motor " +
            engine +
            " sin iniciar. Ejecuta npx playwright-core install " +
            engine +
            " en la carpeta del proyecto.",
        );
      });
    engines.set(engine, promise);
  }
  return engines.get(engine);
}

function pageEvents(s, page) {
  s.page = page;
  page.on("popup", (next) => {
    if (s.page === page) pageEvents(s, next);
  });
  page.on("close", () => {
    if (s.page === page) s.page = s.context.pages().at(-1);
  });
}

function resetCast(s) {
  const cast = s.cast;
  if (!cast) return s.castStop;
  s.cast = undefined;
  clearTimeout(cast.idleTimer);
  cast.events.emit("frame");
  s.castStop = cast.start.then((recording) => recording?.dispose()).catch(() => {});
  return s.castStop;
}

function startCast(s, page, scale) {
  const viewport = page.viewportSize();
  const cast = {
    page,
    scale,
    highDpi: s.display.sharp && s.display.dpr > 1 && s.device.engine === "chromium",
    quality: s.display.sharp ? 92 : 76,
    events: new EventEmitter(),
    latest: null,
    readers: 0,
    lastReader: Date.now(),
  };
  s.cast = cast;
  // Playwright applies the size of the first active screencast on a page.
  cast.start = Promise.resolve(s.castStop)
    .then(() => {
      if (s.cast !== cast || page.isClosed()) return;
      return page.screencast.start({
        size: {
          width: Math.ceil(viewport.width * scale),
          height: Math.ceil(viewport.height * scale),
        },
        quality: cast.highDpi ? 76 : cast.quality,
        onFrame({ data }) {
          if (s.cast !== cast) return;
          if (cast.highDpi && cast.latest?.data.equals(data)) return;
          cast.latest = { data, number: ++s.frameNumber };
          cast.events.emit("frame");
        },
      });
    })
    .catch(() => undefined);
  const stopIfIdle = () => {
    const remaining = cast.readers
      ? castIdleTime
      : castIdleTime - (Date.now() - cast.lastReader);
    if (remaining > 0) cast.idleTimer = setTimeout(stopIfIdle, remaining);
    else void resetCast(s);
  };
  cast.idleTimer = setTimeout(stopIfIdle, castIdleTime);
  return cast;
}

function snapshot(s, cast) {
  cast.capture ??= (async () => {
    // Sharp Chromium previews use device pixels when the screencast stays at CSS size.
    if (cast.highDpi && cast.lastShot) {
      const remaining = 100 - (Date.now() - cast.lastShot);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    if (s.cast !== cast) return;
    const number = cast.highDpi && cast.latest ? cast.latest.number : ++s.frameNumber;
    cast.lastShot = Date.now();
    const data = await cast.page.screenshot({
      type: "jpeg",
      quality: cast.quality,
      scale: cast.highDpi ? "device" : "css",
      timeout: 4500,
    });
    const image = { data, number };
    if (cast.highDpi) cast.detail = image;
    return image;
  })().finally(() => (cast.capture = undefined));
  return cast.capture;
}

async function readFrame(s, after, scale, res) {
  if (res.destroyed || !s.page || s.page.isClosed()) return;
  if (s.cast && (s.cast.page !== s.page || s.cast.scale !== scale))
    void resetCast(s);
  const cast = s.cast || startCast(s, s.page, scale);
  cast.readers++;
  res.once("close", () => {
    cast.readers--;
    cast.lastReader = Date.now();
  });
  const recording = await cast.start;
  if (
    recording &&
    (!cast.latest || cast.latest.number === after) &&
    !res.destroyed
  ) {
    await new Promise((resolve) => {
      const complete = () => {
        clearTimeout(timeout);
        cast.events.off("frame", complete);
        res.off("close", complete);
        resolve();
      };
      const timeout = setTimeout(complete, cast.latest ? 900 : 450);
      cast.events.once("frame", complete);
      res.once("close", complete);
    });
  }
  if (s.cast !== cast || res.destroyed) return;
  if (cast.latest) {
    if (cast.latest.number === after) return;
    if (!cast.highDpi) return cast.latest;
    if (cast.detail?.number === cast.latest.number) return cast.detail;
  }
  const image = await snapshot(s, cast);
  if (s.cast !== cast || res.destroyed) return;
  return cast.highDpi ? image : cast.latest || image;
}

function trackScroll() {
  let target;
  let lastScroll = 0;
  window.addEventListener(
    "scroll",
    (event) => {
      target = event.target instanceof Element ? event.target : null;
      lastScroll = performance.now();
    },
    { capture: true, passive: true },
  );
  window.formaScrollPosition = () => {
    const root = document.scrollingElement;
    const node =
      target?.isConnected && performance.now() - lastScroll < 1500
        ? target
        : root;
    if (!node) return {};
    const axis = (size, visible, offset) =>
      size > visible && visible > 0
        ? [visible / size, Math.min(1, Math.abs(offset) / (size - visible))]
        : null;
    return {
      x: axis(node.scrollWidth, node.clientWidth, node.scrollLeft),
      y: axis(node.scrollHeight, node.clientHeight, node.scrollTop),
    };
  };
}

async function setProfile(s, device, horizontal, { target, source, gpu, display } = {}) {
  const nextDisplay = displaySettings(device, display);
  const viewport = dimensions(device, horizontal, nextDisplay);
  const gpuRequested = device.engine === "chromium" && gpu === true;
  if (
    s.device?.id === device.id &&
    s.gpuRequested === gpuRequested &&
    s.display.dpr === nextDisplay.dpr &&
    s.page &&
    !s.page.isClosed()
  ) {
    const old = s.page.viewportSize();
    const resize = old.width !== viewport.width || old.height !== viewport.height;
    if (resize || s.display.sharp !== nextDisplay.sharp) await resetCast(s);
    if (resize) await s.page.setViewportSize(viewport);
    s.horizontal = horizontal;
    s.display = nextDisplay;
    if (target) await navigate(s, target);
    return;
  }
  const accelerated = gpuRequested ? await browserFor("chromium-gpu") : undefined;
  const browser = accelerated || await browserFor(device.engine);
  const previous = s.context ? s : source;
  const currentUrl = target || s.page?.url();
  const tabStorage = await previous?.page?.evaluate(() => {
    try {
      return {
        origin: location.origin,
        entries: Object.entries(sessionStorage),
      };
    } catch {
      return null;
    }
  });
  const storageState = await previous?.context?.storageState({ indexedDB: true });
  if (
    storageState &&
    previous.device?.engine === "webkit" &&
    device.engine === "chromium"
  ) {
    // WebKit reports cookies without an explicit SameSite value as None.
    // Chromium discards an insecure None cookie, so use its default policy.
    for (const cookie of storageState.cookies) {
      if (!cookie.secure && cookie.sameSite === "None") cookie.sameSite = "Lax";
    }
  }
  const base =
    device.engine === "webkit"
      ? presets[device.tablet ? "iPad (gen 7)" : "iPhone 15 Pro"]
      : presets["Pixel 7"];
  const ua = device.desktop
    ? undefined
    : device.engine === "webkit"
      ? base.userAgent
      : base.userAgent
          .replace(/Pixel 7(?=[;) ])/g, device.name)
          .replace(
            " Mobile Safari",
            device.tablet ? " Safari" : " Mobile Safari",
          );
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    deviceScaleFactor: nextDisplay.dpr,
    isMobile: !device.desktop,
    hasTouch: !device.desktop,
    userAgent: ua,
    acceptDownloads: false,
    locale: "es-NI",
    storageState,
  });
  const candidate = { context };
  try {
    await context.addInitScript(trackScroll);
    candidate.page = await context.newPage();
    if (currentUrl && currentUrl !== "about:blank")
      await navigate(candidate, currentUrl, tabStorage);
  } catch (err) {
    await context.close();
    throw err;
  }
  const old = s.context;
  await resetCast(s);
  s.context = context;
  s.device = device;
  s.horizontal = horizontal;
  s.display = nextDisplay;
  s.gpuRequested = gpuRequested;
  s.graphics = gpuRequested ? (accelerated ? "gpu" : "fallback") : undefined;
  pageEvents(s, candidate.page);
  if (old) await old.close().catch(() => {});
}

async function navigate(s, value, tabStorage) {
  const url = normalizeUrl(value);
  try {
    if (tabStorage?.entries.length && new URL(url).origin === tabStorage.origin) {
      // Seed the new tab before app scripts run. Reload replaces this bootstrap
      // document at the same address, so Back cannot revisit it.
      await s.page.route(
        (requestUrl) => requestUrl.origin === tabStorage.origin,
        (route) =>
          route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
        { times: 1 },
      );
      await s.page.goto(url, { waitUntil: "domcontentloaded", timeout: 16000 });
      await s.page.evaluate((entries) => {
        for (const [key, value] of entries) sessionStorage.setItem(key, value);
      }, tabStorage.entries);
      await s.page.reload({ waitUntil: "commit", timeout: 16000 });
    } else {
      await s.page.goto(url, { waitUntil: "commit", timeout: 16000 });
    }
  } catch (err) {
    const code = String(err.message)
      .split("\n")[0]
      .replace(/^page\.goto:\s*/, "")
      .slice(0, 220);
    throw new Error(
      "No se pudo abrir la página. Comprueba la dirección, el puerto y que la app esté en ejecución. " +
        code,
    );
  }
}
function view(s) {
  const current = s.page?.url() || "";
  return {
    id: s.id,
    url: /^https?:/.test(current) ? current : "",
    engine: s.device?.engine,
    graphics: s.graphics,
    display: s.display,
  };
}
function deviceBy(id) {
  const device =
    id === desktop.id ? desktop : devices.find((item) => item.id === id);
  if (!device) throw new Error("Modelo desconocido.");
  return device;
}
async function destroy(s) {
  sessions.delete(s.id);
  await resetCast(s);
  await s.context?.close().catch(() => {});
}
async function locateSource(page, input) {
  return page.evaluate(({ action, x, y }) => {
    const viewport = window.visualViewport;
    let node =
      action === "text" || action === "key"
        ? document.activeElement
        : document.elementFromPoint(x * viewport.width, y * viewport.height);
    if (action === "scroll") {
      while (node && node !== document.documentElement) {
        const css = getComputedStyle(node);
        if (
          (/(auto|scroll|overlay)/.test(css.overflowY) &&
            node.scrollHeight > node.clientHeight) ||
          (/(auto|scroll|overlay)/.test(css.overflowX) &&
            node.scrollWidth > node.clientWidth)
        )
          break;
        node = node.parentElement;
      }
    } else if (action === "tap") {
      node =
        node?.closest(
          "a,button,input,select,textarea,label,summary,[role],[data-testid],[onclick]",
        ) || node;
    }
    if (!node || node === document.body || node === document.documentElement)
      return null;
    const tag = node.localName;
    const selectors = [];
    for (const attr of [
      "data-testid",
      "id",
      "name",
      "aria-label",
      "href",
      "for",
    ]) {
      const value = node.getAttribute(attr);
      if (value && value.length <= 250) {
        const qualifier = ["id", "data-testid"].includes(attr) ? "" : tag;
        selectors.push(qualifier + "[" + attr + "=" + CSS.escape(value) + "]");
      }
    }
    const text =
      ["a", "button", "label", "summary"].includes(tag) ||
      node.hasAttribute("role")
        ? node.textContent?.trim().replace(/\s+/g, " ").slice(0, 140)
        : "";
    return { selectors, text, tag };
  }, input);
}

async function matchingTarget(page, target) {
  if (!target) return null;
  for (const selector of target.selectors) {
    const candidates = page.locator(selector + ":visible");
    if ((await candidates.count()) === 1) return candidates;
  }
  if (target.text) {
    const candidates = page
      .getByText(target.text, { exact: true })
      .and(page.locator(target.tag + ":visible"));
    if ((await candidates.count()) === 1) return candidates;
  }
  return null;
}

async function mirror(peer, input, target) {
  const p = peer.page;
  if (!p || p.isClosed()) return;
  const match = await matchingTarget(p, target);
  if (input.action === "scroll") {
    if (match) {
      await match.evaluate(
        (node, { dx, dy }) =>
          node.scrollBy({ left: dx, top: dy, behavior: "instant" }),
        input,
        { timeout: 800 },
      );
    } else if (!target) {
      await p.evaluate(
        ({ dx, dy }) =>
          window.scrollBy({ left: dx, top: dy, behavior: "instant" }),
        input,
      );
    }
    return;
  }
  if (input.action === "tap" && match) {
    if (peer.device.desktop) await match.click({ timeout: 1200 });
    else await match.tap({ timeout: 1200 });
    return;
  }
  if (match && (input.action === "key" || input.action === "text")) {
    await match.focus({ timeout: 800 });
    await action(peer, input);
  }
}

function enqueue(s, fn) {
  if (s.closing || s.pending >= 64)
    return Promise.reject(new Error("La vista está ocupada. Espera a que termine la acción actual."));
  s.pending = (s.pending || 0) + 1;
  const task = s.queue.then(fn).finally(() => s.pending--);
  s.queue = task.catch(() => {});
  return task;
}

async function action(s, b) {
  const p = s.page;
  if (b.action === "display")
    return setProfile(s, s.device, s.horizontal, {
      display: b.display,
      gpu: s.gpuRequested,
    });
  if (b.action === "profile") {
    const sameModel = b.device === s.device.id;
    return setProfile(s, deviceBy(b.device), !!b.horizontal, {
      gpu: sameModel ? s.gpuRequested : b.gpu,
      display: sameModel ? s.display : undefined,
    });
  }
  if (b.action === "navigate") {
    if (
      s.device.engine === "chromium" &&
      typeof b.gpu === "boolean" &&
      b.gpu !== s.gpuRequested
    )
      return setProfile(s, s.device, s.horizontal, {
        target: normalizeUrl(b.url),
        gpu: b.gpu,
        display: s.display,
      });
    return navigate(s, b.url);
  }
  if (b.action === "reload")
    return p.reload({ waitUntil: "commit", timeout: 16000 });
  if (b.action === "back")
    return p.goBack({ waitUntil: "commit", timeout: 16000 });
  if (b.action === "forward")
    return p.goForward({ waitUntil: "commit", timeout: 16000 });
  if (b.action === "text")
    return p.keyboard.insertText(String(b.text).slice(0, 16384));
  if (b.action === "key") return p.keyboard.press(String(b.key).slice(0, 80));
  const pos = { x: Number(b.x), y: Number(b.y) };
  if (![pos.x, pos.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1))
    throw new Error("Posición inválida.");
  const clamp = (delta) => Math.max(-3000, Math.min(3000, Number(delta) || 0));
  const dx = clamp(b.dx),
    dy = clamp(b.dy);
  if (b.action === "scroll" && s.device.engine === "webkit") {
    // WebKit for Windows may dispatch the wheel event without scrolling.
    return p.evaluate(
      ({ pos, dx, dy }) => {
        const { width, height } = window.visualViewport;
        const x = Math.max(0, Math.min(width - 1, pos.x * width));
        const y = Math.max(0, Math.min(height - 1, pos.y * height));
        const hit = document.elementFromPoint(x, y);
        for (const [axis, delta] of [
          ["x", dx],
          ["y", dy],
        ]) {
          let remaining = delta;
          const offset = axis === "x" ? "scrollLeft" : "scrollTop";
          for (
            let node = hit;
            node && remaining;
            node = node.parentElement || node.getRootNode().host
          ) {
            if (
              node === document.scrollingElement ||
              node === document.documentElement
            )
              break;
            const css = getComputedStyle(node);
            const overflow = axis === "x" ? css.overflowX : css.overflowY;
            if (!/^(auto|scroll|overlay)$/.test(overflow)) continue;
            const before = node[offset];
            node.scrollBy({
              [axis === "x" ? "left" : "top"]: remaining,
              behavior: "instant",
            });
            remaining -= node[offset] - before;
            const chaining =
              axis === "x" ? css.overscrollBehaviorX : css.overscrollBehaviorY;
            if (chaining && chaining !== "auto") remaining = 0;
          }
          if (remaining)
            window.scrollBy({
              [axis === "x" ? "left" : "top"]: remaining,
              behavior: "instant",
            });
        }
      },
      { pos, dx, dy },
    );
  }
  const scale = await p.evaluate(() => ({
    w: window.visualViewport.width,
    h: window.visualViewport.height,
  }));
  const x = Math.max(0, Math.min(scale.w - 1, pos.x * scale.w)),
    y = Math.max(0, Math.min(scale.h - 1, pos.y * scale.h));
  if (b.action === "tap")
    return s.device.desktop ? p.mouse.click(x, y) : p.touchscreen.tap(x, y);
  if (b.action === "scroll") {
    await p.mouse.move(x, y);
    return p.mouse.wheel(dx, dy);
  }
  throw new Error("Acción desconocida.");
}
function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
function scrollPosition(s, hasImage) {
  const page = s.page;
  if (!page) return {};
  const now = Date.now();
  const cached = s.scrollSample;
  // During animation reuse one DOM sample across nearby video frames.
  if (cached?.page === page && hasImage && now - cached.time < 70)
    return cached.value;
  const value = page
    .evaluate(() => window.formaScrollPosition?.())
    .catch(() => null);
  s.scrollSample = { page, time: now, value };
  return value;
}
async function api(req, res, path) {
  if (req.method === "GET" && path === "/api/status") {
    if (statusOrigins.has(req.headers.origin))
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    return json(res, 200, { app: "forma", gpu: true, display: true });
  }
  if (
    req.method !== "POST" ||
    req.headers.origin !== "http://" + req.headers.host ||
    req.headers["content-type"]?.split(";")[0] !== "application/json"
  )
    return json(res, 403, { error: "Origen no autorizado." });
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 65536) throw new Error("Solicitud demasiado grande.");
    chunks.push(chunk);
  }
  const b = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!b || typeof b !== "object" || Array.isArray(b))
    throw new Error("Solicitud JSON inválida.");
  if (path === "/api/session") {
    if (sessions.size >= 8)
      throw new Error("Cierra una sesión del laboratorio para continuar.");
    const s = {
      id: randomUUID(),
      last: Date.now(),
      queue: Promise.resolve(),
      frameNumber: 0,
    };
    sessions.set(s.id, s);
    try {
      await setProfile(s, deviceBy(b.device), !!b.horizontal, {
        target: normalizeUrl(b.url),
        source: sessions.get(b.source),
        gpu: b.gpu,
        display: b.display,
      });
    } catch (e) {
      await destroy(s);
      throw e;
    }
    return json(res, 200, view(s));
  }
  const s = sessions.get(b.id);
  if (!s || s.closing)
    return json(res, 410, {
      error: "La sesión terminó. Vuelve a abrir la URL.",
    });
  s.last = Date.now();
  if (path === "/api/resume") {
    const current = await enqueue(s, () => ({
      ...view(s),
      device: s.device.id,
      horizontal: s.horizontal,
    }));
    return json(res, 200, current);
  }
  if (path === "/api/frame") {
    // On Windows, smaller WebKit captures can stall native tap and focus.
    const scale =
      s.device?.engine === "chromium" && [0.25, 0.5, 0.75, 1].includes(b.scale)
        ? b.scale
        : 1;
    const image = await readFrame(s, b.after, s.display.sharp ? 1 : scale, res);
    if (res.destroyed) return;
    res.setHeader("X-Page-Url", encodeURIComponent(view(s).url));
    const scroll = await scrollPosition(s, !!image);
    const position = {};
    for (const axis of ["x", "y"]) {
      const values = scroll?.[axis];
      if (
        Array.isArray(values) &&
        values.length === 2 &&
        values.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
      ) {
        position[axis] = values;
      }
    }
    res.setHeader("X-Scroll", JSON.stringify(position));
    if (!image) return res.writeHead(204).end();
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "X-Frame-Number": image.number,
    });
    return res.end(image.data);
  }
  if (path === "/api/close") {
    s.closing = true;
    await s.queue;
    await destroy(s);
    return json(res, 200, {});
  }
  if (path !== "/api/action")
    return json(res, 404, { error: "Ruta desconocida." });
  const peers =
    Array.isArray(b.peers) &&
    ["tap", "scroll", "text", "key"].includes(b.action)
      ? [...new Set(b.peers.slice(0, 2))]
          .map((id) => sessions.get(id))
          .filter((peer) => peer && peer !== s)
      : [];
  const { target, url } = await enqueue(s, async () => {
    const url = view(s).url;
    const target = peers.length
      ? await locateSource(s.page, b).catch(() => null)
      : null;
    await action(s, b);
    return { target, url };
  });
  for (const peer of peers) {
    // Keep each follower ordered without delaying the next action on the source.
    void enqueue(peer, () => {
      if (view(peer).url === url) return mirror(peer, b, target);
    }).catch(() => {});
  }
  return json(res, 200, view(s));
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (!okHosts.has(req.headers.host))
    return json(res, 403, { error: "Acceso local requerido." });
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path.startsWith("/api/")) return await api(req, res, path);
    const name = path === "/" ? "index.html" : path.slice(1);
    if (req.method !== "GET" || !publicFiles.has(name))
      return json(res, 404, { error: "Página no encontrada." });
    const file = await readFile(join(root, name));
    res.setHeader(
      "Content-Type",
      types[name.split(".").pop()] + "; charset=utf-8",
    );
    if (name === "index.html") res.setHeader("X-Frame-Options", "DENY");
    res.end(file);
  } catch (err) {
    if (!res.headersSent)
      json(res, 400, { error: String(err.message).slice(0, 450) });
  }
});
setInterval(() => {
  for (const s of sessions.values())
    if (!s.pending && Date.now() - s.last > 20 * 60 * 1000) {
      s.closing = true;
      void destroy(s);
    }
}, 60000).unref();
async function isCurrentEngine(port) {
  try {
    const response = await fetch(originFor(port) + "/api/status", {
      signal: AbortSignal.timeout(700),
      redirect: "error",
    });
    const status = response.ok ? await response.json() : null;
    return status?.app === "forma" && status.display === true;
  } catch {
    return false;
  }
}
function listen(port) {
  return new Promise((resolve, reject) => {
    const failed = (err) => {
      server.off("listening", ready);
      reject(err);
    };
    const ready = () => {
      server.off("error", failed);
      okHosts.add(`127.0.0.1:${port}`);
      okHosts.add(`localhost:${port}`);
      resolve();
    };
    server.once("error", failed);
    server.once("listening", ready);
    server.listen(port, "127.0.0.1");
  });
}
async function start() {
  const open = process.argv.includes("--open");
  const ports = open && !process.env.FORMA_PORT
    ? launcherPorts
    : [Number(process.env.FORMA_PORT || launcherPorts[0])];
  const show = (port) => {
    const url = originFor(port) + "/";
    console.log("UITESTER · " + url);
    if (open && process.platform === "win32")
      spawn("explorer.exe", [url], { detached: true, stdio: "ignore" }).unref();
  };
  if (open) {
    const existing = await Promise.all(ports.map(isCurrentEngine));
    const current = existing.indexOf(true);
    if (current !== -1) return show(ports[current]);
  }
  for (const port of ports) {
    try {
      await listen(port);
      return show(port);
    } catch (err) {
      if (!open || err.code !== "EADDRINUSE") throw err;
      if (await isCurrentEngine(port)) return show(port);
    }
  }
  throw new Error("Los puertos locales de UITESTER están ocupados (" + ports.join(", ") + ").");
}
await start().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
async function stop() {
  server.close();
  await Promise.allSettled(
    [...engines.values()].map(async (b) => (await b)?.close()),
  );
  process.exit(0);
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
