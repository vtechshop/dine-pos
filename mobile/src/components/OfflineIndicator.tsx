import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSync } from '../context/SyncContext';
import { Colors, FontSize, Spacing, BorderRadius } from '../utils/constants';

const formatTime = (date: Date | null): string => {
  if (!date) return 'Never';
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

export const OfflineIndicator: React.FC = () => {
  const { status, pendingCount, failedCount, lastSyncAt, triggerSync } = useSync();

  const isOffline  = status === 'offline';
  const isSyncing  = status === 'syncing';
  const isError    = status === 'error';
  const totalQueue = pendingCount + failedCount;

  // Spinning animation for syncing state
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isSyncing) {
      spinLoop.current?.stop();
      spinLoop.current = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      );
      spinLoop.current.start();
    } else {
      spinLoop.current?.stop();
      spinAnim.setValue(0);
    }
  }, [isSyncing]);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const dotColor  = isOffline ? '#EF4444' : isError ? '#F59E0B' : '#22C55E';
  const dotLabel  = isOffline ? 'Offline' : isSyncing ? 'Syncing…' : isError ? 'Sync Error' : 'Online';

  return (
    <View style={styles.card}>
      {/* Left — connection status */}
      <View style={styles.statusBlock}>
        <View style={[styles.dot, { backgroundColor: dotColor }]}>
          {isSyncing ? (
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <MaterialIcons name="sync" size={10} color="#fff" />
            </Animated.View>
          ) : (
            <View style={[styles.dotInner, { backgroundColor: dotColor === '#22C55E' ? '#86EFAC' : dotColor }]} />
          )}
        </View>
        <Text style={[styles.statusText, { color: dotColor }]}>{dotLabel}</Text>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Center — pending orders */}
      <View style={styles.infoBlock}>
        <Text style={styles.infoLabel}>Pending Orders</Text>
        <Text style={[styles.infoValue, totalQueue > 0 && { color: Colors.warning }]}>
          {totalQueue}
        </Text>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Right — last sync time */}
      <View style={styles.infoBlock}>
        <Text style={styles.infoLabel}>Last Sync</Text>
        <Text style={styles.infoValue}>{formatTime(lastSyncAt)}</Text>
      </View>

      {/* Sync now button — only when online and something to sync */}
      {!isOffline && (
        <TouchableOpacity style={styles.syncBtn} onPress={triggerSync} activeOpacity={0.7}>
          <MaterialIcons name="sync" size={14} color={Colors.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  statusBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 74,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotInner: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#86EFAC',
  },
  statusText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  divider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
  infoBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  infoLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  infoValue: {
    fontSize: FontSize.md,
    fontWeight: '800',
    color: Colors.text,
  },
  syncBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
