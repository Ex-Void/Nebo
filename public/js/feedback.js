/* Вкладка «Обратная связь»: проверка формы и отправка сообщения на сервер. */
(function () {
  "use strict";
  var U = window.UI, $ = U.$;
  var form = $("#feedback-form"), msg = $("#f-msg"), counter = $("#counter");

  msg.addEventListener("input", function () { counter.textContent = msg.value.length + " / 2000"; });

  function validate() {
    var errors = {};
    if (form.name.value.trim().length < 2) errors.name = "Укажите имя (минимум 2 символа).";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.value.trim())) errors.email = "Укажите корректный e-mail.";
    if (msg.value.trim().length < 5) errors.message = "Сообщение слишком короткое (минимум 5 символов).";
    return errors;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var errors = validate();
    U.showFieldErrors(form, errors);
    if (Object.keys(errors).length) return;
    var btn = $("button[type=submit]", form);
    btn.classList.add("loading");
    U.api("POST", "/api/feedback", { name: form.name.value, email: form.email.value, message: msg.value })
      .then(function () {
        form.reset(); counter.textContent = "0 / 2000";
        form.classList.add("hidden");
        $("#sent").classList.remove("hidden");
        U.toast("Спасибо! Сообщение отправлено администратору.", "success");
      })
      .catch(function (err) { U.showFieldErrors(form, err.fields); U.toast(err.message, "error"); })
      .then(function () { btn.classList.remove("loading"); });
  });

  $("#send-more").addEventListener("click", function () {
    $("#sent").classList.add("hidden");
    form.classList.remove("hidden");
    form.name.focus();
  });
})();
