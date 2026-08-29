// Telegram-бот «Полог»: пользователь пишет боту, где и что он видит,
// сигнал уходит в то же хранилище (Upstash Redis), что и сайт/админка.
// Поддерживает RU/EN/UZ — выбранный язык хранится отдельно от состояния диалога,
// чтобы не сбрасываться между отправками сигналов.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const { notifyHighSeverity } = require('./_notify');

const REPORTS_KEY = 'polog:reports';
const STATE_KEY = 'polog:tgstate';
const LANG_KEY = 'polog:tglang';
const BANNED_KEY = 'polog:tgbanned';
const RATE_PREFIX = 'polog:tgrate:';
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 3600;

const LANGUAGE_BTN = '🌐 Язык / Language / Til';
const LANG_PICKER_PROMPT = 'Выберите язык интерфейса\nChoose your language\nInterfeys tilini tanlang';
const langPickerKeyboard = {
  inline_keyboard: [[
    { text: '🇷🇺 Русский', callback_data: 'lang_ru' },
    { text: '🇬🇧 English', callback_data: 'lang_en' },
    { text: '🇺🇿 Oʻzbekcha', callback_data: 'lang_uz' }
  ]]
};

const dict = {
  ru: {
    langSetTo: 'Язык: Русский ✅',
    reportBtn: '🚨 Сообщить о загрязнении',
    cancelBtn: '✖️ Отмена',
    skipBtn: '⏭ Пропустить',
    nextBtn: '➡️ Дальше',
    locationBtn: '📍 Отправить геолокацию',
    contactBtn: '📞 Отправить номер телефона',
    sevLow: 'Низкая', sevMed: 'Средняя', sevHigh: 'Высокая',
    confirmSend: '✅ Отправить',
    confirmRestart: '🔁 Начать заново',
    startGreeting: '👋 Привет! «Полог» — сеть, куда люди сообщают о загрязнениях природы: свалках, мусоре, неприятном запахе и т.д.\n\nВы описываете место и что видите — сигнал попадает в общий список, по которому ответственные службы решают, куда выехать в первую очередь. Чем больше сообщений об одном месте — тем выше оно в приоритете.\n\nНажмите кнопку ниже, чтобы сообщить о том, что видите.',
    askLoc: 'Где вы это видите? Нажмите кнопку, чтобы отправить геолокацию, или опишите место текстом (например: «Парк Победы, ~400м от главного входа»).',
    askLocRetry: 'Нажмите кнопку «Отправить геолокацию» или опишите место текстом.',
    askDesc: 'Что вы видите? Опишите текстом и/или пришлите фото места. Когда закончите — нажмите «Дальше», или сразу «Пропустить», если добавить нечего.',
    photoReceived: 'Фото получено 📷 Можете дописать текстом ещё что-то, или нажмите «Дальше».',
    descNoted: 'Записал. Добавите ещё что-то, или нажмите «Дальше»?',
    askDescRetry: 'Отправьте текст, фото, или нажмите «Дальше» / «Пропустить».',
    askPhone: 'Оставите номер телефона на случай, если понадобятся уточнения по сигналу? Это необязательно.',
    askPhoneRetry: 'Отправьте номер кнопкой, текстом, или нажмите «Пропустить».',
    accepted: 'Принято.',
    askSev: 'Насколько это серьёзно?\n\n🟢 Низкая — немного мусора, не мешает\n🟠 Средняя — заметное загрязнение, копится со временем\n🔴 Высокая — токсично, опасно, большая свалка',
    waitSevButtons: 'Выберите серьёзность кнопками выше ⬆️',
    confirmHeader: 'Проверьте перед отправкой:',
    photoLabel: 'фото приложено',
    waitConfirmButtons: 'Нажмите «Отправить» или «Начать заново» кнопками выше ⬆️',
    rateLimited: 'Слишком много сигналов за последний час. Попробуйте позже.',
    thanksSent: 'Спасибо! Сигнал добавлен в общий список для служб. ✅',
    askAnother: 'Хотите сообщить ещё об одном месте?',
    cancelled: 'Отменено.',
    pressButtonBelow: 'Нажмите кнопку ниже, чтобы сообщить о загрязнении.',
    bannedMsg: 'Вы заблокированы и не можете отправлять сигналы через этого бота.',
    bannedAlert: 'Вы заблокированы и не можете отправлять сигналы.',
    errorGeneric: 'Что-то пошло не так, попробуйте ещё раз чуть позже.'
  },
  en: {
    langSetTo: 'Language: English ✅',
    reportBtn: '🚨 Report pollution',
    cancelBtn: '✖️ Cancel',
    skipBtn: '⏭ Skip',
    nextBtn: '➡️ Next',
    locationBtn: '📍 Send location',
    contactBtn: '📞 Send phone number',
    sevLow: 'Low', sevMed: 'Medium', sevHigh: 'High',
    confirmSend: '✅ Send',
    confirmRestart: '🔁 Start over',
    startGreeting: "👋 Hi! «Polog» is a network where people report pollution: dump sites, litter, bad smells, and more.\n\nDescribe the place and what you see — your signal goes into a shared list that responders use to decide where to go first. The more reports about one place, the higher its priority.\n\nTap the button below to report what you see.",
    askLoc: 'Where do you see it? Tap the button to send your location, or describe the place in text (e.g. "Central Park, ~400m from the main gate").',
    askLocRetry: 'Tap "Send location" or describe the place in text.',
    askDesc: 'What do you see? Describe it in text and/or send a photo of the place. When you\'re done, tap "Next" — or "Skip" right away if there\'s nothing to add.',
    photoReceived: 'Photo received 📷 You can add more in text, or tap "Next".',
    descNoted: 'Got it. Add anything else, or tap "Next"?',
    askDescRetry: 'Send text, a photo, or tap "Next" / "Skip".',
    askPhone: 'Would you like to leave a phone number in case we need to follow up? This is optional.',
    askPhoneRetry: 'Send your number with the button, as text, or tap "Skip".',
    accepted: 'Got it.',
    askSev: 'How severe is it?\n\n🟢 Low — a bit of litter, not a big deal\n🟠 Medium — noticeable pollution, building up over time\n🔴 High — toxic, hazardous, a large dump site',
    waitSevButtons: 'Pick the severity using the buttons above ⬆️',
    confirmHeader: 'Please review before sending:',
    photoLabel: 'photo attached',
    waitConfirmButtons: 'Tap "Send" or "Start over" using the buttons above ⬆️',
    rateLimited: 'Too many signals in the last hour. Please try again later.',
    thanksSent: 'Thank you! The signal was added to the shared list for responders. ✅',
    askAnother: 'Want to report another place?',
    cancelled: 'Cancelled.',
    pressButtonBelow: 'Tap the button below to report pollution.',
    bannedMsg: "You are blocked and can't send signals through this bot.",
    bannedAlert: "You are blocked and can't send signals.",
    errorGeneric: 'Something went wrong, please try again shortly.'
  },
  uz: {
    langSetTo: "Til: Oʻzbekcha ✅",
    reportBtn: '🚨 Ifloslanish haqida xabar berish',
    cancelBtn: '✖️ Bekor qilish',
    skipBtn: "⏭ Oʻtkazib yuborish",
    nextBtn: '➡️ Keyingisi',
    locationBtn: '📍 Geolokatsiyani yuborish',
    contactBtn: '📞 Telefon raqamini yuborish',
    sevLow: 'Past', sevMed: "Oʻrta", sevHigh: 'Yuqori',
    confirmSend: '✅ Yuborish',
    confirmRestart: '🔁 Qaytadan boshlash',
    startGreeting: "👋 Salom! «Polog» — odamlar tabiat ifloslanishi haqida xabar beradigan tarmoq: chiqindixonalar, axlat, yoqimsiz hid va h.k.\n\nJoyni va nima koʻrayotganingizni tasvirlab bering — signal umumiy roʻyxatga tushadi, shu roʻyxat boʻyicha maʼsul xizmatlar qayerga birinchi boʻlib borishni hal qiladi. Bir joy haqida qancha koʻp xabar boʻlsa, u shuncha yuqori ustuvorlikka ega boʻladi.\n\nNima koʻrganingizni xabar qilish uchun quyidagi tugmani bosing.",
    askLoc: "Buni qayerda koʻryapsiz? Geolokatsiyani yuborish uchun tugmani bosing yoki joyni matn bilan tasvirlab bering (masalan: «Gʻalaba bogʻi, asosiy kirishdan ~400m»).",
    askLocRetry: "«Geolokatsiyani yuborish» tugmasini bosing yoki joyni matn bilan yozing.",
    askDesc: "Nimani koʻryapsiz? Matn bilan tasvirlang va/yoki joy fotosini yuboring. Tugatgach — «Keyingisi» tugmasini bosing, qoʻshadigan narsa boʻlmasa — «Oʻtkazib yuborish».",
    photoReceived: "Foto qabul qilindi 📷 Yana matn bilan qoʻshimcha qilishingiz mumkin yoki «Keyingisi» tugmasini bosing.",
    descNoted: "Qabul qildim. Yana biror narsa qoʻshasizmi yoki «Keyingisi»ni bosasizmi?",
    askDescRetry: "Matn, foto yuboring yoki «Keyingisi» / «Oʻtkazib yuborish»ni bosing.",
    askPhone: "Signal boʻyicha aniqlashtirish kerak boʻlib qolsa, telefon raqamingizni qoldirasizmi? Bu ixtiyoriy.",
    askPhoneRetry: "Raqamni tugma orqali, matn bilan yuboring yoki «Oʻtkazib yuborish»ni bosing.",
    accepted: 'Qabul qilindi.',
    askSev: "Bu qanchalik jiddiy?\n\n🟢 Past — biroz chiqindi, xalaqit bermaydi\n🟠 Oʻrta — sezilarli ifloslanish, vaqt oʻtishi bilan koʻpaymoqda\n🔴 Yuqori — zaharli, xavfli, katta chiqindixona",
    waitSevButtons: 'Jiddiylikni yuqoridagi tugmalar bilan tanlang ⬆️',
    confirmHeader: 'Yuborishdan oldin tekshiring:',
    photoLabel: 'foto biriktirildi',
    waitConfirmButtons: "Yuqoridagi tugmalar bilan «Yuborish» yoki «Qaytadan boshlash»ni bosing ⬆️",
    rateLimited: "Soʻnggi bir soatda juda koʻp signal. Keyinroq urinib koʻring.",
    thanksSent: 'Rahmat! Signal xizmatlar uchun umumiy roʻyxatga qoʻshildi. ✅',
    askAnother: "Yana bir joy haqida xabar bermoqchimisiz?",
    cancelled: 'Bekor qilindi.',
    pressButtonBelow: "Ifloslanish haqida xabar berish uchun quyidagi tugmani bosing.",
    bannedMsg: "Siz bloklangansiz va bu bot orqali signal yubora olmaysiz.",
    bannedAlert: "Siz bloklangansiz va signal yubora olmaysiz.",
    errorGeneric: "Nimadir notoʻgʻri ketdi, birozdan keyin qayta urinib koʻring."
  }
};

