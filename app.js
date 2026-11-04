'use strict';

// Frontend da prospecção (vanilla, zero dependências).
// As funções puras abaixo (normalizePhone/buildWaUrl) são CÓPIAS com
// lógica idêntica às de api/_lib.js — os testes cobrem as duas.

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

function mensagemPronta(nome, temSite) {
  if (temSite) {
    return 'Olá! Sou o Luis, crio sites e sistemas para comércios de Piracicaba e região. ' +
      'Visitei o site da ' + nome + ' e vi alguns pontos que podem melhorar para trazer mais clientes pelo celular. ' +
      'Quer que eu mostre uma sugestão rápida, sem compromisso?';
  }
  return 'Olá! Sou o Luis, crio sites e sistemas para comércios de Piracicaba e região. ' +
    'Vi que a ' + nome + ' ainda não tem um site e queria mostrar como uma página profissional pode trazer mais clientes — ' +
    'com serviços, botão de WhatsApp e localização no mapa. Posso te mandar um exemplo? Sem compromisso.';
}

// Mesma lista de demonstração do backend — usada SÓ com ?demo=1
// explícito na URL (fora do fluxo padrão). Nunca é dado real.
const DEMO_FALLBACK = [
  { id: 'demo-1', name: 'Pizzaria Exemplo', category: 'Pizzaria', address: 'Rua de Exemplo, 123 - Centro, Cidade de Demonstração, SP', distanceKm: 1.2, rating: 4.5, userRatingCount: 120, phone: '(19) 99999-0001', phoneDigits: '5519999990001', website: 'https://exemplo.com.br', hasWebsite: true, businessStatus: 'OPERATIONAL', demo: true },
  { id: 'demo-2', name: 'Barbearia Demonstração', category: 'Barbearia', address: 'Av. Fictícia, 456 - Bairro Modelo, Cidade de Demonstração, SP', distanceKm: 2.4, rating: 4.8, userRatingCount: 87, phone: '(19) 99999-0002', phoneDigits: '5519999990002', website: null, hasWebsite: false, businessStatus: 'OPERATIONAL', demo: true },
  { id: 'demo-3', name: 'Salão de Beleza Fictício', category: 'Salão de beleza', address: 'Rua das Amostras, 789 - Jardim Teste, Cidade de Demonstração, SP', distanceKm: 3.1, rating: 4.2, userRatingCount: 54, phone: '(19) 99999-0003', phoneDigits: '5519999990003', website: 'https://exemplo.com.br', hasWebsite: true, businessStatus: 'OPERATIONAL', demo: true },
  { id: 'demo-4', name: 'Academia Teste', category: 'Academia', address: 'Rua Ilustrativa, 101 - Vila Simulação, Cidade de Demonstração, SP', distanceKm: 4.7, rating: 3.9, userRatingCount: 203, phone: null, phoneDigits: null, website: null, hasWebsite: false, businessStatus: 'OPERATIONAL', demo: true },
  { id: 'demo-5', name: 'Restaurante Modelo', category: 'Restaurante', address: 'Praça de Mentira, 202 - Centro, Cidade de Demonstração, SP', distanceKm: 5.9, rating: 4.6, userRatingCount: 311, phone: '(19) 99999-0005', phoneDigits: '5519999990005', website: 'https://exemplo.com.br', hasWebsite: true, businessStatus: 'OPERATIONAL', demo: true },
  { id: 'demo-6', name: 'Pet Shop Amostra', category: 'Pet shop', address: 'Alameda Falsa, 303 - Parque Exemplo, Cidade de Demonstração, SP', distanceKm: 7.3, rating: 4.9, userRatingCount: 42, phone: '(19) 99999-0006', phoneDigits: '5519999990006', website: null, hasWebsite: false, businessStatus: 'OPERATIONAL', demo: true }
];

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizePhone, buildWaUrl, mensagemPronta, DEMO_FALLBACK, escapeHtml };
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

