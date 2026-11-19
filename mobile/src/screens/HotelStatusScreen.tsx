import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Colors, FontSize, Spacing, BorderRadius } from '../utils/constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { getSaasStatusPublic, subscribeSaasPublic } from '../services/api';

type Props = NativeStackScreenProps<RootStackParamList, 'HotelStatus'>;

type StatusConfig = {
  icon: keyof typeof MaterialIcons.glyphMap;
  iconStyle: object;
  title: string;
  cardStyle: object;
  cardTextStyle: object;
  cardIcon: keyof typeof MaterialIcons.glyphMap;
  cardIconColor: string;
  message: string;
  stepsTitle: string;
  steps: { icon: keyof typeof MaterialIcons.glyphMap; text: string }[];
  primaryBtn?: string;
  showContinue?: boolean;
};

const HotelStatusScreen: React.FC<Props> = ({ navigation, route }) => {
  const { status, hotelName, trialDaysRemaining, hotelId, planExpired } = route.params;
  const { bottom } = useSafeAreaInsets();
  const { logout } = useAuth();

  // ── Subscribe with Razorpay (expired hotels; no login needed) ──
  const canSubscribe = status === 'expired' && !!hotelId;
  const [annualPrice, setAnnualPrice]       = useState<number | null>(null);
  const [subscribing, setSubscribing]       = useState(false);
  const [checking, setChecking]             = useState(false);
  const [openedCheckout, setOpenedCheckout] = useState(false);
  const [payMsg, setPayMsg]                 = useState('');

  useEffect(() => {
    if (!canSubscribe) return;
    let cancelled = false;
    getSaasStatusPublic(hotelId!)
      .then(s => { if (!cancelled && typeof s.annualPrice === 'number') setAnnualPrice(s.annualPrice); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [canSubscribe, hotelId]);

  const handleSubscribe = async () => {
    setSubscribing(true);
    setPayMsg('');
    try {
      const { checkoutUrl } = await subscribeSaasPublic(hotelId!);
      await Linking.openURL(checkoutUrl);
      setOpenedCheckout(true);
      setPayMsg('Finish the payment on the Razorpay page, then come back and tap "I have paid".');
    } catch (e: any) {
      setPayMsg(e?.message || 'Could not start the payment. Please try again or contact support.');
    } finally {
      setSubscribing(false);
    }
  };

  const handleCheckPaid = async () => {
    setChecking(true);
    setPayMsg('');
    try {
      const s = await getSaasStatusPublic(hotelId!);
      if (s.isActive) {
        setPayMsg('Payment received — your account is active. Please log in again.');
        setTimeout(() => { void logout(); }, 1500);
      } else {
        setPayMsg('Payment not received yet. If you have paid, wait a minute and tap again.');
      }
    } catch {
      setPayMsg('Could not connect. Check your internet connection.');
    } finally {
      setChecking(false);
    }
  };

  const configs: Record<string, StatusConfig> = {
    pending: {
      icon: 'hourglass-empty',
      iconStyle: styles.iconPending,
      title: 'Awaiting Approval',
      cardStyle: styles.statusCardPending,
      cardTextStyle: styles.statusTextPending,
      cardIcon: 'info',
      cardIconColor: Colors.warning,
      message: 'Your registration has been submitted and is currently being reviewed by our team. This typically takes 1–2 business days.',
      stepsTitle: 'What happens next?',
      steps: [
        { icon: 'search', text: 'Our team reviews your documents and KYC details' },
        { icon: 'check-circle', text: 'Once approved, you can log in and use the full app' },
        { icon: 'notifications', text: 'Re-login after approval to access your dashboard' },
      ],
    },
    trial: {
      icon: 'timer',
      iconStyle: styles.iconTrial,
      title: trialDaysRemaining === 1
        ? 'Trial Expires Today!'
        : `${trialDaysRemaining ?? 0} Days Left in Trial`,
      cardStyle: styles.statusCardTrial,
      cardTextStyle: styles.statusTextTrial,
      cardIcon: 'timer',
      cardIconColor: Colors.warning,
      message: `Your free trial ${trialDaysRemaining === 1 ? 'expires today' : `expires in ${trialDaysRemaining ?? 0} days`}. Activate a subscription to keep using Dine POS without interruption.`,
      stepsTitle: 'Keep your data safe',
      steps: [
        { icon: 'contact-support', text: 'Contact support to activate your subscription plan' },
        { icon: 'cloud-done', text: 'All your data is saved and will carry over to your plan' },
        { icon: 'check-circle', text: 'Continue using the app until your trial ends' },
      ],
      showContinue: true,
    },
    expired: {
      icon: 'timer-off',
      iconStyle: styles.iconExpired,
      title: planExpired ? 'Subscription Expired' : 'Trial Expired',
      cardStyle: styles.statusCardSuspended,
      cardTextStyle: styles.statusTextSuspended,
      cardIcon: 'warning',
      cardIconColor: Colors.danger,
      message: canSubscribe
        ? `${planExpired ? 'Your subscription has expired.' : 'Your free trial has ended.'} Subscribe below to continue using Dine POS.`
        : 'Your free trial has ended. Please contact support to activate your subscription and regain access.',
      stepsTitle: 'How to reactivate?',
      steps: canSubscribe
        ? [
            { icon: 'payment', text: 'Tap Subscribe Now and pay securely with Razorpay' },
            { icon: 'refresh', text: 'Come back and tap "I have paid", then log in again' },
            { icon: 'check-circle', text: 'All your data is preserved and ready to use' },
          ]
        : [
            { icon: 'support-agent', text: 'Contact our support team to choose a plan' },
            { icon: 'payment', text: 'Activate a subscription to restore access' },
            { icon: 'check-circle', text: 'All your data is preserved and ready to use' },
          ],
    },
    suspended: {
      icon: 'block',
      iconStyle: styles.iconSuspended,
      title: 'Account Suspended',
      cardStyle: styles.statusCardSuspended,
      cardTextStyle: styles.statusTextSuspended,
      cardIcon: 'warning',
      cardIconColor: Colors.danger,
      message: 'Your hotel account has been suspended by the platform admin. Please contact support to resolve this.',
      stepsTitle: 'What can you do?',
      steps: [
        { icon: 'support-agent', text: 'Contact our support team to understand the reason' },
        { icon: 'edit', text: 'Make corrections if required and request reactivation' },
        { icon: 'check-circle', text: 'Once resolved, the admin will reactivate your account' },
      ],
    },
  };

  const cfg = configs[status] ?? configs.pending;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      <ScrollView contentContainerStyle={[styles.content, { paddingTop: Spacing.xxl, paddingBottom: Spacing.xxl + bottom }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.iconCircle, cfg.iconStyle]}>
          <MaterialIcons name={cfg.icon} size={64} color={Colors.white} />
        </View>

        <Text style={styles.title}>{cfg.title}</Text>

        {hotelName ? <Text style={styles.hotelName}>{hotelName}</Text> : null}

        <View style={[styles.statusCard, cfg.cardStyle]}>
          <MaterialIcons name={cfg.cardIcon} size={20} color={cfg.cardIconColor} />
          <Text style={[styles.statusCardText, cfg.cardTextStyle]}>{cfg.message}</Text>
        </View>

        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>{cfg.stepsTitle}</Text>
          {cfg.steps.map((s, i) => <StepRow key={i} icon={s.icon} text={s.text} />)}
        </View>

        {cfg.showContinue && (
          <TouchableOpacity
            style={styles.continueBtn}
            onPress={() => navigation.replace('MainTabs')}
            activeOpacity={0.8}
          >
            <MaterialIcons name="arrow-forward" size={20} color={Colors.white} />
            <Text style={styles.continueBtnText}>Continue to App</Text>
          </TouchableOpacity>
        )}

        {canSubscribe && (
          <>
            <TouchableOpacity
              style={[styles.continueBtn, (subscribing || checking) && { opacity: 0.6 }]}
              onPress={() => void handleSubscribe()}
              disabled={subscribing || checking}
              activeOpacity={0.8}
            >
              {subscribing
                ? <ActivityIndicator color={Colors.white} />
                : <MaterialIcons name="payment" size={20} color={Colors.white} />}
              <Text style={styles.continueBtnText}>
                {subscribing
                  ? 'Opening Razorpay…'
                  : `Subscribe Now${annualPrice ? ` — ₹${annualPrice.toLocaleString('en-IN')}/year` : ''}`}
              </Text>
            </TouchableOpacity>

            {openedCheckout && (
              <TouchableOpacity
                style={[styles.paidBtn, checking && { opacity: 0.6 }]}
                onPress={() => void handleCheckPaid()}
                disabled={checking}
                activeOpacity={0.8}
              >
                {checking
                  ? <ActivityIndicator color={Colors.success} />
                  : <MaterialIcons name="check-circle" size={20} color={Colors.success} />}
                <Text style={styles.paidBtnText}>I have paid — check status</Text>
              </TouchableOpacity>
            )}

            {payMsg ? <Text style={styles.payMsg}>{payMsg}</Text> : null}
          </>
        )}

        <TouchableOpacity style={styles.supportBtn} onPress={() => navigation.navigate('Support')} activeOpacity={0.8}>
          <MaterialIcons name="support-agent" size={20} color={Colors.white} />
          <Text style={styles.supportBtnText}>Contact Support</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={() => void logout()} activeOpacity={0.8}>
          <MaterialIcons name="logout" size={18} color={Colors.textSecondary} />
          <Text style={styles.logoutBtnText}>Back to Login</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const StepRow = ({ icon, text }: { icon: keyof typeof MaterialIcons.glyphMap; text: string }) => (
  <View style={styles.stepRow}>
    <MaterialIcons name={icon} size={18} color={Colors.primary} />
    <Text style={styles.stepText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    padding: Spacing.xxl,
    gap: Spacing.xl,
  },

  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  iconPending: { backgroundColor: Colors.warning },
  iconTrial: { backgroundColor: Colors.accent },
  iconExpired: { backgroundColor: Colors.danger },
  iconSuspended: { backgroundColor: Colors.danger },

  title: {
    fontSize: FontSize.title,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  hotelName: {
    fontSize: FontSize.lg,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: -Spacing.md,
  },

  statusCard: {
    flexDirection: 'row',
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
    alignItems: 'flex-start',
    borderWidth: 1,
    width: '100%',
  },
  statusCardPending: {
    backgroundColor: Colors.warning + '18',
    borderColor: Colors.warning,
  },
  statusCardTrial: {
    backgroundColor: Colors.accent + '18',
    borderColor: Colors.accent,
  },
  statusCardSuspended: {
    backgroundColor: Colors.danger + '18',
    borderColor: Colors.danger,
  },
  statusCardText: { flex: 1, fontSize: FontSize.md, lineHeight: 22 },
  statusTextPending: { color: Colors.text },
  statusTextTrial: { color: Colors.text },
  statusTextSuspended: { color: Colors.text },

  stepsCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    width: '100%',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepsTitle: {
    color: Colors.primary,
    fontSize: FontSize.md,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  stepRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  stepText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.md, lineHeight: 22 },

  continueBtn: {
    flexDirection: 'row',
    backgroundColor: Colors.success,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xxl,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    gap: Spacing.sm,
    width: '100%',
    justifyContent: 'center',
  },
  continueBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },
  paidBtn: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: Colors.success,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxl,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    gap: Spacing.sm,
    width: '100%',
    justifyContent: 'center',
  },
  paidBtnText: { color: Colors.success, fontSize: FontSize.md, fontWeight: '700' },
  payMsg: { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20 },
  supportBtn: {
    flexDirection: 'row',
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xxl,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    gap: Spacing.sm,
    width: '100%',
    justifyContent: 'center',
  },
  supportBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },

  logoutBtn: {
    flexDirection: 'row',
    paddingVertical: Spacing.md,
    alignItems: 'center',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  logoutBtnText: { color: Colors.textSecondary, fontSize: FontSize.md },
});

export default HotelStatusScreen;
