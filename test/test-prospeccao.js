'use strict';

// Testes da prospecção — sem rede real (fetch é mockado onde precisa).
// Rodar: node test/test-prospeccao.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const lib = require('../api/_lib');
const app = require('../app');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}
function eq(a, b, msg) {
  assert.strictEqual(a, b, msg + ' (esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a) + ')');
  passed++;
}

// ---------- normalizePhone (backend E frontend, lógica idêntica) ----------
const phoneCases = [
  ['(19) 99999-1234', '5519999991234'],
  ['19999991234', '5519999991234'],
  ['+55 19 99999-1234', '5519999991234'],
  ['5519999991234', '5519999991234'],
  ['(19) 3333-4444', '551933334444'],
  ['5551999991234', '5551999991234'],
  ['0033 1 42 00 00 00', null],
  ['123', null],
  ['', null],
  [null, null],
  ['99999-1234', null],
  ['(19) 9999-1234', '551999991234']
];
for (const [input, expected] of phoneCases) {
  eq(lib.normalizePhone(input), expected, 'lib.normalizePhone(' + JSON.stringify(input) + ')');
  eq(app.normalizePhone(input), expected, 'app.normalizePhone(' + JSON.stringify(input) + ')');
}

// ---------- buildWaUrl ----------
{
  const url = lib.buildWaUrl('5519999991234', 'Olá! Tudo bem?');
  ok(url.startsWith('https://wa.me/5519999991234?text='), 'wa.me base');
  ok(url.includes('Ol%C3%A1!%20Tudo%20bem%3F'), 'mensagem codificada: ' + url);
  eq(app.buildWaUrl('5519999991234', 'Oi'), lib.buildWaUrl('5519999991234', 'Oi'), 'app/buildWaUrl igual ao lib');
}

// ---------- mensagemPronta ----------
{
  const sem = app.mensagemPronta('Padaria Pão Dourado', false);
  const com = app.mensagemPronta('Padaria Pão Dourado', true);
  ok(sem.includes('Padaria Pão Dourado'), 'mensagem sem site cita o nome');
  ok(sem.includes('ainda não tem um site'), 'mensagem sem site fala da falta de site');
  ok(com.includes('Padaria Pão Dourado'), 'mensagem com site cita o nome');
  ok(com.includes('Visitei o site'), 'mensagem com site fala da visita');
  ok(sem !== com, 'variantes diferentes');
}

// ---------- distanceKm ----------
{
  const d = lib.distanceKm(-22.725, -47.65, -22.725, -47.641);
  ok(d > 0.8 && d < 1.1, 'distância ~1km: ' + d);
  eq(lib.distanceKm(0, 0, 0, 0), 0, 'mesmo ponto = 0');
}

// ---------- scoreSiteSignals ----------
{
  eq(lib.scoreSiteSignals({ ok: true, https: true, hasViewport: true, hasWhatsAppLink: true, hasTitle: true }).label, 'Boa', 'todos os sinais = Boa');
  eq(lib.scoreSiteSignals({ ok: true, https: true, hasViewport: true, hasWhatsAppLink: true, hasTitle: true }).score, 5, 'score 5');
  eq(lib.scoreSiteSignals({ ok: true, https: true, hasViewport: true, hasWhatsAppLink: false, hasTitle: false }).label, 'Regular', '3 sinais = Regular');
  eq(lib.scoreSiteSignals({ ok: true, https: false, hasViewport: false, hasWhatsAppLink: false, hasTitle: false }).label, 'Fraca', '1 sinal = Fraca');
  const zero = lib.scoreSiteSignals({ ok: false, https: true });
  eq(zero.score, 1, 'fora do ar com https = 1 (só https)');
  eq(zero.label, 'Fraca', 'fora do ar = Fraca');
  eq(lib.scoreSiteSignals({ ok: false }).score, 0, 'nada = 0');
}

