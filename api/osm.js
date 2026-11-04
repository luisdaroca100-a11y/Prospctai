'use strict';

// Fonte de dados GRÁTIS (OpenStreetMap) para a prospecção.
// Usada quando NÃO há chave GOOGLE_PLACES_API_KEY configurada.
// Sem chave, sem cadastro, sem faturamento: geocoding via Nominatim e
// busca de negócios via Overpass API. NENHUMA chave/segredo mora aqui.

const { distanceKm, normalizePhone, filterByRadius } = require('./_lib');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
// A política de uso do Nominatim/Overpass pede um User-Agent que
// identifique a aplicação. Sem ele, as chamadas podem ser bloqueadas.
const USER_AGENT = 'prospeccao-clientes/1.0';

// Cache em memória do geocoding por cidade digitada (vive na instância).
const geocodeCache = new Map();

// ---------- Nicho → etiquetas OSM ----------

// Cada definição: chaves de busca (normalizadas, sem acento) e os
// filtros de etiquetas Overpass correspondentes. O rótulo vira a
// categoria do resultado quando as etiquetas não dizem mais.
const NICHE_DEFS = [
  {
    keys: ['pizzaria', 'pizza'], label: 'Pizzaria',
    filters: [
      { amenity: 'restaurant', cuisine: 'pizza' },
      { amenity: 'fast_food', cuisine: 'pizza' }
    ]
  },
  {
    keys: ['barbearia', 'barbeiro'], label: 'Barbearia',
    filters: [
      { shop: 'barber' },
      { shop: 'hairdresser', barber: 'yes' }
    ]
  },
  {
    keys: ['salão de beleza', 'salao de beleza', 'salao', 'salão', 'cabeleireiro', 'beleza'],
    label: 'Salão de beleza',
    filters: [
      { shop: 'hairdresser' },
      { shop: 'beauty' }
    ]
  },
  {
    keys: ['academia', 'gym', 'musculação', 'musculacao'], label: 'Academia',
    filters: [{ leisure: 'fitness_centre' }]
  },
  {
    keys: ['restaurante'], label: 'Restaurante',
    filters: [{ amenity: 'restaurant' }]
  },
  {
    keys: ['pet shop', 'petshop', 'pet'], label: 'Pet shop',
    filters: [{ shop: 'pet' }, { shop: 'pet_grooming' }]
  },
  {
    keys: ['farmácia', 'farmacia', 'drogaria'], label: 'Farmácia',
    filters: [{ amenity: 'pharmacy' }]
  },
  {
    keys: ['padaria', 'panificadora'], label: 'Padaria',
    filters: [{ shop: 'bakery' }]
  },
  {
    keys: ['mercado', 'supermercado', 'conveniência', 'conveniencia'], label: 'Mercado',
    filters: [{ shop: 'supermarket' }, { shop: 'convenience' }]
  },
  {
    keys: ['café', 'cafe', 'cafeteria'], label: 'Café',
    filters: [{ amenity: 'cafe' }]
  },
  {
    keys: ['lanchonete', 'lanche'], label: 'Lanchonete',
    filters: [{ amenity: 'fast_food' }]
  }
];

