import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { AppNotification } from '../types';

type NotifType = AppNotification['type'];

const TYPE_META: Record<NotifType, { icon: keyof typeof MaterialIcons.glyphMap; color: string }> = {
  info:        { icon: 'info-outline',          color: Colors.info },
  warning:     { icon: 'warning',               color: Colors.warning },
  maintenance: { icon: 'build',                 color: Colors.textMuted },
  update:      { icon: 'system-update',         color: Colors.primary },
  success:     { icon: 'check-circle-outline',  color: Colors.success },
};

const fmtAge = (s: string) => {
  const diffMs = Date.now() - new Date(s).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const d = new Date(s);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const NotificationsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { bottom, top } = useSafeAreaInsets();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount]     = useState(0);
  const [loading, setLoading]             = useState(true);
  const [markingAll, setMarkingAll]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { notifications: n, unreadCount: u } = await api.getNotifications();
      setNotifications(n);
      setUnreadCount(u);
    } catch { /* silently degrade */ }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleMarkRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* silently degrade */ }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch { /* silently degrade */ }
    finally { setMarkingAll(false); }
  };

  const renderItem = ({ item }: { item: AppNotification }) => {
    const meta = TYPE_META[item.type] ?? TYPE_META.info;
    return (
      <TouchableOpacity
        style={[styles.row, !item.isRead && styles.rowUnread]}
        onPress={() => { if (!item.isRead) handleMarkRead(item._id); }}
        activeOpacity={item.isRead ? 1 : 0.8}
      >
        <View style={[styles.iconWrap, { backgroundColor: meta.color + '1A' }]}>
          <MaterialIcons name={meta.icon} size={22} color={meta.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, !item.isRead && styles.rowTitleUnread]}>{item.title}</Text>
          <Text style={styles.rowMessage} numberOfLines={3}>{item.message}</Text>
          <Text style={styles.rowTime}>{fmtAge(item.createdAt)}</Text>
        </View>
        {!item.isRead && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: bottom }]}>
      <View style={[styles.header, { paddingTop: top + Spacing.sm }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => (navigation as any).goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={styles.headerRight}>
          {unreadCount > 0 && (
            markingAll
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : (
                <TouchableOpacity onPress={handleMarkAllRead}>
                  <Text style={styles.markAllText}>Mark all read</Text>
                </TouchableOpacity>
              )
          )}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={notifications}
          renderItem={renderItem}
          keyExtractor={n => n._id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <MaterialIcons name="notifications-none" size={52} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No notifications</Text>
              <Text style={styles.emptySub}>You're all caught up</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn:     { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, flex: 1, textAlign: 'center' },
  headerRight: { width: 90, alignItems: 'flex-end' },
  markAllText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },

  list: { padding: Spacing.md },

  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, ...Shadows.sm,
  },
  rowUnread:      { borderColor: Colors.primary + '40', backgroundColor: Colors.primaryBg },
  iconWrap:       { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowTitle:       { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, marginBottom: 2 },
  rowTitleUnread: { fontWeight: '800' },
  rowMessage:     { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 18 },
  rowTime:        { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  unreadDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, alignSelf: 'flex-start', marginTop: 6, flexShrink: 0 },

  emptyWrap:  { alignItems: 'center', paddingTop: 80, gap: Spacing.md },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub:   { fontSize: FontSize.sm, color: Colors.textMuted },
});

export default NotificationsScreen;
