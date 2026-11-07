/* Общие функции для всех страниц: запросы к серверу, форматирование, вкладки,
   анимации появления, счётчики, уведомления, окно подтверждения. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- запросы к серверу ---------- */
  function api(method, url, body) {
    var opts = { method: method, headers: { "X-Requested-With": "nebo" }, credentials: "same-origin" };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data.error || "Ошибка " + r.status);
          err.status = r.status; err.fields = data.fields || {};
          throw err;
        }
        return data;
      });
    }, function () {
      throw new Error("Нет связи с сервером. Проверьте, что сайт запущен.");
    });
  }

  /* ---------- форматирование ---------- */
  var WEEKDAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
  var WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtTemp(v) {
    var n = Math.round(v);
    return n > 0 ? "+" + n + "°" : n < 0 ? "−" + Math.abs(n) + "°" : "0°";
  }
  function parseDate(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function dayLabel(s) {
    var d = parseDate(s), t = new Date(); t.setHours(0, 0, 0, 0);
    var diff = Math.round((d - t) / 86400000);
    return diff === 0 ? "Сегодня" : diff === 1 ? "Завтра" : WEEKDAYS[d.getDay()];
  }
  function dayMonth(s) { var d = parseDate(s); return d.getDate() + " " + MONTHS[d.getMonth()]; }
  function weekdayShort(s) { return WEEKDAYS_SHORT[parseDate(s).getDay()]; }
  function fmtDt(s) {
    if (!s) return "";
    var m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/.exec(s);
    return m ? +m[3] + " " + MONTHS[+m[2] - 1] + ", " + m[4] + ":" + m[5] : s;
  }
  var SOURCES = { manual: "введено администратором", demo: "демо-данные", "open-meteo": "Open-Meteo" };

  /* ---------- вкладки с «плавающим» индикатором ---------- */
  var tabs = $("#tabs"), indicator = $(".tab-indicator"), activeTab = tabs && $(".tab.active", tabs);
  function moveIndicator(el, instant) {
    if (!tabs || !indicator) return;
    // тёмный текст у вкладки, над которой сейчас белая плашка
    $$(".tab", tabs).forEach(function (t) { t.classList.toggle("hl", t === el); });
    if (!el) { indicator.style.width = "0"; return; }
    if (instant) indicator.style.transition = "none";
    indicator.style.width = el.offsetWidth + "px";
    indicator.style.transform = "translateX(" + el.offsetLeft + "px)";
    if (instant) { void indicator.offsetWidth; indicator.style.transition = ""; }
  }
  if (tabs) {
    tabs.classList.add("js");
    moveIndicator(activeTab, true);
    $$(".tab", tabs).forEach(function (t) { t.addEventListener("mouseenter", function () { moveIndicator(t); }); });
    tabs.addEventListener("mouseleave", function () { moveIndicator(activeTab); });
    window.addEventListener("resize", function () { moveIndicator(activeTab, true); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { moveIndicator(activeTab, true); });
  }

  /* ---------- плавный уход со страницы ---------- */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || a.target) return;
    var url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.protocol === "mailto:" ||
        (url.pathname === location.pathname && (url.hash || url.search === location.search))) return;
    e.preventDefault();
    if (a.classList.contains("tab")) moveIndicator(a);
    document.body.classList.add("leaving");
    setTimeout(function () { location.href = a.href; }, reduce ? 0 : 230);
  });
  window.addEventListener("pageshow", function () { document.body.classList.remove("leaving"); });

  /* ---------- счётчики и появление при прокрутке ---------- */
  function countUp(el) {
    var target = parseFloat(el.dataset.count);
    if (isNaN(target)) return;
    var isTemp = el.hasAttribute("data-temp");
    var dec = parseInt(el.dataset.decimals || "0", 10);
    var from = parseFloat(el.dataset.from || "0");
    var show = function (v) { el.textContent = isTemp ? fmtTemp(v) : v.toFixed(dec); };
    if (reduce) { show(target); return; }
    var dur = 1200, start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var k = Math.min((ts - start) / dur, 1), e = 1 - Math.pow(1 - k, 3);
      show(from + (target - from) * e);
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target;
      el.classList.add("in");
      $$("[data-count]", el).forEach(countUp);
      $$("[data-ring],[data-gauge]", el).forEach(function (x) { x.classList.add("in"); });
      io.unobserve(el);
    });
  }, { threshold: .12 }) : null;
  // вызывается после того, как страница отрисовала новые элементы
  function reveal(root) {
    $$(".reveal", root || document).forEach(function (el) {
      if (el.classList.contains("in")) return;
      if (io) io.observe(el);
      else { el.classList.add("in"); $$("[data-count]", el).forEach(countUp); $$("[data-ring],[data-gauge]", el).forEach(function (x) { x.classList.add("in"); }); }
    });
  }

  /* ---------- фон неба ---------- */
  function setSky(cond) {
    document.body.dataset.sky = cond;
    if (window.Sky) window.Sky.set(cond);
  }

  /* ---------- уведомления ---------- */
  function hideToast(t) { t.classList.add("hide"); setTimeout(function () { t.remove(); }, 400); }
  function toast(msg, kind) {
    var box = $("#toasts"); if (!box || !msg) return;
    var t = document.createElement("div");
    t.className = "toast toast-" + (kind || "info");
    t.setAttribute("role", "status");
    t.innerHTML = '<span></span><button type="button" class="toast-close" aria-label="Закрыть">×</button>';
    t.firstChild.textContent = msg;
    box.appendChild(t);
    $(".toast-close", t).addEventListener("click", function () { hideToast(t); });
    setTimeout(function () { if (t.isConnected) hideToast(t); }, kind === "error" ? 9000 : 5000);
  }

  /* ---------- волна при нажатии на кнопку ---------- */
  document.addEventListener("pointerdown", function (e) {
    var b = e.target.closest && e.target.closest(".btn, .chip, .tab");
    if (!b || reduce) return;
    var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
    var w = document.createElement("span");
    w.className = "ripple";
    w.style.cssText = "width:" + s + "px;height:" + s + "px;left:" + (e.clientX - r.left - s / 2) + "px;top:" + (e.clientY - r.top - s / 2) + "px";
    if (getComputedStyle(b).position === "static") b.style.position = "relative";
    b.style.overflow = "hidden";
    b.appendChild(w); setTimeout(function () { w.remove(); }, 650);
  });

  /* ---------- окно подтверждения ---------- */
  function confirmBox(text, yesText) {
    return new Promise(function (resolve) {
      var back = document.createElement("div");
      back.className = "modal-back";
      back.innerHTML = '<div class="modal glass" role="dialog" aria-modal="true"><p></p><div class="row-actions">' +
        '<button type="button" class="btn btn-ghost" data-no>Отмена</button>' +
        '<button type="button" class="btn btn-danger" data-yes></button></div></div>';
      $("p", back).textContent = text;
      $("[data-yes]", back).textContent = yesText || "Да, выполнить";
      document.body.appendChild(back);
      var done = function (v) {
        back.classList.add("closing");
        setTimeout(function () { back.remove(); }, 200);
        document.removeEventListener("keydown", onKey);
        resolve(v);
      };
      var onKey = function (e) { if (e.key === "Escape") done(false); };
      document.addEventListener("keydown", onKey);
      back.addEventListener("click", function (e) { if (e.target === back) done(false); });
      $("[data-no]", back).addEventListener("click", function () { done(false); });
      $("[data-yes]", back).addEventListener("click", function () { done(true); });
      $("[data-yes]", back).focus();
    });
  }

  /* ---------- ошибки под полями формы ---------- */
  function showFieldErrors(form, fields) {
    $$(".field, .cond-picker", form).forEach(function (f) {
      f.classList.remove("has-error");
      var e = $(".field-error", f); if (e) e.textContent = "";
    });
    Object.keys(fields || {}).forEach(function (name) {
      var input = form.querySelector('[name="' + name + '"]');
      var box = input && (input.closest(".field") || input.closest(".cond-picker"));
      if (!box) return;
      void box.offsetWidth;
      box.classList.add("has-error");
      var e = $(".field-error", box); if (e) e.textContent = fields[name];
    });
  }

  // отметка непрочитанных сообщений на вкладке «Админ»
  function updateBadge(n) {
    var tab = $(".tab-admin");
    if (!tab) return;
    var b = $(".badge", tab);
    if (n > 0) {
      if (!b) { b = document.createElement("span"); b.className = "badge"; tab.appendChild(b); }
      b.textContent = n;
    } else if (b) b.remove();
    moveIndicator(activeTab, true);
  }

  window.UI = {
    $: $, $$: $$, reduce: reduce, api: api, esc: esc, fmtTemp: fmtTemp, dayLabel: dayLabel, dayMonth: dayMonth,
    weekdayShort: weekdayShort, fmtDt: fmtDt, SOURCES: SOURCES, countUp: countUp, reveal: reveal, setSky: setSky,
    toast: toast, confirm: confirmBox, showFieldErrors: showFieldErrors, updateBadge: updateBadge,
    wait: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  };

  // логотип и дата в подвале
  var brand = $("#brand-icon"); if (brand && window.icon) brand.innerHTML = window.icon("partly", 34);
  var fd = $("#footer-date"); if (fd) fd.textContent = new Date().toLocaleDateString("ru-RU");

  // число непрочитанных сообщений (видно только вошедшему администратору)
  if (!document.body.classList.contains("is-admin")) {
    api("GET", "/api/me").then(function (me) { if (me.username) updateBadge(me.unread); }).catch(function () {});
  }

  reveal();
})();
