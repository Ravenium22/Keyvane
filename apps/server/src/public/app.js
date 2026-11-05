// Keyvane dashboard enhancements. Everything works without JavaScript; this only adds polish.
(function () {
  'use strict';

  // Copy-to-clipboard: <button data-copy="text"> or data-copy-target="#id"
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-copy]');
    if (!button) return;
    event.preventDefault();
    var text = button.getAttribute('data-copy');
    var targetSelector = button.getAttribute('data-copy-target');
    if (targetSelector) {
      var target = document.querySelector(targetSelector);
      if (target) text = target.value !== undefined ? target.value : target.textContent;
    }
    if (!text) return;
    var done = function () {
      button.classList.add('copied');
      setTimeout(function () { button.classList.remove('copied'); }, 1600);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
      document.body.removeChild(area);
    }
  });

  // Confirm destructive actions: <form data-confirm="Are you sure?">
  document.addEventListener('submit', function (event) {
    var form = event.target;
    var message = form.getAttribute && form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) event.preventDefault();
  }, true);

  // Close open dropdowns when clicking elsewhere.
  document.addEventListener('click', function (event) {
    document.querySelectorAll('details.switcher[open]').forEach(function (d) {
      if (!d.contains(event.target)) d.removeAttribute('open');
    });
  });

  // Show timestamps in the viewer's local time zone: <time datetime="..." data-local>
  var formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  document.querySelectorAll('time[data-local]').forEach(function (el) {
    var date = new Date(el.getAttribute('datetime'));
    if (!isNaN(date.getTime())) el.setAttribute('title', formatter.format(date));
  });

  // Fade out success messages.
  document.querySelectorAll('.flash-success').forEach(function (el) {
    setTimeout(function () {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 450);
    }, 5000);
  });

  // Toggle the limit input next to a metered entitlement checkbox.
  document.querySelectorAll('[data-limit-toggle]').forEach(function (checkbox) {
    var input = document.getElementById(checkbox.getAttribute('data-limit-toggle'));
    if (!input) return;
    var sync = function () { input.disabled = !checkbox.checked; };
    checkbox.addEventListener('change', sync);
    sync();
  });
})();
