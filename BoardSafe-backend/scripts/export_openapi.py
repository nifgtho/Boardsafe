import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from app.main import app
output=Path(__file__).resolve().parent.parent / "docs" / "openapi.json"
output.write_text(json.dumps(app.openapi(),ensure_ascii=False,indent=2),encoding="utf-8")
print(f"OpenAPI exportado en {output}")