function init() {
  const $ = (id) => document.getElementById(id);
  const els = {
    banner: $('banner'),
    nicho: $('nicho'),
    raio: $('raio'),
    local: $('local'),
    btnBuscar: $('btnBuscar'),
    statusBusca: $('statusBusca'),
    toolbar: $('toolbar'),
    contador: $('contador'),
    resultados: $('resultados'),
    ordem: $('ordem'),
    painelFundo: $('painelFundo'),
    painelFechar: $('painelFechar'),
    painelNegocio: $('painelNegocio'),
    mensagem: $('mensagem'),
    painelAviso: $('painelAviso'),
    btnAbrirWhats: $('btnAbrirWhats')
  };

  const CONTATADOS_KEY = 'prospeccao_contatados_v1';
  let demoMode = false;
  let fonteAtual = 'osm'; // 'google' | 'osm' | 'demo'
  // Demonstração só com ?demo=1 explícito na URL (fora do fluxo padrão).
  const DEMO_FLAG = typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('demo') === '1';
  let resultados = [];
  let filtro = 'todos';
  let painelNegocioAtual = null;
  let varianteAtual = 'sem-site';
  const avaliacoes = {}; // id -> {score, label} | 'erro'

  let contatados = new Set();
  try {
    const salvo = JSON.parse(localStorage.getItem(CONTATADOS_KEY) || '[]');
    if (Array.isArray(salvo)) contatados = new Set(salvo);
  } catch (e) { contatados = new Set(); }

  function salvarContatados() {
    try { localStorage.setItem(CONTATADOS_KEY, JSON.stringify(Array.from(contatados))); }
    catch (e) { /* armazenamento indisponível: segue sem persistir */ }
  }

  function mostrarBanner(texto, ok) {
    els.banner.hidden = false;
    els.banner.textContent = texto;
    els.banner.classList.toggle('ok', !!ok);
  }

  // Descobre qual fonte de dados está ativa. Sem chave, a fonte é o
  // mapa grátis (OpenStreetMap) — dados reais, sem demonstração.
  fetch('/api/config').then((r) => r.json()).then((cfg) => {
    if (cfg && cfg.source === 'google') {
      fonteAtual = 'google';
      mostrarBanner('Busca real ativa — dados do Google Places.', true);
      demoMode = false;
    } else if (cfg && cfg.source === 'osm') {
      fonteAtual = 'osm';
      mostrarBanner('Fonte: mapa grátis (OpenStreetMap) — pode mostrar menos negócios e sem nota; ative a chave do Google para mais resultados.', false);
    } else if (DEMO_FLAG) {
      fonteAtual = 'demo';
      demoMode = true;
      mostrarBanner('Modo demonstração (?demo=1) — negócios fictícios, só para testar a interface.', false);
    } else {
      mostrarBanner('Sem conexão com o servidor — publique o sistema para buscar negócios de verdade.', false);
    }
  }).catch(() => {
    if (DEMO_FLAG) {
      fonteAtual = 'demo';
      demoMode = true;
      mostrarBanner('Sem conexão com o servidor — mostrando demonstração (?demo=1).', false);
    } else {
      mostrarBanner('Sem conexão com o servidor — publique o sistema para buscar negócios de verdade.', false);
    }
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      els.nicho.value = chip.getAttribute('data-nicho') || '';
      els.nicho.focus();
    });
  });

  document.querySelectorAll('.filtro').forEach((btn) => {
    btn.addEventListener('click', () => {
      filtro = btn.getAttribute('data-filtro') || 'todos';
      document.querySelectorAll('.filtro').forEach((b) => b.classList.toggle('ativo', b === btn));
      render();
    });
  });

  els.ordem.addEventListener('change', render);
  els.btnBuscar.addEventListener('click', buscar);
  els.nicho.addEventListener('keydown', (e) => { if (e.key === 'Enter') buscar(); });
  els.local.addEventListener('keydown', (e) => { if (e.key === 'Enter') buscar(); });

  els.painelFechar.addEventListener('click', fecharPainel);
  els.painelFundo.addEventListener('click', (e) => { if (e.target === els.painelFundo) fecharPainel(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharPainel(); });

  document.querySelectorAll('.variante').forEach((btn) => {
    btn.addEventListener('click', () => {
      varianteAtual = btn.getAttribute('data-variante') || 'sem-site';
      document.querySelectorAll('.variante').forEach((b) => b.classList.toggle('ativo', b === btn));
      if (painelNegocioAtual) {
        els.mensagem.value = mensagemPronta(painelNegocioAtual.name, varianteAtual === 'com-site');
        atualizarLinkWhats();
      }
    });
  });

  els.mensagem.addEventListener('input', atualizarLinkWhats);

  function atualizarLinkWhats() {
    if (!painelNegocioAtual) return;
    const digits = normalizePhone(painelNegocioAtual.phone);
    if (!digits) {
      els.btnAbrirWhats.removeAttribute('href');
      els.btnAbrirWhats.style.opacity = '0.55';
      return;
    }
    els.btnAbrirWhats.style.opacity = '';
    els.btnAbrirWhats.href = buildWaUrl(digits, els.mensagem.value);
  }

  function abrirPainel(negocio) {
    painelNegocioAtual = negocio;
    varianteAtual = negocio.hasWebsite ? 'com-site' : 'sem-site';
    document.querySelectorAll('.variante').forEach((b) => {
      b.classList.toggle('ativo', b.getAttribute('data-variante') === varianteAtual);
    });
    els.painelNegocio.textContent = negocio.name + (negocio.phone ? ' — ' + negocio.phone : '');
    els.mensagem.value = mensagemPronta(negocio.name, negocio.hasWebsite);
    if (negocio.phoneDigits) {
      els.painelAviso.textContent = '';
    } else {
      els.painelAviso.textContent = 'Este negócio não tem telefone cadastrado — o botão do WhatsApp fica desativado.';
    }
    atualizarLinkWhats();
    els.painelFundo.hidden = false;
    els.mensagem.focus();
  }

  function fecharPainel() {
    els.painelFundo.hidden = true;
    painelNegocioAtual = null;
  }

  async function buscar() {
    const nicho = els.nicho.value.trim();
    const local = els.local.value.trim();
    const raioKm = Number(els.raio.value);
    if (!nicho) {
      els.statusBusca.textContent = 'Informe o nicho (ex.: pizzaria).';
      els.statusBusca.classList.add('erro');
      els.nicho.focus();
      return;
    }
    els.statusBusca.classList.remove('erro');
    els.statusBusca.textContent = 'Buscando…';
    els.btnBuscar.disabled = true;
    els.btnBuscar.textContent = 'Buscando…';

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nicho, raioKm, local })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error((data && data.message) || 'A busca falhou. Tente de novo.');
      }
      resultados = Array.isArray(data.results) ? data.results : [];
      demoMode = !!data.demo;
      if (data.source) fonteAtual = data.source;
      els.statusBusca.textContent = data.note || '';
      render();
    } catch (e) {
      // Sem backend (ex.: arquivo aberto direto): demonstração só com
      // ?demo=1. No fluxo padrão, mostra o erro em linguagem simples.
      if (DEMO_FLAG) {
        demoMode = true;
        fonteAtual = 'demo';
        resultados = DEMO_FALLBACK.slice();
        els.statusBusca.textContent = 'Servidor indisponível — mostrando demonstração (?demo=1).';
        els.statusBusca.classList.remove('erro');
      } else {
        demoMode = false;
        resultados = [];
        // Erro de rede (TypeError) não traz mensagem útil: texto simples.
        els.statusBusca.textContent = (e instanceof TypeError)
          ? 'Não consegui buscar agora. Verifique a conexão e tente de novo.'
          : ((e && e.message) || 'A busca falhou. Tente de novo.');
        els.statusBusca.classList.add('erro');
      }
      render();
    } finally {
      els.btnBuscar.disabled = false;
      els.btnBuscar.textContent = 'Buscar negócios';
    }
  }

  function listaFiltrada() {
    let lista = resultados.slice();
    if (filtro === 'sem-site') lista = lista.filter((r) => !r.hasWebsite);
    if (filtro === 'com-site') lista = lista.filter((r) => r.hasWebsite);
    const ordem = els.ordem.value;
    if (ordem === 'avaliacao') {
      lista.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else {
      lista.sort((a, b) => {
        if (a.distanceKm === null) return 1;
        if (b.distanceKm === null) return -1;
        return a.distanceKm - b.distanceKm;
      });
    }
    return lista;
  }

  function seloQualidade(id) {
    const av = avaliacoes[id];
    if (!av) return '';
    if (av === 'erro') return '<span class="selo">Não foi possível avaliar o site</span>';
    const cls = av.label === 'Boa' ? 'qualidade-boa' : av.label === 'Regular' ? 'qualidade-regular' : 'qualidade-fraca';
    return '<span class="selo ' + cls + '" title="Estimativa por sinais: acessível, https, mobile, WhatsApp, título. Nota ' + av.score + '/5.">Site: ' + av.label + ' (estimativa)</span>';
  }

  function cardHtml(r) {
    const foiContatado = contatados.has(r.id);
    const nota = r.rating !== null && r.rating !== undefined
      ? '<span class="nota">★ ' + Number(r.rating).toFixed(1) + '</span>' +
        (r.userRatingCount ? '<span class="distancia">(' + r.userRatingCount + ' avaliações)</span>' : '')
      : '<span class="distancia">Sem nota</span>';
    const dist = r.distanceKm !== null && r.distanceKm !== undefined
      ? '<span class="distancia">' + r.distanceKm + ' km</span>' : '';
    const badges = [
      r.hasWebsite
        ? '<span class="selo site-sim">Tem site</span>'
        : '<span class="selo site-nao">Sem site</span>',
      r.demo ? '<span class="selo demo">DEMONSTRAÇÃO</span>' : '',
      foiContatado ? '<span class="selo contatado">Contatado</span>' : '',
      seloQualidade(r.id)
    ].join('');
    const siteBtn = r.website
      ? '<a class="btn" href="' + escapeHtml(r.website) + '" target="_blank" rel="noopener">Ver site</a>' : '';
    const avaliarBtn = r.website
      ? '<button type="button" class="btn avaliacao" data-avaliar="' + escapeHtml(r.id) + '">Avaliar site</button>' : '';
    const whatsBtn = r.phoneDigits
      ? '<button type="button" class="btn verde" data-whats="' + escapeHtml(r.id) + '">WhatsApp</button>' : '';
    return '<article class="negocio' + (foiContatado ? ' contatado' : '') + '">' +
      '<h3>' + escapeHtml(r.name) + '</h3>' +
      '<p class="categoria">' + escapeHtml(r.category || '') + '</p>' +
      '<p class="endereco">' + escapeHtml(r.address || 'Endereço não informado') + '</p>' +
      '<div class="meta">' + nota + dist + '</div>' +
      (r.phone ? '<p class="telefone">' + escapeHtml(r.phone) + '</p>' : '') +
      '<div class="badges">' + badges + '</div>' +
      '<div class="acoes">' + siteBtn + avaliarBtn + whatsBtn +
      '<button type="button" class="btn" data-contato="' + escapeHtml(r.id) + '">' +
      (foiContatado ? 'Desmarcar contatado' : 'Marcar contatado') + '</button></div>' +
      '</article>';
  }

  function render() {
    const lista = listaFiltrada();
    els.toolbar.hidden = resultados.length === 0;
    els.contador.hidden = resultados.length === 0;
    if (resultados.length) {
      const fonte = demoMode
        ? ' (demonstração)'
        : ' · Fonte: ' + (fonteAtual === 'google' ? 'Google' : 'OpenStreetMap (grátis)');
      els.contador.textContent = lista.length + ' de ' + resultados.length + ' negócios' + fonte;
    }
    if (!resultados.length) {
      els.resultados.innerHTML = '';
      return;
    }
    if (!lista.length) {
      els.resultados.innerHTML = '<div class="estado"><strong>Nada neste filtro.</strong>' +
        'Nenhum negócio com esse filtro. Troque o filtro ou faça outra busca.</div>';
      return;
    }
    els.resultados.innerHTML = lista.map(cardHtml).join('');

    els.resultados.querySelectorAll('[data-whats]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = resultados.find((x) => x.id === btn.getAttribute('data-whats'));
        if (r) abrirPainel(r);
      });
    });
    els.resultados.querySelectorAll('[data-contato]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-contato');
        if (contatados.has(id)) contatados.delete(id); else contatados.add(id);
        salvarContatados();
        render();
      });
    });
    els.resultados.querySelectorAll('[data-avaliar]').forEach((btn) => {
      btn.addEventListener('click', () => avaliarSite(btn));
    });
  }

  async function avaliarSite(btn) {
    const id = btn.getAttribute('data-avaliar');
    const r = resultados.find((x) => x.id === id);
    if (!r || !r.website) return;
    btn.disabled = true;
    btn.textContent = 'Avaliando…';
    try {
      const res = await fetch('/api/check-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: r.website })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error('falha');
      avaliacoes[id] = { score: data.score, label: data.label };
    } catch (e) {
      avaliacoes[id] = 'erro';
    }
    render();
  }
}
