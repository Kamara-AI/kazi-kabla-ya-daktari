/**
 * healthProviders.ts
 *
 * Finds nearby health facilities using two free, keyless APIs:
 *   1. Browser Geolocation API — gets the user's lat/lon
 *   2. OpenStreetMap Overpass API — queries OSM for nearby amenities
 *
 * No third-party libraries. No API keys. Works globally, including Kenya.
 *
 * Privacy: location is resolved in the browser, sent only to Overpass (a
 * public read-only OSM mirror), and never stored anywhere by this app.
 */

export interface HealthProvider {
  id: number;
  name: string;
  type: 'hospital' | 'clinic' | 'pharmacy' | 'doctors' | 'other';
  distanceMetres: number;
  lat: number;
  lon: number;
  phone?: string;
  openingHours?: string;
  /** Constructed from lat/lon — opens in Google Maps, no API key needed. */
  googleMapsUrl: string;
}

export interface ProviderSearchResult {
  providers: HealthProvider[];
  userLat: number;
  userLon: number;
}

// ---------------------------------------------------------------------------
// Overpass response types — only the fields we actually use
// ---------------------------------------------------------------------------

interface OverpassTags {
  name?: string;
  amenity?: string;
  healthcare?: string;
  phone?: string;
  'contact:phone'?: string;
  opening_hours?: string;
}

interface OverpassElement {
  type: string;
  id: number;
  lat: number;
  lon: number;
  tags: OverpassTags;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

// ---------------------------------------------------------------------------
// Haversine distance (private)
// ---------------------------------------------------------------------------

/**
 * Returns the great-circle distance in metres between two WGS-84 points.
 * Implements the Haversine formula — accurate to within 0.5% for distances
 * up to a few hundred km, which is more than sufficient for a 5 km search.
 */
function haversineMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

function resolveType(tags: OverpassTags): HealthProvider['type'] {
  const amenity = tags.amenity ?? '';
  const healthcare = tags.healthcare ?? '';

  if (amenity === 'hospital') return 'hospital';
  if (amenity === 'clinic' || healthcare === 'clinic') return 'clinic';
  if (amenity === 'pharmacy') return 'pharmacy';
  if (amenity === 'doctors') return 'doctors';
  return 'other';
}

// ---------------------------------------------------------------------------
// Geolocation wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps navigator.geolocation.getCurrentPosition in a Promise.
 * Rejects with a user-friendly bilingual message on any failure.
 * Hard timeout: 10 seconds (matches the Overpass [timeout:10] query param).
 */
function getUserLocation(): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        new Error(
          'Location is not supported by your browser. Please ask the nurse for a referral. ' +
            '/ Kivinjari chako hakisaidii mahali. Tafadhali mwulize muuguzi.',
        ),
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      (err) => {
        // GeolocationPositionError codes: 1=PERMISSION_DENIED, 2=UNAVAILABLE, 3=TIMEOUT
        if (err.code === 1) {
          reject(
            new Error(
              'Please allow location access so we can find clinics near you. ' +
                '/ Tafadhali ruhusu ufikiaji wa mahali ili tuweze kupata kliniki karibu nawe.',
            ),
          );
        } else {
          reject(
            new Error(
              'Unable to determine your location right now. Please ask the nurse for a referral. ' +
                '/ Haiwezekani kupata mahali pako sasa. Tafadhali mwulize muuguzi.',
            ),
          );
        }
      },
      { timeout: 10_000, maximumAge: 60_000, enableHighAccuracy: false },
    );
  });
}

// ---------------------------------------------------------------------------
// Overpass API query
// ---------------------------------------------------------------------------

/**
 * Builds the Overpass QL query for health facilities within 5 km.
 * We query nodes only — ways/relations rarely have accurate lat/lon centroids
 * available in the basic "out body" response, and node coverage in Kenya OSM
 * is sufficient for our purposes.
 */
function buildOverpassQuery(lat: number, lon: number): string {
  const radius = 5000; // metres
  const around = `(around:${radius},${lat},${lon})`;
  return `[out:json][timeout:10];
(
  node[amenity=hospital]${around};
  node[amenity=clinic]${around};
  node[amenity=doctors]${around};
  node[amenity=pharmacy]${around};
  node[healthcare=clinic]${around};
);
out body;`;
}

/**
 * Calls the Overpass API and returns raw elements.
 * Uses AbortSignal.timeout (15 s) so a slow Overpass mirror never hangs the UI.
 */
async function fetchFromOverpass(
  lat: number,
  lon: number,
): Promise<OverpassElement[]> {
  const query = buildOverpassQuery(lat, lon);
  const url = 'https://overpass-api.de/api/interpreter';

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `Unable to search right now. Please ask the nurse for a referral. ` +
        `/ Haiwezekani kutafuta sasa. Tafadhali mwulize muuguzi.`,
    );
  }

  const json = (await response.json()) as OverpassResponse;
  return json.elements ?? [];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Full pipeline: locate user → query Overpass → parse → sort → return top 10.
 *
 * Throws a bilingual Error on geolocation failure or network error.
 * Returns an empty providers array (not an error) when Overpass finds nothing.
 */
export async function findNearbyProviders(): Promise<ProviderSearchResult> {
  const coords = await getUserLocation();
  const { latitude: userLat, longitude: userLon } = coords;

  let elements: OverpassElement[];
  try {
    elements = await fetchFromOverpass(userLat, userLon);
  } catch (err) {
    // Re-throw with a user-friendly message if it isn't already one
    if (err instanceof Error) throw err;
    throw new Error(
      'Unable to search right now. Please ask the nurse for a referral. ' +
        '/ Haiwezekani kutafuta sasa. Tafadhali mwulize muuguzi.',
    );
  }

  const providers: HealthProvider[] = elements
    .filter((el) => el.lat !== undefined && el.lon !== undefined)
    .map((el): HealthProvider => {
      const phone = el.tags.phone ?? el.tags['contact:phone'];
      return {
        id: el.id,
        name: el.tags.name ?? '',
        type: resolveType(el.tags),
        distanceMetres: haversineMetres(userLat, userLon, el.lat, el.lon),
        lat: el.lat,
        lon: el.lon,
        phone: phone,
        openingHours: el.tags.opening_hours,
        googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${el.lat},${el.lon}`,
      };
    })
    .sort((a, b) => a.distanceMetres - b.distanceMetres)
    .slice(0, 10);

  return { providers, userLat, userLon };
}
