# PARCHEGGIO — istruzioni per Claude Code

Leggi sempre `PARCHEGGIO_SPEC.md` (specifica completa, v3) prima di modificare qualcosa.

## Regole
- Il rilevamento è **100% automatico**: nessun input manuale entra mai nel motore.
- `engine/` è TypeScript puro: **zero** import di React Native o Expo. Il tempo arriva solo dagli input (mai `Date.now()` nel motore).
- Tutte le soglie stanno in `engine/config.ts`. Nessuna soglia altrove.
- Gli import interni usano l'estensione esplicita `.ts` / `.tsx` (servono a `node --test`).
- Mock e dati sintetici solo in `engine/synthetic.ts` e nei test. L'app usa solo sensori reali.
- Non dire "funziona su iOS/Android" se non è stato provato su un telefono: distingui *compila*, *testato con replay*, *testato su dispositivo*.
- File sempre completi, mai troncati.

## Comandi
- `npm run test:engine` — test del motore (scenari + export reali in `engine/__tests__/fixtures/real`). Devono restare verdi.
- `npm run typecheck` — TypeScript su tutta l'app.
- `npm run replay -- percorso/test.json` — rigioca un test esportato.
- `npm run sweep` — prova più configurazioni sui test reali.
- `npm run update -- "messaggio"` — pubblica un aggiornamento JS (arriva da solo sui telefoni).
- `npm run build:android` / `npm run build:ios` — nuova installazione (solo se cambia codice nativo, permessi o librerie native).

## Quando serve una nuova build e quando basta un aggiornamento
- Modifiche solo a `engine/`, `src/`, `App.tsx` → `npm run update -- "..."`.
- Modifiche a `app.json`, `modules/`, dipendenze native, permessi → nuova build. Con `runtimeVersion: fingerprint` un aggiornamento incompatibile non viene mai inviato ai telefoni vecchi.

## Ogni nuovo export reale
1. Copialo in `engine/__tests__/fixtures/real/`.
2. Crea il relativo `.expected.json` (vedi quello del 07/10 come esempio).
3. `npm run test:engine`.
