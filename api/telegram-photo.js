// Отдаёт фото, присланное в Telegram-бота, по file_id — используется в админке.
// Бот-токен нужен только на сервере, поэтому клиент ходит через этот прокси, а не напрямую в Telegram.
// <img> не может слать заголовки, поэтому код администратора передаётся query-параметром ?token=.
const { checkAdmin } = require('./_auth');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

module.exports = async function handler(req, res) {
  if (!checkAdmin(req)) {
    return res.status(401).end();
  }
  const fileId = req.query.file_id;
  if (!fileId) {
    return res.status(400).end();
  }
  if (!BOT_TOKEN) {
    return res.status(500).end();
  }

  try {
    const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const info = await infoRes.json();
    if (!info.ok) {
      return res.status(404).end();
    }

    const fileRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`);
    if (!fileRes.ok) {
      return res.status(502).end();
    }

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    res.setHeader('Content-Type', fileRes.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    return res.status(200).send(buffer);
  } catch (e) {
    return res.status(500).end();
  }
};
