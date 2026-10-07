# Architettura

```
sensori reali ──► EngineHost ──► ReorderBuffer (2 s) ──► DetectionEngine ──► eventi
 (posizione,        │                                        │
  activity,         ├─► SQLite (input, eventi, snapshot,     └─► sessioni di parcheggio
  accelerometro,    │    sessioni, stato del motore)               (punto + indirizzo)
  geofence)         ├─► notifiche locali
                    ├─► geofence 500/200/50 m attorno al parcheggio
                    └─► reverse geocoding (solo a PARKED e al rilascio)
```

## Livelli
| Livello | Cartella | Dipende da |
|---|---|---|
| Motore | `engine/` | niente (TypeScript puro) |
| Raccolta dati | `src/sensors/`, `modules/activity-recognition/` | Expo, nativo |
| Orchestrazione | `src/host/` | motore + sensori + archivio |
| Servizi | `src/services/`, `src/storage/` | Expo |
| Interfaccia | `src/ui/`, `App.tsx` | host (sola lettura) + archivio |

## Principi
- **Deterministico**: il motore riceve il tempo dagli input. Stessi input → stessi eventi.
  Questo rende possibili replay, sweep e test di regressione con i giri reali.
- **Serializzabile**: lo stato del motore viene salvato ogni 10 s e a ogni evento; se il
  sistema chiude l'app e la rilancia in background (geofence, posizione), il test riprende.
  Se lo stato salvato manca, viene ricostruito rigiocando gli input registrati.
- **Input ordinati**: i sensori possono consegnare campioni fuori ordine (test del 07/10);
  un buffer di 2 s li riordina e deduplica prima del motore.
- **Nessun input manuale**: le etichette di revisione vivono solo in `labels` e servono alle metriche.

## Task in background
Definiti in `src/host/tasks.ts`, importati per primi da `index.ts`:
- `parcheggio-location`: aggiornamenti di posizione (foreground service su Android).
- `parcheggio-geofence`: entrata/uscita dai cerchi attorno al parcheggio; risveglia l'app,
  porta la posizione ad alta frequenza e, su iOS, legge lo storico di Core Motion.

## Modalità di posizione
| Stato | Modalità | Frequenza |
|---|---|---|
| guida, partenza, sconosciuto | high | 1 Hz, massima precisione |
| PARKED, USER_RETURNING | parked | 0,5 Hz |
| PARKED_USER_AWAY | away | ogni 10 s / 15 m, geofence come rete |

Su Android il cambio di modalità avviene solo con l'app in primo piano (un foreground
service non si può riavviare dal background su Android 12+).

## Estrarre il motore
`engine/` non importa nulla dall'app: si copia in un pacchetto e si importa da `engine/index.ts`.
