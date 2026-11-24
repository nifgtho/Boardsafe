import "server-only";

const headers = { "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache", "Referrer-Policy": "no-referrer" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
type Operation = "requests" | "tracking" | "complete";
const supportValues = new Set(["ramp", "audio", "text", "boarding_help"]);

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("json");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body");
  let length = 0; const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > 8192) { await reader.cancel(); throw new Error("size"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("body");
  return body;
}
function valid(body: Record<string, unknown>, operation: Operation) {
  if (operation !== "requests") return Object.keys(body).length === 1 && typeof body.token === "string" && body.token.length >= 30 && body.token.length <= 256;
  const fields = ["destination_lat", "destination_lon", "support", "consent_operational"];
  return Object.keys(body).length === fields.length && Object.keys(body).every((key) => fields.includes(key)) &&
    typeof body.destination_lat === "number" && Number.isFinite(body.destination_lat) && Math.abs(body.destination_lat) <= 90 &&
    typeof body.destination_lon === "number" && Number.isFinite(body.destination_lon) && Math.abs(body.destination_lon) <= 180 &&
    body.consent_operational === true && Array.isArray(body.support) && body.support.length > 0 && body.support.length <= 4 &&
    body.support.every((value) => typeof value === "string" && supportValues.has(value)) && new Set(body.support).size === body.support.length;
}

export async function proxyKiosk(request: Request, operation: Operation) {
  // Browser-only, same-origin POST. Never accept a caller-selected upstream/node/key.
  const origin = request.headers.get("origin");
  try {
    const supplied = new URL(origin ?? "");
    if (supplied.host !== request.headers.get("host") || !["http:", "https:"].includes(supplied.protocol) || supplied.username || supplied.password) throw new Error("origin");
  } catch { return reply({ detail: "Origen no autorizado para este tótem." }, 403); }
  const internal = process.env.BOARDSAFE_INTERNAL_API_URL;
  const nodeId = process.env.BOARDSAFE_KIOSK_NODE_ID;
  const nodeKey = process.env.BOARDSAFE_KIOSK_NODE_KEY;
  if (!internal || (operation === "requests" && (!nodeId || !nodeKey))) return reply({ detail: "Tótem pendiente de configuración por el responsable del servidor." }, 503);
  let body: Record<string, unknown>;
  try { body = await readBody(request); if (!valid(body, operation)) throw new Error("contract"); }
  catch { return reply({ detail: "Revisa destino, apoyos y consentimiento o el código temporal. No se admiten campos adicionales." }, 422); }
  try {
    const base = new URL(internal.endsWith("/") ? internal : `${internal}/`);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("configuration");
    const path = operation === "requests" ? `kiosk/${encodeURIComponent(nodeId!)}/requests` : `kiosk/${operation}`;
    const response = await fetch(new URL(path, base), {
      method: "POST", headers: { "Content-Type": "application/json", ...(operation === "requests" ? { "X-Node-Key": nodeKey! } : {}) },
      body: JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok) {
      const status = [400, 401, 403, 404, 409, 422, 429, 503].includes(response.status) ? response.status : 503;
      // Do not relay request dumps, validation inputs or upstream headers.
      const detail = status === 409 ? "El viaje aún no está confirmado como iniciado. Solicita ayuda al personal." : status === 401 ? "Código temporal inválido o vencido, o tótem sin autorización." : status === 429 ? "Espera antes de intentar otra solicitud." : "No se pudo realizar la operación. Revisa los datos o solicita ayuda al personal.";
      return reply({ detail }, status);
    }
    if (operation === "requests") return reply({ request_id: data.request_id, tracking_token: data.tracking_token, expires_at: data.expires_at, instruction: data.instruction }, 201);
    if (operation === "tracking") return reply({ request_id: data.request_id, state: data.state, stop_id: data.stop_id, support: data.support, vehicle_assigned: data.vehicle_assigned, expires_at: data.expires_at });
    return reply({ request_id: data.request_id, state: data.state });
  } catch { return reply({ detail: "El servicio no está disponible temporalmente. Solicita ayuda al personal." }, 503); }
}
