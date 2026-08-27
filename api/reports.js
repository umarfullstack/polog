// Общее хранилище сигналов на Upstash Redis (REST API), доступное с любого устройства.
// Нужны переменные окружения на Vercel: подключите Storage -> Upstash for Redis (или Vercel KV) к проекту.
const crypto = require('crypto');
const { checkAdmin } = require('./_auth');
const { notifyHighSeverity } = require('./_notify');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH_KEY = 'polog:reports';
const RATE_PREFIX = 'polog:rl:';
const DEDUP_PREFIX = 'polog:dedup:';
const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW = 3600;
const DEDUP_WINDOW = 300;
const MAX_PHOTO_BYTES = 900000; // ~900KB base64, keeps a single Redis value reasonable

async function redis(args) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

function parseHGetAll(flat) {
  const reports = [];
  for (let i = 0; i < flat.length; i += 2) {
    const key = flat[i];
    try {
      const report = JSON.parse(flat[i + 1]);
      report._key = key;
      reports.push(report);
    } catch (e) {
      // skip unreadable entry
    }
  }
  reports.sort((a, b) => b.ts - a.ts);
  return reports;
}

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: 'Хранилище не подключено. Добавьте Upstash/KV в настройках проекта Vercel.' });
  }

  if (req.method === 'GET' || req.method === 'PATCH' || req.method === 'DELETE') {
    if (!checkAdmin(req)) {
      return res.status(401).json({ error: 'Требуется код администратора.' });
    }
  }

  try {
    if (req.method === 'POST') {
      const { loc, desc, sev, phone, photoData, visitorId } = req.body || {};
      if (!loc) {
        return res.status(400).json({ error: 'Укажите локацию' });
      }
      if (photoData && Buffer.byteLength(photoData, 'utf8') > MAX_PHOTO_BYTES) {
        return res.status(413).json({ error: 'Фото слишком большое.' });
      }

      const ip = getIp(req);
      const rlKey = RATE_PREFIX + ip;
      const count = await redis(['INCR', rlKey]);
      if (count === 1) {
        await redis(['EXPIRE', rlKey, String(RATE_LIMIT_WINDOW)]);
      }
      if (count > RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Слишком много сигналов подряд. Попробуйте позже.' });
      }

      const dedupHash = crypto.createHash('md5').update(`${loc}|${desc || ''}|${sev || 'med'}`).digest('hex');
      const dedupKey = DEDUP_PREFIX + dedupHash;
      const setResult = await redis(['SET', dedupKey, '1', 'NX', 'EX', String(DEDUP_WINDOW)]);
      if (setResult !== 'OK') {
        return res.status(429).json({ error: 'Такой же сигнал уже отправлен только что.' });
      }

      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const report = {
        loc,
        desc: desc || '',
        sev: sev || 'med',
        phone: phone || '',
        photoData: photoData || null,
        visitorId: visitorId || null,
        ts: Date.now(),
        status: 'new',
        source: 'web'
      };
      await redis(['HSET', HASH_KEY, key, JSON.stringify(report)]);
      report._key = key;
      if (report.sev === 'high') {
        await notifyHighSeverity(report);
      }
      return res.status(201).json({ success: true, report });
    }

    if (req.method === 'GET') {
      const flat = (await redis(['HGETALL', HASH_KEY])) || [];
      return res.status(200).json(parseHGetAll(flat));
    }

    if (req.method === 'PATCH') {
      const { key } = req.query;
      const { status } = req.body || {};
      if (!key || !status) {
        return res.status(400).json({ error: 'Укажите key и status' });
      }
      const existing = await redis(['HGET', HASH_KEY, key]);
      if (!existing) {
        return res.status(404).json({ error: 'Сигнал не найден' });
      }
      const report = JSON.parse(existing);
      report.status = status;
      await redis(['HSET', HASH_KEY, key, JSON.stringify(report)]);
      report._key = key;
      return res.status(200).json({ success: true, report });
    }

    if (req.method === 'DELETE') {
      const { key, all } = req.query;
      if (all === 'true') {
        await redis(['DEL', HASH_KEY]);
        return res.status(200).json({ success: true });
      }
      if (!key) {
        return res.status(400).json({ error: 'Укажите key' });
      }
      await redis(['HDEL', HASH_KEY, key]);
      return res.status(200).json({ success: true });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(502).json({ error: 'Ошибка хранилища', detail: String(e && e.message || e) });
  }
};
