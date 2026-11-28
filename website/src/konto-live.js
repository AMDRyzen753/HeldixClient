// HeldixClient – Webseite: Echtzeit für Konto (Freunde, Nachrichten, Party, Welten) – „Begleiter“ fürs Handy.
//
// - WebSocket wss://<diese Adresse>/api/v1/ws (lokal ohne HTTPS: ws://). Das Web-Cookie geht automatisch mit, den
//   Origin setzt der Browser; der Dienst (ab 1.12.0) prüft ihn statt des CSRF-Headers. Die Verbindung macht dich für
//   Freunde nicht „online“ (nur das Spiel), zählt aber für die Party als Verbindung.
// - ping alle 30 s; Schließen mit 4008 = abgemeldet (Logout, Sitzung beendet oder abgelaufen).
// - Klappt der WebSocket nicht (älterer Dienst, Proxy, Netz), fragt die Seite alle 15 Sekunden nach (poll) und
//   versucht es später erneut (5 s, 15 s, 30 s, dann jede Minute). Auch mit Verbindung gleicht sie jede Minute einmal ab.
// - „schreibt …“: höchstens alle 3 Sekunden je Freund, über den WebSocket oder POST /v1/messages/<uuid>/typing.
// - Abos (ab Dienst 1.13.0, z. B. hosting-subscribe fürs Live-Log einer dauerhaften Welt): send() schickt eine Nachricht,
//   onOpen() meldet jede (neue) Verbindung – dort schickt die Seite ihre Abos erneut, weil der Dienst sie je Verbindung führt.
//
// Keine Tokens im Code oder in der Konsole: angemeldet wird nur über das HttpOnly-Cookie.

const PING_MS = 30_000;
const POLL_MS = 15_000;
const SYNC_MS = 60_000;
const TYPING_MS = 3_000;
const RETRY_MS = [5_000, 15_000, 30_000, 60_000];

/** Adresse des WebSockets: dieselbe Adresse wie die Seite, unter /api. */
export function realtimeUrl() {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/ws`;
}

/**
 * Echtzeit starten. onEvent(nachricht): jede Nachricht des Dienstes. onState(zustand): 'verbinde' | 'live' |
 * 'abfrage' | 'aus'. onSignedOut(): Verbindung mit 4008 geschlossen. poll(): Stand per HTTP holen (Rückfall und
 * Abgleich). call(method, path): Anfrage mit Sitzung (für „schreibt …“ ohne WebSocket).
 */
export function createLive({ onEvent, onState, onSignedOut, onOpen, poll, call }) {
  const state = { socket: null, status: 'aus', running: false, retry: 0, retryTimer: null, pingTimer: null, pollTimer: null, typing: new Map(), polling: false };

  function setStatus(status) {
    if (state.status === status) return;
    state.status = status;
    onState?.(status);
  }

  async function pollOnce() {
    if (!state.running || state.polling || document.visibilityState !== 'visible') return;
    state.polling = true;
    try {
      await poll();
    } catch {
      // Beim nächsten Mal wieder.
    } finally {
      state.polling = false;
    }
  }

  function schedulePoll() {
    clearInterval(state.pollTimer);
    if (!state.running) return;
    state.pollTimer = setInterval(pollOnce, state.status === 'live' ? SYNC_MS : POLL_MS);
  }

  function clearSocket() {
    clearInterval(state.pingTimer);
    state.pingTimer = null;
    if (state.socket) {
      state.socket.onopen = state.socket.onmessage = state.socket.onclose = state.socket.onerror = null;
      try {
        state.socket.close(1000);
      } catch {
        // schon zu
      }
    }
    state.socket = null;
  }

  function scheduleRetry() {
    clearTimeout(state.retryTimer);
    if (!state.running) return;
    const delay = RETRY_MS[Math.min(state.retry, RETRY_MS.length - 1)];
    state.retry++;
    state.retryTimer = setTimeout(connect, delay);
  }

  function connect() {
    clearTimeout(state.retryTimer);
    if (!state.running || state.socket) return;
    if (typeof WebSocket !== 'function') {
      setStatus('abfrage');
      schedulePoll();
      return;
    }
    let socket;
    try {
      socket = new WebSocket(realtimeUrl());
    } catch {
      setStatus('abfrage');
      schedulePoll();
      scheduleRetry();
      return;
    }
    state.socket = socket;
    if (state.status !== 'live') setStatus(state.status === 'aus' ? 'verbinde' : state.status);
    let openedAt = 0;
    socket.onopen = () => {
      openedAt = Date.now();
      setStatus('live');
      schedulePoll();
      clearInterval(state.pingTimer);
      state.pingTimer = setInterval(() => send({ type: 'ping' }), PING_MS);
      // Nach (Wieder-)Verbinden einmal abgleichen: in der Zwischenzeit kann etwas verloren gegangen sein.
      pollOnce();
      try {
        onOpen?.();
      } catch (error) {
        console.error(error);
      }
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data.length > 512 * 1024) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string' || message.type === 'pong') return;
      try {
        onEvent(message);
      } catch (error) {
        console.error(error);
      }
    };
    socket.onclose = (event) => {
      state.socket = null;
      // Nur eine Verbindung, die eine Weile hielt, setzt die Wartezeit zurück (sonst flackert es bei Proxys, die sofort schließen)
      if (openedAt && Date.now() - openedAt > 10_000) state.retry = 0;
      clearInterval(state.pingTimer);
      if (!state.running) return;
      if (event.code === 4008 || event.code === 4001 || event.code === 4003) {
        stop();
        onSignedOut?.(event.code);
        return;
      }
      setStatus('abfrage');
      schedulePoll();
      scheduleRetry();
    };
    socket.onerror = () => {
      // onclose folgt und kümmert sich um den Rückfall.
    };
  }

  function send(message) {
    if (state.socket?.readyState !== WebSocket.OPEN) return false;
    try {
      state.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  function onVisibility() {
    if (document.visibilityState !== 'visible' || !state.running) return;
    // Zurück auf der Seite: sofort abgleichen und ggf. neu verbinden (Handy schließt Verbindungen im Hintergrund).
    pollOnce();
    if (!state.socket) connect();
  }

  function start() {
    if (state.running) return;
    state.running = true;
    state.retry = 0;
    setStatus('verbinde');
    document.addEventListener('visibilitychange', onVisibility);
    connect();
    // Bis der WebSocket steht (oder nie): schon einmal per HTTP
    schedulePoll();
  }

  function stop() {
    state.running = false;
    clearTimeout(state.retryTimer);
    clearInterval(state.pollTimer);
    clearSocket();
    document.removeEventListener('visibilitychange', onVisibility);
    setStatus('aus');
  }

  /** „schreibt …“ an einen Freund (gedrosselt). */
  function typing(uuid) {
    const last = state.typing.get(uuid) ?? 0;
    if (Date.now() - last < TYPING_MS) return;
    state.typing.set(uuid, Date.now());
    if (send({ type: 'typing', to: uuid })) return;
    call?.('POST', `/v1/messages/${uuid}/typing`).catch(() => {});
  }

  return {
    start,
    stop,
    typing,
    pollNow: pollOnce,
    status: () => state.status,
    /** Nachricht über den WebSocket (false, wenn gerade keiner verbunden ist). */
    send,
    /** Nach einer Nachricht darf sofort wieder „schreibt …“ gehen. */
    resetTyping(uuid) {
      state.typing.delete(uuid);
    },
  };
}
