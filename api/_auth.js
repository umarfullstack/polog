// Общая проверка доступа для админских эндпоинтов.
// Требует переменную окружения ADMIN_TOKEN на Vercel — без неё доступ закрыт по умолчанию (fail closed).
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function checkAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const header = req.headers['x-admin-token'];
  const query = req.query && req.query.token;
  return header === ADMIN_TOKEN || query === ADMIN_TOKEN;
}

module.exports = { checkAdmin };
