import React, { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { host } from './src/host/EngineHost.ts';
import { updateAvailable } from './src/services/updates.ts';
import { usePalette } from './src/ui/theme.ts';
import type { Nav, Route, TabName } from './src/ui/nav.ts';
import { TestScreen } from './src/ui/screens/TestScreen.tsx';
import { ParkingDetailScreen, ParkingsScreen } from './src/ui/screens/ParkingsScreen.tsx';
import { ResultsScreen } from './src/ui/screens/ResultsScreen.tsx';
import { DebugScreen } from './src/ui/screens/DebugScreen.tsx';
import { SummaryScreen } from './src/ui/screens/SummaryScreen.tsx';
import { EventDetailScreen, ReviewScreen } from './src/ui/screens/ReviewScreens.tsx';

const TABS: { name: TabName; label: string; icon: string }[] = [
  { name: 'test', label: 'Test', icon: '●' },
  { name: 'parkings', label: 'Parcheggi', icon: '🅿︎' },
  { name: 'results', label: 'Risultati', icon: '%' },
  { name: 'debug', label: 'Debug', icon: '⌁' },
];

function Root() {
  const c = usePalette();
  const [tab, setTab] = useState<TabName>('test');
  const [stack, setStack] = useState<Route[]>([]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const nav: Nav = {
    tab: (t) => {
      setStack([]);
      setTab(t);
    },
    push: (r) => setStack((s) => [...s, r]),
    back: () => setStack((s) => s.slice(0, -1)),
  };

  useEffect(() => {
    void host.ensureInit().then(() => {
      void host.retryGeocoding();
      void updateAvailable();
    });
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        void host.onForeground();
        void updateAvailable();
      } else if (st === 'background') {
        void host.onBackground();
      }
    });
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stackRef.current.length > 0) {
        setStack((s) => s.slice(0, -1));
        return true;
      }
      return false;
    });
    return () => {
      sub.remove();
      back.remove();
    };
  }, []);

  const top = stack[stack.length - 1];
  let screen: React.ReactNode;
  if (top) {
    switch (top.name) {
      case 'summary':
        screen = <SummaryScreen testId={top.testId} nav={nav} />;
        break;
      case 'review':
        screen = <ReviewScreen testId={top.testId} nav={nav} />;
        break;
      case 'parking':
        screen = <ParkingDetailScreen parkingId={top.parkingId} nav={nav} />;
        break;
      case 'event':
        screen = <EventDetailScreen eventId={top.eventId} testId={top.testId} nav={nav} />;
        break;
      default:
        screen = null;
    }
  } else if (tab === 'test') screen = <TestScreen nav={nav} />;
  else if (tab === 'parkings') screen = <ParkingsScreen nav={nav} />;
  else if (tab === 'results') screen = <ResultsScreen nav={nav} />;
  else screen = <DebugScreen nav={nav} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={c.isDark ? 'light' : 'dark'} />
      <View style={{ flex: 1 }}>{screen}</View>
      {!top ? (
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card }}>
          {TABS.map((t) => {
            const on = t.name === tab;
            return (
              <Pressable key={t.name} onPress={() => setTab(t.name)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, minHeight: 56 }}>
                <Text style={{ color: on ? c.accent : c.textDim, fontSize: 18 }}>{t.icon}</Text>
                <Text style={{ color: on ? c.accent : c.textDim, fontSize: 12, fontWeight: on ? '700' : '500' }}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}
