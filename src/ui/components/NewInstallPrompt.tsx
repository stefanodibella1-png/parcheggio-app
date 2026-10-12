// Finestra "Nuova versione": compare all'apertura dell'app quando è uscita una nuova APK.
// Un tocco scarica l'APK; Android poi chiede "Installa" (fuori dal Play Store non si può evitare).
// I dati e il codice fondatore restano: è un aggiornamento sopra l'app installata.
import React, { useEffect, useState } from 'react';
import { AppState, Linking, Modal, Pressable, Text, View } from 'react-native';
import { apkUrl, newInstallAvailable } from '../../services/appInstall.ts';
import { APP_NAME } from '../../variant.ts';

export function NewInstallPrompt() {
  const [build, setBuild] = useState<number | null>(null);
  const [later, setLater] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () => {
      void newInstallAvailable().then((b) => {
        if (alive) setBuild(b);
      });
    };
    check();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') check();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  const visible = build !== null && later !== build;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setLater(build)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 22 }}>
          <Text style={{ fontSize: 34, textAlign: 'center' }}>⬆️</Text>
          <Text style={{ fontSize: 20, fontWeight: '800', color: '#111', textAlign: 'center', marginTop: 6 }}>
            Nuova versione di {APP_NAME}
          </Text>
          <Text style={{ fontSize: 15, color: '#444', textAlign: 'center', marginTop: 10, lineHeight: 21 }}>
            Tocca «Aggiorna»: si scarica da sola. Quando è pronta, aprila e tocca «Installa».{'\n'}I tuoi dati e il tuo codice restano.
          </Text>
          <Pressable
            onPress={() => {
              if (build !== null) void Linking.openURL(apkUrl(build));
              setLater(build);
            }}
            style={{ backgroundColor: '#E53935', borderRadius: 14, paddingVertical: 14, marginTop: 18 }}
          >
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' }}>Aggiorna</Text>
          </Pressable>
          <Pressable onPress={() => setLater(build)} style={{ paddingVertical: 12, marginTop: 4 }}>
            <Text style={{ color: '#666', fontSize: 15, textAlign: 'center' }}>Più tardi</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
