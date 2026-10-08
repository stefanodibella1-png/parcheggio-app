// Configurazione Firebase del progetto PARCHEGGIO (Firestore).
// Questi valori non sono segreti: identificano il progetto. La protezione
// dei dati è affidata alle regole in firestore.rules.
// Finché è null, la community resta disattivata e l'app funziona da sola.
export const FIREBASE_CONFIG: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
} | null = null;
