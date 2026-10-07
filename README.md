# PARCHEGGIO — proof of concept

App mobile (Android + iOS) che verifica se i sensori dello smartphone capiscono
**da soli** quando un parcheggio viene liberato. Nessuna segnalazione manuale:
premi **AVVIA TEST** e guidi.

> Domanda del prototipo: *su N parcheggi liberati davvero, quanti ne rileva e
> quanti falsi positivi genera?*

## Cosa fa
- Riconosce auto, sosta, parcheggio, camminata, ritorno all'auto, ripartenza.
- **Posto probabilmente liberato** quando riparti in auto dal punto di parcheggio
  (anche se l'auto era già parcheggiata all'avvio del test: "dedotto").
- Salva **punto esatto e indirizzo** del parcheggio (qualità A/B/C, direzione di arrivo).
- Previsione sperimentale "stai tornando all'auto".
- Mappa, log con motivazioni, revisione a posteriori, metriche, export JSON/CSV.
- **Aggiornamenti automatici** (EAS Update): installi una volta, le modifiche arrivano da sole.

## Installazione
Le istruzioni passo-passo per Claude Code sono in [`docs/SETUP.md`](docs/SETUP.md).
In breve: `npm install` → `npm run test:engine` → token Expo → `eas init` →
`eas build --platform android --profile preview` → link di installazione.

Per il test si usa la build **preview** (app autonoma): la build di sviluppo
avrebbe bisogno del PC acceso e sulla stessa rete, quindi non va bene in auto.

## Primo test reale
1. Nella scheda **Test** controlla che la checklist sia verde.
2. **AVVIA TEST**, blocca il telefono, guida almeno 5 minuti.
3. Parcheggia e resta fermo **almeno 3 minuti**.
4. Riparti, guida almeno 500 m, fermati, attendi 3 minuti, **FERMA TEST**.
5. Nel riepilogo controlla l'indirizzo, poi **Rivedi ora** ed **Esporta**.

Variante a piedi: dopo il parcheggio scendi, allontanati 10–20 minuti, torna e riparti.
Variante auto già parcheggiata: avvia il test lontano dall'auto, raggiungila a piedi e parti.

## Struttura
```
engine/            motore di rilevamento (TypeScript puro, estraibile)
  __tests__/       scenari automatici + export reali come regressione
modules/activity-recognition/   modulo nativo (Core Motion / Play Services)
src/host/          collega sensori → motore → archivio, task in background
src/sensors/       posizione, geofence, activity, accelerometro
src/services/      permessi, notifiche, indirizzo, export, aggiornamenti
src/storage/       SQLite
src/ui/            interfaccia (4 schede, riepilogo, revisione)
tools/             replay e sweep dei test esportati
docs/              SETUP, ARCHITECTURE, DETECTION, TESTING, LIMITATIONS, DECISIONS
```

## Comandi
| Comando | Cosa fa |
|---|---|
| `npm run test:engine` | test del motore (nessun telefono richiesto) |
| `npm run replay -- test.json` | rigioca un export |
| `npm run sweep` | confronta soglie diverse sui test reali |
| `npm run update -- "msg"` | invia un aggiornamento ai telefoni |
| `npm run build:android` | nuova installazione Android |