// ---------- mapPlace ----------
{
  const center = { lat: -22.725, lng: -47.65 };
  const place = {
    id: 'ChIJabc',
    displayName: { text: 'Pizzaria Teste Real' },
    formattedAddress: 'Rua A, 10 - Piracicaba, SP',
    location: { latitude: -22.72, longitude: -47.64 },
    nationalPhoneNumber: '(19) 3333-4444',
    websiteUri: 'https://pizzariateste.com.br',
    rating: 4.7,
    userRatingCount: 33,
    types: ['pizza_restaurant', 'restaurant', 'food'],
    businessStatus: 'OPERATIONAL'
  };
  const m = lib.mapPlace(place, center, 'pizzaria');
  eq(m.name, 'Pizzaria Teste Real', 'nome mapeado');
  eq(m.category, 'Pizzaria', 'categoria pelo tipo');
  eq(m.hasWebsite, true, 'tem site');
  eq(m.phoneDigits, '551933334444', 'telefone normalizado');
  eq(m.rating, 4.7, 'nota');
  eq(m.userRatingCount, 33, 'nº avaliações');
  eq(m.demo, false, 'não é demo');
  ok(typeof m.distanceKm === 'number' && m.distanceKm > 0 && m.distanceKm < 5, 'distância calculada: ' + m.distanceKm);

  const vazio = lib.mapPlace({ id: 'x', displayName: { text: 'Sem Dados' } }, center, 'barbearia');
  eq(vazio.website, null, 'sem website = null');
  eq(vazio.phone, null, 'sem telefone = null');
  eq(vazio.phoneDigits, null, 'sem dígitos = null');
  eq(vazio.rating, null, 'sem nota = null');
  eq(vazio.distanceKm, null, 'sem localização = null');
  eq(vazio.category, 'barbearia', 'categoria cai no nicho');
  const semCentro = lib.mapPlace(place, null, 'pizzaria');
  eq(semCentro.distanceKm, null, 'sem centro = distância null');
}

// ---------- filterByRadius ----------
{
  const lista = [
    { name: 'Perto', distanceKm: 1.2 },
    { name: 'No limite', distanceKm: 10 },
    { name: 'Longe', distanceKm: 52.4 },
    { name: 'Sem distância', distanceKm: null }
  ];
  const dentro = lib.filterByRadius(lista, 10);
  eq(dentro.length, 3, 'raio 10km: fora só o de 52,4km');
  ok(dentro.every((r) => r.name !== 'Longe'), 'lugar fora do raio sai da lista');
  ok(dentro.some((r) => r.name === 'Sem distância'), 'sem distância é mantido');
  eq(lib.filterByRadius(lista, 100).length, 4, 'raio 100km mantém todos');
}

// ---------- validateSearch ----------
{
  ok(!lib.validateSearch({ nicho: '', raioKm: 10, local: 'Piracicaba, SP' }).ok, 'nicho vazio rejeitado');
  ok(!lib.validateSearch({ nicho: 'pizza', raioKm: 0, local: 'Piracicaba, SP' }).ok, 'raio 0 rejeitado');
  ok(!lib.validateSearch({ nicho: 'pizza', raioKm: 101, local: 'Piracicaba, SP' }).ok, 'raio 101 rejeitado');
  ok(!lib.validateSearch({ nicho: 'pizza', raioKm: 10, local: '' }).ok, 'cidade vazia rejeitada');
  ok(!lib.validateSearch({ nicho: 'pizza', raioKm: 'dez', local: 'Piracicaba, SP' }).ok, 'raio não numérico rejeitado');
  const v = lib.validateSearch({ nicho: '  pizzaria ', raioKm: '25', local: ' Piracicaba, SP ' });
  ok(v.ok && v.nicho === 'pizzaria' && v.raioKm === 25 && v.local === 'Piracicaba, SP', 'entrada válida com trim');
}

// ---------- demoResults ----------
{
  eq(lib.DEMO_BUSINESSES.length, 6, '6 negócios demo');
  ok(lib.DEMO_BUSINESSES.every((b) => b.demo === true), 'todos demo=true');
  ok(lib.DEMO_BUSINESSES.every((b) => /exemplo|demonstra|fict|teste|modelo|amostra/i.test(b.name)), 'nomes obviamente fictícios');
  const filtrados = lib.demoResults('pizzaria');
  ok(filtrados.length >= 1 && filtrados[0].name.includes('Pizzaria'), 'demo filtra pelo nicho');
  eq(lib.demoResults('nichoquenaoexiste').length, 6, 'nicho sem match devolve todos os 6');
  eq(app.DEMO_FALLBACK.length, 6, 'fallback do frontend tem 6');
  eq(JSON.stringify(app.DEMO_FALLBACK.map((b) => b.id)), JSON.stringify(lib.DEMO_BUSINESSES.map((b) => b.id)), 'fallback do frontend = mesmos ids do backend');
}

// ---------- Handlers com fetch mockado (sem rede) ----------
function mockReq(body, url, method) {
  const json = JSON.stringify(body);
  return {
    method: method || 'POST',
    url: url || '/api/search',
    on(event, cb) {
      if (event === 'data') cb(Buffer.from(json));
      if (event === 'end') cb();
    }
  };
}
function mockRes() {
  return {
    statusCode: 0,
    body: '',
    writeHead(s) { this.statusCode = s; },
    end(b) { this.body = b; }
  };
}

