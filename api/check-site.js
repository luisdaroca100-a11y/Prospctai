'use strict';

const { readBody, sendJSON, scoreSiteSignals } = require('./_lib');

// Avalia o site de um negócio por sinais simples (é uma ESTIMATIVA,
// não um veredito): carrega, https, viewport mobile, link de WhatsApp,
// título. Busca feita no servidor com timeout, limite de tamanho e
// no máximo 3 redirecionamentos. Só http(s); rejeita localhost e
// IPs literais privados (proteção básica contra SSRF).
const TIMEOUT_MS = 8000;
const MAX_BYTES = 500 * 1024;
const MAX_REDIRECTS = 3;

function isPrivateIpLiteral(host) {
  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '[::1]' || host === '::1') return true;
  return false;
}

async function readLimited(res, maxBytes) {
  // Lê o corpo com teto de bytes; aborta a leitura ao passar do teto.
  if (typeof res.body !== 'undefined' && res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch (e) { /* ignora */ }
          break;
        }
        chunks.push(value);
      }
    } finally {
      try { reader.releaseLock(); } catch (e) { /* ignora */ }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return buf.toString('utf8');
  }
  const text = await res.text();
  return text.slice(0, maxBytes);
}

async function fetchSite(startUrl) {
  let url = startUrl;
  let status = 0;
  let finalUrl = startUrl;
  let html = '';
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (prospeccao-clientes; avaliacao-de-site)',
          'Accept': 'text/html,application/xhtml+xml'
        }
      });
    } finally {
      clearTimeout(timer);
    }
    status = res.status;
    finalUrl = url;
    if (status >= 300 && status < 400) {
      const loc = res.headers.get('location');
      if (loc && i < MAX_REDIRECTS) {
        url = new URL(loc, url).toString();
        continue;
      }
    }
    if (status >= 200 && status < 300) {
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (type.includes('text/html') || type.includes('text/') || type === '') {
        html = await readLimited(res, MAX_BYTES);
      }
    }
    break;
  }
  return { status, finalUrl, html };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJSON(res, 405, { error: 'method_not_allowed' });

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return sendJSON(res, 400, { error: 'bad_body' });
  }

  const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
  if (!rawUrl) return sendJSON(res, 400, { error: 'missing_url', message: 'Informe a URL do site.' });

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    return sendJSON(res, 400, { error: 'invalid_url', message: 'URL inválida.' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return sendJSON(res, 400, { error: 'invalid_url', message: 'Só endereços http(s) podem ser avaliados.' });
  }
  if (isPrivateIpLiteral(parsed.hostname.toLowerCase())) {
    return sendJSON(res, 400, { error: 'invalid_url', message: 'Esse endereço não pode ser avaliado.' });
  }

  const started = Date.now();
  let fetched;
  try {
    fetched = await fetchSite(parsed.toString());
  } catch (e) {
    const loadMs = Date.now() - started;
    const { score, label } = scoreSiteSignals({ ok: false, https: parsed.protocol === 'https:' });
    return sendJSON(res, 200, {
      ok: false, status: 0, loadMs, https: parsed.protocol === 'https:',
      hasViewport: false, hasWhatsAppLink: false, hasTitle: false,
      score, label, message: 'O site não respondeu (pode estar fora do ar ou bloqueando a leitura).'
    });
  }
  const loadMs = Date.now() - started;
  const ok = fetched.status >= 200 && fetched.status < 400;
  const finalProtocol = new URL(fetched.finalUrl).protocol;
  const lower = fetched.html.toLowerCase();
  const signals = {
    ok,
    https: finalProtocol === 'https:',
    hasViewport: lower.includes('name="viewport"') || lower.includes("name='viewport'"),
    hasWhatsAppLink: lower.includes('wa.me') || lower.includes('api.whatsapp.com'),
    hasTitle: /<title[^>]*>[^<]{2,}<\/title>/.test(fetched.html)
  };
  const { score, label } = scoreSiteSignals(signals);
  return sendJSON(res, 200, {
    ok,
    status: fetched.status,
    loadMs,
    https: signals.https,
    hasViewport: signals.hasViewport,
    hasWhatsAppLink: signals.hasWhatsAppLink,
    hasTitle: signals.hasTitle,
    score,
    label
  });
};
