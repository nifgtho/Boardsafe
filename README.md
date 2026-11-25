# BoardSafe

Aplicación de coordinación de viajes accesibles y continuidad vial. Conecta
solicitudes de pasajeros, paraderos, vehículos, rutas inspeccionadas y decisiones
de personal autorizado mediante el **Contrato Operativo de Continuidad (COC)**.

**Estado:** frontend/backend integrados, flujo COC y resiliencia vial con pruebas
de navegador. El empaquetado Docker incluye PostgreSQL/PostGIS y proxy; el dominio,
TLS y los requisitos del piloto deben configurarse y validarse en el servidor.

**Para quien desplegará:** comienza por [Entrega y despliegue](docs/ENTREGA_Y_DESPLIEGUE.md).
El plan enlazado distingue los módulos integrados de los requisitos del piloto.

## Abrir el proyecto

Con los servicios iniciados en esta computadora:

| Acceso | Dirección |
| --- | --- |
| Aplicación web | http://127.0.0.1:3000 |
| Tótem sin cuenta | http://127.0.0.1:3000/totem (requiere nodo configurado) |
| API y documentación interactiva | http://127.0.0.1:8000/docs |
| Estado de base y migraciones | http://127.0.0.1:8000/health/ready |

Estas direcciones son locales. El registro público crea cuentas de pasajero.
El administrador crea cuentas de personal desde la web.

Las credenciales iniciales de **esta instalación** están en archivos privados:

- `BoardSafe-backend/.admin-local.txt`: administrador solicitado durante la preparación.
- `BoardSafe-backend/.demo-local.txt`: conductor de demostración, cuando se ejecuta la carga DEMO.

Estos archivos tienen permisos restringidos y están ignorados por Git. Las
contraseñas no forman parte de la documentación ni de los datos de ejemplo.

## Iniciar los servicios

El backend de esta copia ya tiene un entorno `.venv` con Python 3.12 y una base
SQLite migrada. Desde la raíz del repositorio, en una terminal:

```bash
bash BoardSafe-backend/scripts/run_local.sh
```

En otra terminal:

```bash
npm --prefix boardsafe-frontend run dev -- --hostname 127.0.0.1 --port 3000
```

Mantén ambas terminales abiertas. El script del backend aplica migraciones, crea el admin configurado si falta
y lee su `.env`; el frontend lee su propio `.env.local`.
Para una copia nueva sigue la [guía de instalación](docs/OPERACION.md).

## Demostración solicitada

La carga local crea **uno de cada tipo**, sin duplicarlos al repetir el comando:

| Tipo | Identificación | Estado inicial |
| --- | --- | --- |
| Personal | `conductor.demo@boardsafe.test`, rol `driver` | Contraseña aleatoria privada |
| Paradero | `DEMO-S01`, nombre con `[DEMO]` | Bahía sin verificar |
| Vehículo | `DEMO-V01`, operador con `[DEMO]` | Conductor vinculado; plazas y rampa sin confirmar |

```bash
cd BoardSafe-backend
.venv/bin/python -m app.cli seed-demo
```

Solo se admite en `development` y SQLite. No se ejecuta al iniciar la aplicación,
no cambia contraseñas existentes y rechaza colisiones con otros registros.
La ubicación del paradero es una coordenada de prueba en el centro del mapa de
Huánuco: **no acredita la existencia de un paradero autorizado ni su accesibilidad**.

En esta copia también se provisionó `DEMO-TOTEM`, vinculado al paradero DEMO,
y se guardó su configuración privada en el `.env.local` del frontend. `seed-demo`
no crea ese nodo automáticamente. `/totem` permite revisar la pantalla sin cuenta.

Entra como administrador para ver el personal, los paraderos y vehículos. Para
probar la vista de conductor usa su cuenta DEMO en otra ventana/sesión. Las
confirmaciones operativas requieren acciones explícitas; el comando no verifica
bahías, rampas o rutas ni crea viajes automáticamente.

## Recorrido de un viaje

1. Admin/operador registra el paradero y el vehículo con su conductor.
2. El conductor confirma la capacidad, rampa y ubicación actuales del vehículo.
3. Un pasajero solicita apoyos y un destino con consentimiento operativo.
4. Despacho calcula alternativas OSRM. Se guardan como rutas candidatas.
5. Inspector/autoridad revisa la ruta y firma una verificación con vigencia.
6. Despacho asigna una unidad y una ruta verificada al pasajero.
7. El conductor acepta. Tras comprobar bahía, ruta y vehículo, confirma abordaje.
8. Pasajero/conductor finaliza el viaje.
9. Un cierre autorizado revoca las rutas afectadas. El viaje puede pasar a espera
   segura o interrupción; su recuperación requiere una alternativa verificada.

El feed institucional actualiza mapa y paneles con recuperación de eventos al
reconectar. Continúa la actualización periódica y el refresco manual. Las reglas de seguridad se aplican en el servidor; la interfaz
muestra los motivos de rechazo. Reportes y vías permite reportar, revisar y dibujar cierres desde la web.

