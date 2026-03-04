export type LatLng = { lat: number; lng: number };

export function encodePolygon(points: LatLng[]): string {
  return points
    .map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)
    .join(";");
}

export function decodePolygon(poly: string | null | undefined): LatLng[] {
  if (!poly) return [];
  const out: LatLng[] = [];
  for (const part of poly.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [latStr, lngStr] = trimmed.split(",", 2);
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ lat, lng });
  }
  return out.length >= 3 ? out : [];
}

// Jednoduchý ray‑casting algoritmus pro test bod‑v‑polygone.
export function isPointInPolygon(lat: number, lng: number, polygon: LatLng[]): boolean {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lng;
    const xj = polygon[j].lat;
    const yj = polygon[j].lng;

    const intersect =
      yi > lng !== yj > lng &&
      lat < ((xj - xi) * (lng - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function getPolygonBounds(polygon: LatLng[]) {
  if (!polygon || polygon.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of polygon) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(maxLat) || !Number.isFinite(minLng) || !Number.isFinite(maxLng)) {
    return null;
  }
  return { minLat, maxLat, minLng, maxLng };
}


