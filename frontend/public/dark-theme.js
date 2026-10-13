(function () {
  const STORAGE_KEY = 'bb-theme';
  const DARK = 'dark';
  const LIGHT = 'light';

  function getTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY) === DARK ? DARK : LIGHT;
    } catch (_) {
      return LIGHT;
    }
  }

  function updateButtons(theme) {
    document.querySelectorAll('[data-bb-theme-toggle]').forEach(function (button) {
      const isDark = theme === DARK;
      button.textContent = isDark ? '浅色模式' : '深色模式';
      button.setAttribute('aria-label', isDark ? '切换为浅色模式' : '切换为深色护眼模式');
      button.setAttribute('title', isDark ? '切换为浅色模式' : '切换为深色护眼模式');
      button.setAttribute('aria-pressed', String(isDark));
    });
  }

  function setTheme(theme) {
    const next = theme === DARK ? DARK : LIGHT;
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* ignore */ }
    updateButtons(next);
    window.dispatchEvent(new CustomEvent('bb-theme-change', { detail: { theme: next } }));
    return next;
  }

  function toggleTheme() {
    return setTheme(document.documentElement.dataset.theme === DARK ? LIGHT : DARK);
  }

  window.bbTheme = { get: getTheme, set: setTheme, toggle: toggleTheme };
  document.documentElement.dataset.theme = getTheme();
  document.documentElement.style.colorScheme = document.documentElement.dataset.theme;

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.navbar .user-info').forEach(function (container) {
      if (container.querySelector('[data-bb-theme-toggle]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bb-theme-toggle';
      button.setAttribute('data-bb-theme-toggle', '');
      button.addEventListener('click', toggleTheme);
      container.insertBefore(button, container.firstChild);
    });
    if (document.body.classList.contains('bb-embedded') && !document.querySelector('.bb-theme-floating')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bb-theme-toggle bb-theme-floating';
      button.setAttribute('data-bb-theme-toggle', '');
      button.addEventListener('click', toggleTheme);
      document.body.appendChild(button);
    }
    updateButtons(document.documentElement.dataset.theme || LIGHT);
  });

  window.addEventListener('storage', function (event) {
    if (event.key === STORAGE_KEY) setTheme(event.newValue === DARK ? DARK : LIGHT);
  });
})();
