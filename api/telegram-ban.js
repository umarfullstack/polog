// Список забаненных Telegram-пользователей (общий с ботом через тот же Redis).
// Забаненный больше не может отправлять сигналы через api/telegram.js.
const { checkAdmin } = require('./_auth');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
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

async function notify(chatId, text) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: { remove_keyboard: true } })
    });
  } catch (e) {
    // не блокируем бан/разбан, если уведомление не доставилось
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: 'Хранилище не подключено.' });
  }
  if (!checkAdmin(req)) {
    return res.status(401).json({ error: 'Требуется код администратора.' });
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
      await notify(tgUserId, 'Вы заблокированы и больше не можете отправлять сигналы через бота «Полог».');
      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      const { tgUserId } = req.query;
      if (!tgUserId) {
        return res.status(400).json({ error: 'Укажите tgUserId' });
      }
      await redis(['SREM', BANNED_KEY, String(tgUserId)]);
      await notify(tgUserId, 'Блокировка снята — снова можно отправлять сигналы через бота «Полог».');
      return res.status(200).json({ success: true });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(502).json({ error: 'Ошибка хранилища', detail: String(e && e.message || e) });
  }
};
