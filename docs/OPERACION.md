# Operación e instalación

## Requisitos de una copia nueva

- Python 3.11 o superior; se comprobó con 3.12.
- Node.js compatible con Next.js 16; la CI usa Node 24.
- Acceso a los registros de paquetes para instalar dependencias.
- Docker con integración WSL para el perfil Compose, cuando se use.

Desde la raíz, prepara el backend en una instalación nueva:

```bash
cd BoardSafe-backend
python3.12 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements.lock
.venv/bin/python -m pip install -e '.[test]'
cp .env.local.example .env
```

Edita `.env` y sustituye los marcadores JWT e ingesta por secretos independientes.
Genera cada uno con una ejecución distinta de:

```bash
.venv/bin/python -c "import secrets; print(secrets.token_hex(32))"
```

Configura `BOARDSAFE_BOOTSTRAP_ADMIN_EMAIL` y
`BOARDSAFE_BOOTSTRAP_ADMIN_PASSWORD` en el `.env` privado. Aplica migraciones y
crea el primer administrador automáticamente:

```bash
.venv/bin/python -m app.cli migrate
bash scripts/run_local.sh
```

El correo debe ser tuyo; la contraseña no se imprime. Repetir la migración no
duplica la cuenta ni cambia su clave. Ver [bootstrap](ADMIN_AUTOMATICO.md).
En la copia ya preparada conserva sus archivos `.env` y sus credenciales.

En otra terminal prepara el frontend:

```bash
cd boardsafe-frontend
cp .env.example .env.local
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3000
```

La API local es `http://127.0.0.1:8000/api/v1`. CORS debe incluir exactamente el
origen que utiliza tu navegador, con esquema, host y puerto. `localhost` y
`127.0.0.1` son orígenes distintos.

## Datos DEMO y datos reales

`seed-demo` es una acción voluntaria para crear conductor, paradero y vehículo
etiquetados como prueba. Repetirla no duplica registros ni cambia contraseñas.
No se admite en producción, en el perfil de pruebas o en una base PostgreSQL.

La contraseña DEMO queda en `.demo-local.txt`, con permisos 600. Si la cuenta ya
existe y se perdió ese archivo, el comando no cambia su contraseña por sorpresa.
Los conflictos con una cuenta de otro rol o con un código no DEMO se rechazan.

Para un piloto se necesitan registros reales proporcionados o verificados por el
operador. Registra personal, paraderos y vehículos desde el administrador.
También existen importadores de GTFS y GeoJSON en `app.cli`; revisa formatos y
licencias en el README del backend. Los datos `examples/` no son datos oficiales.

Los estados desconocidos se conservan: crear un vehículo no confirma su rampa y
crear un paradero no verifica su bahía. Las confirmaciones operativas vencen según
la configuración; el valor inicial es 180 segundos para bahía y vehículo.

## Procesos

| Proceso | Función | Arranque desde el backend |
| --- | --- | --- |
| API | Peticiones y reglas COC | `bash scripts/run_local.sh` |
| Worker | Caducidad y limpieza | `.venv/bin/python -m app.workers --interval 60` |
| Frontend | Interfaz web | `npm run dev` desde el frontend |
| OSRM | Geometría y alternativas | Proveedor configurado o perfil Docker `routing` |

El script local de la API no inicia el worker. Ejecuta el worker en otra terminal
si necesitas el mantenimiento periódico. Debe haber una sola instancia del
planificador de mantenimiento hasta contar con coordinación distribuida.

## OSRM y mapas

Sin OSRM la API de planificación responde 503; no produce líneas rectas de respaldo.
En esta copia se comprobó el servicio público con datos de Huánuco y se habilitó
solo en `development`. Antes de un piloto configura un servicio autorizado/propio,
deja `BOARDSAFE_PUBLIC_OSRM_ALLOWED=false` y prepara la red de la zona.

Para Docker/OSRM Perú existe `BoardSafe-backend/scripts/prepare_osrm.sh`; implica
descargas grandes y procesamiento. Docker/PostGIS ya se comprobó con un entorno
aislado de esta entrega; el grafo Perú no se descargó/procesó.
El hostname `osrm` se resuelve entre contenedores, no en una API que corre en el host.

MapLibre dibuja GeoJSON con coordenadas `[longitud, latitud]`. Los campos de API
usan latitud/longitud separados. La cartografía base y una ruta del motor no
demuestran transitabilidad, accesibilidad ni llegada garantizadas.

## Diagnóstico

| Síntoma | Comprobación |
| --- | --- |
| La web no abre | Terminal frontend activa, puerto 3000 y URL en esta computadora |
| No conecta con el servidor | API activa, URL pública correcta y CORS del navegador |
| 401 después de cambiar roles o cerrar sesión | Volver a iniciar sesión; el JWT anterior deja de ser válido |
| 403 | Revisar rol y propiedad del recurso; el conductor opera solo su unidad |
| 409 al asignar/abordar | Leer los motivos: ruta, bahía, capacidad, caducidad o estado del viaje |
| 422 | Revisar campos obligatorios, coordenadas, formatos y longitudes mínimas |
| 503 al planificar | Proveedor OSRM, URL y conectividad; no implica ausencia de solicitudes |
| `/health/ready` responde 503 | Base accesible, tablas presentes y migraciones en `head` |
| Mapa sin fondo | Clave/proveedor raster, cuotas y conexión; no revelar claves en logs |

`/health/live` solo comprueba que el proceso responde. `/health/ready` comprueba
conexión, presencia de tablas y revisión Alembic. `routing_configured=true` indica
URL configurada; **no** constituye un sondeo en vivo del proveedor.

## Antes de publicar

El [Compose integrado](../compose.deploy.yaml) incluye web standalone, API,
worker, migraciones, PostgreSQL/PostGIS y gateway con límites de autenticación.
Sigue [ENTREGA_Y_DESPLIEGUE.md](ENTREGA_Y_DESPLIEGUE.md) para configurar secretos,
OSRM, dominio/TLS y entregar el código por Git.

El archivo local SQLite no es un perfil de producción ni se debe copiar como
base del piloto. El bundle de despliegue usa `/api/v1` en el mismo dominio.
Monitorización, restauraciones periódicas y validación del servidor real siguen
pendientes. La restauración de laboratorio ya se comprobó.

## Tótem de esta copia local

`DEMO-TOTEM` está vinculado a `DEMO-S01`; ID y clave se guardaron únicamente en
`boardsafe-frontend/.env.local` con permisos 600. La pantalla está en
http://127.0.0.1:3000/totem. Provisionar el nodo no creó viajes ni verificó la bahía.
Para una instalación nueva se utiliza el formulario de nodos y la
[guía de entrega](ENTREGA_Y_DESPLIEGUE.md); no se copia la clave de demostración.
