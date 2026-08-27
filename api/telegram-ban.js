// Список забаненных Telegram-пользователей (общий с ботом через тот же Redis).
// Забаненный больше не может отправлять сигналы через api/telegram.js.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const BANNED_KEY = 'polog:tgbanned';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: 'Хранилище не подключено.' });
  }

  try {
    if (req.method === 'GET') {
      const ids = (await redis(['SMEMBERS', BANNED_KEY])) || [];
      return res.status(200).json(ids);
    }

    if (req.method === 'POST') {
      const { tgUserId } = req.body || {};
      if (!tgUserId) {
        return res.status(400).json({ error: 'Укажите tgUserId' });
      }
      await redis(['SADD', BANNED_KEY, String(tgUserId)]);
      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      const { tgUserId } = req.query;
      if (!tgUserId) {
        return res.status(400).json({ error: 'Укажите tgUserId' });
      }
      await redis(['SREM', BANNED_KEY, String(tgUserId)]);
      return res.status(200).json({ success: true });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(502).json({ error: 'Ошибка хранилища', detail: String(e && e.message || e) });
  }
};
