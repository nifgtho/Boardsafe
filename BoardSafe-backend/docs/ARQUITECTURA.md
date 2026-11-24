# BoardSafe — Diseño de ingeniería y límites operativos

## Contexto y alcance innegociable

BoardSafe es la unión funcional de tres desafíos WFEO: (1) movilidad inclusiva, (3) transporte inteligente mediante datos y sensores y (4) resiliencia vial ante amenazas naturales. La unidad operativa es el **Contrato Operativo de Continuidad (COC)**: una solicitud temporal de asistencia, su vehículo, una ruta verificada, condiciones de paradero y cambios de estado confirmados.

No es un clasificador médico ni un sistema que pronostique la hora de un huaico. No envía señales a actuadores de puertas, frenos, semáforos o maquinaria. No sustituye alertas oficiales ni certifica la seguridad de una carretera.

## Arquitectura de procesos

```text
Frontend web / app pasajero / consola conductor / autoridad / tótem
                         |
                   REST + JWT
                         |
                  BoardSafe API
              +---------+--------+
              |                  |
     Movilidad y COC         Resiliencia vial
     - vehículos             - reportes validados
     - paraderos             - cierres oficiales
     - asistencia            - zonificación
     - reglas de abordaje    - lluvia y pronósticos
              |                  |
              +--------+---------+
                       |
              PostgreSQL + PostGIS
         - registros - auditoría - eventos
                       |
             WS de eventos por rol

OSRM + OSM ----> /routes/plan  (candidatos, nunca verificación automática)
Edge/RTSP AI ---> /edge/nodes/{id}/signals (metadatos, no video)
Estación/GTFS -> importador de paraderos
Open-Meteo ---> endpoint habilitable de pronóstico
```

## Invariantes de seguridad

1. Usuario sin credencial oficial puede pedir ayuda por tótem autorizado.
2. Las solicitudes solo guardan apoyos operativos (rampa, audio, texto, asistencia de abordaje), **no diagnósticos**.
3. Sensor Edge nunca puede marcar bahía despejada con autoridad suficiente para abordar; exige verificación humana.
4. Reporte ciudadano, aun corroborado, no cierra automáticamente carreteras.
5. Cierre autorizado revoca rutas verificadas superpuestas y pasa solicitudes afectadas a espera segura; un viaje ya abordado queda `interrupted`.
6. OSRM devuelve candidatos; no verifica por sí solo estado, accesibilidad ni habilitación de vías.
7. Bloquear un tramo es competencia del rol `authority`; verificar un desvío requiere `inspector` o `authority`.
8. Índice `risk-v1` es prioridad heurística de inspección, **no probabilidad**; `outlook-v1` usa pronóstico de lluvia y también es solo apoyo a decisión.
9. Decisión de preparación de recursos requiere rol `authority`, motivo escrito y trazabilidad. Ningún vehículo de emergencia se despacha automáticamente.
10. Entidad marcada como `expired`, `unknown` o `candidate` no se promociona silenciosamente a segura.

## Flujos y estados

**Solicitud:** `requested -> offered -> accepted -> onboard -> completed`; variantes `waiting_safe`, `interrupted`, `cancelled`, `expired`, `unable_to_serve`.

**Rutas:** `candidate -> verified -> revoked`; un candidato geométricamente bloqueado se marca `blocked`. Los verificadores aportan motivo y vencimiento; no se certifica accesibilidad únicamente por tener GPS.

**Incidente:** reporte `pending -> verified/rejected`; independiente de restricción vial `closed/restricted/open` confirmada por autoridad.

**Edge:** `bay_obstruction` bloquea; `bay_no_obstruction` pasa a `unknown`, nunca directamente a `clear`. El conductor u operador verifica manualmente el estado despejado. Lecturas caducadas son desconocidas.

**Continuidad:** cierre de carretera > invalidación de rutas > solicitudes waiting_safe o interrupted > aviso de evento > inspección de alternativa > validación de nueva ruta > nueva asignación o recuperación del trayecto.

## Coherencia transaccional

Las mutaciones y los eventos de dominio se registran en **la misma transacción de base de datos**. Las rutas y cierres usan un `pg_advisory_xact_lock` global para serializar decisiones sensibles en PostgreSQL. No se usa una IA generativa como fuente de verdad. El outbox persiste para que consumidores WS puedan retomar desde `GET /events?since_id=`.

## Protección de datos

- Autenticación JWT Bearer, contraseñas Argon2id, RBAC y lectura privada de solicitudes.
- Códigos de tótem aleatorios, HMAC y con vencimiento; secreto mostrado una vez.
- Eventos Edge de clases operativas y confianza; no hay subida ni almacenamiento de fotografías o videos.
- El dispositivo físico que procesa RTSP debe disponer de base legal, análisis de impacto, controles propios y validación de sesgos. El backend no puede por sí mismo garantizar GDPR/EU AI Act.
- Los datos de reportes pueden contener texto personal si los usuarios lo introducen: requieren moderación, políticas y retención contractual.
- El worker destruye tokens expirados y metadatos Edge antiguos; ampliar política de eliminación/retención antes de piloto real.

## Límites conocidos de la versión entregada

- El backend está implementado y probado mediante SQLite; PostgreSQL/PostGIS en Docker **no se ejecutaron en este entorno**, por no disponer de Docker y acceso a descargar imágenes.
- La extracción OSM para OSRM y los permisos de operadores no se incluyen por tamaño y por depender del territorio elegido.
- No incluye modelo de visión calibrado, videovigilancia en producción, sensores físicos, datos privados de municipios ni credenciales de instituciones.
- No hay control directo del vehículo ni despacho de maquinaria, deliberadamente.
- El índice territorial requiere validación geológica, meteorológica y retrospectiva para uso operacional en emergencias.
- En escala municipal necesitará segmentación multientidad, observabilidad completa, caché espacial, rate limiting distribuido, backups probados, DPIA y pruebas externas.

Estas limitaciones no convierten el backend en una simulación: los endpoints persisten datos reales, consultan OSRM cuando está disponible y aplican transacciones y reglas reales. Indican qué evidencia y dependencia falta antes de operar en vías públicas.
