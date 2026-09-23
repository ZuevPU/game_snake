/* Общие переключатели темы и звука для всех страниц */
(function () {
  const STORAGE = 'snake-binary-v2';
  const prefs = { sound: false, theme: 'auto' };

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || '{}');
    if (saved && typeof saved === 'object') {
      prefs.sound = !!saved.sound;
      prefs.theme = saved.theme || 'auto';
    }
  } catch (e) {}

  function persist() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(prefs));
    } catch (e) {}
  }

  function resolvedTheme() {
    if (prefs.theme !== 'auto') return prefs.theme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme() {
    const t = resolvedTheme();
    document.documentElement.setAttribute('data-theme', t);
    const btn = document.getElementById('btn-theme');
    if (btn) {
      btn.textContent = t === 'dark' ? '☀️' : '🌙';
      btn.setAttribute('aria-label', t === 'dark' ? 'Светлая тема' : 'Тёмная тема');
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#000000' : '#f2f2f7');
  }

  function applySound() {
    const btn = document.getElementById('btn-sound');
    if (btn) {
      btn.textContent = prefs.sound ? '🔊' : '🔇';
      btn.setAttribute('aria-pressed', String(prefs.sound));
    }
  }

  const btnTheme = document.getElementById('btn-theme');
  if (btnTheme) {
    btnTheme.addEventListener('click', function () {
      prefs.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
      applyTheme();
      persist();
    });
  }

  const btnSound = document.getElementById('btn-sound');
  if (btnSound) {
    btnSound.addEventListener('click', function () {
      prefs.sound = !prefs.sound;
      applySound();
      persist();
      window.dispatchEvent(new CustomEvent('snake:sound', { detail: prefs.sound }));
    });
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (prefs.theme === 'auto') applyTheme();
  });

  applyTheme();
  applySound();

  window.snakePrefs = prefs;
})();
