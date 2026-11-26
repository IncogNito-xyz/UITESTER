// Run with the local laboratory started. All target pages and test data are temporary.
import assert from "node:assert/strict";
import http from "node:http";
import { networkInterfaces } from "node:os";
import { chromium } from "playwright-core";
const address = "http://127.0.0.1:" + (process.env.FORMA_PORT || 4317);
const reports = [];
const lan = Object.values(networkInterfaces())
  .flat()
  .find(
    (i) =>
      i.family === "IPv4" &&
      !i.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address),
  )?.address;
function fixture(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/report") {
    reports.push({
      ...Object.fromEntries(url.searchParams),
      serverCookie: (req.headers.cookie || "").includes("http-session=active"),
    });
    res.writeHead(204);
    res.end();
    return;
  }
  if (url.searchParams.has("login"))
    res.setHeader("Set-Cookie", "http-session=active; HttpOnly; Path=/");
  if (url.pathname === "/logout")
    res.setHeader("Set-Cookie", "http-session=; HttpOnly; Path=/; Max-Age=0");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Frame-Options": "DENY",
  });
  res.end(
    `<meta name="viewport" content="width=device-width,initial-scale=1">
    <style>*{box-sizing:border-box}body{margin:0;height:200vh}input{width:100%;height:90px;font-size:24px}#panel{height:175px;overflow:auto;background:#ddd}#panel div{height:570px;background:repeating-linear-gradient(#aab 0 30px,#ddd 30px 60px)}</style>
    <input aria-label="Prueba"><div id="panel"><div>Panel desplazable</div></div>
    ${url.pathname === "/slow" ? '<style>#focus-input{display:block;width:125px;height:32px}@media(max-width:1200px){#blocker{position:absolute;top:265px;width:125px;height:32px;z-index:2}}</style><button id="focus-input" onclick="document.querySelector(\'input\').focus()">Escribir</button><div id="blocker"></div>' : '<a href="/next">Siguiente</a>'}
    <script>
    const input=document.querySelector("input"), panel=document.querySelector("#panel");
    if(new URLSearchParams(location.search).has("login")) {
      sessionStorage.setItem("session-test", "active");
      localStorage.setItem("session-test", "active");
      document.cookie = "session-test=active; Path=/";
      history.replaceState(null, "", "/app?q=1");
    }
    if(location.pathname === "/logout") {
      sessionStorage.removeItem("session-test");
      localStorage.removeItem("session-test");
      document.cookie = "session-test=; Path=/; Max-Age=0";
      history.replaceState(null, "", "/signed-out");
    }
    function report(){fetch("/report?"+new URLSearchParams({w:innerWidth,h:innerHeight,dpr:devicePixelRatio,touch:navigator.maxTouchPoints,ua:navigator.userAgent,input:input.value,path:location.pathname,scroll:scrollY,panel:panel.scrollTop,session:sessionStorage.getItem("session-test"),local:localStorage.getItem("session-test"),cookie:document.cookie.includes("session-test=active")}))}
    addEventListener("resize",report);addEventListener("scroll",report);input.oninput=report;panel.onscroll=report;report();
    </script>`,
  );
}
async function listen(host) {
  const server = http.createServer(fixture);
  await new Promise((r, j) => server.once("error", j).listen(0, host, r));
  return server;
}
const local = await listen("127.0.0.1"),
  remote = lan ? await listen(lan) : undefined;