const isSkip = (d, text) => text === d.skipBtn || text === '/skip';

function mainKeyboard(d) {
  return { keyboard: [[{ text: d.reportBtn }], [{ text: LANGUAGE_BTN }]], resize_keyboard: true };
}
function locKeyboard(d) {
  return { keyboard: [[{ text: d.locationBtn, request_location: true }], [{ text: d.cancelBtn }]], resize_keyboard: true };
}
function descKeyboard(d) {
  return { keyboard: [[{ text: d.nextBtn }], [{ text: d.skipBtn }], [{ text: d.cancelBtn }]], resize_keyboard: true };
}
function phoneKeyboard(d) {
  return { keyboard: [[{ text: d.contactBtn, request_contact: true }], [{ text: d.skipBtn }], [{ text: d.cancelBtn }]], resize_keyboard: true };
}
function sevKeyboard(d) {
  return {
    inline_keyboard: [[
      { text: d.sevLow, callback_data: 'sev_low' },
      { text: d.sevMed, callback_data: 'sev_med' },
      { text: d.sevHigh, callback_data: 'sev_high' }
    ]]
  };
}
function confirmKeyboard(d) {
  return { inline_keyboard: [[{ text: d.confirmSend, callback_data: 'confirm_send' }, { text: d.confirmRestart, callback_data: 'confirm_restart' }]] };
}
function sevLabelFor(d, sev) {
  return { low: d.sevLow, med: d.sevMed, high: d.sevHigh }[sev] || sev;
}

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

