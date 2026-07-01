import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSync } from '../context/SyncContext';
import { Colors, FontSize, Spacing, BorderRadius } from '../utils/constants';

const STATUS_CONFIG = {
  offline:  { bg: '#374151', dot: '#9CA3AF', label: 'Offline',  icon: 'cloud-off'    as const },
  online:   { bg: '#065F46', dot: '#10B981', label: 'Online',   icon: 'cloud-done'   as const },
  syncing:  { bg: '#92400E', dot: '#F59E0B', label: 'Syncing…', icon: 'sync'         as const },
  synced:   { bg: '#065F46', dot: '#34D399', label: 'Synced',   icon: 'check-circle' as const },
  error:    { bg: '#7F1D1D', dot: '#EF4444', label: 'Sync Error', icon: 'warning'    as const },
} as const;

export const SyncStatusBar: React.FC = () => {
  const { status, pendingCount, failedCount, lastSyncAt, syncError, triggerSync, resetFailed } = useSync();
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinRef  = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (status === 'syncing') {
      spinRef.current?.stop();
      spinRef.current = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      );
      spinRef.current.start();
    } else {
      spinRef.current?.stop();
      spinAnim.setValue(0);
    }
  }, [status]);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const cfg = STATUS_CONFIG[status];
  const hasQueue = pendingCount > 0 || failedCount > 0;

  const relativeTime = (): string => {
    if (!lastSyncAt) return 'Never';
    const secs = Math.floor((Date.now() - lastSyncAt.getTime()) / 1000);
    if (secs < 60) return 'Just now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
  };

  return (
    <View style={[styles.bar, { backgroundColor: cfg.bg }]}>
      {/* Status dot + label */}
      <View style={styles.left}>
        <Animated.View style={status === 'syncing' ? { transform: [{ rotate: spin }] } : undefined}>
          <MaterialIcons name={cfg.icon} size={14} color={cfg.dot} />
        </Animated.View>
        <Text style={[styles.label, { color: cfg.dot }]}>{cfg.label}</Text>
        {status === 'offline' && hasQueue && (
          <Text style={styles.badge}>{pendingCount + failedCount} pending</Text>
        )}
        {status === 'error' && syncError && (
          <Text style={styles.errorText} numberOfLines={1}>{syncError}</Text>
        )}
      </View>

      {/* Right side info + buttons */}
      <View style={styles.right}>
        {status === 'online' && lastSyncAt && (
          <Text style={styles.timeLabel}>{relativeTime()}</Text>
        )}
        {status === 'error' && failedCount > 0 && (
          <TouchableOpacity style={styles.btn} onPress={resetFailed}>
            <Text style={styles.btnText}>Reset</Text>
          </TouchableOpacity>
        )}
        {(status === 'online' || status === 'error') && (
          <TouchableOpacity style={styles.btn} onPress={triggerSync}>
            <MaterialIcons name="sync" size={12} color="#fff" />
            <Text style={styles.btnText}>Sync Now</Text>
          </TouchableOpacity>
        )}
        {status === 'online' && pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>{pendingCount}</Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 5,
  },
  left:   { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  right:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label:  { fontSize: 11, fontWeight: '700' },
  badge:  { fontSize: 10, color: '#FCD34D', fontWeight: '600', marginLeft: 4 },
  errorText: { fontSize: 10, color: '#FCA5A5', flex: 1 },
  timeLabel: { fontSize: 10, color: 'rgba(255,255,255,0.6)' },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: BorderRadius.round,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  btnText: { fontSize: 10, color: '#fff', fontWeight: '700' },
  pendingBadge: {
    backgroundColor: '#F59E0B', borderRadius: 8, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  pendingText: { fontSize: 9, color: '#000', fontWeight: '800' },
});
