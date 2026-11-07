/* Анимированные SVG-иконки погоды. Использование: icon("rain", 64, "float") — возвращает строку SVG. */
(function () {
  "use strict";

  var CONDITIONS = {
    clear: "Ясно",
    partly: "Переменная облачность",
    cloudy: "Пасмурно",
    fog: "Туман",
    rain: "Дождь",
    snow: "Снег",
    storm: "Гроза"
  };

  function cloud(x, y, cls, fill) {
    return '<g class="' + (cls || "wi-cloud") + '" transform="translate(' + (x || 0) + " " + (y || 0) + ')">' +
      '<g fill="' + (fill || "var(--cloud)") + '">' +
      '<circle cx="22" cy="37" r="9"/><circle cx="33" cy="30" r="12.5"/><circle cx="45" cy="37" r="8.5"/>' +
      '<rect x="22" y="33" width="23" height="12.5" rx="2"/></g></g>';
  }

  function sun(cx, cy, r) {
    var rays = "";
    for (var a = 0; a < 360; a += 45) {
      rays += '<line x1="0" y1="-' + (r + 5) + '" x2="0" y2="-' + (r + 10) + '" transform="rotate(' + a + ')"/>';
    }
    return '<g class="wi-sunwrap" transform="translate(' + cx + " " + cy + ')">' +
      '<g class="wi-sun"><g class="wi-rays" stroke="var(--sun)" stroke-width="3" stroke-linecap="round">' + rays + "</g>" +
      '<circle r="' + r + '" fill="var(--sun)"/></g>' +
      '<g class="wi-moon"><path d="M4-11a12 12 0 1 0 8 15 10 10 0 0 1-8-15z" fill="var(--moon)" transform="translate(-4 2)"/></g></g>';
  }

  function drops(lines) {
    return '<g stroke="var(--rain)" stroke-width="2.6" stroke-linecap="round">' + lines + "</g>";
  }

  var BODY = {
    clear: function () { return sun(32, 32, 11); },
    partly: function () { return sun(24, 24, 8) + cloud(4, 6); },
    cloudy: function () { return cloud(-9, -6, "wi-cloud wi-cloud-back", "var(--cloud-dark)") + cloud(4, 4); },
    fog: function () {
      return cloud(0, -4) + '<g stroke="var(--cloud)" stroke-width="3" stroke-linecap="round">' +
        '<line class="wi-fogline" x1="14" y1="48" x2="44" y2="48"/>' +
        '<line class="wi-fogline d2" x1="20" y1="54" x2="50" y2="54"/>' +
        '<line class="wi-fogline d3" x1="12" y1="60" x2="36" y2="60"/></g>';
    },
    rain: function () {
      return drops('<line class="wi-drop" x1="24" y1="44" x2="22" y2="50"/>' +
        '<line class="wi-drop d2" x1="33" y1="44" x2="31" y2="50"/>' +
        '<line class="wi-drop d3" x1="42" y1="44" x2="40" y2="50"/>') + cloud(0, -6);
    },
    snow: function () {
      return '<g fill="var(--snow)"><circle class="wi-flake" cx="23" cy="46" r="2.4"/>' +
        '<circle class="wi-flake d2" cx="33" cy="46" r="2.4"/><circle class="wi-flake d3" cx="43" cy="46" r="2.4"/></g>' + cloud(0, -6);
    },
    storm: function () {
      return drops('<line class="wi-drop" x1="22" y1="44" x2="20" y2="50"/><line class="wi-drop d3" x1="44" y1="44" x2="42" y2="50"/>') +
        '<path class="wi-bolt" d="M34 38 l-6 11 h6 l-3 10 l10-14 h-6 l4-7z" fill="var(--sun)"/>' +
        cloud(0, -6, "wi-cloud", "var(--cloud-dark)");
    }
  };

  window.CONDITIONS = CONDITIONS;
  window.icon = function (condition, size, cls) {
    var body = BODY[condition] || function () { return cloud(0, 0); };
    size = size || 64;
    return '<svg class="wi wi-' + condition + " " + (cls || "") + '" viewBox="0 0 64 64" width="' + size + '" height="' + size +
      '" role="img" aria-label="' + (CONDITIONS[condition] || "") + '">' + body() + "</svg>";
  };
})();
