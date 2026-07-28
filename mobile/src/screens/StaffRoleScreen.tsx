import React, { useRef, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, StatusBar,
  Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'StaffRole'>;

const DARK_BG = '#160A02';

const ROLES = [
  {
    key:      'cashier',
    icon:     'point-of-sale' as keyof typeof MaterialIcons.glyphMap,
    label:    'Cashier',
    desc:     'Billing & payment collection',
    accent:   Colors.info,
    accentBg: Colors.infoBg,
  },
  {
    key:      'kitchen',
    icon:     'restaurant' as keyof typeof MaterialIcons.glyphMap,
    label:    'Kitchen',
    desc:     'Kitchen Display System',
    accent:   Colors.success,
    accentBg: Colors.successBg,
  },
  {
    key:      'waiter',
    icon:     'room-service' as keyof typeof MaterialIcons.glyphMap,
    label:    'Waiter',
    desc:     'Serve orders & table operations',
    accent:   Colors.accent,
    accentBg: Colors.accentBg,
  },
] as const;

const StaffRoleScreen: React.FC<Props> = ({ navigation }) => {
  const { top, bottom } = useSafeAreaInsets();

  const headerAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim  = useRef(new Animated.Value(56)).current;
  const rowAnims   = useRef(ROLES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerAnim, { toValue: 1, duration: 420, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(sheetAnim,  { toValue: 0, duration: 420, delay: 100, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      ...rowAnims.map((anim, i) =>
        Animated.timing(anim, { toValue: 1, duration: 320, delay: 240 + i * 80, useNativeDriver: true, easing: Easing.out(Easing.cubic) })
      ),
    ]).start();
  }, []);

  const headerTranslateY = headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] });

  const handlePress = (key: string) => {
    if (key === 'cashier') navigation.navigate('CashierLogin');
    else if (key === 'kitchen') navigation.navigate('KitchenLogin');
    else navigation.navigate('WaiterLogin');
  };

  return (
    <View style={[styles.root, { backgroundColor: DARK_BG }]}>
      <StatusBar barStyle="light-content" backgroundColor={DARK_BG} />

      {/* ── Dark header ─────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: top + Spacing.md }]}>
        <View style={styles.orb1} />
        <View style={styles.orb2} />

        <Pressable
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialIcons name="arrow-back" size={20} color="rgba(255,255,255,0.85)" />
        </Pressable>

        <Animated.View style={[styles.headerContent, { opacity: headerAnim, transform: [{ translateY: headerTranslateY }] }]}>
          <View style={styles.brandRing}>
            <MaterialIcons name="people" size={32} color={Colors.primary} />
          </View>
          <Text style={styles.brandName}>Staff Portal</Text>
          <Text style={styles.brandTagline}>Select your station to continue</Text>
        </Animated.View>
      </View>

      {/* ── White sheet ─────────────────────────────────────────────────── */}
      <Animated.View style={[styles.sheet, { paddingBottom: bottom + Spacing.lg, transform: [{ translateY: sheetAnim }] }]}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetLabel}>CHOOSE STATION</Text>

        <View style={styles.roleList}>
          {ROLES.map(({ key, icon, label, desc, accent, accentBg }, i) => {
            const rowTranslateX = rowAnims[i].interpolate({ inputRange: [0, 1], outputRange: [24, 0] });
            return (
              <Animated.View
                key={key}
                style={{ opacity: rowAnims[i], transform: [{ translateX: rowTranslateX }] }}
              >
                <RoleRow
                  icon={icon}
                  label={label}
                  desc={desc}
                  accent={accent}
                  accentBg={accentBg}
                  isLast={i === ROLES.length - 1}
                  onPress={() => handlePress(key)}
                />
              </Animated.View>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
};

// ── Role row ──────────────────────────────────────────────────────────────────
interface RoleRowProps {
  icon:     keyof typeof MaterialIcons.glyphMap;
  label:    string;
  desc:     string;
  accent:   string;
  accentBg: string;
  isLast:   boolean;
  onPress:  () => void;
}

const RoleRow: React.FC<RoleRowProps> = ({ icon, label, desc, accent, accentBg, isLast, onPress }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pressIn  = () => Animated.spring(scaleAnim, { toValue: 0.975, useNativeDriver: true, speed: 60, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(scaleAnim, { toValue: 1,     useNativeDriver: true, speed: 60, bounciness: 0 }).start();

  return (
    <>
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Pressable
          style={styles.roleRow}
          onPress={onPress}
          onPressIn={pressIn}
          onPressOut={pressOut}
          android_ripple={{ color: accent + '18', borderless: false }}
          accessibilityRole="button"
          accessibilityLabel={`${label}. ${desc}`}
        >
          <View style={[styles.roleIconBox, { backgroundColor: accentBg }]}>
            <MaterialIcons name={icon} size={26} color={accent} />
          </View>
          <View style={styles.roleText}>
            <Text style={styles.roleLabel}>{label}</Text>
            <Text style={styles.roleDesc} numberOfLines={1}>{desc}</Text>
          </View>
          <View style={[styles.roleArrow, { backgroundColor: accentBg }]}>
            <MaterialIcons name="arrow-forward-ios" size={13} color={accent} />
          </View>
        </Pressable>
      </Animated.View>
      {!isLast && <View style={styles.divider} />}
    </>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flex: 1,
    overflow: 'hidden',
    paddingBottom: Spacing.xxxl,
  },
  orb1: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: Colors.primary + '16',
    top: -60,
    right: -50,
  },
  orb2: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: Colors.accent + '0C',
    bottom: 10,
    left: -40,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  headerContent: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  brandRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.primary + '20',
    borderWidth: 1.5,
    borderColor: Colors.primary + '55',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  brandName: {
    fontSize: FontSize.xxxl,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  brandTagline: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xxxl,
    borderTopRightRadius: BorderRadius.xxxl,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    ...Shadows.lg,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.xl,
  },
  sheetLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 1.4,
    marginBottom: Spacing.sm,
  },

  roleList:   { gap: 0 },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.lg,
  },
  roleIconBox: {
    width: 54,
    height: 54,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleText:  { flex: 1 },
  roleLabel: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.2,
  },
  roleDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  roleArrow: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginLeft: 54 + Spacing.lg,
  },
});

export default StaffRoleScreen;
