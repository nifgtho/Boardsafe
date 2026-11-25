import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


class HandoffChecks(unittest.TestCase):
    def test_deploy_secrets_and_origins(self):
        config = module("deploy_config")
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            config.initialize(path, "https://boardsafe.test")
            values = config.read_values(path)
            self.assertEqual(config.validate(values), [])
            self.assertEqual(values["BOARDSAFE_BOOTSTRAP_ADMIN_EMAIL"], "admin@gmail.com")
            self.assertGreaterEqual(len(values["BOARDSAFE_BOOTSTRAP_ADMIN_PASSWORD"]), 24)
            self.assertNotIn(values["BOARDSAFE_BOOTSTRAP_ADMIN_PASSWORD"], {values[key] for key in config.SECRET_KEYS})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                config.initialize(path, "https://boardsafe.test")
            values["DB_APP_PASSWORD"] = values["DB_PASSWORD"]
            self.assertTrue(config.validate(values))

    def test_public_osrm_and_http_are_rejected_for_release(self):
        config = module("deploy_config")
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            config.initialize(path, "http://127.0.0.1:18080", allow_local_http=True)
            values = config.read_values(path)
            self.assertTrue(config.validate(values))
            self.assertEqual(config.validate(values, True), [])
            values["BOARDSAFE_OSRM_BASE_URL"] = "https://router.project-osrm.org"
            self.assertTrue(config.validate(values, True))

    def test_git_check_detects_leaks_without_displaying_values(self):
        guard = module("check_git_handoff")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run(["git", "init", "-q", folder], check=True)
            (root / "BoardSafe-backend").mkdir()
            secret = "independent-local-fixture-credential"
            (root / "BoardSafe-backend/.env").write_text(f"BOARDSAFE_JWT_SECRET={secret}\n")
            (root / ".gitignore").write_text(".env\n")
            (root / "config.py").write_text(f"token = '{secret}'\n")
            count, problems = guard.check(root)
            self.assertGreater(count, 0)
            self.assertEqual(len(problems), 1)
            self.assertNotIn(secret, problems[0])
            subprocess.run(["git", "add", "config.py"], cwd=root, check=True)
            (root / "config.py").write_text("token = None\n")
            self.assertEqual(len(guard.check(root)[1]), 1)
            subprocess.run(["git", "add", "config.py"], cwd=root, check=True)
            self.assertEqual(guard.check(root)[1], [])


if __name__ == "__main__":
    unittest.main()