async function getLangCode(chatId) {
  const raw = await redis(['HGET', LANG_KEY, String(chatId)]);
  return dict[raw] ? raw : null;
}
async function setLangCode(chatId, lang) {
  await redis(['HSET', LANG_KEY, String(chatId), lang]);
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

function buildSummary(d, state) {
  const lines = [
    d.confirmHeader,
    `📍 ${state.loc}`,
    state.desc ? `📝 ${state.desc}` : null,
    state.photo ? `📷 ${d.photoLabel}` : null,
    state.phone ? `📞 ${state.phone}` : null,
    `⚠️ ${sevLabelFor(d, state.sev)}`
  ].filter(Boolean);
  return lines.join('\n');
}

async function startFlow(chatId, d) {
  await setState(chatId, { step: 'loc' });
  await tg('sendMessage', { chat_id: chatId, text: d.askLoc, reply_markup: locKeyboard(d) });
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
        const langCode = (await getLangCode(chatId)) || 'ru';
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: dict[langCode].bannedAlert, show_alert: true });
        await clearState(chatId);
        return res.status(200).json({ ok: true });
      }
      await tg('answerCallbackQuery', { callback_query_id: cq.id });

      if (data.startsWith('lang_')) {
        const lang = data.slice(5);
        if (!dict[lang]) return res.status(200).json({ ok: true });
        await setLangCode(chatId, lang);
        await clearState(chatId);
        const d = dict[lang];
        await tg('editMessageText', { chat_id: chatId, message_id: cq.message.message_id, text: d.langSetTo });
        await tg('sendMessage', { chat_id: chatId, text: d.startGreeting, reply_markup: mainKeyboard(d) });
        return res.status(200).json({ ok: true });
      }

      const langCode = (await getLangCode(chatId)) || 'ru';
      const d = dict[langCode];

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
          text: buildSummary(d, state),
          reply_markup: confirmKeyboard(d)
        });
        return res.status(200).json({ ok: true });
      }

      if (data === 'confirm_restart') {
        await startFlow(chatId, d);
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
            text: d.rateLimited
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
          text: d.thanksSent
        });
        await tg('sendMessage', {
          chat_id: chatId,
          text: d.askAnother,
          reply_markup: mainKeyboard(d)
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
      const langCode = (await getLangCode(chatId)) || 'ru';
      await clearState(chatId);
      await tg('sendMessage', {
        chat_id: chatId,
        text: dict[langCode].bannedMsg,
        reply_markup: { remove_keyboard: true }
      });
      return res.status(200).json({ ok: true });
    }

    let langCode = await getLangCode(chatId);
    const isFreshStart = text === '/start' && !langCode;

    if (isFreshStart || text === LANGUAGE_BTN || text === '/language') {
      await tg('sendMessage', { chat_id: chatId, text: LANG_PICKER_PROMPT, reply_markup: langPickerKeyboard });
      return res.status(200).json({ ok: true });
    }

    if (!langCode) langCode = 'ru';
    const d = dict[langCode];

    if (text === '/start') {
      await clearState(chatId);
      await tg('sendMessage', { chat_id: chatId, text: d.startGreeting, reply_markup: mainKeyboard(d) });
      return res.status(200).json({ ok: true });
    }

    if (text === '/cancel' || text === d.cancelBtn) {
      await clearState(chatId);
      await tg('sendMessage', { chat_id: chatId, text: d.cancelled, reply_markup: mainKeyboard(d) });
      return res.status(200).json({ ok: true });
    }

    if (text === '/report' || text === d.reportBtn) {
      await startFlow(chatId, d);
      return res.status(200).json({ ok: true });
    }

    const state = await getState(chatId);

    if (!state) {
      await tg('sendMessage', { chat_id: chatId, text: d.pressButtonBelow, reply_markup: mainKeyboard(d) });
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
        await tg('sendMessage', { chat_id: chatId, text: d.askLocRetry });
        return res.status(200).json({ ok: true });
      }
      state.loc = loc;
      state.mapUrl = mapUrl;
      state.lat = lat;
      state.lon = lon;
      state.step = 'desc';
      await setState(chatId, state);
      await tg('sendMessage', { chat_id: chatId, text: d.askDesc, reply_markup: descKeyboard(d) });
      return res.status(200).json({ ok: true });
    }

    if (state.step === 'desc') {
      if (msg.photo && msg.photo.length) {
        state.photo = msg.photo[msg.photo.length - 1].file_id;
        if (msg.caption) {
          state.desc = [state.desc, msg.caption.trim()].filter(Boolean).join('\n');
        }
        await setState(chatId, state);
        await tg('sendMessage', { chat_id: chatId, text: d.photoReceived, reply_markup: descKeyboard(d) });
        return res.status(200).json({ ok: true });
      }
      if (isSkip(d, text)) {
        state.step = 'phone';
        await setState(chatId, state);
        await tg('sendMessage', { chat_id: chatId, text: d.askPhone, reply_markup: phoneKeyboard(d) });
        return res.status(200).json({ ok: true });
      }
      if (text === d.nextBtn) {
        state.step = 'phone';
        await setState(chatId, state);
        await tg('sendMessage', { chat_id: chatId, text: d.askPhone, reply_markup: phoneKeyboard(d) });
        return res.status(200).json({ ok: true });
      }
      if (text) {
        state.desc = [state.desc, text].filter(Boolean).join('\n');
        await setState(chatId, state);
        await tg('sendMessage', { chat_id: chatId, text: d.descNoted, reply_markup: descKeyboard(d) });
        return res.status(200).json({ ok: true });
      }
      await tg('sendMessage', { chat_id: chatId, text: d.askDescRetry });
      return res.status(200).json({ ok: true });
    }

    if (state.step === 'phone') {
      if (msg.contact && msg.contact.phone_number) {
        state.phone = msg.contact.phone_number;
      } else if (isSkip(d, text)) {
        state.phone = '';
      } else if (text) {
        state.phone = text;
      } else {
        await tg('sendMessage', { chat_id: chatId, text: d.askPhoneRetry });
        return res.status(200).json({ ok: true });
      }
      state.step = 'sev';
      await setState(chatId, state);
      await tg('sendMessage', { chat_id: chatId, text: d.accepted, reply_markup: { remove_keyboard: true } });
      await tg('sendMessage', { chat_id: chatId, text: d.askSev, reply_markup: sevKeyboard(d) });
      return res.status(200).json({ ok: true });
    }

    if (state.step === 'confirm') {
      await tg('sendMessage', { chat_id: chatId, text: d.waitConfirmButtons });
      return res.status(200).json({ ok: true });
    }

    await tg('sendMessage', { chat_id: chatId, text: d.waitSevButtons });
    return res.status(200).json({ ok: true });
  } catch (e) {
    const chatId = (update.message && update.message.chat && update.message.chat.id)
      || (update.callback_query && update.callback_query.message && update.callback_query.message.chat.id);
    if (chatId) {
      try {
        const langCode = (await getLangCode(chatId)) || 'ru';
        await tg('sendMessage', { chat_id: chatId, text: dict[langCode].errorGeneric });
      } catch (_) {}
    }
    return res.status(200).json({ ok: true });
  }
};
