# BoardSafe — Contrato de integración para frontend (Next.js / React / Web / Mobile)

**Principio:** El frontend NO decide si una vía está oficialmente cerrada, si un abordaje es seguro o si una plaza puede reservarse. Solo representa el estado retornado por el backend y emite acciones explícitas de los actores autorizados. Las reglas del COC viven en el servidor.

## Variables para el frontend

```env
NEXT_PUBLIC_BOARDSAFE_API_URL=http://127.0.0.1:8000/api/v1
NEXT_PUBLIC_BOARDSAFE_WS_URL=ws://127.0.0.1:8000/api/v1/ws/events
```

**HTTPS en producción.** Las cuentas usan Bearer JWT: `Authorization: Bearer <token>`. El backend no establece cookies ni necesita CSRF para este modo de autenticación. El frontend debe mantener los tokens en memoria y revisar su estrategia de sesión antes de lanzar producción; no guardarlos en URL ni `localStorage` sin una evaluación de amenazas. Para móviles, almacén seguro del sistema operativo.

`Content-Type: application/json` para solicitudes JSON. Todos los IDs de recursos son UUID v4 serializados como string. Fechas de API en UTC con zona `Z` o ISO UTC equivalente. Las coordenadas GeoJSON son `[longitud, latitud]`; los campos del formulario son latitud y longitud separados.

## Usuarios y pantallas sugeridas

| Vista | Operaciones | Flujo importante |
|---|---|---|
| Administrador | `GET /auth/staff`, `POST /auth/staff` | Listado persistente de personal; sin contraseñas ni hashes; solo admin |
| Pasajero | `GET /stops`, `POST /assistance`, `GET /assistance/{id}`, `POST /assistance/{id}/cancel`, `POST /assistance/{id}/complete` | Solicita rampa/audio/texto sin diagnóstico |
| Tótem sin cuenta | `POST /kiosk/{node_id}/requests`, `POST /kiosk/tracking`, `POST /kiosk/complete` | Dispositivo autenticado; devuelve código temporal una vez |
| Transportista | `GET /vehicles`, `PATCH /vehicles/{id}/status`, `GET /assistance`, `POST /assistance/{id}/accept`, `POST /assistance/{id}/board`, `POST /reports` | Confirma plaza accesible y rampa antes del abordaje |
| Operador | `POST /stops`, `PATCH /stops/{id}/bay`, `POST /vehicles`, `POST /routes/plan`, `POST /assistance/{id}/offer`, `POST /assistance/{id}/recover` | Decide servicio y verifica acceso al paradero |
| Inspector | `POST /reports/{id}/review`, `POST /routes/{id}/verify`, `POST /risk/zones/{id}/assess` | Corrobora el estado en campo |
| Autoridad | `POST /roads/restrictions`, `PATCH /roads/restrictions/{id}`, `POST /resources`, `POST /resources/{id}/decision`, `POST /risk/zones/{id}/outlook` | Revisa, justifica y firma decisión operativa |
| Mapa | `GET /map/features`, `GET /routes`, `GET /roads/restrictions` | GeoJSON; nunca mostrar posición personal |
| Centro de eventos | `GET /events?since_id=...`, WebSocket `/ws/events` | Refrescar estado multi-pantalla |

## Ejemplo JS: cliente de API

```js
const API = process.env.NEXT_PUBLIC_BOARDSAFE_API_URL;
async function api(path, { token, method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  if (!r.ok) {
    const detail = json.detail;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return json;
}

// Un pasajero autenticado solicita ayuda en un paradero real ya cargado.
const request = await api('/assistance', {
  token: passengerToken, method: 'POST', body: {
    stop_id: stopId,
    destination_lat: destinationLat,
    destination_lon: destinationLon,
    support: ['ramp', 'audio'],
    consent_operational: true,
  },
});

// El frontend consulta su estado; nunca publica la ubicación personal.
const current = await api(`/assistance/${request.id}`, { token: passengerToken });
```

## Ejemplo: acceso por tótem sin carnet

El operador registra un nodo `kind: "totem"` desde `POST /edge/nodes` con token de administrador. El backend muestra `node_secret` **una sola vez**. El secreto se instala únicamente en el dispositivo o un gateway confiable, **nunca en una app web pública**.

```http
POST /api/v1/kiosk/{NODE_ID}/requests
X-Node-Key: SECRET_ONLY_IN_TRUSTED_KIOSK
Content-Type: application/json

{
  "destination_lat": -9.92,
  "destination_lon": -76.23,
  "support": ["ramp", "audio"],
  "consent_operational": true
}
```

Respuesta: `request_id`, `tracking_token` aleatorio y `expires_at`. El token solo permite consultar **esa solicitud** y completar el viaje tras confirmar el abordaje.

```http
POST /api/v1/kiosk/tracking
Content-Type: application/json

{"token":"TEMPORARY_TRACKING_TOKEN"}
```

No enviar la credencial temporal en la URL ni en logs. El frontend debe limpiar esta información al terminar.

## Ejemplo: asignación de viaje

1. El conductor confirma capacidad actual del autobús con `PATCH /vehicles/{id}/status`:

```json
{"accessible_spaces_free":1,"ramp_ok":true,"at_lat":-9.93,"at_lon":-76.24}
```