// Normaliza o nicho digitado: minúsculas, sem acento, espaços únicos.
function normalizeNicho(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Acha a definição do nicho (igualdade ou palavra inteira dentro do
// texto). Nicho desconhecido → null: a busca usa só o nome (fallback).
function findNicheDef(nicho) {
  const n = normalizeNicho(nicho);
  if (!n) return null;
  const words = n.split(' ');
  for (const def of NICHE_DEFS) {
    for (const key of def.keys) {
      if (n === key) return def;
      if (key.indexOf(' ') === -1 && words.indexOf(key) !== -1) return def;
      if (key.indexOf(' ') !== -1 && n.indexOf(key) !== -1) return def;
    }
  }
  return null;
}

// Devolve { label, filters } do nicho, ou { label: null, filters: [] }
// quando o nicho não tem mapeamento (fallback só por nome).
function tagsForNicho(nicho) {
  const def = findNicheDef(nicho);
  if (!def) return { label: null, filters: [] };
  return { label: def.label, filters: def.filters };
}

// Escapa texto do usuário para usar dentro de uma regex Overpass entre
// aspas duplas: tira aspas/quebras (que quebrariam a string QL) e
// escapa os caracteres especiais de regex.
function escapeOverpassRegex(s) {
  return String(s || '')
    .replace(/["\r\n]/g, '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function filterToQl(filter, around) {
  const parts = Object.keys(filter)
    .map((k) => '["' + k + '"="' + filter[k] + '"]')
    .join('');
  return 'nwr' + parts + '(' + around + ');';
}

// Duas consultas separadas, em ordem: primeiro SÓ as etiquetas do nicho
// (consulta indexada, rápida); o fallback por nome (regex, que varre
// todos os objetos com nome no raio — bem mais lento) só roda quando a
// primeira volta vazia. Juntar as duas numa união só fazia o Overpass
// público estourar o tempo limite e a busca voltar zerada.
// `out center 60;` devolve até 60 elementos com centro calculado para
// ways/relações.
function buildTagQuery(nicho, lat, lon, radiusM) {
  const def = findNicheDef(nicho);
  if (!def) return null;
  const around = 'around:' + Math.round(radiusM) + ',' + lat + ',' + lon;
  const lines = def.filters.map((f) => '  ' + filterToQl(f, around));
  return '[out:json][timeout:25];\n(\n' + lines.join('\n') + '\n);\nout center 60;';
}

function buildNameQuery(nicho, lat, lon, radiusM) {
  const safe = escapeOverpassRegex(String(nicho).trim());
  if (!safe) return null;
  const around = 'around:' + Math.round(radiusM) + ',' + lat + ',' + lon;
  return '[out:json][timeout:25];\n(\n  nwr["name"~"' + safe + '",i](' + around + ');\n);\nout center 60;';
}

// ---------- HTTP com timeout (fetch injetável, para testes) ----------

async function fetchWithTimeoutImpl(url, options, timeoutMs, fetchImpl) {
  const f = fetchImpl || fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
  try {
    return await f(url, Object.assign({}, options, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Geocoding (Nominatim) ----------

// Devolve { lat, lng } ou null (cidade não encontrada). Lança Error com
// mensagem em linguagem simples quando o serviço não responde — nunca
// devolve uma coordenada errada para "não travar" a busca.
async function geocodeCity(local, fetchImpl) {
  const key = String(local).trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  const url = NOMINATIM_URL + '?format=json&limit=1&q=' + encodeURIComponent(local);
  let res;
  try {
    res = await fetchWithTimeoutImpl(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pt-BR' }
    }, 10000, fetchImpl);
  } catch (e) {
    throw new Error('Não consegui consultar o mapa grátis agora. Tente de novo em instantes.');
  }
  if (!res.ok) {
    throw new Error('O mapa grátis não respondeu agora (erro ' + res.status + '). Tente de novo em instantes.');
  }
  const data = await res.json();
  const first = Array.isArray(data) ? data[0] : null;
  const center = first && first.lat !== undefined && first.lon !== undefined
    ? { lat: Number(first.lat), lng: Number(first.lon) }
    : null;
  geocodeCache.set(key, center);
  return center;
}

// ---------- Mapeamento dos elementos Overpass ----------

function composeAddress(tags) {
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ');
  const cityState = [tags['addr:city'] || tags['addr:town'] || tags['addr:village'], tags['addr:state']]
    .filter(Boolean).join(', ');
  const parts = [];
  if (street) parts.push(street);
  if (tags['addr:suburb'] || tags['addr:neighbourhood']) {
    parts.push(tags['addr:suburb'] || tags['addr:neighbourhood']);
  }
  if (cityState) parts.push(cityState);
  return parts.join(' - ');
}

function categoryFromTags(tags, fallback) {
  const cuisine = String(tags.cuisine || '').toLowerCase();
  if (cuisine.indexOf('pizza') !== -1) return 'Pizzaria';
  if (tags.shop === 'barber' || (tags.shop === 'hairdresser' && tags.barber === 'yes')) return 'Barbearia';
  if (tags.shop === 'hairdresser' || tags.shop === 'beauty') return 'Salão de beleza';
  if (tags.leisure === 'fitness_centre' || tags.leisure === 'fitness_station') return 'Academia';
  if (tags.amenity === 'pharmacy') return 'Farmácia';
  if (tags.shop === 'bakery') return 'Padaria';
  if (tags.shop === 'supermarket') return 'Supermercado';
  if (tags.shop === 'convenience') return 'Mercado';
  if (tags.amenity === 'cafe') return 'Café';
  if (tags.amenity === 'fast_food') return 'Lanchonete';
  if (tags.shop === 'pet' || tags.shop === 'pet_grooming') return 'Pet shop';
  if (tags.amenity === 'restaurant') return 'Restaurante';
  return fallback || '';
}

// Converte elementos Overpass no MESMO formato que o caminho do Google
// devolve (id, name, category, address, phone, website, rating null,
// reviewCount null, distanceKm, source 'osm', hasWebsite, demo false).
// Pula elementos sem nome. Remove duplicados por nome+endereço.
function mapOsmElements(elements, center, fallbackCategory) {
  const seen = new Set();
  const out = [];
  for (const el of elements || []) {
    const tags = (el && el.tags) || {};
    const name = typeof tags.name === 'string' ? tags.name.trim() : '';
    if (!name) continue;
    const lat = typeof el.lat === 'number' ? el.lat
      : (el.center && typeof el.center.lat === 'number' ? el.center.lat : null);
    const lon = typeof el.lon === 'number' ? el.lon
      : (el.center && typeof el.center.lon === 'number' ? el.center.lon : null);
    const address = composeAddress(tags);
    const rawPhone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || null;
    const phone = rawPhone ? String(rawPhone).split(';')[0].trim() : null;
    const website = tags.website || tags['contact:website'] || null;
    const dedupeKey = (name + '|' + address).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      id: 'osm-' + el.type + '/' + el.id,
      name,
      category: categoryFromTags(tags, fallbackCategory),
      address,
      distanceKm: (center && lat !== null && lon !== null)
        ? Math.round(distanceKm(center.lat, center.lng, lat, lon) * 10) / 10
        : null,
      rating: null,
      userRatingCount: null,
      phone: phone || null,
      phoneDigits: normalizePhone(phone),
      website: website || null,
      hasWebsite: !!website,
      businessStatus: null,
      source: 'osm',
      demo: false
    });
  }
  return out;
}

// ---------- Busca completa (geocode → Overpass) ----------

async function runOverpassQuery(query, fetchImpl) {
  let res;
  try {
    res = await fetchWithTimeoutImpl(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT
      },
      body: 'data=' + encodeURIComponent(query)
    }, 30000, fetchImpl);
  } catch (e) {
    throw new Error('O mapa grátis demorou demais para responder. Tente de novo em instantes ou configure a chave do Google.');
  }
  if (!res.ok) {
    throw new Error('O mapa grátis não respondeu agora (erro ' + res.status + '). Tente de novo em instantes ou configure a chave do Google.');
  }
  const data = await res.json();
  return data && Array.isArray(data.elements) ? data.elements : [];
}

async function searchOsm(params, fetchImpl) {
  const center = await geocodeCity(params.local, fetchImpl);
  if (!center) {
    throw new Error('Não encontrei a cidade "' + params.local + '" no mapa grátis. Confira o nome da cidade e tente de novo.');
  }
  const def = tagsForNicho(params.nicho);
  // Etiquetas primeiro; nome só se voltar vazio (ver buildTagQuery).
  let elements = [];
  const tagQuery = buildTagQuery(params.nicho, center.lat, center.lng, params.raioKm * 1000);
  if (tagQuery) elements = await runOverpassQuery(tagQuery, fetchImpl);
  if (!elements.length) {
    const nameQuery = buildNameQuery(params.nicho, center.lat, center.lng, params.raioKm * 1000);
    if (nameQuery) elements = await runOverpassQuery(nameQuery, fetchImpl);
  }
  const results = filterByRadius(
    mapOsmElements(elements, center, def.label || params.nicho),
    params.raioKm
  );
  return { results, center };
}

module.exports = {
  NICHE_DEFS,
  normalizeNicho,
  findNicheDef,
  tagsForNicho,
  escapeOverpassRegex,
  buildTagQuery,
  buildNameQuery,
  geocodeCity,
  composeAddress,
  categoryFromTags,
  mapOsmElements,
  searchOsm,
  NOMINATIM_URL,
  OVERPASS_URL
};
