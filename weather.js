/*
 * Загрузка реальной погоды из открытого API Open-Meteo (https://open-meteo.com).
 * Ключ не нужен. Если интернета нет — выбрасывается ошибка, а сайт работает на данных из базы.
 */
const { nowStr } = require('./db');

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const HPA_TO_MMHG = 0.750062;

// Код погоды WMO -> состояние сайта
function wmoToCondition(code) {
  code = Number(code) || 0;
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if (code >= 95) return 'storm';
  if (code >= 51 && code <= 82) return 'rain';
  return 'cloudy';
}

async function getJson(url, params, timeoutMs) {
  const full = url + '?' + new URLSearchParams(params).toString();
  try {
    const resp = await fetch(full, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'NeboWeatherSite/1.0' } });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } catch (e) {
    throw new Error('Сервис погоды недоступен (' + (e.name === 'TimeoutError' ? 'нет ответа' : e.message) + ')');
  }
}

async function fetchWeather(latitude, longitude, timeoutMs = 7000) {
  const data = await getJson(FORECAST_URL, {
    latitude, longitude,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,pressure_msl,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    wind_speed_unit: 'ms', timezone: 'auto', forecast_days: 7,
  }, timeoutMs);
  const c = data.current, d = data.daily;
  if (!c || !d) throw new Error('Неожиданный ответ сервиса погоды');
  const r1 = (v) => Math.round(Number(v) * 10) / 10;
  return {
    current: {
      temperature: r1(c.temperature_2m),
      feels_like: r1(c.apparent_temperature),
      humidity: Math.round(c.relative_humidity_2m),
      pressure: Math.round(c.pressure_msl * HPA_TO_MMHG),
      wind_speed: r1(c.wind_speed_10m),
      condition: wmoToCondition(c.weather_code),
    },
    forecast: d.time.map((date, i) => ({
      date,
      temp_min: r1(d.temperature_2m_min[i]),
      temp_max: r1(d.temperature_2m_max[i]),
      condition: wmoToCondition(d.weather_code[i]),
      precipitation: Math.round((d.precipitation_probability_max || [])[i] || 0),
    })),
  };
}

// Скачивает погоду для города и сохраняет её в базу
async function updateCity(db, city, timeoutMs) {
  const { current: w, forecast } = await fetchWeather(city.latitude, city.longitude, timeoutMs);
  db.prepare(`INSERT OR REPLACE INTO current_weather
      (city_id, temperature, feels_like, humidity, pressure, wind_speed, condition, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open-meteo', ?)`)
    .run(city.id, w.temperature, w.feels_like, w.humidity, w.pressure, w.wind_speed, w.condition, nowStr());
  const ins = db.prepare(`INSERT OR REPLACE INTO forecasts
      (city_id, forecast_date, temp_min, temp_max, condition, precipitation) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const f of forecast) ins.run(city.id, f.date, f.temp_min, f.temp_max, f.condition, f.precipitation);
}

// Поиск координат города по названию
async function geocode(name, timeoutMs = 7000) {
  const data = await getJson(GEOCODE_URL, { name, count: 5, language: 'ru', format: 'json' }, timeoutMs);
  return (data.results || []).map((r) => ({
    name: r.name, country: r.country || '', region: r.admin1 || '', latitude: r.latitude, longitude: r.longitude,
  }));
}

module.exports = { wmoToCondition, updateCity, geocode };
