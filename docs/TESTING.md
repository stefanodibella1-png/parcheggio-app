# Test

## Automatici (sul PC, senza telefono)
```
npm run test:engine
```
- `engine/__tests__/scenarios.test.ts`: i 16 scenari della specifica + serializzazione + indirizzo.
- `engine/__tests__/fixtures.test.ts`: ogni export reale in `fixtures/real/` con il suo `.expected.json`.

Primo fixture: `2026-10-07_android_walk-drive.json` (test del 07/10). Atteso e verificato:
WALKING a ~101 s; nessun veicolo dai fix rumorosi 125–160 s; IN_VEHICLE a 303,7 s (8 s dopo l'inizio
reale del movimento, prima erano 20 s); **PARKING_RELEASED_INFERRED** sul punto 37,72403 / 15,18370
(±2 m, qualità A); VEHICLE_STOPPED finale, nessun PARKED.

## Replay e taratura
```
npm run replay -- percorso/test.json
npm run replay -- percorso/test.json --config prova.json
npm run sweep
```
`sweep` prova una griglia di soglie su tutti i test reali e ordina per falsi positivi, poi rilevamento.
Con pochi test i numeri non sono significativi: servono almeno 20 partenze reali.

## Test reali
Vedi la sezione 19 della specifica e il README. Regola d'oro: **almeno 3 minuti di sosta** prima di
fermare il test. Dopo ogni test: **Rivedi** (corretto / falso positivo, aggiungi le partenze mancate)
ed **Esporta**. Gli export vanno copiati in `engine/__tests__/fixtures/real/` con un `.expected.json`.

## Da verificare sul telefono (checkpoint)
1. L'app si installa e si apre; la checklist si colora correttamente.
2. A piedi: traccia visibile, stato "A piedi".
3. In auto: "In auto" entro ~10 s dalla partenza.
4. Parcheggio di 3 minuti: notifica "Parcheggio confermato" **con indirizzo giusto**.
5. Ripartenza: "Posto probabilmente liberato".
6. Gli stessi punti con telefono bloccato in tasca.
7. Uscita a piedi lunga: nessun rilascio mentre cammini; previsione di ritorno nel log; rilascio alla ripartenza.
