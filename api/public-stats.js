// Публичная агрегированная статистика для самого сайта — без телефонов, фото, имён.
// В отличие от /api/reports, здесь не нужен код администратора: наружу идут только счётчики.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH_KEY = 'polog:reports';
const TOTAL_VISITS_KEY = 'polog:visits:total';
const UNIQUE_VISITORS_KEY = 'polog:visitors:unique';

async function redis(args) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=60');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).end();
  }
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: 'Хранилище не подключено.' });
  }

  try {
    const [flat, totalVisits, uniqueVisitors] = await Promise.all([
      redis(['HGETALL', HASH_KEY]),
      redis(['GET', TOTAL_VISITS_KEY]),
      redis(['SCARD', UNIQUE_VISITORS_KEY])
    ]);

    let total = 0;
    let resolved = 0;
    const flatArr = flat || [];
    for (let i = 0; i < flatArr.length; i += 2) {
      try {
        const r = JSON.parse(flatArr[i + 1]);
        total += 1;
        if (r.status === 'resolved') resolved += 1;
      } catch (e) {
        // skip unreadable entry
      }
    }

    return res.status(200).json({
      totalSignals: total,
      resolvedSignals: resolved,
      totalVisits: Number(totalVisits) || 0,
      uniqueVisitors: Number(uniqueVisitors) || 0
    });
  } catch (e) {
    return res.status(502).json({ error: 'Ошибка хранилища', detail: String(e && e.message || e) });
  }
};
