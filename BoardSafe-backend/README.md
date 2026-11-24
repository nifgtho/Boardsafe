# BoardSafe — Backend integral de movilidad inclusiva y resiliencia vial

**Versión 1.0 · 20 de noviembre de 2026 · WFEO Hackathon 2027 (retos 1, 3 y 4)**

**Este repositorio NO es la presentación HTML ni un simulador con datos precargados.** Es un backend de aplicación persistente con API REST, autenticación por roles, transacciones, reglas operacionales, reportes de campo, sensores, mapas GeoJSON, motor OSRM, observaciones meteorológicas y procesos de vigilancia/recuperación. No incluye personas, rutas, peligros o vehículos ficticios en la base de datos inicial.

**Estado verificado:** 27 pruebas de API y lógica aprobaron localmente con SQLite y se probó la cadena de migraciones. **Estado NO verificado:** despliegue PostgreSQL/PostGIS + Docker/OSRM a escala o con datos reales, integraciones oficiales, CCTV físico y certificaciones regulatorias. Es un backend funcional para integración, no una plataforma homologada para dirigir emergencias reales.

## 1. Qué resuelve exactamente

- **Reto 1:** solicitudes voluntarias de rampa, audio, texto y ayuda de abordaje; acceso desde cuenta de pasajero o tótem autorizado **sin cuenta ni carnet**; asignación a vehículo que confirme plaza/rampa; verificación de bahía; ciclo COC hasta completar el viaje.
- **Reto 3:** mantenimiento de paraderos/vehículos/telemetría; API de sensores Edge que recibe **únicamente metadatos**; reportes ciudadanos y de transportistas; autenticación por rol; outbox de eventos, WebSocket, auditoría; planificación por rutas OSRM y datos cartográficos reales.
- **Reto 4:** reportes validados, restricciones viales confirmadas por autoridad, invalidación de rutas afectadas y continuidad del viaje; zonas de riesgo con fuente y versión, ingesta de lluvia observada o pronóstico, índice heurístico de prioridad de inspección, recursos de respuesta y decisiones humanas registradas.

### Innovación de producto

**Contrato Operativo de Continuidad (COC):** conecta solicitud de accesibilidad, paradero, vehículo, ruta verificada y autoridad. Cuando una vía se cierra, se revocan rutas que la intersectan y los viajes afectados pasan a espera segura o estado de interrupción. No se muestran personas vulnerables identificables en mapas públicos.

## 2. Estructura

```text
boardsafe-backend/
├── app/
│   ├── main.py, config.py, db.py, models.py, schemas.py, security.py
│   ├── api/          auth, operations, assistance, kiosk, reports, roads,
│   │                 sensing, resilience, map_events
│   ├── domain/       geo.py, rules.py
│   ├── integrations/ osrm.py, open_meteo.py
│   ├── services.py   auditoría, eventos, cierre e invalidación
│   ├── workers.py    caducidad de solicitudes y eventos Edge
│   └── cli.py        administrar e importar GTFS/GeoJSON
├── edge/             nodo CCTV/RTSP opcional: detección de obstrucciones sin video
├── migrations/       migraciones Alembic y geometrías PostGIS
├── docs/             especificación, integración y OpenAPI exportado
├── tests/            pruebas de dominio, roles y reglas de seguridad
├── scripts/          OSRM, entorno local y generación OpenAPI
├── examples/         ejemplos, nunca datos reales de producción
├── compose.yaml      PostgreSQL/PostGIS, API, worker, OSRM opcional
└── Dockerfile, pyproject.toml, .env.example
```

## 3. Arranque local rápido (API real con SQLite)

Requisitos: Python 3.11+, pip, acceso a PyPI para instalar dependencias.