let browser;
async function waitFor(check) {
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(
    check(),
    "Falta una medición de la página emulada: " +
      JSON.stringify(reports.slice(-4)),
  );
}
async function checkScrolling(page, engine) {
  const box = await page.locator("#live").boundingBox();
  const x = box.x + box.width * 0.5;
  const y = (position) => box.y + box.height * position;
  const firstReport = reports.length;
  const matches = (predicate) =>
    reports.slice(firstReport).some((r) => predicate(r));

  const panelY =
    box.y +
    (box.height * 170) /
      (await page.locator("#live").evaluate((el) => el.clientHeight));
  await page.mouse.move(x, panelY);
  const priorSource = await page.locator("#live").getAttribute("src");
  await page.mouse.wheel(0, 130);
  await waitFor(() => matches((r) => Number(r.panel) > 0));
  await page.waitForFunction(
    (src) => {
      const bar = document.querySelector("#scroll-y");
      return (
        bar &&
        !bar.hidden &&
        parseFloat(bar.firstElementChild.style.top) > 0 &&
        document.querySelector("#live").src !== src
      );
    },
    priorSource,
    { timeout: 3000 },
  );
  await page.locator("#touch-cursor").waitFor({ timeout: 2000 });
  await page.mouse.move(x, y(0.65));
  await page.mouse.down();
  try {
    const started = performance.now();
    await page.mouse.move(x, y(0.41), { steps: 5 });
    await waitFor(() => matches((r) => Number(r.scroll) > 0));
    console.log(
      engine +
        " desplazó antes de soltar el mouse en " +
        Math.round(performance.now() - started) +
        " ms.",
    );
  } finally {
    await page.mouse.up();
  }
}
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(address);
  await page.locator(".entry").first().waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Simulador web" }).count(),
    0,
  );
  for (const control of ["#model-name", "#rotate", "#zoom", "#expand"]) {
    assert.ok(await page.locator(".stage-footer " + control).isVisible());
  }
  const deviceView = await page.locator("#scaled").boundingBox();
  const workspace = await page.locator("#workspace").boundingBox();
  assert.ok(deviceView.height > 770);
  assert.ok(960 - (workspace.y + workspace.height) <= 8);
  console.log(
    "Altura de la vista del dispositivo: " +
      Math.round(deviceView.height) +
      " px.",
  );
  assert.equal(await page.locator(".entry").count(), 24);
  await page
    .frameLocator("#preview")
    .locator("#w")
    .filter({ hasText: "393" })
    .waitFor();
  await page.getByRole("button", { name: "Tema claro" }).click();
  await page.getByRole("button", { name: "Ocultar panel lateral" }).click();
  assert.equal(await page.locator("#sidebar").isVisible(), false);
  assert.equal((await page.locator(".sidebar-rail").boundingBox()).width, 36);
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.getByRole("button", { name: "Mostrar panel lateral" }).click();
  assert.ok(await page.locator("#sidebar").isVisible());
  await page.getByRole("button", { name: "Tablets", exact: true }).click();
  assert.equal(await page.locator(".entry").count(), 8);
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  const url = "localhost:" + local.address().port + "/app?q=1&login";
  await page.locator("#address").fill(url);
  await page.locator("#load").click();
  try {
    await page.locator("#live").waitFor({ timeout: 27000 });
  } catch (e) {
    throw Error(
      "Motor inicial: " + (await page.locator("#notice").textContent()),
      { cause: e },
    );
  }
  await waitFor(() =>
    reports.some(
      (r) =>
        r.w === "393" &&
        r.h === "852" &&
        r.dpr === "3" &&
        r.ua.includes("iPhone"),
    ),
  );
  const box = await page.locator("#live").boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.05);
  await page.keyboard.type("Forma");
  await waitFor(() => reports.some((r) => r.input === "Forma"));
  await page.reload();
  await page.locator("#live").waitFor({ timeout: 5000 });
  assert.match(await page.locator("#address").inputValue(), /\/app\?q=1$/);
  const beforeReload = reports.length;
  await page.locator("#reload").click();
  const signedIn = (r) =>
    r.session === "active" &&
    r.local === "active" &&
    r.cookie === "true" &&
    r.serverCookie;
  await waitFor(() => reports.slice(beforeReload).some(signedIn));
  await checkScrolling(page, "WebKit");
  const comparison = page.locator("#comparison");
  const ready = () => page.locator("#load:enabled").waitFor();
  assert.equal(await page.locator(".workspace").count(), 1);
  await comparison.selectOption("2");
  await page.locator("#live-2").waitFor();
  assert.equal(await page.locator(".workspace").count(), 2);
  const picker = page.getByRole("combobox", {
    name: "Buscar modelo para la vista 2",
  });
  await picker.fill("Galaxy A54");
  const result = page.getByRole("option", { name: "Galaxy A54" });
  assert.equal(await result.locator("strong").textContent(), "Galaxy A54");
  await page.locator("#workspace-2 .profile-clear").click();
  assert.equal(await picker.inputValue(), "");
  await picker.fill("Galaxy A54");
  await result.click();
  await page.waitForFunction(
    () => document.querySelector("#model-name-2").textContent === "Galaxy A54",
  );
  await picker.fill("iPad Air");
  await picker.press("Enter");
  await page.waitForFunction(() =>
    document.querySelector("#model-name-2").textContent.includes("iPad Air"),
  );
  await comparison.selectOption("3");
  await page.locator("#live-3").waitFor();
  assert.equal(await page.locator(".workspace").count(), 3);
  await waitFor(() => reports.some((r) => r.w === "1440" && r.touch === "0"));
  for (const width of [1280, 2560]) {
    await page.setViewportSize({ width, height: 960 });
    const boxes = await Promise.all(
      (await page.locator(".workspace").all()).map((pane) =>
        pane.boundingBox(),
      ),
    );
    assert.ok(boxes[0].x < boxes[1].x && boxes[1].x < boxes[2].x);
    assert.ok(boxes[2].x + boxes[2].width <= width);
  }
  const outer = [
    ["Ajustar borde izquierdo", "#workspace", -110],
    ["Ajustar borde derecho", "#workspace-3", 110],
  ];
  for (const [label, selector, delta] of outer) {
    const edge = page.getByRole("button", { name: label });
    const grip = await edge.boundingBox();
    const target = page.locator(selector);
    const before = (await target.boundingBox()).width;
    const middle = (await page.locator("#workspace-2").boundingBox()).width;
    assert.ok(grip, "Falta el tirador: " + label);
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta, y, { steps: 5 });
    await page.mouse.up();
    assert.ok((await target.boundingBox()).width > before + 100);
    assert.ok(Math.abs((await page.locator("#workspace-2").boundingBox()).width - middle) < 2);
    await edge.dblclick();
    assert.ok(Math.abs((await target.boundingBox()).width - before) < 2);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  const columnGrip = page.getByRole("button", { name: "Ajustar ancho entre vistas 2 y 3" });
  const third = page.locator("#workspace-3");
  const stage3 = page.locator("#stage-3");
  const originalWidth = (await third.boundingBox()).width;
  const originalHeight = (await stage3.boundingBox()).height;
  const column = await columnGrip.boundingBox();
  assert.ok(column, "Falta el tirador entre las vistas 2 y 3");
  const columnX = column.x + column.width / 2;
  const columnY = column.y + column.height / 2;
  await page.mouse.move(columnX, columnY);
  await page.mouse.down();
  await page.mouse.move(columnX - 75, columnY, { steps: 5 });
  await page.mouse.up();
  assert.ok((await third.boundingBox()).width > originalWidth + 60);
  const widerHeight = (await stage3.boundingBox()).height;
  const secondHeight = (await page.locator("#stage-2").boundingBox()).height;
  const heightGrip = third.getByRole("button", { name: "Ajustar altura de la vista" });
  const bottom = await heightGrip.boundingBox();
  const bottomX = bottom.x + bottom.width / 2;
  const bottomY = bottom.y + bottom.height / 2;
  await page.mouse.move(bottomX, bottomY);
  await page.mouse.down();
  await page.mouse.move(bottomX, bottomY - 65, { steps: 4 });
  await page.mouse.up();
  assert.ok((await stage3.boundingBox()).height < widerHeight - 50);
  assert.equal((await page.locator("#stage-2").boundingBox()).height, secondHeight);
  await heightGrip.dblclick();
  await columnGrip.dblclick();
  assert.ok(Math.abs((await third.boundingBox()).width - originalWidth) < 2);
  assert.ok(Math.abs((await stage3.boundingBox()).height - originalHeight) < 2);
  assert.match(await page.locator("#metrics-3").textContent(), /1440 × 900/);
  const desktopImage = page.locator("#live-3");
  await page.waitForFunction(() => {
    const image = document.querySelector("#live-3");
    const width = image.getBoundingClientRect().width;
    return image.naturalWidth >= width - 2 && image.naturalWidth <= 720;
  });
  const capture = () => desktopImage.evaluate(async (image) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
    bytes: (await (await fetch(image.src)).blob()).size,
  }));
  const fitted = await capture();
  await page.locator("#zoom-3").selectOption("1");
  await page.waitForFunction(
    () => document.querySelector("#live-3").naturalWidth === 1440,
  );
  const full = await capture();
  assert.ok(fitted.bytes < full.bytes);
  console.log(
    `Captura PC ajustada: ${fitted.width} × ${fitted.height}, ${fitted.bytes} bytes. ` +
      `Al 100 %: ${full.width} × ${full.height}, ${full.bytes} bytes.`,
  );
  await page.locator("#zoom-3").selectOption("fit");
  const settings = page.getByRole("button", { name: "Configuración", exact: true });
  const displayView = page.getByLabel("Vista", { exact: true });
  await settings.click();
  await displayView.selectOption("2");
  await page.getByLabel("Ancho (px)").fill("1600");
  await page.getByLabel("Alto (px)").fill("1000");
  await page.getByLabel("Densidad (DPR)").fill("2");
  await page.getByLabel("Captura nítida").check();
  await page.getByRole("button", { name: "Aplicar" }).click();
  await waitFor(() => reports.some((r) => r.w === "1600" && r.h === "1000" && r.dpr === "2"));
  await page.waitForFunction(() => document.querySelector("#live-3").naturalWidth > 1600);
  await settings.click();
  await displayView.selectOption("2");
  await page.getByRole("button", { name: "Restaurar perfil" }).click();
  await page.getByRole("button", { name: "Aplicar" }).click();
  await page.waitForFunction(() => document.querySelector("#metrics-3").textContent === "1440 × 900 px");
  await page.locator("#rotate-2").click();
  await waitFor(() => reports.some((r) => r.w === "1180" && r.h === "820"));
  await page.reload();
  await page.locator("#live-3").waitFor();
  await ready();
  assert.equal(await comparison.inputValue(), "3");
  assert.match(await page.locator("#metrics-2").textContent(), /1180 × 820/);
  assert.match(await page.locator("#metrics").textContent(), /393 × 852/);
  assert.match(await page.locator("#metrics-3").textContent(), /1440 × 900/);
  await page
    .locator("#address")
    .fill("localhost:" + local.address().port + "/compare");
  await page.locator("#load").click();
  await waitFor(
    () =>
      new Set(reports.filter((r) => r.path === "/compare").map((r) => r.w))
        .size === 3,
  );
  await ready();
  const pc = await page.locator("#live-3").boundingBox();
  await page.mouse.click(pc.x + pc.width * 0.5, pc.y + pc.height * 0.04);
  await page.keyboard.type("Sync");
  await waitFor(
    () =>
      new Set(
        reports
          .filter((r) => r.path === "/compare" && r.input === "Sync")
          .map((r) => r.w),
      ).size === 3,
  );
  await page.mouse.move(pc.x + pc.width * 0.5, pc.y + pc.height * 0.6);
  await page.mouse.wheel(0, 120);
  await waitFor(
    () =>
      new Set(
        reports
          .filter((r) => r.path === "/compare" && Number(r.scroll) > 0)
          .map((r) => r.w),
      ).size === 3,
  );
  await page
    .locator("#address")
    .fill("localhost:" + local.address().port + "/slow");
  await page.locator("#load").click();
  await waitFor(
    () =>
      new Set(reports.filter((r) => r.path === "/slow").map((r) => r.w))
        .size === 3,
  );
  await ready();
  const slowView = await page.locator("#live-3").boundingBox();
  const start = performance.now();
  await page.mouse.click(
    slowView.x + (slowView.width * 55) / 1440,
    slowView.y + (slowView.height * 280) / 900,
  );
  await page.keyboard.type("R");
  await waitFor(() =>
    reports.some(
      (r) => r.path === "/slow" && r.w === "1440" && r.input === "R",
    ),
  );
  const responseTime = Math.round(performance.now() - start);
  assert.ok(
    responseTime < 1000,
    "La escritura esperó por la vista secundaria: " + responseTime + " ms",
  );
  console.log(
    "Vista activa respondió al clic y escritura en " +
      responseTime +
      " ms mientras las otras vistas tenían el botón cubierto.",
  );
  await page
    .locator("#address")
    .fill("localhost:" + local.address().port + "/links");
  await page.locator("#load").click();
  await waitFor(
    () =>
      new Set(reports.filter((r) => r.path === "/links").map((r) => r.w))
        .size === 3,
  );
  await ready();
  const linkedView = await page.locator("#live-3").boundingBox();
  await page.mouse.click(
    linkedView.x + (linkedView.width * 25) / 1440,
    linkedView.y + (linkedView.height * 275) / 900,
  );
  await waitFor(
    () =>
      new Set(reports.filter((r) => r.path === "/next").map((r) => r.w))
        .size === 3,
  );
  await comparison.selectOption("1");
  await page.locator("#live-3").waitFor({ state: "detached" });
  await ready();
  assert.equal(await page.locator(".workspace").count(), 1);
  console.log(
    "OK: dos y tres vistas, giro independiente, clic, teclado, scroll y navegación sincronizados.",
  );
  await page.locator("#rotate").click();
  await waitFor(() => reports.some((r) => r.w === "852" && r.h === "393"));
  const beforeSwitch = reports.length;
  await page.locator("[data-id=d5]").click();
  await waitFor(() =>
    reports.slice(beforeSwitch).some(
      (r) =>
        r.w === "1280" &&
        r.h === "800" &&
        r.ua.includes("Android") &&
        r.dpr === "2" &&
        signedIn(r),
    ),
  );
  await page.locator("#rotate").click();
  await waitFor(() => reports.some((r) => r.w === "800" && r.h === "1280"));
  await checkScrolling(page, "Chromium");
  const gpuToggle = page.getByRole("checkbox", { name: "Usar GPU en Chromium" });
  await gpuToggle.check();
  const beforeGpu = reports.length;
  await page.locator("#address").fill("localhost:" + local.address().port + "/gpu");
  await page.locator("#load").click();
  await ready();
  await waitFor(() => reports.slice(beforeGpu).some((report) => report.path === "/gpu" && signedIn(report)));
  const gpuStatus = await page.locator("#state").textContent();
  assert.match(gpuStatus, /^Chromium · (GPU activa|GPU no disponible)$/);
  if (process.env.FORMA_TEST_GPU === "1") assert.equal(gpuStatus, "Chromium · GPU activa");
  console.log(gpuStatus + ". La sesión conservó el almacenamiento del sitio.");
  await page.locator("#address").fill(
    "localhost:" + local.address().port + "/logout",
  );
  await page.locator("#load").click();
  await waitFor(() => reports.some((r) => r.path === "/signed-out"));
  await ready();
  await page.reload();
  await page.locator("#live").waitFor();
  assert.ok(await gpuToggle.isChecked());
  assert.equal(await page.locator("#state").textContent(), gpuStatus);
  const afterLogout = reports.length;
  await page.locator("#reload").click();
  await waitFor(() =>
    reports.slice(afterLogout).some(
      (r) =>
        r.path === "/signed-out" &&
        r.session === "null" &&
        r.local === "null" &&
        r.cookie === "false" &&
        !r.serverCookie,
    ),
  );
  if (process.env.FORMA_TEST_HOST) {
    await page
      .locator("#address")
      .fill(
        process.env.FORMA_TEST_HOST + ":" + local.address().port + "/dominio",
      );
    await page.locator("#load").click();
    await waitFor(() => reports.some((r) => r.path === "/dominio"));
    console.log("Dominio local verificado: " + process.env.FORMA_TEST_HOST);
  }
  const dest = remote ? lan + ":" + remote.address().port : "/unused";
  if (remote) {
    await page.locator("#address").fill(dest + "/red");
    await page.locator("#load").click();
    await waitFor(() => reports.some((r) => r.path === "/red"));
  }
  await page.locator("#search").fill("Xiaomi");
  assert.equal(await page.locator(".entry").count(), 3);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator(".stage-footer #expand").isVisible());
  await page.locator("#library").click();
  await page.locator("[data-id=d3]").click();
  await waitFor(() =>
    reports.some((r) => r.w === "393" && r.ua.includes("Xiaomi")),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(problems, []);
  await page.route("**/api/frame", (route) => route.fulfill({
    status: 410,
    contentType: "application/json",
    body: JSON.stringify({ error: "La sesión terminó. Vuelve a abrir la URL." }),
  }));
  await page.locator("#preview").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#notice").textContent.includes("La sesión terminó"));
  assert.deepEqual(problems, []);
  console.log(
    "OK: 24 modelos, temas persistentes, escritorio y móvil, WebKit y Chromium, dimensiones, DPR, entrada táctil y teclado, rotación, dominio localhost y " +
      (remote ? "dirección LAN " + lan : "sin interfaz LAN disponible") +
      ".",
  );
} finally {
  await browser?.close();
  local.closeAllConnections();
  local.close();
  remote?.closeAllConnections();
  remote?.close();
}
