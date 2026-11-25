#!/usr/bin/env bash
set -euo pipefail
# Downloads a real Peru OSM extract (approx hundreds of MB). Allow generous disk/RAM.
# Non-commercial OSM community: follow ODbL attribution/share-alike requirements.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/data/osrm"
OSRM_IMAGE="${BOARDSAFE_OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:latest}"
mkdir -p "$DEST"
cd "$DEST"
if [ ! -s peru-latest.osm.pbf ]; then
    echo "Descargando Perú OSM PBF desde Geofabrik ..."
    curl --fail --location --retry 3 --output peru-latest.osm.pbf \
      https://download.geofabrik.de/south-america/peru-latest.osm.pbf
fi
if [ ! -s peru-latest.osrm.mldgr ]; then
    echo "Preparando OSRM (puede necesitar varios GB de RAM y espacio en disco) ..."
    docker run --rm -v "$DEST:/data" "$OSRM_IMAGE" \
       osrm-extract -p /opt/car.lua /data/peru-latest.osm.pbf
    docker run --rm -v "$DEST:/data" "$OSRM_IMAGE" \
       osrm-partition /data/peru-latest.osrm
    docker run --rm -v "$DEST:/data" "$OSRM_IMAGE" \
       osrm-customize /data/peru-latest.osrm
fi
echo "Rutas OSRM preparadas con $OSRM_IMAGE. Inicie el perfil routing del Compose elegido con esa misma imagen."
