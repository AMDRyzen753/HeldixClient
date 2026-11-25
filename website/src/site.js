// HeldixClient – Webseite (alle Seiten): Kopfzeile, Menü auf dem Handy, sanftes Einblenden, leichtes Kippen der
// Bildschirmfotos, Bilder in groß und der Status des Heldix-Dienstes. Ohne Skript bleibt alles sichtbar und bedienbar.
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Kopfzeile: Linie beim Scrollen
  const nav = document.querySelector('.nav');
  const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Aktuelle Seite in der Navigation markieren
  const here = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  for (const link of document.querySelectorAll('.nav a[href^="/"]:not([href*="#"])')) {
    const target = link.getAttribute('href').replace(/\/$/, '') || '/';
    if (target === here || (target !== '/' && here.startsWith(`${target}/`))) link.setAttribute('aria-current', 'page');
  }

  // Menü auf schmalen Bildschirmen (<details>): schließen bei Klick auf einen Link, außerhalb oder mit Escape
  const menu = document.querySelector('.nav-menu');
  if (menu) {
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

  // Einblenden beim Scrollen: nur Elemente, die beim Laden noch unter dem sichtbaren Bereich liegen
  const reveals = [...document.querySelectorAll('.reveal')];
  if (reveals.length && 'IntersectionObserver' in window && !reduceMotion.matches) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('reveal-in');
          entry.target.classList.remove('reveal-pending');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    const fold = window.innerHeight;
    for (const element of reveals) {
      if (element.getBoundingClientRect().top > fold) {
        element.classList.add('reveal-pending');
        observer.observe(element);
      }
    }
  }

  // Leichtes Kippen der Bildschirmfotos und Lichtpunkt auf Kacheln (nur mit Maus, nicht bei reduzierter Bewegung)
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  if (finePointer.matches && !reduceMotion.matches) {
    for (const frame of document.querySelectorAll('[data-tilt]')) {
      frame.addEventListener('pointermove', (event) => {
        const box = frame.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width;
        const y = (event.clientY - box.top) / box.height;
        frame.style.setProperty('--ry', `${((x - 0.5) * 6).toFixed(2)}deg`);
        frame.style.setProperty('--rx', `${((0.5 - y) * 5).toFixed(2)}deg`);
        frame.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
        frame.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
      });
      frame.addEventListener('pointerleave', () => {
        frame.style.setProperty('--rx', '0deg');
        frame.style.setProperty('--ry', '0deg');
      });
    }
    document.addEventListener(
      'pointermove',
      (event) => {
        const tile = event.target instanceof Element ? event.target.closest('.tile') : null;
        if (!tile) return;
        const box = tile.getBoundingClientRect();
        tile.style.setProperty('--gx', `${event.clientX - box.left}px`);
        tile.style.setProperty('--gy', `${event.clientY - box.top}px`);
      },
      { passive: true },
    );
  }

  // Bilder in groß (Galerie, Module)
  const box = document.getElementById('lightbox');
  if (box) {
    const image = box.querySelector('img');
    const caption = box.querySelector('figcaption');
    let opener = null;
    const close = () => {
      box.hidden = true;
      image.removeAttribute('src');
      if (opener) opener.focus();
    };
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-full]');
      if (!button) return;
      opener = button;
      const thumb = button.querySelector('img');
      image.src = button.dataset.full;
      image.alt = thumb ? thumb.alt : button.textContent.trim();
      caption.textContent = button.querySelector('figcaption')?.textContent ?? button.closest('article')?.querySelector('h3')?.textContent ?? '';
      box.hidden = false;
      box.querySelector('.close').focus();
    });
    box.addEventListener('click', (event) => {
      if (event.target === box || event.target.closest('.close')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !box.hidden) close();
    });
  }

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
