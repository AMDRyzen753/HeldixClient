// HeldixClient – Webseite: /capes gibt es nur noch als Weiterleitung. Die Capes stehen jetzt unter /cosmetics#capes
// (zusammen mit Hüten, Flügeln, Auren und Begleitern). Ohne JavaScript leitet <meta http-equiv="refresh"> weiter.
const id = location.hash.slice(1);
location.replace(`/cosmetics#capes${/^[a-z0-9-]{1,32}$/.test(id) ? `/${id}` : ''}`);
