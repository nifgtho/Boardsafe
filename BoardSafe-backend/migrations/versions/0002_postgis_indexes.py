"""PostGIS point indexes. SQLite test profile deliberately omits PostgreSQL-specific DDL."""
revision="0002_postgis_indexes"
down_revision="0001_initial_schema"
branch_labels=None
depends_on=None
from alembic import op

def upgrade():
    if op.get_bind().dialect.name!="postgresql":return
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    for table in ("stops","risk_zones","response_assets","reports","rain_readings"):
        op.execute(f"ALTER TABLE {table} ADD COLUMN geo_point geometry(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon,lat),4326)) STORED")
        op.execute(f"CREATE INDEX ix_{table}_geo_point ON {table} USING GIST (geo_point)")
    op.execute("ALTER TABLE vehicles ADD COLUMN geo_point geometry(Point,4326) GENERATED ALWAYS AS (CASE WHEN at_lon IS NOT NULL AND at_lat IS NOT NULL THEN ST_SetSRID(ST_MakePoint(at_lon,at_lat),4326) ELSE NULL END) STORED")
    op.execute("CREATE INDEX ix_vehicles_geo_point ON vehicles USING GIST (geo_point)")

def downgrade():
    if op.get_bind().dialect.name!="postgresql":return
    for table in ("stops","risk_zones","response_assets","reports","rain_readings","vehicles"):
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_geo_point")
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS geo_point")
    # Preserve PostGIS extension since other applications may rely on it.
