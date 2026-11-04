'use strict';

// Biblioteca compartilhada do backend (Vercel serverless, zero dependências).
// Só funções puras + helpers de HTTP. NENHUMA chave/segredo mora aqui:
// a chave GOOGLE_PLACES_API_KEY vive só em variável de ambiente no servidor.

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      if (!s) return resolve({});
      try { resolve(JSON.parse(s)); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

// fetch com timeout (AbortController). Sem retry: busca de prospecção
// não precisa insistir em falha de upstream.
async function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 10000);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Telefone / WhatsApp (lógica idêntica à cópia do app.js) ----------

// Normaliza telefone brasileiro para o formato internacional sem "+".
// Aceita: (19) 99999-1234, 19999991234, +55 19 99999-1234, 5519999991234.
// Devolve null quando não dá para formar um número brasileiro válido.
function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  // Prefixo internacional explícito (+ ou 00): só vale se for Brasil (55).
  // Sem ele, número estrangeiro sem "+" seria confundido com brasileiro.
  if (s.startsWith('+') || d.startsWith('00')) {
    if (d.startsWith('00')) d = d.slice(2);
    return (d.startsWith('55') && (d.length === 12 || d.length === 13)) ? d : null;
  }
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return '55' + d;
  return null;
}

function buildWaUrl(phoneDigits, message) {
  return 'https://wa.me/' + phoneDigits + '?text=' + encodeURIComponent(message || '');
}

// ---------- Distância ----------

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- Validação da busca ----------

function validateSearch(body) {
  const nicho = typeof body.nicho === 'string' ? body.nicho.trim() : '';
  const local = typeof body.local === 'string' ? body.local.trim() : '';
  const raioKm = Number(body.raioKm);
  if (!nicho) return { ok: false, error: 'Informe o nicho (ex.: pizzaria).' };
  if (nicho.length > 100) return { ok: false, error: 'O nicho deve ter no máximo 100 caracteres.' };
  if (!local) return { ok: false, error: 'Informe a cidade (ex.: Piracicaba, SP).' };
  if (local.length > 120) return { ok: false, error: 'A cidade deve ter no máximo 120 caracteres.' };
  if (!Number.isFinite(raioKm) || raioKm < 1 || raioKm > 100) {
    return { ok: false, error: 'O raio deve ser de 1 a 100 km.' };
  }
  return { ok: true, nicho, local, raioKm };
}

// ---------- Mapeamento da resposta do Places API (New) ----------

// Rótulos simples para os tipos mais comuns. Sem tradução completa:
// o que não estiver aqui cai no próprio nicho digitado.
const TYPE_LABELS = {
  restaurant: 'Restaurante',
  pizza_restaurant: 'Pizzaria',
  bar: 'Bar',
  cafe: 'Café',
  bakery: 'Padaria',
  beauty_salon: 'Salão de beleza',
  barber_shop: 'Barbearia',
  hair_salon: 'Salão de beleza',
  gym: 'Academia',
  pharmacy: 'Farmácia',
  pet_store: 'Pet shop',
  veterinary_care: 'Clínica veterinária',
  clothing_store: 'Loja de roupas',
  supermarket: 'Supermercado',
  hotel: 'Hotel',
  spa: 'Spa',
  nail_salon: 'Esmalteria',
  car_repair: 'Oficina mecânica',
  dentist: 'Dentista',
  doctor: 'Consultório médico',
  school: 'Escola',
  church: 'Igreja'
};

function categoryLabel(types, fallback) {
  if (Array.isArray(types)) {
    for (const t of types) {
      if (TYPE_LABELS[t]) return TYPE_LABELS[t];
    }
  }
  return fallback || '';
}

// Converte um "place" cru do Places API (New) no objeto simples do frontend.
// `center` pode ser null (busca sem viés de localização): aí distanceKm é null.
function mapPlace(place, center, fallbackCategory) {
  const name = place && place.displayName && place.displayName.text
    ? place.displayName.text : '';
  const lat = place && place.location ? place.location.latitude : null;
  const lng = place && place.location ? place.location.longitude : null;
  const website = place && place.websiteUri ? place.websiteUri : null;
  const phone = place && (place.nationalPhoneNumber || place.internationalPhoneNumber)
    ? (place.nationalPhoneNumber || place.internationalPhoneNumber) : null;
  return {
    id: place && place.id ? place.id : '',
    name,
    category: categoryLabel(place && place.types, fallbackCategory),
    address: place && place.formattedAddress ? place.formattedAddress : '',
    distanceKm: (center && lat !== null && lng !== null)
      ? Math.round(distanceKm(center.lat, center.lng, lat, lng) * 10) / 10
      : null,
    rating: typeof place.rating === 'number' ? place.rating : null,
    userRatingCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    phone,
    phoneDigits: normalizePhone(phone),
    website,
    hasWebsite: !!website,
    businessStatus: place && place.businessStatus ? place.businessStatus : null,
    demo: false
  };
}

