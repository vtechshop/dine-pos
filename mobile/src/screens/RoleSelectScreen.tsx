import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
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

const pad = (n: number) => String(n).padStart(2, '0');
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const RoleSelectScreen: React.FC<Props> = ({ navigation }) => {
  const { settings } = useSettings();
  const { clearCart } = useCart();
  const { bottom } = useSafeAreaInsets();

  const [time, setTime] = useState(() => {
    const n = new Date();
    return `${pad(n.getHours())}:${pad(n.getMinutes())}`;
  });
  const [dateStr, setDateStr] = useState(() => {
    const n = new Date();
    return `${DAYS[n.getDay()]}, ${n.getDate()} ${MONTHS[n.getMonth()]}`;
  });

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  const [roleImgs, setRoleImgs] = useState<{ customer: string; admin: string; staff: string }>({
    customer: '', admin: '', staff: '',
  });

  useEffect(() => {
    // AsyncStorage = fast local load; server settings = cross-device fallback
    AsyncStorage.multiGet([ROLE_IMG_KEYS.customer, ROLE_IMG_KEYS.admin, ROLE_IMG_KEYS.staff])
      .then(([[, c], [, a], [, s]]) => {
        const merged = {
          customer: c || settings.roleImageCustomer || '',
          admin:    a || settings.roleImageAdmin    || '',
          staff:    s || settings.roleImageStaff    || '',
        };
        setRoleImgs(merged);
        // Cache server URLs locally so next load is instant
        if (!c && merged.customer) AsyncStorage.setItem(ROLE_IMG_KEYS.customer, merged.customer).catch(() => {});
        if (!a && merged.admin)    AsyncStorage.setItem(ROLE_IMG_KEYS.admin,    merged.admin).catch(() => {});
        if (!s && merged.staff)    AsyncStorage.setItem(ROLE_IMG_KEYS.staff,    merged.staff).catch(() => {});
      })
      .catch(() => {});
  }, [settings.roleImageAdmin, settings.roleImageCustomer, settings.roleImageStaff]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 400, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]).start();

    const id = setInterval(() => {
      const n = new Date();
      setTime(`${pad(n.getHours())}:${pad(n.getMinutes())}`);
      setDateStr(`${DAYS[n.getDay()]}, ${n.getDate()} ${MONTHS[n.getMonth()]}`);
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primary} translucent={false} />

      {/* ── Orange banner ───────────────────────────────────────────────── */}
      <View style={styles.banner}>
        <View style={styles.bannerLeft}>
          <Text style={styles.bannerEmoji}>🍽️</Text>
          <View>
            <Text style={styles.bannerHotel} numberOfLines={1}>
              {settings.hotelName || 'Dine POS'}
            </Text>
            <Text style={styles.bannerSub}>Point of Sale</Text>
          </View>
        </View>
        <View style={styles.bannerRight}>
          <Text style={styles.bannerClock}>{time}</Text>
          <Text style={styles.bannerDate}>{dateStr}</Text>
        </View>
      </View>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <View style={styles.body}>
        <Text style={styles.sectionTitle}>Select Your Role</Text>

        <Animated.View style={[styles.cards, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

          <RoleCard
            accentColor={Colors.primary}
            emoji="👤"
            imageUri={roleImgs.customer}
            role="Customer"
            desc="Browse Menu & Place Orders"
            onPress={() => { clearCart(); navigation.replace('CustomerTabs'); }}
          />

          <RoleCard
            accentColor={Colors.info}
            emoji="👨‍💼"
            imageUri={roleImgs.admin}
            role="Business Admin"
            desc="Manage Products, Orders, Reports & Settings"
            onPress={() => navigation.replace('AdminLogin')}
          />

          <RoleCard
            accentColor={Colors.success}
            emoji="👥"
            imageUri={roleImgs.staff}
            role="Staff Login"
            desc="Cashier · Kitchen · Waiter"
            onPress={() => navigation.navigate('StaffRole')}
          />

        </Animated.View>
      </View>

      {/* ── Platform admin ──────────────────────────────────────────────── */}
      <TouchableOpacity
        style={[styles.superBtn, { marginBottom: bottom + Spacing.lg }]}
        onPress={() => navigation.replace('SuperAdminLogin')}
        activeOpacity={0.7}
      >
        <MaterialIcons name="lock" size={13} color={Colors.textMuted} />
        <Text style={styles.superBtnText}>Platform Admin</Text>
      </TouchableOpacity>
    </View>
  );
};

// ── Role card ─────────────────────────────────────────────────────────────────
interface RoleCardProps {
  accentColor: string;
  emoji: string;
  imageUri?: string;
  role: string;
  desc: string;
  onPress: () => void;
}

const RoleCard: React.FC<RoleCardProps> = ({ accentColor, emoji, imageUri, role, desc, onPress }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const onPressIn  = () => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const onPressOut = () => Animated.spring(scaleAnim, { toValue: 1,    useNativeDriver: true, speed: 50, bounciness: 0 }).start();

  return (
    <Animated.View style={[styles.cardOuter, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        activeOpacity={1}
      >
        <View style={[styles.cardHero, { backgroundColor: accentColor + '18' }]}>
          <View style={[styles.iconCircle, { backgroundColor: accentColor + '28' }]}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.roleImage} resizeMode="cover" />
            ) : (
              <Text style={styles.iconEmoji}>{emoji}</Text>
            )}
          </View>
        </View>
        <View style={[styles.cardBody, { borderTopColor: accentColor }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardRole}>{role}</Text>
            <Text style={styles.cardDesc} numberOfLines={1}>{desc}</Text>
          </View>
          <View style={[styles.cardChip, { backgroundColor: accentColor + '18' }]}>
            <MaterialIcons name="arrow-forward" size={20} color={accentColor} />
          </View>
        </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingTop: 40,
    paddingBottom: Spacing.md,
  },
  bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  bannerEmoji: { fontSize: 30 },
  bannerHotel: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white, letterSpacing: -0.3, maxWidth: 160 },
  bannerSub: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.7)', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 },
  bannerRight: { alignItems: 'flex-end', justifyContent: 'flex-end' },
  bannerClock: { fontSize: FontSize.xxl, fontWeight: '300', color: Colors.white, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  bannerDate: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.75)', fontWeight: '500', marginTop: 2 },

  // Body
  body: { flex: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl },
  sectionTitle: {
    fontSize: FontSize.sm, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: Spacing.lg,
  },

  // Cards
  cards: { gap: Spacing.md },
  cardOuter: {},
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadows.sm,
  },
  cardHero: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: 'center', justifyContent: 'center',
  },
  iconEmoji: { fontSize: 36 },
  roleImage: { width: 76, height: 76, borderRadius: 38 },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: 3,
    gap: Spacing.md,
  },
  cardRole: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.text, marginBottom: 2 },
  cardDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 18 },
  cardChip: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  // Platform admin
  superBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'center', paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
  },
  superBtnText: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600', letterSpacing: 0.3 },
});

export default RoleSelectScreen;
