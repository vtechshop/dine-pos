import React, { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, ScrollView, Animated, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useSettings } from '../context/SettingsContext';
import { useCart } from '../context/CartContext';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'RoleSelect'>;

const RoleSelectScreen: React.FC<Props> = ({ navigation }) => {
  const { settings } = useSettings();
  const { clearCart } = useCart();
  const { bottom } = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const fadeIn  = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideUp, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: bottom + Spacing.xl }]} showsVerticalScrollIndicator={false}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primary} translucent={false} />

      {/* Decorative header stripe */}
      <View style={styles.headerStripe}>
        <View style={styles.stripeRow}>
          {['🍔','🍗','🌮','🍕','🥗','🍜','🍣','🥪'].map((e, i) => (
            <Text key={i} style={styles.stripeEmoji}>{e}</Text>
          ))}
        </View>
      </View>

      <Animated.View style={[styles.body, { opacity: fadeIn, transform: [{ translateY: slideUp }] }]}>
        {/* Hotel name */}
        <View style={styles.hotelRow}>
          <View style={styles.hotelIconWrap}>
            <Text style={{ fontSize: 28 }}>🏨</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.hotelName} numberOfLines={1}>{settings.hotelName || 'Hotel POS'}</Text>
            <Text style={styles.hotelSub}>Select your role to continue</Text>
          </View>
        </View>

        {/* Role cards */}
        <View style={[styles.cardsWrap, isLandscape && { flexDirection: 'row' }]}>

          {/* Customer */}
          <TouchableOpacity
            style={[styles.roleCard, styles.roleCardCustomer]}
            onPress={() => { clearCart(); navigation.replace('CustomerTabs'); }}
            activeOpacity={0.88}
          >
            <View style={styles.roleCardBg} />
            <View style={styles.roleEmojiBubble}>
              <Text style={{ fontSize: 42 }}>🛒</Text>
            </View>
            <Text style={styles.roleCardTitle}>Customer</Text>
            <Text style={styles.roleCardDesc}>Browse menu & place order from your table</Text>
            <View style={styles.roleCardCTA}>
              <Text style={styles.roleCardCTAText}>Order Now</Text>
              <MaterialIcons name="arrow-forward" size={18} color={Colors.white} />
            </View>
          </TouchableOpacity>

          {/* Admin */}
          <TouchableOpacity
            style={[styles.roleCard, styles.roleCardAdmin]}
            onPress={() => navigation.replace('AdminLogin')}
            activeOpacity={0.88}
          >
            <View style={[styles.roleCardBg, { backgroundColor: Colors.info + '15' }]} />
            <View style={[styles.roleEmojiBubble, { backgroundColor: Colors.infoBg }]}>
              <Text style={{ fontSize: 42 }}>💼</Text>
            </View>
            <Text style={styles.roleCardTitle}>Admin / Staff</Text>
            <Text style={styles.roleCardDesc}>POS billing, manage orders & reports</Text>
            <View style={[styles.roleCardCTA, { backgroundColor: Colors.info }]}>
              <Text style={styles.roleCardCTAText}>Staff Login</Text>
              <MaterialIcons name="arrow-forward" size={18} color={Colors.white} />
            </View>
          </TouchableOpacity>

          {/* Kitchen */}
          <TouchableOpacity
            style={[styles.roleCard, styles.roleCardKitchen]}
            onPress={() => navigation.navigate('KitchenLogin')}
            activeOpacity={0.88}
          >
            <View style={[styles.roleCardBg, { backgroundColor: Colors.success + '15' }]} />
            <View style={[styles.roleEmojiBubble, { backgroundColor: Colors.successBg ?? '#E6F9EE' }]}>
              <Text style={{ fontSize: 42 }}>👨‍🍳</Text>
            </View>
            <Text style={styles.roleCardTitle}>Kitchen Display</Text>
            <Text style={styles.roleCardDesc}>View & manage incoming orders in real-time</Text>
            <View style={[styles.roleCardCTA, { backgroundColor: Colors.success }]}>
              <Text style={styles.roleCardCTAText}>Open KDS</Text>
              <MaterialIcons name="arrow-forward" size={18} color={Colors.white} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Super admin */}
        <TouchableOpacity style={styles.superBtn} onPress={() => navigation.replace('SuperAdminLogin')} activeOpacity={0.7}>
          <MaterialIcons name="verified-user" size={14} color={Colors.textMuted} />
          <Text style={styles.superBtnText}>Platform Admin</Text>
          <MaterialIcons name="chevron-right" size={14} color={Colors.textMuted} />
        </TouchableOpacity>
      </Animated.View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: Colors.background },
  headerStripe: {
    backgroundColor: Colors.primary, paddingVertical: 10, overflow: 'hidden',
  },
  stripeRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: Spacing.md },
  stripeEmoji: { fontSize: 22, opacity: 0.9 },
  body: { flex: 1, padding: Spacing.xl, paddingTop: Spacing.xxl },
  hotelRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.lg,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xxl,
    padding: Spacing.lg, marginBottom: Spacing.xl,
    borderWidth: 1.5, borderColor: Colors.border, ...Shadows.sm,
  },
  hotelIconWrap: { width: 56, height: 56, borderRadius: 16, backgroundColor: Colors.accentBg, alignItems: 'center', justifyContent: 'center' },
  hotelName: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  hotelSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },

  cardsWrap: { gap: Spacing.lg, marginBottom: Spacing.lg },
  roleCard: {
    borderRadius: BorderRadius.xxl, padding: Spacing.xxl,
    borderWidth: 1.5, borderColor: Colors.border,
    overflow: 'hidden', ...Shadows.md,
  },
  roleCardCustomer: { backgroundColor: Colors.primaryBg, borderColor: Colors.primary + '40' },
  roleCardAdmin:    { backgroundColor: Colors.infoBg,    borderColor: Colors.info + '40' },
  roleCardKitchen:  { backgroundColor: '#E6F9EE',        borderColor: Colors.success + '40' },
  roleCardBg: {
    position: 'absolute', top: -30, right: -30,
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: Colors.primaryBg,
  },
  roleEmojiBubble: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  roleCardTitle: { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.text, marginBottom: 6 },
  roleCardDesc:  { fontSize: FontSize.md, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.xl },
  roleCardCTA: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.xl,
    paddingVertical: 13, paddingHorizontal: Spacing.xxl,
    ...Shadows.primary,
  },
  roleCardCTAText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
  superBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.md, alignSelf: 'center',
  },
  superBtnText: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '600' },
});

export default RoleSelectScreen;
