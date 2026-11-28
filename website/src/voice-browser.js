// HeldixClient – Webseite: Voice Chat im Browser – Verbindung zum Heldix-Dienst und Audio. Die Oberfläche baut
// voice-panel.js; die reine Logik (Rahmen, Jitter-Puffer, Sprachaktivierung) steht in voice-core.js, Aufnahme und
// Wiedergabe laufen im AudioWorklet voice-worklet.js.
//
// Ablauf (Dienst ab 1.11.0, Funktion „guests“):
// - WebSocket wss://<diese Adresse>/api/v1/voice mit Unterprotokoll `heldix-voice` – Gäste zusätzlich `gast.<token>`
//   (POST /v1/public/invites/<code>/guest), angemeldete Spieler mit ihrem Web-Cookie. Nach `ready` schickt die Seite
//   { type: 'join', invite: <code> } und ihren Status; alle 20 s ein `ping`.
// - Sprache: Mikrofon (getUserMedia mit Echo- und Rauschunterdrückung und automatischer Verstärkung) → Worklet → 20-ms-
//   Blöcke → Opus über WebCodecs (AudioEncoder, 48 kHz, mono) → [1][Flags][Folge][Opus]. Empfangen: [1][Flags][Folge]
//   [16 Byte ID][Opus] → je Sprecher ein AudioDecoder → Worklet (Jitter-Puffer, Lautstärke je Person) → Lautsprecher.
// - Senden nur bei Sprachaktivierung (Schwelle mit 300 ms Nachlauf) oder Push-to-Talk, nie stumm oder mit Ton aus.
// - Schließcodes des Dienstes: 4002 woanders verbunden, 4004 entfernt, 4005 Gast-Sitzung abgelaufen, 4006 Einladung
//   ungültig, 4007 voll (Gäste), 4001/4003 Konto gelöscht/gesperrt. Neu verbunden wird nur bei Netzfehlern.
// Der Browser nimmt nichts auf und speichert nichts; die Sprache geht nur über den Heldix-Dienst an die Gruppe.
import {
  FRAME_SAMPLES,
  FRAME_US,
  SAMPLE_RATE,
  SentenceFramer,
  SequenceTracker,
  VoiceActivation,
  frameTimestamp,
  gapSamples,
  meterLevel,
  nextSeq,
  packFrame,
  rmsLevel,
  unpackFrame,
} from './voice-core.js';

export const OPUS = Object.freeze({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1 });
/** Wie im Spiel: 20-ms-Rahmen, Sprache. Fehlt einem Browser ein Teil davon, reicht die Grundform (Standard ist 20 ms). */
const ENCODER_CONFIGS = [
  { ...OPUS, bitrate: 32_000, opus: { frameDuration: FRAME_US, complexity: 9, usedtx: false } },
  { ...OPUS, bitrate: 32_000 },
  { ...OPUS },
];
const PING_MS = 20_000;
const ACTIVITY_MS = 100;
/** So lange nach dem letzten Rahmen gilt jemand noch als „spricht“. */
const SPEAKING_MS = 300;
/** Dekodierer von Sprechern, die so lange still sind, werden freigegeben. */
const IDLE_DECODER_MS = 60_000;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15_000, 30_000];
/** Normale Schließcodes, bei denen die Seite neu verbindet (Netz, Neustart des Dienstes, Zeitüberschreitung). */
const RECONNECT_CODES = new Set([1001, 1005, 1006, 1011, 1012, 1013, 1014, 4000]);

export const CLOSE_TEXTS = Object.freeze({
  4001: 'Dein Konto beim Heldix-Dienst wurde gelöscht.',
  4002: 'Du bist jetzt woanders mit dem Voice Chat verbunden – im Spiel oder in einem anderen Browserfenster. Hier bist du deshalb nicht mehr dabei.',
  4003: 'Dieses Konto ist für den Heldix-Dienst gesperrt.',
  4004: 'Du wurdest aus der Gruppe entfernt.',
  4005: 'Deine Gast-Sitzung ist abgelaufen. Gilt die Einladung noch, kannst du neu beitreten.',
  4006: 'Diese Einladung ist abgelaufen oder wurde zurückgezogen.',
  4007: 'Die Gruppe ist voll – es können höchstens 4 Gäste gleichzeitig dabei sein.',
});

