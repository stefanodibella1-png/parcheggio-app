// Data e ora dell'ultimo aggiornamento installato e breve nota delle modifiche.
import React from 'react';
import { Text, View } from 'react-native';
import { releaseInfo } from '../../services/updates.ts';
import { usePalette } from '../theme.ts';

export function VersionNote({ pending = false, style }: { pending?: boolean; style?: object }) {
  const c = usePalette();
  const r = releaseInfo();
  return (
    <View style={style}>
      <Text style={{ color: c.textDim, fontSize: 12 }}>
        {pending ? '⬇️ Aggiornamento disponibile · ' : '✓ '}Aggiornata il {r.when} · build {r.build}
      </Text>
      {r.note ? <Text style={{ color: c.textDim, fontSize: 12, marginTop: 2 }}>Novità: {r.note}</Text> : null}
    </View>
  );
}