async function testSearchHandler() {
  const searchHandler = require('../api/search');
  const realFetch = global.fetch;

  // Sem chave → OSM (Nominatim + Overpass mockados): dados reais,
  // fonte osm, sem demonstração.
  delete process.env.GOOGLE_PLACES_API_KEY;
  const osmNode = {
    type: 'node', id: 123456, lat: -22.72, lon: -47.64,
    tags: {
      name: 'Pizzaria do Bairro', amenity: 'restaurant', cuisine: 'pizza',
      'addr:street': 'Rua A', 'addr:housenumber': '10',
      'addr:suburb': 'Centro', 'addr:city': 'Piracicaba', 'addr:state': 'SP',
      phone: '+55 19 3333-4444', website: 'https://pizzariadobairro.com.br'
    }
  };
  {
    global.fetch = async (url) => {
      if (String(url).includes('nominatim.openstreetmap.org')) {
        return { ok: true, status: 200, json: async () => [{ lat: '-22.725', lon: '-47.65', display_name: 'Piracicaba' }] };
      }
      if (String(url).includes('overpass-api.de')) {
        return { ok: true, status: 200, json: async () => ({ elements: [osmNode] }) };
      }
      throw new Error('url inesperada: ' + url);
    };
    try {
      const req = mockReq({ nicho: 'pizzaria', raioKm: 10, local: 'Piracicaba, SP' });
      const res = mockRes();
      await searchHandler(req, res);
      const data = JSON.parse(res.body);
      eq(res.statusCode, 200, 'osm status 200');
      eq(data.demo, false, 'sem chave = dados reais (osm), não demo');
      eq(data.source, 'osm', 'fonte osm');
      eq(data.results.length, 1, '1 resultado osm mapeado');
      eq(data.results[0].name, 'Pizzaria do Bairro', 'nome osm mapeado');
      eq(data.results[0].phoneDigits, '551933334444', 'telefone osm normalizado');
      eq(data.results[0].rating, null, 'osm não tem nota');
      eq(data.results[0].source, 'osm', 'resultado marcado osm');
    } finally {
      global.fetch = realFetch;
    }
  }
  // ?demo=1 sem chave → demonstração (só com a flag explícita).
  {
    const req = mockReq({ nicho: 'pizzaria', raioKm: 10, local: 'Piracicaba, SP' }, '/api/search?demo=1');
    const res = mockRes();
    await searchHandler(req, res);
    const data = JSON.parse(res.body);
    eq(res.statusCode, 200, 'demo status 200');
    eq(data.demo, true, '?demo=1 = demo');
    eq(data.source, 'demo', 'fonte demo');
    eq(data.results.length, 1, 'demo filtra pelo nicho (pizzaria = 1)');
    eq(data.results[0].name, 'Pizzaria Exemplo', 'demo devolve o negócio do nicho');
  }
  // Geocoding sem resultado → erro 502, sem buscar cidade errada.
  {
    global.fetch = async (url) => {
      if (String(url).includes('nominatim.openstreetmap.org')) {
        return { ok: true, status: 200, json: async () => [] };
      }
      throw new Error('overpass não deveria ser chamado');
    };
    try {
      const req = mockReq({ nicho: 'pizzaria', raioKm: 10, local: 'Cidade Inexistente, SP' });
      const res = mockRes();
      await searchHandler(req, res);
      eq(res.statusCode, 502, 'cidade não encontrada = 502');
      const data = JSON.parse(res.body);
      ok(data.message && data.message.indexOf('Cidade Inexistente') !== -1, 'mensagem cita a cidade: ' + data.message);
    } finally {
      global.fetch = realFetch;
    }
  }
  // Overpass fora → 502 com mensagem em linguagem simples.
  {
    global.fetch = async (url) => {
      if (String(url).includes('nominatim.openstreetmap.org')) {
        return { ok: true, status: 200, json: async () => [{ lat: '-22.725', lon: '-47.65' }] };
      }
      return { ok: false, status: 504, json: async () => ({}) };
    };
    try {
      const req = mockReq({ nicho: 'pizzaria', raioKm: 10, local: 'Outra Cidade, SP' });
      const res = mockRes();
      await searchHandler(req, res);
      eq(res.statusCode, 502, 'overpass 504 = 502');
      const data = JSON.parse(res.body);
      ok(data.message && data.message.indexOf('mapa grátis') !== -1, 'mensagem fala do mapa grátis: ' + data.message);
    } finally {
      global.fetch = realFetch;
    }
  }
  // Validação
  {
    const req = mockReq({ nicho: '', raioKm: 10, local: 'Piracicaba, SP' });
    const res = mockRes();
    await searchHandler(req, res);
    eq(res.statusCode, 400, 'nicho vazio = 400');
  }

  // Com chave + fetch mockado → mapeia resposta do Places
  process.env.GOOGLE_PLACES_API_KEY = 'chave-de-teste';
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push(String(url));
    if (String(url).includes('maps.googleapis.com')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ results: [{ geometry: { location: { lat: -22.725, lng: -47.65 } } }] }) };
    }
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({
        places: [{
          id: 'ChIJ1',
          displayName: { text: 'Pizzaria Teste Real' },
          formattedAddress: 'Rua A, 10 - Piracicaba, SP',
          location: { latitude: -22.72, longitude: -47.64 },
          nationalPhoneNumber: '(19) 3333-4444',
          websiteUri: 'https://pizzariateste.com.br',
          rating: 4.7,
          userRatingCount: 33,
          types: ['pizza_restaurant'],
          businessStatus: 'OPERATIONAL'
        }]
      })
    };
  };
  try {
    const req = mockReq({ nicho: 'pizzaria', raioKm: 10, local: 'Piracicaba, SP' });
    const res = mockRes();
    await searchHandler(req, res);
    const data = JSON.parse(res.body);
    eq(res.statusCode, 200, 'busca real status 200');
    eq(data.demo, false, 'com chave = real');
    eq(data.results.length, 1, '1 resultado mapeado');
    eq(data.results[0].name, 'Pizzaria Teste Real', 'nome mapeado no handler');
    eq(data.results[0].phoneDigits, '551933334444', 'telefone mapeado no handler');
    ok(calls.some((u) => u.includes('searchText')), 'chamou o Places searchText');

    // Raio de verdade: o Google pode devolver lugar fora do círculo
    // (locationBias é viés) — o handler tem que cortar pelo raio.
    global.fetch = async (url) => {
      if (String(url).includes('maps.googleapis.com')) {
        const geo = JSON.stringify({ results: [{ geometry: { location: { lat: -22.725, lng: -47.65 } } }] });
        return { ok: true, status: 200, json: async () => JSON.parse(geo), text: async () => geo };
      }
      const perto = {
        id: 'ChIJ1', displayName: { text: 'Pizzaria Perto' }, formattedAddress: 'Rua A, 10 - Piracicaba, SP',
        location: { latitude: -22.72, longitude: -47.64 }, types: ['pizza_restaurant'], businessStatus: 'OPERATIONAL'
      };
      const longe = {
        id: 'ChIJ2', displayName: { text: 'Pizzaria Longe' }, formattedAddress: 'Outra cidade, SP',
        location: { latitude: -23.2, longitude: -47.65 }, types: ['pizza_restaurant'], businessStatus: 'OPERATIONAL'
      };
      return { ok: true, status: 200, text: async () => JSON.stringify({ places: [perto, longe] }) };
    };
    {
      const req = mockReq({ nicho: 'pizzaria', raioKm: 10, local: 'Piracicaba, SP' });
      const res = mockRes();
      await searchHandler(req, res);
      const data = JSON.parse(res.body);
      eq(data.results.length, 1, 'raio 10km: só a pizzaria perto volta');
      eq(data.results[0].name, 'Pizzaria Perto', 'a de fora do raio foi cortada');
    }
  } finally {
    global.fetch = realFetch;
    delete process.env.GOOGLE_PLACES_API_KEY;
  }
}

