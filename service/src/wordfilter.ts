// Einfacher Wortfilter (ab 1.13.0) für Name und Beschreibung im öffentlichen Weltenverzeichnis (Entdecken): grobe
// Beleidigungen, Hetze, Jugendgefährdendes und Links (keine Werbung für fremde Dienste). Bewusst einfach und streng bei
// wenigen Wörtern; was durchrutscht, melden Spieler und das Team blendet es aus. Die Liste steht nur hier im Dienst.

/** Wörter, die am Anfang eines Wortes nicht vorkommen dürfen (auch mit Endungen: „wichser“, „wichsers“). */
const PREFIX_WORDS = [
  // Deutsch
  'arschloch',
  'arschgeburt',
  'fotze',
  'hurensohn',
  'missgeburt',
  'schwuchtel',
  'wichser',
  'kanake',
  'kinderporno',
  'vergewaltig',
  'heil hitler',
  'sieg heil',
  // Englisch
  'asshole',
  'fuck',
  'motherfucker',
  'nigger',
  'nigga',
  'porn',
  'retard',
  'whore',
  'kill yourself',
];

/** Kurze Wörter nur als ganzes Wort (sonst träfen sie harmlose wie „Fagott“ oder „Mongolei“). */
const WHOLE_WORDS = ['bastard', 'hure', 'huren', 'nutte', 'nutten', 'schlampe', 'schlampen', 'mongo', 'neger', 'spast', 'spasti', 'spastis', 'zigeuner', 'bitch', 'cunt', 'fag', 'kys', 'rape', 'slut'];

/** Stark genug, um auch mit Leerzeichen oder Zeichen dazwischen zu greifen („h u r e n s o h n“). */
const COMPACT = ['hurensohn', 'missgeburt', 'wichser', 'schwuchtel', 'kinderporno', 'heilhitler', 'siegheil', 'motherfucker', 'nigger'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '€': 'e' };

/**
 * Klein, Umlaute vereinfacht, Ziffern als Buchstaben, Wiederholungen gekürzt (fiiiick → fick). Gilt für Text und Liste
 * gleich, damit auch Wörter mit doppelten Buchstaben passen.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[013457@$!€]/g, (c) => LEET[c] ?? c)
    .replace(/(.)\1+/gu, '$1');
}

const pattern = (word: string) => normalize(word).replace(/ /g, '[^\\p{L}]*');
const WORD_RES = [
  ...PREFIX_WORDS.map((word) => new RegExp(`(?:^|[^\\p{L}])${pattern(word)}`, 'u')),
  ...WHOLE_WORDS.map((word) => new RegExp(`(?:^|[^\\p{L}])${pattern(word)}(?:$|[^\\p{L}])`, 'u')),
];
const COMPACT_NORMAL = COMPACT.map(normalize);
/** Links und Einladungen: Adressen mit Schema, www., bekannte Endungen und Discord-Einladungen. */
const LINK_RE = /(?:https?:\/\/|www\.|discord\.(?:gg|com\/invite)|\b[a-z0-9-]{2,}\.(?:com|net|org|de|gg|io|me|tv|xyz|eu|at|ch|ru|info|shop|store|link)\b)/i;

export type WordProblem = 'word' | 'link';

/** null, wenn der Text in Ordnung ist; sonst warum nicht. */
export function checkWords(text: string): WordProblem | null {
  if (LINK_RE.test(text)) return 'link';
  const normal = normalize(text);
  if (WORD_RES.some((re) => re.test(normal))) return 'word';
  const compact = normal.replace(/[^\p{L}]/gu, '');
  if (COMPACT_NORMAL.some((word) => compact.includes(word))) return 'word';
  return null;
}

export const WORD_PROBLEM_TEXT: Record<WordProblem, string> = {
  word: 'Name oder Beschreibung enthalten Wörter, die im Verzeichnis nicht erlaubt sind.',
  link: 'Links und Werbung für andere Dienste sind im Verzeichnis nicht erlaubt.',
};
