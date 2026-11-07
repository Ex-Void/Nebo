/* Вкладка «Сейчас»: текущая погода выбранного города и ближайшие 5 дней. */
(function () {
  "use strict";
  var U = window.UI, $ = U.$;
  var select = $("#city-select"), grid = $("#now-grid");
  var first = true;

  function pickCity(cities) {
    var ids = cities.map(function (c) { return String(c.id); });
    var fromUrl = new URLSearchParams(location.search).get("city");
    var saved = null;
    try { saved = localStorage.getItem("nebo_city"); } catch (e) { /* хранилище недоступно */ }
    if (fromUrl && ids.indexOf(fromUrl) > -1) return fromUrl;
    if (saved && ids.indexOf(saved) > -1) return saved;
    return ids[0];
  }

  function setCount(id, value, decimals) {
    var el = $("#" + id);
    el.dataset.from = first ? "0" : el.dataset.count;
    el.dataset.count = value;
    if (decimals) el.dataset.decimals = decimals;
    if (!first) U.countUp(el); // при первой загрузке счётчик запустится при появлении блока
  }

  function render(d) {
    var c = d.current;
    $("#city-name").textContent = d.city.name;
    $("#city-descr").textContent = d.city.description || "";
    document.title = "Погода: " + d.city.name + " · Небо";
    $("#forecast-link").href = "/forecast?city=" + d.city.id;

    if (c) {
      $("#condition").textContent = window.CONDITIONS[c.condition] || c.condition;
      $("#feels").textContent = U.fmtTemp(c.feels_like);
      $("#updated").textContent = U.fmtDt(c.updated_at);
      $("#source").textContent = U.SOURCES[c.source] || c.source;
      $("#hero-icon").innerHTML = window.icon(c.condition, 190, "float");
      setCount("temp", c.temperature);
      setCount("humidity", c.humidity);
      setCount("wind", c.wind_speed, 1);
      setCount("pressure", c.pressure);
      $("#ring").style.setProperty("--p", c.humidity);
      $("#gauge").style.setProperty("--a", Math.max(-90, Math.min(90, (c.pressure - 720) / 60 * 180 - 90)) + "deg");
      $("#wind-box").style.setProperty("--speed", Math.max(8 / (c.wind_speed + 0.5), 0.25) + "s");
      U.setSky(c.condition);
    } else {
      $("#condition").textContent = "Нет данных о текущей погоде";
      $("#hero-icon").innerHTML = window.icon("cloudy", 190, "float");
    }

    var days = $("#days");
    days.innerHTML = d.forecast.slice(0, 5).map(function (f, i) {
      return '<div class="day stagger" style="--i:' + i + '">' +
        '<span class="day-name">' + U.dayLabel(f.date) + "</span>" +
        '<span class="muted small">' + U.dayMonth(f.date) + "</span>" +
        window.icon(f.condition, 54) +
        '<span class="day-temps"><b>' + U.fmtTemp(f.temp_max) + '</b> <span class="muted">' + U.fmtTemp(f.temp_min) + "</span></span></div>";
    }).join("") || '<p class="muted">Прогноз пока не заполнен.</p>';
  }

  function load(id) {
    try { localStorage.setItem("nebo_city", id); } catch (e) { /* не страшно */ }
    if (!first) grid.classList.add("swapping");
    return Promise.all([U.api("GET", "/api/weather/" + id), U.wait(first || U.reduce ? 0 : 320)])
      .then(function (res) {
        render(res[0]);
        history.replaceState(null, "", "/?city=" + id);
        grid.classList.remove("swapping");
        if (first) { $("#now-page").classList.remove("hidden"); U.reveal(); first = false; }
      })
      .catch(function (e) { grid.classList.remove("swapping"); U.toast(e.message, "error"); });
  }

  U.api("GET", "/api/cities").then(function (cities) {
    if (!cities.length) { $("#no-cities").classList.remove("hidden"); U.reveal(); return; }
    select.innerHTML = cities.map(function (c) { return '<option value="' + c.id + '">' + U.esc(c.name) + "</option>"; }).join("");
    select.value = pickCity(cities);
    load(select.value);
  }).catch(function (e) { U.toast(e.message, "error"); });

  select.addEventListener("change", function () { load(select.value); });
})();