// Filtra pelo raio escolhido: o Places API (New) recebe locationBias
// (viés, não restrição), então pode devolver negócios fora do círculo.
// Só sai quem tem distância calculada maior que o raio; sem distância
// (sem coordenadas) o resultado é mantido, pois não dá para provar
// que está fora.
function filterByRadius(results, raioKm) {
  return results.filter(function (r) {
    return typeof r.distanceKm !== 'number' || r.distanceKm <= raioKm;
  });
}

// ---------- Dados de demonstração (NUNCA apresentados como reais) ----------

const DEMO_BUSINESSES = [
  {
    id: 'demo-1', name: 'Pizzaria Exemplo', category: 'Pizzaria',
    address: 'Rua de Exemplo, 123 - Centro, Cidade de Demonstração, SP',
    distanceKm: 1.2, rating: 4.5, userRatingCount: 120,
    phone: '(19) 99999-0001', phoneDigits: '5519999990001',
    website: 'https://exemplo.com.br', hasWebsite: true,
    businessStatus: 'OPERATIONAL', demo: true
  },
  {
    id: 'demo-2', name: 'Barbearia Demonstração', category: 'Barbearia',
    address: 'Av. Fictícia, 456 - Bairro Modelo, Cidade de Demonstração, SP',
    distanceKm: 2.4, rating: 4.8, userRatingCount: 87,
    phone: '(19) 99999-0002', phoneDigits: '5519999990002',
    website: null, hasWebsite: false,
    businessStatus: 'OPERATIONAL', demo: true
  },
  {
    id: 'demo-3', name: 'Salão de Beleza Fictício', category: 'Salão de beleza',
    address: 'Rua das Amostras, 789 - Jardim Teste, Cidade de Demonstração, SP',
    distanceKm: 3.1, rating: 4.2, userRatingCount: 54,
    phone: '(19) 99999-0003', phoneDigits: '5519999990003',
    website: 'https://exemplo.com.br', hasWebsite: true,
    businessStatus: 'OPERATIONAL', demo: true
  },
  {
    id: 'demo-4', name: 'Academia Teste', category: 'Academia',
    address: 'Rua Ilustrativa, 101 - Vila Simulação, Cidade de Demonstração, SP',
    distanceKm: 4.7, rating: 3.9, userRatingCount: 203,
    phone: null, phoneDigits: null,
    website: null, hasWebsite: false,
    businessStatus: 'OPERATIONAL', demo: true
  },
  {
    id: 'demo-5', name: 'Restaurante Modelo', category: 'Restaurante',
    address: 'Praça de Mentira, 202 - Centro, Cidade de Demonstração, SP',
    distanceKm: 5.9, rating: 4.6, userRatingCount: 311,
    phone: '(19) 99999-0005', phoneDigits: '5519999990005',
    website: 'https://exemplo.com.br', hasWebsite: true,
    businessStatus: 'OPERATIONAL', demo: true
  },
  {
    id: 'demo-6', name: 'Pet Shop Amostra', category: 'Pet shop',
    address: 'Alameda Falsa, 303 - Parque Exemplo, Cidade de Demonstração, SP',
    distanceKm: 7.3, rating: 4.9, userRatingCount: 42,
    phone: '(19) 99999-0006', phoneDigits: '5519999990006',
    website: null, hasWebsite: false,
    businessStatus: 'OPERATIONAL', demo: true
  }
];

// Filtra a lista demo pelo nicho digitado (casamento simples por palavra,
// só para a demonstração parecer com a busca; nunca mistura com dados reais).
function demoResults(nicho) {
  const q = nicho.toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const scored = DEMO_BUSINESSES.map((b) => {
    const hay = (b.name + ' ' + b.category).toLowerCase();
    const hits = words.filter((w) => hay.includes(w)).length;
    return { b, hits };
  });
  const matched = scored.filter((s) => s.hits > 0).map((s) => s.b);
  return matched.length ? matched : DEMO_BUSINESSES.slice();
}

// ---------- Estimativa de qualidade de site ----------

// Pontos: acessível (1) + https (1) + viewport mobile (1) + link de
// WhatsApp (1) + título (1). É uma ESTIMATIVA por sinais, não um veredito.
function scoreSiteSignals(s) {
  let score = 0;
  if (s.ok) score += 1;
  if (s.https) score += 1;
  if (s.hasViewport) score += 1;
  if (s.hasWhatsAppLink) score += 1;
  if (s.hasTitle) score += 1;
  const label = score >= 4 ? 'Boa' : score >= 2 ? 'Regular' : 'Fraca';
  return { score, label };
}

module.exports = {
  readBody,
  sendJSON,
  fetchWithTimeout,
  normalizePhone,
  buildWaUrl,
  distanceKm,
  validateSearch,
  categoryLabel,
  mapPlace,
  filterByRadius,
  DEMO_BUSINESSES,
  demoResults,
  scoreSiteSignals
};