const UUID_RE = /^[0-9a-f]{32}$/;

/**
 * Kann dieser Browser mitreden? → { ok, reason, encoderConfig, microphone }
 * reason: 'unsicher' (kein HTTPS), 'webcodecs', 'opus', 'worklet'. microphone: getUserMedia vorhanden.
 */
export async function checkVoiceSupport() {
  if (typeof window === 'undefined' || !window.isSecureContext) return { ok: false, reason: 'unsicher' };
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass || typeof AudioWorkletNode !== 'function' || !('audioWorklet' in AudioContextClass.prototype)) return { ok: false, reason: 'worklet' };
  if (typeof AudioEncoder !== 'function' || typeof AudioDecoder !== 'function' || typeof AudioData !== 'function' || typeof EncodedAudioChunk !== 'function') return { ok: false, reason: 'webcodecs' };
  let encoderConfig = null;
  try {
    for (const config of ENCODER_CONFIGS) {
      const result = await AudioEncoder.isConfigSupported(config);
      if (result?.supported) {
        encoderConfig = config;
        break;
      }
    }
    const decoder = await AudioDecoder.isConfigSupported(OPUS);
    if (!encoderConfig || !decoder?.supported) return { ok: false, reason: 'opus' };
  } catch {
    return { ok: false, reason: 'opus' };
  }
  return { ok: true, reason: null, encoderConfig, microphone: Boolean(navigator.mediaDevices?.getUserMedia) };
}

