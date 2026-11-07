/* Вкладка «Прогноз»: карточки на 7 дней и график температуры. */
(function () {
  "use strict";
  var U = window.UI, $ = U.$, $$ = U.$$;
  var chips = $("#city-chips");
  var shown = false;

  function render(d) {
    var days = d.forecast.map(function (f) {
      return Object.assign({}, f, {
        label: U.dayLabel(f.date), short: U.weekdayShort(f.date), day_month: U.dayMonth(f.date),
        condition_label: window.CONDITIONS[f.condition] || f.condition,
        temp_min_text: U.fmtTemp(f.temp_min), temp_max_text: U.fmtTemp(f.temp_max)
      });
    });
    if (d.current) U.setSky(d.current.condition);
    document.title = "Прогноз: " + d.city.name + " · Небо";

    if (!days.length) {
      $("#forecast-page").classList.add("hidden");
      $("#no-data-text").textContent = "Прогноз для города «" + d.city.name + "» пока не заполнен";
      $("#no-data").classList.remove("hidden");
      U.reveal();
      return;
    }
    $("#no-data").classList.add("hidden");
    $("#week").innerHTML = days.map(function (f, i) {
      return '<article class="fcard glass stagger' + (i === 0 ? " today" : "") + '" style="--i:' + i + '" tabindex="0">' +
        '<header><span class="day-name">' + f.label + '</span><span class="muted small">' + f.day_month + "</span></header>" +
        window.icon(f.condition, 72) +
        '<p class="fcard-cond">' + f.condition_label + "</p>" +
        '<p class="fcard-temps"><b>' + f.temp_max_text + '</b><span class="muted">' + f.temp_min_text + "</span></p>" +
        '<div class="precip" title="Вероятность осадков"><span class="precip-bar"><span style="--w:' + f.precipitation + '%"></span></span>' +
        '<span class="small">💧 ' + f.precipitation + "%</span></div></article>";
    }).join("");
    $("#chart-title").textContent = "Температура и осадки · " + d.city.name;
    $("#forecast-page").classList.remove("hidden");
    if (!shown) { U.reveal(); shown = true; }
    window.WeatherChart.render(days);
  }

  function load(id) {
    $$(".chip", chips).forEach(function (c) { c.classList.toggle("active", c.dataset.id === String(id)); });
    try { localStorage.setItem("nebo_city", id); } catch (e) { /* не страшно */ }
    history.replaceState(null, "", "/forecast?city=" + id);
    U.api("GET", "/api/weather/" + id).then(render).catch(function (e) { U.toast(e.message, "error"); });
  }

  U.api("GET", "/api/cities").then(function (cities) {
    if (!cities.length) { $("#no-data").classList.remove("hidden"); U.reveal(); return; }
    chips.innerHTML = cities.map(function (c) {
      return '<button type="button" class="chip" data-id="' + c.id + '">' + U.esc(c.name) + "</button>";
    }).join("");
    var ids = cities.map(function (c) { return String(c.id); });
    var want = new URLSearchParams(location.search).get("city"), saved = null;
    try { saved = localStorage.getItem("nebo_city"); } catch (e) { /* хранилище недоступно */ }
    load(ids.indexOf(want) > -1 ? want : ids.indexOf(saved) > -1 ? saved : ids[0]);
  }).catch(function (e) { U.toast(e.message, "error"); });

  chips.addEventListener("click", function (e) {
    var b = e.target.closest(".chip");
    if (b && !b.classList.contains("active")) load(b.dataset.id);
  });
})();