2. El despachador solicita rutas OSRM con `POST /routes/plan` (las opciones solo son `candidate`).
3. El inspector comprueba campo/permiso y llama `POST /routes/{id}/verify` con `{ "note": "Verificado por inspección ...", "valid_minutes": 60 }`.
4. El despachador asigna `POST /assistance/{id}/offer` con `vehicle_id` y `route_id`. Se rechaza si no hay plaza/rampa o si otro servicio ya comprometió la plaza.
5. El conductor acepta con `POST /assistance/{id}/accept`.
6. El operador comprueba físicamente bahía `PATCH /stops/{id}/bay` con `{"status":"clear","note":"Inspección física ..."}`.
7. Conductor confirma `POST /assistance/{id}/board`; servidor comprueba nuevamente ruta, cierre, fecha de verificación, vehículo, bahía y estado.
8. Pasajero o conductor completa `POST /assistance/{id}/complete`.

Si una autoridad confirma cierre que intersecta la ruta, las solicitudes se actualizan a `waiting_safe` (aún no abordadas) o `interrupted` (ya a bordo). El frontend debe mostrar acciones alternativas, no información falsa de llegada.

## Ejemplo: reporte y revisión

```http
POST /api/v1/reports
Authorization: Bearer <JWT_PASAJERO_O_CONDUCTOR>
Content-Type: application/json

{"kind":"debris","description":"Material sobre el carril junto al cruce, requiere inspección", "lat":-9.93,"lon":-76.24}
```

El nuevo reporte es `pending`, y no cierra rutas. `inspector` o `authority` realiza `POST /reports/{id}/review` con `{"status":"verified","reason":"Corroboración por ..."}`. Únicamente `authority` puede crear un cierre usando `POST /roads/restrictions` con `name`, GeoJSON LineString, `confirmation_note` y opcional `source_report_id` corroborado.

## Ejemplo: mapa con MapLibre

La aplicación de mapas y los tiles **pertenecen al frontend**. La API entrega los datos como GeoJSON verificables. Para presentar el mapa se necesita un estilo MapLibre y un proveedor de tiles autorizado o propio.

```js
// map: instancia de maplibregl.Map existente en cliente
const geojson = await api('/map/features?bbox=-76.30,-10.0,-76.10,-9.8', { token });
map.addSource('boardsafe', { type: 'geojson', data: geojson });
map.addLayer({
  id: 'boardsafe-paraderos', type: 'circle', source: 'boardsafe',
  filter: ['==', ['get', 'kind'], 'stop'],
  paint: { 'circle-radius': 7, 'circle-color': '#087f78' }
});
// Defina por separado capas para road_restriction, risk_zone y vehicle.
```

**Atribución OSM obligatoria.** No utilizar tile.openstreetmap.org como proveedor indiscriminado en una plataforma municipal; establecer proveedor comercial o self-hosting acorde a los términos.

## Ejemplo: eventos en tiempo real

Solo `dispatcher`, `inspector`, `authority` y `admin` acceden al WebSocket institucional.

```js
const ws = new WebSocket(process.env.NEXT_PUBLIC_BOARDSAFE_WS_URL);
ws.addEventListener('open', () => ws.send(operatorToken)); // JWT en primer frame
ws.addEventListener('message', event => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'event') {
    // volver a consultar el recurso afectado y actualizar la vista
  }
});
```

Para recuperar eventos perdidos tras reconexión: `GET /events?since_id=ULTIMO_ID_RECIBIDO`, autenticado. El driver/pasajero debe consultar solo sus recursos autorizados; no compartir el feed institucional.

## Error handling y experiencia inclusiva

- `401`: sesión inválida, token de tótem vencido o clave errónea.
- `403`: rol no autorizado.
- `404`: recurso inexistente.
- `409`: conflicto de dominio (ruta sin verificar, cámara fuera de servicio, bahía bloqueada, capacidad desconocida, cierre confirmado, etc.). `detail` puede ser `{message, reasons}`.
- `422`: error de validación de entrada.
- `429`: límites de reportes y del proxy de acceso.
- `503`: proveedor de rutas/meteo no disponible, nunca mostrar una alternativa inventada.

El frontend siempre debe traducir códigos a mensajes naturales, accesibles, no alarmistas y con alternativa de actuación humana. Objetivo WCAG 2.2 AA y accesibilidad multimodal (lector de pantalla, alto contraste, navegación teclado, audio/texto).

## No hacer

- No identificar discapacidad desde cámaras ni inferir diagnósticos.
- No publicar ubicación exacta de personas vulnerables.
- No mostrar índice heurístico de riesgo como probabilidad de deslizamiento.
- No prometer llegada o desvío seguro mientras no exista verificación de operador/autoridad.
- No guardar JWT o `node_secret` en código fuente, repositorio o almacenamiento inseguro.
- No conectar cámaras sin autorización y aprobación de políticas de privacidad.

## Nodos y módulos institucionales

`GET /api/v1/edge/nodes` requiere admin y devuelve columnas operativas sin
`secret_hash`. `POST /edge/nodes` devuelve `node_secret` solo en el alta.
La web incluye eventos con replay, métricas, auditoría (autoridad/admin), riesgo,
recursos y `/totem`. El proxy Next `/api/kiosk/*` no reenvía `X-Node-Key` al
navegador y recibe sus credenciales por variables privadas de runtime.
