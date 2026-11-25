# BoardSafe — Informe verificable de entrega

**Edición:** 2026-11-23 · Versión: 1.0.0

## Evidencia construida y ejecutada

- Código de 58 pruebas Python con `pytest`, sin dependencia de servidores públicos.
- Migración Alembic desde base vacía hasta `head` ejecutada localmente con SQLite.
- Código compilado con `python -m compileall` sin errores de sintaxis.
- Contrato OpenAPI generado estáticamente en `docs/openapi.json`.
- Mapa geoespacial WGS84: GeoJSON de paraderos, zonas, restricciones, vehículos (según rol), reportes corroborados y activos de respuesta.
- Lógica OSRM: cliente HTTP con respuesta GeoJSON y protección contra rutas cortadas. El servicio puede desplegarse sobre OSM de Perú.
- COC: solicitudes privadas o vía tótem, verificación de capacidad, asignación, aceptación, abordaje, finalización, espera segura y recuperación.
- Fallos deliberadamente bloqueados: cierre sobre ruta, CCTV no disponible, bahía desconocida, ruta candidata, falta de rampa/plaza, intento de despacho sin aprobación, rol incorrecto, reporte no confirmado.
- Adapters operativos: RTSP/USB Edge opcional con ONNX externo, consulta Open-Meteo con licencia, GTFS (stops), GeoJSON zonas y OSRM HTTP.
- Auditoría transaccional y outbox de eventos, WS institucional y JWT revocable.

## Integración añadida y comprobada

- Listado persistente de personal solo para admin, con respuesta sin credenciales.
- Readiness exige tablas y revisión Alembic actual; base vacía o revisión antigua devuelve 503.
- DEMO local explícita: 1 conductor, 1 paradero y 1 vehículo, sin duplicados ni confirmaciones de campo automáticas.
- El frontend pasa TypeScript, lint y build. La prueba Chromium usa otra API y SQLite temporales para probar el ciclo COC con cierre y recuperación.
- Se consultó OSRM público en desarrollo para una ruta de Huánuco. No equivale a preparar OSRM propio ni verificar transitabilidad en campo.
- Reportes, revisión y cierre dibujado desde la web comprobados en Chromium contra API temporal.
- Imágenes Docker construidas y Compose arrancado con PostgreSQL 16/PostGIS 3.4 y cuenta API sin superusuario. Web, worker de mapa, readiness y autenticación comprobados por el gateway.
- Pantallas institucionales, reconexión de eventos, riesgo/recursos y proxy/tótem probados; dos viajes completos sobre PostgreSQL y restauración comparada en otra base.
- Hay un workflow CI en la raíz. Su archivo se validó localmente; la ejecución en GitHub queda pendiente de publicar el repositorio.

## Qué NO se ha ejecutado ni se debe presentar como hecho

1. Pruebas completas de carga/concurrencia con PostgreSQL/PostGIS. Sí se validó el ciclo funcional ampliado con navegador y PostgreSQL, respaldo/restauración aislada y arranque Compose con permisos limitados.
2. Preparación real de la red OSRM con PBF de Perú; el script existe, pero exige descargar y procesar datos con recursos del usuario.
3. Peticiones en vivo a Open-Meteo, SENAMHI, MTC o municipios; requerirían red, permisos o conectores específicos. El adapter HTTP sí está implementado.
4. Inferencia Edge con una cámara y un modelo licenciado, validación física de rampas/plazas, precisión de detección, IA de discapacidad (deliberadamente prohibida).
5. Validación geológica de los índices, evaluación de riesgos profesionales, cumplimiento regulatorio certificado o predicción de ocurrencia de huaicos.
6. Prueba de estrés, plan de continuidad multi-región, pentest, autenticación multifactor, integración institucional real y escalabilidad de gran municipio.

## Prueba después de extraer el ZIP

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e '.[test]'
pytest -q
BOARDSAFE_DATABASE_URL=sqlite:///./check.sqlite alembic upgrade head
python scripts/export_openapi.py
```

Estas pruebas verifican el backend y su lógica bajo condiciones de laboratorio. El despliegue operacional completo debe pasar adicionalmente por validación concurrente de PostgreSQL, OSRM propio real, pruebas de CCTV autorizado, pruebas de accesibilidad con usuarios y aprobación institucional antes de uso de seguridad pública.

Resultados y límites de esta entrega: [docs/RESULTADOS_VALIDACION.md](../../docs/RESULTADOS_VALIDACION.md).
