# Resultados y límites de validación

Actualización: 24 de noviembre de 2026 (America/Lima). La entrega se organizó
en commits de backend, frontend y despliegue/documentación en la rama `second`.
El push está pendiente; no se acredita ejecución remota de CI en GitHub.

| Comprobación | Resultado |
| --- | --- |
| Backend Python 3.12, `pytest -q` | 58 casos aprobados con SQLite temporal |
| Auxiliares de entrega, `python3 -m unittest discover -s scripts/tests -v` | 3 pruebas aprobadas |
| Ruff, `F401/F841` | Sin imports ni variables locales sin uso |
| ESLint | Aprobado |
| TypeScript, incluyendo `--noUnusedLocals --noUnusedParameters` | Aprobado |
| Next.js, `npm run build` | Aprobado; web, `/totem` y tres handlers privados |
| Chromium con API temporal SQLite | Funciones ampliadas comprobadas; hubo ajustes de sincronización/teardown durante la prueba |
| `python3 scripts/verify_postgres.py` | Termina con código 0; recorrido ampliado aprobado sobre PostgreSQL/PostGIS |
| Respaldo/restauración PostgreSQL | `pg_dump -Fc` + `pg_restore` a otra base; coinciden 14 tablas, revisión Alembic y PostGIS |
| Compose integrado final | Imágenes construidas; servicios healthy, migración actual, web/tótem/worker, rechazo 403/503 y solicitud/seguimiento con nodo privado comprobados |
| Git y documentación | Revisión de candidatos/índice sin secretos locales; enlaces y diff comprobados |
| Instalación local existente | Login admin, continuidad, riesgo, listado DEMO-TOTEM y `/totem` comprobados sin crear viajes |

## Recorrido ampliado sobre PostgreSQL

El auxiliar crea un contenedor PostGIS nuevo, publicado únicamente en loopback,
y una base `boardsafe_browser_test`. Inicia el frontend standalone y ejecuta:

- Alta/listado y privacidad del personal.
- Solicitud → planificación OSRM fixture → inspección → oferta → aceptación.
- Rechazo de abordaje sin bahía verificada; abordaje después de confirmación.
- Reporte → revisión → cierre dibujado → interrupción → alternativa → recuperación.
- Finalización y logout; pasajeros/conductores no abren el feed institucional.
- Reconexión WebSocket real a la API temporal y recuperación con cursor previo.
- Métricas/auditoría según rol; historial de cierre visible para autoridad.
- Zona con fuente/versión, evaluación heurística y fallo controlado 503 de clima
  cuando no hay proveedor habilitado. El índice no cierra vías automáticamente.
- Recurso: preparar → desplegar → desmovilizar; consulta de candidatos.
- Provisionamiento de tótem desde admin; secreto una vez y listado sin hashes.
- Proxy Next real: rechazo de otro origen y de campos adicionales, `no-store`.
- Solicitud sin cuenta → oferta/aceptación/abordaje → finalización desde `/totem`.
- Invalidación del código al completar; ningún `X-Node-Key` ni token en URLs,
  y ausencia de almacenamiento de seguimiento en localStorage.

El respaldo de ese entorno se restaura en `boardsafe_restore_test`. Se comparan
conteos de 14 tablas, dos viajes completados, tres decisiones de recursos,
revisión Alembic y presencia de PostGIS. El contenedor y su volumen temporal se
retiran al terminar. No se conectó a la base local del administrador.

Esto comprueba el flujo funcional y la restauración de datos de laboratorio.
No demuestra tiempos de recuperación ni una restauración de la infraestructura
real del piloto; hacen falta pruebas periódicas con sus propios respaldos.

## Separación de entornos y límites

La prueba usa cuentas, paraderos, geometrías OSRM y raster identificados como
fixtures. Chromium carga el worker real de MapLibre y fuentes GeoJSON. El proveedor
OSRM público se consultó anteriormente solo en desarrollo; no se descargó/procesó
el grafo Perú de producción ni se acreditaron rutas seguras en campo.

PostgreSQL de la prueba funcional utiliza un propietario de base aislada. La cuenta
limitada `boardsafe_app` se comprobó por separado en Compose, sin superusuario,
creación de bases o roles. No se presenta esto como una prueba de estrés concurrente.

Durante el desarrollo hubo fallos de sincronización de selectores y de procesos
de prueba, y una respuesta 500 en una ejecución intermedia. Se añadieron
esperas explícitas, diagnóstico y limpieza acotada; el recorrido PostgreSQL final
terminó correctamente. No recompiles el artefacto mientras una prueba lo sirve.

La suite backend aún informa una deprecación Starlette/httpx de TestClient. Se
eliminaron los avisos de geometría/Alembic sin silenciar warnings. La compilación
local requiere ejecución autorizada fuera del aislamiento de Next.js en este entorno.

Faltan TLS/dominio público y renovación, OSRM propio/autorizado, carga/concurrencia,
accesibilidad con usuarios, cámaras/modelos reales, procedimientos de campo,
monitorización y respaldos operativos periódicos. Las imágenes todavía requieren
una política de versiones/digests y las dependencias una revisión de vulnerabilidades.

El comprobador Git revisa nombres, claves privadas y valores locales conocidos,
incluido el contenido staged. No analiza exhaustivamente el historial remoto ni
sustituye una revisión de seguridad. Consulta [REVISION_CODIGO.md](REVISION_CODIGO.md).

## Bootstrap automático al migrar

`python -m app.cli migrate` aplica el esquema y provisiona el admin configurado.
Se añadieron pruebas de creación/login, repetición sin cambiar la contraseña,
rechazo de colisiones/desactivados y fallos de configuración/migración sin alta.
La copia local conservó su administrador y contraseña. Ver
[ADMIN_AUTOMATICO.md](ADMIN_AUTOMATICO.md).

También se probó el bootstrap en PostgreSQL/PostGIS vacío con el Compose integrado:
cuenta creada antes de iniciar API, login correcto, repetición sin duplicar ni
cambiar el hash y una sola auditoría. Se comprobó que la API no recibe las
credenciales de bootstrap. El healthcheck PostgreSQL espera al servidor TCP
final, evitando iniciar migraciones contra el servidor temporal de inicialización.
