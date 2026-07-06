import React, { useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'StaffRole'>;

// ── Same dark terminal tokens as RoleSelectScreen ─────────────────────────────
const C = {
  ground:   '#130A04',
  surface:  '#1E1108',
  border:   'rgba(255,160,80,.10)',
  divider:  'rgba(255,160,80,.06)',
  text:     '#F0E8DC',
  text2:    '#A08878',
  text3:    '#5C3E30',
  blue:     '#1565C0',
  blueBg:   'rgba(21,101,192,.12)',
  green:    '#2E7D32',
  greenBg:  'rgba(46,125,50,.12)',
  amber:    '#FFA500',
  amberBg:  'rgba(255,165,0,.12)',
};

const StaffRoleScreen: React.FC<Props> = ({ navigation }) => {
  const { top, bottom } = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.ground} translucent={false} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.75}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerLabel}>STAFF LOGIN</Text>
          <Text style={styles.headerTitle}>Select Your Role</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* ── Cards ──────────────────────────────────────────────────────── */}
      <View style={[styles.cards, { paddingBottom: bottom + 20 }]}>

        <RoleCard
          accentColor={C.blue}
          iconBg={C.blueBg}
          emoji="💰"
          role="Cashier"
          desc="Billing & Payments"
          onPress={() => navigation.navigate('CashierLogin')}
        />

        <RoleCard
          accentColor={C.green}
          iconBg={C.greenBg}
          emoji="👨‍🍳"
          role="Kitchen"
          desc="Kitchen Display System"
          onPress={() => navigation.navigate('KitchenLogin')}
        />

        <RoleCard
          accentColor={C.amber}
          iconBg={C.amberBg}
          emoji="🍽️"
          role="Waiter"
          desc="Serve Orders & Table Operations"
          onPress={() => navigation.navigate('WaiterLogin')}
        />

      </View>
    </View>
  );
};

// ── Reusable role card ────────────────────────────────────────────────────────
interface RoleCardProps {
  accentColor: string;
  iconBg: string;
  emoji: string;
  role: string;
  desc: string;
  onPress: () => void;
}

const RoleCard: React.FC<RoleCardProps> = ({ accentColor, iconBg, emoji, role, desc, onPress }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const onPressIn  = () => Animated.spring(scaleAnim, { toValue: 0.975, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const onPressOut = () => Animated.spring(scaleAnim, { toValue: 1,     useNativeDriver: true, speed: 50, bounciness: 0 }).start();

  return (
    <Animated.View style={[styles.cardOuter, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        activeOpacity={1}
      >
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />
        <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
          <Text style={styles.iconEmoji}>{emoji}</Text>
        </View>
        <View style={styles.cardText}>
          <Text style={styles.cardRole}>{role}</Text>
          <Text style={styles.cardDesc}>{desc}</Text>
        </View>
        <Text style={styles.cardArrow}>›</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ground },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
    flexShrink: 0,
  },
  backArrow: { fontSize: 26, color: C.text2, lineHeight: 30, marginTop: -2 },
  headerLabel: {
    fontSize: 10, fontWeight: '700', color: C.text3,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2,
  },
  headerTitle: {
    fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.4,
  },

  divider: { height: 1, backgroundColor: C.divider },

  cards: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 10,
  },

  cardOuter: { flex: 1 },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    minHeight: 82,
  },

  accentBar: { width: 5, alignSelf: 'stretch' },

  iconWrap: {
    width: 52, height: 52, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 16, marginRight: 4, flexShrink: 0,
  },
  iconEmoji: { fontSize: 26 },

  cardText: { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  cardRole: {
    fontSize: 17, fontWeight: '800', color: C.text,
    letterSpacing: -0.3, marginBottom: 3,
  },
  cardDesc: { fontSize: 13, color: C.text2, fontWeight: '500', lineHeight: 18 },

  cardArrow: { fontSize: 26, color: C.text3, paddingRight: 16, paddingTop: 2, lineHeight: 30 },
});

export default StaffRoleScreen;