async function testCheckSiteHandler() {
  const checkHandler = require('../api/check-site');
  const realFetch = global.fetch;

  // URL inválida / esquema
  {
    const req = mockReq({ url: 'ftp://exemplo.com' });
    const res = mockRes();
    await checkHandler(req, res);
    eq(res.statusCode, 400, 'ftp rejeitado');
  }
  {
    const req = mockReq({ url: '' });
    const res = mockRes();
    await checkHandler(req, res);
    eq(res.statusCode, 400, 'url vazia = 400');
  }

  const htmlCheio = '<html><head><title>Site Teste</title><meta name="viewport" content="width=device-width"></head>' +
    '<body><a href="https://wa.me/5519999999999">zap</a></body></html>';
  const htmlFraco = '<html><head></head><body>oi</body></html>';

  function stubFetch(mapper) {
    global.fetch = async (url) => {
      const r = mapper(String(url));
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/html' : r.location && n.toLowerCase() === 'location' ? r.location : null) },
        body: undefined,
        text: async () => r.html || ''
      };
    };
  }

  try {
    // Site completo https → Boa
    stubFetch(() => ({ status: 200, html: htmlCheio }));
    {
      const req = mockReq({ url: 'https://siteteste.com.br' });
      const res = mockRes();
      await checkHandler(req, res);
      const data = JSON.parse(res.body);
      eq(res.statusCode, 200, 'check status 200');
      eq(data.label, 'Boa', 'site completo = Boa');
      eq(data.score, 5, 'score 5');
      eq(data.https, true, 'https detectado');
      eq(data.hasWhatsAppLink, true, 'link wa detectado');
    }
    // Site fraco http → Fraca
    stubFetch(() => ({ status: 200, html: htmlFraco }));
    {
      const req = mockReq({ url: 'http://sitefraco.com.br' });
      const res = mockRes();
      await checkHandler(req, res);
      const data = JSON.parse(res.body);
      eq(data.label, 'Fraca', 'site fraco = Fraca');
      eq(data.score, 1, 'score 1 (só acessível)');
      eq(data.https, false, 'http não é https');
    }
    // Redirect 301 → segue e avalia o destino
    let nCalls = 0;
    global.fetch = async (url) => {
      nCalls++;
      if (nCalls === 1) {
        return { ok: false, status: 301, headers: { get: (n) => (n.toLowerCase() === 'location' ? 'https://destino.com.br/' : null) }, body: undefined, text: async () => '' };
      }
      return { ok: true, status: 200, headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/html' : null) }, body: undefined, text: async () => htmlCheio };
    };
    {
      const req = mockReq({ url: 'http://curto.com.br/x' });
      const res = mockRes();
      await checkHandler(req, res);
      const data = JSON.parse(res.body);
      eq(nCalls, 2, 'seguiu 1 redirect');
      eq(data.label, 'Boa', 'destino avaliado após redirect');
    }
    // Site fora do ar → ok:false, Fraca
    global.fetch = async () => { throw new Error('timeout'); };
    {
      const req = mockReq({ url: 'https://foradoar.com.br' });
      const res = mockRes();
      await checkHandler(req, res);
      const data = JSON.parse(res.body);
      eq(data.ok, false, 'fora do ar = ok false');
      eq(data.label, 'Fraca', 'fora do ar = Fraca');
    }
  } finally {
    global.fetch = realFetch;
  }
}

