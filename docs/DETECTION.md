# Algoritmo di rilevamento

Parametri: `engine/config.ts`. Codice: `engine/engine.ts`.

## Segnali
- **Posizione**: fix con precisione ≤ `GPS_ACCURACY_LIMIT` (30 m). Gli altri sono registrati ma ignorati.
  Velocità: quella del sistema; se manca, derivata dai fix **togliendo l'incertezza** dei due punti
  (uno spostamento entro l'errore GPS non conta come movimento).
- **Activity recognition**: conta se confidence ≥ 50 e diversa da `UNKNOWN`; resta valida per
  `ACTIVITY_HOLD_S` (30 s). `UNKNOWN` non cancella l'ultima activity valida.
- **Accelerometro**: passi negli ultimi 15 s (feature ogni 2 s).

## Score (0–100, euristici, non probabilità)
- **vehicle** = 50% quota di velocità ≥ 15 km/h negli ultimi 10 s + 35% activity IN_VEHICLE + 15% assenza di passi.
  ×0,6 se l'activity dice WALKING/RUNNING/ON_BICYCLE. Senza velocità GPS: massimo 60 (mai conferma da sola activity).
- **walking** = media pesata delle componenti disponibili: velocità 1,5–7 km/h (30%), activity WALKING (45%), passi (25%).
- **release** (parcheggio osservato): sosta ≥ 2 min (15) + partenza entro 40 m dal punto (20) + vehicle (30)
  + distanza ≥ 60 m con movimento continuo (15) + velocità ≥ 20 km/h (10) + qualità del punto (10). Soglia 85.
- **release dedotto** (flusso E): camminata prima (20) + fermo ≥ 45 s (20) + activity IN_VEHICLE (15)
  + vehicle (25) + partenza dal punto (10) + distanza (10). Soglia 75.
- **return**: avvicinamento ≥ 30 m in 60 s (60) + monotonia (20) + direzione verso l'auto (20). Soglia 70.

## Conferme
- Veicolo: vehicle ≥ 70 per 10 s, **oppure** conferma rapida: activity IN_VEHICLE ≥ 85 + velocità ≥ 15 km/h per 5 s.
- Camminata: walking ≥ 70 per 8 s.
- Sosta: velocità ≤ 2 km/h per 5 s.

## Transizioni principali
| Da | Condizione | A |
|---|---|---|
| UNKNOWN / WALKING | veicolo confermato | IN_VEHICLE → VEHICLE_MOVING |
| UNKNOWN / WALKING | veicolo confermato dopo *camminata → fermo ≥ 15 s* nello stesso punto | IN_VEHICLE → VEHICLE_DEPARTED (flusso E) |
| WALKING | fermo 45 s | UNKNOWN |
| VEHICLE_MOVING | sosta | VEHICLE_STOPPED |
| VEHICLE_STOPPED | ferma 45 s | POSSIBLE_PARKING |
| POSSIBLE_PARKING | ferma 120 s | PARKED |
| VEHICLE_STOPPED / POSSIBLE_PARKING | camminata e > 15 m dal punto | PARKED |
| VEHICLE_STOPPED / POSSIBLE_PARKING | ≥ 10 km/h per 3 s o > 25 m | VEHICLE_MOVING (semaforo/coda) |
| PARKED | camminata e > 30 m | PARKED_USER_AWAY |
| PARKED_USER_AWAY | return ≥ 70 | RETURN_PREDICTED |
| PARKED_USER_AWAY / RETURN_PREDICTED | ≤ 30 m dall'auto | USER_RETURNING |
| PARKED_USER_AWAY | veicolo confermato partito > 40 m dall'auto | evento LOW_CONFIDENCE (altro mezzo), parcheggio aperto |
| PARKED / USER_RETURNING | movimento non a piedi | DEPARTURE_CANDIDATE |
| DEPARTURE_CANDIDATE | veicolo confermato | VEHICLE_DEPARTED |
| DEPARTURE_CANDIDATE | camminata / 120 s senza conferma | PARKED o PARKED_USER_AWAY |
| VEHICLE_DEPARTED | ≥ 60 m e release ≥ soglia | PARKING_RELEASED → VEHICLE_MOVING |
| VEHICLE_DEPARTED | ≥ 300 m e release sotto soglia | LOW_CONFIDENCE → VEHICLE_MOVING |

## Punto del parcheggio
- `pointAtPark`: fix della fase di sosta, mediana + media pesata 1/accuracy², scarto dei fix lontani.
- `pointAtDeparture`: fix della fase ferma prima della partenza.
- `pointFinal`: fusione pesata se distano ≤ 30 m, altrimenti il più preciso (con `pointsDisagreeM`).
- Precisione stimata: mediana delle accuracy / √min(n,4) (i fix GPS sono correlati), minimo 2 m.
- Qualità: A ≤ 10 m, B ≤ 25 m, C oltre.
- Direzione di arrivo: media circolare degli heading negli ultimi 15 s di marcia.

## GPS perso durante la partenza
Comportamento definito: se il GPS manca > 20 s durante la partenza, la componente "movimento continuo"
vale la metà e la motivazione lo dice ("con interruzioni/GPS perso"). Il rilascio avviene solo se lo score
resta sopra soglia; altrimenti a 300 m si chiude come LOW_CONFIDENCE.

## Limite noto: passeggero
Se l'utente scende da un'auto non sua, il motore vede un parcheggio. Non è distinguibile con i soli
sensori: va misurato nei test (scenario "Passeggero").
