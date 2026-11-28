// HeldixClient – Webseite (alle Seiten): Kopfzeile, Menü, aktuelle Seite, Download-Knöpfe mit erkanntem System,
// Reiter, Dialoge, Hinweise (Toasts), Kopieren, sanftes Einblenden, Bilder in groß und der Status des Heldix-Dienstes.
// Ohne Skript bleibt alles lesbar und bedienbar (Menü und Fragen sind <details>, Reiter zeigen alle Inhalte).
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Kopfzeile: Linie beim Scrollen
  const header = document.querySelector('[data-header]');
  const onScroll = () => header && header.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Aktuelle Seite in Navigation und Menü markieren (Hilfe-Artikel gehören zu „Hilfe“, Capes zu „Cosmetics“ …)
  const here = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const SECTION = { '/capes': '/cosmetics', '/welt': '/entdecken', '/partner': '/entdecken', '/einladung': '/zusammen', '/setup': '/zusammen', '/warum': '/module', '/entwickler': '/addons' };
  const current = SECTION[here] ?? here;
  for (const link of document.querySelectorAll('.site-nav a[href^="/"], .menu__links a[href^="/"], .site-header__actions a[href^="/"]')) {
    const target = link.getAttribute('href').replace(/\/$/, '') || '/';
    if (target === current || (target !== '/' && current.startsWith(`${target}/`))) link.setAttribute('aria-current', 'page');
  }

  // Menü (<details>): schließen bei Klick auf einen Link, außerhalb oder mit Escape
  for (const menu of document.querySelectorAll('[data-menu]')) {
    menu.addEventListener('click', (event) => {
      if (event.target.closest('a')) menu.open = false;
    });
    document.addEventListener('click', (event) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false;
        menu.querySelector('summary').focus();
      }
    });
  }

  // Download-Knöpfe mit dem erkannten System beschriften (Rückfall: „Kostenlos herunterladen“ → /download).
  // Die Download-Seite selbst erkennt zusätzlich den Prozessor des Mac (system.js).
  const ua = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || '';
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const os = /windows/i.test(platform) || /Windows/.test(ua) ? 'windows' : !touchMac && (/mac/i.test(platform) || /Macintosh|Mac OS X/.test(ua)) ? 'mac' : 'andere';
  root.dataset.system = os;
  const LABEL = { windows: 'Für Windows herunterladen', mac: 'Für Mac herunterladen', andere: 'Kostenlos herunterladen' };
  const SUB = { windows: 'Windows 10 und 11 · 64 Bit', mac: 'macOS 11 oder neuer · Apple Silicon und Intel', andere: 'Für Windows und Mac – am besten am PC laden' };
  for (const button of document.querySelectorAll('[data-download]')) {
    button.dataset.system = os;
    const label = button.querySelector('[data-download-label]');
    if (label && !button.hasAttribute('data-download-kurz')) label.textContent = LABEL[os];
  }
  for (const sub of document.querySelectorAll('[data-download-sub]')) sub.textContent = SUB[os];

  // Reiter (Tabs) nach dem WAI-ARIA-Muster: Pfeiltasten, Pos1/Ende
  for (const tabs of document.querySelectorAll('[data-tabs]')) {
    const list = [...tabs.querySelectorAll('[role="tab"]')];
    if (!list.length) continue;
    const select = (tab, focus) => {
      for (const other of list) {
        const active = other === tab;
        other.setAttribute('aria-selected', String(active));
        other.tabIndex = active ? 0 : -1;
        const panel = document.getElementById(other.getAttribute('aria-controls'));
        if (panel) panel.hidden = !active;
      }
      if (focus) tab.focus();
      tabs.dispatchEvent(new CustomEvent('reiter', { detail: tab.dataset.tab ?? tab.id }));
    };
    tabs.heldixSelect = (name) => {
      const tab = list.find((candidate) => candidate.dataset.tab === name);
      if (tab) select(tab, false);
    };
    list.forEach((tab) => {
      tab.addEventListener('click', () => select(tab, false));
      tab.addEventListener('keydown', (event) => {
        const i = list.indexOf(tab);
        const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        select(list[(next + list.length) % list.length], true);
      });
    });
    select(list.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? list[0], false);
  }

  // Dialoge (natives <dialog>)
  for (const opener of document.querySelectorAll('[data-dialog-open]')) {
    opener.addEventListener('click', () => document.getElementById(opener.dataset.dialogOpen)?.showModal());
  }
  for (const closer of document.querySelectorAll('[data-dialog-close]')) {
    closer.addEventListener('click', () => closer.closest('dialog')?.close());
  }

  // Hinweise (Toasts) im Stil des Design-Systems: window.heldixToast({ titel, text, art: 'ok' | 'reward' | 'error' })
  const ICONS = {
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    reward: '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M3.5 9h17"/><path d="M12 9v11"/><path d="M12 9c-1.5-3.5-5.5-4-5.5-1.5S10 9 12 9z"/><path d="M12 9c1.5-3.5 5.5-4 5.5-1.5S14 9 12 9z"/>',
    error: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  };
  const iconSvg = (name) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name] ?? ICONS.ok;
    return svg;
  };
  window.heldixToast = ({ titel, text = '', art = 'ok', dauer = 5000 }) => {
    let region = document.getElementById('toasts');
    if (!region) {
      region = document.createElement('div');
      region.id = 'toasts';
      region.className = 'toasts';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.append(region);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast--${art}`;
    const body = document.createElement('div');
    body.className = 'toast__text';
    const strong = document.createElement('strong');
    strong.textContent = titel;
    body.append(strong);
    if (text) {
      const span = document.createElement('span');
      span.textContent = text;
      body.append(span);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn--ghost btn--sm btn--icon toast__close';
    close.setAttribute('aria-label', 'Hinweis schließen');
    close.append(iconSvg('close'));
    close.addEventListener('click', () => toast.remove());
    toast.append(iconSvg(art), body, close);
    region.append(toast);
    while (region.children.length > 3) region.firstElementChild.remove();
    if (dauer) setTimeout(() => toast.remove(), dauer);
  };

  // Kopieren mit Rückmeldung: <button data-copy="Text" data-copy-titel="Adresse kopiert">
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      const value = button.dataset.copy || document.getElementById(button.dataset.copyFrom ?? '')?.textContent?.trim() || '';
      try {
        await navigator.clipboard.writeText(value);
        window.heldixToast({ titel: button.dataset.copyTitel || 'Kopiert', text: button.dataset.copyText || '' });
      } catch {
        window.heldixToast({ titel: 'Kopieren ging nicht', text: 'Markiere den Text und kopiere ihn selbst.', art: 'error' });
      }
    });
  }

  // Sanftes Einblenden: nur, was beim Laden unter dem sichtbaren Bereich liegt
  const reveals = [...document.querySelectorAll('.reveal')];
  if (reveals.length && 'IntersectionObserver' in window && !reduceMotion.matches) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.remove('is-pending');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -6% 0px' },
    );
    for (const element of reveals) {
      if (element.getBoundingClientRect().top > window.innerHeight) {
        element.classList.add('is-pending');
        observer.observe(element);
      }
    }
  }

  // Bilder in groß: <button data-full="/bilder/…" data-full-alt="…"> öffnet einen Dialog (Escape/Klick daneben schließt)
  let lightbox = null;
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-full]') : null;
    if (!button) return;
    if (!lightbox) {
      lightbox = document.createElement('dialog');
      lightbox.className = 'lightbox-dialog';
      lightbox.id = 'lightbox';
      lightbox.innerHTML = '<figure class="lightbox-figure"><img class="lightbox-image" alt=""><figcaption class="lightbox-caption"></figcaption></figure>';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'icon-button lightbox-close close';
      close.setAttribute('aria-label', 'Schließen');
      close.append(iconSvg('close'));
      close.addEventListener('click', () => lightbox.close());
      lightbox.append(close);
      lightbox.addEventListener('click', (click) => {
        if (click.target === lightbox || click.target.classList.contains('lightbox-figure')) lightbox.close();
      });
      lightbox.addEventListener('close', () => lightbox.querySelector('img').removeAttribute('src'));
      document.body.append(lightbox);
    }
    const thumb = button.querySelector('img');
    const image = lightbox.querySelector('img');
    image.src = button.dataset.full;
    image.alt = button.dataset.fullAlt || thumb?.alt || button.textContent.trim();
    lightbox.querySelector('figcaption').textContent = button.dataset.fullAlt || button.closest('article')?.querySelector('h3')?.textContent || '';
    lightbox.showModal();
  });

  // Läuft der Heldix-Dienst? (gleiche Adresse, Caddy reicht /dienst-status an den Dienst weiter)
  const status = document.getElementById('dienst-status');
  if (status) {
    const label = status.querySelector('.label');
    fetch('/dienst-status', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data) => {
        const online = Boolean(data && data.ok);
        status.dataset.state = online ? 'online' : 'offline';
        label.textContent = online ? 'Heldix-Dienst online' : 'Heldix-Dienst gestört';
      })
      .catch(() => {
        status.dataset.state = 'offline';
        label.textContent = 'Heldix-Dienst nicht erreichbar';
      });
  }
})();
