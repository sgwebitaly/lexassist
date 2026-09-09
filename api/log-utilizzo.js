import * as crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { avvocato, email, pec, ordine, iscrizione, studio, bando, modalita } = req.body;

    const token = await getAccessToken();
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Foglio1!A:I:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[now, avvocato || '', email || '', pec || '', ordine || '', iscrizione || '', studio || '', bando || '', modalita || '']]
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Sheets API error: ${err}`);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('log-utilizzo error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const jwt = createJWT(payload, privateKey);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) throw new Error('Token error: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(JSON.stringify(input));
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createJWT(payload, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const signingInput = `${base64url(header)}.${base64url(payload)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(privateKeyPem, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}
