// HeldixClient – Webseite: Kopfzeile beim Scrollen, Bilder vergrößern, Download-Knopf, Status des Heldix-Dienstes.
// (Neuigkeiten auf der Startseite: start.js)
(() => {
  const nav = document.querySelector('.nav');
  const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Bilder in groß
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
    document.querySelectorAll('[data-full]').forEach((button) => {
      button.addEventListener('click', () => {
        opener = button;
        const thumb = button.querySelector('img');
        image.src = button.dataset.full;
        image.alt = thumb ? thumb.alt : '';
        caption.textContent = button.querySelector('figcaption')?.textContent ?? '';
        box.hidden = false;
        box.querySelector('.close').focus();
      });
    });
    box.addEventListener('click', (event) => {
      if (event.target === box || event.target.closest('.close')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !box.hidden) close();
    });
  }

  // Neueste Version vom Heldix-Dienst: Download direkt von dort (sonst bleibt der Link zu GitHub)
  const download = document.getElementById('download-button');
  if (download && /^https:\/\/[a-z0-9.-]+\/v1\//i.test(download.dataset.api || '')) {
    fetch('/launcher-latest', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data) => {
        const manifest = JSON.parse(data.manifest);
        if (!manifest || typeof manifest.version !== 'string') return;
        download.href = download.dataset.api;
        const meta = document.getElementById('download-meta');
        const size = typeof manifest.size === 'number' ? ` · ${Math.round(manifest.size / 1024 / 1024)} MB` : '';
        if (meta) meta.textContent = `Version ${manifest.version} · Installer für Windows 10 und 11 (64 Bit)${size}`;
      })
      .catch(() => {});
  }

  // Aktuelle Seite in der Navigation markieren
  for (const link of document.querySelectorAll('.nav a[href^="/"]:not([href*="#"])')) {
    if (link.getAttribute('href') === location.pathname.replace(/\.html$/, '')) link.setAttribute('aria-current', 'page');
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
