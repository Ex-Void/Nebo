/*
 * База данных SQLite.
 *
 * Таблицы:
 *   cities           — города
 *   current_weather  — текущая погода (одна запись на город)
 *   forecasts        — прогноз по дням
 *   feedback         — сообщения из формы обратной связи
 *   users            — дополнительные администраторы (главный задаётся в config.js)
 *   action_log       — журнал действий администраторов
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// убираем предупреждение «SQLite is an experimental feature» из консоли
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  if (String(warning).includes('SQLite')) return;
  return emitWarning.call(process, warning, ...args);
};

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('\n[!] Для работы сайта нужен Node.js версии 22.13 или новее (сейчас ' + process.version + ').');
  console.error('    Скачайте LTS-версию с https://nodejs.org/ и запустите сайт снова.\n');
  process.exit(1);
}

const CONDITIONS = {
  clear: 'Ясно',
  partly: 'Переменная облачность',
  cloudy: 'Пасмурно',
  fog: 'Туман',
  rain: 'Дождь',
  snow: 'Снег',
  storm: 'Гроза',
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  country     TEXT    NOT NULL DEFAULT 'Россия',
  latitude    REAL    NOT NULL,
  longitude   REAL    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS current_weather (
  city_id     INTEGER PRIMARY KEY REFERENCES cities(id) ON DELETE CASCADE,
  temperature REAL    NOT NULL,
  feels_like  REAL    NOT NULL,
  humidity    INTEGER NOT NULL,
  pressure    INTEGER NOT NULL,
  wind_speed  REAL    NOT NULL,
  condition   TEXT    NOT NULL,
  source      TEXT    NOT NULL DEFAULT 'manual',
  updated_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS forecasts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id       INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  forecast_date TEXT    NOT NULL,
  temp_min      REAL    NOT NULL,
  temp_max      REAL    NOT NULL,
  condition     TEXT    NOT NULL,
  precipitation INTEGER NOT NULL DEFAULT 0,
  UNIQUE (city_id, forecast_date)
);
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  email      TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_by    TEXT    NOT NULL,
  created_at    TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS action_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forecasts_city_date ON forecasts(city_id, forecast_date);
`;

// Описание таблиц для раздела «База данных» в панели администратора
const TABLE_INFO = [
  { name: 'cities', title: 'Города', about: 'Список городов: название, страна, координаты, описание и признак «показывать на сайте».' },
  { name: 'current_weather', title: 'Текущая погода', about: 'Погода в каждом городе сейчас: температура, «ощущается как», влажность, давление, ветер, состояние, источник данных и время обновления. Одна запись на город.' },
  { name: 'forecasts', title: 'Прогнозы', about: 'Прогноз по дням: дата, минимальная и максимальная температура, состояние погоды и вероятность осадков.' },
  { name: 'feedback', title: 'Сообщения', about: 'Сообщения посетителей из формы обратной связи: имя, e-mail, текст, отметка о прочтении.' },
  { name: 'users', title: 'Администраторы', about: 'Дополнительные администраторы, созданные главным. Пароли хранятся только в виде хеша. Главный администратор задаётся в файле config.js и в базе не хранится.' },
  { name: 'action_log', title: 'Журнал действий', about: 'Кто из администраторов, когда и что изменил на сайте.' },
];

// Города для начального наполнения: название, широта, долгота, поправка к климату, описание
const SEED_CITIES = [
  ['Москва', 55.7558, 37.6173, 0.0, 'Столица России, крупнейший город страны.'],
  ['Санкт-Петербург', 59.9343, 30.3351, 1.0, 'Культурная столица на берегу Финского залива.'],
  ['Казань', 55.7963, 49.1088, -0.5, 'Столица Татарстана на берегу Волги.'],
  ['Екатеринбург', 56.8389, 60.6057, -2.0, 'Крупный город на Среднем Урале.'],
  ['Новосибирск', 55.0084, 82.9357, -4.0, 'Крупнейший город Сибири на реке Обь.'],
  ['Сочи', 43.6028, 39.7342, 5.0, 'Курорт на Черноморском побережье.'],
  ['Калининград', 54.7104, 20.4522, 3.0, 'Самый западный областной центр России.'],
  ['Владивосток', 43.1155, 131.8855, -1.0, 'Порт на берегу Тихого океана.'],
  ['Мурманск', 68.9585, 33.0827, 1.0, 'Крупнейший город за Полярным кругом.'],
];
const CLIMATE_OFFSET = Object.fromEntries(SEED_CITIES.map((c) => [c[0], c[3]]));

const pad = (n) => String(n).padStart(2, '0');
function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function today() {
  return isoDate(new Date());
}

// ---------------------------------------------------------------- пароли

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function checkPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

// ---------------------------------------------------------------- демо-данные

// Детерминированный генератор случайных чисел (одинаковые демо-данные в течение дня)
function rng(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const uniform = (r, a, b) => a + r() * (b - a);
const randint = (r, a, b) => Math.floor(uniform(r, a, b + 1));
const round1 = (v) => Math.round(v * 10) / 10;

function climateTemp(latitude, day, name) {
  const lat = Math.abs(latitude);
  const mean = 27 - 0.4 * lat;
  const amplitude = Math.max(0.3 * lat - 2, 2);
  const start = new Date(day.getFullYear(), 0, 0);
  const doy = Math.floor((day - start) / 86400000);
  return mean - amplitude * Math.cos((2 * Math.PI * (doy - 20)) / 365) + (CLIMATE_OFFSET[name] || 0);
}

function pickCondition(r, temp) {
  let pool;
  if (temp <= -1) pool = [['snow', 4], ['cloudy', 3], ['partly', 2], ['clear', 2], ['fog', 1]];
  else if (temp <= 3) pool = [['cloudy', 4], ['rain', 3], ['snow', 2], ['partly', 2], ['fog', 1], ['clear', 1]];
  else pool = [['partly', 3], ['cloudy', 3], ['rain', 3], ['clear', 2], ['fog', 1], ['storm', 1]];
  const total = pool.reduce((s, p) => s + p[1], 0);
  let x = r() * total;
  for (const [name, w] of pool) {
    if ((x -= w) < 0) return name;
  }
  return pool[0][0];
}

const PRECIP = { clear: [0, 10], partly: [5, 30], cloudy: [20, 50], fog: [10, 30], rain: [60, 95], snow: [60, 95], storm: [70, 100] };

function generateDemoWeather(db, city, days = 7) {
  const now = new Date();
  const r = rng(`${city.id}-${today()}`);
  const base = climateTemp(city.latitude, now, city.name);
  const temp = round1(base + uniform(r, -2.5, 2.5));
  const cond = pickCondition(r, temp);
  const wind = round1(uniform(r, 1, 9));
  db.prepare(`INSERT OR REPLACE INTO current_weather
      (city_id, temperature, feels_like, humidity, pressure, wind_speed, condition, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'demo', ?)`)
    .run(city.id, temp, round1(temp - wind * 0.6), randint(r, 55, 95), randint(r, 735, 770), wind, cond, nowStr());

  const ins = db.prepare(`INSERT OR REPLACE INTO forecasts
      (city_id, forecast_date, temp_min, temp_max, condition, precipitation) VALUES (?, ?, ?, ?, ?, ?)`);
  for (let i = 0; i < days; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const mid = climateTemp(city.latitude, day, city.name) + uniform(r, -3, 3);
    const spread = uniform(r, 3, 8);
    const c = i === 0 ? cond : pickCondition(r, mid);
    const [lo, hi] = PRECIP[c];
    ins.run(city.id, isoDate(day), round1(mid - spread / 2), round1(mid + spread / 2), c, randint(r, lo, hi));
  }
}

// Если у города не осталось прогноза на сегодня и далее — достраиваем демо-прогноз
function ensureFreshForecasts(db) {
  const stale = db.prepare(`SELECT * FROM cities c WHERE NOT EXISTS
      (SELECT 1 FROM forecasts f WHERE f.city_id = c.id AND f.forecast_date >= ?)`).all(today());
  for (const city of stale) generateDemoWeather(db, city);
}

function seed(db) {
  const ins = db.prepare(`INSERT INTO cities (name, country, latitude, longitude, description, created_at)
      VALUES (?, 'Россия', ?, ?, ?, ?)`);
  for (const [name, lat, lon, , descr] of SEED_CITIES) ins.run(name, lat, lon, descr, nowStr());
  for (const city of db.prepare('SELECT * FROM cities').all()) generateDemoWeather(db, city);
  db.prepare('INSERT INTO feedback (name, email, message, created_at) VALUES (?, ?, ?, ?)')
    .run('Иван', 'ivan@example.com', 'Отличный сайт! Добавьте, пожалуйста, Тулу.', nowStr());
}

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const isNew = !fs.existsSync(file);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // Начальные данные — только при создании новой базы.
  // Чтобы вернуть сайт к исходному состоянию, удалите файл базы data/nebo.db.
  if (isNew) seed(db);
  else ensureFreshForecasts(db);
  return db;
}

// Полная очистка базы данных
function wipe(db) {
  db.exec('BEGIN');
  try {
    for (const t of ['forecasts', 'current_weather', 'cities', 'feedback', 'users', 'action_log']) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM sqlite_sequence");
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  db.exec('VACUUM');
}

function logAction(db, username, action) {
  db.prepare('INSERT INTO action_log (username, action, created_at) VALUES (?, ?, ?)').run(username, action, nowStr());
}

module.exports = {
  CONDITIONS, TABLE_INFO, open, wipe, logAction, generateDemoWeather,
  hashPassword, checkPassword, nowStr, today,
};
