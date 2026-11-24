# BoardSafe — frontend

Aplicación Next.js con autenticación por roles, mapa, personal, paraderos,
vehículos y el ciclo de asistencia: planificación de rutas, verificación humana,
asignación, aceptación, abordaje, recuperación y finalización. Incluye reportes/revisión/cierres, riesgo/clima/recursos, eventos institucionales,
métricas y auditoría por rol, provisionamiento Edge y tótem público con proxy privado.

## Arranque local

El checkout está preparado con Python 3.12 en `BoardSafe-backend/.venv`.
Para instalarlo en otra máquina se requiere Python 3.11+, crear ese entorno e
instalar el backend con `pip install -e '.[test]'`. El frontend requiere Node.js
20.9+ y `npm ci`.

En una terminal, desde `BoardSafe-backend`:

```bash
bash scripts/run_local.sh
```

En otra terminal, desde `boardsafe-frontend`:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Abre http://127.0.0.1:3000 y crea tu cuenta desde Registro pasajero.
No se cargan personas, vehículos ni paraderos de demostración automáticamente.
El script crea el administrador al migrar si configuraste
`BOARDSAFE_BOOTSTRAP_ADMIN_EMAIL` y `BOARDSAFE_BOOTSTRAP_ADMIN_PASSWORD` en el
`.env` privado del backend. El comando explícito es:

```bash
.venv/bin/python -m app.cli migrate
```

Repetirlo conserva su contraseña. Ver [administrador automático](../docs/ADMIN_AUTOMATICO.md).

## Archivos de entorno

`BoardSafe-backend/.env` configura la base, JWT, ingesta, CORS y OSRM.
`boardsafe-frontend/.env.local` configura la URL pública de API y el mapa.
Next.js no lee el archivo del directorio hermano. Reinicia el frontend tras
cambiar variables y vuelve a compilar si cambian las variables públicas.

El cliente WebSocket usa su URL pública y envía JWT como primer frame. Solo
conecta para roles institucionales y recupera eventos perdidos por cursor.
El proxy de tótem lee las variables privadas en runtime.
Las credenciales de tótem son privadas del servidor y nunca deben llevar
el prefijo NEXT_PUBLIC_. Los archivos de entorno están ignorados por Git.

SQLite y loopback sirven para desarrollo local. Las rutas necesitan un OSRM
accesible configurado en el backend; su ausencia produce 503. PostgreSQL/PostGIS
están probados en el Compose integrado; el dominio y HTTPS real deben configurarse
según [la guía de despliegue](../docs/ENTREGA_Y_DESPLIEGUE.md).

En este checkout se habilitó `https://router.project-osrm.org` exclusivamente para
desarrollo y se comprobó una ruta real en Huánuco. Antes del piloto configura
un servicio autorizado o propio y desactiva BOARDSAFE_PUBLIC_OSRM_ALLOWED.
OSRM devuelve candidatos: un inspector/autoridad debe verificarlos. El cálculo
no garantiza una alternativa libre de cierres ni un horario de llegada.

## Cómo atender un viaje

1. Admin registra personal y las unidades con conductor; admin/operador registra
   los paraderos reales. Cada conductor confirma plazas, rampa y ubicación.
2. El pasajero crea su solicitud desde un paradero registrado.
3. Despacho abre Solicitudes y pulsa Calcular alternativas viales.
4. Inspector/autoridad abre Rutas, revisa la geometría con Ver en mapa y registra
   evidencia de inspección y vigencia. Una ruta vencida admite nueva inspección.
5. Despacho selecciona unidad y ruta verificada en la solicitud y la asigna.
6. El conductor acepta, confirma abordaje y finaliza. Antes del abordaje se exige
   bahía despejada vigente, ruta habilitada y estado de vehículo confirmado.
7. Si una autoridad cierra una vía desde Reportes y vías, se revocan rutas afectadas y el viaje
   puede quedar interrumpido. Despacho calcula otra ruta desde la ubicación de la
   unidad; tras inspección, Recuperar viaje conserva la misma unidad.

Las vistas se actualizan cada 10 segundos mientras están visibles, y tienen
actualización manual. El WebSocket institucional también refresca mapa y listas.
Los errores 409 muestran los motivos del servidor; nunca se omiten esas reglas.

## Prueba de navegador

Con la web local iniciada, instala Chromium de Playwright y ejecuta:

```bash
npx playwright install chromium --only-shell
npm run build
npm run test:journeys
```

La prueba arranca otra API en un puerto libre con SQLite temporal y migraciones
reales. Cuentas, paradero, vehículo, cierre y geometrías OSRM son fixtures
identificadas de prueba. Las peticiones del navegador se redirigen a esa API;
no se importan registros de prueba en la base operativa ni se usa OSRM público.
Se comprueba el ciclo con bloqueo 409 de abordaje, cierre, interrupción y
recuperación. El mapa recibe un raster controlado y usa su worker/GeoJSON real.
La captura queda en test-results/journey-dispatch.png (ignorada por Git).

## Verificación

```bash
npx tsc --noEmit
npm run lint
npm run build
```

El desarrollo usa Turbopack; el build usa la alternativa Webpack de Next.js para
evitar el fallo de permisos del evaluador CSS de Turbopack en este entorno.
Ambos procesan Tailwind con su plugin PostCSS. TypeScript estricto sigue activo.

postinstall, predev y prebuild preparan el worker ESM de MapLibre en
public/maplibre-gl-worker.mjs. Es un archivo generado, ignorado por Git y ESLint.

La salida es standalone. `postbuild` copia `public` y `.next/static` al artefacto.
`npm start` carga las variables del checkout y ejecuta ese servidor. El Dockerfile
usa tres etapas y ejecuta el artefacto como usuario `node`. Las variables públicas
se pasan en build; las privadas del tótem se pasan solo en runtime. No hay
dominio público configurado.

## Módulos nuevos

- `features/risk/`: zonas con fuente/versión, prioridad observada, perspectiva
  de pronóstico, recursos candidatos y decisiones firmadas por autoridad.
- `features/monitoring/`: métricas reales; auditoría detallada solo autoridad/admin.
- `hooks/useBoardSafeEvents.ts`: reconexión, replay paginado y deduplicación de IDs.
- `features/edge/`: nodos con secreto una sola vez; listado sin hashes.
- `/totem` y `/api/kiosk/*`: asistencia sin cuenta, consentimiento, seguimiento y
  cierre. Node key solo en servidor; código temporal solo en memoria.

Las recomendaciones rectas no son rutas ni tiempos de respuesta; risk-v1 no
predice una probabilidad de deslizamiento. Meteorología no configurada devuelve
503 con indicación humana. Un recurso desplegado requiere ejecución de campo.

Para PostgreSQL y restauración aislada, desde la raíz ejecuta
`python3 scripts/verify_postgres.py`, con Docker y Chromium disponibles.
