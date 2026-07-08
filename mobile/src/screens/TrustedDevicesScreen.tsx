import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { showAlert } from '../utils/alert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Colors, Spacing, FontSize, BorderRadius } from '../utils/constants';
import { getMyDevices, logoutDevice, logoutAllDevices, deleteDevice } from '../services/api';
import { Device } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@dine_device_id';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  1) return 'Just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function platformIcon(platform: Device['platform']): keyof typeof MaterialIcons.glyphMap {
  if (platform === 'ios')  return 'phone-iphone';
  if (platform === 'web')  return 'computer';
  return 'phone-android';
}

const TrustedDevicesScreen: React.FC = () => {
  const navigation = useNavigation();
  const { bottom } = useSafeAreaInsets();

  const [devices,     setDevices]     = useState<Device[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [currentId,   setCurrentId]   = useState<string | null>(null);
  const [busyId,      setBusyId]      = useState<string | null>(null);
  const [busyAll,     setBusyAll]     = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [list, storedId] = await Promise.all([
        getMyDevices(),
        AsyncStorage.getItem(DEVICE_ID_KEY),
      ]);
      setDevices(list);
      setCurrentId(storedId);
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to load devices');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleLogoutDevice = (device: Device) => {
    showAlert(
      'Logout Device',
      `Remove "${device.deviceName}" from trusted devices? It will need to login again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            setBusyId(device._id);
            try {
              await logoutDevice(device._id);
              setDevices(prev => prev.map(d => d._id === device._id ? { ...d, isOnline: false } : d));
            } catch (e: any) {
              showAlert('Error', e.message || 'Failed to logout device');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  const handleDeleteDevice = (device: Device) => {
    showAlert(
      'Remove Device',
      `Permanently remove "${device.deviceName}" from the device list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusyId(device._id);
            try {
              await deleteDevice(device._id);
              setDevices(prev => prev.filter(d => d._id !== device._id));
            } catch (e: any) {
              showAlert('Error', e.message || 'Failed to remove device');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  const handleLogoutAll = () => {
    showAlert(
      'Logout All Devices',
      'This will log out all devices including this one. You will need to login again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout All',
          style: 'destructive',
          onPress: async () => {
            setBusyAll(true);
            try {
              await logoutAllDevices();
              setDevices(prev => prev.map(d => ({ ...d, isOnline: false })));
              showAlert('Done', 'All device sessions have been revoked.');
            } catch (e: any) {
              showAlert('Error', e.message || 'Failed to logout all devices');
            } finally {
              setBusyAll(false);
            }
          },
        },
      ]
    );
  };

  const activeDevices  = devices.filter(d => (d as any).isActive !== false);
  const inactiveDevices = devices.filter(d => (d as any).isActive === false);

  const renderDevice = (device: Device) => {
    const isCurrent = device.deviceId === currentId;
    const isOnline  = device.isOnline;
    const isBusy    = busyId === device._id;

    return (
      <View key={device._id} style={[styles.deviceCard, isCurrent && styles.deviceCardCurrent]}>
        <View style={styles.deviceIconWrap}>
          <MaterialIcons name={platformIcon(device.platform)} size={28} color={isCurrent ? Colors.primary : Colors.textSecondary} />
        </View>

        <View style={{ flex: 1 }}>
          <View style={styles.deviceNameRow}>
            <Text style={styles.deviceName} numberOfLines={1}>{device.deviceName}</Text>
            {isCurrent && (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>THIS DEVICE</Text>
              </View>
            )}
          </View>

          <Text style={styles.deviceMeta}>
            {device.platform.charAt(0).toUpperCase() + device.platform.slice(1)}
            {device.appVersion ? `  ·  v${device.appVersion}` : ''}
          </Text>

          <View style={styles.deviceStatusRow}>
            <View style={[styles.statusDot, { backgroundColor: isOnline ? Colors.success : Colors.textMuted }]} />
            <Text style={[styles.deviceStatus, { color: isOnline ? Colors.success : Colors.textMuted }]}>
              {isOnline ? 'Online' : `Last seen ${timeAgo(device.lastSeen)}`}
            </Text>
          </View>
        </View>

        {!isCurrent && (
          <View style={styles.deviceActions}>
            <TouchableOpacity
              style={styles.actionIconBtn}
              onPress={() => handleLogoutDevice(device)}
              disabled={isBusy}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color={Colors.warning} />
              ) : (
                <MaterialIcons name="logout" size={20} color={Colors.warning} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionIconBtn}
              onPress={() => handleDeleteDevice(device)}
              disabled={isBusy}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color={Colors.danger} />
              ) : (
                <MaterialIcons name="delete-outline" size={20} color={Colors.danger} />
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Trusted Devices</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.xxl * 2 + bottom }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[Colors.primary]} />}
        >
          {/* Info banner */}
          <View style={styles.infoBanner}>
            <MaterialIcons name="info-outline" size={18} color={Colors.info} />
            <Text style={styles.infoText}>
              Devices that have logged in with "Remember this device" enabled. Remove a device to force it to login again.
            </Text>
          </View>

          {/* Active devices */}
          {activeDevices.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>ACTIVE DEVICES ({activeDevices.length})</Text>
              {activeDevices.map(renderDevice)}
            </>
          ) : (
            <View style={styles.emptyWrap}>
              <MaterialIcons name="devices" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No trusted devices found</Text>
              <Text style={styles.emptySub}>Login with "Remember this device" enabled to register a device.</Text>
            </View>
          )}

          {/* Inactive / historical devices */}
          {inactiveDevices.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: Spacing.xl }]}>INACTIVE DEVICES</Text>
              {inactiveDevices.map(renderDevice)}
            </>
          )}

          {/* Logout all button */}
          {activeDevices.length > 1 && (
            <TouchableOpacity
              style={styles.logoutAllBtn}
              onPress={handleLogoutAll}
              disabled={busyAll}
              activeOpacity={0.7}
            >
              {busyAll ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <>
                  <MaterialIcons name="logout" size={20} color={Colors.white} />
                  <Text style={styles.logoutAllText}>Logout All Other Devices</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },

  scrollContent: { padding: Spacing.lg },

  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.infoBg,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.info + '30',
  },
  infoText: { flex: 1, fontSize: FontSize.sm, color: Colors.info, lineHeight: 18 },

  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 1,
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },

  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  deviceCardCurrent: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryBg,
  },

  deviceIconWrap: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },

  deviceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  deviceName: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  currentBadge: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  currentBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: 0.5,
  },

  deviceMeta: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },

  deviceStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  deviceStatus: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },

  deviceActions: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  actionIconBtn: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },

  emptyWrap: {
    alignItems: 'center',
    paddingVertical: Spacing.xxxl,
    gap: Spacing.sm,
  },
  emptyText: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textSecondary },
  emptySub:  { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },

  logoutAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.danger,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    marginTop: Spacing.xl,
  },
  logoutAllText: {
    color: Colors.white,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
});

export default TrustedDevicesScreen;
