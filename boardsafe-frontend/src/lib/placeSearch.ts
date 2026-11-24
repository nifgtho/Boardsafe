export interface Destination {
  id: string;
  title: string;
  subtitle: string;
  lat: number;
  lon: number;
}

interface PhotonPlace {
  geometry?: { coordinates?: number[] };
  properties?: { name?: string; street?: string; housenumber?: string; city?: string; state?: string; country?: string };
}

export async function searchPlaces(query: string, center = { lat: -9.9306, lng: -76.2422 }, signal?: AbortSignal): Promise<Destination[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.search = new URLSearchParams({ q: query, lat: String(center.lat), lon: String(center.lng), limit: "5" }).toString();
  const timeout = AbortSignal.timeout(8000);
  const response = await fetch(url, {
    referrerPolicy: "no-referrer",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error("Búsqueda de lugares no disponible.");
  const data: { features: PhotonPlace[] } = await response.json();
  return data.features.flatMap((place, index) => {
    const [lon, lat] = place.geometry?.coordinates ?? [];
    const p = place.properties;
    if (!p || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    const street = [p.street, p.housenumber].filter(Boolean).join(" ");
    const title = p.name || street;
    if (!title) return [];
    const subtitle = [street !== title && street, p.city, p.state, p.country].filter(Boolean).join(", ");
    return [{ id: `place-${index}-${lon}-${lat}`, title, subtitle, lat, lon }];
  });
}
