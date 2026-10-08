// Aggiornamenti automatici (EAS Update), pubblicati da GitHub Actions a ogni modifica JS.
// Regola: MAI riavviare l'app durante un test attivo.
import * as Updates from 'expo-updates';

export type UpdateStatus = 'disabled' | 'checking' | 'none' | 'downloaded' | 'error';

let pending = false;

export function updatePending(): boolean {
  return pending;
}

/**
 * Controlla, scarica e — se nessun test è attivo — applica subito.
 * Con il runtime "fingerprint" un aggiornamento che richiede codice nativo
 * diverso non viene mai proposto a questa installazione.
 */
export async function checkForUpdates(testActive: () => boolean): Promise<UpdateStatus> {
  if (__DEV__ || !Updates.isEnabled) return 'disabled';
  try {
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return 'none';
    const f = await Updates.fetchUpdateAsync();
    if (!f.isNew) return 'none';
    pending = true;
    if (!testActive()) await Updates.reloadAsync();
    return 'downloaded';
  } catch {
    return 'error';
  }
}

/** Da chiamare quando un test termina. */
export async function applyPendingUpdate(): Promise<void> {
  if (!pending) return;
  try {
    await Updates.reloadAsync();
  } catch {
    // riprova al prossimo avvio
  }
}

export function currentUpdateLabel(): string {
  if (!Updates.isEnabled) return 'aggiornamenti disattivati (build di sviluppo)';
  const id = Updates.updateId ? Updates.updateId.slice(0, 8) : 'build originale';
  const d = Updates.createdAt ? ` · ${Updates.createdAt.toLocaleString('it-IT')}` : '';
  return `${id}${d}`;
}

/** Pulsante "Aggiorna ora": cerca, scarica e riavvia subito (solo senza test attivo). */
export async function updateNow(): Promise<'reloading' | 'none' | 'error' | 'disabled'> {
  if (__DEV__ || !Updates.isEnabled) return 'disabled';
  try {
    if (!pending) {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) return 'none';
      const f = await Updates.fetchUpdateAsync();
      if (!f.isNew) return 'none';
      pending = true;
    }
    await Updates.reloadAsync();
    return 'reloading';
  } catch {
    return 'error';
  }
}
