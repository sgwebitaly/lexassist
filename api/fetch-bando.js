export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL mancante' });

  try {
    const decoded = decodeURIComponent(url);

    // Sicurezza: accetta solo URL da domini italiani PA o albocollaboratori
    const allowed = /^https?:\/\/(.*\.)?(albocollaboratori\.it|comune\.|provincia\.|regione\.|asl|aziendaospedaliera|gov\.it|pubblica\.istruzione|cnr\.it)/i;
    if (!allowed.test(decoded)) {
      return res.status(403).json({ error: 'Dominio non autorizzato' });
    }

    const response = await fetch(decoded, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LexAssist/1.0)' }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || 'application/pdf';
    const buffer = await response.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: 'Errore nel download del bando: ' + err.message });
  }
}