async function testOsm() {
  const osm = require('../api/osm');

  // ---------- tagsForNicho ----------
  const nicheCases = [
    ['pizzaria', 'Pizzaria'],
    ['PIZZARIA', 'Pizzaria'],
    ['salão de beleza', 'Salão de beleza'],
    ['salao de beleza', 'Salão de beleza'],
    ['barbearia', 'Barbearia'],
    ['academia', 'Academia'],
    ['restaurante', 'Restaurante'],
    ['pet shop', 'Pet shop'],
    ['petshop', 'Pet shop'],
    ['farmácia', 'Farmácia'],
    ['padaria', 'Padaria'],
    ['mercado', 'Mercado'],
    ['supermercado', 'Mercado'],
    ['café', 'Café'],
    ['lanchonete', 'Lanchonete'],
    ['barbearia masculina', 'Barbearia']
  ];
  for (const [input, label] of nicheCases) {
    const t = osm.tagsForNicho(input);
    eq(t.label, label, 'tagsForNicho(' + input + ')');
    ok(t.filters.length >= 1, 'tem filtros: ' + input);
  }
  const desconhecido = osm.tagsForNicho('encanador');
  eq(desconhecido.label, null, 'nicho desconhecido sem rótulo');
  eq(desconhecido.filters.length, 0, 'nicho desconhecido sem filtros');
  const pz = osm.tagsForNicho('pizzaria').filters;
  ok(pz.some((f) => f.amenity === 'restaurant' && f.cuisine === 'pizza'), 'pizza: restaurante');
  ok(pz.some((f) => f.amenity === 'fast_food' && f.cuisine === 'pizza'), 'pizza: fast_food');
  const bb = osm.tagsForNicho('barbearia').filters;
  ok(bb.some((f) => f.shop === 'barber'), 'barbearia: shop=barber');
  ok(bb.some((f) => f.shop === 'hairdresser' && f.barber === 'yes'), 'barbearia: hairdresser+barber');

  // ---------- escapeOverpassRegex ----------
  eq(osm.escapeOverpassRegex('pizza'), 'pizza', 'texto simples intacto');
  eq(osm.escapeOverpassRegex('pizza (calabresa)'), 'pizza \\(calabresa\\)', 'parênteses escapados');
  eq(osm.escapeOverpassRegex('a+b*c?d'), 'a\\+b\\*c\\?d', 'operadores escapados');
  eq(osm.escapeOverpassRegex('a"b\nc'), 'abc', 'aspas e quebra removidas');
  eq(osm.escapeOverpassRegex('pão [doce]'), 'pão \\[doce\\]', 'colchetes escapados');

  // ---------- buildTagQuery / buildNameQuery ----------
  {
    const q = osm.buildTagQuery('pizzaria', -22.725, -47.65, 10000);
    ok(q.indexOf('[out:json][timeout:25];') !== -1, 'timeout 25');
    ok(q.indexOf('out center 60;') !== -1, 'out center 60');
    ok(q.indexOf('around:10000,-22.725,-47.65') !== -1, 'around com raio e centro');
    ok(q.indexOf('["amenity"="restaurant"]["cuisine"="pizza"]') !== -1, 'filtro pizza restaurante');
    ok(q.indexOf('["name"~') === -1, 'consulta de etiquetas sem regex de nome');
    eq(osm.buildTagQuery('encanador', -22.725, -47.65, 5000), null, 'nicho desconhecido: sem consulta de etiquetas');
    const nq = osm.buildNameQuery('encanador', -22.725, -47.65, 5000);
    ok(nq.indexOf('["name"~"encanador",i]') !== -1, 'nicho desconhecido: só nome');
    ok(nq.indexOf('["amenity"') === -1, 'consulta de nome sem filtro de etiqueta');
    const nq2 = osm.buildNameQuery('pizza (calabresa)', -22.725, -47.65, 5000);
    ok(nq2.indexOf('pizza \\(calabresa\\)') !== -1, 'regex do usuário escapada na query');
    ok(nq2.indexOf('pizza (calabresa)') === -1, 'sem parêntese cru na query');
    eq(osm.buildNameQuery('', -22.725, -47.65, 5000), null, 'nicho vazio: sem consulta de nome');
  }

  // ---------- mapOsmElements ----------
  {
    const center = { lat: -22.725, lng: -47.65 };
    const node = {
      type: 'node', id: 123456, lat: -22.72, lon: -47.64,
      tags: {
        name: 'Pizzaria do Bairro', amenity: 'restaurant', cuisine: 'pizza',
        'addr:street': 'Rua A', 'addr:housenumber': '10',
        'addr:suburb': 'Centro', 'addr:city': 'Piracicaba', 'addr:state': 'SP',
        phone: '+55 19 3333-4444', website: 'https://pizzariadobairro.com.br'
      }
    };
    const way = {
      type: 'way', id: 999,
      center: { lat: -22.73, lon: -47.66 },
      tags: {
        name: 'Academia Forte', leisure: 'fitness_centre',
        'contact:phone': '(19) 98888-7777', 'contact:website': 'https://academiaforte.com.br',
        'addr:street': 'Av. B', 'addr:city': 'Piracicaba'
      }
    };
    const semNome = { type: 'node', id: 5, lat: -22.72, lon: -47.64, tags: { amenity: 'restaurant' } };
    const duplicado = {
      type: 'node', id: 777, lat: -22.72, lon: -47.64,
      tags: {
        name: 'Pizzaria do Bairro', amenity: 'restaurant', cuisine: 'pizza',
        'addr:street': 'Rua A', 'addr:housenumber': '10',
        'addr:suburb': 'Centro', 'addr:city': 'Piracicaba', 'addr:state': 'SP',
        phone: '+55 19 3333-4444', website: 'https://pizzariadobairro.com.br'
      }
    };
    const lista = osm.mapOsmElements([node, way, semNome, duplicado], center, 'pizzaria');
    eq(lista.length, 2, 'sem nome sai, duplicado sai: ' + lista.length);
    const p = lista[0];
    eq(p.name, 'Pizzaria do Bairro', 'nome osm');
    eq(p.category, 'Pizzaria', 'categoria pela cuisine');
    eq(p.address, 'Rua A, 10 - Centro - Piracicaba, SP', 'endereço composto: ' + p.address);
    eq(p.phoneDigits, '551933334444', 'telefone osm normalizado');
    eq(p.website, 'https://pizzariadobairro.com.br', 'site osm');
    eq(p.hasWebsite, true, 'tem site');
    eq(p.rating, null, 'sem nota');
    eq(p.userRatingCount, null, 'sem contagem');
    eq(p.source, 'osm', 'fonte osm');
    eq(p.demo, false, 'não é demo');
    ok(typeof p.distanceKm === 'number' && p.distanceKm > 0, 'distância osm: ' + p.distanceKm);
    const a = lista[1];
    eq(a.category, 'Academia', 'way: categoria pela etiqueta');
    eq(a.phoneDigits, '5519988887777', 'contact:phone');
    eq(a.website, 'https://academiaforte.com.br', 'contact:website');
    ok(typeof a.distanceKm === 'number', 'way usa center');
    const multi = osm.mapOsmElements([
      { type: 'node', id: 1, lat: -22.72, lon: -47.64, tags: { name: 'Loja X', phone: '+55 19 1111-2222; +55 19 3333-4444' } }
    ], center, 'loja');
    eq(multi[0].phoneDigits, '551911112222', 'primeiro telefone da lista separada por ;');
    // Sem coordenadas no elemento: distância null, mas o resultado fica.
    const semCoord = osm.mapOsmElements([
      { type: 'relation', id: 2, tags: { name: 'Loja Y' } }
    ], center, 'loja');
    eq(semCoord.length, 1, 'sem coordenada fica na lista');
    eq(semCoord[0].distanceKm, null, 'sem coordenada = distância null');
  }

  // ---------- geocodeCity: cache por cidade ----------
  {
    let chamadas = 0;
    const fakeFetch = async () => {
      chamadas++;
      return { ok: true, status: 200, json: async () => [{ lat: '1', lon: '2' }] };
    };
    const c1 = await osm.geocodeCity('Cidade Cache, SP', fakeFetch);
    const c2 = await osm.geocodeCity('Cidade Cache, SP', fakeFetch);
    eq(chamadas, 1, 'geocode em cache: 1 chamada');
    eq(c1.lat, 1, 'lat do cache');
    eq(c2.lng, 2, 'lng do cache');
  }
  // ---------- geocodeCity: serviço fora → erro ----------
  {
    const fakeFetch = async () => { throw new Error('rede caiu'); };
    let erro = null;
    try {
      await osm.geocodeCity('Cidade Falha, SP', fakeFetch);
    } catch (e) { erro = e; }
    ok(erro && erro.message.indexOf('mapa grátis') !== -1, 'geocode fora = erro em linguagem simples');
  }
  // ---------- searchOsm: fallback por nome só quando a consulta de etiquetas volta vazia ----------
  {
    const node = { type: 'node', id: 42, lat: -22.72, lon: -47.64, tags: { name: 'Pizzaria Fallback', amenity: 'restaurant', cuisine: 'pizza' } };
    let overpassCalls = 0;
    const fakeFetch = async (url, opts) => {
      if (String(url).includes('nominatim.openstreetmap.org')) {
        return { ok: true, status: 200, json: async () => [{ lat: '-22.725', lon: '-47.65' }] };
      }
      overpassCalls++;
      // 1ª chamada (etiquetas) volta vazia; 2ª (nome) volta o negócio.
      const elements = overpassCalls === 1 ? [] : [node];
      return { ok: true, status: 200, json: async () => ({ elements }) };
    };
    const r = await osm.searchOsm({ nicho: 'pizzaria', raioKm: 10, local: 'Cidade Fallback, SP' }, fakeFetch);
    eq(overpassCalls, 2, 'etiquetas vazias → fallback por nome roda');
    eq(r.results.length, 1, 'fallback achou o negócio');
    eq(r.results[0].name, 'Pizzaria Fallback', 'nome do fallback');
  }
  {
    // Etiquetas com resultado → a consulta por nome nem roda.
    const node = { type: 'node', id: 43, lat: -22.72, lon: -47.64, tags: { name: 'Pizzaria Direta', amenity: 'restaurant', cuisine: 'pizza' } };
    let overpassCalls = 0;
    const fakeFetch = async (url) => {
      if (String(url).includes('nominatim.openstreetmap.org')) {
        return { ok: true, status: 200, json: async () => [{ lat: '-22.725', lon: '-47.65' }] };
      }
      overpassCalls++;
      return { ok: true, status: 200, json: async () => ({ elements: [node] }) };
    };
    const r = await osm.searchOsm({ nicho: 'pizzaria', raioKm: 10, local: 'Cidade Direta, SP' }, fakeFetch);
    eq(overpassCalls, 1, 'etiquetas com resultado → sem consulta por nome');
    eq(r.results.length, 1, 'resultado direto');
  }
  // ---------- Overpass: fallback por espelho ----------
  // 1º espelho estoura o tempo → 2º responde e a busca retorna.
  {
    const node = { type: 'node', id: 44, lat: -22.72, lon: -47.64, tags: { name: 'Pizzaria Espelho', amenity: 'restaurant', cuisine: 'pizza' } };
    const hitUrls = [];
    const fakeFetch = async (url) => {
      if (String(url).includes('nominatim.openstreetmap.org')) {
        return { ok: true, status: 200, json: async () => [{ lat: '-22.725', lon: '-47.65' }] };
      }
      hitUrls.push(String(url));
      if (String(url).includes('overpass-api.de')) throw new Error('timeout do espelho principal');
      return { ok: true, status: 200, json: async () => ({ elements: [node] }) };
    };
    const r = await osm.searchOsm({ nicho: 'pizzaria', raioKm: 10, local: 'Cidade Espelho, SP' }, fakeFetch);
    eq(hitUrls.length, 2, '1º espelho falhou → 2º tentado');
    ok(hitUrls[0].indexOf('overpass-api.de') !== -1, '1ª tentativa no espelho principal');
    ok(hitUrls[1].indexOf('overpass.private.coffee') !== -1, '2ª tentativa no espelho reserva');
    eq(r.results.length, 1, 'espelho reserva achou o negócio');
    eq(r.results[0].name, 'Pizzaria Espelho', 'nome do espelho reserva');
  }
  // 1º espelho responde → só 1 chamada, sem tocar no reserva.
  {
    const node = { type: 'node', id: 45, lat: -22.72, lon: -47.64, tags: { name: 'Pizzaria Principal', amenity: 'restaurant', cuisine: 'pizza' } };
    const hitUrls = [];
    const fakeFetch = async (url) => {
      if (String(url).includes('nominatim.openstreetmap.org')) {
        return { ok: true, status: 200, json: async () => [{ lat: '-22.725', lon: '-47.65' }] };
      }
      hitUrls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ elements: [node] }) };
    };
    const r = await osm.searchOsm({ nicho: 'pizzaria', raioKm: 10, local: 'Cidade Principal, SP' }, fakeFetch);
    eq(hitUrls.length, 1, '1º espelho respondeu → só 1 chamada');
    eq(r.results.length, 1, 'resultado do espelho principal');
  }
  // Todos os espelhos falham → erro em linguagem simples, sem resultado.
  {
    const fakeFetch = async (url) => {
      if (String(url).includes('nominatim.openstreetmap.org')) {
        return { ok: true, status: 200, json: async () => [{ lat: '-22.725', lon: '-47.65' }] };
      }
      throw new Error('todos os espelhos fora');
    };
    let erro = null;
    try {
      await osm.searchOsm({ nicho: 'pizzaria', raioKm: 10, local: 'Cidade Sem Espelho, SP' }, fakeFetch);
    } catch (e) { erro = e; }
    ok(erro && erro.message.indexOf('mapa grátis') !== -1, 'todos os espelhos fora = erro do mapa grátis: ' + (erro && erro.message));
  }
}

