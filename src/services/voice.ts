// Avvisi vocali per chi guida: niente da leggere sullo schermo.
import * as Speech from 'expo-speech';

export function speak(text: string): void {
  try {
    Speech.stop();
    Speech.speak(text, { language: 'it-IT', rate: 1.0 });
  } catch {
    // voce non disponibile: resta la notifica
  }
}
