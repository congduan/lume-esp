/* Lume site interactions: i18n, theme, progressive reveal, filters, copy, code highlighting */
(() => {
  const root = document.documentElement;
  const langButton = document.querySelector('#lang-toggle');
  const themeButton = document.querySelector('#theme-toggle');

  let lang = 'en';
  let theme = 'dark';
  try {
    lang = localStorage.getItem('lume-lang') || 'en';
    theme = localStorage.getItem('lume-theme') || 'dark';
  } catch (err) {
    /* storage unavailable */
  }

  function apply() {
    root.lang = lang;
    root.dataset.theme = theme;
    document.querySelectorAll('[data-en][data-zh]').forEach((el) => {
      el.textContent = el.dataset[lang];
    });
    document.querySelectorAll('[data-placeholder-en][data-placeholder-zh]').forEach((el) => {
      el.placeholder = lang === 'zh' ? el.dataset.placeholderZh : el.dataset.placeholderEn;
    });
    if (langButton) {
      langButton.textContent = lang === 'en' ? '\u4e2d\u6587' : 'EN';
    }
    if (themeButton) {
      themeButton.textContent = theme === 'dark' ? '\u263c' : '\u25d0';
      themeButton.setAttribute('aria-label', theme === 'dark' ? 'Use light theme' : 'Use dark theme');
    }
  }

  if (langButton) {
    langButton.addEventListener('click', () => {
      lang = lang === 'en' ? 'zh' : 'en';
      try { localStorage.setItem('lume-lang', lang); } catch (err) {}
      apply();
    });
  }

  if (themeButton) {
    themeButton.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('lume-theme', theme); } catch (err) {}
      apply();
    });
  }

  apply();

  /* Sticky header elevation on scroll */
  const header = document.querySelector('.site-header');
  if (header) {
    const updateShadow = () => header.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', updateShadow, { passive: true });
    updateShadow();
  }

  /* Progressive reveal: content stays visible without JS; only below-the-fold items animate */
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveals = [...document.querySelectorAll('.reveal')];
  if ('IntersectionObserver' in window && !reduced && reveals.length > 0) {
    const pending = [];
    const vh = window.innerHeight || 900;
    reveals.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top > vh * 0.96) {
        el.classList.add('reveal-pending');
        pending.push(el);
      }
    });
    if (pending.length > 0) {
      root.classList.add('js-reveal');
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.remove('reveal-pending');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.04, rootMargin: '0px 0px 40px 0px' });
      pending.forEach((el) => observer.observe(el));

      /* Safety fallback so scrolled elements never stay hidden if IO misses a frame */
      const revealInView = () => {
        const limit = (window.innerHeight || 900) + 60;
        pending.forEach((el) => {
          if (el.classList.contains('reveal-pending')) {
            const rect = el.getBoundingClientRect();
            if (rect.top < limit) {
              el.classList.remove('reveal-pending');
              observer.unobserve(el);
            }
          }
        });
      };
      window.addEventListener('scroll', revealInView, { passive: true });
    }
  }

  /* API reference table live search */
  const apiSearch = document.querySelector('#api-search');
  if (apiSearch) {
    const rows = [...document.querySelectorAll('[data-api]')];
    const count = document.querySelector('#api-count');
    const filterApi = () => {
      const q = apiSearch.value.toLowerCase().trim();
      let visible = 0;
      rows.forEach((row) => {
        const match = row.dataset.api.includes(q);
        row.hidden = !match;
        if (match) visible++;
      });
      if (count) count.textContent = `${visible} / ${rows.length}`;
    };
    apiSearch.addEventListener('input', filterApi);
    filterApi();
  }

  /* Examples gallery search & category filter */
  const exSearch = document.querySelector('#examples-search');
  const exFilterBtns = [...document.querySelectorAll('[data-ex-filter]')];
  const exCards = [...document.querySelectorAll('.example-card')];
  const exCount = document.querySelector('#examples-count');
  if (exCards.length > 0 && (exSearch || exFilterBtns.length > 0)) {
    let activeFilter = 'all';
    const filterExamples = () => {
      const q = exSearch ? exSearch.value.toLowerCase().trim() : '';
      let visible = 0;
      exCards.forEach((card) => {
        const hay = (card.dataset.search || card.textContent || '').toLowerCase();
        const hasShot = card.dataset.shot === '1';
        const needsHw = card.dataset.hw === '1';
        let matchFilter = true;
        if (activeFilter === 'shot') matchFilter = hasShot;
        else if (activeFilter === 'hw') matchFilter = needsHw;
        const match = matchFilter && (!q || hay.includes(q));
        card.hidden = !match;
        if (match) {
          card.classList.remove('reveal-pending');
          visible++;
        }
      });
      if (exCount) exCount.textContent = `${visible} / ${exCards.length}`;
    };
    if (exSearch) exSearch.addEventListener('input', filterExamples);
    exFilterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.exFilter || 'all';
        exFilterBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        filterExamples();
      });
    });
    filterExamples();
  }

  /* Copy-to-clipboard buttons for file paths */
  document.addEventListener('click', (event) => {
    const btn = event.target.closest ? event.target.closest('.copy-btn[data-copy]') : null;
    if (!btn) return;
    const text = btn.dataset.copy;
    const done = () => {
      btn.classList.add('copied');
      btn.textContent = lang === 'zh' ? '\u5df2\u590d\u5236' : 'Copied';
      window.clearTimeout(btn._timer);
      btn._timer = window.setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = lang === 'zh' ? '\u590d\u5236' : 'Copy';
      }, 1500);
    };
    const fallbackCopy = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (err) {}
      ta.remove();
      done();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  });

  /* Lightweight JS syntax highlighter for guide code blocks (never touches API tables) */
  const tokenRe = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\b(?:const|let|var|function|return|if|else|import|from|for|while|new|typeof|true|false|null)\b|\b(?:signal|View|Text|Button|Canvas|List|Image|Arc|Math)\b|\b\d+(?:\.\d+)?\b)/g;
  const kwSet = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'import', 'from', 'for', 'while', 'new', 'typeof', 'true', 'false', 'null']);
  const fnSet = new Set(['signal', 'View', 'Text', 'Button', 'Canvas', 'List', 'Image', 'Arc', 'Math']);

  function highlightJs(codeEl) {
    const raw = codeEl.textContent || '';
    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    tokenRe.lastIndex = 0;
    while ((m = tokenRe.exec(raw)) !== null) {
      if (m.index > last) {
        frag.appendChild(document.createTextNode(raw.slice(last, m.index)));
      }
      const tok = m[0];
      const span = document.createElement('span');
      if (tok.startsWith('//') || tok.startsWith('/*')) span.className = 'tok-cmt';
      else if (tok.startsWith("'") || tok.startsWith('"')) span.className = 'tok-str';
      else if (kwSet.has(tok)) span.className = 'tok-kw';
      else if (fnSet.has(tok)) span.className = 'tok-fn';
      else span.className = 'tok-num';
      span.textContent = tok;
      frag.appendChild(span);
      last = tokenRe.lastIndex;
    }
    if (last < raw.length) {
      frag.appendChild(document.createTextNode(raw.slice(last)));
    }
    codeEl.replaceChildren(frag);
  }

  document.querySelectorAll('pre > code.lang-js').forEach(highlightJs);

  /* Hero illustrative hot-reload animation */
  const typed = document.querySelector('#typed-code');
  if (typed) {
    const target = 'count.set(count() + 1);';
    const screen = document.querySelector('#demo-count');
    const status = document.querySelector('#demo-status');
    const toast = document.querySelector('#demo-toast');
    let n = 0;
    let phase = 0;
    let count = 0;
    const tick = () => {
      if (phase === 0) {
        typed.textContent = target.slice(0, n++);
        if (n > target.length) {
          phase = 1;
          if (status) status.textContent = 'sending app.js over USB';
          window.setTimeout(tick, 650);
        } else {
          window.setTimeout(tick, 85);
        }
      } else if (phase === 1) {
        count++;
        if (screen) screen.textContent = String(count).padStart(2, '0');
        if (toast) toast.classList.add('show');
        if (status) status.textContent = 'runtime refreshed';
        phase = 2;
        window.setTimeout(tick, 1700);
      } else {
        if (toast) toast.classList.remove('show');
        typed.textContent = '';
        n = 0;
        phase = 0;
        if (status) status.textContent = 'editing app.js';
        window.setTimeout(tick, 600);
      }
    };
    if (reduced) {
      typed.textContent = target;
      if (status) status.textContent = 'illustrative preview';
    } else {
      tick();
    }
  }
})();
