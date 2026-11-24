"""Geometry and route-to-restriction overlap in metres, with explicit uncertainty margin."""
from math import radians, cos, sin, atan2, sqrt
from shapely.geometry import LineString as SLine, Point
from shapely.ops import transform

EARTH_RADIUS_M = 6371008.8

def meters_between(a: tuple[float,float], b: tuple[float,float]) -> float:
    """(lon,lat) pairs."""
    lon1, lat1, lon2, lat2 = map(radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2-lat1, lon2-lon1
    q = sin(dlat/2)**2 + cos(lat1)*cos(lat2)*sin(dlon/2)**2
    return EARTH_RADIUS_M * 2 * atan2(sqrt(q), sqrt(max(0,1-q)))

def near_route(a_geometry: dict, b_geometry: dict, margin_m: float = 35.0) -> bool:
    """Conservative planar metric check over local routing areas; NOT certified surveying."""
    a = a_geometry.get("coordinates", [])
    b = b_geometry.get("coordinates", [])
    if a_geometry.get("type") != "LineString" or b_geometry.get("type") != "LineString" or len(a) < 2 or len(b) < 2:
        raise ValueError("Se requieren geometrías GeoJSON LineString válidas")
    middle_lat = sum(p[1] for p in a + b) / (len(a) + len(b))
    scale_x = max(1000, 111320 * cos(radians(middle_lat)))
    def xy(lon, lat, z=None):
        return lon*scale_x, lat*111320
    return transform(xy, SLine(a)).distance(transform(xy, SLine(b))) <= margin_m

def within_radius(point_lon, point_lat, zone_lon, zone_lat, radius_m):
    return meters_between((point_lon,point_lat), (zone_lon,zone_lat)) <= radius_m

def route_start_end_match(geometry: dict, origin: tuple, destination: tuple, max_m=600):
    points = geometry.get("coordinates", [])
    return bool(points) and meters_between(points[0], origin) <= max_m and meters_between(points[-1], destination) <= max_m
