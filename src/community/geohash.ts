// Geohash minimale (codifica + celle vicine), senza dipendenze.
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encode(lat: number, lon: number, precision = 6): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        ch = (ch << 1) | 1;
        lonMin = mid;
      } else {
        ch = ch << 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch = ch << 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Cella del punto più le 8 vicine (precisione 6 ≈ 1,2 × 0,6 km). */
export function cellsAround(lat: number, lon: number, precision = 6): string[] {
  const dLat = precision === 6 ? 0.0055 : 0.044;
  const dLon = precision === 6 ? 0.011 : 0.044;
  const set = new Set<string>();
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) set.add(encode(lat + a * dLat, lon + b * dLon, precision));
  return [...set];
}
