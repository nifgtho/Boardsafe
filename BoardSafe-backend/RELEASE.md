# BoardSafe Backend — Entrega v1.0.0

**Fecha:** 2026-11-20

## Cobertura de los retos

- **WFEO 1:** movilidad inclusiva, solicitud voluntaria y vía tótem, ciclo de continuidad, integración con flota accesible.
- **WFEO 3:** datos operativos, GPS manual/API, reportes, sensores Edge, CCTV local opcional, OSRM, mapa GeoJSON, auditoría, comunicación de eventos.
- **WFEO 4:** condiciones viales y restricciones institucionales, fuentes meteorológicas observadas/pronosticadas, índices cualitativos, respuesta por autoridad, continuidad ante interrupciones.

## Entregable

Backend FastAPI + modelos y migraciones PostgreSQL/PostGIS, Docker, worker, integración OSRM/Open-Meteo, importadores GTFS/GeoJSON, agent Edge opcional, contrato REST + WS, tests y documentación.

**Incluye software real de backend, no frontend ni sistema en vivo de emergencias.** El motor de rutas exige servicio OSRM instalado con cartografía OSM; los datos geológicos oficiales y flota real requieren fuente autorizada. Los modelos de visión ONNX y su calibración física no se suministran.

## Validación realizada

- 27 pruebas automatizadas: aprobaron todas.
- Cobertura de código del backend: 81% (instrumentación `pytest-cov`).
- Migraciones en base SQLite nueva: upgrade a head correcto.
- Generación del contrato OpenAPI: correcta.
- Código Python: compilación sin errores.

**Pendiente de validación de campo:** PostgreSQL real, rutas Perú OSRM preparadas y consulta en vivo, proveedor meteorológico en red, cámara y hardware Edge, DPIA/seguridad y pruebas con autoridades/usuarios.
