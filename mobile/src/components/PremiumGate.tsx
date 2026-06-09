import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSettings } from '../context/SettingsContext';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';
import { RootStackParamList } from '../types';

interface Props {
  feature: string;
  description?: string;
  children: React.ReactNode;
}

export const PremiumGate: React.FC<Props> = ({ feature, description, children }) => {
  const { settings, refreshSettings } = useSettings();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [checking, setChecking] = useState(false);

  if (settings.isPremium) return <>{children}</>;

  const handleCheckStatus = async () => {
    setChecking(true);
    await refreshSettings();
    setChecking(false);
  };

  const isTrialExpired = settings.trialEndsAt && new Date(settings.trialEndsAt) < new Date();
  const isTrial = settings.trialEndsAt && new Date(settings.trialEndsAt) > new Date();
  const daysLeft = isTrial
    ? Math.ceil((new Date(settings.trialEndsAt!).getTime() - Date.now()) / 86400000)
    : 0;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {/* Crown icon */}
        <View style={styles.iconCircle}>
          <Text style={styles.crownEmoji}>👑</Text>
        </View>

        <Text style={styles.title}>Premium Feature</Text>
        <Text style={styles.featureName}>{feature}</Text>
        {description ? <Text style={styles.desc}>{description}</Text> : null}

        {isTrial && (
          <View style={styles.trialBanner}>
            <MaterialIcons name="timer" size={14} color={Colors.warning} />
            <Text style={styles.trialText}>Trial ends in {daysLeft} day{daysLeft !== 1 ? 's' : ''}</Text>
          </View>
        )}

        {isTrialExpired && (
          <View style={[styles.trialBanner, { backgroundColor: Colors.danger + '20', borderColor: Colors.danger }]}>
            <MaterialIcons name="lock" size={14} color={Colors.danger} />
            <Text style={[styles.trialText, { color: Colors.danger }]}>Trial expired</Text>
          </View>
        )}

        <View style={styles.planRow}>
          {['Basic ₹499/mo', 'Pro ₹999/mo'].map((plan) => (
            <View key={plan} style={styles.planChip}>
              <MaterialIcons name="star" size={12} color={Colors.primary} />
              <Text style={styles.planChipText}>{plan}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.upgradeBtn}
          onPress={() => navigation.navigate('Support')}
          activeOpacity={0.85}
        >
          <MaterialIcons name="upgrade" size={18} color={Colors.white} />
          <Text style={styles.upgradeBtnText}>Upgrade to Premium</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={handleCheckStatus}
          activeOpacity={0.7}
          disabled={checking}
        >
          {checking
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <MaterialIcons name="refresh" size={16} color={Colors.primary} />
          }
          <Text style={styles.refreshBtnText}>{checking ? 'Checking...' : 'Check Status'}</Text>
        </TouchableOpacity>

        <Text style={styles.contactHint}>Contact support to activate your plan</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: Colors.background,
    alignItems: 'center', justifyContent: 'center', padding: Spacing.xl,
  },
  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xxl,
    padding: Spacing.xxl, alignItems: 'center', width: '100%',
    borderWidth: 1.5, borderColor: Colors.primary + '40', ...Shadows.md,
  },
  iconCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  crownEmoji: { fontSize: 40 },
  title: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.xs },
  featureName: { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.text, marginBottom: Spacing.sm, textAlign: 'center' },
  desc: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: Spacing.lg },
  trialBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.warning + '20', borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderWidth: 1, borderColor: Colors.warning, marginBottom: Spacing.lg,
  },
  trialText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.warning },
  planRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.xl, flexWrap: 'wrap', justifyContent: 'center' },
  planChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryBg, borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  planChipText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.xl,
    paddingVertical: Spacing.lg, paddingHorizontal: Spacing.xxxl,
    width: '100%', justifyContent: 'center', ...Shadows.primary,
  },
  upgradeBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: Spacing.md, paddingVertical: 10, paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.primary + '50',
    backgroundColor: Colors.primaryBg,
  },
  refreshBtnText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700' },
  contactHint: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: Spacing.md, textAlign: 'center' },
});
