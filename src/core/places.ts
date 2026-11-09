import type { NearbyPlace, PlaceResult, PlacesClient } from './types.js';

/** Google Places API (New): busca locais perto de um ponto. */
export class GooglePlaces implements PlacesClient {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async nearby(lat: number, lng: number, radiusM: number, types: string[]): Promise<NearbyPlace[]> {
    if (!this.apiKey) throw new Error('GOOGLE_MAPS_API_KEY não configurada');
    const res = await this.fetchFn('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.location',
      },
      body: JSON.stringify({
        includedTypes: types,
        maxResultCount: 5,
        rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Google Places respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json();
    return (body.places ?? []).map((p: any) => ({
      name: String(p.displayName?.text ?? 'Local de treino'),
      lat: Number(p.location?.latitude),
      lng: Number(p.location?.longitude),
    }));
  }

  async search(query: string, max = 5): Promise<PlaceResult[]> {
    if (!this.apiKey) throw new Error('GOOGLE_MAPS_API_KEY não configurada');
    const res = await this.fetchFn('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri',
      },
      body: JSON.stringify({ textQuery: query, languageCode: 'pt-BR', regionCode: 'BR', pageSize: max }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Google Places respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json();
    return (body.places ?? []).slice(0, max).map((p: any) => ({
      name: String(p.displayName?.text ?? 'Local'),
      address: String(p.formattedAddress ?? ''),
      ...(typeof p.rating === 'number' ? { rating: p.rating } : {}),
      ...(typeof p.userRatingCount === 'number' ? { ratings: p.userRatingCount } : {}),
      ...(p.googleMapsUri ? { mapsUrl: String(p.googleMapsUri) } : {}),
    }));
  }
}
