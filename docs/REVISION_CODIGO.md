# Revisión y limpieza de código

Se revisaron fuentes frontend/backend, referencias a recursos, imports, tipos,
archivos generados y flujos nuevos. Se conservaron datos locales y cambios previos.

## Limpieza aplicada

- Se retiraron 13 imports Python sin uso detectados por Ruff (`F401/F841`).
- Se sustituyó `JourneyError`, usado entre dominios, por `components/ApiError`.
- Se centralizaron estilos de botones/campos en `components/controls.ts`;
  los alias de asistencia reutilizan la misma definición.
- Se retiraron cinco SVG de plantilla Next/Vercel sin referencias en las fuentes.
- Se retiraron los cinco archivos `boardsafe_backend.egg-info` versionados:
  son metadatos que genera el empaquetador. Se añadieron al `.gitignore`.
- Se reemplazó el uso de `shapely.ops.transform` obsoleto por proyección explícita
  de coordenadas, conservando la comprobación geométrica y sus pruebas.
- Se actualizó el separador de rutas de Alembic para evitar su aviso de deprecación.
- Se añadieron helpers compartidos de formularios y acciones API para los módulos
  nuevos. El shell compone features; el proxy privado está en `lib/server/`.
- El cierre de pruebas ahora libera WebSockets y procesos temporales con timeout.
- El proxy conserva host y puerto para validar el origen del tótem también
  detrás de Nginx en puertos no estándar.

No se borraron importadores, ejemplos o tests por el solo hecho de que no los
importe la web: tienen usos operativos o de validación documentados. La revisión
no encontró una razón para sustituir todo el código ni eliminar dominios útiles.

## Comprobaciones reproducibles

```bash
cd BoardSafe-backend
.venv/bin/ruff check app --select F401,F841
.venv/bin/python -m pytest -q
```

```bash
cd boardsafe-frontend
npm run lint
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
npm run build
npm run test:journeys
```

Desde la raíz:

```bash
python3 scripts/check_git_handoff.py
git diff --check
python3 scripts/verify_postgres.py
```

La última prueba requiere Docker, backend `.venv`, build frontend y Chromium.
Crea su propio PostGIS y restaura el respaldo en otra base de prueba. Nunca usa
la base del administrador local.

## Límites y deuda restante

La ausencia de imports/variables sin uso no demuestra que no pueda haber defectos.
Permanecen componentes antiguos grandes de operaciones/pasajero, que admiten una
refactorización posterior con sus pruebas. No se reescribieron durante esta entrega
para evitar ampliar innecesariamente el cambio. Los extras de pruebas y las
imágenes base todavía requieren una política de actualización/fijación.

Sigue existiendo un aviso de deprecación de Starlette/httpx en TestClient; no se
silenció ni se sustituyó su dependencia sin validar compatibilidad. La revisión
no equivale a un pentest ni a un análisis exhaustivo del historial Git.
