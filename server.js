/*
 * Сайт погоды «Небо» — сервер на Node.js (без сторонних пакетов).
 *
 * Запуск:  npm start   (или node server.js, или run.bat в Windows)
 * Сайт:    http://127.0.0.1:3000
 * Логин и пароль главного администратора — в файле config.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const config = require('./config');
const DB = require('./db');
const weather = require('./weather');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB_FILE = process.env.NEBO_DB || path.join(ROOT, 'data', 'nebo.db');
const PORT = Number(process.env.PORT) || config.PORT || 3000;

const db = DB.open(DB_FILE);

// ------------------------------------------------------------------ сессии

const sessions = new Map(); // token -> { username, role: 'main' | 'admin' }
const SESSION_COOKIE = 'nebo_sid';

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function currentUser(req) {
  const token = getCookie(req, SESSION_COOKIE);
  const s = token && sessions.get(token);
  if (!s) return null;
  if (s.role === 'admin') {
    // администратора могли удалить или очистить базу — тогда сессия больше не действует
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(s.username);
    if (!exists) { sessions.delete(token); return null; }
  }
  return s;
}

const isMainLogin = (name) => name.toLowerCase() === String(config.MAIN_ADMIN_LOGIN).toLowerCase();

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// ------------------------------------------------------------------ ответы

class HttpError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100 * 1024) { reject(new HttpError(413, 'Слишком большой запрос')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Некорректные данные запроса')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};
const PAGES = { '/': 'index.html', '/forecast': 'forecast.html', '/feedback': 'feedback.html', '/admin': 'admin.html' };

function serveStatic(req, res, pathname) {
  let rel = PAGES[pathname] || decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return notFound(res);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(path.join(PUBLIC, '404.html')).pipe(res);
}

// ------------------------------------------------------------------ маршруты

const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
  routes.push({ method, re, keys, handler, ...opts });
}

const today = () => DB.today();
const num = (v) => Number(String(v ?? '').trim().replace(',', '.').replace('−', '-'));
const log = (user, action) => DB.logAction(db, user.username, action);

// ---------- публичный API

function activeCities() {
  return db.prepare(`SELECT c.id, c.name, c.country, c.description, w.temperature, w.condition
      FROM cities c LEFT JOIN current_weather w ON w.city_id = c.id
      WHERE c.is_active = 1 ORDER BY c.name`).all();
}

route('GET', '/api/cities', () => activeCities());

route('GET', '/api/weather/:id', ({ params }) => {
  const city = db.prepare('SELECT id, name, country, description FROM cities WHERE id = ? AND is_active = 1').get(params.id);
  if (!city) throw new HttpError(404, 'Город не найден');
  const current = db.prepare('SELECT * FROM current_weather WHERE city_id = ?').get(city.id) || null;
  const forecast = db.prepare(`SELECT forecast_date AS date, temp_min, temp_max, condition, precipitation
      FROM forecasts WHERE city_id = ? AND forecast_date >= ? ORDER BY forecast_date LIMIT 7`).all(city.id, today());
  return { city, current, forecast };
});

route('POST', '/api/feedback', ({ body }) => {
  const f = { name: String(body.name || '').trim(), email: String(body.email || '').trim(), message: String(body.message || '').trim() };
  const errors = {};
  if (f.name.length < 2 || f.name.length > 80) errors.name = 'Укажите имя (от 2 до 80 символов).';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) || f.email.length > 120) errors.email = 'Укажите корректный e-mail.';
  if (f.message.length < 5) errors.message = 'Сообщение слишком короткое.';
  if (f.message.length > 2000) errors.message = 'Сообщение длиннее 2000 символов.';
  if (Object.keys(errors).length) throw new HttpError(422, 'Проверьте поля формы', errors);
  db.prepare('INSERT INTO feedback (name, email, message, created_at) VALUES (?, ?, ?, ?)').run(f.name, f.email, f.message, DB.nowStr());
  return { ok: true };
});

// ---------- вход и выход

route('POST', '/api/login', ({ body, res }) => {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  let role = null;
  if (isMainLogin(username) && safeEqual(password, config.MAIN_ADMIN_PASSWORD)) {
    role = 'main';
  } else {
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (u && DB.checkPassword(password, u.password_hash)) role = 'admin';
  }
  if (!role) throw new HttpError(401, 'Неверный логин или пароль');
  const name = role === 'main' ? config.MAIN_ADMIN_LOGIN : username;
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username: name, role });
  DB.logAction(db, name, 'Вход в панель администратора');
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`);
  return { username: name, role };
});

route('POST', '/api/logout', ({ req, res }) => {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  return { ok: true };
});

route('GET', '/api/me', ({ user }) => (user
  ? { username: user.username, role: user.role, unread: db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE is_read = 0').get().n }
  : { username: null }));

// ---------- админ: города

function cityFromBody(body) {
  const data = {
    name: String(body.name || '').trim(),
    country: String(body.country || '').trim() || 'Россия',
    latitude: num(body.latitude),
    longitude: num(body.longitude),
    description: String(body.description || '').trim(),
    is_active: body.is_active === false || body.is_active === 0 ? 0 : 1,
  };
  const errors = {};
  if (data.name.length < 2 || data.name.length > 60) errors.name = 'Введите название города.';
  if (!(Math.abs(data.latitude) <= 90) || String(body.latitude ?? '').trim() === '') errors.latitude = 'Число от −90 до 90.';
  if (!(Math.abs(data.longitude) <= 180) || String(body.longitude ?? '').trim() === '') errors.longitude = 'Число от −180 до 180.';
  if (Object.keys(errors).length) throw new HttpError(422, 'Проверьте поля формы', errors);
  return data;
}

const getCity = (id) => {
  const c = db.prepare('SELECT * FROM cities WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'Город не найден');
  return c;
};

route('GET', '/api/admin/cities', () => db.prepare(`SELECT c.*, w.temperature, w.condition, w.updated_at,
    (SELECT COUNT(*) FROM forecasts f WHERE f.city_id = c.id) AS fc_count
    FROM cities c LEFT JOIN current_weather w ON w.city_id = c.id ORDER BY c.name`).all(), { auth: true });

route('POST', '/api/admin/cities', async ({ body, user }) => {
  const d = cityFromBody(body);
  if (db.prepare('SELECT 1 FROM cities WHERE name = ?').get(d.name)) throw new HttpError(422, 'Проверьте поля формы', { name: 'Город с таким названием уже есть.' });
  const r = db.prepare(`INSERT INTO cities (name, country, latitude, longitude, description, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(d.name, d.country, d.latitude, d.longitude, d.description, d.is_active, DB.nowStr());
  const city = getCity(r.lastInsertRowid);
  let note;
  try { await weather.updateCity(db, city, 5000); note = 'погода загружена из Open-Meteo'; }
  catch { DB.generateDemoWeather(db, city); note = 'нет интернета — заполнены демо-данные'; }
  log(user, `Добавлен город «${d.name}»`);
  return { ok: true, message: `Город «${d.name}» добавлен (${note}).` };
}, { auth: true });

route('PUT', '/api/admin/cities/:id', ({ params, body, user }) => {
  getCity(params.id);
  const d = cityFromBody(body);
  if (db.prepare('SELECT 1 FROM cities WHERE name = ? AND id <> ?').get(d.name, params.id)) throw new HttpError(422, 'Проверьте поля формы', { name: 'Город с таким названием уже есть.' });
  db.prepare('UPDATE cities SET name=?, country=?, latitude=?, longitude=?, description=?, is_active=? WHERE id=?')
    .run(d.name, d.country, d.latitude, d.longitude, d.description, d.is_active, params.id);
  log(user, `Изменён город «${d.name}»`);
  return { ok: true, message: `Город «${d.name}» сохранён.` };
}, { auth: true });

route('POST', '/api/admin/cities/:id/toggle', ({ params, user }) => {
  const c = getCity(params.id);
  db.prepare('UPDATE cities SET is_active = 1 - is_active WHERE id = ?').run(c.id);
  log(user, `${c.is_active ? 'Скрыт' : 'Показан'} город «${c.name}»`);
  return { ok: true, message: `Город «${c.name}» ${c.is_active ? 'скрыт с сайта' : 'снова показан на сайте'}.` };
}, { auth: true });

route('DELETE', '/api/admin/cities/:id', ({ params, user }) => {
  const c = getCity(params.id);
  db.prepare('DELETE FROM cities WHERE id = ?').run(c.id);
  log(user, `Удалён город «${c.name}»`);
  return { ok: true, message: `Город «${c.name}» и его прогнозы удалены.` };
}, { auth: true });

route('GET', '/api/admin/geocode', async ({ query }) => {
  const name = String(query.get('name') || '').trim();
  if (!name) throw new HttpError(400, 'Введите название');
  try { return { results: await weather.geocode(name, 6000) }; }
  catch (e) { throw new HttpError(503, 'Нет связи с сервисом поиска координат. Введите их вручную.'); }
}, { auth: true });

// ---------- админ: погода

route('POST', '/api/admin/refresh', async ({ body, user }) => {
  const cities = body.city_id
    ? db.prepare('SELECT * FROM cities WHERE id = ?').all(Number(body.city_id))
    : db.prepare('SELECT * FROM cities WHERE is_active = 1').all();
  let ok = 0;
  const errors = [];
  for (const city of cities) {
    try { await weather.updateCity(db, city, 6000); ok++; }
    catch (e) {
      errors.push(`${city.name}: ${e.message}`);
      if (ok === 0 && errors.length >= 2) break; // интернета явно нет — не ждём остальные города
    }
  }
  if (ok) log(user, `Обновлена погода из Open-Meteo (${ok} гор.)`);
  return {
    ok,
    message: ok ? `Погода обновлена из интернета для ${ok} город(ов).` : null,
    error: errors.length ? 'Не удалось получить данные из интернета — сайт продолжает работать на данных из базы. ' + errors[0] : null,
  };
}, { auth: true });

route('GET', '/api/admin/weather', () => db.prepare(`SELECT c.id AS city_id, c.name, c.is_active, w.temperature, w.feels_like,
    w.humidity, w.pressure, w.wind_speed, w.condition, w.source, w.updated_at
    FROM cities c LEFT JOIN current_weather w ON w.city_id = c.id ORDER BY c.name`).all(), { auth: true });

route('PUT', '/api/admin/weather/:id', ({ params, body, user }) => {
  const city = getCity(params.id);
  const limits = { temperature: [-90, 60], feels_like: [-100, 70], humidity: [0, 100], pressure: [600, 820], wind_speed: [0, 80] };
  const d = {};
  const errors = {};
  for (const [k, [lo, hi]] of Object.entries(limits)) {
    const v = num(body[k]);
    if (String(body[k] ?? '').trim() === '' || !(v >= lo && v <= hi)) errors[k] = `Значение от ${lo} до ${hi}.`;
    d[k] = k === 'humidity' || k === 'pressure' ? Math.round(v) : Math.round(v * 10) / 10;
  }
  if (!DB.CONDITIONS[body.condition]) errors.condition = 'Выберите состояние погоды.';
  if (Object.keys(errors).length) throw new HttpError(422, 'Проверьте поля формы', errors);
  db.prepare(`INSERT OR REPLACE INTO current_weather (city_id, temperature, feels_like, humidity, pressure, wind_speed,
      condition, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?)`)
    .run(city.id, d.temperature, d.feels_like, d.humidity, d.pressure, d.wind_speed, body.condition, DB.nowStr());
  log(user, `Изменена текущая погода: ${city.name}`);
  return { ok: true, message: `Текущая погода для города «${city.name}» сохранена.` };
}, { auth: true });

// ---------- админ: сообщения

route('GET', '/api/admin/feedback', () => db.prepare('SELECT * FROM feedback ORDER BY is_read, id DESC').all(), { auth: true });

route('POST', '/api/admin/feedback/:id/read', ({ params }) => {
  db.prepare('UPDATE feedback SET is_read = 1 - is_read WHERE id = ?').run(params.id);
  return { ok: true };
}, { auth: true });

route('DELETE', '/api/admin/feedback/:id', ({ params, user }) => {
  db.prepare('DELETE FROM feedback WHERE id = ?').run(params.id);
  log(user, `Удалено сообщение #${params.id}`);
  return { ok: true, message: 'Сообщение удалено.' };
}, { auth: true });

// ---------- админ: база данных

route('GET', '/api/admin/database', () => ({
  file: path.relative(ROOT, DB_FILE).replace(/\\/g, '/'),
  size_kb: Math.round(fs.statSync(DB_FILE).size / 1024),
  tables: DB.TABLE_INFO.map((t) => ({
    ...t,
    count: db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get().n,
    columns: db.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => c.name),
  })),
}), { auth: true });

route('POST', '/api/admin/database/wipe', ({ body, user, req }) => {
  if (user.role !== 'main') throw new HttpError(403, 'Очистить базу может только главный администратор.');
  if (!safeEqual(String(body.password || ''), config.WIPE_PASSWORD)) throw new HttpError(403, 'Неверный пароль. База данных не очищена.');
  DB.wipe(db);
  // все дополнительные администраторы удалены — закрываем их сессии
  const own = getCookie(req, SESSION_COOKIE);
  for (const [token, s] of sessions) if (token !== own && s.role !== 'main') sessions.delete(token);
  console.log(`[!] База данных полностью очищена (${user.username}, ${DB.nowStr()})`);
  return { ok: true, message: 'База данных полностью очищена.' };
}, { auth: true });

// ---------- админ: администраторы

route('GET', '/api/admin/users', () => ({
  main: config.MAIN_ADMIN_LOGIN,
  users: db.prepare('SELECT id, username, created_by, created_at FROM users ORDER BY id').all(),
}), { auth: true });

route('POST', '/api/admin/users', ({ body, user }) => {
  if (user.role !== 'main') throw new HttpError(403, 'Создавать администраторов может только главный администратор.');
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const errors = {};
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) errors.username = 'Логин: 3–30 латинских букв, цифр или символов _ . -';
  else if (isMainLogin(username) || db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) errors.username = 'Такой логин уже занят.';
  if (password.length < 6) errors.password = 'Пароль — не короче 6 символов.';
  if (Object.keys(errors).length) throw new HttpError(422, 'Проверьте поля формы', errors);
  db.prepare('INSERT INTO users (username, password_hash, created_by, created_at) VALUES (?, ?, ?, ?)')
    .run(username, DB.hashPassword(password), user.username, DB.nowStr());
  log(user, `Добавлен администратор «${username}»`);
  return { ok: true, message: `Администратор «${username}» добавлен.` };
}, { auth: true });

route('DELETE', '/api/admin/users/:id', ({ params, user }) => {
  if (user.role !== 'main') throw new HttpError(403, 'Удалять администраторов может только главный администратор.');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
  if (!u) throw new HttpError(404, 'Администратор не найден');
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  log(user, `Удалён администратор «${u.username}»`);
  return { ok: true, message: `Администратор «${u.username}» удалён.` };
}, { auth: true });

route('POST', '/api/admin/password', ({ body, user }) => {
  if (user.role === 'main') throw new HttpError(403, 'Пароль главного администратора задаётся в файле config.js.');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(user.username);
  const errors = {};
  if (!DB.checkPassword(String(body.old || ''), u.password_hash)) errors.old = 'Текущий пароль введён неверно.';
  if (String(body.new || '').length < 6) errors.new = 'Новый пароль — не короче 6 символов.';
  else if (body.new !== body.repeat) errors.repeat = 'Пароли не совпадают.';
  if (Object.keys(errors).length) throw new HttpError(422, 'Проверьте поля формы', errors);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(DB.hashPassword(body.new), u.id);
  log(user, 'Изменён собственный пароль');
  return { ok: true, message: 'Пароль изменён.' };
}, { auth: true });

// ---------- админ: журнал

route('GET', '/api/admin/log', () => db.prepare('SELECT * FROM action_log ORDER BY id DESC LIMIT 300').all(), { auth: true });

// ------------------------------------------------------------------ сервер

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Метод не поддерживается' });
    return serveStatic(req, res, pathname);
  }

  const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
  if (!r) return sendJson(res, 404, { error: 'Не найдено' });

  try {
    // защита от подделки запросов с чужих сайтов: изменяющие запросы шлёт только наш JavaScript
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'nebo') throw new HttpError(403, 'Запрос отклонён');
    const user = currentUser(req);
    if (r.auth && !user) throw new HttpError(401, 'Требуется вход в панель администратора');
    const m = r.re.exec(pathname);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])]));
    const body = req.method === 'GET' ? {} : await readBody(req);
    const result = await r.handler({ req, res, params, body, query: url.searchParams, user });
    sendJson(res, 200, result);
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, fields: e.fields });
    console.error(e);
    sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) sendJson(res, 500, { error: 'Внутренняя ошибка сервера' }); });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n[!] Порт ${PORT} занят — возможно, сайт уже запущен в другом окне.`);
    console.error(`    Закройте его или поменяйте PORT в config.js.\n`);
  } else console.error(e);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log('='.repeat(56));
  console.log(`  Сайт погоды «Небо» запущен:  ${url}`);
  console.log(`  Панель администратора:       ${url}/admin`);
  console.log('  Остановить сервер: Ctrl+C');
  console.log('='.repeat(56));
  if (!process.argv.includes('--no-browser')) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(cmd, () => {});
  }
});
