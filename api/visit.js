// Реальный счётчик посещений сайта (не выдуманные цифры).
// POST дергается с каждой загрузки страницы (index.html) — без авторизации, это просто счётчик.
// GET отдаёт агрегаты — только администратору, вместе с остальной статистикой.
const { checkAdmin } = require('./_auth');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TOTAL_KEY = 'polog:visits:total';
const UNIQUE_KEY = 'polog:visitors:unique';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: 'Хранилище не подключено.' });
  }

  try {
    if (req.method === 'POST') {
      const { visitorId } = req.body || {};
      await redis(['INCR', TOTAL_KEY]);
      if (visitorId) {
        await redis(['SADD', UNIQUE_KEY, String(visitorId)]);
      }
      return res.status(200).json({ success: true });
    }

    if (req.method === 'GET') {
      if (!checkAdmin(req)) {
        return res.status(401).json({ error: 'Требуется код администратора.' });
      }
      const [total, unique] = await Promise.all([
        redis(['GET', TOTAL_KEY]),
        redis(['SCARD', UNIQUE_KEY])
      ]);
      return res.status(200).json({
        totalVisits: Number(total) || 0,
        uniqueVisitors: Number(unique) || 0
      });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(502).json({ error: 'Ошибка хранилища', detail: String(e && e.message || e) });
  }
};
