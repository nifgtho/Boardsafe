import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const backend = path.resolve(frontend, "../BoardSafe-backend");
const web = process.env.BOARDSAFE_E2E_WEB_URL ?? "http://127.0.0.1:3000";
const env = await readFile(path.join(frontend, ".env.local"), "utf8").catch(() => "");
const entry = env.match(/^NEXT_PUBLIC_BOARDSAFE_API_URL\s*=\s*(.+)$/m)?.[1].trim();
const configuredApi = new URL(process.env.BOARDSAFE_E2E_API_BASE ?? entry?.replace(/^(['"])(.*)\1$/, "$2") ?? "http://127.0.0.1:8000/api/v1", web).href.replace(/\/$/, "");
const password = randomBytes(24).toString("base64url");
const sensitive = [password];
async function freeLocalPort() {
  return await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
}
const freePort = await freeLocalPort();
const testApi = `http://127.0.0.1:${freePort}/api/v1`;
const fixture = spawn(path.join(backend, ".venv/bin/python"), ["tests/journey_browser_server.py", "--port", String(freePort)], {
  cwd: backend, env: { ...process.env, BOARDSAFE_E2E_PASSWORD: password, BOARDSAFE_E2E_WEB_ORIGIN: new URL(web).origin }, stdio: ["ignore", "pipe", "pipe"],
});
let fixtureLogs = "";
fixture.stdout.on("data", (chunk) => { fixtureLogs += chunk; });
fixture.stderr.on("data", (chunk) => { fixtureLogs += chunk; });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
let kioskServer;
let kioskLogs = "";
let cleaningUp = false;
const socketsByRole = new Map();
const pageErrors = [];
const consoleErrors = [];
const proxyErrors = [];
const apiFailures = [];

// A valid, deterministic raster tile keeps provider requests out of browser tests.
function rasterFixture() {
  function chunk(type, data) {
    const label = Buffer.from(type);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([label, data])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, label, data, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256, 0);
  header.writeUInt32BE(256, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((256 * 4 + 1) * 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) pixels.set([15, 23, 42, 255], y * 1025 + x * 4 + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

async function api(endpoint, token, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${testApi}${endpoint}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error(`${endpoint}: HTTP ${response.status}, response is not JSON`); }
  assert.ok(response.ok, `${endpoint}: HTTP ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function waitFor(condition, description, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await sleep(200);
  }
  throw new Error(`Timeout: ${description}`);
}

async function visible(locator) {
  await locator.waitFor({ state: "visible", timeout: 25000 });
}

async function session(role) {
  const viewport = role === "passenger" ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
  const context = await browser.newContext({ viewport });
  const sockets = [];
  socketsByRole.set(role, sockets);
  await context.routeWebSocket("**/api/v1/ws/events", (route) => {
    const upstream = new WebSocket(`${testApi.replace("http:", "ws:")}/ws/events`);
    sockets.push(upstream);
    const waiting = [];
    route.onMessage((message) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(message); else waiting.push(message); });
    upstream.addEventListener("open", () => { for (const message of waiting) upstream.send(message); });
    upstream.addEventListener("message", (event) => { if (!cleaningUp) route.send(event.data); });
    upstream.addEventListener("error", () => {});
    upstream.addEventListener("close", (event) => route.close({ code: event.code === 1006 ? 1011 : event.code }).catch(() => {}));
    route.onClose(() => upstream.close());
  });
  // All API requests go to the temporary fixture, even though the app uses its normal URL.
  await context.route(`${configuredApi}/**`, async (route) => {
    const suffix = route.request().url().slice(configuredApi.length);
    try {
      const response = await route.fetch({ url: `${testApi}${suffix}` });
      await route.fulfill({ response });
    } catch {
      // Do not print Playwright's request dump: it can include Authorization.
      if (!cleaningUp && !route.request().failure()) proxyErrors.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort().catch(() => {});
    }
  });
  const png = rasterFixture();
  await context.route(/https:\/\/(?:api\.maptiler\.com|server\.arcgisonline\.com)\//, (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  const page = await context.newPage();
  page.on("response", (response) => { if (response.status() >= 400 && response.url().startsWith(configuredApi)) apiFailures.push(`${role}: ${response.status()} ${new URL(response.url()).pathname}`); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/status of 409/.test(message.text()) && !(message.location().url.includes("/refresh-forecast") && /status of 503/.test(message.text()))) {
      consoleErrors.push(message.text().replace(/key=[^\s&"')]+/g, "key=[redacted]"));
    }
  });
  await page.goto(web);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "El acceso cabe en la pantalla");
  await page.getByLabel("Correo electrónico").fill(`${role}@boardsafe.test`);
  await page.getByLabel(/^Contraseña/).fill(password);
  await page.getByRole("button", { name: "Entrar a BoardSafe" }).click();
  await visible(page.getByRole("button", { name: "Salir", exact: true }));
  const map = await page.locator("#workspace-map").boundingBox();
  const form = await page.locator("#workspace-start").boundingBox();
  assert.ok(map && form);
  if (role === "passenger") assert.ok(map.y >= form.y + form.height, "Formulario primero en móvil");
  else assert.ok(map.x + map.width <= form.x, "Mapa a la izquierda en escritorio");
  return page;
}

async function exerciseRiskAndKiosk(authority, tokens, stop, vehicle) {
  await authority.getByRole("navigation", { name: "Áreas de trabajo" }).getByRole("button", { name: "Riesgo y recursos", exact: true }).click();
  await authority.getByText("Registrar zona de inspección", { exact: true }).click();
  await authority.getByLabel("Nombre de zona", { exact: true }).fill("[E2E] Zona temporal");
  await authority.getByLabel("Latitud (zona)", { exact: true }).fill("-9.93");
  await authority.getByLabel("Longitud (zona)", { exact: true }).fill("-76.24");
  await authority.getByLabel("Fuente verificable de la zona").fill("Fuente de prueba aislada sin uso operativo");
  await authority.getByLabel("Versión de la fuente").fill("fixture-v1");
  await authority.getByRole("button", { name: "Registrar zona", exact: true }).click();
  await waitFor(async () => (await api("/risk/zones", tokens.authority)).length === 1, "zone from UI");
  const zone = (await api("/risk/zones", tokens.authority))[0];
  await authority.getByRole("button", { name: "Evaluar prioridad observada" }).click();
  await waitFor(async () => (await api("/risk/assessments", tokens.authority)).length === 1, "observed assessment from UI");
  const priorRoads = (await api("/roads/restrictions", tokens.authority)).length;
  await authority.getByRole("button", { name: "Actualizar pronóstico autorizado" }).click();
  await visible(authority.getByText(/Servicio externo no disponible temporalmente/));
  assert.equal((await api("/roads/restrictions", tokens.authority)).length, priorRoads, "risk does not close roads");
  await authority.getByText("Registrar recurso", { exact: true }).click();
  await authority.getByLabel("Código del recurso").fill("E2E-BRIGADA");
  await authority.getByLabel("Latitud (recurso)").fill("-9.93");
  await authority.getByLabel("Longitud (recurso)").fill("-76.24");
  await authority.getByRole("button", { name: "Guardar recurso" }).click();
  await waitFor(async () => (await api("/resources", tokens.authority)).length === 1, "resource from UI");
  const asset = (await api("/resources", tokens.authority))[0];
  await authority.getByLabel("Zona de la decisión").selectOption(zone.id);
  for (const action of ["prepare", "deploy", "stand_down"]) {
    await authority.getByLabel("Acción del recurso").selectOption(action);
    await authority.getByLabel("Justificación de la decisión").fill("Decisión simulada en entorno de pruebas; sin movilización real");
    await authority.getByRole("button", { name: "Firmar decisión del recurso" }).click();
    await waitFor(async () => (await api("/resources", tokens.authority))[0].state === ({ prepare: "prepared", deploy: "deployed", stand_down: "available" }[action]), `resource ${action}`);
  }
  await authority.getByRole("button", { name: "Consultar recursos candidatos" }).click();
  await visible(authority.getByRole("complementary", { name: "Recursos candidatos" }));
  assert.equal((await api(`/resources/recommend/${zone.id}`, tokens.authority)).options[0].asset_id, asset.id);

  const admin = await session("admin");
  await admin.getByRole("navigation", { name: "Áreas de trabajo" }).getByRole("button", { name: "Nodos y tótems", exact: true }).click();
  await admin.getByLabel("Código del nodo").fill("E2E-TOTEM");
  await admin.getByRole("button", { name: "Actualizar nodos" }).click();
  try { await waitFor(async () => await admin.locator(`#node-target option[value="${stop.id}"]`).count() === 1, "node stop option"); }
  catch { throw new Error(`Node loading: ${await admin.getByRole("region", { name: "Nodos Edge y tótem" }).getByRole("alert").allTextContents()} · ${apiFailures.join("; ")}`); }
  await admin.getByLabel("Paradero del nodo").selectOption(stop.id);
  await admin.getByRole("button", { name: "Provisionar nodo" }).click();
  await visible(admin.getByLabel("Secreto privado del nodo"));
  const key = await admin.getByLabel("Secreto privado del nodo").inputValue(); sensitive.push(key);
  const nodes = await api("/edge/nodes", tokens.admin);
  assert.equal(nodes.length, 1); assert.ok(!JSON.stringify(nodes).includes(key));
  await admin.getByRole("button", { name: "Ya guardé el secreto; ocultar" }).click();
  assert.equal(await admin.getByLabel("Secreto privado del nodo").count(), 0);

  const port = await freeLocalPort();
  const kioskOrigin = `http://127.0.0.1:${port}`;
  kioskServer = spawn(process.execPath, [".next/standalone/server.js"], { cwd: frontend, env: {
    ...process.env, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1",
    BOARDSAFE_INTERNAL_API_URL: testApi, BOARDSAFE_KIOSK_NODE_ID: nodes[0].id, BOARDSAFE_KIOSK_NODE_KEY: key,
  }, stdio: ["ignore", "ignore", "pipe"] });
  kioskServer.stderr.on("data", (chunk) => { kioskLogs += chunk; });
  await waitFor(async () => {
    if (kioskServer.exitCode !== null) throw new Error("Standalone kiosk server exited; run npm run build first");
    try { return (await fetch(`${kioskOrigin}/totem`)).ok; } catch { return false; }
  }, "isolated kiosk standalone ready");
  const invalid = await fetch(`${kioskOrigin}/api/kiosk/requests`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://untrusted.test" }, body: "{}" });
  assert.equal(invalid.status, 403);
  const extra = await fetch(`${kioskOrigin}/api/kiosk/requests`, { method: "POST", headers: { "Content-Type": "application/json", Origin: kioskOrigin }, body: JSON.stringify({ destination_lat: -9.92, destination_lon: -76.23, support: ["audio"], consent_operational: true, node_secret: "caller-cannot-override" }) });
  assert.equal(extra.status, 422);
  const context = await browser.newContext(); const page = await context.newPage();
  const observedRequests = [];
  page.on("request", (request) => observedRequests.push({ url: request.url(), headers: request.headers() }));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  console.log("E2E: proxy privado y viaje desde tótem");
  await context.route("**/api/v1/stops", (route) => route.fulfill({ json: [stop] }));
  await context.route("https://photon.komoot.io/api/**", (route) => route.fulfill({ json: {
    features: [{ geometry: { coordinates: [-76.23, -9.92] }, properties: { name: "Plaza de prueba", city: "Huánuco" } }],
  } }));
  await page.goto(`${kioskOrigin}/totem`);
  await page.getByRole("button", { name: new RegExp(stop.code) }).click();
  await page.getByRole("button", { name: "Cambiar destino" }).click();
  await page.getByLabel("Nombre del paradero, lugar o dirección").fill("Plaza de prueba");
  await page.getByRole("button", { name: "Buscar lugar o dirección" }).click();
  await page.getByRole("button", { name: "Plaza de prueba Huánuco" }).click();
  await page.getByRole("checkbox", { name: /Consiento/ }).check();
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/kiosk/requests") && request.method() === "POST");
  await page.getByRole("button", { name: "Solicitar asistencia sin cuenta", exact: true }).click();
  const body = (await sent).postDataJSON();
  assert.equal(body.destination_lat, -9.92);
  assert.equal(body.destination_lon, -76.23);
  await visible(page.getByLabel("Código privado de seguimiento (se muestra una vez)"));
  const trackingToken = await page.getByLabel("Código privado de seguimiento (se muestra una vez)").inputValue(); sensitive.push(trackingToken);
  await page.getByRole("button", { name: "Ya guardé mi código" }).click();
  const trackResponse = await fetch(`${kioskOrigin}/api/kiosk/tracking`, { method: "POST", headers: { "Content-Type": "application/json", Origin: kioskOrigin }, body: JSON.stringify({ token: trackingToken }) });
  assert.equal(trackResponse.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(trackResponse.status, 200, "Kiosk tracking proxy response");
  const tracking = await trackResponse.json();
  const routes = await api("/routes", tokens.dispatcher);
  const verified = routes.find((route) => route.status === "verified" && route.valid_now);
  await api(`/vehicles/${vehicle.id}/status`, tokens.driver, { accessible_spaces_free: 1, ramp_ok: true, at_lat: -9.93, at_lon: -76.24 }, "PATCH");
  await api(`/stops/${stop.id}/bay`, tokens.dispatcher, { status: "clear", note: "Inspección de prueba de tótem en fixture" }, "PATCH");
  await api(`/assistance/${tracking.request_id}/offer`, tokens.dispatcher, { vehicle_id: vehicle.id, route_id: verified.id });
  await api(`/assistance/${tracking.request_id}/accept`, tokens.driver, {});
  await api(`/assistance/${tracking.request_id}/board`, tokens.driver, {});
  await visible(page.getByRole("button", { name: "Confirmar llegada y finalizar" }));
  await page.getByRole("button", { name: "Confirmar llegada y finalizar" }).click();
  await visible(page.getByText("Viaje completado. El código temporal se borró.", { exact: true }));
  const revoked = await fetch(`${kioskOrigin}/api/kiosk/tracking`, { method: "POST", headers: { "Content-Type": "application/json", Origin: kioskOrigin }, body: JSON.stringify({ token: trackingToken }) });
  assert.equal(revoked.status, 401);
  assert.ok(observedRequests.every((request) => !request.headers["x-node-key"] && !request.url.includes(key) && !request.url.includes(trackingToken)));
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  assert.equal(await page.getByLabel("Código privado de seguimiento (se muestra una vez)").count(), 0);
  await context.close();
}

try {
  await waitFor(async () => {
    if (fixture.exitCode !== null) throw new Error(`Fixture exited: ${fixtureLogs}`);
    try { return (await fetch(`http://127.0.0.1:${freePort}/health/ready`)).ok; } catch { return false; }
  }, "fixture API ready");
  const tokens = {};
  for (const role of ["admin", "dispatcher", "driver", "inspector", "authority", "passenger"]) {
    tokens[role] = (await api("/auth/login", null, { email: `${role}@boardsafe.test`, password })).access_token;
  }
  const driver = await api("/auth/me", tokens.driver);
  const stop = await api("/stops", tokens.dispatcher, { code: "E2E-STOP", name: "[E2E] Paradero aislado", lat: -9.93, lon: -76.24, wheelchair_accessible: true });
  const vehicle = await api("/vehicles", tokens.dispatcher, { code: "E2E-BUS", operator_name: "[E2E] Operador de prueba", driver_id: driver.id, accessible_spaces_total: 1 });
  await api(`/vehicles/${vehicle.id}/status`, tokens.driver, { accessible_spaces_free: 1, ramp_ok: true, at_lat: -9.93, at_lon: -76.24 }, "PATCH");

  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  console.log("E2E: personal y sesión institucional");
  const adminPage = await session("admin");
  await adminPage.getByRole("navigation", { name: "Áreas de trabajo" }).getByRole("button", { name: "Personal", exact: true }).click();
  await visible(adminPage.getByRole("heading", { name: "Personal registrado", exact: true }));
  await visible(adminPage.getByText("driver@boardsafe.test", { exact: true }));
  await Promise.all([
    adminPage.waitForResponse((response) => response.url().endsWith("/auth/logout") && response.status() === 200),
    adminPage.getByRole("button", { name: "Salir", exact: true }).click(),
  ]);
  await waitFor(async () => socketsByRole.get("admin").every((socket) => socket.readyState >= WebSocket.CLOSING), "logout closes client sockets");
  await adminPage.context().unrouteAll({ behavior: "wait" });
  await adminPage.context().close();
  console.log("E2E: ciclo COC y cierre vial");
  const passenger = await session("passenger");
  await passenger.getByLabel("Paradero de origen").selectOption(stop.id);
  await passenger.getByLabel("Latitud de destino").fill("-9.92");
  await passenger.getByLabel("Longitud de destino").fill("-76.23");
  const passengerNav = passenger.getByRole("navigation", { name: "Áreas de trabajo" });
  await passengerNav.getByRole("button", { name: "Reportes y vías" }).click();
  assert.equal(await passenger.getByLabel("Paradero de origen").isVisible(), false);
  await passengerNav.getByRole("button", { name: "Viajes" }).click();
  assert.equal(await passenger.getByLabel("Longitud de destino").inputValue(), "-76.23");
  assert.ok(await passenger.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "El panel de pasajero cabe en móvil");
  await passenger.getByRole("checkbox", { name: /consiento|consentimiento|autorizo/i }).check();
  await passenger.getByRole("button", { name: /enviar solicitud|solicitar asistencia/i }).click();
  await waitFor(async () => (await api("/assistance", tokens.passenger)).length === 1, "passenger creates request");
  const request = (await api("/assistance", tokens.passenger))[0];

  const dispatch = await session("dispatcher");
  await dispatch.getByRole("button", { name: "Calcular alternativas viales" }).click();
  await visible(dispatch.getByText("Candidata: requiere inspección", { exact: true }));
  const inspector = await session("inspector");
  await inspector.getByLabel("Evidencia de inspección").fill("Inspección simulada dentro de la base temporal de pruebas");
  await inspector.getByRole("button", { name: "Firmar verificación" }).click();
  await visible(inspector.getByText("Verificada y vigente", { exact: true }));
  await dispatch.getByRole("button", { name: /^Solicitudes/ }).click();
  await dispatch.locator("#workspace-start").getByRole("button", { name: "Actualizar", exact: true }).click();
  await waitFor(async () => await dispatch.locator(`#assign-route-${request.id} option`).count() > 1, "verified route in selector");
  const routes = await api("/routes", tokens.dispatcher);
  await dispatch.getByLabel("Unidad con conductor").selectOption(vehicle.id);
  await dispatch.getByLabel("Ruta verificada para este destino").selectOption(routes[0].id);
  await dispatch.getByRole("button", { name: "Asignar unidad y ruta", exact: true }).click();
  await waitFor(async () => (await api(`/assistance/${request.id}`, tokens.passenger)).state === "offered", "offer created");

  const driverPage = await session("driver");
  await driverPage.getByRole("button", { name: "Aceptar servicio", exact: true }).click();
  await visible(driverPage.getByRole("button", { name: "Confirmar abordaje seguro" }));
  await driverPage.getByRole("button", { name: "Confirmar abordaje seguro" }).click();
  await visible(driverPage.getByText("El acceso del paradero no está confirmado como despejado", { exact: true }));
  assert.equal((await api(`/assistance/${request.id}`, tokens.passenger)).state, "accepted");
  await api(`/stops/${stop.id}/bay`, tokens.dispatcher, { status: "clear", note: "Inspección de bahía en fixture de pruebas" }, "PATCH");
  await driverPage.getByRole("button", { name: "Confirmar abordaje seguro" }).click();
  await visible(driverPage.getByRole("button", { name: "Finalizar viaje" }));

  await passenger.getByRole("navigation", { name: "Áreas de trabajo" }).getByRole("button", { name: "Reportes y vías", exact: true }).click();
  await passenger.getByLabel("Descripción del reporte").fill("[E2E] Daño vial que requiere una inspección de prueba");
  await passenger.getByLabel("Latitud del reporte").fill("-9.925");
  await passenger.getByLabel("Longitud del reporte").fill("-76.235");
  await passenger.getByRole("button", { name: "Enviar reporte", exact: true }).click();
  await waitFor(async () => (await api("/reports", tokens.passenger)).length === 1, "report created without automatic closure");
  assert.equal((await api("/roads/restrictions", tokens.authority)).length, 0);
  await inspector.getByRole("navigation", { name: "Áreas de trabajo" }).getByRole("button", { name: "Reportes y vías", exact: true }).click();
  await inspector.getByRole("button", { name: "Actualizar reportes y vías" }).click();
  await inspector.getByLabel("Motivo de revisión").fill("Daño corroborado en el escenario temporal de pruebas");
  await inspector.getByRole("button", { name: "Guardar revisión del reporte" }).click();
  await waitFor(async () => (await api("/reports", tokens.inspector))[0].status === "verified", "report corroborated");
  assert.equal((await api("/roads/restrictions", tokens.authority)).length, 0);
  const authority = await session("authority");
  await authority.getByRole("navigation", { name: "Áreas de trabajo" }).getByRole("button", { name: "Reportes y vías", exact: true }).click();
  await authority.getByRole("button", { name: "Dibujar tramo en mapa" }).click();
  for (const [lon, lat] of [[-76.235, -9.932], [-76.235, -9.918]]) {
    await authority.getByLabel("Latitud del punto de vía").fill(String(lat));
    await authority.getByLabel("Longitud del punto de vía").fill(String(lon));
    await authority.getByRole("button", { name: "Añadir punto al tramo" }).click();
  }
  await authority.getByLabel("Nombre del tramo").fill("[E2E] Cierre aislado");
  const sourceReport = (await api("/reports", tokens.authority))[0];
  await authority.getByRole("button", { name: "Actualizar reportes y vías" }).click();
  await waitFor(async () => await authority.locator(`#road-source-report option[value="${sourceReport.id}"]`).count() === 1, "verified report option available");
  await authority.getByLabel("Reporte corroborado de origen (opcional)").selectOption(sourceReport.id);
  await authority.getByLabel("Evidencia de confirmación vial").fill("Cierre simulado exclusivamente en base de pruebas");
  await authority.getByRole("button", { name: "Confirmar restricción vial" }).click();
  await waitFor(async () => (await api(`/assistance/${request.id}`, tokens.passenger)).state === "interrupted", "closure interrupts journey");
  await dispatch.locator("#workspace-start").getByRole("button", { name: "Actualizar", exact: true }).click();
  await visible(dispatch.getByRole("button", { name: "Recuperar viaje con alternativa" }));
  await dispatch.getByRole("button", { name: "Calcular alternativas viales" }).click();
  await inspector.getByRole("navigation", { name: "Áreas de trabajo" }).getByRole("button", { name: "Viajes", exact: true }).click();
  await inspector.locator("#workspace-start").getByRole("button", { name: "Actualizar", exact: true }).click();
  await waitFor(async () => await inspector.getByLabel("Evidencia de inspección").count() === 2, "new alternative visible");
  const alternative = (await api("/routes", tokens.inspector)).find((route) => route.status === "candidate");
  await inspector.locator(`#verify-note-${alternative.id}`).fill("Desvío inspeccionado dentro del escenario de pruebas");
  await inspector.locator(`#verify-note-${alternative.id}`).locator("xpath=ancestor::form").getByRole("button", { name: "Firmar verificación" }).click();
  await dispatch.getByRole("button", { name: /^Solicitudes/ }).click();
  await dispatch.locator("#workspace-start").getByRole("button", { name: "Actualizar", exact: true }).click();
  await waitFor(async () => await dispatch.locator(`#assign-route-${request.id} option`).count() > 1, "alternative is selectable");
  await dispatch.getByLabel("Ruta verificada para este destino").selectOption(alternative.id);
  await dispatch.getByRole("button", { name: "Recuperar viaje con alternativa" }).click();
  await waitFor(async () => (await api(`/assistance/${request.id}`, tokens.passenger)).state === "onboard", "recovery confirmed");
  await driverPage.locator("#workspace-start").getByRole("button", { name: "Actualizar", exact: true }).click();
  await driverPage.getByRole("button", { name: "Finalizar viaje" }).click();
  await waitFor(async () => (await api(`/assistance/${request.id}`, tokens.passenger)).state === "completed", "journey completed");
  await passenger.getByRole("navigation", { name: "Áreas de trabajo" }).getByRole("button", { name: "Viajes", exact: true }).click();
  await passenger.locator("#workspace-start").getByRole("button", { name: "Actualizar", exact: true }).click();
  await visible(passenger.getByText("Viaje completado", { exact: true }));
  await dispatch.getByRole("button", { name: /^Rutas/ }).click();
  await dispatch.getByRole("button", { name: "Ver en mapa", exact: true }).first().click();
  await sleep(2000);
  await mkdir(path.join(frontend, "test-results"), { recursive: true });
  await dispatch.screenshot({ path: path.join(frontend, "test-results/journey-dispatch.png"), fullPage: true });
  console.log("E2E: reconexión, replay y auditoría");
  assert.equal(socketsByRole.get("passenger").length, 0, "Passengers must not open institutional sockets");
  assert.equal(socketsByRole.get("driver").length, 0, "Drivers must not open institutional sockets");
  await dispatch.getByRole("navigation", { name: "Áreas de trabajo" }).getByRole("button", { name: "Continuidad", exact: true }).click();
  await visible(dispatch.getByText(/Eventos conectados/));
  const replayRequests = [];
  dispatch.on("request", (request) => { if (request.url().includes("/events?since_id=")) replayRequests.push(request.url()); });
  socketsByRole.get("dispatcher").at(-1).close(4002, "E2E reconnect");
  await waitFor(async () => socketsByRole.get("dispatcher").length >= 2, "institutional reconnect");
  await visible(dispatch.getByText(/Eventos conectados/));
  await waitFor(async () => replayRequests.some((url) => Number(new URL(url).searchParams.get("since_id")) > 0), "replay uses last received event cursor");
  await authority.getByRole("navigation", { name: "Áreas de trabajo" }).getByRole("button", { name: "Continuidad", exact: true }).click();
  await visible(authority.getByRole("heading", { name: "Continuidad y auditoría", exact: true }));
  await authority.getByText(/^Acciones auditadas/).click();
  await visible(authority.getByText("road.restriction_confirmed", { exact: true }));
  await driverPage.getByRole("button", { name: "Salir", exact: true }).click();
  await visible(driverPage.getByRole("button", { name: "Entrar a BoardSafe" }));
  for (const page of [driverPage, dispatch, passenger, inspector]) {
    await page.context().unrouteAll({ behavior: "wait" });
    await page.context().close();
  }
  console.log("E2E: riesgo, recursos y tótem");
  await exerciseRiskAndKiosk(authority, tokens, stop, vehicle);
  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join("; ")}`);
  const uniqueErrors = [...new Set(consoleErrors)];
  assert.deepEqual(uniqueErrors, [], `Browser console errors: ${uniqueErrors.join("; ")}`);
  assert.deepEqual([...new Set(proxyErrors)], [], "Unexpected isolated API proxy failures");
  console.log("Browser E2E passed: COC, reportes/cierres, replay WebSocket, auditoría, riesgo, recursos y tótem con proxy privado.");
} catch (failure) {
  let message = String(failure instanceof Error ? failure.stack : failure);
  message += `\nAPI failures: ${apiFailures.join("; ")}`;
  const alerts = await Promise.all((browser?.contexts() ?? []).flatMap((context) => context.pages().map((page) => page.getByRole("alert").allTextContents().catch(() => []))));
  message += `\nVisible alerts: ${JSON.stringify(alerts.flat())}`;
  for (const value of sensitive) message = message.replaceAll(value, "[redacted]");
  message = message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
  if (kioskLogs) {
    await mkdir(path.join(frontend, "test-results"), { recursive: true });
    let logs = kioskLogs;
    for (const value of sensitive) logs = logs.replaceAll(value, "[redacted]");
    await writeFile(path.join(frontend, "test-results/kiosk-server.log"), logs, { mode: 0o600 });
  }
  throw new Error(message);
} finally {
  cleaningUp = true;
  for (const peers of socketsByRole.values()) for (const peer of peers) peer.close();
  await Promise.all((browser?.contexts() ?? []).map((context) => context.unrouteAll({ behavior: "ignoreErrors" })));
  await browser?.close();
  await Promise.all([kioskServer, fixture].filter(Boolean).map((child) => new Promise((resolve) => {
    if (child.exitCode !== null) { resolve(); return; }
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    child.kill("SIGTERM");
  })));
}