## Funciones disponibles y pendientes

| Área | Backend | Frontend |
| --- | --- | --- |
| Registro, login y logout revocable | Implementado | Implementado; JWT en memoria |
| Alta y listado de personal | Admin, sin hashes/contraseñas en respuesta | Listado persistente, creación y copia de ID |
| Paraderos, bahía y vehículos | Implementado | Implementado |
| Solicitudes y ciclo COC | Implementado | Pasajero, despacho y conductor |
| OSRM y verificación de rutas | Implementado | Cálculo, inspección y dibujo en mapa |
| Interrupción y recuperación | Implementado | Recuperación con la misma unidad |
| Reportes y restricciones viales | Implementado | Reporte, revisión, dibujo y cambio de estado por rol |
| Riesgo, clima y recursos | Implementado; proveedores opcionales | Zonas, índices, pronóstico, candidatos y firma de decisiones |
| Eventos WebSocket, métricas y auditoría | Implementado | Reconexión/replay institucional, métricas y auditoría por rol |
| Tótem y Edge | API/agente opcional | Provisionamiento, proxy privado y pantalla pública `/totem` |
| Despliegue integrado | PostgreSQL/PostGIS, migraciones, API y worker | Docker standalone y gateway; plantilla TLS del host |
| OSRM propio | Perfil routing preparado | Requiere procesar grafo real y verificar disponibilidad |

Consulta el [plan de entrega y responsabilidades](docs/PLAN_ENTREGA.md).

## Configuración y secretos

| Archivo | Uso |
| --- | --- |
| `BoardSafe-backend/.env` | Base, JWT, ingesta, CORS y rutas |
| `BoardSafe-backend/.env.local.example` | Plantilla de desarrollo con SQLite |
| `BoardSafe-backend/.env.example` | Plantilla del backend para Compose/PostgreSQL |
| `boardsafe-frontend/.env.local` | API pública, mapa y variables privadas del gateway |
| `boardsafe-frontend/.env.example` | Plantilla sin credenciales |
| `deploy/.env` | Secretos del servidor; generar allí, nunca subir a Git |

El proveedor OSRM público está habilitado en esta instalación solo para desarrollo.
Una ruta calculada no equivale a una ruta inspeccionada. El piloto necesita
proveedor autorizado/propio. El mapa usa MapTiler si hay clave; su respaldo es Esri.

`NEXT_PUBLIC_*` se incorpora al navegador: nunca contiene contraseñas, JWT de
usuarios o claves de nodos. Las credenciales del gateway del tótem deben
permanecer en el servidor. Más detalles en [seguridad](docs/SEGURIDAD.md).

## Comprobaciones

Backend, desde su directorio y con el entorno preparado:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/export_openapi.py
```

Frontend:

```bash
npm --prefix boardsafe-frontend run lint
cd boardsafe-frontend
npx tsc --noEmit
npm run build
```

Prueba integral de navegador, con la web local iniciada:

```bash
cd boardsafe-frontend
npx playwright install chromium --only-shell
npm run build
npm run test:journeys
```

La prueba crea otra API y SQLite temporales y redirige allí las peticiones de su
navegador. Sus rutas y raster son fixtures controlados; no carga esos registros en
la base local. Comprueba también rechazos de abordaje, cierre, recuperación y logout.
El build usa Webpack y el desarrollo Turbopack, con Tailwind mediante PostCSS.

El workflow de [CI](.github/workflows/ci.yml) está en la raíz, con directorios de
trabajo explícitos y permisos de lectura. Comprueba backend, frontend, imágenes
Docker y el recorrido de navegador con datos temporales. Su ejecución remota depende de que el
repositorio se suba a GitHub; el archivo preparado no acredita una ejecución allí.

## Documentación

- [Entrega a tu amigo, Git y despliegue](docs/ENTREGA_Y_DESPLIEGUE.md).
- [Resultados y límites de la validación](docs/RESULTADOS_VALIDACION.md).
- [Revisión y limpieza de código](docs/REVISION_CODIGO.md).
- [Administrador automático al migrar](docs/ADMIN_AUTOMATICO.md).
- [Operación, instalación y diagnóstico](docs/OPERACION.md).
- [Arquitectura y decisiones técnicas](docs/ARQUITECTURA.md).
- [Seguridad y prácticas de desarrollo](docs/SEGURIDAD.md).
- [Plan de entrega y responsabilidades](docs/PLAN_ENTREGA.md).
- [Cómo contribuir y validar cambios](CONTRIBUTING.md).
- [Contrato del backend con el frontend](BoardSafe-backend/docs/FRONTEND_INTEGRATION.md).
- [OpenAPI exportado](BoardSafe-backend/docs/openapi.json).
- [Detalle del frontend](boardsafe-frontend/README.md) y [backend](BoardSafe-backend/README.md).
- [Auditoría histórica y correcciones](AUDITORIA_PROYECTO.txt).

Esta entrega sirve para desarrollo y pruebas. La operación en campo necesita
datos reales autorizados, evaluación de accesibilidad y validación institucional.
