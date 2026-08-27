// Telegram-бот «Полог»: пользователь пишет боту, где и что он видит,
// сигнал уходит в то же хранилище (Upstash Redis), что и сайт/админка.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const { notifyHighSeverity } = require('./_notify');

const REPORTS_KEY = 'polog:reports';
const STATE_KEY = 'polog:tgstate';
const BANNED_KEY = 'polog:tgbanned';
const RATE_PREFIX = 'polog:tgrate:';
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 3600;

const REPORT_BTN = '🚨 Сообщить о загрязнении';
const CANCEL_BTN = '✖️ Отмена';
const SKIP_BTN = '⏭ Пропустить';
const NEXT_BTN = '➡️ Дальше';
const LOCATION_BTN = '📍 Отправить геолокацию';
const CONTACT_BTN = '📞 Отправить номер телефона';

const mainKeyboard = { keyboard: [[{ text: REPORT_BTN }]], resize_keyboard: true };
const locKeyboard = {
  keyboard: [
    [{ text: LOCATION_BTN, request_location: true }],
    [{ text: CANCEL_BTN }]
  ],
  resize_keyboard: true
};
const descKeyboard = {
  keyboard: [
    [{ text: NEXT_BTN }],
    [{ text: SKIP_BTN }],
    [{ text: CANCEL_BTN }]
  ],
  resize_keyboard: true
};
const phoneKeyboard = {
  keyboard: [
    [{ text: CONTACT_BTN, request_contact: true }],
    [{ text: SKIP_BTN }],
    [{ text: CANCEL_BTN }]
  ],
  resize_keyboard: true
};
const sevKeyboard = {
  inline_keyboard: [[
    { text: 'Низкая', callback_data: 'sev_low' },
    { text: 'Средняя', callback_data: 'sev_med' },
    { text: 'Высокая', callback_data: 'sev_high' }
  ]]
};
const confirmKeyboard = {
  inline_keyboard: [[
    { text: '✅ Отправить', callback_data: 'confirm_send' },
    { text: '🔁 Начать заново', callback_data: 'confirm_restart' }
  ]]
};
const sevLabel = { low: 'Низкая', med: 'Средняя', high: 'Высокая' };
const PHONE_PROMPT = 'Оставите номер телефона на случай, если понадобятся уточнения по сигналу? Это необязательно.';
const SEV_PROMPT = 'Насколько это серьёзно?\n\n🟢 Низкая — немного мусора, не мешает\n🟠 Средняя — заметное загрязнение, копится со временем\n🔴 Высокая — токсично, опасно, большая свалка';
const isSkip = (t) => t === SKIP_BTN || t === '/skip';

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

async function tg(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

async function getState(chatId) {
  const raw = await redis(['HGET', STATE_KEY, String(chatId)]);
  return raw ? JSON.parse(raw) : null;
}
async function setState(chatId, state) {
  await redis(['HSET', STATE_KEY, String(chatId), JSON.stringify(state)]);
}
async function clearState(chatId) {
  await redis(['HDEL', STATE_KEY, String(chatId)]);
}

async function isBanned(userId) {
  const res = await redis(['SISMEMBER', BANNED_KEY, String(userId)]);
  return res === 1;
}

async function withinRateLimit(userId) {
  const key = RATE_PREFIX + userId;
  const count = await redis(['INCR', key]);
  if (count === 1) {
    await redis(['EXPIRE', key, String(RATE_LIMIT_WINDOW)]);
  }
  return count <= RATE_LIMIT_MAX;
}

function fromInfo(from) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  return {
    tgUserId: from.id,
    tgName: name,
    tgUsername: from.username ? `@${from.username}` : ''
  };
}

function buildSummary(state) {
  const lines = [
    'Проверьте перед отправкой:',
    `📍 ${state.loc}`,
    state.desc ? `📝 ${state.desc}` : null,
    state.photo ? '📷 фото приложено' : null,
    state.phone ? `📞 ${state.phone}` : null,
    `⚠️ ${sevLabel[state.sev] || state.sev}`
  ].filter(Boolean);
  return lines.join('\n');
}

