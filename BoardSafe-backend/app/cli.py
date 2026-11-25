"""Operational CLI. Demo records require the explicit, local-only seed-demo command."""
import argparse
import csv
import getpass
import io
import json
import zipfile
from pathlib import Path
from sqlalchemy import select
from app.db import SessionLocal
from app.models import Stop,RiskZone

def bootstrap(email):
    from app.bootstrap import admin_credentials, ensure_admin
    password=getpass.getpass("Clave de administrador (mínimo 12 caracteres): ")
    try:
        account=admin_credentials(email,password)
        if account is None:raise ValueError("Se requiere correo y contraseña de administrador")
        result=ensure_admin(account)
    except ValueError as error:
        raise SystemExit(str(error)) from None
    print("Administrador creado." if result=="created" else "El administrador ya existe; su contraseña se conservó.")

def import_gtfs(filename, prefix):
    """Import real stops.txt. Source/license/corridor must be validated by deployer."""
    count=0
    with zipfile.ZipFile(filename) as archive:
        with archive.open("stops.txt") as raw:
            reader=csv.DictReader(io.TextIOWrapper(raw,encoding="utf-8-sig"))
            with SessionLocal() as db:
                for row in reader:
                    if row.get("location_type") not in (None,"","0"):continue
                    if not row.get("stop_lat") or not row.get("stop_lon"):continue
                    lat,lon=float(row["stop_lat"]),float(row["stop_lon"])
                    if not(-90<=lat<=90 and -180<=lon<=180):continue
                    code=f"{prefix}:{row['stop_id']}"[:80]
                    obj=db.scalar(select(Stop).where(Stop.code==code))
                    fields={"name":row.get("stop_name",code)[:200],"lat":lat,"lon":lon,"wheelchair_accessible":row.get("wheelchair_boarding")=="1"}
                    if obj:
                        for key,value in fields.items():setattr(obj,key,value)
                    else:db.add(Stop(code=code,**fields))
                    count+=1
                db.commit()
    print(f"Paraderos importados/actualizados: {count}. Verifique exactitud y licencia.")

def import_risk(filename,source,version):
    content=json.loads(Path(filename).read_text(encoding="utf-8"))
    if content.get("type")!="FeatureCollection":raise SystemExit("Se requiere GeoJSON FeatureCollection")
    count=0
    with SessionLocal() as db:
        for feature in content.get("features",[]):
            geo=feature.get("geometry") or {};prop=feature.get("properties") or {}
            if geo.get("type")!="Point":continue
            lon,lat=geo["coordinates"][:2]
            if not(-90<=lat<=90 and -180<=lon<=180):continue
            score=int(prop.get("susceptibility",0))
            if not 0<=score<=5:continue
            obj=RiskZone(name=str(prop.get("name",f"Zona {count+1}"))[:150],lat=lat,lon=lon,
               radius_m=int(prop.get("radius_m",1000)),susceptibility=score,
               critical_access=bool(prop.get("critical_access",False)),source=source,source_version=version)
            db.add(obj);count+=1
        db.commit()
    print(f"Zonas cargadas: {count}. Origen declarado: {source}, versión: {version}.")

if __name__=="__main__":
    parser=argparse.ArgumentParser(description="BoardSafe operaciones")
    sp=parser.add_subparsers(dest="cmd",required=True)
    sp.add_parser("migrate",help="Aplicar migraciones y crear admin configurado si no existe")
    b=sp.add_parser("bootstrap-admin");b.add_argument("--email",required=True)
    g=sp.add_parser("import-gtfs");g.add_argument("--file",required=True);g.add_argument("--prefix",required=True)
    r=sp.add_parser("import-risk-geojson");r.add_argument("--file",required=True);r.add_argument("--source",required=True);r.add_argument("--version",required=True)
    sp.add_parser("seed-demo",help="Crear 1 conductor, 1 paradero y 1 vehículo DEMO en desarrollo local")
    args=parser.parse_args()
    if args.cmd=="migrate":
        from app.bootstrap import migrate_and_bootstrap
        try:
            result=migrate_and_bootstrap()
        except ValueError as error:
            raise SystemExit(str(error)) from None
        print({"created":"Migraciones aplicadas; administrador creado.","existing":"Migraciones aplicadas; administrador existente conservado.","disabled":"Migraciones aplicadas; bootstrap admin no configurado."}[result])
    elif args.cmd=="bootstrap-admin":bootstrap(args.email)
    elif args.cmd=="import-gtfs":import_gtfs(args.file,args.prefix)
    elif args.cmd=="import-risk-geojson":import_risk(args.file,args.source,args.version)
    elif args.cmd=="seed-demo":
        from app.demo import seed_demo
        print(json.dumps(seed_demo(),ensure_ascii=False,indent=2))
