// HeldixClient – Webseite: Voice Chat im Browser, reine Logik ohne DOM und ohne Audio-Schnittstellen. Läuft im
// Browser (voice-browser.js), im AudioWorklet (voice-worklet.js) und in Node (Prüfskript).
//
// Gleiches Format wie im Spiel (Addon „Voice Chat“) und im Heldix-Dienst (service/src/voice.ts, Rahmen-Version 1):
//   gesendet:      [1][Flags][Folgenummer hi][lo][Opus]
//   weitergeleitet [1][Flags][Folgenummer hi][lo][16 Byte ID des Sprechers][Opus]
//   Flags: Bit 0 = letzter Rahmen eines Satzes. Opus mit 48 kHz, mono, 20 ms je Rahmen (960 Samples).
// Gast-IDs sind 16 zufällige Byte im selben Feld wie die UUID eines Spielers (beide als 32 hex).
//
// Exporte: Konstanten, packFrame, unpackFrame, bytesToHex, nextSeq, SequenceTracker, SentenceFramer,
// PcmJitterBuffer, LinearResampler, rmsLevel, meterLevel, VoiceActivation, frameTimestamp, gapSamples,
// LIMITER, compressorMakeupGain (Lautstärke-Schutz), dbfs, LevelHistory (Lautstärke-Verlauf für Meldungen).

export const VOICE_PROTOCOL = 1;
export const SAMPLE_RATE = 48_000;
/** 20 ms bei 48 kHz */
export const FRAME_SAMPLES = 960;
export const FRAME_US = 20_000;
/** Größte Opus-Nutzlast, die der Dienst weiterleitet (VOICE_MAX_FRAME). */
export const MAX_OPUS_BYTES = 1024;
export const FLAG_END = 1;
const HEADER = 4;
const ID_BYTES = 16;
const OUT_HEADER = HEADER + ID_BYTES;

// ---------------------------------------------------------------------------------------------------------
// Rahmen
// ---------------------------------------------------------------------------------------------------------

/** Rahmen zum Senden: Folgenummer (0–65535), Opus-Paket, Ende eines Satzes. */
export function packFrame(seq, opus, end = false) {
  const payload = opus instanceof Uint8Array ? opus : new Uint8Array(opus);
  if (payload.length === 0 || payload.length > MAX_OPUS_BYTES) throw new RangeError('Opus-Paket leer oder zu groß');
  const out = new Uint8Array(HEADER + payload.length);
  out[0] = VOICE_PROTOCOL;
  out[1] = end ? FLAG_END : 0;
  out[2] = (seq >>> 8) & 0xff;
  out[3] = seq & 0xff;
  out.set(payload, HEADER);
  return out;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** Bytes als Kleinbuchstaben-Hex. */
export function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i]];
  return out;
}

/**
 * Weitergeleiteten Rahmen lesen → { end, seq, id (32 hex), opus (Uint8Array, Sicht auf die Daten) } oder null
 * (falsche Version, zu kurz, zu groß).
 */
export function unpackFrame(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length <= OUT_HEADER || bytes.length > OUT_HEADER + MAX_OPUS_BYTES || bytes[0] !== VOICE_PROTOCOL) return null;
  return {
    end: (bytes[1] & FLAG_END) !== 0,
    seq: (bytes[2] << 8) | bytes[3],
    id: bytesToHex(bytes.subarray(HEADER, OUT_HEADER)),
    opus: bytes.subarray(OUT_HEADER),
  };
}

export const nextSeq = (seq) => (seq + 1) & 0xffff;

/**
 * Folgenummern eines Sprechers: doppelte und alte Rahmen verwerfen, kleine Lücken melden (dann füllt die Wiedergabe
 * Stille ein), große Sprünge als neuen Anfang nehmen. Über TCP kommt nichts durcheinander; Lücken entstehen nur, wenn
 * der Dienst Rahmen verwirft (Grenze je Sekunde, voller Puffer).
 */