/** Adresse des WebSockets: dieselbe Adresse wie die Seite, unter /api (lokal ohne HTTPS: ws://). */
export function voiceUrl(loc = location) {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/api/v1/voice`;
}

/** Samples (mono, Float32) aus dem Ergebnis eines AudioDecoders – mit Umwandlung, wo der Browser sie nicht kann. */
export function audioDataToFloat32(data) {
  const frames = data.numberOfFrames;
  const out = new Float32Array(frames);
  try {
    data.copyTo(out, { planeIndex: 0, format: 'f32-planar' });
    return out;
  } catch {
    // weiter unten mit dem Format des Dekodierers
  }
  const channels = Math.max(1, data.numberOfChannels);
  const format = data.format;
  if (format === 'f32-planar') {
    data.copyTo(out, { planeIndex: 0 });
    return out;
  }
  if (format === 'f32') {
    const all = new Float32Array(frames * channels);
    data.copyTo(all, { planeIndex: 0 });
    for (let i = 0; i < frames; i++) out[i] = all[i * channels];
    return out;
  }
  if (format === 's16' || format === 's16-planar') {
    const planar = format === 's16-planar';
    const all = new Int16Array(planar ? frames : frames * channels);
    data.copyTo(all, { planeIndex: 0 });
    for (let i = 0; i < frames; i++) out[i] = all[planar ? i : i * channels] / 32768;
    return out;
  }
  if (format === 's32' || format === 's32-planar') {
    const planar = format === 's32-planar';
    const all = new Int32Array(planar ? frames : frames * channels);
    data.copyTo(all, { planeIndex: 0 });
    for (let i = 0; i < frames; i++) out[i] = all[planar ? i : i * channels] / 2147483648;
    return out;
  }
  throw new Error(`Unbekanntes Audioformat ${format}`);
}

/**
 * Eine Teilnahme am Voice Chat einer Einladung.
 *
 * Optionen: code (Einladung), protocols (z. B. ['heldix-voice', 'gast.<token>'] oder ['heldix-voice']), selfId (eigene
 * UUID bzw. Gast-ID), guest (bin ich Gast?), encoderConfig (aus checkVoiceSupport), renewGuest (async () → neue
 * Unterprotokolle oder null, wenn der Gast-Zugang nicht mehr geht), checkLogin (async () → false, wenn die Anmeldung
 * abgelaufen ist), onEvent(type, detail).
 *
 * Ereignisse: status { status: connecting|connected|reconnecting|closed, message?, retryIn? }, peers [Teilnehmer],
 * activity { level, talking, speaking: Set }, microphone { ok, reason }, notice { message }.
 */
export class VoiceSession {
  constructor({ code, protocols, selfId = null, guest = false, encoderConfig = ENCODER_CONFIGS[2], renewGuest = null, checkLogin = null, onEvent = () => {} }) {
    this.code = code;
    this.protocols = protocols;
    this.selfId = selfId;
    this.guest = guest;
    this.encoderConfig = encoderConfig;
    this.renewGuest = renewGuest;
    this.checkLogin = checkLogin;
    this.emit = onEvent;

    this.status = 'idle';
    this.ws = null;
    this.opened = false;
    this.joined = false;
    this.closedByUs = false;
    this.attempt = 0;
    this.renewed = false;
    this.timers = { ping: null, reconnect: null, activity: null };

    this.context = null;
    this.node = null;
    this.stream = null;
    this.source = null;
    this.encoder = null;
    this.encodeTs = 0;
    this.seq = 0;
    this.framer = new SentenceFramer((bytes, end) => this.sendFrame(bytes, end));
    this.vad = new VoiceActivation({ threshold: 0.4, holdMs: 300 });
    this.microphone = { ok: false, reason: 'aus' };

    this.muted = false;
    this.deafened = false;
    this.mode = 'vad';
    this.pttDown = false;
    this.talking = false;
    this.level = 0;

    /** id → { id, guest, browser, name, muted, deafened, volume } */
    this.peers = new Map();
    /** id → Lautstärke (0–2), bleibt auch beim Neuverbinden */
    this.volumes = new Map();
    /** id → Name (Einladender, ich selbst, Freunde) – für echte Spieler; Gäste haben ihren Namen aus `peers` */
    this.names = new Map();
    /** id → Zustand des Sprechers (Dekodierer, Folgenummern) */
    this.speakers = new Map();
    this.onPageHide = () => this.leave();
  }

  // -------------------------------------------------------------------------------------------------------
  // Start und Ende
  // -------------------------------------------------------------------------------------------------------

  /** Audio einrichten (Mikrofon fragt der Browser jetzt), dann verbinden. Muss aus einem Klick heraus kommen. */
  async start() {
    // Der AudioContext entsteht vor dem ersten await, solange der Klick noch als Nutzeraktion gilt.
    window.addEventListener('pagehide', this.onPageHide);
    this.setStatus('connecting');
    try {
      this.context = this.createContext(true);
      await this.setupGraph();
    } catch {
      this.finish('Der Ton für den Voice Chat ließ sich in diesem Browser nicht einrichten. Nimm einen aktuellen Chrome, Edge oder Firefox.', { code: 'audio' });
      return false;
    }
    await this.openMicrophone();
    if (this.status === 'closed') return false;
    this.context.resume?.().catch(() => {});
    this.timers.activity = setInterval(() => this.reportActivity(), ACTIVITY_MS);
    this.connect();
    return true;
  }

  /** Läuft der Ton? (Manche Browser starten ihn erst nach einem weiteren Klick.) */
  get audioSuspended() {
    return this.context?.state === 'suspended';
  }

  resumeAudio() {
    return this.context?.resume?.().catch(() => {});
  }

  createContext(wanted48k) {
    const options = { latencyHint: 'interactive' };
    if (wanted48k) options.sampleRate = SAMPLE_RATE;
    try {
      return new AudioContext(options);
    } catch {
      return new AudioContext({ latencyHint: 'interactive' });
    }
  }

  async setupGraph() {
    await this.context.audioWorklet.addModule('/voice-worklet.js');
    this.node = new AudioWorkletNode(this.context, 'heldix-voice', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.node.port.onmessage = (event) => {
      if (event.data?.type === 'block') this.onBlock(event.data.samples);
    };
    this.node.connect(this.context.destination);
    this.node.port.postMessage({ type: 'silent', on: this.deafened });
    for (const [id, gain] of this.volumes) this.node.port.postMessage({ type: 'gain', id, gain });
  }

  /** Mikrofon anfragen (beim Start und mit „Mikrofon erlauben“). Ohne Mikrofon hört man nur zu. */
  async openMicrophone() {
    if (this.stream) return this.microphone;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setMicrophone(false, 'nicht-verfuegbar');
      return this.microphone;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
    } catch (error) {
      const name = error?.name;
      this.setMicrophone(false, name === 'NotAllowedError' || name === 'SecurityError' ? 'verweigert' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'keins' : 'fehler');
      return this.microphone;
    }
    if (this.status === 'closed') {
      for (const track of stream.getTracks()) track.stop();
      return this.microphone;
    }
    this.stream = stream;
    try {
      this.source = this.context.createMediaStreamSource(stream);
    } catch {
      // Manche Browser verbinden ein Mikrofon nur mit einem AudioContext in dessen eigener Abtastrate:
      // neu aufbauen ohne feste Rate, das Worklet rechnet dann auf 48 kHz um.
      try {
        this.node?.disconnect();
        await this.context.close();
        this.context = this.createContext(false);
        await this.setupGraph();
        this.source = this.context.createMediaStreamSource(stream);
      } catch {
        for (const track of stream.getTracks()) track.stop();
        this.stream = null;
        this.setMicrophone(false, 'fehler');
        return this.microphone;
      }
    }
    this.source.connect(this.node);
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => this.setMicrophone(false, 'beendet'));
    if (!this.createEncoder()) {
      this.setMicrophone(false, 'fehler');
      return this.microphone;
    }
    this.node.port.postMessage({ type: 'capture', on: true });
    this.setMicrophone(true, null);
    return this.microphone;
  }

  createEncoder() {
    try {
      this.encoder?.close();
    } catch {
      // schon zu
    }
    this.framer.reset();
    try {
      this.encoder = new AudioEncoder({
        output: (chunk) => {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          this.framer.output(bytes);
        },
        error: () => {
          // Kodierer kaputt (z. B. Gerät gewechselt): beim nächsten Block neu
          this.encoder = null;
        },
      });
      this.encoder.configure(this.encoderConfig);
      return true;
    } catch {
      this.encoder = null;
      return false;
    }
  }

  setMicrophone(ok, reason) {
    this.microphone = { ok, reason };
    if (!ok) {
      this.vad.reset();
      if (this.talking) this.framer.end();
      this.talking = false;
    }
    this.emit('microphone', this.microphone);
  }

  /** Verlassen: Verbindung schließen, Mikrofon frei, Audio aus. */
  leave() {
    if (this.status === 'closed') return;
    this.finish(null);
  }

  finish(message, { code = null } = {}) {
    this.closedByUs = true;
    clearInterval(this.timers.ping);
    clearTimeout(this.timers.reconnect);
    clearInterval(this.timers.activity);
    window.removeEventListener('pagehide', this.onPageHide);
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      try {
        this.ws.close(1000, 'Verlassen');
      } catch {
        // egal
      }
    }
    this.ws = null;
    this.cleanupAudio();
    this.setStatus('closed', { message, code });
  }

  cleanupAudio() {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    try {
      this.source?.disconnect();
      this.node?.disconnect();
    } catch {
      // schon getrennt
    }
    try {
      this.encoder?.close();
    } catch {
      // schon zu
    }
    this.encoder = null;
    for (const speaker of this.speakers.values()) this.closeDecoder(speaker);
    this.speakers.clear();
    this.context?.close().catch(() => {});
    this.context = null;
    this.node = null;
    this.source = null;
  }

  // -------------------------------------------------------------------------------------------------------
  // Verbindung
  // -------------------------------------------------------------------------------------------------------

  setStatus(status, extra = {}) {
    this.status = status;
    this.emit('status', { status, ...extra });
  }

  connect() {
    if (this.closedByUs) return;
    this.opened = false;
    this.joined = false;
    let ws;
    try {
      ws = new WebSocket(voiceUrl(), this.protocols);
    } catch {
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.opened = true;
    });
    ws.addEventListener('message', (event) => {
      if (this.ws !== ws) return;
      if (typeof event.data === 'string') this.onText(event.data);
      else this.onFrame(event.data);
    });
    ws.addEventListener('close', (event) => {
      if (this.ws !== ws) return;
      this.onClose(event.code, ws);
    });
    ws.addEventListener('error', () => {
      // danach kommt close
    });
  }

  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  async onClose(code, ws) {
    clearInterval(this.timers.ping);
    this.joined = false;
    if (this.closedByUs) return;
    this.ws = null;
    this.clearPeers();
    if (CLOSE_TEXTS[code]) return this.finish(CLOSE_TEXTS[code], { code });
    if (!this.opened) {
      // Abgelehnt, bevor die Verbindung stand: abgelaufene Gast-Sitzung (z. B. nach einem Neustart des Dienstes,
      // dann kennt er das Token nicht mehr), abgelaufene Anmeldung – oder einfach kein Netz.
      if (this.guest && this.renewGuest && !this.renewed) {
        this.renewed = true;
        let protocols = null;
        try {
          protocols = await this.renewGuest();
        } catch (error) {
          if (error?.status === 404) return this.finish(CLOSE_TEXTS[4006], { code: 4006 });
          if (error?.status === 429 || error?.status === 409 || error?.status === 400) return this.finish(error.message, { code: error.status });
          // Dienst nicht erreichbar: beim nächsten Versuch wieder einen neuen Gast-Zugang holen
          this.renewed = false;
          protocols = null;
        }
        if (this.closedByUs) return;
        if (protocols) {
          this.protocols = protocols;
          this.connect();
          return;
        }
      } else if (!this.guest && this.checkLogin) {
        const ok = await this.checkLogin().catch(() => true);
        if (this.closedByUs) return;
        if (!ok) return this.finish('Du bist auf dieser Seite nicht mehr angemeldet. Melde dich neu an oder tritt als Gast bei.', { code: 401 });
      }
    }
    if (ws && !RECONNECT_CODES.has(code) && this.opened) return this.finish('Die Verbindung zum Voice Chat wurde beendet.', { code });
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.closedByUs) return;
    const delay = RECONNECT_DELAYS[Math.min(this.attempt, RECONNECT_DELAYS.length - 1)];
    this.attempt++;
    this.setStatus('reconnecting', { retryIn: delay });
    clearTimeout(this.timers.reconnect);
    this.timers.reconnect = setTimeout(() => this.connect(), delay);
  }

  onText(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'ready': {
        const features = Array.isArray(message.features) ? message.features : [];
        if (!features.includes('guests')) return this.finish('Der Heldix-Dienst kann noch keine Teilnehmer im Browser. Versuch es nach dem nächsten Update noch einmal.', { code: 'alt' });
        this.attempt = 0;
        this.renewed = false;
        this.send({ type: 'join', invite: this.code });
        this.sendState();
        clearInterval(this.timers.ping);
        this.timers.ping = setInterval(() => this.send({ type: 'ping' }), PING_MS);
        this.joined = true;
        this.setStatus('connected');
        return;
      }
      case 'peers':
        this.applyPeers(message);
        return;
      case 'state':
        this.applyState(message);
        return;
      case 'group':
        if (message.status === 'full') this.finish('Die Gruppe ist voll – in eine Gruppe passen höchstens 16 Teilnehmer.', { code: 'voll' });
        return;
      case 'invite':
        // Einladung ungültig: der Dienst schließt gleich mit 4006
        if (message.status === 'invalid') this.finish(CLOSE_TEXTS[4006], { code: 4006 });
        return;
      default:
      // pong und Unbekanntes: nichts zu tun
    }
  }

  sendState() {
    this.send({ type: 'state', muted: this.muted || this.deafened || !this.microphone.ok, deafened: this.deafened });
  }

  // -------------------------------------------------------------------------------------------------------
  // Teilnehmer
  // -------------------------------------------------------------------------------------------------------

  applyPeers(message) {
    const ids = [...new Set([...(Array.isArray(message.group) ? message.group : []), ...(Array.isArray(message.uuids) ? message.uuids : [])])].filter((id) => typeof id === 'string' && UUID_RE.test(id) && id !== this.selfId);
    const guests = message.guests && typeof message.guests === 'object' && !Array.isArray(message.guests) ? message.guests : {};
    const browser = new Set(Array.isArray(message.browser) ? message.browser : []);
    const muted = new Set(Array.isArray(message.muted) ? message.muted : []);
    const deafened = new Set(Array.isArray(message.deafened) ? message.deafened : []);
    const next = new Map();
    for (const id of ids) {
      const before = this.peers.get(id);
      const guestName = typeof guests[id] === 'string' ? guests[id].slice(0, 32) : null;
      next.set(id, {
        id,
        guest: guestName !== null,
        browser: browser.has(id),
        name: guestName,
        muted: muted.has(id),
        deafened: deafened.has(id),
        volume: this.volumes.get(id) ?? before?.volume ?? 1,
      });
    }
    for (const id of this.peers.keys()) {
      if (!next.has(id)) {
        const speaker = this.speakers.get(id);
        if (speaker) this.closeDecoder(speaker);
        this.speakers.delete(id);
        this.node?.port.postMessage({ type: 'remove', id });
      }
    }
    this.peers = next;
    this.emitPeers();
  }

  applyState(message) {
    const peer = typeof message.uuid === 'string' ? this.peers.get(message.uuid) : null;
    if (!peer || typeof message.muted !== 'boolean' || typeof message.deafened !== 'boolean') return;
    peer.muted = message.muted;
    peer.deafened = message.deafened;
    this.emitPeers();
  }

  /** Verbindung weg: niemand mehr zu hören, Liste leer (bis zum nächsten `peers`). */
  clearPeers() {
    for (const speaker of this.speakers.values()) this.closeDecoder(speaker);
    this.speakers.clear();
    this.node?.port.postMessage({ type: 'clear' });
    for (const [id, gain] of this.volumes) this.node?.port.postMessage({ type: 'gain', id, gain });
    if (this.peers.size) {
      this.peers = new Map();
      this.emitPeers();
    }
  }

  emitPeers() {
    this.emit('peers', [...this.peers.values()].map((peer) => ({ ...peer, name: peer.name ?? this.names.get(peer.id) ?? null })));
  }

  /** Namen echter Spieler (Einladender, ich, Freunde) – Gäste bringen ihren Namen selbst mit. */
  setNames(entries) {
    for (const [id, name] of entries) if (UUID_RE.test(id) && typeof name === 'string' && name) this.names.set(id, name);
    if (this.peers.size) this.emitPeers();
  }

  setVolume(id, volume) {
    if (!UUID_RE.test(id) || !Number.isFinite(volume)) return;
    const gain = Math.max(0, Math.min(2, volume));
    this.volumes.set(id, gain);
    const peer = this.peers.get(id);
    if (peer) peer.volume = gain;
    this.node?.port.postMessage({ type: 'gain', id, gain });
  }

  /** Gast aus der Gruppe entfernen (nur für angemeldete Teilnehmer; der Dienst prüft selbst). */
  kick(id) {
    const peer = this.peers.get(id);
    if (!peer?.guest || this.guest) return false;
    this.send({ type: 'kick', uuid: id });
    return true;
  }

  // -------------------------------------------------------------------------------------------------------
  // Status: stumm, Ton aus, Sprechen
  // -------------------------------------------------------------------------------------------------------

  setMuted(muted) {
    this.muted = Boolean(muted);
    this.sendState();
  }

  setDeafened(deafened) {
    this.deafened = Boolean(deafened);
    this.node?.port.postMessage({ type: 'silent', on: this.deafened });
    if (this.deafened) {
      for (const speaker of this.speakers.values()) this.closeDecoder(speaker);
      this.speakers.clear();
    }
    this.sendState();
  }

  setMode(mode) {
    this.mode = mode === 'ptt' ? 'ptt' : 'vad';
    this.pttDown = false;
    this.vad.reset();
  }

  setThreshold(value) {
    if (Number.isFinite(value)) this.vad.threshold = Math.max(0, Math.min(1, value));
  }

  setPtt(down) {
    this.pttDown = Boolean(down);
  }

  /** Ein 20-ms-Block vom Mikrofon (48 kHz). */
  onBlock(samples) {
    const level = meterLevel(rmsLevel(samples));
    this.level = Math.max(level, this.level * 0.85);
    if (!this.encoder && this.microphone.ok && this.status !== 'closed') this.createEncoder();
    const allowed = this.joined && this.microphone.ok && !this.muted && !this.deafened && this.encoder && this.ws?.readyState === WebSocket.OPEN;
    let want = false;
    if (allowed) want = this.mode === 'ptt' ? this.pttDown : this.vad.update(level, performance.now());
    else this.vad.reset();
    // Kommt der Kodierer nicht hinterher, lieber einen Block auslassen als Verzögerung aufbauen
    if (want && this.encoder.encodeQueueSize <= 8) {
      let data = null;
      try {
        data = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: FRAME_SAMPLES, numberOfChannels: 1, timestamp: this.encodeTs, data: samples });
        this.encoder.encode(data);
        this.framer.input();
      } catch {
        this.encoder = null;
      } finally {
        data?.close();
      }
      this.encodeTs += FRAME_US;
    }
    if (this.talking && !want) this.framer.end();
    this.talking = want;
  }

  sendFrame(bytes, end) {
    if (this.ws?.readyState !== WebSocket.OPEN || bytes.length === 0) return;
    try {
      this.ws.send(packFrame(this.seq, bytes, end));
    } catch {
      return;
    }
    this.seq = nextSeq(this.seq);
  }

  reportActivity() {
    const now = performance.now();
    const speaking = new Set();
    for (const speaker of this.speakers.values()) {
      if (!speaker.ended && now - speaker.lastAt < SPEAKING_MS) speaking.add(speaker.id);
      if (now - speaker.lastAt > IDLE_DECODER_MS) {
        this.closeDecoder(speaker);
        this.speakers.delete(speaker.id);
      }
    }
    this.emit('activity', { level: this.microphone.ok ? this.level : 0, talking: this.talking, speaking });
    this.level *= 0.85;
  }

  // -------------------------------------------------------------------------------------------------------
  // Empfangen
  // -------------------------------------------------------------------------------------------------------

  onFrame(data) {
    if (this.deafened || !this.node) return;
    const frame = unpackFrame(data);
    if (!frame || frame.id === this.selfId) return;
    let speaker = this.speakers.get(frame.id);
    if (!speaker) {
      speaker = { id: frame.id, tracker: new SequenceTracker({ maxGap: 5 }), index: 0, expected: null, decoder: null, lastAt: 0, ended: false, endTs: null };
      this.speakers.set(frame.id, speaker);
    }
    const order = speaker.tracker.accept(frame.seq);
    if (order.drop) return;
    if (order.restart) {
      speaker.index += 1;
      speaker.expected = null;
    } else {
      speaker.index += 1 + order.missing;
    }
    if (!speaker.decoder && !this.openDecoder(speaker)) return;
    const timestamp = frameTimestamp(speaker.index);
    try {
      speaker.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp, data: frame.opus }));
    } catch {
      this.closeDecoder(speaker);
      return;
    }
    speaker.lastAt = performance.now();
    speaker.ended = frame.end;
    if (frame.end) speaker.endTs = timestamp;
  }

  openDecoder(speaker) {
    try {
      const decoder = new AudioDecoder({
        output: (audio) => this.onDecoded(speaker, audio),
        error: () => {
          if (speaker.decoder === decoder) speaker.decoder = null;
          speaker.expected = null;
        },
      });
      decoder.configure(OPUS);
      speaker.decoder = decoder;
      return true;
    } catch {
      speaker.decoder = null;
      return false;
    }
  }

  closeDecoder(speaker) {
    try {
      if (speaker.decoder && speaker.decoder.state !== 'closed') speaker.decoder.close();
    } catch {
      // schon zu
    }
    speaker.decoder = null;
    speaker.expected = null;
  }

  onDecoded(speaker, audio) {
    try {
      if (!this.node || this.deafened) return;
      const samples = audioDataToFloat32(audio);
      const timestamp = audio.timestamp;
      const gap = gapSamples(speaker.expected, timestamp, { maxFrames: 5 });
      speaker.expected = timestamp + Math.round((samples.length * 1e6) / (audio.sampleRate || SAMPLE_RATE));
      this.node.port.postMessage({ type: 'pcm', id: speaker.id, samples, gap }, [samples.buffer]);
      if (speaker.endTs !== null && timestamp >= speaker.endTs) {
        speaker.endTs = null;
        this.node.port.postMessage({ type: 'end', id: speaker.id });
      }
    } catch {
      // ein kaputter Rahmen: auslassen
    } finally {
      audio.close();
    }
  }
}
