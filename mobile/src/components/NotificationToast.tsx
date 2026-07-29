import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGlobalToast, useToastState } from '../context/GlobalToastContext';
import { Colors } from '../utils/constants';

const ACCENT: Record<string, string> = {
  info:    Colors.info,
  success: Colors.success,
  warning: Colors.warning,
  error:   Colors.danger,
};

export function NotificationToast() {
  const toast          = useToastState();
  const { dismissToast } = useGlobalToast();
  const { top }        = useSafeAreaInsets();
  const slideY         = useRef(new Animated.Value(-120)).current;

  useEffect(() => {
    Animated.spring(slideY, {
      toValue: toast ? 0 : -120,
      useNativeDriver: true,
      tension: 80,
      friction: 9,
    }).start();
  }, [toast]);

  const accent = ACCENT[toast?.severity ?? 'info'];

  return (
    <Animated.View
      style={[styles.wrapper, { top: top + 8 }, { transform: [{ translateY: slideY }] }]}
      pointerEvents={toast ? 'box-none' : 'none'}
    >
      {toast && (
        <TouchableOpacity
          style={[styles.banner, { borderLeftColor: accent }]}
          onPress={dismissToast}
          activeOpacity={0.9}
        >
          <View style={[styles.iconWrap, { backgroundColor: accent + '22' }]}>
            <MaterialIcons name={toast.icon as any} size={20} color={accent} />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.title}>{toast.title}</Text>
            {!!toast.body && (
              <Text style={styles.body} numberOfLines={2}>{toast.body}</Text>
            )}
          </View>
          <MaterialIcons name="close" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
  },
  banner: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderLeftWidth: 4,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textWrap: { flex: 1 },
  title: { fontSize: 14, fontWeight: '800', color: Colors.text },
  body:  { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
});