export class SequenceTracker {
  constructor({ maxGap = 5 } = {}) {
    this.maxGap = maxGap;
    this.last = null;
  }

  /** → { drop: true } oder { drop: false, missing: Anzahl fehlender Rahmen davor, restart: neuer Anfang } */
  accept(seq) {
    if (this.last === null) {
      this.last = seq;
      return { drop: false, missing: 0, restart: true };
    }
    const delta = (seq - this.last) & 0xffff;
    if (delta === 0 || delta >= 0x8000) {
      // doppelt oder älter als der letzte – außer nach einem sehr großen Sprung (Neustart des Senders)
      if (delta === 0 || delta > 0xffff - 64) return { drop: true };
      this.last = seq;
      return { drop: false, missing: 0, restart: true };
    }
    this.last = seq;
    if (delta === 1) return { drop: false, missing: 0, restart: false };
    if (delta - 1 <= this.maxGap) return { drop: false, missing: delta - 1, restart: false };
    return { drop: false, missing: 0, restart: true };
  }

  reset() {
    this.last = null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Senden: Bit „Ende eines Satzes“ am richtigen Rahmen
// ---------------------------------------------------------------------------------------------------------

/**
 * Der Opus-Kodierer liefert seine Pakete später (asynchron) als die Blöcke, die er bekommt – erst danach weiß man, dass
 * ein Satz zu Ende ist (Sprachaktivierung abgelaufen, Taste losgelassen). Deshalb hält diese Klasse immer das jüngste
 * Paket zurück und schickt es erst mit dem nächsten (ohne Bit) oder am Ende des Satzes (mit Bit 0). Kodierer für Opus
 * liefern genau ein Paket je 20-ms-Block; die Pakete werden in derselben Reihenfolge gezählt wie die Blöcke.
 *
 *   input()       – ein Block geht an den Kodierer (Zählung)
 *   end()         – der zuletzt gegebene Block war der letzte des Satzes
 *   output(bytes) – ein Paket vom Kodierer
 *   send(bytes, end) wird mit jedem fertigen Rahmen gerufen.
 */
export class SentenceFramer {
  constructor(send) {
    this.send = send;
    this.inputs = 0;
    this.outputs = 0;
    this.held = null;
    this.heldIndex = 0;
    /** Index des letzten Blocks eines beendeten Satzes, dessen Paket noch fehlt */
    this.pendingEnd = 0;
  }

  input() {
    this.inputs++;
    return this.inputs;
  }

  end() {
    const last = this.inputs;
    if (last === 0) return;
    if (this.held && this.heldIndex === last) {
      this.send(this.held, true);
      this.held = null;
    } else if (this.outputs < last) {
      this.pendingEnd = last;
    } else if (this.held) {
      // (sollte nicht vorkommen: gehaltenes Paket ist älter als der letzte Block)
      this.send(this.held, true);
      this.held = null;
    }
  }

  output(bytes) {
    const index = ++this.outputs;
    if (this.pendingEnd && index >= this.pendingEnd) {
      if (this.held) this.send(this.held, false);
      this.held = null;
      this.send(bytes, true);
      this.pendingEnd = 0;
      return;
    }
    if (this.held) this.send(this.held, false);
    this.held = bytes;
    this.heldIndex = index;
  }

  /** Neuer Kodierer (z. B. nach einem Fehler): Zählung neu, nichts mehr zurückhalten. */
  reset() {
    this.inputs = 0;
    this.outputs = 0;
    this.held = null;
    this.heldIndex = 0;
    this.pendingEnd = 0;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Wiedergabe: Jitter-Puffer je Sprecher (PCM)
// ---------------------------------------------------------------------------------------------------------

/**
 * Puffer für die Samples eines Sprechers. Beginnt erst zu spielen, wenn `target` Samples da sind (60 ms), damit
 * ungleichmäßig ankommende Rahmen nicht knacksen. Läuft er leer, kommt Stille, und er sammelt wieder bis `target`.
 * Wird er größer als `max` (Rahmen kamen gesammelt an), fallen die ältesten Samples weg, bis wieder `target` da ist.
 * Am Ende eines Satzes (markEnd) spielt er den Rest ohne Warten aus.
 */
export class PcmJitterBuffer {
  constructor({ target = 2880, max = 9600 } = {}) {
    this.target = target;
    this.max = Math.max(max, target * 2);
    this.chunks = [];
    this.offset = 0;
    this.length = 0;
    this.playing = false;
    this.draining = false;
    this.underruns = 0;
    this.dropped = 0;
  }

  push(samples) {
    if (!samples || samples.length === 0) return;
    this.chunks.push(samples);
    this.length += samples.length;
    this.draining = false;
    if (this.length > this.max) this.skip(this.length - this.target);
  }

  /** Lücke (fehlende Rahmen) mit Stille füllen. */
  pushSilence(count) {
    if (count > 0) this.push(new Float32Array(count));
  }

  /** Satz zu Ende: Rest ausspielen, ohne auf `target` zu warten. */
  markEnd() {
    if (this.length > 0) this.draining = true;
  }

  skip(count) {
    let rest = count;
    while (rest > 0 && this.chunks.length) {
      const head = this.chunks[0];
      const available = head.length - this.offset;
      if (available <= rest) {
        rest -= available;
        this.chunks.shift();
        this.offset = 0;
      } else {
        this.offset += rest;
        rest = 0;
      }
    }
    const done = count - rest;
    this.length -= done;
    this.dropped += done;
  }

  /**
   * Bis zu out.length Samples mal `gain` auf `out` addieren (Mischen mehrerer Sprecher). Liefert die Zahl der
   * geschriebenen Samples; der Rest bleibt, wie er war (Stille).
   */
  mixInto(out, gain = 1) {
    if (!this.playing) {
      if (this.length >= this.target || (this.draining && this.length > 0)) this.playing = true;
      else return 0;
    }
    let written = 0;
    while (written < out.length && this.chunks.length) {
      const head = this.chunks[0];
      const n = Math.min(out.length - written, head.length - this.offset);
      for (let i = 0; i < n; i++) out[written + i] += head[this.offset + i] * gain;
      written += n;
      this.offset += n;
      if (this.offset >= head.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    this.length -= written;
    if (this.length === 0) {
      // Leer gelaufen: am Ende eines Satzes normal, mitten drin ein Aussetzer – danach wieder sammeln
      if (!this.draining && written < out.length) this.underruns++;
      this.playing = false;
      this.draining = false;
    }
    return written;
  }

  clear() {
    this.chunks = [];
    this.offset = 0;
    this.length = 0;
    this.playing = false;
    this.draining = false;
  }
}

/**
 * Einfaches lineares Umrechnen der Abtastrate (fortlaufend, mit Zustand zwischen den Blöcken). Für Browser, deren
 * AudioContext nicht mit 48 kHz läuft – für Sprache reicht linear.
 */
export class LinearResampler {
  constructor(from, to) {
    this.step = from / to;
    /** Position (in Samples) ab dem letzten Sample des vorigen Blocks */
    this.frac = 0;
    this.prev = 0;
  }

  /** Neue Samples (Float32Array) → umgerechnete Samples (neues Float32Array). */
  process(input) {
    const n = input.length;
    if (n === 0) return new Float32Array(0);
    // Gedachte Folge: [voriges letztes Sample, input[0], …, input[n-1]]; Position p läuft darin von frac bis < n.
    const count = this.frac < n ? Math.ceil((n - this.frac) / this.step) : 0;
    const out = new Float32Array(count);
    let p = this.frac;
    let k = 0;
    while (p < n && k < count) {
      const i = Math.floor(p);
      const a = i === 0 ? this.prev : input[i - 1];
      out[k++] = a + (input[i] - a) * (p - i);
      p += this.step;
    }
    this.frac = p - n;
    this.prev = input[n - 1];
    return k === count ? out : out.subarray(0, k);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Pegel und Sprachaktivierung
// ---------------------------------------------------------------------------------------------------------

/** Effektivwert eines Blocks. */
export function rmsLevel(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Für Anzeige und Schwelle: −60 dBFS (und leiser) → 0, 0 dBFS → 1. */
export function meterLevel(rms) {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

/**
 * Sprachaktivierung: an, sobald der Pegel (0–1 wie meterLevel) die Schwelle erreicht; aus erst, wenn er `holdMs`
 * lang darunter bleibt (so werden Wortenden und kurze Pausen nicht abgeschnitten).
 */
export class VoiceActivation {
  constructor({ threshold = 0.4, holdMs = 300 } = {}) {
    this.threshold = threshold;
    this.holdMs = holdMs;
    this.active = false;
    this.lastAbove = -Infinity;
  }

  update(level, now) {
    if (level >= this.threshold) {
      this.lastAbove = now;
      this.active = true;
    } else if (this.active && now - this.lastAbove > this.holdMs) {
      this.active = false;
    }
    return this.active;
  }

  reset() {
    this.active = false;
    this.lastAbove = -Infinity;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Zeit
// ---------------------------------------------------------------------------------------------------------

/** Zeitstempel (µs) des n-ten Rahmens eines Sprechers – für den Opus-Dekodierer. */
export const frameTimestamp = (index) => index * FRAME_US;

/**
 * Stille vor einem dekodierten Rahmen: Zeitstempel weiter als erwartet (Lücke in den Folgenummern) → so viele Samples,
 * höchstens maxFrames Rahmen; sonst 0.
 */
export function gapSamples(expectedUs, timestampUs, { maxFrames = 5, rate = SAMPLE_RATE } = {}) {
  if (expectedUs === null || expectedUs === undefined || !(timestampUs > expectedUs)) return 0;
  const samples = Math.round(((timestampUs - expectedUs) * rate) / 1e6);
  return Math.min(samples, maxFrames * Math.round((FRAME_US * rate) / 1e6));
}

// ---------------------------------------------------------------------------------------------------------
// Lautstärke-Schutz (DynamicsCompressorNode im Ausgabeweg, voice-browser.js)
// ---------------------------------------------------------------------------------------------------------

/**
 * Einstellungen des Begrenzers: weiche Kompression ab −18 dBFS (Übergang über 10 dB), danach 12:1, schnelle Attack,
 * langsame Release – wie der Lautstärke-Schutz im Spiel (Voice Chat 1.3.0), nur ohne den Schutz gegen Dauerlärm.
 */
export const LIMITER = Object.freeze({ threshold: -18, knee: 10, ratio: 12, attack: 0.003, release: 0.25 });

const toLinear = (db) => 10 ** (db / 20);
const toDb = (linear) => 20 * Math.log10(linear);

/**
 * Aufholverstärkung, die ein DynamicsCompressorNode von sich aus auf das Ergebnis legt (Web Audio: „makeup gain“ =
 * (1 / Kurve(1,0))^0,6, Kurve mit exponentiellem Übergang wie in Chromium, Firefox und WebKit). Der Lautstärke-Schutz
 * gleicht sie mit einem GainNode wieder aus (1 / Ergebnis) – sonst würde er leise Stimmen und Rauschen lauter machen.
 */
export function compressorMakeupGain({ threshold, knee, ratio } = LIMITER) {
  const linearThreshold = toLinear(threshold);
  const kneeCurve = (x, k) => (x < linearThreshold ? x : linearThreshold + (1 - Math.exp(-k * (x - linearThreshold))) / k);
  const slopeAt = (x, k) => {
    if (x < linearThreshold) return 1;
    const x2 = x * 1.001;
    return (toDb(kneeCurve(x2, k)) - toDb(kneeCurve(x, k))) / (toDb(x2) - toDb(x));
  };
  // k so wählen, dass die Kurve am Ende des Übergangs die Steigung 1/ratio hat (Bisektion wie im Browser)
  const kneeEnd = toLinear(threshold + knee);
  let minK = 0.1;
  let maxK = 10_000;
  let k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(kneeEnd, k) < 1 / ratio) maxK = k;
    else minK = k;
    k = Math.sqrt(minK * maxK);
  }
  const kneeEndDb = toDb(kneeCurve(kneeEnd, k));
  const fullRange = 1 >= kneeEnd ? toLinear(kneeEndDb + (0 - (threshold + knee)) / ratio) : kneeCurve(1, k);
  return (1 / fullRange) ** 0.6;
}

// ---------------------------------------------------------------------------------------------------------
// Lautstärke-Verlauf eines Sprechers (für Meldungen: nur der Pegel je Sekunde, kein Inhalt)
// ---------------------------------------------------------------------------------------------------------

/** Pegel (linear, 0–1) als ganze dBFS-Zahl von −100 bis 0. */
export function dbfs(value) {
  if (!(value > 0)) return -100;
  return Math.max(-100, Math.min(0, Math.round(toDb(value))));
}

/**
 * Pegel je Sekunde (Effektivwert und Spitze in dBFS) der dekodierten Samples eines Sprechers – gemessen vor Lautstärke
 * je Person und Lautstärke-Schutz. Behält höchstens `seconds` Sekunden; Sekunden ohne empfangene Rahmen sind null.
 */
export class LevelHistory {
  constructor({ seconds = 600 } = {}) {
    this.seconds = seconds;
    /** Sekunde (ms / 1000, abgerundet) → { sum, count, peak } */
    this.buckets = new Map();
    this.lastAt = -Infinity;
  }

  /** Dekodierte Samples (Float32Array) zum Zeitpunkt nowMs (Date.now()). */
  add(samples, nowMs) {
    if (!samples || samples.length === 0) return;
    const second = Math.floor(nowMs / 1000);
    let bucket = this.buckets.get(second);
    if (!bucket) {
      bucket = { sum: 0, count: 0, peak: 0 };
      this.buckets.set(second, bucket);
      for (const key of this.buckets.keys()) {
        if (key > second - this.seconds) break;
        this.buckets.delete(key);
      }
    }
    let sum = 0;
    let peak = bucket.peak;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      sum += x * x;
      const magnitude = x < 0 ? -x : x;
      if (magnitude > peak) peak = magnitude;
    }
    bucket.sum += sum;
    bucket.count += samples.length;
    bucket.peak = peak;
    this.lastAt = nowMs;
  }

  /**
   * Verlauf bis zum Ende der letzten vollen Sekunde: { end (ms), rms: [...], peak: [...] } (älteste zuerst, höchstens
   * `seconds` Werte, ab der ersten Sekunde mit Ton) oder null, wenn in dieser Zeit nichts zu hören war.
   */
  snapshot(nowMs) {
    const current = Math.floor(nowMs / 1000);
    const first = current - this.seconds;
    let start = null;
    for (const key of this.buckets.keys()) {
      if (key >= first && key < current) {
        start = key;
        break;
      }
    }
    if (start === null) return null;
    const rms = [];
    const peak = [];
    for (let second = start; second < current; second++) {
      const bucket = this.buckets.get(second);
      if (!bucket || bucket.count === 0) {
        rms.push(null);
        peak.push(null);
      } else {
        rms.push(dbfs(Math.sqrt(bucket.sum / bucket.count)));
        peak.push(dbfs(bucket.peak));
      }
    }
    return { end: current * 1000, rms, peak };
  }
}
