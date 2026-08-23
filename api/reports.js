// Общее хранилище сигналов на Upstash Redis (REST API), доступное с любого устройства.
// Нужны переменные окружения на Vercel: подключите Storage -> Upstash for Redis (или Vercel KV) к проекту.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH_KEY = 'polog:reports';

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: 'Хранилище не подключено. Добавьте Upstash/KV в настройках проекта Vercel.' });
  }

  try {
    if (req.method === 'POST') {
      const { loc, desc, sev } = req.body || {};
      if (!loc) {
        return res.status(400).json({ error: 'Укажите локацию' });
      }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const report = { loc, desc: desc || '', sev: sev || 'med', ts: Date.now(), status: 'new' };
      await redis(['HSET', HASH_KEY, key, JSON.stringify(report)]);
      report._key = key;
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
