import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, StatusBar } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Colors, FontSize, Spacing } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

const SplashScreen: React.FC<Props> = ({ navigation }) => {
  const ring1     = useRef(new Animated.Value(0.5)).current;
  const ring2     = useRef(new Animated.Value(0.8)).current;
  const logoScale = useRef(new Animated.Value(0)).current;
  const logoOp    = useRef(new Animated.Value(0)).current;
  const titleY    = useRef(new Animated.Value(20)).current;
  const titleOp   = useRef(new Animated.Value(0)).current;
  const tagOp     = useRef(new Animated.Value(0)).current;
  const barW      = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ring1, { toValue: 1.4, duration: 1100, useNativeDriver: true }),
          Animated.timing(ring2, { toValue: 1.1, duration: 1100, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(ring1, { toValue: 0.5, duration: 1100, useNativeDriver: true }),
          Animated.timing(ring2, { toValue: 0.8, duration: 1100, useNativeDriver: true }),
        ]),
      ])
    );
    pulse.start();

    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, tension: 55, friction: 7, useNativeDriver: true }),
      Animated.timing(logoOp, { toValue: 1, duration: 450, useNativeDriver: true }),
    ]).start();

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(titleY, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(titleOp, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();
    }, 300);

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(tagOp, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(barW, { toValue: 1, duration: 1000, useNativeDriver: false }),
      ]).start();
    }, 650);

    const t = setTimeout(() => { pulse.stop(); navigation.replace('RoleSelect'); }, 2600);
    return () => { clearTimeout(t); pulse.stop(); };
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Decorative circles */}
      <View style={styles.topBlob} />
      <View style={styles.bottomBlob} />

      {/* Pulsing rings */}
      <Animated.View style={[styles.ring, { transform: [{ scale: ring1 }], opacity: ring1.interpolate({ inputRange: [0.5, 1.4], outputRange: [0.2, 0] }) }]} />
      <Animated.View style={[styles.ring, styles.ring2, { transform: [{ scale: ring2 }], opacity: ring2.interpolate({ inputRange: [0.8, 1.1], outputRange: [0.15, 0] }) }]} />

      {/* Logo */}
      <Animated.View style={[styles.logoWrap, { transform: [{ scale: logoScale }], opacity: logoOp }]}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoEmoji}>🍽️</Text>
        </View>
      </Animated.View>

      {/* Brand name */}
      <Animated.View style={{ transform: [{ translateY: titleY }], opacity: titleOp, alignItems: 'center' }}>
        <Text style={styles.brand}>
          <Text style={{ color: Colors.primary }}>Dine</Text>
          <Text style={{ color: Colors.accent }}> POS</Text>
        </Text>
      </Animated.View>

      <Animated.Text style={[styles.tagline, { opacity: tagOp }]}>
        FAST · SMART · RELIABLE
      </Animated.Text>

      {/* Loading bar */}
      <Animated.View style={[styles.barTrack, { opacity: tagOp }]}>
        <Animated.View style={[styles.barFill, { width: barW.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
      </Animated.View>
    </View>
  );
};

const RING = 200;
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  topBlob: { position: 'absolute', top: -80, right: -60, width: 240, height: 240, borderRadius: 120, backgroundColor: Colors.primaryBg, opacity: 0.7 },
  bottomBlob: { position: 'absolute', bottom: -60, left: -80, width: 200, height: 200, borderRadius: 100, backgroundColor: Colors.accentBg, opacity: 0.7 },
  ring: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: 2.5, borderColor: Colors.primary },
  ring2: { borderColor: Colors.accent },
  logoWrap: { marginBottom: Spacing.xxl },
  logoCircle: {
    width: 114, height: 114, borderRadius: 57,
    backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: Colors.primary,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 12,
  },
  logoEmoji: { fontSize: 52 },
  brand: { fontSize: FontSize.title, fontWeight: '900', letterSpacing: 1.5 },
  tagline: { fontSize: FontSize.xs, color: Colors.textSecondary, letterSpacing: 4, marginTop: Spacing.md, fontWeight: '700' },
  barTrack: { position: 'absolute', bottom: 60, width: 140, height: 3, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 2 },
});

export default SplashScreen;
