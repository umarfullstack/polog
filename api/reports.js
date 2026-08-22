// Папка: api/reports.js
let reports = [];

export default function handler(req, res) {
  // Разрешаем доступ из браузера
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Учитель отправляет сигнал
  if (req.method === 'POST') {
    const { loc, desc, sev } = req.body;
    if (!loc) {
      return res.status(400).json({ error: 'Укажите локацию' });
    }

    const newReport = { id: Date.now(), loc, desc, sev, ts: new Date().toISOString() };
    reports.unshift(newReport);
    return res.status(201).json({ success: true, report: newReport });
  }

  // 2. Вы в админке получаете список сигналов
  if (req.method === 'GET') {
    return res.status(200).json(reports);
  }

  return res.status(405).end();
}