# Desarrollo y validación de cambios

## Trabajar en el repositorio

Conserva cambios locales existentes. Mantén las funciones nuevas en módulos de
dominio y evita concentrarlas en `page.tsx`. Lee `boardsafe-frontend/AGENTS.md` y
la documentación de la versión instalada de Next.js antes de cambiar convenciones.

Las correcciones del backend deben respetar roles, propiedad de recursos,
transacciones y estados COC. Valida entradas con schemas; no agregues valores
inventados para convertir un rechazo del servidor en éxito visual.

## Comprobaciones según el cambio

| Cambio | Comprobación mínima |
| --- | --- |
| Tipos, componentes, formularios | ESLint, `tsc --noEmit`, build y recorrido afectado |
| Permisos, estados, fechas o sesión | Regresión API/dominio y suite backend |
| Schema relacional | Migración desde vacío y prueba con la base objetivo |
| Contrato API | Regenerar OpenAPI y revisar cliente/guía de integración |
| Flujo de viajes | `npm run test:journeys` con base temporal |
| Documentación | Revisar comandos, rutas y estado real de cada módulo |

No hacen falta pruebas que repitan detalles triviales de implementación. Los
casos deben cubrir decisiones, contratos y fallos relevantes. Usa fixtures de
proveedores en CI; no dependas de servidores públicos para aprobar pruebas.

## Contrato y documentación

Desde `BoardSafe-backend`, regenera el contrato:

```bash
.venv/bin/python scripts/export_openapi.py
```

Revisa el diff de `docs/openapi.json`, las propiedades opcionales por rol y las
longitudes de entrada. Actualiza el README o guía correspondiente al cambiar
arranque, configuración, permisos o módulos disponibles.

Las coordenadas GeoJSON son `[lon, lat]`; las fechas de API llevan zona UTC.
No guardes secretos en ejemplos, capturas, fixtures o descripciones de cambios.

## Revisión antes de entregar

- Explica el comportamiento final, el problema resuelto y cómo se comprobó.
- Declara las pruebas que no se ejecutaron y los límites del entorno.
- Separa datos DEMO de datos reales y funciones pendientes de funciones entregadas.
- Ejecuta `git diff --check` y `python3 scripts/check_git_handoff.py` desde la raíz.
- Revisa los archivos y el contenido staged; los secretos deben quedar ignorados.
- Evita modificaciones de dependencias, datos o formato ajenas al cambio.

La CI preparada ejecuta comprobaciones al subir cambios a GitHub. Una ejecución
local aprobada no sustituye la validación de PostgreSQL/PostGIS, infraestructura,
accesibilidad o procedimientos de campo.

## Dependencias y empaquetado

El backend Docker instala `requirements.lock` con hashes antes del paquete local
sin resolver dependencias otra vez. Para actualizar runtime usa Python 3.12 y
`uv pip compile BoardSafe-backend/pyproject.toml --python-version 3.12 --generate-hashes --output-file BoardSafe-backend/requirements.lock`.
Revisa el diff y reconstruye las imágenes; no cambies solo `pyproject.toml`.
El lock de producción no fija todos los extras de pruebas ni herramientas de build.
Usa `npm ci` para respetar el lock del frontend. El build standalone prepara sus
estáticos y worker automáticamente.

La prueba de navegador también admite el frontend Docker con
`BOARDSAFE_E2E_WEB_URL=http://127.0.0.1:8080 BOARDSAFE_E2E_API_BASE=/api/v1 npm run test:journeys`.
Siempre utiliza otra API y SQLite temporales; la validación de PostgreSQL se
realiza por separado. No confundas ese recorrido con una prueba de concurrencia.

No reconstruyas `.next/standalone` mientras una prueba lo esté sirviendo: detén
los procesos temporales, compila y vuelve a iniciar. El recorrido ampliado también
valida WebSocket real contra fixture, permisos, recursos y proxy privado del tótem.
`python3 scripts/verify_postgres.py` crea un PostGIS aislado en loopback, ejecuta
ese recorrido y compara una restauración en otra base; retira su propio contenedor.
