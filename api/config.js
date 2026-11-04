'use strict';

const { sendJSON } = require('./_lib');

// Configuração pública do frontend. NUNCA expõe o valor da chave:
// só diz qual fonte de dados está ativa (Google com chave, ou o mapa
// grátis OpenStreetMap sem chave).
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return sendJSON(res, 405, { error: 'method_not_allowed' });
  const configured = !!process.env.GOOGLE_PLACES_API_KEY;
  return sendJSON(res, 200, {
    placesConfigured: configured,
    source: configured ? 'google' : 'osm'
  });
};
