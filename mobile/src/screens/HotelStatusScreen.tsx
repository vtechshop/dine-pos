import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Colors, FontSize, Spacing, BorderRadius } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'HotelStatus'>;

const HotelStatusScreen: React.FC<Props> = ({ navigation, route }) => {
  const { status, hotelName } = route.params;
  const isPending = status === 'pending';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Icon */}
        <View style={[styles.iconCircle, isPending ? styles.iconPending : styles.iconSuspended]}>
          <MaterialIcons
            name={isPending ? 'hourglass-empty' : 'block'}
            size={64}
            color={Colors.white}
          />
        </View>

        {/* Title */}
        <Text style={styles.title}>
          {isPending ? 'Awaiting Approval' : 'Account Suspended'}
        </Text>

        {hotelName ? (
          <Text style={styles.hotelName}>{hotelName}</Text>
        ) : null}

        {/* Status Card */}
        <View style={[styles.statusCard, isPending ? styles.statusCardPending : styles.statusCardSuspended]}>
          <MaterialIcons
            name={isPending ? 'info' : 'warning'}
            size={20}
            color={isPending ? Colors.warning : Colors.danger}
          />
          <Text style={[styles.statusCardText, isPending ? styles.statusTextPending : styles.statusTextSuspended]}>
            {isPending
              ? 'Your registration has been submitted and is currently being reviewed by our team. This typically takes 1–2 business days.'
              : 'Your hotel account has been suspended by the platform admin. Please contact support to resolve this.'}
          </Text>
        </View>

        {/* What to do */}
        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>
            {isPending ? 'What happens next?' : 'What can you do?'}
          </Text>
          {isPending ? (
            <>
              <StepRow icon="search" text="Our team reviews your documents and KYC details" />
              <StepRow icon="check-circle" text="Once approved, you'll be able to log in and use the full app" />
              <StepRow icon="notifications" text="Re-login after approval to access your dashboard" />
            </>
          ) : (
            <>
              <StepRow icon="support-agent" text="Contact our support team to understand the reason" />
              <StepRow icon="edit" text="Make corrections if required and request reactivation" />
              <StepRow icon="check-circle" text="Once resolved, the admin will reactivate your account" />
            </>
          )}
        </View>

        {/* Buttons */}
        <TouchableOpacity
          style={styles.supportBtn}
          onPress={() => navigation.navigate('Support')}
          activeOpacity={0.8}
        >
          <MaterialIcons name="support-agent" size={20} color={Colors.white} />
          <Text style={styles.supportBtnText}>Contact Support</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => navigation.replace('RoleSelect')}
          activeOpacity={0.8}
        >
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
    paddingTop: 80,
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
  iconSuspended: { backgroundColor: Colors.danger },

  title: {
    fontSize: FontSize.title,
    fontWeight: 'bold',
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
  statusCardSuspended: {
    backgroundColor: Colors.danger + '18',
    borderColor: Colors.danger,
  },
  statusCardText: { flex: 1, fontSize: FontSize.md, lineHeight: 22 },
  statusTextPending: { color: Colors.text },
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
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  stepRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  stepText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.md, lineHeight: 22 },

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
  supportBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: 'bold' },

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
