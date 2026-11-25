# Seguridad y prácticas aplicadas

Esta guía describe controles presentes y trabajo pendiente. No sustituye un
pentest ni una aprobación de operación en campo.

## Identidad y permisos

- Contraseñas almacenadas con Argon2; no se devuelven hashes en listados.
- Registro público limitado a pasajeros. Listado/alta de personal solo para admin.
- JWT en memoria, firma y claims comprobados, revocación mediante `jti`.
- Tolerancia de reloj JWT inicial de 5 segundos, configurable entre 0 y 30;
  caducidad y firma siguen activas. Sincroniza también el reloj del host.
- HTTP y WebSocket consultan usuario activo, rol y revocación. WebSocket cierra
  conexiones sin acceso y comprueba el vencimiento durante su ciclo de envío.
- Conductor: solicitudes, vehículos y rutas limitados a sus servicios asignados.
- Admin puede provisionar y coordinar; aceptar/abordar sigue exigiendo la
  identidad del conductor asignado al vehículo.

## Secretos

Mantén `.env`, credenciales locales y claves de nodos fuera del repositorio. Los
ejemplos contienen marcadores, no secretos reutilizables. Los archivos locales
de credenciales se crean con permisos 600 y contraseñas aleatorias.

`NEXT_PUBLIC_*` es público y queda incorporado al JavaScript del navegador. Una
clave pública del mapa debe restringirse por dominio en el proveedor. Un secreto
Edge, ingesta o tótem nunca lleva ese prefijo ni se introduce en logs o URLs.

Si un secreto se expone: limita su acceso, rótalo y revoca las sesiones afectadas.
La clave JWT también participa en hashes de nodos/tickets: su rotación requiere
planificar reprovisionamiento, no únicamente reiniciar sesiones de usuarios.
No hay un flujo completo de rotación de nodos implementado en esta entrega.

## Datos y demostraciones

No se solicitan diagnósticos médicos ni se publican posiciones personales de
pasajeros en el mapa. La información operativa se filtra por rol y los eventos
institucionales no se comparten con pasajeros/conductores.

La carga `seed-demo` requiere acción explícita, `development` y SQLite. Usa
identificadores DEMO y correo `.test`, no suplanta personas ni verifica estados
de campo. Repetirla conserva registros y contraseñas; las colisiones se rechazan.
No debe copiarse esta base de demostración a producción.

El agente Edge opcional transmite metadatos, no video. El uso de cámaras, modelos
y fuentes institucionales requiere autorización y condiciones de licencia.

## Prácticas de desarrollo

| Práctica | Aplicación |
| --- | --- |
| Contratos estrictos | Pydantic rechaza campos extra; TypeScript estricto |
| Validación de decisiones | Reglas COC del servidor y mensajes 409 claros |
| Persistencia | Migraciones explícitas; readiness comprueba revisión y tablas |
| Auditoría | Mutaciones registradas junto con eventos en la transacción |
| Fechas | Conversión a UTC y salida ISO con zona |
| Separación de responsabilidades | Features, hooks, cliente API e integraciones |
| Consultas del navegador | Cancelación de cargas de coordinación y polling sin solapamiento |
| Pruebas | API/dominio, permisos, regresiones y ciclo de navegador aislado |
| CI | Workflow en la raíz, permisos de lectura y directorios explícitos |
| Archivos generados | Worker MapLibre y resultados de navegador fuera de Git |

## Antes de exposición pública

Se entregan un gateway con límites por IP de login/registro, plantilla TLS del
host y un Compose probado con PostgreSQL/PostGIS. El TLS real del dominio,
restauraciones operativas del servidor, monitorización, MFA, recuperación de contraseña,
pruebas de carga y evaluación de accesibilidad con usuarios siguen pendientes.
Reportes tiene además un límite por identidad.

Las dependencias runtime Python están fijadas con hashes en
`BoardSafe-backend/requirements.lock`; el frontend usa `package-lock.json`.
Las imágenes base todavía usan etiquetas: fija versiones/digests revisados para
el despliegue. Las herramientas de build y los extras de pruebas no están todos
fijados por ese lock de producción. No se ha realizado un pentest ni un análisis
exhaustivo de vulnerabilidades o del historial Git.

El Compose usa `boardsafe_owner` solo para inicialización/migraciones y
`boardsafe_app` sin superusuario para API/worker. El gateway se publica en
loopback; cambiar la topología exige revisar confianza de proxies y límites.
Consulta la [guía de despliegue](ENTREGA_Y_DESPLIEGUE.md).

## Tótem y conexiones del navegador

El proxy permite solo POST de operaciones fijas, valida el origen y los campos,
limita el cuerpo y no acepta upstream/nodo/clave elegidos por el visitante. No
reenvía dumps, cookies ni headers del backend. Responde `no-store`, usa timeout y
rechaza redirecciones. En Compose recibe los secretos únicamente en runtime.
El gateway limita por IP la creación/consulta del tótem; fuera de ese gateway se
requiere protección equivalente. Origen no constituye autenticación de personas.

El código de seguimiento vive en memoria: se muestra inicialmente, se oculta a los
30 segundos, se borra al terminar/vencer y la pantalla se limpia tras 90 segundos
sin interacción. Limpiar la pantalla no cancela una solicitud activa. Se puede
consultar otra vez con el código privado. No se guarda en URL, logs ni localStorage.

Solo dispatcher/inspector/authority/admin abren el WebSocket institucional. El
JWT viaja en el primer frame; logout cierra sockets de forma síncrona. Las vistas
siguen respetando los permisos del servidor (auditoría solo autoridad/admin).

## Bootstrap de administración

El migrador puede crear el admin con variables privadas, sin contraseña conocida
por defecto. En el Compose integrado solo `migrate` recibe esas credenciales.
El alta es repetible sin restablecer claves, elevar roles ni reactivar cuentas;
la auditoría no contiene la contraseña. Sigue [ADMIN_AUTOMATICO.md](ADMIN_AUTOMATICO.md).
