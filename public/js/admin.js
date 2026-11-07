/* Панель администратора: вход, разделы «Города», «Текущая погода», «Сообщения»,
   «База данных», «Администраторы», «Журнал». Разделы переключаются без перезагрузки (#адрес). */
(function () {
  "use strict";
  var U = window.UI, $ = U.$, $$ = U.$$, esc = U.esc;
  var main = $("#admin-main");
  var me = null; // { username, role: "main" | "admin" }

  var CONDS = window.CONDITIONS;
  var isMain = function () { return me && me.role === "main"; };

  /* ================================================================ вход / выход */

  function showLogin() {
    me = null;
    $("#panel").classList.add("hidden");
    $("#login").classList.remove("hidden");
    $("#login-icon").innerHTML = window.icon("clear", 80, "float");
    $("#l-user").focus();
  }

  function showPanel(user) {
    me = user;
    $("#login").classList.add("hidden");
    $("#panel").classList.remove("hidden");
    $("#avatar").textContent = me.username.charAt(0).toUpperCase();
    $("#who-name").textContent = me.username;
    $("#who-role").textContent = isMain() ? "главный администратор" : "администратор";
    setUnread(me.unread || 0);
    route();
  }

  function setUnread(n) {
    var b = $("#side-badge");
    b.textContent = n; b.classList.toggle("hidden", !n);
    U.updateBadge(n);
  }
  function refreshUnread() {
    U.api("GET", "/api/me").then(function (m) { if (m.username) setUnread(m.unread); }).catch(function () {});
  }

  $("#login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, err = $("#login-error"), btn = $("button", f);
    btn.classList.add("loading");
    U.api("POST", "/api/login", { username: f.username.value, password: f.password.value })
      .then(function () { return U.api("GET", "/api/me"); })
      .then(function (m) { f.reset(); err.classList.add("hidden"); showPanel(m); })
      .catch(function (ex) {
        err.textContent = ex.message; err.classList.remove("hidden");
        var box = $("#login"); box.classList.remove("shake"); void box.offsetWidth; box.classList.add("shake");
      })
      .then(function () { btn.classList.remove("loading"); });
  });

  $("#logout").addEventListener("click", function () {
    U.api("POST", "/api/logout").then(function () { U.toast("Вы вышли из панели администратора.", "info"); showLogin(); });
  });

  // общая обработка ошибок: если сессия закончилась — снова показываем вход
  function fail(e) {
    if (e.status === 401) { U.toast("Сессия завершена, войдите снова.", "error"); showLogin(); return; }
    U.toast(e.message, "error");
  }

  /* ================================================================ навигация по разделам */

  var SECTIONS = { cities: cities, weather: weather, feedback: feedback, database: database, users: users, log: log };

  function route() {
    if (!me) return;
    var parts = (location.hash.replace("#", "") || "cities").split("/");
    var name = SECTIONS[parts[0]] ? parts[0] : "cities";
    $$("#side-nav a").forEach(function (a) { a.classList.toggle("active", a.dataset.section === name); });
    SECTIONS[name](parts[1]);
  }
  window.addEventListener("hashchange", route);

  function draw(html) {
    main.innerHTML = html;
    U.reveal(main);
  }
  function head(title, actions) {
    return '<div class="admin-head reveal"><h1>' + title + "</h1>" + (actions ? '<div class="actions">' + actions + "</div>" : "") + "</div>";
  }
  var loading = function () { main.innerHTML = '<p class="muted">Загрузка…</p>'; };

  function condPicker(selected) {
    return '<p class="muted small">Состояние погоды</p><div class="cond-picker">' + Object.keys(CONDS).map(function (k) {
      return '<label class="cond-opt"><input type="radio" name="condition" value="' + k + '"' + (k === selected ? " checked" : "") + ">" +
        "<span>" + window.icon(k, 44) + "<small>" + CONDS[k] + "</small></span></label>";
    }).join("") + '<span class="field-error"></span></div>';
  }
  function field(name, label, value, extra) {
    return '<div class="field"><input id="fld-' + name + '" name="' + name + '" value="' + esc(value == null ? "" : value) + '" placeholder=" "' + (extra || "") + ">" +
      '<label for="fld-' + name + '">' + label + '</label><span class="field-error"></span></div>';
  }
  function formData(form) {
    var data = {};
    $$("input, textarea, select", form).forEach(function (el) {
      if (!el.name) return;
      if (el.type === "checkbox") data[el.name] = el.checked;
      else if (el.type === "radio") { if (el.checked) data[el.name] = el.value; }
      else data[el.name] = el.value;
    });
    return data;
  }
  // отправка формы раздела с подсветкой ошибок
  function submitForm(form, method, url, done) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = $("button[type=submit]", form);
      btn.classList.add("loading");
      U.api(method, url, formData(form))
        .then(function (r) { U.toast(r.message, "success"); done(r); })
        .catch(function (ex) { U.showFieldErrors(form, ex.fields); if (ex.status === 401) fail(ex); else U.toast(ex.message, "error"); })
        .then(function () { btn.classList.remove("loading"); });
    });
  }
  function refreshButton(cityId, label, cls) {
    return '<button type="button" class="btn ' + (cls || "btn-primary") + '" data-refresh="' + (cityId || "") + '"' +
      (cityId ? ' title="Загрузить погоду из Open-Meteo"' : "") + ">" + label + "</button>";
  }
  // кнопка «Обновить из интернета» (во всех разделах)
  main.addEventListener("click", function (e) {
    var b = e.target.closest("[data-refresh]");
    if (!b) return;
    b.classList.add("loading");
    U.api("POST", "/api/admin/refresh", b.dataset.refresh ? { city_id: b.dataset.refresh } : {})
      .then(function (r) {
        if (r.message) U.toast(r.message, "success");
        if (r.error) U.toast(r.error, "error");
        route();
      })
      .catch(fail)
      .then(function () { b.classList.remove("loading"); });
  });

  /* ================================================================ Города */

  function cities(sub) {
    if (sub) return cityForm(sub === "new" ? null : Number(sub));
    loading();
    U.api("GET", "/api/admin/cities").then(function (rows) {
      draw(head("Города", '<input type="search" id="city-filter" placeholder="Поиск по названию">' +
          '<a class="btn btn-primary" href="#cities/new">+ Добавить город</a>') +
        '<section class="glass panel reveal"><div class="table-wrap"><table class="table">' +
        "<thead><tr><th>ID</th><th>Город</th><th>Координаты</th><th>Сейчас</th><th>Прогнозов</th><th>На сайте</th><th></th></tr></thead><tbody>" +
        (rows.map(function (r, i) {
          return '<tr class="stagger" style="--i:' + i + '" data-name="' + esc(r.name.toLowerCase()) + '">' +
            '<td class="muted">' + r.id + "</td>" +
            "<td><b>" + esc(r.name) + '</b><br><span class="muted small">' + esc(r.country) + "</span></td>" +
            '<td class="small">' + r.latitude.toFixed(4) + ", " + r.longitude.toFixed(4) + "</td>" +
            "<td>" + (r.temperature != null ? '<span class="cell-icon">' + window.icon(r.condition, 28) + "</span> " + U.fmtTemp(r.temperature) : "—") + "</td>" +
            "<td>" + r.fc_count + "</td>" +
            '<td><button type="button" class="switch' + (r.is_active ? " on" : "") + '" data-toggle="' + r.id + '" title="Показать / скрыть на сайте"><span></span></button></td>' +
            '<td class="row-actions">' + refreshButton(r.id, "⟳", "btn-sm btn-ghost") +
            '<a class="btn btn-sm btn-ghost" href="#cities/' + r.id + '">Изменить</a>' +
            '<button type="button" class="btn btn-sm btn-danger" data-delete="' + r.id + '" data-name="' + esc(r.name) + '">Удалить</button></td></tr>';
        }).join("") || '<tr><td colspan="7" class="muted">Городов нет. Добавьте первый город.</td></tr>') +
        "</tbody></table></div></section>");

      $("#city-filter").addEventListener("input", function (e) {
        var q = e.target.value.trim().toLowerCase();
        $$("tbody tr[data-name]", main).forEach(function (tr) { tr.style.display = tr.dataset.name.indexOf(q) > -1 ? "" : "none"; });
      });
      $$("[data-toggle]", main).forEach(function (b) {
        b.addEventListener("click", function () {
          b.classList.toggle("on");
          U.api("POST", "/api/admin/cities/" + b.dataset.toggle + "/toggle").then(function (r) { U.toast(r.message, "info"); }).catch(function (ex) { b.classList.toggle("on"); fail(ex); });
        });
      });
      $$("[data-delete]", main).forEach(function (b) {
        b.addEventListener("click", function () {
          U.confirm("Удалить город «" + b.dataset.name + "» вместе с погодой и прогнозами?", "Удалить").then(function (ok) {
            if (!ok) return;
            U.api("DELETE", "/api/admin/cities/" + b.dataset.delete).then(function (r) { U.toast(r.message, "success"); route(); }).catch(fail);
          });
        });
      });
    }).catch(fail);
  }

  function cityForm(id) {
    var render = function (c) {
      draw(head(c ? "Город «" + esc(c.name) + "»" : "Новый город", '<a class="btn btn-ghost" href="#cities">← К списку</a>') +
        '<section class="glass panel form-card reveal"><form class="form" id="city-form" novalidate>' +
        '<div class="field-row">' + field("name", "Название", c && c.name) +
        '<button type="button" class="btn btn-ghost" id="geocode-btn">Найти координаты</button></div>' +
        '<div class="geo-results" id="geo-results"></div>' +
        field("country", "Страна", c ? c.country : "Россия") +
        '<div class="grid-2">' + field("latitude", "Широта", c && c.latitude, ' inputmode="decimal"') +
        field("longitude", "Долгота", c && c.longitude, ' inputmode="decimal"') + "</div>" +
        '<div class="field"><textarea id="fld-description" name="description" rows="3" placeholder=" ">' + esc(c ? c.description : "") + "</textarea>" +
        '<label for="fld-description">Описание</label></div>' +
        '<label class="check-row"><input type="checkbox" name="is_active"' + (!c || c.is_active ? " checked" : "") + "> Показывать на сайте</label>" +
        (c ? "" : '<p class="muted small">После добавления сайт попробует загрузить погоду из интернета; если связи нет — заполнит демо-данные, которые можно отредактировать в разделе «Текущая погода».</p>') +
        '<button class="btn btn-primary" type="submit">Сохранить</button></form></section>');
      var form = $("#city-form");
      submitForm(form, c ? "PUT" : "POST", "/api/admin/cities" + (c ? "/" + c.id : ""), function () { location.hash = "#cities"; });

      $("#geocode-btn").addEventListener("click", function () {
        var btn = this, box = $("#geo-results"), name = form.name.value.trim();
        if (!name) { U.toast("Сначала введите название города", "error"); return; }
        btn.classList.add("loading"); box.innerHTML = "";
        U.api("GET", "/api/admin/geocode?name=" + encodeURIComponent(name))
          .then(function (d) {
            if (!d.results.length) { U.toast("Город не найден, введите координаты вручную", "error"); return; }
            d.results.forEach(function (r) {
              var b = document.createElement("button");
              b.type = "button"; b.className = "chip";
              b.textContent = r.name + (r.region ? ", " + r.region : "") + (r.country ? " (" + r.country + ")" : "");
              b.addEventListener("click", function () {
                form.name.value = r.name; form.country.value = r.country || "";
                form.latitude.value = r.latitude; form.longitude.value = r.longitude;
                box.innerHTML = ""; U.toast("Координаты подставлены", "success");
              });
              box.appendChild(b);
            });
          })
          .catch(fail)
          .then(function () { btn.classList.remove("loading"); });
      });
    };
    if (!id) return render(null);
    loading();
    U.api("GET", "/api/admin/cities").then(function (rows) {
      var c = rows.filter(function (r) { return r.id === id; })[0];
      if (!c) { U.toast("Город не найден", "error"); location.hash = "#cities"; return; }
      render(c);
    }).catch(fail);
  }

  /* ================================================================ Текущая погода */

  function weather(sub) {
    loading();
    U.api("GET", "/api/admin/weather").then(function (rows) {
      if (sub) {
        var r = rows.filter(function (x) { return x.city_id === Number(sub); })[0];
        if (!r) { location.hash = "#weather"; return; }
        return weatherForm(r);
      }
      draw(head("Текущая погода", refreshButton(null, "⟳ Обновить все из интернета")) +
        '<section class="glass panel reveal"><div class="table-wrap"><table class="table">' +
        "<thead><tr><th>Город</th><th>Состояние</th><th>t°</th><th>Ощущ.</th><th>Влажн.</th><th>Давл.</th><th>Ветер</th><th>Источник</th><th>Обновлено</th><th></th></tr></thead><tbody>" +
        (rows.map(function (r, i) {
          var cells = r.temperature == null ? '<td colspan="8" class="muted">нет данных</td>' :
            '<td><span class="cell-icon">' + window.icon(r.condition, 28) + "</span> " + CONDS[r.condition] + "</td>" +
            "<td><b>" + U.fmtTemp(r.temperature) + "</b></td><td>" + U.fmtTemp(r.feels_like) + "</td>" +
            "<td>" + r.humidity + "%</td><td>" + r.pressure + "</td><td>" + r.wind_speed + " м/с</td>" +
            '<td><span class="pill pill-' + r.source + '">' + (U.SOURCES[r.source] || r.source) + "</span></td>" +
            '<td class="small muted">' + U.fmtDt(r.updated_at) + "</td>";
          return '<tr class="stagger' + (r.is_active ? "" : " dim") + '" style="--i:' + i + '"><td><b>' + esc(r.name) + "</b></td>" + cells +
            '<td><a class="btn btn-sm btn-ghost" href="#weather/' + r.city_id + '">Изменить</a></td></tr>';
        }).join("") || '<tr><td colspan="10" class="muted">Городов нет.</td></tr>') +
        "</tbody></table></div></section>");
    }).catch(fail);
  }

  function weatherForm(r) {
    var fields = [["temperature", "Температура, °C"], ["feels_like", "Ощущается как, °C"], ["humidity", "Влажность, %"],
                  ["pressure", "Давление, мм рт. ст."], ["wind_speed", "Ветер, м/с"]];
    draw(head("Текущая погода · " + esc(r.name), '<a class="btn btn-ghost" href="#weather">← Назад</a>') +
      '<section class="glass panel form-card reveal"><form class="form" id="weather-form" novalidate>' +
      condPicker(r.condition || "clear") +
      '<div class="grid-3">' + fields.map(function (f) { return field(f[0], f[1], r[f[0]], ' inputmode="decimal"'); }).join("") + "</div>" +
      '<button class="btn btn-primary" type="submit">Сохранить</button></form></section>');
    submitForm($("#weather-form"), "PUT", "/api/admin/weather/" + r.city_id, function () { location.hash = "#weather"; });
  }

  /* ================================================================ Сообщения */

  function feedback() {
    loading();
    U.api("GET", "/api/admin/feedback").then(function (rows) {
      draw(head("Сообщения посетителей") + '<section class="messages">' + (rows.map(function (r, i) {
        return '<article class="message glass stagger' + (r.is_read ? "" : " unread") + '" style="--i:' + i + '">' +
          "<header><div><b>" + esc(r.name) + '</b> <a class="muted small" href="mailto:' + esc(r.email) + '">' + esc(r.email) + "</a></div>" +
          '<span class="muted small">' + U.fmtDt(r.created_at) + "</span></header>" +
          "<p>" + esc(r.message) + "</p>" +
          '<footer class="row-actions">' +
          '<button type="button" class="btn btn-sm btn-ghost" data-read="' + r.id + '">' + (r.is_read ? "Отметить непрочитанным" : "✓ Прочитано") + "</button>" +
          '<button type="button" class="btn btn-sm btn-danger" data-del="' + r.id + '" data-name="' + esc(r.name) + '">Удалить</button></footer></article>';
      }).join("") || '<p class="glass panel muted">Сообщений пока нет.</p>') + "</section>");

      $$("[data-read]", main).forEach(function (b) {
        b.addEventListener("click", function () {
          U.api("POST", "/api/admin/feedback/" + b.dataset.read + "/read").then(function () { refreshUnread(); route(); }).catch(fail);
        });
      });
      $$("[data-del]", main).forEach(function (b) {
        b.addEventListener("click", function () {
          U.confirm("Удалить сообщение от «" + b.dataset.name + "»?", "Удалить").then(function (ok) {
            if (ok) U.api("DELETE", "/api/admin/feedback/" + b.dataset.del).then(function (r) { U.toast(r.message, "success"); refreshUnread(); route(); }).catch(fail);
          });
        });
      });
    }).catch(fail);
  }

  /* ================================================================ База данных */

  function database() {
    loading();
    U.api("GET", "/api/admin/database").then(function (d) {
      var wipe = isMain()
        ? '<section class="glass panel danger-zone reveal"><h2>Полная очистка базы данных</h2>' +
          '<p class="muted">Будут безвозвратно удалены все города, погода, прогнозы, сообщения, дополнительные администраторы и журнал. ' +
          "Для подтверждения введите пароль очистки.</p>" +
          '<form class="form wipe-form" id="wipe-form" autocomplete="off">' +
          '<div class="field"><input id="fld-wipe" name="password" type="password" placeholder=" " autocomplete="off">' +
          '<label for="fld-wipe">Пароль очистки</label><span class="field-error"></span></div>' +
          '<button class="btn btn-danger" type="submit">Очистить базу данных</button></form></section>'
        : '<p class="muted small reveal">Полностью очистить базу данных может только главный администратор.</p>';

      draw(head("База данных") +
        '<p class="muted reveal">Все данные сайта хранятся в файле <code>' + esc(d.file) + "</code> (SQLite, " + d.size_kb + " КБ). Ниже — что хранится в каждой таблице.</p>" +
        '<div class="db-cards">' + d.tables.map(function (t, i) {
          return '<article class="glass db-card stagger" style="--i:' + i + '">' +
            '<header><h3>' + t.title + '</h3><span class="pill">' + t.count + " зап.</span></header>" +
            '<p class="small"><code>' + t.name + "</code></p>" +
            "<p>" + esc(t.about) + "</p>" +
            '<p class="muted small">Поля: ' + t.columns.join(", ") + "</p></article>";
        }).join("") + "</div>" + wipe);

      var form = $("#wipe-form");
      if (form) form.addEventListener("submit", function (e) {
        e.preventDefault();
        var pass = form.password.value;
        if (!pass) { U.showFieldErrors(form, { password: "Введите пароль очистки." }); return; }
        U.confirm("Удалить ВСЕ данные из базы? Это действие нельзя отменить.", "Очистить").then(function (ok) {
          if (!ok) return;
          var btn = $("button", form); btn.classList.add("loading");
          U.api("POST", "/api/admin/database/wipe", { password: pass })
            .then(function (r) { U.toast(r.message, "success"); setUnread(0); route(); })
            .catch(function (ex) {
              form.password.value = "";
              U.showFieldErrors(form, { password: ex.message });
              if (ex.status === 401) fail(ex);
            })
            .then(function () { btn.classList.remove("loading"); });
        });
      });
    }).catch(fail);
  }

  /* ================================================================ Администраторы */

  function users() {
    loading();
    U.api("GET", "/api/admin/users").then(function (d) {
      var rows = '<tr class="stagger" style="--i:0"><td class="muted">—</td><td><b>' + esc(d.main) + '</b> <span class="pill pill-main">главный</span>' +
        (me.username === d.main ? ' <span class="pill">это вы</span>' : "") + '</td><td class="small muted">config.js</td><td></td></tr>' +
        d.users.map(function (u, i) {
          return '<tr class="stagger" style="--i:' + (i + 1) + '"><td class="muted">' + u.id + "</td><td><b>" + esc(u.username) + "</b>" +
            (u.username === me.username ? ' <span class="pill">это вы</span>' : "") + "</td>" +
            '<td class="small muted">' + U.fmtDt(u.created_at) + "</td><td>" +
            (isMain() ? '<button type="button" class="btn btn-sm btn-danger" data-user="' + u.id + '" data-name="' + esc(u.username) + '">Удалить</button>' : "") +
            "</td></tr>";
        }).join("");

      var right = isMain()
        ? '<section class="glass panel reveal"><h2>Новый администратор</h2>' +
          '<form class="form" id="user-form" novalidate autocomplete="off">' +
          field("username", "Логин", "", ' autocomplete="off"') +
          '<div class="field"><input id="fld-password" name="password" type="password" placeholder=" " autocomplete="new-password">' +
          '<label for="fld-password">Пароль (от 6 символов)</label><span class="field-error"></span></div>' +
          '<button class="btn btn-primary" type="submit">Добавить</button></form>' +
          '<p class="muted small mt">Созданные администраторы могут работать с городами, погодой и сообщениями, но не могут создавать и удалять администраторов и очищать базу данных. '
        : '<section class="glass panel reveal"><h2>Сменить мой пароль</h2>' +
          '<form class="form" id="pass-form" novalidate>' +
          ["old:Текущий пароль", "new:Новый пароль", "repeat:Повторите новый пароль"].map(function (x) {
            var p = x.split(":");
            return '<div class="field"><input id="fld-' + p[0] + '" name="' + p[0] + '" type="password" placeholder=" ">' +
              '<label for="fld-' + p[0] + '">' + p[1] + '</label><span class="field-error"></span></div>';
          }).join("") +
          '<button class="btn btn-primary" type="submit">Изменить пароль</button></form>' +
          '<p class="muted small mt">Создавать и удалять администраторов может только главный администратор.</p></section>';

      draw(head("Администраторы") + '<div class="two-col"><section class="glass panel reveal"><h2>Учётные записи</h2>' +
        '<table class="table"><thead><tr><th>ID</th><th>Логин</th><th>Создан</th><th></th></tr></thead><tbody>' + rows +
        "</tbody></table></section>" + right + "</div>");

      if (isMain()) {
        submitForm($("#user-form"), "POST", "/api/admin/users", function () { route(); });
        $$("[data-user]", main).forEach(function (b) {
          b.addEventListener("click", function () {
            U.confirm("Удалить администратора «" + b.dataset.name + "»?", "Удалить").then(function (ok) {
              if (ok) U.api("DELETE", "/api/admin/users/" + b.dataset.user).then(function (r) { U.toast(r.message, "success"); route(); }).catch(fail);
            });
          });
        });
      } else {
        var pf = $("#pass-form");
        submitForm(pf, "POST", "/api/admin/password", function () { pf.reset(); });
      }
    }).catch(fail);
  }

  /* ================================================================ Журнал */

  function log() {
    loading();
    U.api("GET", "/api/admin/log").then(function (rows) {
      draw(head("Журнал действий") + '<section class="glass panel reveal"><table class="table">' +
        "<thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th></tr></thead><tbody>" +
        (rows.map(function (r, i) {
          return '<tr class="stagger" style="--i:' + Math.min(i, 20) + '"><td class="small muted">' + U.fmtDt(r.created_at) + "</td>" +
            "<td>" + esc(r.username) + "</td><td>" + esc(r.action) + "</td></tr>";
        }).join("") || '<tr><td colspan="3" class="muted">Журнал пуст.</td></tr>') + "</tbody></table></section>");
    }).catch(fail);
  }

  /* ================================================================ старт */

  U.api("GET", "/api/me").then(function (m) { if (m.username) showPanel(m); else showLogin(); }).catch(function (e) { U.toast(e.message, "error"); showLogin(); });
})();