async function startFlow(chatId) {
  await setState(chatId, { step: 'loc' });
  await tg('sendMessage', {
    chat_id: chatId,
    text: 'Где вы это видите? Нажмите кнопку, чтобы отправить геолокацию, или опишите место текстом (например: «Парк Победы, ~400м от главного входа»).',
    reply_markup: locKeyboard
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }
  if (WEBHOOK_SECRET) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== WEBHOOK_SECRET) {
      return res.status(401).end();
    }
  }
  if (!BOT_TOKEN || !REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).end();
  }

  const update = req.body || {};

  try {
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message.chat.id;
      const data = cq.data || '';

      if (cq.from && (await isBanned(cq.from.id))) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Вы заблокированы и не можете отправлять сигналы.', show_alert: true });
        await clearState(chatId);
        return res.status(200).json({ ok: true });
      }
      await tg('answerCallbackQuery', { callback_query_id: cq.id });

      if (data.startsWith('sev_')) {
        const state = await getState(chatId);
        if (!state || state.step !== 'sev') {
          return res.status(200).json({ ok: true });
        }
        state.sev = data.slice(4);
        state.step = 'confirm';
        await setState(chatId, state);
        await tg('editMessageText', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          text: buildSummary(state),
          reply_markup: confirmKeyboard
        });
        return res.status(200).json({ ok: true });
      }

      if (data === 'confirm_restart') {
        await startFlow(chatId);
        return res.status(200).json({ ok: true });
      }

      if (data === 'confirm_send') {
        const state = await getState(chatId);
        if (!state || state.step !== 'confirm') {
          return res.status(200).json({ ok: true });
        }

        if (!(await withinRateLimit(cq.from.id))) {
          await tg('editMessageText', {
            chat_id: chatId,
            message_id: cq.message.message_id,
            text: 'Слишком много сигналов за последний час. Попробуйте позже.'
          });
          await clearState(chatId);
          return res.status(200).json({ ok: true });
        }

        const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const report = {
          loc: state.loc,
          desc: state.desc || '',
          phone: state.phone || '',
          photo: state.photo || null,
          mapUrl: state.mapUrl || null,
          lat: state.lat != null ? state.lat : null,
          lon: state.lon != null ? state.lon : null,
          sev: state.sev,
          ts: Date.now(),
          status: 'new',
          source: 'telegram',
          ...fromInfo(cq.from)
        };
        await redis(['HSET', REPORTS_KEY, key, JSON.stringify(report)]);
        if (report.sev === 'high') {
          await notifyHighSeverity(report);
        }
        await clearState(chatId);
        await tg('editMessageText', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          text: 'Спасибо! Сигнал добавлен в общий список для служб. ✅'
        });
        await tg('sendMessage', {
          chat_id: chatId,
          text: 'Хотите сообщить ещё об одном месте?',
          reply_markup: mainKeyboard
        });
        return res.status(200).json({ ok: true });
      }

      return res.status(200).json({ ok: true });
    }

    const msg = update.message;
    if (!msg) return res.status(200).json({ ok: true });
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    if (msg.from && (await isBanned(msg.from.id))) {
      await clearState(chatId);
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Вы заблокированы и не можете отправлять сигналы через этого бота.',
        reply_markup: { remove_keyboard: true }
      });
      return res.status(200).json({ ok: true });
    }

    if (text === '/start') {
      await clearState(chatId);
      await tg('sendMessage', {
        chat_id: chatId,
        text: '👋 Привет! «Полог» — сеть, куда люди сообщают о загрязнениях природы: свалках, мусоре, неприятном запахе и т.д.\n\nВы описываете место и что видите — сигнал попадает в общий список, по которому ответственные службы решают, куда выехать в первую очередь. Чем больше сообщений об одном месте — тем выше оно в приоритете.\n\nНажмите кнопку ниже, чтобы сообщить о том, что видите.',
        reply_markup: mainKeyboard
      });
      return res.status(200).json({ ok: true });
    }

    if (text === '/cancel' || text === CANCEL_BTN) {
      await clearState(chatId);
      await tg('sendMessage', { chat_id: chatId, text: 'Отменено.', reply_markup: mainKeyboard });
      return res.status(200).json({ ok: true });
    }

    if (text === '/report' || text === REPORT_BTN) {
      await startFlow(chatId);
      return res.status(200).json({ ok: true });
    }

    const state = await getState(chatId);

    if (!state) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Нажмите кнопку ниже, чтобы сообщить о загрязнении.',
        reply_markup: mainKeyboard
      });
      return res.status(200).json({ ok: true });
    }

    if (state.step === 'loc') {
      let loc = text;
      let mapUrl = null;
      let lat = null;
      let lon = null;
      if (!loc && msg.location) {
        const { latitude, longitude } = msg.location;
        loc = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        mapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
        lat = latitude;
        lon = longitude;
      }
      if (!loc) {
        await tg('sendMessage', { chat_id: chatId, text: 'Нажмите кнопку «Отправить геолокацию» или опишите место текстом.' });
        return res.status(200).json({ ok: true });
      }
      state.loc = loc;
      state.mapUrl = mapUrl;
      state.lat = lat;
      state.lon = lon;
      state.step = 'desc';
      await setState(chatId, state);
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Что вы видите? Опишите текстом и/или пришлите фото места. Когда закончите — нажмите «Дальше», или сразу «Пропустить», если добавить нечего.',
        reply_markup: descKeyboard
      });
      return res.status(200).json({ ok: true });
    }

    if (state.step === 'desc') {
      if (msg.photo && msg.photo.length) {
        state.photo = msg.photo[msg.photo.length - 1].file_id;
        if (msg.caption) {
          state.desc = [state.desc, msg.caption.trim()].filter(Boolean).join('\n');
        }
        await setState(chatId, state);
        await tg('sendMessage', {
          chat_id: chatId,
          text: 'Фото получено 📷 Можете дописать текстом ещё что-то, или нажмите «Дальше».',
          reply_markup: descKeyboard
        });
        return res.status(200).json({ ok: true });
      }
      if (isSkip(text)) {
        state.step = 'phone';
        await setState(chatId, state);
        await tg('sendMessage', { chat_id: chatId, text: PHONE_PROMPT, reply_markup: phoneKeyboard });
        return res.status(200).json({ ok: true });
      }
      if (text === NEXT_BTN) {
        state.step = 'phone';
        await setState(chatId, state);
        await tg('sendMessage', { chat_id: chatId, text: PHONE_PROMPT, reply_markup: phoneKeyboard });
        return res.status(200).json({ ok: true });
      }
      if (text) {
        state.desc = [state.desc, text].filter(Boolean).join('\n');
        await setState(chatId, state);
        await tg('sendMessage', {
          chat_id: chatId,
          text: 'Записал. Добавите ещё что-то, или нажмите «Дальше»?',
          reply_markup: descKeyboard
        });
        return res.status(200).json({ ok: true });
      }
      await tg('sendMessage', { chat_id: chatId, text: 'Отправьте текст, фото, или нажмите «Дальше» / «Пропустить».' });
      return res.status(200).json({ ok: true });
    }

    if (state.step === 'phone') {
      if (msg.contact && msg.contact.phone_number) {
        state.phone = msg.contact.phone_number;
      } else if (isSkip(text)) {
        state.phone = '';
      } else if (text) {
        state.phone = text;
      } else {
        await tg('sendMessage', { chat_id: chatId, text: 'Отправьте номер кнопкой, текстом, или нажмите «Пропустить».' });
        return res.status(200).json({ ok: true });
      }
      state.step = 'sev';
      await setState(chatId, state);
      await tg('sendMessage', { chat_id: chatId, text: 'Принято.', reply_markup: { remove_keyboard: true } });
      await tg('sendMessage', { chat_id: chatId, text: SEV_PROMPT, reply_markup: sevKeyboard });
      return res.status(200).json({ ok: true });
    }

    if (state.step === 'confirm') {
      await tg('sendMessage', { chat_id: chatId, text: 'Нажмите «Отправить» или «Начать заново» кнопками выше ⬆️' });
      return res.status(200).json({ ok: true });
    }

    await tg('sendMessage', { chat_id: chatId, text: 'Выберите серьёзность кнопками выше ⬆️' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    const chatId = (update.message && update.message.chat && update.message.chat.id)
      || (update.callback_query && update.callback_query.message && update.callback_query.message.chat.id);
    if (chatId) {
      try { await tg('sendMessage', { chat_id: chatId, text: 'Что-то пошло не так, попробуйте ещё раз чуть позже.' }); } catch (_) {}
    }
    return res.status(200).json({ ok: true });
  }
};
