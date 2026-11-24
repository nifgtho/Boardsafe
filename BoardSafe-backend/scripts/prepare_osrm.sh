#!/usr/bin/env bash
set -euo pipefail
# Downloads a real Peru OSM extract (approx hundreds of MB). Allow generous disk/RAM.
# Non-commercial OSM community: follow ODbL attribution/share-alike requirements.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/data/osrm"
mkdir -p "$DEST"
cd "$DEST"
if [ ! -s peru-latest.osm.pbf ]; then
    echo "Descargando Perú OSM PBF desde Geofabrik ..."
    curl --fail --location --retry 3 --output peru-latest.osm.pbf \
      https://download.geofabrik.de/south-america/peru-latest.osm.pbf
fi
if [ ! -s peru-latest.osrm.mldgr ]; then
    echo "Preparando OSRM (puede necesitar varios GB de RAM y espacio en disco) ..."
    docker run --rm -t -v "$DEST:/data" ghcr.io/project-osrm/osrm-backend:latest \
       osrm-extract -p /opt/car.lua /data/peru-latest.osm.pbf
    docker run --rm -t -v "$DEST:/data" ghcr.io/project-osrm/osrm-backend:latest \
       osrm-partition /data/peru-latest.osrm
    docker run --rm -t -v "$DEST:/data" ghcr.io/project-osrm/osrm-backend:latest \
       osrm-customize /data/peru-latest.osrm
fi
echo "Rutas OSRM preparadas. Inicie: docker compose --profile routing up -d"
