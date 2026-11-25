# Plan de entrega y responsabilidades

## Entregado

- Entorno local separado para frontend/backend y secretos fuera de Git.
- Login, personal persistente, paraderos y vehículos.
- Administrador automático tras migración, con credenciales privadas y sin restablecer cuentas existentes.
- Pasajero, despacho, rutas verificadas y acciones del conductor.
- Interrupción/recuperación según las reglas COC del backend.
- Reportes, revisión humana y cierres/reaperturas desde la web.
- Dibujo de tramos en mapa y entrada alternativa por teclado.
- Docker standalone, Compose integrado, PostgreSQL/PostGIS y gateway probado.
- Plantilla TLS para el host, configuración privada y comprobación previa de Git.
- MapLibre, worker local, capas de rutas y actualización periódica.
- Correcciones de sesión WebSocket, fechas y renovación de rutas.
- Restricción de rutas de conductor en servidor.
- Readiness que detecta migraciones pendientes.
- Carga DEMO explícita, repetible y sin verificaciones de campo automáticas.
- Documentación principal, ejemplos de entorno, pruebas y CI en la raíz.
- WebSocket institucional con reconexión, recuperación por cursor y cierre en logout.
- Continuidad y auditoría por roles del backend.
- Zonas, clima, evaluación heurística y decisiones humanas sobre recursos.
- Provisionamiento Edge y proxy/tótem sin cuenta, con claves privadas en runtime.
- Limpieza de imports, recursos de plantilla y metadatos generados.
- Flujo ampliado sobre PostgreSQL/PostGIS y restauración en otra base de prueba.

## Próximos bloques técnicos

| Bloque | Trabajo que puede completar el desarrollo | Aceptación |
| --- | --- | --- |
| Despliegue en servidor | Dominio/certificado, Nginx del host y OSRM autorizado | HTTPS/WSS y viaje real desde el dominio |
| Operabilidad | Respaldos/restauración periódica del servidor, alertas, fijar imágenes | Restauración de laboratorio comprobada; validar operación real |
| Calidad | Más pruebas de permisos/concurrencia, accesibilidad y carga | Evidencia reproducible, con límites de la validación documentados |

Estas tareas no están terminadas por aparecer en el plan. Deben implementarse y
comprobarse antes de presentarlas como entregadas.

## Información que debe aportar el responsable del piloto

- Ciudad/corredor y paraderos reales con coordenadas y accesibilidad verificada.
- Unidades reales, conductores responsables y capacidad instalada.
- Personal autorizado para despacho, inspección y decisiones de autoridad.
- Fuentes/licencias de cartografía, meteorología, riesgo y cámaras.
- Procedimientos de inspección, asistencia, comunicación y recuperación en campo.
- Dominio, servidor, responsables de acceso y requisitos de conservación de datos.

El desarrollo puede preparar formularios, importadores, validaciones, despliegue
y documentación. Los registros DEMO, una API disponible o una simulación de
navegador no pueden establecer hechos de campo ni sustituir autorizaciones.

## Condiciones para un piloto

Se necesita completar los módulos acordados para el piloto, comprobar un viaje
con operadores y usuarios, probar cierres y conectividad, validar accesibilidad,
revisar privacidad y asegurar soporte humano. Producción requiere además un
despliegue operativo aprobado y controles de seguridad verificados.

La guía concreta para la entrega está en [ENTREGA_Y_DESPLIEGUE.md](ENTREGA_Y_DESPLIEGUE.md).