async function testConfigHandler() {
  const configHandler = require('../api/config');
  function mockGetReq() {
    return { method: 'GET', url: '/api/config', on() {} };
  }
  delete process.env.GOOGLE_PLACES_API_KEY;
  {
    const res = mockRes();
    await configHandler(mockGetReq(), res);
    const data = JSON.parse(res.body);
    eq(data.source, 'osm', 'sem chave = fonte osm');
    eq(data.placesConfigured, false, 'sem chave = placesConfigured false');
  }
  process.env.GOOGLE_PLACES_API_KEY = 'chave-de-teste';
  {
    const res = mockRes();
    await configHandler(mockGetReq(), res);
    const data = JSON.parse(res.body);
    eq(data.source, 'google', 'com chave = fonte google');
    eq(data.placesConfigured, true, 'com chave = placesConfigured true');
  }
  delete process.env.GOOGLE_PLACES_API_KEY;
  {
    const res = mockRes();
    await configHandler({ method: 'POST', url: '/api/config', on() {} }, res);
    eq(res.statusCode, 405, 'config POST = 405');
  }
}

// ---------- styles.css: [hidden] tem que vencer display:flex ----------
// (sem esta regra o painel do WhatsApp aparecia sozinho e o X não fechava)
{
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  ok(/\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css), 'styles.css tem regra [hidden]{display:none!important}');
}

(async () => {
  await testSearchHandler();
  await testCheckSiteHandler();
  await testOsm();
  await testConfigHandler();
  console.log('test-prospeccao: ' + passed + ' asserts PASS');
})().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});
