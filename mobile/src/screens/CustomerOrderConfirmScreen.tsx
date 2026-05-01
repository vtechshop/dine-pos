import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useSettings } from '../context/SettingsContext';
import { Colors, FontSize, Spacing, BorderRadius, UPI_ID, UPI_NAME } from '../utils/constants';
import QRCode from 'react-native-qrcode-svg';

type Props = NativeStackScreenProps<RootStackParamList, 'CustomerOrderConfirm'>;

const CustomerOrderConfirmScreen: React.FC<Props> = ({ navigation, route }) => {

  const { orderNumber, grandTotal, paymentMethod } = route.params;
  const { settings } = useSettings();

  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [paymentDone, setPaymentDone] = useState(false);

  const isUPI = paymentMethod === 'upi';

  const activeUpiId = settings.upiId || UPI_ID;
  const upiLink = `upi://pay?pa=${activeUpiId}&pn=${encodeURIComponent(settings.hotelName || UPI_NAME)}&am=${grandTotal.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Order ' + orderNumber)}`;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 50,
      friction: 6,
      useNativeDriver: true,
    }).start();

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      delay: 300,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => {
      navigation.reset({ index: 0, routes: [{ name: 'CustomerTabs' }] });
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  const goBack = () => {

    navigation.reset({
      index: 0,
      routes: [{ name: 'CustomerTabs' }],
    });

  };

  return (

    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >

      {/* CHECK ICON */}

      {(!isUPI || paymentDone) && (
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <View style={styles.checkCircle}>
            <MaterialIcons name="check-circle" size={80} color={Colors.success} />
          </View>
        </Animated.View>
      )}

      <Animated.View style={[styles.infoSection, { opacity: fadeAnim }]}>

        {/* TITLE */}

        {!isUPI && (
          <>
            <Text style={styles.title}>Order Placed!</Text>
            <Text style={styles.subtitle}>Your order is being prepared</Text>
          </>
        )}

        {isUPI && !paymentDone && (
          <>
            <Text style={styles.title}>Scan & Pay</Text>
            <Text style={styles.subtitle}>Complete payment using UPI</Text>
          </>
        )}

        {isUPI && paymentDone && (
          <>
            <Text style={styles.title}>Payment Successful</Text>
            <Text style={styles.subtitle}>Your order is being prepared</Text>
          </>
        )}

        {/* ORDER CARD */}

        <View style={styles.orderCard}>

          <Text style={styles.orderLabel}>Order Number</Text>
          <Text style={styles.orderNumber}>{orderNumber}</Text>

          <View style={styles.divider} />

          <Text style={styles.orderLabel}>Total Amount</Text>
          <Text style={styles.orderTotal}>
            {settings.currencySymbol}{grandTotal.toFixed(0)}
          </Text>

        </View>

        {/* UPI QR */}

        {isUPI && !paymentDone && (

          <View style={styles.qrSection}>

            <Text style={styles.qrTitle}>Scan to Pay</Text>
            <Text style={styles.qrSubtitle}>Open any UPI app and scan</Text>

            <View style={styles.qrContainer}>
              <QRCode
                value={upiLink}
                size={200}
                backgroundColor="white"
                color="black"
              />
            </View>

            <Text style={styles.upiAmount}>
              {settings.currencySymbol}{grandTotal.toFixed(0)}
            </Text>

            <Text style={styles.upiId}>UPI: {activeUpiId}</Text>

            <Text style={styles.waitText}>
              After payment click below
            </Text>

            <TouchableOpacity
              style={styles.payDoneBtn}
              onPress={() => setPaymentDone(true)}
            >
              <Text style={styles.payDoneText}>Payment Done</Text>
            </TouchableOpacity>

          </View>

        )}

        {/* SUCCESS AFTER PAYMENT */}

        {isUPI && paymentDone && (

          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <MaterialIcons name="home" size={22} color={Colors.white} />
            <Text style={styles.backBtnText}>Done</Text>
          </TouchableOpacity>

        )}

        {!isUPI && (

          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <MaterialIcons name="home" size={22} color={Colors.white} />
            <Text style={styles.backBtnText}>Done</Text>
          </TouchableOpacity>

        )}

      </Animated.View>

    </ScrollView>

  );

};

const styles = StyleSheet.create({

  container: {
    flexGrow: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },

  checkCircle: {
    marginBottom: Spacing.lg,
  },

  infoSection: {
    alignItems: 'center',
    width: '100%',
  },

  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.success,
    marginBottom: Spacing.xs,
  },

  subtitle: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginBottom: Spacing.xl,
  },

  orderCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.lg,
  },

  orderLabel: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  orderNumber: {
    fontSize: FontSize.xxl,
    fontWeight: 'bold',
    color: Colors.primary,
    marginBottom: Spacing.md,
  },

  divider: {
    width: '60%',
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.md,
  },

  orderTotal: {
    fontSize: 32,
    fontWeight: 'bold',
    color: Colors.white,
  },

  qrSection: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#9C27B0',
    marginBottom: Spacing.lg,
  },

  qrTitle: {
    fontSize: FontSize.xl,
    fontWeight: 'bold',
    color: '#9C27B0',
  },

  qrSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.lg,
  },

  qrContainer: {
    backgroundColor: 'white',
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
  },

  upiAmount: {
    fontSize: FontSize.xxl,
    fontWeight: 'bold',
    color: Colors.white,
  },

  upiId: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.md,
  },

  waitText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },

  payDoneBtn: {
    backgroundColor: '#FF7A45',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxl,
    borderRadius: BorderRadius.lg,
  },

  payDoneText: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: 'bold',
  },

  backBtn: {
    flexDirection: 'row',
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xxl,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    gap: Spacing.sm,
  },

  backBtnText: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: 'bold',
  },

});

export default CustomerOrderConfirmScreen;