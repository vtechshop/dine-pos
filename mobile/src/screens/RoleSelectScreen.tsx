import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, StatusBar,
  Animated, Easing, Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../types';
import { useSettings } from '../context/SettingsContext';
import { useCart } from '../context/CartContext';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

export const ROLE_IMG_KEYS = {
  customer: '@role_img_customer',
  admin:    '@role_img_admin',
  staff:    '@role_img_staff',
};

type Props = NativeStackScreenProps<RootStackParamList, 'RoleSelect'>;

const DARK_BG = '#160A02';

const ROLES = [
  {
    key:     'customer',
    icon:    'restaurant'     as keyof typeof MaterialIcons.glyphMap,
    label:   'Customer',
    desc:    'Browse menu & place order from your table',
    accent:  Colors.primary,
    accentBg: Colors.primaryBg,
  },
  {
    key:     'admin',
    icon:    'business'       as keyof typeof MaterialIcons.glyphMap,
    label:   'Business Admin',
    desc:    'POS billing, manage orders & reports',
    accent:  Colors.info,
    accentBg: Colors.infoBg,
  },
  {
    key:     'staff',
    icon:    'people'         as keyof typeof MaterialIcons.glyphMap,
    label:   'Staff',
    desc:    'Cashier · Kitchen · Waiter',
    accent:  Colors.success,
    accentBg: Colors.successBg,
  },
] as const;

const RoleSelectScreen: React.FC<Props> = ({ navigation }) => {
  const { settings } = useSettings();
  const { clearCart } = useCart();
  const { top, bottom } = useSafeAreaInsets();

  const headerAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim  = useRef(new Animated.Value(56)).current;
  const rowAnims   = useRef(ROLES.map(() => new Animated.Value(0))).current;

  const [roleImgs, setRoleImgs] = useState({ customer: '', admin: '', staff: '' });

  useEffect(() => {
    AsyncStorage.multiGet([ROLE_IMG_KEYS.customer, ROLE_IMG_KEYS.admin, ROLE_IMG_KEYS.staff])
      .then(([[, c], [, a], [, s]]) => {
        const merged = {
          customer: c || settings.roleImageCustomer || '',
          admin:    a || settings.roleImageAdmin    || '',
          staff:    s || settings.roleImageStaff    || '',
        };
        setRoleImgs(merged);
        if (!c && merged.customer) AsyncStorage.setItem(ROLE_IMG_KEYS.customer, merged.customer).catch(() => {});
        if (!a && merged.admin)    AsyncStorage.setItem(ROLE_IMG_KEYS.admin,    merged.admin).catch(() => {});
        if (!s && merged.staff)    AsyncStorage.setItem(ROLE_IMG_KEYS.staff,    merged.staff).catch(() => {});
      })
      .catch(() => {});
  }, [settings.roleImageAdmin, settings.roleImageCustomer, settings.roleImageStaff]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerAnim, {
        toValue: 1, duration: 480, useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.timing(sheetAnim, {
        toValue: 0, duration: 480, delay: 120, useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      ...rowAnims.map((anim, i) =>
        Animated.timing(anim, {
          toValue: 1, duration: 360, delay: 280 + i * 90, useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        })
      ),
    ]).start();
  }, []);

  const handlePress = (key: string) => {
    if (key === 'customer') { clearCart(); navigation.replace('CustomerTabs'); }
    else if (key === 'admin') navigation.replace('AdminLogin');
    else navigation.navigate('StaffRole');
  };

  const headerTranslateY = headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] });

  return (
    <View style={[styles.root, { backgroundColor: DARK_BG }]}>
      <StatusBar barStyle="light-content" backgroundColor={DARK_BG} translucent={false} />

      {/* ── Dark branded header ─────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: top + Spacing.xxl }]}>
        <View style={styles.orb1} />
        <View style={styles.orb2} />
        <View style={styles.orb3} />

        <Animated.View style={[styles.headerContent, { opacity: headerAnim, transform: [{ translateY: headerTranslateY }] }]}>
          <View style={styles.brandRing}>
            <Text style={styles.brandEmoji}>🏨</Text>
          </View>
          <Text style={styles.brandName} numberOfLines={1}>
            {settings.hotelName || 'Dine POS'}
          </Text>
          <Text style={styles.brandTagline}>Hospitality Management System</Text>
        </Animated.View>
      </View>

      {/* ── White sheet ─────────────────────────────────────────────────── */}
      <Animated.View style={[styles.sheet, { paddingBottom: bottom + Spacing.md, transform: [{ translateY: sheetAnim }] }]}>
        <View style={styles.sheetHandle} />

        <Text style={styles.sheetLabel}>SELECT YOUR ROLE</Text>

        <View style={styles.roleList}>
          {ROLES.map(({ key, icon, label, desc, accent, accentBg }, i) => {
            const imgUri = roleImgs[key as keyof typeof roleImgs];
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
                  imageUri={imgUri}
                  isLast={i === ROLES.length - 1}
                  onPress={() => handlePress(key)}
                />
              </Animated.View>
            );
          })}
        </View>

        <Pressable
          style={styles.saLink}
          onPress={() => navigation.navigate('SuperAdminLogin')}
          accessibilityRole="link"
          accessibilityLabel="Platform Admin login"
        >
          <MaterialIcons name="shield" size={13} color={Colors.textMuted} />
          <Text style={styles.saLinkText}>Platform Admin</Text>
          <MaterialIcons name="chevron-right" size={13} color={Colors.textMuted} />
        </Pressable>
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
  imageUri?: string;
  isLast:   boolean;
  onPress:  () => void;
}

const RoleRow: React.FC<RoleRowProps> = ({ icon, label, desc, accent, accentBg, imageUri, isLast, onPress }) => {
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
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.roleImage} resizeMode="cover" />
            ) : (
              <MaterialIcons name={icon} size={26} color={accent} />
            )}
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

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: Spacing.xxxl,
    overflow: 'hidden',
  },

  // Decorative orbs — subtle depth
  orb1: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: Colors.primary + '18',
    top: -80,
    right: -80,
  },
  orb2: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: Colors.accent + '0E',
    bottom: 30,
    left: -60,
  },
  orb3: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.primary + '0A',
    top: 40,
    left: 20,
  },

  headerContent: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  brandRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: Colors.primary + '20',
    borderWidth: 1.5,
    borderColor: Colors.primary + '55',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  brandEmoji: { fontSize: 38 },
  brandName: {
    fontSize: FontSize.xxxl,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  brandTagline: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1.0,
    textAlign: 'center',
    textTransform: 'uppercase',
  },

  // ── Sheet ──────────────────────────────────────────────────────────────────
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

  // ── Role rows ──────────────────────────────────────────────────────────────
  roleList: { gap: 0 },

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
    overflow: 'hidden',
  },
  roleImage: { width: 54, height: 54 },
  roleText: { flex: 1 },
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

  // ── Platform Admin ─────────────────────────────────────────────────────────
  saLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.lg,
    marginTop: Spacing.xs,
  },
  saLinkText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});

export default RoleSelectScreen;
