// HeldixClient – Webseite: Welches System hat der Besucher? (für Download-Knöpfe und /download)
// Zuerst die Client Hints (navigator.userAgentData, mit Prozessor-Architektur), sonst der User-Agent.
// Safari verrät nicht, ob ein Mac Apple Silicon oder Intel hat – dann gilt „unsicher“ und die Seite zeigt beide.

export const SYSTEME = {
  windows: { name: 'Windows', voll: 'Windows 10 und 11 (64 Bit)', knopf: 'Für Windows herunterladen' },
  'mac-arm64': { name: 'Mac mit Apple Silicon', voll: 'macOS 11 oder neuer · M1 und neuer', knopf: 'Für Mac herunterladen' },
  'mac-x64': { name: 'Mac mit Intel', voll: 'macOS 11 oder neuer · Intel-Prozessor', knopf: 'Für Mac (Intel) herunterladen' },
};

/** { os: 'windows' | 'mac' | 'andere', ziel: 'windows' | 'mac-arm64' | 'mac-x64' | null, sicher, quelle } */
export async function detectSystem() {
  const ua = navigator.userAgent || '';
  let platform = '';
  let arch = '';
  let quelle = 'user-agent';
  const hints = navigator.userAgentData;
  if (hints && typeof hints.getHighEntropyValues === 'function') {
    try {
      const values = await hints.getHighEntropyValues(['architecture', 'platform']);
      platform = values.platform || hints.platform || '';
      arch = values.architecture || '';
      quelle = 'client-hints';
    } catch {
      platform = hints.platform || '';
    }
  }
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPad gibt sich als Mac aus
  if (!platform) {
    if (/Windows/i.test(ua)) platform = 'Windows';
    else if (/iPhone|iPad|iPod/.test(ua) || touchMac) platform = 'iOS';
    else if (/Macintosh|Mac OS X/.test(ua)) platform = 'macOS';
    else if (/Android/.test(ua)) platform = 'Android';
    else if (/CrOS/.test(ua)) platform = 'Chrome OS';
    else if (/Linux/.test(ua)) platform = 'Linux';
  }
  if (/^windows$/i.test(platform)) return { os: 'windows', ziel: 'windows', sicher: true, quelle };
  if (/^mac/i.test(platform) && !touchMac) {
    if (arch === 'arm') return { os: 'mac', ziel: 'mac-arm64', sicher: true, quelle };
    if (arch === 'x86') return { os: 'mac', ziel: 'mac-x64', sicher: true, quelle };
    return { os: 'mac', ziel: 'mac-arm64', sicher: false, quelle };
  }
  return { os: 'andere', ziel: null, sicher: false, quelle, plattform: platform };
}
