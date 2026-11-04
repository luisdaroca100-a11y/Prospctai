'use strict';

const { readBody, sendJSON, fetchWithTimeout, validateSearch, mapPlace, filterByRadius, demoResults } = require('./_lib');
const { searchOsm } = require('./osm');

// Busca de negócios por nicho + raio.
// Com GOOGLE_PLACES_API_KEY: Google Places API (New). A chave fica SÓ no
// servidor (variável de ambiente no painel da Vercel).
// Sem a chave: mapa GRÁTIS (OpenStreetMap via Nominatim + Overpass).
// A lista de demonstração só aparece com ?demo=1 explícito — nunca
// confundir com resultados reais.
const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

// Cache em memória do geocoding por cidade digitada (vive na instância).
const geocodeCache = new Map();

async function geocodeLocal(local, apiKey) {
  const key = local.trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  try {
    const url = GEOCODE_URL + '?address=' + encodeURIComponent(local) +
      '&region=br&language=pt-BR&key=' + encodeURIComponent(apiKey);
    const res = await fetchWithTimeout(url, {}, 8000);
    const data = await res.json();
    const loc = data && data.results && data.results[0] &&
      data.results[0].geometry && data.results[0].geometry.location;
    const center = loc ? { lat: loc.lat, lng: loc.lng } : null;
    geocodeCache.set(key, center);
    return center;
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJSON(res, 405, { error: 'method_not_allowed' });

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return sendJSON(res, 400, { error: 'bad_body' });
  }

  const v = validateSearch(body);
  if (!v.ok) return sendJSON(res, 400, { error: 'invalid_search', message: v.error });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    // Demonstração só com flag explícita (?demo=1) — fora do fluxo padrão.
    let demoFlag = false;
    try {
      demoFlag = new URL(req.url || '', 'http://localhost').searchParams.get('demo') === '1';
    } catch (e) { demoFlag = false; }
    if (demoFlag) {
      return sendJSON(res, 200, {
        demo: true,
        source: 'demo',
        results: demoResults(v.nicho),
        note: 'Modo demonstração (?demo=1): negócios fictícios, só para testar a interface.'
      });
    }
    // Fluxo padrão sem chave: mapa grátis (OpenStreetMap).
    try {
      const osm = await searchOsm({ nicho: v.nicho, raioKm: v.raioKm, local: v.local });
      return sendJSON(res, 200, {
        demo: false,
        source: 'osm',
        results: osm.results,
        center: osm.center,
        note: 'Fonte: OpenStreetMap (grátis) — pode mostrar menos negócios e sem nota.'
      });
    } catch (e) {
      return sendJSON(res, 502, {
        error: 'osm_error',
        message: (e && e.message) || 'O mapa grátis não respondeu agora. Tente de novo em instantes.'
      });
    }
  }

  const center = await geocodeLocal(v.local, apiKey);

  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.nationalPhoneNumber',
    'places.internationalPhoneNumber',
    'places.websiteUri',
    'places.rating',
    'places.userRatingCount',
    'places.types',
    'places.businessStatus'
  ].join(',');

  const searchBody = {
    textQuery: v.nicho + ' em ' + v.local,
    languageCode: 'pt-BR',
    regionCode: 'BR',
    maxResultCount: 20
  };
  if (center) {
    searchBody.locationBias = {
      circle: {
        center: { latitude: center.lat, longitude: center.lng },
        radius: v.raioKm * 1000
      }
    };
  }

  let data;
  try {
    const r = await fetchWithTimeout(PLACES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask
      },
      body: JSON.stringify(searchBody)
    }, 15000);
    const text = await r.text();
    try { data = text ? JSON.parse(text) : null; }
    catch (e) { data = null; }
    if (!r.ok) {
      const status = r.status;
      return sendJSON(res, 502, {
        error: 'places_error',
        message: status === 403
          ? 'A chave do Google recusou a chamada. Confira se a API Places (New) está ativa e se a chave permite o uso.'
          : status === 400
            ? 'A busca foi recusada pelo Google. Tente outro nicho ou cidade.'
            : 'O Google não respondeu agora. Tente de novo em instantes.'
      });
    }
  } catch (e) {
    return sendJSON(res, 502, {
      error: 'places_unreachable',
      message: 'Não consegui falar com o Google agora. Verifique a conexão e tente de novo.'
    });
  }

  const places = (data && Array.isArray(data.places)) ? data.places : [];
  const results = filterByRadius(places
    .map((p) => mapPlace(p, center, v.nicho))
    .filter((r) => r.name), v.raioKm);

  return sendJSON(res, 200, {
    demo: false,
    source: 'google',
    results,
    center,
    note: 'Primeira página de resultados (até 20 negócios).'
  });
};
