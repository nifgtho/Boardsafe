"""Inspect Git candidates without staging, committing or printing local secrets."""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def local_secrets(root: Path) -> set[bytes]:
    values = set()
    files = [root / "BoardSafe-backend/.env", root / "boardsafe-frontend/.env.local",
             root / "deploy/.env", root / "BoardSafe-backend/.admin-local.txt", root / "BoardSafe-backend/.demo-local.txt"]
    for path in files:
        if not path.is_file():
            continue
        for line in path.read_text().splitlines():
            if line.startswith("Contraseña: "):
                value = line.removeprefix("Contraseña: ").strip()
            else:
                key, separator, value = line.partition("=")
                if not separator or not any(word in key.upper() for word in ("PASSWORD", "JWT_SECRET", "INGEST_TOKEN", "KIOSK_NODE_KEY")):
                    continue
                value = value.strip().strip("\"'")
            if len(value) >= 16 and not any(marker in value.upper() for marker in ("REPLACE", "CHANGE", "DEV-ONLY", "YOUR_", "PEGA_")):
                values.add(value.encode())
    return values


def check(root: Path) -> tuple[int, list[str]]:
    result = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root, capture_output=True, check=True)
    secrets = local_secrets(root)
    problems = []
    files = set(result.stdout.decode().split("\0")) - {""}
    private_key = re.compile(rb"(?m)^\s*-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")
    for name in sorted(files):
        path = root / name
        private_name = ((path.name == ".env" or path.name.startswith(".env.")) and not path.name.endswith(".example")) or path.name in (".admin-local.txt", ".demo-local.txt") or path.suffix in (".pem", ".key", ".db", ".sqlite")
        if private_name:
            problems.append(f"Archivo privado entre los candidatos: {name}")
            continue
        contents = [path.read_bytes()] if path.is_file() else []
        # The staged version may still contain a secret removed from the working tree.
        staged = subprocess.run(["git", "show", f":{name}"], cwd=root, capture_output=True)
        if staged.returncode == 0:
            contents.append(staged.stdout)
        if any(private_key.search(content) or any(secret in content for secret in secrets) for content in contents):
            problems.append(f"Contenido privado local detectado en: {name}")
    return len(files), problems


if __name__ == "__main__":
    count, problems = check(ROOT)
    if problems:
        raise SystemExit("\n".join(problems))
    print(f"Git: {count} candidatos revisados; sin archivos privados ni valores de secretos locales detectados. No se modificó el índice.")
