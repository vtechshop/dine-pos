import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useSettings } from '../context/SettingsContext';
import { useCart } from '../context/CartContext';

type Props = NativeStackScreenProps<RootStackParamList, 'RoleSelect'>;

// ── Dark POS terminal tokens ──────────────────────────────────────────────────
const C = {
  ground:   '#130A04',
  surface:  '#1E1108',
  surfaceH: '#2A1A0E',
  border:   'rgba(255,160,80,.10)',
  divider:  'rgba(255,160,80,.06)',
  text:     '#F0E8DC',
  text2:    '#A08878',
  text3:    '#5C3E30',
  red:      '#E8380D',
  redBg:    'rgba(232,56,13,.12)',
  blue:     '#1565C0',
  blueBg:   'rgba(21,101,192,.12)',
  green:    '#2E7D32',
  greenBg:  'rgba(46,125,50,.12)',
};

const pad = (n: number) => String(n).padStart(2, '0');

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const RoleSelectScreen: React.FC<Props> = ({ navigation }) => {
  const { settings } = useSettings();
  const { clearCart } = useCart();
  const { top, bottom } = useSafeAreaInsets();

  const [time, setTime] = useState(() => {
    const n = new Date();
    return `${pad(n.getHours())}:${pad(n.getMinutes())}`;
  });
  const [dateStr, setDateStr] = useState(() => {
    const n = new Date();
    return `${DAYS[n.getDay()]}, ${n.getDate()} ${MONTHS[n.getMonth()]}`;
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
      Animated.timing(slideAnim, { toValue: 0, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
    ]).start();

    const id = setInterval(() => {
      const n = new Date();
      setTime(`${pad(n.getHours())}:${pad(n.getMinutes())}`);
      setDateStr(`${DAYS[n.getDay()]}, ${n.getDate()} ${MONTHS[n.getMonth()]}`);
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.ground} translucent={false} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.hotelEmoji}>🏨</Text>
          <View>
            <Text style={styles.hotelName} numberOfLines={1}>
              {settings.hotelName || 'Dine POS'}
            </Text>
            <Text style={styles.hotelSub}>Point of Sale</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.clock}>{time}</Text>
          <Text style={styles.dateText}>{dateStr}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* ── Cards ──────────────────────────────────────────────────────── */}
      <Animated.View
        style={[styles.cards, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
      >
        {/* Customer */}
        <RoleCard
          accentColor={C.red}
          iconBg={C.redBg}
          emoji="👤"
          role="Customer"
          desc="Browse Menu & Place Orders"
          onPress={() => { clearCart(); navigation.replace('CustomerTabs'); }}
        />

        {/* Business Admin */}
        <RoleCard
          accentColor={C.blue}
          iconBg={C.blueBg}
          emoji="👨‍💼"
          role="Business Admin"
          desc="Manage Products, Orders, Reports & Settings"
          onPress={() => navigation.replace('AdminLogin')}
        />

        {/* Staff Login */}
        <RoleCard
          accentColor={C.green}
          iconBg={C.greenBg}
          emoji="👥"
          role="Staff Login"
          desc="Cashier · Kitchen · Waiter"
          onPress={() => navigation.navigate('StaffRole')}
        />
      </Animated.View>

      {/* ── Platform admin ──────────────────────────────────────────────── */}
      <TouchableOpacity
        style={[styles.superBtn, { marginBottom: bottom + 8 }]}
        onPress={() => navigation.replace('SuperAdminLogin')}
        activeOpacity={0.7}
      >
        <Text style={styles.superBtnText}>🔐  Platform Admin</Text>
      </TouchableOpacity>
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

  const onPressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.975, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const onPressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 0 }).start();

  return (
    <Animated.View style={[styles.cardOuter, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        activeOpacity={1}
      >
        {/* Left accent bar */}
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />

        {/* Icon */}
        <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
          <Text style={styles.iconEmoji}>{emoji}</Text>
        </View>

        {/* Text */}
        <View style={styles.cardText}>
          <Text style={styles.cardRole}>{role}</Text>
          <Text style={styles.cardDesc} numberOfLines={2}>{desc}</Text>
        </View>

        {/* Arrow */}
        <Text style={styles.cardArrow}>›</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.ground,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 18,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  hotelEmoji: { fontSize: 26 },
  hotelName: {
    fontSize: 17, fontWeight: '800', color: C.text,
    letterSpacing: -0.3, maxWidth: 180,
  },
  hotelSub: { fontSize: 11, color: C.text3, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 1 },
  headerRight: { alignItems: 'flex-end' },
  clock: {
    fontSize: 28, fontWeight: '300', color: C.text,
    letterSpacing: -1, fontVariant: ['tabular-nums'],
    fontFamily: 'System',
  },
  dateText: { fontSize: 11, color: C.text2, fontWeight: '500', marginTop: 1 },

  divider: { height: 1, backgroundColor: C.divider, marginHorizontal: 0 },

  // Cards
  cards: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
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

  accentBar: {
    width: 5,
    alignSelf: 'stretch',
  },

  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 16,
    marginRight: 4,
    flexShrink: 0,
  },
  iconEmoji: { fontSize: 26 },

  cardText: { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  cardRole: {
    fontSize: 17, fontWeight: '800', color: C.text,
    letterSpacing: -0.3, marginBottom: 3,
  },
  cardDesc: {
    fontSize: 13, color: C.text2, fontWeight: '500', lineHeight: 18,
  },

  cardArrow: {
    fontSize: 26, color: C.text3,
    paddingRight: 16, paddingTop: 2,
    lineHeight: 30,
  },

  // Platform admin
  superBtn: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 6,
  },
  superBtnText: {
    fontSize: 12, color: C.text3, fontWeight: '600', letterSpacing: 0.4,
  },
});

export default RoleSelectScreen;
