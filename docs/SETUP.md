# SETUP — istruzioni per Claude Code (da eseguire sul PC Windows)

Obiettivo: installare le dipendenze, verificare, creare il progetto su Expo e
avviare la build Android. Alla fine consegnare a Stefano **il link per installare l'app**.
Stefano usa Claude Code da telefono (Remote Control): non può digitare nei prompt
interattivi, quindi usare sempre i comandi `--non-interactive`.

## 1. Prerequisiti
- `node -v` deve essere **≥ 22.6** (serve per `node --test` sui file `.ts`). Se è più vecchio, installa Node 22 LTS (`winget install OpenJS.NodeJS.LTS`).
- Git presente (`git --version`).

## 2. Dipendenze e verifiche
```
npm install
npx expo install --fix
npx expo install --check
npm run test:engine
npm run typecheck
```
- `expo install --fix` allinea le versioni alla SDK di Expo installata.
- `test:engine` deve dare **tutti i test verdi** (19 al momento della consegna).
- Se `typecheck` segnala errori dovuti a differenze nei tipi delle librerie, correggili **senza cambiare il comportamento** e senza toccare `engine/` se non serve. Riesegui `test:engine` dopo ogni modifica.

## 3. Account Expo (token)
Stefano ti fornisce un **token di accesso Expo** (creato da expo.dev › Account settings › Access tokens).
In PowerShell, per la sessione corrente e in modo permanente:
```
$env:EXPO_TOKEN = "<TOKEN>"
setx EXPO_TOKEN "<TOKEN>"
npx eas-cli@latest whoami
```
Non scrivere mai il token in file del progetto.

## 4. Progetto EAS e aggiornamenti automatici
```
npx eas-cli@latest init --non-interactive --force
npx eas-cli@latest update:configure --platform all --non-interactive
```
Verifica che `app.json` ora contenga `extra.eas.projectId` e `updates.url`
(`https://u.expo.dev/<projectId>`). Se `update:configure` non scrive `updates.url`, aggiungilo a mano
lasciando `checkAutomatically: "NEVER"` (l'app controlla gli aggiornamenti da sola e non si riavvia mai durante un test).

## 5. Build Android (link di installazione)
```
npx eas-cli@latest build --platform android --profile preview --non-interactive --no-wait
```
- In modalità non interattiva EAS genera da solo il keystore Android.
- Poi controlla lo stato ogni paio di minuti:
  `npx eas-cli@latest build:list --platform android --limit 1 --json --non-interactive`
- Quando lo stato è `FINISHED`, dai a Stefano **il link della pagina della build** (`https://expo.dev/accounts/<account>/projects/parcheggio/builds/<id>`): aprendolo dal telefono Android c'è il pulsante **Install**.
- Ricorda a Stefano: al primo avvio Android chiede di consentire l'installazione da browser.

## 6. iPhone (quando Stefano è al PC)
La build iOS richiede **Apple Developer Program** e un login Apple con codice 2FA: non si può fare in modalità non interattiva.
Da fare una volta, seduti al PC:
```
npx eas-cli@latest device:create      # dà un link da aprire sull'iPhone per registrarlo
npx eas-cli@latest build --platform ios --profile preview
```
Poi il link della build si apre dall'iPhone e si installa. (Impostazioni › Generali › VPN e gestione dispositivo, se richiesto; su iOS 16+ attivare anche la Modalità sviluppatore.)

## 7. Aggiornamenti successivi (senza reinstallare)
- Modifiche solo a codice JS/TS (`engine/`, `src/`, `App.tsx`):
  `npx eas-cli@latest update --channel preview --non-interactive --message "descrizione"`
  L'app scarica l'aggiornamento e lo applica al riavvio, **mai durante un test attivo**.
- Modifiche native (`app.json`, `modules/`, nuove librerie native, permessi): serve una nuova build (punto 5/6).

## 8. Git (consigliato)
```
git init
git add -A
git commit -m "PARCHEGGIO v0.3.0"
```
Se Stefano lo chiede, pubblica su GitHub in un repository **privato**.
