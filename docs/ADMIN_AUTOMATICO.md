# Administrador automático al migrar

El comando de migración del proyecto aplica Alembic y, solo después de terminar
correctamente, crea el administrador configurado si todavía no existe:

```bash
cd BoardSafe-backend
.venv/bin/python -m app.cli migrate
```

`run_local.sh` y los servicios `migrate` de ambos Compose usan este comando.
No es necesario ejecutar después `bootstrap-admin` en una instalación configurada.

## Credenciales privadas

En `BoardSafe-backend/.env` para desarrollo, o `deploy/.env` para el Compose
integrado, configura las dos variables:

```dotenv
BOARDSAFE_BOOTSTRAP_ADMIN_EMAIL=admin@gmail.com
BOARDSAFE_BOOTSTRAP_ADMIN_PASSWORD=
```

La contraseña está vacía en el ejemplo: complétala con una clave privada aleatoria. Debe tener
12–256 caracteres; se almacena con Argon2 y nunca se imprime durante la migración.
No subas el `.env` a Git. En esta copia local se conserva la contraseña existente,
que está en el archivo privado `.admin-local.txt`.

Para un servidor nuevo, desde la raíz:

```bash
python3 scripts/deploy_config.py --init --origin https://TU_DOMINIO_REAL --admin-email CORREO_DEL_ADMIN
```

El generador crea también una contraseña aleatoria independiente para el admin
en `deploy/.env`, con permisos 600. Si omites `--admin-email`, utiliza
`admin@gmail.com`. Consulta ese archivo únicamente en el servidor autorizado;
las credenciales nunca forman parte del README ni del código fuente.

Al arrancar el Compose integrado, `migrate` recibe estas variables y crea la cuenta.
API, worker y frontend no reciben la contraseña de bootstrap en ese perfil.

## Repetición y errores

- Repetir la migración no duplica el usuario ni cambia su contraseña.
- Cambiar la clave del `.env` no restablece una cuenta existente.
- Un correo ocupado por otro rol o un administrador desactivado provoca un error;
  no se eleva el rol ni se reactiva la cuenta.
- Una configuración parcial o inválida se rechaza antes de aplicar migraciones.
- Si la migración del esquema falla, no se ejecuta el alta del administrador.
- Si ambas variables están vacías, solo se migra el esquema; no hay credenciales
  predeterminadas ni se crea una cuenta con contraseña conocida.
- La primera creación queda auditada sin incluir la contraseña.

Puedes vaciar ambas variables después de provisionar el admin si tu política de
secretos lo requiere. En futuras bases vacías tendrás que configurarlas de nuevo.
No se incluyen en revisiones Alembic históricas: `alembic upgrade head` sigue
siendo el comando de esquema únicamente. Usa `python -m app.cli migrate` para el
flujo completo. `alembic current`, `stamp` y `downgrade` no crean usuarios.

El CLI interactivo `bootstrap-admin --email ...` se conserva como alternativa
manual; tampoco cambia contraseñas de cuentas existentes.
