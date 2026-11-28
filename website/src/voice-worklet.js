// HeldixClient – Webseite: AudioWorklet für den Voice Chat im Browser (/einladung). Eigene Datei, weil die CSP nur
// Skripte von dieser Seite erlaubt (script-src 'self'); geladen mit audioContext.audioWorklet.addModule().
//
// Ein Knoten „heldix-voice“ für beides:
// - Aufnahme: Eingang 0 (Mikrofon, falls verbunden) → Blöcke zu 960 Samples bei 48 kHz (20 ms) → per port an
//   voice-browser.js ({ type: 'block', samples }), nur solange `capture` an ist. Läuft der AudioContext nicht mit
//   48 kHz, rechnet der Knoten um.
// - Wiedergabe: je Sprecher ein Jitter-Puffer (Ziel 60 ms, höchstens 200 ms, Lücken mit Stille), alle gemischt mit
//   ihrer Lautstärke auf Ausgang 0.
// Nachrichten an den Knoten: capture {on}, pcm {id, samples (48 kHz), gap}, end {id}, gain {id, gain}, remove {id},
// silent {on}, clear.
import { FRAME_SAMPLES, LinearResampler, PcmJitterBuffer, SAMPLE_RATE } from './voice-core.js';

const JITTER_TARGET_S = 0.06;
const JITTER_MAX_S = 0.2;

/** Kern des Knotens ohne AudioWorklet-Klassen (auch in Node prüfbar). rate: Abtastrate des AudioContext. */
export class VoiceMixer {
  constructor(rate, post) {
    this.rate = rate;
    this.post = post;
    this.capture = false;
    this.silent = false;
    this.block = new Float32Array(FRAME_SAMPLES);
    this.fill = 0;
    this.inResampler = rate !== SAMPLE_RATE ? new LinearResampler(rate, SAMPLE_RATE) : null;
    this.speakers = new Map();
  }

  speaker(id) {
    let entry = this.speakers.get(id);
    if (!entry) {
      entry = {
        buffer: new PcmJitterBuffer({ target: Math.round(JITTER_TARGET_S * this.rate), max: Math.round(JITTER_MAX_S * this.rate) }),
        gain: 1,
        resampler: this.rate !== SAMPLE_RATE ? new LinearResampler(SAMPLE_RATE, this.rate) : null,
      };
      this.speakers.set(id, entry);
    }
    return entry;
  }

  message(data) {
    if (!data || typeof data !== 'object') return;
    switch (data.type) {
      case 'capture':
        this.capture = data.on === true;
        this.fill = 0;
        break;
      case 'pcm': {
        if (typeof data.id !== 'string' || !(data.samples instanceof Float32Array)) return;
        const entry = this.speaker(data.id);
        if (data.gap > 0) entry.buffer.pushSilence(Math.round((data.gap * this.rate) / SAMPLE_RATE));
        entry.buffer.push(entry.resampler ? entry.resampler.process(data.samples) : data.samples);
        break;
      }
      case 'end':
        this.speakers.get(data.id)?.buffer.markEnd();
        break;
      case 'gain':
        if (typeof data.gain === 'number' && Number.isFinite(data.gain)) this.speaker(data.id).gain = Math.max(0, Math.min(2, data.gain));
        break;
      case 'remove':
        this.speakers.delete(data.id);
        break;
      case 'silent':
        this.silent = data.on === true;
        if (this.silent) for (const entry of this.speakers.values()) entry.buffer.clear();
        break;
      case 'clear':
        this.speakers.clear();
        break;
    }
  }

  /** Aufnahme: Samples des Eingangs sammeln, volle 20-ms-Blöcke abschicken. */
  record(input) {
    if (!this.capture || !input || input.length === 0) return;
    const samples = this.inResampler ? this.inResampler.process(input) : input;
    for (let i = 0; i < samples.length; i++) {
      this.block[this.fill++] = samples[i];
      if (this.fill === FRAME_SAMPLES) {
        const done = this.block;
        this.block = new Float32Array(FRAME_SAMPLES);
        this.fill = 0;
        this.post({ type: 'block', samples: done }, [done.buffer]);
      }
    }
  }

  /** Wiedergabe: alle Sprecher in `out` mischen (out wird vorher geleert), weich auf −1…1 begrenzt. */
  play(out) {
    out.fill(0);
    if (this.silent) return;
    for (const entry of this.speakers.values()) entry.buffer.mixInto(out, entry.gain);
    for (let i = 0; i < out.length; i++) {
      const x = out[i];
      if (x > 1) out[i] = 1;
      else if (x < -1) out[i] = -1;
    }
  }
}

if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
  class HeldixVoiceProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      // sampleRate ist im AudioWorkletGlobalScope die Rate des AudioContext
      this.mixer = new VoiceMixer(sampleRate, (message, transfer) => this.port.postMessage(message, transfer));
      this.port.onmessage = (event) => this.mixer.message(event.data);
    }

    process(inputs, outputs) {
      this.mixer.record(inputs[0]?.[0]);
      const output = outputs[0];
      if (output && output.length) {
        this.mixer.play(output[0]);
        for (let channel = 1; channel < output.length; channel++) output[channel].set(output[0]);
      }
      return true;
    }
  }
  registerProcessor('heldix-voice', HeldixVoiceProcessor);
}
