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

const RoleSelectScreen: React.FC<Props> = ({ navigation }) => {
  const { settings } = useSettings();
  const { clearCart } = useCart();
  const { top, bottom } = useSafeAreaInsets();

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  const [roleImgs, setRoleImgs] = useState<{ customer: string; admin: string; staff: string }>({
    customer: '', admin: '', staff: '',
  });

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
      Animated.timing(fadeAnim,  { toValue: 1, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(slideAnim, { toValue: 0, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]).start();
  }, []);

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} translucent={false} />

      <View style={[styles.body, { paddingBottom: bottom + Spacing.xl }]}>

        {/* ── Hotel identity card ──────────────────────────────────────── */}
        <View style={styles.hotelCard}>
          <View style={styles.hotelIconBox}>
            <Text style={styles.hotelIconEmoji}>🏨</Text>
          </View>
          <View style={styles.hotelInfo}>
            <Text style={styles.hotelName} numberOfLines={1}>
              {settings.hotelName || 'Dine POS'}
            </Text>
            <Text style={styles.hotelSub}>Select your role to continue</Text>
          </View>
        </View>

        {/* ── Role cards ───────────────────────────────────────────────── */}
        <Animated.View style={[styles.cards, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

          <RoleCard
            accentColor={Colors.primary}
            emoji="🛒"
            imageUri={roleImgs.customer}
            role="Customer"
            desc="Browse menu & place order from your table"
            buttonLabel="Order Now"
            onPress={() => { clearCart(); navigation.replace('CustomerTabs'); }}
          />

          <RoleCard
            accentColor={Colors.info}
            emoji="💼"
            imageUri={roleImgs.admin}
            role="Business Admin"
            desc="POS billing, manage orders & reports"
            buttonLabel="Admin Login"
            onPress={() => navigation.replace('AdminLogin')}
          />

          <RoleCard
            accentColor={Colors.success}
            emoji="👥"
            imageUri={roleImgs.staff}
            role="Staff Login"
            desc="Cashier · Kitchen · Waiter"
            buttonLabel="Staff Login"
            onPress={() => navigation.navigate('StaffRole')}
          />

        </Animated.View>

        {/* ── Platform Admin link ──────────────────────────────────────── */}
        <Pressable
          style={styles.saLink}
          onPress={() => navigation.navigate('SuperAdminLogin')}
          accessibilityRole="link"
          accessibilityLabel="Platform Admin login"
        >
          <MaterialIcons name="shield" size={14} color={Colors.textMuted} />
          <Text style={styles.saLinkText}>Platform Admin</Text>
          <MaterialIcons name="chevron-right" size={14} color={Colors.textMuted} />
        </Pressable>

      </View>
    </View>
  );
};

// ── Role card ─────────────────────────────────────────────────────────────────
interface RoleCardProps {
  accentColor: string;
  emoji:       string;
  imageUri?:   string;
  role:        string;
  desc:        string;
  buttonLabel: string;
  onPress:     () => void;
}

const RoleCard: React.FC<RoleCardProps> = ({
  accentColor, emoji, imageUri, role, desc, buttonLabel, onPress,
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pressIn   = () => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const pressOut  = () => Animated.spring(scaleAnim, { toValue: 1,    useNativeDriver: true, speed: 50, bounciness: 0 }).start();

  return (
    <Animated.View style={[styles.cardOuter, { transform: [{ scale: scaleAnim }] }]}>
      <Pressable
        style={styles.card}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        android_ripple={{ color: accentColor + '28', borderless: false }}
        accessibilityRole="button"
        accessibilityLabel={`${role}. ${desc}. Tap to ${buttonLabel}.`}
      >
        {/* ── Tinted hero: icon centred on accent wash ── */}
        <View style={[styles.cardHero, { backgroundColor: accentColor + '15' }]}>
          <View style={[styles.iconCircle, { backgroundColor: accentColor + '28' }]}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.roleImage} resizeMode="cover" />
            ) : (
              <Text style={styles.iconEmoji}>{emoji}</Text>
            )}
          </View>
        </View>

        {/* ── Body: title + description + full-width button ── */}
        <View style={[styles.cardBody, { borderTopColor: accentColor }]}>
          <Text style={styles.cardRole}>{role}</Text>
          <Text style={styles.cardDesc} numberOfLines={1}>{desc}</Text>

          {/* Full-width action button — visual affordance; card is the touchable */}
          <View style={[styles.cardBtn, { backgroundColor: accentColor }]}>
            <Text style={styles.cardBtnText}>{buttonLabel}</Text>
            <MaterialIcons name="arrow-forward" size={16} color={Colors.white} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({

  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  body: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    gap: Spacing.lg,
  },

  // ── Hotel identity card ───────────────────────────────────────────────────
  hotelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    ...Shadows.sm,
  },
  hotelIconBox: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hotelIconEmoji: { fontSize: 22 },
  hotelInfo: { flex: 1 },
  hotelName: {
    fontSize: FontSize.lg,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  hotelSub: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },

  // ── Cards container ───────────────────────────────────────────────────────
  cards: { flex: 1, gap: Spacing.lg },

  cardOuter: { flex: 1 },

  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadows.md,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  cardHero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmoji: { fontSize: 42 },
  roleImage: { width: 88, height: 88, borderRadius: 44 },

  // ── Body ──────────────────────────────────────────────────────────────────
  cardBody: {
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.lg,
    borderTopWidth:    3,
    gap:               Spacing.xs,
  },
  cardRole: {
    fontSize:      FontSize.lg,
    fontWeight:    '900',
    color:         Colors.text,
    letterSpacing: -0.2,
  },
  cardDesc: {
    fontSize:   FontSize.sm,
    color:      Colors.textSecondary,
    lineHeight: 17,
  },

  // ── Platform Admin link ───────────────────────────────────────────────────
  saLink: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  saLinkText: {
    fontSize:      FontSize.sm,
    color:         Colors.textMuted,
    fontWeight:    '500',
    letterSpacing: 0.2,
  },

  // ── Full-width action button ───────────────────────────────────────────────
  cardBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    borderRadius:    BorderRadius.lg,
    paddingVertical: Spacing.md,
    gap:             Spacing.xs,
    marginTop:       Spacing.sm,
  },
  cardBtnText: {
    fontSize:      FontSize.md,
    fontWeight:    '700',
    color:         Colors.white,
    letterSpacing: 0.2,
  },

});

export default RoleSelectScreen;
