// ParkingCT — filtro automatico dei nomi per il muro dei fondatori.
// 'blocked' = non si può salvare; 'review' = si salva ma non compare finché non lo approvi
// dal control center; 'ok' = compare subito (resta comunque moderabile).

export type NameCheck = 'ok' | 'review' | 'blocked';

// parole chiaramente offensive (anche dentro altre parole o con lettere camuffate)
const BLOCK = [
  'cazz', 'minchi', 'minkia', 'stronz', 'vaffancul', 'fancul', 'puttan', 'buttan', 'troia', 'zoccol', 'coglion',
  'merda', 'bastard', 'froci', 'ricchion', 'mongolo', 'porcodio', 'porcamadonna', 'diocane', 'diomaiale',
  'madonnaputtana', 'pompin', 'bocchin', 'sucami', 'succhia', 'sticchi', 'cacat', 'figlioditroia', 'hitler', 'nazist',
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'porn', 'sesso', 'sex',
];
// parole corte o ambigue (possono stare in cognomi veri): servono la tua approvazione
const REVIEW = ['negro', 'negra', 'culo', 'figa', 'fica', 'pene', 'mafia', 'mafios', 'duce', 'cornut', 'idiot', 'scem', 'deficient', 'cretin', 'ass'];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0@4]/g, (c) => (c === '0' ? 'o' : 'a'))
    .replace(/1|!|\|/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/k/g, 'c')
    .replace(/[^a-z]/g, '');
}

export function checkName(raw: string): NameCheck {
  const name = raw.trim();
  if (!name) return 'ok';
  // link, email, numeri di telefono, pubblicità
  if (/https?:|www\.|\.(it|com|net|org)\b|@/i.test(name)) return 'blocked';
  if ((name.match(/\d/g) ?? []).length >= 5) return 'blocked';
  const n = normalize(name);
  if (BLOCK.some((w) => n.includes(normalize(w)))) return 'blocked';
  const words = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(normalize);
  if (REVIEW.some((w) => words.some((x) => x === w || (w.length >= 5 && x.startsWith(w))))) return 'review';
  // tutto maiuscolo e lungo, o caratteri ripetuti: meglio dare un'occhiata
  if (/(.)\1{3,}/.test(name)) return 'review';
  return 'ok';
}
