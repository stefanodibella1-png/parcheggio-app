import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { radius, space, TOUCH, usePalette } from '../theme.ts';

export function Card({ children, style, accent }: { children: React.ReactNode; style?: ViewStyle; accent?: string }) {
  const c = usePalette();
  return (
    <View
      style={[
        { backgroundColor: c.card, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: c.border },
        accent ? { borderLeftWidth: 5, borderLeftColor: accent } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const c = usePalette();
  return <Text style={{ color: c.text, fontSize: 28, fontWeight: '800', letterSpacing: 0.5 }}>{children}</Text>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const c = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg, marginBottom: space.sm }}>
      <Text style={{ color: c.textDim, fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{children}</Text>
      {right}
    </View>
  );
}

export function Label({ children, dim, size = 15, bold, color, style }: { children: React.ReactNode; dim?: boolean; size?: number; bold?: boolean; color?: string; style?: object }) {
  const c = usePalette();
  return (
    <Text style={[{ color: color ?? (dim ? c.textDim : c.text), fontSize: size, fontWeight: bold ? '700' : '400' }, style]}>{children}</Text>
  );
}

type Variant = 'primary' | 'danger' | 'ghost' | 'ok';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  small,
  style,
}: {
  title: string;
  onPress: () => unknown;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  style?: ViewStyle;
}) {
  const c = usePalette();
  const bg = variant === 'primary' ? c.accent : variant === 'danger' ? c.danger : variant === 'ok' ? c.ok : 'transparent';
  const fg = variant === 'ghost' ? c.text : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        void onPress();
      }}
      style={({ pressed }) => [
        {
          minHeight: small ? 44 : TOUCH,
          borderRadius: radius.md,
          backgroundColor: bg,
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: c.border,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: space.lg,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: small ? 15 : 18, fontWeight: '700' }}>{title}</Text>}
    </Pressable>
  );
}

export function Pill({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ backgroundColor: color + '26', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  const c = usePalette();
  const v = Math.max(0, Math.min(100, value));
  return (
    <View style={{ marginVertical: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: c.textDim, fontSize: 13 }}>{label}</Text>
        <Text style={{ color: c.text, fontSize: 13, fontWeight: '700' }}>{Math.round(v)}</Text>
      </View>
      <View style={{ height: 8, backgroundColor: c.cardAlt, borderRadius: 4, marginTop: 3, overflow: 'hidden' }}>
        <View style={{ width: `${v}%`, height: 8, backgroundColor: color, borderRadius: 4 }} />
      </View>
    </View>
  );
}

export function Row({ k, v, vColor }: { k: string; v: React.ReactNode; vColor?: string }) {
  const c = usePalette();
  return (
    <View style={styles.row}>
      <Text style={{ color: c.textDim, fontSize: 14, flexShrink: 1 }}>{k}</Text>
      <Text style={{ color: vColor ?? c.text, fontSize: 14, fontWeight: '600', marginLeft: space.md, textAlign: 'right', flexShrink: 1 }}>{v}</Text>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  const c = usePalette();
  return <Text style={{ color: c.textDim, fontSize: 15, textAlign: 'center', paddingVertical: space.xl }}>{text}</Text>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
});
