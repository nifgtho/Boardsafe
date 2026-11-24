# Entrega a quien realizará el despliegue

Empieza aquí después del [README principal](../README.md). Esta guía usa el
Compose integrado de la raíz. El Compose antiguo dentro del backend conserva
su utilidad de desarrollo, pero no incluye esta web ni este proxy.

La entrega incorpora autenticación, personal, operaciones, viajes COC, reportes,
revisión y dibujo de cierres, riesgo/recursos, eventos, métricas/auditoría y tótem.
El alcance y los requisitos pendientes de operación están en
[PLAN_ENTREGA.md](PLAN_ENTREGA.md). No migres la base DEMO
ni sus contraseñas al servidor.

## 1. Recibir el código por Git

Desde una copia autorizada del repositorio:

```bash
git clone https://github.com/nifgtho/Boardsafe.git
cd Boardsafe
```

Los cambios de esta entrega deben estar publicados en la rama acordada. Si el
repositorio es privado se necesita acceso. Git no entrega `.env`, bases locales,
credenciales ni datos OSRM: el servidor los prepara por separado.

Requisitos: Docker Engine/Desktop con Compose v2 o compatible, Python 3 para
los auxiliares de configuración y un dominio apuntando al servidor. Para
modificar/verificar código fuera de Docker se utilizó Python 3.12 y Node.js 24.
El procesamiento de Perú para OSRM necesita varios GB de RAM y disco; mide los
recursos del servidor y acuerda el proveedor antes de activar rutas.

## 2. Generar la configuración privada del servidor

Ejecuta desde la raíz, reemplazando el dominio por el real:

```bash
python3 scripts/deploy_config.py --init --origin https://TU_DOMINIO_REAL --admin-email CORREO_DEL_ADMIN
```

Crea `deploy/.env` con permisos 600, cuatro secretos de infraestructura y una
contraseña independiente para el administrador.
No sobrescribe un archivo existente. Configura allí:

| Variable | Responsabilidad |
| --- | --- |
| `DB_PASSWORD` | Cuenta propietaria para inicialización/migraciones |
| `DB_APP_PASSWORD` | Cuenta limitada `boardsafe_app` para API y worker |
| `BOARDSAFE_JWT_SECRET` | Firma JWT y derivados de claves/tickets |
| `BOARDSAFE_BOOTSTRAP_ADMIN_EMAIL` / `BOARDSAFE_BOOTSTRAP_ADMIN_PASSWORD` | Cuenta inicial automática; solo para el servicio migrate |
| `BOARDSAFE_INGEST_TOKEN` | Ingesta; independiente de JWT |
| `BOARDSAFE_CORS_ORIGINS` | Origen HTTPS exacto de la web |
| `BOARDSAFE_OSRM_BASE_URL` | `http://osrm:5000` propio o endpoint HTTPS autorizado |
| `BOARDSAFE_OSRM_IMAGE` | Misma imagen/version para preparar y servir el grafo |
| `BOARDSAFE_KIOSK_NODE_ID` / `BOARDSAFE_KIOSK_NODE_KEY` | Nodo tótem provisionado; privados, solo runtime |
| `NEXT_PUBLIC_MAPTILER_KEY` | Clave pública del mapa, restringida por dominio |
| `BOARDSAFE_HTTP_PORT` | Puerto local del gateway; por defecto 8080 |

Mantén `BOARDSAFE_BIND_ADDRESS=127.0.0.1`. El gateway se publica únicamente en
loopback y el Nginx del host termina TLS. El Compose impone
`BOARDSAFE_PUBLIC_OSRM_ALLOWED=false`; el servidor público usado en desarrollo
no forma parte de este despliegue. Meteorología viene desactivada.

```bash
python3 scripts/deploy_config.py
docker compose --env-file deploy/.env -f compose.deploy.yaml config --quiet
```

El auxiliar valida secretos, origen, puerto y proveedor. `config --quiet` evita
imprimir las credenciales expandidas. No adjuntes `docker inspect`, archivos de
entorno o volcados de base a incidencias públicas.

Las variables `NEXT_PUBLIC_*` se incorporan durante el build. Cambiar la clave
del mapa exige reconstruir el frontend. API y WebSocket usan rutas relativas al
mismo dominio; no hay que incorporar la IP del servidor en el JavaScript.

## 3. Preparar OSRM real

Elige una versión/digest de OSRM y utiliza exactamente la misma imagen al
procesar y al servir. Define `BOARDSAFE_OSRM_IMAGE` en `deploy/.env` y exporta su
mismo valor en la terminal antes del siguiente comando:

```bash
bash BoardSafe-backend/scripts/prepare_osrm.sh
```