```bash
unzip boardsafe-backend.zip
cd boardsafe-backend
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\\Scripts\\activate
pip install -e '.[test]'
# Para desarrollo local; no usar SQLite para explotación multiusuario
export BOARDSAFE_DATABASE_URL=sqlite:///./boardsafe.db
export BOARDSAFE_ENVIRONMENT=development
export BOARDSAFE_JWT_SECRET="$(openssl rand -hex 32)"
alembic upgrade head
python -m app.cli bootstrap-admin --email admin@ejemplo.com
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

- Documentación interactiva de endpoints: `http://127.0.0.1:8000/docs`
- OpenAPI: `http://127.0.0.1:8000/openapi.json`
- Salud DB: `http://127.0.0.1:8000/health/ready`
- Enrutamiento OSRM devuelve `503` hasta configurar `BOARDSAFE_OSRM_BASE_URL`; **no se fabrican rutas**.
- El endpoint meteorológico para Open-Meteo está desactivado inicialmente por cuestiones de licencia y responsabilidad. Los sensores físicos necesitan registro y secreto.

## 4. Docker/PostGIS — despliegue previsto

Requisitos: Docker Engine + Compose, RAM/disk suficientes para OSRM y acceso a registros de contenedores.

```bash
cp .env.example .env
# Edite .env: DB_PASSWORD, BOARDSAFE_DATABASE_URL, JWT_SECRET, INGEST_TOKEN.
# Contraseñas/secretos generados de forma independiente, sin espacios de relleno.
openssl rand -hex 32
# Primero PostgreSQL, migraciones, API y worker:
docker compose up -d --build postgres migrate api worker
# Cree el administrador (interactivo):
docker compose exec api python -m app.cli bootstrap-admin --email admin@su-dominio.com
# Compruebe estado:
curl http://127.0.0.1:8000/health/ready
```

**Preparar y arrancar enrutamiento de PERÚ** (descarga pública de Geofabrik aprox. cientos de MB; procesamiento requiere recursos superiores al ZIP):

```bash
./scripts/prepare_osrm.sh
docker compose --profile routing up -d osrm
curl 'http://127.0.0.1:5000/route/v1/driving/-76.24,-9.93;-76.23,-9.92?geometries=geojson'
```

No sustituya la geografía del piloto por rutas artificiales. Para otro país cambie el PBF, el nombre de salida y la configuración. Las rutas OSRM son candidatos; **un inspector debe verificarlas**, y se invalidan ante cierres autorizados. OSM tiene condiciones de atribución y licencia ODbL.

**Producción:** use TLS en el reverse proxy, rate limiting por IP, WAF según exposición, control de CORS, almacenamiento cifrado, backups restaurables, supervisión, autenticación reforzada de operadores y evaluación regulatoria. La API de Compose solo publica en `127.0.0.1`, no expone públicamente PostgreSQL. No conecte CCTV de terceros sin autorización y sin evaluación de privacidad.

## 5. Primeros datos reales y usuarios

Primero cree un administrador (CLI). Inicie sesión con `POST /api/v1/auth/login` y use el JWT para crear personal con `POST /api/v1/auth/staff` (`driver`, `dispatcher`, `inspector`, `authority`). El registro público solo crea `passenger`.

**Importar paraderos de un GTFS real** (archivo local con `stops.txt`):

```bash
python -m app.cli import-gtfs --file /ruta/al/feed.zip --prefix transportista-autorizado
```

**Importar zonas de susceptibilidad derivadas de una fuente con permiso y versión conocida** (FeatureCollection de puntos con propiedades `susceptibility` 0..5, `radius_m`, `critical_access`):

```bash
python -m app.cli import-risk-geojson --file /ruta/zonas.geojson \
  --source "Fuente institucional verificada" --version "2026-11-20"
```

Si se habilita `BOARDSAFE_OPEN_METEO_ENABLED=true` y se confirma la licencia, el worker actualiza por lotes pronósticos cada hora, priorizando zonas que llevan más tiempo sin evaluación. Genera eventos `risk.watch_recommended` exclusivamente para **revisión humana**, nunca como alertas oficiales de desastre.

