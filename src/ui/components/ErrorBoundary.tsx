// Se una schermata va in errore, invece dello schermo nero si vede cosa è successo,
// l'errore va al server e si può riprovare o ripartire con un registro nuovo.
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { report } from '../../services/crash.ts';
import * as db from '../../storage/db.ts';

type State = { error: Error | null };

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    report('render', error, String(info.componentStack ?? '').slice(0, 1500));
  }

  render(): React.ReactNode {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: '#fff' }} contentContainerStyle={{ padding: 24, paddingTop: 64 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#111' }}>Qualcosa è andato storto</Text>
        <Text style={{ fontSize: 15, color: '#444', marginTop: 8 }}>L'errore è stato inviato per la correzione. Puoi riprovare subito.</Text>
        <View style={{ marginTop: 16, padding: 12, backgroundColor: '#FEE2E2', borderRadius: 10 }}>
          <Text style={{ color: '#991B1B', fontSize: 13 }} selectable>
            {e.name}: {e.message}
          </Text>
        </View>
        <Pressable onPress={() => this.setState({ error: null })} style={{ marginTop: 20, backgroundColor: '#E53935', borderRadius: 12, padding: 14 }}>
          <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center', fontSize: 16 }}>Riprova</Text>
        </Pressable>
        <Pressable
          onPress={async () => {
            // registro attuale chiuso: si riparte da zero (i dati restano salvati ed esportabili)
            try {
              const t = await db.getActiveTest();
              if (t) await db.updateTest(t.id, { stoppedAt: Date.now() });
            } catch {
              // niente
            }
            await Updates.reloadAsync().catch(() => this.setState({ error: null }));
          }}
          style={{ marginTop: 10, borderWidth: 1, borderColor: '#ccc', borderRadius: 12, padding: 14 }}
        >
          <Text style={{ color: '#111', textAlign: 'center', fontSize: 15 }}>Riparti con un registro nuovo</Text>
        </Pressable>
      </ScrollView>
    );
  }
}
