import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Linking, ActivityIndicator, StatusBar, ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { getSubscriptionInfo } from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius } from '../utils/constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = NativeStackScreenProps<RootStackParamList, 'SubscriptionExpired'>;

const SUPPORT_PHONE    = '+917871469095';
const SUPPORT_WHATSAPP = '917871469095';
const SUPPORT_EMAIL    = 'support@dinepos.in';

const SubscriptionExpiredScreen: React.FC<Props> = ({ navigation, route }) => {
  const { top, bottom } = useSafeAreaInsets();
  const { hotelName, expiredOn, subscriptionType } = route.params;
  const isTrial = !subscriptionType || subscriptionType === 'trial';

  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg,  setRefreshMsg]  = useState('');

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshMsg('');
    try {
      const info = await getSubscriptionInfo();
      if (!info.isExpired) {
        navigation.replace('MainTabs');
      } else {
        setRefreshMsg('Subscription still expired. Please contact support.');
      }
    } catch {
      setRefreshMsg('Could not connect. Check your internet connection.');
    } finally {
      setRefreshing(false);
    }
  };

  const openWhatsApp = () => {
    const msg = encodeURIComponent(
      `Hi Dine POS Support,\n\nMy ${isTrial ? 'trial' : 'subscription'} for *${hotelName}* has expired. Please help me renew.\n\nThank you.`
    );
    Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP}?text=${msg}`);
  };

  return (
    <View style={[styles.container, { paddingTop: top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primaryDark} />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom + Spacing.xxxl }]} showsVerticalScrollIndicator={false}>

        {/* Icon */}
        <View style={styles.iconWrap}>
          <MaterialIcons name="timer-off" size={80} color="rgba(255,255,255,0.85)" />
        </View>

        {/* Title */}
        <Text style={styles.title}>{isTrial ? 'Trial Expired' : 'Subscription Expired'}</Text>
        <Text style={styles.subtitle}>
          {isTrial ? 'Your free trial has ended.' : 'Your subscription has expired.'}
        </Text>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoIconWrap}>
              <MaterialIcons name="store" size={22} color={Colors.primary} />
            </View>
            <View style={styles.infoText}>
              <Text style={styles.infoLabel}>Business</Text>
              <Text style={styles.infoValue} numberOfLines={2}>{hotelName}</Text>
            </View>
          </View>

          <View style={styles.infoDivider} />

          <View style={styles.infoRow}>
            <View style={styles.infoIconWrap}>
              <MaterialIcons name="event-busy" size={22} color={Colors.danger} />
            </View>
            <View style={styles.infoText}>
              <Text style={styles.infoLabel}>{isTrial ? 'Trial Ended On' : 'Expired On'}</Text>
              <Text style={[styles.infoValue, { color: Colors.danger }]}>{expiredOn}</Text>
            </View>
          </View>

          <View style={styles.infoDivider} />

          <View style={styles.infoRow}>
            <View style={styles.infoIconWrap}>
              <MaterialIcons name="lock" size={22} color={Colors.textMuted} />
            </View>
            <View style={styles.infoText}>
              <Text style={styles.infoLabel}>Access</Text>
              <Text style={styles.infoValue}>Billing, Orders, Reports — blocked</Text>
            </View>
          </View>
        </View>

        {/* Message */}
        <Text style={styles.message}>
          To continue using Dine POS,{'\n'}please renew your subscription.{'\n'}
          Contact our support team for assistance.
        </Text>

        {/* Contact Buttons */}
        <View style={styles.contactRow}>
          <TouchableOpacity
            style={[styles.contactBtn, { backgroundColor: Colors.primary }]}
            onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}
          >
            <MaterialIcons name="call" size={24} color={Colors.white} />
            <Text style={styles.contactBtnText}>Call</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.contactBtn, { backgroundColor: '#25D366' }]}
            onPress={openWhatsApp}
          >
            <MaterialIcons name="chat" size={24} color={Colors.white} />
            <Text style={styles.contactBtnText}>WhatsApp</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.contactBtn, { backgroundColor: Colors.info }]}
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Renewal Request - ${encodeURIComponent(hotelName)}`)}
          >
            <MaterialIcons name="email" size={24} color={Colors.white} />
            <Text style={styles.contactBtnText}>Email</Text>
          </TouchableOpacity>
        </View>

        {/* Refresh */}
        {refreshMsg ? <Text style={styles.refreshMsg}>{refreshMsg}</Text> : null}

        <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh} disabled={refreshing}>
          {refreshing
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : (
              <>
                <MaterialIcons name="refresh" size={20} color={Colors.primary} />
                <Text style={styles.refreshBtnText}>Refresh Status</Text>
              </>
            )
          }
        </TouchableOpacity>

        <Text style={styles.hint}>
          After your plan is renewed by an admin,{'\n'}tap Refresh to regain access.
        </Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  content:   { alignItems: 'center', paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl },

  iconWrap: { marginBottom: Spacing.lg, alignItems: 'center' },
  title:    { fontSize: 30, fontWeight: '800', color: Colors.white, textAlign: 'center', marginBottom: Spacing.sm },
  subtitle: { fontSize: FontSize.md, color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: Spacing.xl },

  infoCard:    { width: '100%', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.lg, marginBottom: Spacing.lg },
  infoRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  infoIconWrap:{ width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  infoText:    { flex: 1 },
  infoLabel:   { color: Colors.textSecondary, fontSize: FontSize.sm },
  infoValue:   { color: Colors.text, fontSize: FontSize.md, fontWeight: '700', marginTop: 2 },
  infoDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },

  message: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },

  contactRow:      { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.xl, width: '100%' },
  contactBtn:      { flex: 1, borderRadius: BorderRadius.md, paddingVertical: Spacing.md, alignItems: 'center', gap: 6 },
  contactBtnText:  { color: Colors.white, fontSize: FontSize.sm, fontWeight: '700' },

  refreshMsg:     { color: 'rgba(255,255,255,0.75)', fontSize: FontSize.sm, marginBottom: Spacing.sm, textAlign: 'center' },
  refreshBtn:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.white, borderRadius: BorderRadius.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.xl, marginBottom: Spacing.md },
  refreshBtnText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },

  hint: { color: 'rgba(255,255,255,0.55)', fontSize: FontSize.xs, textAlign: 'center', lineHeight: 18 },
});

export default SubscriptionExpiredScreen;
