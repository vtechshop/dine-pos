import React, { useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'StaffRole'>;

const StaffRoleScreen: React.FC<Props> = ({ navigation }) => {
  const { bottom } = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primary} translucent={false} />

      {/* ── Orange banner ───────────────────────────────────────────────── */}
      <View style={styles.banner}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.white} />
        </TouchableOpacity>
        <View>
          <Text style={styles.bannerSub}>Staff Login</Text>
          <Text style={styles.bannerTitle}>Select Your Role</Text>
        </View>
      </View>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <View style={[styles.body, { paddingBottom: bottom + Spacing.xl }]}>
        <Text style={styles.sectionTitle}>Choose your work role</Text>

        <View style={styles.cards}>

          <RoleCard
            accentColor={Colors.info}
            iconBg={Colors.infoBg}
            emoji="💰"
            role="Cashier"
            desc="Billing & Payments"
            onPress={() => navigation.navigate('CashierLogin')}
          />

          <RoleCard
            accentColor={Colors.success}
            iconBg={Colors.successBg}
            emoji="👨‍🍳"
            role="Kitchen"
            desc="Kitchen Display System"
            onPress={() => navigation.navigate('KitchenLogin')}
          />

          <RoleCard
            accentColor={Colors.accent}
            iconBg={Colors.accentBg}
            emoji="🍽️"
            role="Waiter"
            desc="Serve Orders & Table Operations"
            onPress={() => navigation.navigate('WaiterLogin')}
          />

        </View>
      </View>
    </View>
  );
};

// ── Role card ─────────────────────────────────────────────────────────────────
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
  const onPressIn  = () => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const onPressOut = () => Animated.spring(scaleAnim, { toValue: 1,    useNativeDriver: true, speed: 50, bounciness: 0 }).start();

  return (
    <Animated.View style={[styles.cardOuter, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        style={[styles.card, { borderTopColor: accentColor }]}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        activeOpacity={1}
      >
        <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
          <Text style={styles.iconEmoji}>{emoji}</Text>
        </View>

        <View style={styles.cardText}>
          <Text style={styles.cardRole}>{role}</Text>
          <Text style={styles.cardDesc}>{desc}</Text>
        </View>

        <MaterialIcons name="chevron-right" size={22} color={accentColor} />
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },

  // Banner
  banner: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  bannerSub: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.7)', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  bannerTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.white, letterSpacing: -0.3 },

  // Body
  body: { flex: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl },
  sectionTitle: {
    fontSize: FontSize.sm, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: Spacing.lg,
  },

  // Cards
  cards: { flex: 1, gap: Spacing.md },
  cardOuter: { flex: 1 },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderTopWidth: 3,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
    ...Shadows.sm,
  },
  iconWrap: {
    width: 56, height: 56, borderRadius: BorderRadius.md,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  iconEmoji: { fontSize: 28 },
  cardText: { flex: 1 },
  cardRole: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text, marginBottom: 3 },
  cardDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 18 },
});

export default StaffRoleScreen;
