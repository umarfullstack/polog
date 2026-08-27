// Уведомление ответственных о сигнале высокой серьёзности — в отдельный Telegram-чат/канал.
// Нужна переменная окружения TELEGRAM_NOTIFY_CHAT_ID (id группы/канала, куда добавлен бот).
// Без неё просто ничего не отправляется — сохранение сигнала при этом не блокируется.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const NOTIFY_CHAT_ID = process.env.TELEGRAM_NOTIFY_CHAT_ID;

async function notifyHighSeverity(report) {
  if (!BOT_TOKEN || !NOTIFY_CHAT_ID) return;
  const lines = [
    '🚨 Новый сигнал высокой серьёзности',
    `📍 ${report.loc}`,
    report.desc ? `📝 ${report.desc}` : null,
    report.mapUrl ? `🗺 ${report.mapUrl}` : null,
    report.phone ? `📞 ${report.phone}` : null,
    `Источник: ${report.source === 'telegram' ? 'Telegram-бот' : 'Сайт'}`
  ].filter(Boolean).join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: NOTIFY_CHAT_ID, text: lines, disable_web_page_preview: true })
    });
  } catch (e) {
    // не блокируем сохранение сигнала, если уведомление не доставилось
  }
}

module.exports = { notifyHighSeverity };