La fuente oficial y la metodología deben validarse. El archivo `examples/risk_zones.example.geojson` es **ficticio** y solo sirve para demostrar el formato; no se importa automáticamente.

## 6. Mapas y contratos con el frontend

- `GET /api/v1/map/features?bbox=minLon,minLat,maxLon,maxLat` devuelve GeoJSON FeatureCollection. Úsese como fuente del mapa **MapLibre**, Leaflet u otra biblioteca del frontend; referencia de coordenadas WGS84 `[longitud, latitud]`.
- `POST /api/v1/routes/plan` consulta **OSRM real** (`geometries=geojson`, `alternatives=true`) y genera rutas candidatas persistidas con GeoJSON, distancia y tiempo estimado.
- `POST /api/v1/routes/{id}/verify` exige rol inspector/autoridad y motivo, con caducidad; bloquea geometrías que intersectan restricciones confirmadas.
- `GET /api/v1/events?since_id=...` y `WS /api/v1/ws/events` permiten actualización de panel institucional; WS recibe JWT como **primer mensaje**. Pasajeros consultan solo su solicitud, por privacidad.
- Los elementos del mapa NO muestran ubicaciones de pasajeros ni diagnósticos.

Consulte `docs/FRONTEND_INTEGRATION.md` y `docs/openapi.json` para todos los endpoints y ejemplos.

## 7. Roles y permisos

| Rol | Puede hacer | No puede hacer |
|---|---|---|
| `passenger` | Crear/ver/cancelar su propia asistencia, reportar, completar su viaje | Cerrar vías, ver solicitudes ajenas |
| tótem | Crear solicitud sin cuenta con token temporal, consultar estado con token | Leer datos de terceros, validar seguridad |
| `driver` | Confirmar el estado de su vehículo, aceptar/abordar viajes asignados y reportar | Cerrar vías o acceder a diagnósticos |
| `dispatcher` | Crear paraderos/vehículos, verificar bahía, asignar unidades y planificar rutas | Cerrar una carretera |
| `inspector` | Verificar reportes, inspeccionar rutas y producir evaluaciones de riesgo | Despachar recursos sin autorización |
| `authority` | Confirmar cierres/reaperturas, gestionar recursos, revisar riesgos | Confiar en reportes no verificados como cierres automáticos |
| `admin` | Provisionamiento y controles de sistema | La validación regulatoria sigue siendo externa |

## 8. Pruebas y evidencia

```bash
pytest -q
pytest --cov=app --cov-report=term-missing
python scripts/export_openapi.py
BOARDSAFE_DATABASE_URL=sqlite:///./migration-check.db alembic upgrade head
```

La suite cubre: autenticación/roles, acceso privado, integración del COC, cierre e invalidación, abordaje seguro, flujo completo, reporte con corroboración, rate limit por usuario, sensores y fallback humano, tótem sin cuenta, GeoJSON, rutas OSRM mediante mock HTTP, límites de riesgo, interrupción de un viaje abordado y reglas geográficas. El mock solo controla la **respuesta del proveedor externo durante las pruebas**; la implementación de producción realiza peticiones HTTP a OSRM.

**Criterio de aceptación de campo:** aún requiere comprobación con un operador real, licencias y permisos de CCTV, conectividad, datos oficiales, evaluación de sesgos, geología y pruebas con usuarios. El resultado de pruebas unitarias no acredita homologación ni certificación.

## 9. Referencias técnicas

- OSRM: https://project-osrm.org/docs/v26.4.0/http
- Geofabrik Perú: https://download.geofabrik.de/south-america/peru.html
- OpenStreetMap/ODbL: https://www.openstreetmap.org/copyright
- GTFS: https://gtfs.org/documentation/overview/
- Open-Meteo: https://open-meteo.com/en/terms
- WCAG 2.2: https://www.w3.org/TR/WCAG22/

**BoardSafe** · Software de decisión y coordinación, no sustituto de seguridad operativa certificada.