Sin valor exportado, el script usa `latest`, igual que el ejemplo inicial de
Compose. Fija y registra una versión antes del piloto. El script descarga el PBF
real de Perú y ejecuta extract/partition/customize; no crea geometrías ficticias.
Guarda el origen y fecha del PBF. Si cambias la imagen, prepara un grafo compatible;
no reutilices automáticamente archivos antiguos solo porque existan.

Para OSRM propio, después de preparar el grafo:

```bash
docker compose --env-file deploy/.env -f compose.deploy.yaml --profile routing up -d --build
```

Si se utiliza un proveedor HTTPS autorizado, configura su endpoint y arranca
sin `--profile routing`. Comprueba un cálculo real desde despacho. El readiness
confirma base y migraciones; **no sondea OSRM**. Un indicador de OSRM configurado
no acredita que el proveedor esté disponible. Si falla, la API responde 503.

## 4. Arrancar aplicación y crear administrador

Sin OSRM local, o después de preparar un proveedor externo:

```bash
docker compose --env-file deploy/.env -f compose.deploy.yaml up -d --build
docker compose --env-file deploy/.env -f compose.deploy.yaml ps
curl --fail http://127.0.0.1:8080/health/ready
```

Se inicializa PostgreSQL/PostGIS, se aplican migraciones con la cuenta propietaria,
y luego arrancan API/worker con una cuenta sin privilegios de superusuario. Next
se ejecuta como usuario `node`. PostgreSQL, API y frontend no publican puertos.
Solo el gateway está disponible en `127.0.0.1:8080`; adapta el puerto si lo cambiaste.

El servicio `migrate` ejecuta `python -m app.cli migrate`: aplica el esquema y crea
el administrador con las variables privadas generadas. Consulta su correo/clave
en `deploy/.env` mediante un canal autorizado, sin publicarlos. Repetir el arranque
conserva la cuenta y su contraseña. No hace falta un alta manual adicional.

Crea personal real desde la web; registra paraderos, vehículos y verificaciones
con sus responsables. `seed-demo` está bloqueado en producción. Para recuperación
manual sigue [ADMIN_AUTOMATICO.md](ADMIN_AUTOMATICO.md).

Las cuentas PostgreSQL se crean únicamente al inicializar un volumen vacío.
Cambiar las contraseñas del `.env` **no cambia** las de un volumen existente:
coordina `ALTER ROLE`, servicios, respaldo y verificación para una rotación.
Nunca uses `down -v` sobre una instalación con información que deba conservarse.

## 5. HTTPS en el host

