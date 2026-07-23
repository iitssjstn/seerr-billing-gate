const axios = require('axios');
const { getSetting } = require('./db');

/**
 * Bouwt de huidige Seerr-configuratie op basis van wat in de database is
 * opgeslagen (via de instellingenpagina). .env-variabelen zijn alleen nog
 * een fallback voor bestaande installaties.
 */
function getConfig() {
  const url = (
    getSetting('seerr_url') ||
    process.env.SEERR_URL ||
    ''
  ).replace(/\/+$/, '');
  const apiKey = getSetting('seerr_api_key') || process.env.SEERR_API_KEY || '';
  return { url, apiKey };
}

function isConfigured() {
  const { url, apiKey } = getConfig();
  return Boolean(url && apiKey);
}

function client() {
  const { url, apiKey } = getConfig();
  if (!url || !apiKey) {
    const err = new Error(
      'Seerr is nog niet gekoppeld. Vul de URL en API key in bij Instellingen.'
    );
    err.code = 'SEERR_NOT_CONFIGURED';
    throw err;
  }
  return axios.create({
    baseURL: `${url}/api/v1`,
    headers: { 'X-Api-Key': apiKey },
    timeout: 10000,
  });
}

/**
 * Zoekt een bestaande Seerr-gebruiker op e-mailadres.
 */
async function findUserByEmail(email) {
  const { data } = await client().get('/user', {
    params: { q: email, take: 20 },
  });
  const results = data?.results || [];
  return (
    results.find(
      (u) => (u.email || '').toLowerCase() === email.toLowerCase()
    ) || null
  );
}

/**
 * Maakt een nieuwe lokale Seerr-gebruiker aan (of geeft de bestaande terug
 * als er al een account met dit e-mailadres bestaat).
 */
async function ensureUser({ email, username }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    return existing;
  }
  const { data } = await client().post('/user', {
    email,
    username: username || undefined,
  });
  return data;
}

/**
 * Verwijdert een Seerr-gebruiker (en daarmee hun requests/toegang).
 */
async function deleteUser(seerrUserId) {
  await client().delete(`/user/${seerrUserId}`);
}

/**
 * Test de verbinding met Seerr - gebruikt voor de "Testen"-knop op de
 * instellingenpagina. Haalt 1 gebruiker op: dit vereist zowel een geldige
 * URL als een geldige API key, dus een geslaagde call bevestigt beide.
 */
async function testConnection() {
  const { data } = await client().get('/user', { params: { take: 1 } });
  return data;
}

module.exports = {
  isConfigured,
  getConfig,
  findUserByEmail,
  ensureUser,
  deleteUser,
  testConnection,
};