El responsable del servidor debe apuntar DNS, abrir 80/443 y obtener un
certificado válido (por ejemplo con Let's Encrypt). La plantilla
[deploy/nginx/tls.example.conf](../deploy/nginx/tls.example.conf) muestra el
Nginx del host: reemplaza el dominio y las rutas del certificado, ajusta el
puerto interno y valida `nginx -t` antes de recargar.

Instala primero el certificado usando el método ACME apropiado al servidor;
la plantilla no emite certificados. Mantén el gateway en loopback. El proxy del
host sobrescribe `X-Forwarded-For`; cambiar esta topología requiere revisar la
confianza de IP antes de exponerla. Los límites de login/registro del gateway
son por IP y deben ajustarse si muchos usuarios comparten una salida de red.

Comprobar después:

- La web abre en `https://DOMINIO` y HTTP redirige a HTTPS.
- `/health/ready` devuelve 200 y `schema: current`.
- Login, personal, mapa/worker, reportes y un viaje funcionan desde ese dominio.
- El backend WebSocket acepta `wss://DOMINIO/api/v1/ws/events`, JWT en primer
  mensaje, recuperación de eventos y cierre por logout/expiración.
- PostgreSQL y los puertos internos no son accesibles desde Internet.
- La renovación del certificado está programada y comprobada.

No se ha configurado un dominio ni emitido un certificado en esta entrega.

## 6. Respaldos, actualizaciones y diagnóstico

Define política de retención, acceso y copia externa antes de cargar datos reales.
Ejemplo de respaldo lógico; usa un nombre nuevo para cada copia:

```bash
mkdir -p backups
docker compose --env-file deploy/.env -f compose.deploy.yaml exec -T postgres pg_dump -U boardsafe_owner -d boardsafe -Fc > backups/boardsafe-inicial.dump
chmod 600 backups/boardsafe-inicial.dump
```

Respalda además configuración privada y archivos operativos necesarios por un
canal seguro. Se comprobó una restauración aislada de prueba con `scripts/verify_postgres.py`.
Verifica periódicamente `pg_restore` de tus respaldos en **otra base/instalación**,
permisos de aplicación y un recorrido real; un archivo creado no demuestra que
se pueda restaurar. La restauración del servidor real y la carga concurrente siguen pendientes.

Para actualizar: respaldo comprobado, revisión de cambios/migraciones, build de
la revisión acordada y `up -d --build`. Si se recrearon API/frontend, reinicia
el gateway (`docker compose --env-file deploy/.env -f compose.deploy.yaml restart gateway`)
para renovar sus destinos internos y comprueba readiness/web de nuevo.
Revertir una imagen no revierte una
migración: prepara el procedimiento según el cambio.

```bash
docker compose --env-file deploy/.env -f compose.deploy.yaml logs --tail=80 migrate api frontend gateway
```

Revisa los logs localmente y elimina datos personales/secretos antes de compartir.
Si readiness falla, comprueba PostgreSQL y migraciones. Si rutas da 503,
comprueba OSRM/grafo/proveedor; no sustituyas rutas por líneas rectas.

## 7. Publicar esta entrega en GitHub

La entrega está organizada en tres commits en la rama `second`. Para publicar
los commits ya preparados, revisa `git log origin/second..second --oneline` y
ejecuta `git push origin second`. Tu amigo debe usar esa rama al clonar
(`git clone --branch second https://github.com/nifgtho/Boardsafe.git`).

Para futuras entregas, desde la copia de desarrollo y después de revisar los cambios:

```bash
python3 scripts/check_git_handoff.py
git status --short
git add README.md CONTRIBUTING.md AUDITORIA_PROYECTO.txt .gitignore .github docs scripts deploy compose.deploy.yaml BoardSafe-backend boardsafe-frontend
python3 scripts/check_git_handoff.py
git diff --cached --stat
git commit -m "Prepara BoardSafe con flujo COC, resiliencia vial y entrega Docker"
git push origin HEAD
```

El comprobador lee candidatos e índice sin modificarlos, rechaza nombres de
archivos privados y compara secretos locales sin mostrarlos. No sustituye la
revisión del diff ni escanea de forma exhaustiva todo el historial remoto.
No añadas `-f` para forzar archivos ignorados. No compartas `.env`, `.admin-local.txt`,
`.demo-local.txt`, bases de prueba, node_secret ni tokens.

Comparte con tu amigo el enlace de la rama/commit y esta guía. Las credenciales
del servidor se generan allí; si necesita otro secreto se entrega por un canal
privado. Verifica los cuatro jobs de GitHub Actions después del push: backend,
frontend, journeys y containers. Esta documentación no acredita que la CI remota
haya corrido antes de subir los cambios.

## Tótem: configuración y operación

1. Registra un paradero real y crea un nodo de tipo `totem` desde administración.
2. Guarda el `node_secret` mostrado una sola vez por un canal privado.
3. Configura su ID y clave en `deploy/.env` (`BOARDSAFE_KIOSK_NODE_ID` y
   `BOARDSAFE_KIOSK_NODE_KEY`). Nunca uses el prefijo `NEXT_PUBLIC_`.
4. Valida con `python3 scripts/deploy_config.py` y aplica runtime:

```bash
docker compose --env-file deploy/.env -f compose.deploy.yaml up -d frontend
docker compose --env-file deploy/.env -f compose.deploy.yaml restart gateway
```

Abre `/totem`. Se muestra un código privado de seguimiento, nunca un token de nodo.
El código se oculta a los 30 segundos y se limpia al finalizar/vencer; la pantalla
se limpia tras 90 segundos sin interacción. Limpiar pantalla no cancela el viaje.
El pasajero puede retomar la consulta con su código privado. El conductor/despacho
operan ese viaje con las mismas reglas COC.

Este proxy configura **un nodo por instancia frontend**. Para varios tótems con
paraderos distintos se necesita provisionamiento y enrutamiento por dispositivo
independiente; no se permite seleccionar un nodo arbitrario desde el navegador.
Restringe el acceso de creación al entorno del dispositivo cuando corresponda y
conserva límites contra abuso. Una página pública y una comprobación de origen
no acreditan presencia física en un paradero.

## Qué queda antes de uso operativo

Dominio/certificado y renovación reales, OSRM propio/autorizado, datos y personal
reales, accesibilidad con usuarios, pruebas de carga/concurrencia, monitorización
y restauraciones periódicas del servidor. La prueba de laboratorio y el respaldo
temporal no sustituyen estos controles.

Las pantallas de riesgo/recursos, eventos, continuidad/auditoría y tótem están
integradas. Consulta [RESULTADOS_VALIDACION.md](RESULTADOS_VALIDACION.md) para
separar lo comprobado de lo que aún requiere validación.
