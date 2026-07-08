import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  TextInput, ActivityIndicator, StatusBar, Modal, ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Hotel, SuperAdminStats, AppNotification, Device, RemoteConfig, FeatureFlags } from '../types';
import { showAlert } from '../utils/alert';
import { getSuperAdminStats, getAllHotels, approveHotel, approveHotelWithCredentials, rejectHotel, suspendHotel, activateHotel, getAllTickets, adminReplyTicket, updateTicketStatus, getBranchRevenue, setHotelPremium, Ticket, getBroadcastNotifications, createBroadcastNotification, deleteBroadcastNotification, getAllDevices, getSystemHealth, getRemoteConfigAdmin, updateRemoteConfig, startHotelTrial, expireHotel, updateHotelFeatures, extendTrialDays, convertToPaidPlan } from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius } from '../utils/constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = NativeStackScreenProps<RootStackParamList, 'SuperAdminDashboard'>;

type TabView = 'hotels' | 'tickets' | 'revenue' | 'notifications' | 'devices' | 'config';
type StatusFilter = 'all' | 'pending' | 'trial' | 'active' | 'expired' | 'suspended' | 'rejected';
type TicketFilter = 'all' | 'open' | 'in-progress' | 'resolved' | 'closed';

const TICKET_STATUS_COLORS: Record<string, string> = {
  open: Colors.warning,
  'in-progress': Colors.info,
  resolved: Colors.success,
  closed: '#9E9E9E',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: Colors.success,
  medium: Colors.warning,
  high: Colors.danger,
};

const STATUS_COLORS: Record<string, string> = {
  pending: Colors.warning,
  trial: Colors.accent,
  active: Colors.success,
  expired: '#9E9E9E',
  suspended: Colors.danger,
  rejected: '#B71C1C',
};

const STATUS_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  pending: 'hourglass-empty',
  trial: 'timer',
  active: 'check-circle',
  expired: 'timer-off',
  suspended: 'block',
  rejected: 'cancel',
};

const SuperAdminDashboardScreen: React.FC<Props> = ({ navigation }) => {
  const { bottom } = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabView>('hotels');
  const [stats, setStats] = useState<SuperAdminStats | null>(null);
  const [hotels, setHotels]             = useState<Hotel[]>([]);
  const [hotelPage, setHotelPage]       = useState(1);
  const [hotelTotalPages, setHotelTotalPages] = useState(1);
  const [hotelLoadingMore, setHotelLoadingMore] = useState(false);
  const [branchRevenue, setBranchRevenue] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedHotel, setSelectedHotel] = useState<Hotel | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [newAdminId, setNewAdminId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // New approval modal state
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approveTrialDays, setApproveTrialDays] = useState(14);
  const [approveFeatures, setApproveFeatures] = useState<Partial<FeatureFlags>>({
    reservations: true, customerChat: true, qrOrdering: true,
    expenses: true, reports: true, tables: true,
    payment: false, ingredients: false, waste: false, aggregator: false,
  });
  const [showCredentialResult, setShowCredentialResult] = useState(false);
  const [generatedCredentials, setGeneratedCredentials] = useState<{ adminId: string; password: string; kitchenPin: string } | null>(null);

  // Extend trial modal
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extendDays, setExtendDays] = useState(7);

  // Convert to paid plan modal
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertPlan, setConvertPlan] = useState<'starter' | 'professional' | 'enterprise'>('starter');
  const [convertDuration, setConvertDuration] = useState(30);

  // Tickets
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>('all');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [showTicketDetail, setShowTicketDetail] = useState(false);
  const [adminReply, setAdminReply] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [newNotifTitle, setNewNotifTitle] = useState('');
  const [newNotifMsg, setNewNotifMsg]     = useState('');
  const [notifLoading, setNotifLoading]   = useState(false);

  // Devices
  const [devices, setDevices] = useState<Device[]>([]);

  // Remote Config
  const [remoteConfig, setRemoteConfig]   = useState<RemoteConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [editConfig, setEditConfig]       = useState<Partial<RemoteConfig>>({});

  // Health
  const [health, setHealth] = useState<{ mongo: { stateLabel: string }; totalDevices: number; onlineDevices: number } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [statsData, hotelsResult, ticketsData, notifsData, devicesData, healthData] = await Promise.all([
        getSuperAdminStats(),
        getAllHotels(filterStatus === 'all' ? undefined : filterStatus, search || undefined, 1),
        getAllTickets(ticketFilter === 'all' ? undefined : ticketFilter),
        getBroadcastNotifications().catch(() => [] as AppNotification[]),
        getAllDevices().catch(() => [] as Device[]),
        getSystemHealth().catch(() => null),
      ]);
      setStats(statsData);
      setHotels(hotelsResult.hotels);
      setHotelPage(1);
      setHotelTotalPages(hotelsResult.pages);
      setTickets(ticketsData);
      setNotifications(notifsData);
      setDevices(devicesData);
      setHealth(healthData);
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterStatus, search, ticketFilter]);

  const loadMoreHotels = useCallback(async () => {
    if (hotelLoadingMore || hotelPage >= hotelTotalPages) return;
    setHotelLoadingMore(true);
    try {
      const next = hotelPage + 1;
      const result = await getAllHotels(
        filterStatus === 'all' ? undefined : filterStatus,
        search || undefined,
        next,
      );
      setHotels(prev => [...prev, ...result.hotels]);
      setHotelPage(next);
      setHotelTotalPages(result.pages);
    } catch { /* silent: network error on scroll shouldn't disrupt the list */ }
    finally { setHotelLoadingMore(false); }
  }, [hotelPage, hotelTotalPages, hotelLoadingMore, filterStatus, search]);

  const handleAdminReply = async () => {
    if (!selectedTicket || !adminReply.trim()) return;
    setReplyLoading(true);
    try {
      const updated = await adminReplyTicket(selectedTicket._id, adminReply.trim());
      setSelectedTicket(updated);
      setAdminReply('');
      loadData();
    } catch (error: any) {
      showAlert('Error', error.message);
    } finally {
      setReplyLoading(false);
    }
  };

  const handleTicketStatus = async (status: string) => {
    if (!selectedTicket) return;
    try {
      const updated = await updateTicketStatus(selectedTicket._id, status);
      setSelectedTicket(updated);
      loadData();
    } catch (error: any) {
      showAlert('Error', error.message);
    }
  };

  useEffect(() => { loadData(); }, [loadData]);

  const handleApprove = (hotel: Hotel) => {
    setSelectedHotel(hotel);
    setApproveTrialDays(14);
    setApproveFeatures({
      reservations: true, customerChat: true, qrOrdering: true,
      expenses: true, reports: true, tables: true,
      payment: false, ingredients: false, waste: false, aggregator: false,
    });
    setShowApproveModal(true);
  };

  const handleApproveSubmit = async () => {
    if (!selectedHotel) return;
    setActionLoading(true);
    try {
      const result = await approveHotel(selectedHotel._id, approveTrialDays, approveFeatures);
      setGeneratedCredentials(result.credentials);
      setShowApproveModal(false);
      setShowCredentialResult(true);
      setShowDetail(false);
      loadData();
    } catch (error: any) {
      showAlert('Error', error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveWithCredentials = async () => {
    if (!selectedHotel) return;
    if (!newAdminId.trim() || newAdminId.trim().length < 4) {
      showAlert('Invalid', 'Admin ID must be at least 4 characters');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      showAlert('Invalid', 'Password must be at least 6 characters');
      return;
    }
    setActionLoading(true);
    try {
      await approveHotelWithCredentials(selectedHotel._id, newAdminId.trim(), newPassword);
      showAlert(
        'Credentials Updated!',
        `${selectedHotel.hotelName} credentials updated.\n\nAdmin ID: ${newAdminId.trim()}\nPassword: ${newPassword}\n\nShare these with the hotel owner.`
      );
      setShowCredentialsModal(false);
      loadData();
    } catch (error: any) {
      showAlert('Error', error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selectedHotel) return;
    if (!rejectReason.trim()) {
      showAlert('Required', 'Please enter rejection reason');
      return;
    }
    setActionLoading(true);
    try {
      await rejectHotel(selectedHotel._id, rejectReason.trim());
      showAlert('Done', `${selectedHotel.hotelName} rejected`);
      setShowRejectModal(false);
      setShowDetail(false);
      setRejectReason('');
      loadData();
    } catch (error: any) {
      showAlert('Error', error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuspend = async (hotel: Hotel) => {
    showAlert('Confirm', `Suspend ${hotel.hotelName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Suspend', style: 'destructive', onPress: async () => {
          setActionLoading(true);
          try {
            await suspendHotel(hotel._id);
            showAlert('Done', `${hotel.hotelName} suspended`);
            setShowDetail(false);
            loadData();
          } catch (error: any) {
            showAlert('Error', error.message);
          } finally {
            setActionLoading(false);
          }
        },
      },
    ]);
  };

  const handleActivate = async (hotel: Hotel) => {
    setActionLoading(true);
    try {
      await activateHotel(hotel._id);
      showAlert('Success', `${hotel.hotelName} activated!`);
      setShowDetail(false);
      loadData();
    } catch (error: any) {
      showAlert('Error', error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartTrial = async (hotel: Hotel) => {
    showAlert('Start Trial', `Start a 14-day trial for ${hotel.hotelName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Start Trial', onPress: async () => {
          setActionLoading(true);
          try {
            await startHotelTrial(hotel._id, 14);
            showAlert('Done', 'Trial started!');
            setShowDetail(false);
            loadData();
          } catch (e: any) {
            showAlert('Error', e.message);
          } finally { setActionLoading(false); }
        },
      },
    ]);
  };

  const openExtendModal = (hotel: Hotel) => {
    setSelectedHotel(hotel);
    setExtendDays(7);
    setShowExtendModal(true);
  };

  const handleExtendSubmit = async () => {
    if (!selectedHotel) return;
    setActionLoading(true);
    try {
      await extendTrialDays(selectedHotel._id, extendDays);
      setShowExtendModal(false);
      loadData();
      showAlert('Done', `Trial extended by ${extendDays} days!`);
    } catch (e: any) {
      showAlert('Error', e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const openConvertModal = (hotel: Hotel) => {
    setSelectedHotel(hotel);
    setConvertPlan('starter');
    setConvertDuration(30);
    setShowConvertModal(true);
  };

  const handleConvertSubmit = async () => {
    if (!selectedHotel) return;
    setActionLoading(true);
    try {
      await convertToPaidPlan(selectedHotel._id, convertPlan, convertDuration);
      setShowConvertModal(false);
      setShowDetail(false);
      loadData();
      showAlert('Done', `${selectedHotel.hotelName} converted to ${convertPlan} plan!`);
    } catch (e: any) {
      showAlert('Error', e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleExpire = async (hotel: Hotel) => {
    showAlert('Expire', `Force-expire ${hotel.hotelName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Expire', style: 'destructive', onPress: async () => {
          setActionLoading(true);
          try {
            await expireHotel(hotel._id);
            showAlert('Done', `${hotel.hotelName} expired`);
            setShowDetail(false);
            loadData();
          } catch (e: any) {
            showAlert('Error', e.message);
          } finally { setActionLoading(false); }
        },
      },
    ]);
  };

  const handlePremiumToggle = async (hotel: Hotel) => {
    const currentlyPremium = hotel.isPremium;
    const action = currentlyPremium ? 'Remove Premium' : 'Set Premium';
    showAlert(action, `${action} for ${hotel.hotelName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: currentlyPremium ? 'Remove' : 'Activate',
        onPress: async () => {
          setActionLoading(true);
          try {
            if (currentlyPremium) {
              await setHotelPremium(hotel._id, false);
            } else {
              const expiry = new Date();
              expiry.setFullYear(expiry.getFullYear() + 1);
              await setHotelPremium(hotel._id, true, 'pro', expiry.toISOString());
            }
            showAlert('Done', `${hotel.hotelName} plan updated!`);
            setShowDetail(false);
            loadData();
          } catch (e: any) {
            showAlert('Error', e.message);
          } finally {
            setActionLoading(false);
          }
        },
      },
    ]);
  };

  const renderStatCard = (label: string, value: number, color: string, icon: keyof typeof MaterialIcons.glyphMap) => (
    <View style={[styles.statCard, { borderTopColor: color }]}>
      <MaterialIcons name={icon} size={14} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  const renderHotelCard = ({ item }: { item: Hotel }) => {
    let subBadge: string | null = null;
    let subBadgeColor = Colors.success;
    if (item.status === 'trial') {
      const endStr = item.subscriptionEndDate || item.trialEndDate;
      if (endStr) {
        const daysLeft = Math.ceil((new Date(endStr).getTime() - Date.now()) / 86400000);
        subBadge = `${daysLeft}d left`;
        subBadgeColor = daysLeft <= 3 ? Colors.danger : daysLeft <= 7 ? Colors.warning : Colors.success;
      }
    } else if (item.status === 'active' && item.subscriptionType && item.subscriptionType !== 'trial') {
      const planLabel: Record<string, string> = { starter: 'Starter', professional: 'Pro', enterprise: 'Ent' };
      subBadge = planLabel[item.subscriptionType] || item.subscriptionType;
      subBadgeColor = Colors.info;
    }

    return (
      <TouchableOpacity
        style={styles.hotelCard}
        onPress={() => { setSelectedHotel(item); setShowDetail(true); }}
        activeOpacity={0.8}
      >
        <View style={styles.hotelCardLeft}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[item.status] }]} />
          <View style={styles.hotelCardInfo}>
            <Text style={styles.hotelName} numberOfLines={1}>{item.hotelName}</Text>
            <Text style={styles.hotelOwner}>{item.ownerName} • {item.phone}</Text>
            <Text style={styles.hotelCity}>{item.city}, {item.state}</Text>
          </View>
        </View>
        <View style={styles.hotelCardRight}>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] + '22', borderColor: STATUS_COLORS[item.status] }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
          {subBadge && (
            <View style={[styles.statusBadge, { backgroundColor: subBadgeColor + '22', borderColor: subBadgeColor }]}>
              <Text style={[styles.statusText, { color: subBadgeColor }]}>{subBadge}</Text>
            </View>
          )}
          <Text style={styles.hotelDate}>
            {new Date(item.createdAt).toLocaleDateString('en-IN')}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderDetailModal = () => {
    if (!selectedHotel) return null;
    const hotel = selectedHotel;

    return (
      <>
      <Modal visible={showDetail} animationType="slide" onRequestClose={() => setShowDetail(false)}>
        <View style={styles.detailContainer}>
          <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

          {/* Detail Header */}
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setShowDetail(false)}>
              <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.detailTitle} numberOfLines={1}>{hotel.hotelName}</Text>
            <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[hotel.status] + '33', borderColor: STATUS_COLORS[hotel.status] }]}>
              <Text style={[styles.statusText, { color: STATUS_COLORS[hotel.status] }]}>
                {hotel.status.toUpperCase()}
              </Text>
            </View>
          </View>

          <ScrollView style={styles.detailScroll} contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 40 }}>

            {/* Rejection reason if rejected */}
            {hotel.status === 'rejected' && hotel.rejectionReason ? (
              <View style={styles.rejectBox}>
                <MaterialIcons name="cancel" size={16} color={Colors.danger} />
                <Text style={styles.rejectBoxText}>Rejected: {hotel.rejectionReason}</Text>
              </View>
            ) : null}

            {/* Business Info */}
            {renderSection('Business Info', [
              { label: 'Hotel Name', value: hotel.hotelName },
              { label: 'Owner Name', value: hotel.ownerName },
              { label: 'Business Type', value: hotel.businessType },
            ])}

            {/* Contact */}
            {renderSection('Contact', [
              { label: 'Phone', value: hotel.phone },
              { label: 'Email', value: hotel.email || '—' },
              { label: 'Address', value: hotel.address },
              { label: 'City', value: hotel.city || '—' },
              { label: 'State', value: hotel.state || '—' },
              { label: 'Pincode', value: hotel.pincode || '—' },
            ])}

            {/* Legal */}
            {renderSection('Legal & Licenses', [
              { label: 'FSSAI', value: hotel.fssaiNumber, verified: hotel.fssaiVerified },
              { label: 'GST', value: hotel.gstNumber || '—', verified: hotel.gstVerified },
              { label: 'PAN', value: hotel.panNumber || '—', verified: hotel.panVerified },
            ])}

            {/* Bank */}
            {renderSection('Bank Details', [
              { label: 'Bank', value: hotel.bankName || '—' },
              { label: 'Branch', value: hotel.bankBranch || '—' },
              { label: 'Account Holder', value: hotel.bankAccountHolder || '—' },
              { label: 'Account No', value: hotel.bankAccountNumber || '—' },
              { label: 'IFSC', value: hotel.bankIfscCode || '—', verified: hotel.ifscVerified },
            ])}

            {/* Login Credentials */}
            {hotel.status === 'active' && (
              <View style={styles.credentialsSection}>
                <Text style={styles.detailSectionTitle}>Login Credentials</Text>
                <View style={styles.credentialRow}>
                  <MaterialIcons name="person" size={16} color={Colors.textSecondary} />
                  <Text style={styles.credentialLabel}>Admin ID:</Text>
                  <Text style={styles.credentialValue}>{hotel.adminId || '—'}</Text>
                </View>
                <View style={styles.credentialRow}>
                  <MaterialIcons name="lock" size={16} color={Colors.textSecondary} />
                  <Text style={styles.credentialLabel}>Password:</Text>
                  <Text style={styles.credentialValue}>{'•'.repeat(8)} (hidden)</Text>
                </View>
                <TouchableOpacity
                  style={styles.resetCredBtn}
                  onPress={() => { setNewAdminId(hotel.adminId || ''); setNewPassword(''); setShowCredentialsModal(true); }}
                >
                  <MaterialIcons name="edit" size={15} color={Colors.white} />
                  <Text style={styles.resetCredBtnText}>Reset Credentials</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* SaaS Info */}
            {renderSection('Subscription & Trial', [
              { label: 'Status', value: hotel.status },
              { label: 'Plan', value: hotel.subscriptionPlan || 'none' },
              { label: 'Trial Start', value: hotel.trialStartDate ? new Date(hotel.trialStartDate).toLocaleDateString('en-IN') : '—' },
              { label: 'Trial End', value: hotel.trialEndDate ? new Date(hotel.trialEndDate).toLocaleDateString('en-IN') : '—' },
            ])}

            {/* Registration Date */}
            <Text style={styles.regDate}>
              Registered: {new Date(hotel.createdAt).toLocaleString('en-IN')}
            </Text>
          </ScrollView>

          {/* Premium Toggle */}
          {hotel.status === 'active' && (
            <TouchableOpacity
              style={[styles.premiumToggleBtn, hotel.isPremium && styles.premiumToggleBtnActive]}
              onPress={() => handlePremiumToggle(hotel)}
              disabled={actionLoading}
            >
              <Text style={styles.premiumToggleEmoji}>👑</Text>
              <Text style={[styles.premiumToggleText, hotel.isPremium && styles.premiumToggleTextActive]}>
                {hotel.isPremium ? 'Premium Active — Tap to Remove' : 'Activate Premium Plan'}
              </Text>
              <MaterialIcons
                name={hotel.isPremium ? 'toggle-on' : 'toggle-off'}
                size={28}
                color={hotel.isPremium ? Colors.white : Colors.textMuted}
              />
            </TouchableOpacity>
          )}

          {/* Action Buttons */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.detailActions, { paddingBottom: Spacing.lg + bottom, gap: Spacing.sm }]}>
            {hotel.status === 'pending' && (
              <>
                <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn, { flex: 0, paddingHorizontal: Spacing.lg }]} onPress={() => { setShowRejectModal(true); }} disabled={actionLoading}>
                  <MaterialIcons name="cancel" size={18} color={Colors.white} />
                  <Text style={styles.actionBtnText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.accent, flex: 0, paddingHorizontal: Spacing.lg }]} onPress={() => handleStartTrial(hotel)} disabled={actionLoading}>
                  <MaterialIcons name="timer" size={18} color={Colors.white} />
                  <Text style={styles.actionBtnText}>Start Trial</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.approveBtn, { flex: 0, paddingHorizontal: Spacing.lg }]} onPress={() => handleApprove(hotel)} disabled={actionLoading}>
                  {actionLoading ? <ActivityIndicator size="small" color={Colors.white} /> : (
                    <><MaterialIcons name="check-circle" size={18} color={Colors.white} /><Text style={styles.actionBtnText}>Approve</Text></>
                  )}
                </TouchableOpacity>
              </>
            )}
            {hotel.status === 'trial' && (
              <>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.info, flex: 0, paddingHorizontal: Spacing.lg }]} onPress={() => openExtendModal(hotel)} disabled={actionLoading}>
                  <MaterialIcons name="more-time" size={18} color={Colors.white} />
                  <Text style={styles.actionBtnText}>Extend Trial</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#7B1FA2', flex: 0, paddingHorizontal: Spacing.lg }]} onPress={() => openConvertModal(hotel)} disabled={actionLoading}>
                  <MaterialIcons name="upgrade" size={18} color={Colors.white} />
                  <Text style={styles.actionBtnText}>Convert to Plan</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.approveBtn, { flex: 0, paddingHorizontal: Spacing.lg }]} onPress={() => handleActivate(hotel)} disabled={actionLoading}>
                  <MaterialIcons name="check-circle" size={18} color={Colors.white} />
                  <Text style={styles.actionBtnText}>Activate</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn, { flex: 0, paddingHorizontal: Spacing.lg }]} onPress={() => handleExpire(hotel)} disabled={actionLoading}>
                  <MaterialIcons name="timer-off" size={18} color={Colors.white} />
                  <Text style={styles.actionBtnText}>Expire</Text>
                </TouchableOpacity>
              </>
            )}
            {hotel.status === 'active' && (
              <>
                <TouchableOpacity style={[styles.actionBtn, styles.suspendBtn, { flex: 0, paddingHorizontal: Spacing.lg }]} onPress={() => handleSuspend(hotel)} disabled={actionLoading}>
                  <MaterialIcons name="block" size={18} color={Colors.white} />
                  <Text style={styles.actionBtnText}>Suspend</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn, { flex: 0, paddingHorizontal: Spacing.lg }]} onPress={() => handleExpire(hotel)} disabled={actionLoading}>
                  <MaterialIcons name="timer-off" size={18} color={Colors.white} />
                  <Text style={styles.actionBtnText}>Expire</Text>
                </TouchableOpacity>
              </>
            )}
            {(hotel.status === 'expired' || hotel.status === 'suspended' || hotel.status === 'rejected') && (
              <>
                <TouchableOpacity style={[styles.actionBtn, styles.approveBtn, { flex: 0, paddingHorizontal: Spacing.lg }]} onPress={() => handleActivate(hotel)} disabled={actionLoading}>
                  <MaterialIcons name="check-circle" size={18} color={Colors.white} />
                  <Text style={styles.actionBtnText}>Activate</Text>
                </TouchableOpacity>
                {(hotel.status === 'expired') && (
                  <>
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.info, flex: 0, paddingHorizontal: Spacing.lg }]} onPress={() => openExtendModal(hotel)} disabled={actionLoading}>
                      <MaterialIcons name="more-time" size={18} color={Colors.white} />
                      <Text style={styles.actionBtnText}>Extend Trial</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#7B1FA2', flex: 0, paddingHorizontal: Spacing.lg }]} onPress={() => openConvertModal(hotel)} disabled={actionLoading}>
                      <MaterialIcons name="upgrade" size={18} color={Colors.white} />
                      <Text style={styles.actionBtnText}>Convert to Plan</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>

        {/* New Approve Modal — trial duration + feature flags */}
        <Modal visible={showApproveModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: Spacing.md }}>
              <View style={[styles.rejectModal, { maxHeight: undefined }]}>
                <Text style={styles.rejectModalTitle}>Approve: {selectedHotel?.hotelName}</Text>
                <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, marginBottom: Spacing.md }}>
                  Admin ID and password will be auto-generated. Set trial duration and features below.
                </Text>

                <Text style={{ color: Colors.text, fontWeight: '700', fontSize: FontSize.sm, marginBottom: Spacing.sm }}>Trial Duration</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md }}>
                  {[7, 14, 30, 60, 90].map((d) => (
                    <TouchableOpacity
                      key={d}
                      onPress={() => setApproveTrialDays(d)}
                      style={{
                        paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
                        backgroundColor: approveTrialDays === d ? Colors.primary : Colors.surface,
                        borderWidth: 1, borderColor: approveTrialDays === d ? Colors.primary : Colors.border,
                      }}
                    >
                      <Text style={{ color: approveTrialDays === d ? Colors.white : Colors.textSecondary, fontWeight: '600', fontSize: FontSize.sm }}>{d} days</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={{ color: Colors.text, fontWeight: '700', fontSize: FontSize.sm, marginBottom: Spacing.sm }}>Feature Flags</Text>
                {([
                  ['tables',      'Tables'],
                  ['expenses',    'Expenses'],
                  ['reports',     'Reports'],
                  ['reservations','Reservations'],
                  ['qrOrdering',  'QR Ordering'],
                  ['customerChat','Customer Chat'],
                  ['ingredients', 'Ingredients'],
                  ['waste',       'Waste Tracking'],
                  ['payment',     'Payment Module'],
                  ['aggregator',  'Aggregator'],
                ] as [keyof FeatureFlags, string][]).map(([key, label]) => (
                  <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}>
                    <Text style={{ color: Colors.text, fontSize: FontSize.sm }}>{label}</Text>
                    <TouchableOpacity
                      onPress={() => setApproveFeatures(prev => ({ ...prev, [key]: !prev[key] }))}
                      style={{
                        width: 46, height: 26, borderRadius: 13,
                        backgroundColor: approveFeatures[key] ? Colors.success : Colors.border,
                        justifyContent: 'center',
                        alignItems: approveFeatures[key] ? 'flex-end' : 'flex-start',
                        paddingHorizontal: 3,
                      }}
                    >
                      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.white }} />
                    </TouchableOpacity>
                  </View>
                ))}

                <View style={[styles.rejectModalActions, { marginTop: Spacing.md }]}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowApproveModal(false)}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.confirmRejectBtn, { backgroundColor: Colors.success }]} onPress={handleApproveSubmit} disabled={actionLoading}>
                    {actionLoading ? <ActivityIndicator size="small" color={Colors.white} /> : (
                      <Text style={styles.actionBtnText}>Approve</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </Modal>

        {/* Credential Reset Modal (for active hotels) */}
        <Modal visible={showCredentialsModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.rejectModal}>
              <Text style={styles.rejectModalTitle}>Reset Login Credentials</Text>
              <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, marginBottom: Spacing.md }}>
                Update the login credentials for this hotel. Share the new credentials with the hotel owner.
              </Text>
              <TextInput
                style={[styles.rejectInput, { marginBottom: Spacing.sm, height: 48, textAlignVertical: 'center' }]}
                placeholder="Admin ID (min 4 chars)"
                placeholderTextColor={Colors.textMuted}
                value={newAdminId}
                onChangeText={setNewAdminId}
                autoCapitalize="none"
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.md, paddingHorizontal: Spacing.md }}>
                <TextInput
                  style={[{ flex: 1, color: Colors.text, fontSize: FontSize.md, paddingVertical: Spacing.sm }]}
                  placeholder="New password (min 6 chars)"
                  placeholderTextColor={Colors.textMuted}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry={!showNewPassword}
                />
                <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)}>
                  <MaterialIcons name={showNewPassword ? 'visibility' : 'visibility-off'} size={20} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <View style={styles.rejectModalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowCredentialsModal(false); setNewAdminId(''); setNewPassword(''); }}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.confirmRejectBtn, { backgroundColor: Colors.success }]} onPress={handleApproveWithCredentials} disabled={actionLoading}>
                  {actionLoading ? <ActivityIndicator size="small" color={Colors.white} /> : (
                    <Text style={styles.actionBtnText}>Update</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={showRejectModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.rejectModal}>
              <Text style={styles.rejectModalTitle}>Rejection Reason</Text>
              <TextInput
                style={styles.rejectInput}
                placeholder="Why are you rejecting this hotel?"
                placeholderTextColor={Colors.textMuted}
                value={rejectReason}
                onChangeText={setRejectReason}
                multiline
                numberOfLines={3}
              />
              <View style={styles.rejectModalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowRejectModal(false); setRejectReason(''); }}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmRejectBtn} onPress={handleReject} disabled={actionLoading}>
                  {actionLoading ? <ActivityIndicator size="small" color={Colors.white} /> : (
                    <Text style={styles.actionBtnText}>Reject</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </Modal>

      {/* Extend Trial Modal */}
      <Modal visible={showExtendModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.rejectModal}>
            <Text style={styles.rejectModalTitle}>Extend Trial</Text>
            <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, marginBottom: Spacing.md }}>
              {selectedHotel?.hotelName} — choose how many days to add.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md }}>
              {[7, 15, 30, 60, 90].map((d) => (
                <TouchableOpacity
                  key={d}
                  onPress={() => setExtendDays(d)}
                  style={{
                    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
                    backgroundColor: extendDays === d ? Colors.primary : Colors.surface,
                    borderWidth: 1, borderColor: extendDays === d ? Colors.primary : Colors.border,
                  }}
                >
                  <Text style={{ color: extendDays === d ? Colors.white : Colors.textSecondary, fontWeight: '600', fontSize: FontSize.sm }}>{d} days</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.rejectModalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowExtendModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmRejectBtn, { backgroundColor: Colors.info }]} onPress={handleExtendSubmit} disabled={actionLoading}>
                {actionLoading ? <ActivityIndicator size="small" color={Colors.white} /> : (
                  <Text style={styles.actionBtnText}>Extend</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Convert to Paid Plan Modal */}
      <Modal visible={showConvertModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: Spacing.md }}>
            <View style={styles.rejectModal}>
              <Text style={styles.rejectModalTitle}>Convert to Paid Plan</Text>
              <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, marginBottom: Spacing.md }}>
                {selectedHotel?.hotelName}
              </Text>

              <Text style={{ color: Colors.text, fontWeight: '700', fontSize: FontSize.sm, marginBottom: Spacing.sm }}>Plan</Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md }}>
                {(['starter', 'professional', 'enterprise'] as const).map((p) => (
                  <TouchableOpacity
                    key={p}
                    onPress={() => setConvertPlan(p)}
                    style={{
                      flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10,
                      backgroundColor: convertPlan === p ? '#7B1FA2' : Colors.surface,
                      borderWidth: 1, borderColor: convertPlan === p ? '#7B1FA2' : Colors.border,
                    }}
                  >
                    <Text style={{ color: convertPlan === p ? Colors.white : Colors.textSecondary, fontWeight: '700', fontSize: FontSize.sm }}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={{ color: Colors.text, fontWeight: '700', fontSize: FontSize.sm, marginBottom: Spacing.sm }}>Duration</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md }}>
                {[30, 90, 180, 365].map((d) => (
                  <TouchableOpacity
                    key={d}
                    onPress={() => setConvertDuration(d)}
                    style={{
                      paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
                      backgroundColor: convertDuration === d ? '#7B1FA2' : Colors.surface,
                      borderWidth: 1, borderColor: convertDuration === d ? '#7B1FA2' : Colors.border,
                    }}
                  >
                    <Text style={{ color: convertDuration === d ? Colors.white : Colors.textSecondary, fontWeight: '600', fontSize: FontSize.sm }}>
                      {d === 365 ? '1 Year' : `${d} days`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.rejectModalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowConvertModal(false)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.confirmRejectBtn, { backgroundColor: '#7B1FA2' }]} onPress={handleConvertSubmit} disabled={actionLoading}>
                  {actionLoading ? <ActivityIndicator size="small" color={Colors.white} /> : (
                    <Text style={styles.actionBtnText}>Convert</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Generated Credentials Result Modal — shown after auto-approve */}
      <Modal visible={showCredentialResult} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.rejectModal, { borderTopWidth: 4, borderTopColor: Colors.success }]}>
            <View style={{ alignItems: 'center', marginBottom: Spacing.md }}>
              <MaterialIcons name="check-circle" size={48} color={Colors.success} />
              <Text style={[styles.rejectModalTitle, { marginTop: Spacing.sm }]}>Hotel Approved!</Text>
            </View>
            <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, marginBottom: Spacing.md, textAlign: 'center' }}>
              Share these credentials with the hotel owner. This is the only time the password is shown.
            </Text>
            <View style={{ backgroundColor: Colors.background, borderRadius: BorderRadius.sm, padding: Spacing.md, gap: Spacing.sm, marginBottom: Spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm }}>Admin ID</Text>
                <Text style={{ color: Colors.text, fontSize: FontSize.sm, fontWeight: '700', fontFamily: 'monospace' }}>{generatedCredentials?.adminId}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm }}>Password</Text>
                <Text style={{ color: Colors.text, fontSize: FontSize.sm, fontWeight: '700', fontFamily: 'monospace' }}>{generatedCredentials?.password}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm }}>Kitchen PIN</Text>
                <Text style={{ color: Colors.text, fontSize: FontSize.sm, fontWeight: '700', fontFamily: 'monospace' }}>{generatedCredentials?.kitchenPin}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.confirmRejectBtn, { backgroundColor: Colors.success }]}
              onPress={() => { setShowCredentialResult(false); setGeneratedCredentials(null); }}
            >
              <Text style={styles.actionBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      </>
    );
  };

  const renderSection = (title: string, fields: { label: string; value: string; verified?: boolean }[]) => (
    <View style={styles.detailSection}>
      <Text style={styles.detailSectionTitle}>{title}</Text>
      {fields.map((f) => (
        <View key={f.label} style={styles.detailRow}>
          <Text style={styles.detailLabel}>{f.label}</Text>
          <View style={styles.detailValueRow}>
            <Text style={styles.detailValue}>{f.value}</Text>
            {f.verified !== undefined && (
              <MaterialIcons
                name={f.verified ? 'verified' : 'pending'}
                size={16}
                color={f.verified ? Colors.success : Colors.warning}
              />
            )}
          </View>
        </View>
      ))}
    </View>
  );

  const renderTicketsTab = () => (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
        {(['all', 'open', 'in-progress', 'resolved', 'closed'] as TicketFilter[]).map((s) => (
          <TouchableOpacity key={s} style={[styles.filterTab, ticketFilter === s && styles.filterTabActive]} onPress={() => setTicketFilter(s)}>
            <Text style={[styles.filterTabText, ticketFilter === s && styles.filterTabTextActive]}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={tickets}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.listContent}
        onRefresh={() => { setRefreshing(true); loadData(); }}
        refreshing={refreshing}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.hotelCard}
            onPress={() => { setSelectedTicket(item); setShowTicketDetail(true); }}
            activeOpacity={0.8}
          >
            <View style={styles.hotelCardLeft}>
              <View style={[styles.statusDot, { backgroundColor: TICKET_STATUS_COLORS[item.status] }]} />
              <View style={styles.hotelCardInfo}>
                <Text style={styles.hotelName} numberOfLines={1}>{item.subject}</Text>
                <Text style={styles.hotelOwner}>{item.hotelName} • {item.hotelPhone}</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                  <View style={[styles.statusDot, { backgroundColor: PRIORITY_COLORS[item.priority], width: 8, height: 8, borderRadius: 4 }]} />
                  <Text style={styles.hotelCity}>{item.priority} • {item.category} • {item.replies.length} replies</Text>
                </View>
              </View>
            </View>
            <View style={styles.hotelCardRight}>
              <View style={[styles.statusBadge, { backgroundColor: TICKET_STATUS_COLORS[item.status] + '22', borderColor: TICKET_STATUS_COLORS[item.status] }]}>
                <Text style={[styles.statusText, { color: TICKET_STATUS_COLORS[item.status] }]}>{item.status.toUpperCase()}</Text>
              </View>
              <Text style={styles.hotelDate}>{new Date(item.createdAt).toLocaleDateString('en-IN')}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialIcons name="support-agent" size={48} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No tickets found</Text>
          </View>
        }
      />

      {/* Ticket Detail Modal */}
      <Modal visible={showTicketDetail} animationType="slide" onRequestClose={() => setShowTicketDetail(false)}>
        {selectedTicket && (
          <View style={{ flex: 1, backgroundColor: Colors.background }}>
            <View style={styles.detailHeader}>
              <TouchableOpacity onPress={() => setShowTicketDetail(false)}>
                <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
              </TouchableOpacity>
              <Text style={styles.detailTitle} numberOfLines={1}>{selectedTicket.subject}</Text>
              <View style={[styles.statusBadge, { backgroundColor: TICKET_STATUS_COLORS[selectedTicket.status] + '33', borderColor: TICKET_STATUS_COLORS[selectedTicket.status] }]}>
                <Text style={[styles.statusText, { color: TICKET_STATUS_COLORS[selectedTicket.status] }]}>{selectedTicket.status.toUpperCase()}</Text>
              </View>
            </View>

            <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 140 }}>
              <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, marginBottom: Spacing.md }}>
                {selectedTicket.hotelName} • {selectedTicket.hotelPhone} • {selectedTicket.category} • {selectedTicket.priority} priority
              </Text>
              <View style={[styles.detailSection, { marginBottom: Spacing.md }]}>
                <Text style={{ color: Colors.text, fontSize: FontSize.md, lineHeight: 22 }}>{selectedTicket.description}</Text>
              </View>

              {/* Status actions */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm, marginBottom: Spacing.lg }}>
                {['open', 'in-progress', 'resolved', 'closed'].map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.filterTab, selectedTicket.status === s && styles.filterTabActive]}
                    onPress={() => handleTicketStatus(s)}
                  >
                    <Text style={[styles.filterTabText, selectedTicket.status === s && styles.filterTabTextActive]}>
                      Mark {s}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Replies */}
              {selectedTicket.replies.length > 0 && (
                <>
                  <Text style={{ color: Colors.primary, fontSize: FontSize.sm, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.md }}>Conversation</Text>
                  {selectedTicket.replies.map((r, i) => (
                    <View key={i} style={{
                      backgroundColor: r.by === 'superadmin' ? Colors.primaryBg : Colors.card,
                      borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm,
                      alignSelf: r.by === 'superadmin' ? 'flex-start' : 'flex-end', maxWidth: '90%',
                      borderWidth: 1, borderColor: r.by === 'superadmin' ? Colors.primary + '40' : Colors.border,
                    }}>
                      <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, marginBottom: 4 }}>
                        {r.by === 'superadmin' ? '🛡 You (Support)' : '🏨 Hotel'}
                      </Text>
                      <Text style={{ color: Colors.text, fontSize: FontSize.md }}>{r.message}</Text>
                      <Text style={{ color: Colors.textMuted, fontSize: 10, marginTop: 4 }}>{new Date(r.createdAt).toLocaleString('en-IN')}</Text>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>

            <View style={{ flexDirection: 'row', padding: Spacing.md, paddingBottom: Spacing.md + bottom, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border, gap: Spacing.sm, alignItems: 'flex-end' }}>
              <TextInput
                style={{ flex: 1, backgroundColor: Colors.card, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, color: Colors.text, fontSize: FontSize.md, maxHeight: 100, borderWidth: 1, borderColor: Colors.border }}
                placeholder="Reply to hotel..."
                placeholderTextColor={Colors.textMuted}
                value={adminReply}
                onChangeText={setAdminReply}
                multiline
              />
              <TouchableOpacity
                style={{ backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.md }}
                onPress={handleAdminReply}
                disabled={replyLoading || !adminReply.trim()}
              >
                {replyLoading ? <ActivityIndicator size="small" color={Colors.white} /> : (
                  <MaterialIcons name="send" size={20} color={Colors.white} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>
    </>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#7B1FA2" />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Super Admin</Text>
          <Text style={styles.headerSubtitle}>Hotel Management Dashboard</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.replace('RoleSelect')}>
          <MaterialIcons name="logout" size={24} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Stats */}
      {stats && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexShrink: 0, flexGrow: 0, height: 70 }} contentContainerStyle={[styles.statsRow, { gap: Spacing.sm }]}>
          {renderStatCard('Total', stats.total, Colors.info, 'store')}
          {renderStatCard('Active', stats.active, Colors.success, 'check-circle')}
          {renderStatCard('Trial', stats.trial ?? 0, Colors.accent, 'timer')}
          {renderStatCard('Pending', stats.pending, Colors.warning, 'hourglass-empty')}
          {renderStatCard('Expired', stats.expired ?? 0, Colors.textSecondary, 'timer-off')}
          {renderStatCard('Suspended', stats.suspended, Colors.danger, 'block')}
          {renderStatCard('Today', stats.todayRegistrations ?? 0, Colors.primary, 'today')}
          {renderStatCard('Tickets', tickets.filter(t => t.status === 'open').length, '#7B1FA2', 'support-agent')}
          {health && renderStatCard('Online', health.onlineDevices, Colors.success, 'devices')}
        </ScrollView>
      )}

      {/* Tab Switch */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow} contentContainerStyle={{ gap: 0 }}>
        {([
          { id: 'hotels', icon: 'store', label: `Hotels (${hotels.length})` },
          { id: 'tickets', icon: 'support-agent', label: `Tickets${tickets.filter(t => t.status === 'open').length > 0 ? ` (${tickets.filter(t => t.status === 'open').length})` : ''}` },
          { id: 'revenue', icon: 'bar-chart', label: 'Revenue' },
          { id: 'notifications', icon: 'notifications', label: `Notifs (${notifications.length})` },
          { id: 'devices', icon: 'devices', label: `Devices (${devices.length})` },
          { id: 'config', icon: 'settings', label: 'Config' },
        ] as { id: TabView; icon: keyof typeof MaterialIcons.glyphMap; label: string }[]).map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.tabBtn, activeTab === t.id && styles.tabBtnActive]}
            onPress={async () => {
              setActiveTab(t.id);
              if (t.id === 'revenue' && !branchRevenue) {
                try { setBranchRevenue(await getBranchRevenue()); } catch {}
              }
              if (t.id === 'config' && !remoteConfig) {
                try {
                  const cfg = await getRemoteConfigAdmin();
                  setRemoteConfig(cfg);
                  setEditConfig(cfg);
                } catch {}
              }
            }}
          >
            <MaterialIcons name={t.icon} size={16} color={activeTab === t.id ? Colors.primary : Colors.textSecondary} />
            <Text style={[styles.tabBtnText, activeTab === t.id && styles.tabBtnTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {activeTab === 'notifications' ? (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 60, gap: Spacing.md }}>
          <View style={styles.detailSection}>
            <Text style={styles.detailSectionTitle}>Broadcast Notification</Text>
            <TextInput
              style={[styles.rejectInput, { height: 44, minHeight: 44, marginBottom: Spacing.sm, textAlignVertical: 'center' }]}
              placeholder="Title"
              placeholderTextColor={Colors.textMuted}
              value={newNotifTitle}
              onChangeText={setNewNotifTitle}
            />
            <TextInput
              style={[styles.rejectInput, { marginBottom: Spacing.md }]}
              placeholder="Message"
              placeholderTextColor={Colors.textMuted}
              value={newNotifMsg}
              onChangeText={setNewNotifMsg}
              multiline
              numberOfLines={3}
            />
            <TouchableOpacity
              style={[styles.actionBtn, styles.approveBtn, { marginTop: 0 }]}
              disabled={notifLoading || !newNotifTitle.trim() || !newNotifMsg.trim()}
              onPress={async () => {
                setNotifLoading(true);
                try {
                  await createBroadcastNotification({ title: newNotifTitle.trim(), message: newNotifMsg.trim() });
                  setNewNotifTitle(''); setNewNotifMsg('');
                  const updated = await getBroadcastNotifications();
                  setNotifications(updated);
                  showAlert('Sent', 'Notification broadcast to all hotels');
                } catch (e: any) { showAlert('Error', e.message); }
                finally { setNotifLoading(false); }
              }}
            >
              {notifLoading ? <ActivityIndicator size="small" color={Colors.white} /> : (
                <Text style={styles.actionBtnText}>Send to All Hotels</Text>
              )}
            </TouchableOpacity>
          </View>

          {notifications.map((n) => (
            <View key={n._id} style={[styles.hotelCard, { flexDirection: 'column', alignItems: 'flex-start', gap: Spacing.xs }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'flex-start' }}>
                <Text style={[styles.hotelName, { flex: 1 }]}>{n.title}</Text>
                <TouchableOpacity
                  onPress={async () => {
                    try { await deleteBroadcastNotification(n._id); const updated = await getBroadcastNotifications(); setNotifications(updated); }
                    catch (e: any) { showAlert('Error', e.message); }
                  }}
                >
                  <MaterialIcons name="delete-outline" size={20} color={Colors.danger} />
                </TouchableOpacity>
              </View>
              <Text style={styles.hotelOwner}>{n.message}</Text>
              <Text style={styles.hotelDate}>{new Date(n.createdAt).toLocaleString('en-IN')}</Text>
            </View>
          ))}
          {notifications.length === 0 && (
            <View style={styles.emptyState}>
              <MaterialIcons name="notifications-none" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No notifications sent</Text>
            </View>
          )}
        </ScrollView>
      ) : activeTab === 'devices' ? (
        <FlatList
          data={devices}
          keyExtractor={(d) => d._id}
          contentContainerStyle={styles.listContent}
          onRefresh={() => { setRefreshing(true); loadData(); }}
          refreshing={refreshing}
          renderItem={({ item: d }) => (
            <View style={[styles.hotelCard, { flexDirection: 'column', alignItems: 'flex-start', gap: Spacing.xs }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                <MaterialIcons name={d.platform === 'ios' ? 'phone-iphone' : 'phone-android'} size={18} color={Colors.textSecondary} />
                <Text style={styles.hotelName}>{d.deviceName}</Text>
                <View style={[styles.statusDot, { backgroundColor: d.isOnline ? Colors.success : Colors.textMuted }]} />
              </View>
              <Text style={styles.hotelOwner}>v{d.appVersion} · {d.platform} · {typeof d.hotelId === 'object' ? d.hotelId.hotelName : ''}</Text>
              <Text style={styles.hotelDate}>Last seen {new Date(d.lastSeen).toLocaleString('en-IN')}</Text>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <MaterialIcons name="devices" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No devices registered</Text>
            </View>
          }
        />
      ) : activeTab === 'config' ? (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 80, gap: Spacing.md }}>
          {!remoteConfig ? (
            <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <>
              {health && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>System Health</Text>
                  <View style={styles.detailRow}><Text style={styles.detailLabel}>MongoDB</Text><Text style={styles.detailValue}>{health.mongo.stateLabel}</Text></View>
                  <View style={styles.detailRow}><Text style={styles.detailLabel}>Total Devices</Text><Text style={styles.detailValue}>{health.totalDevices}</Text></View>
                  <View style={styles.detailRow}><Text style={styles.detailLabel}>Online (5m)</Text><Text style={styles.detailValue}>{health.onlineDevices}</Text></View>
                </View>
              )}

              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Remote Config</Text>

                {[
                  { key: 'minimumAppVersion', label: 'Min App Version (Android)' },
                  { key: 'minimumAppVersionIos', label: 'Min App Version (iOS)' },
                  { key: 'trialDays', label: 'Default Trial Days' },
                  { key: 'maintenanceMessage', label: 'Maintenance Message' },
                  { key: 'forceUpdateMessage', label: 'Force Update Message' },
                  { key: 'broadcastMessage', label: 'Broadcast Message' },
                ].map(({ key, label }) => (
                  <View key={key} style={{ marginBottom: Spacing.sm }}>
                    <Text style={[styles.detailLabel, { marginBottom: 4 }]}>{label}</Text>
                    <TextInput
                      style={[styles.rejectInput, { minHeight: 40, height: 40, paddingVertical: Spacing.sm, textAlignVertical: 'center' }]}
                      value={String(editConfig[key as keyof RemoteConfig] ?? '')}
                      onChangeText={(v) => setEditConfig((p) => ({ ...p, [key]: v }))}
                      placeholderTextColor={Colors.textMuted}
                    />
                  </View>
                ))}

                {[
                  { key: 'maintenanceMode', label: 'Maintenance Mode' },
                  { key: 'forceUpdate', label: 'Force Update' },
                  { key: 'paymentEnabled', label: 'Payment Enabled' },
                ].map(({ key, label }) => (
                  <View key={key} style={[styles.detailRow, { paddingVertical: Spacing.md }]}>
                    <Text style={styles.detailLabel}>{label}</Text>
                    <TouchableOpacity
                      onPress={() => setEditConfig((p) => ({ ...p, [key]: !p[key as keyof RemoteConfig] }))}
                    >
                      <MaterialIcons
                        name={(editConfig[key as keyof RemoteConfig] ? 'toggle-on' : 'toggle-off')}
                        size={32}
                        color={editConfig[key as keyof RemoteConfig] ? Colors.success : Colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                ))}

                <TouchableOpacity
                  style={[styles.actionBtn, styles.approveBtn, { marginTop: Spacing.md }]}
                  disabled={configLoading}
                  onPress={async () => {
                    setConfigLoading(true);
                    try {
                      const result = await updateRemoteConfig(editConfig);
                      setRemoteConfig(result.config);
                      setEditConfig(result.config);
                      showAlert('Saved', 'Remote config updated!');
                    } catch (e: any) { showAlert('Error', e.message); }
                    finally { setConfigLoading(false); }
                  }}
                >
                  {configLoading ? <ActivityIndicator size="small" color={Colors.white} /> : (
                    <Text style={styles.actionBtnText}>Save Config</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      ) : activeTab === 'revenue' ? (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 60 }}>
          {!branchRevenue ? (
            <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg }}>
                <View style={[styles.statCard, { borderTopColor: Colors.success, flex: 1 }]}>
                  <Text style={[styles.statValue, { color: Colors.success }]}>₹{branchRevenue.totalRevenue.toLocaleString('en-IN')}</Text>
                  <Text style={styles.statLabel}>Total Revenue</Text>
                </View>
                <View style={[styles.statCard, { borderTopColor: Colors.primary, flex: 1 }]}>
                  <Text style={[styles.statValue, { color: Colors.primary }]}>{branchRevenue.totalOrders}</Text>
                  <Text style={styles.statLabel}>Total Orders</Text>
                </View>
              </View>
              {branchRevenue.branches.map((b: any, i: number) => (
                <View key={b.hotelId} style={[styles.hotelCard, { marginBottom: Spacing.sm, flexDirection: 'column', alignItems: 'stretch' }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hotelName}>#{i + 1}  {b.hotelName}</Text>
                      {b.city ? <Text style={styles.hotelCity}>{b.city}</Text> : null}
                    </View>
                    <Text style={[styles.statValue, { color: Colors.success, fontSize: 18 }]}>₹{b.revenue.toLocaleString('en-IN')}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.sm }}>
                    <Text style={styles.hotelOwner}>{b.orders} orders</Text>
                    <Text style={styles.hotelOwner}>Avg ₹{b.avgOrder.toFixed(0)}</Text>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      ) : activeTab === 'hotels' ? (
        <>
          {/* Search */}
          <View style={styles.searchBar}>
            <MaterialIcons name="search" size={20} color={Colors.textMuted} />
            <TextInput style={styles.searchInput} placeholder="Search hotel, owner, phone..." placeholderTextColor={Colors.textMuted} value={search} onChangeText={setSearch} />
          </View>
          {/* Filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
            {(['all', 'pending', 'trial', 'active', 'expired', 'suspended', 'rejected'] as StatusFilter[]).map((s) => (
              <TouchableOpacity key={s} style={[styles.filterTab, filterStatus === s && styles.filterTabActive]} onPress={() => setFilterStatus(s)}>
                <Text style={[styles.filterTabText, filterStatus === s && styles.filterTabTextActive]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <FlatList
            data={hotels}
            keyExtractor={(item) => item._id}
            renderItem={renderHotelCard}
            contentContainerStyle={styles.listContent}
            onRefresh={() => { setRefreshing(true); loadData(); }}
            refreshing={refreshing}
            onEndReached={loadMoreHotels}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              hotelLoadingMore
                ? <ActivityIndicator size="small" color={Colors.primary} style={{ paddingVertical: 16 }} />
                : null
            }
            ListEmptyComponent={<View style={styles.emptyState}><MaterialIcons name="store" size={48} color={Colors.textMuted} /><Text style={styles.emptyText}>No hotels found</Text></View>}
          />
        </>
      ) : renderTicketsTab()}

      {renderDetailModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  loadingText: { color: Colors.textSecondary, marginTop: Spacing.md },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle: { fontSize: FontSize.xl, fontWeight: 'bold', color: Colors.text },
  headerSubtitle: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },

  statsRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: Spacing.sm, gap: Spacing.xs },
  statCard: { width: 68, backgroundColor: Colors.card, borderRadius: BorderRadius.sm, paddingVertical: 8, paddingHorizontal: 6, alignItems: 'center', borderTopWidth: 3, gap: 1 },
  statValue: { fontSize: FontSize.md, fontWeight: 'bold' },
  statLabel: { fontSize: 9, color: Colors.textSecondary, textAlign: 'center' },

  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, marginHorizontal: Spacing.md, marginVertical: Spacing.xs, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.sm },
  searchInput: { flex: 1, paddingVertical: 6, color: Colors.text, fontSize: FontSize.md },

  filterScroll: { maxHeight: 36, flexShrink: 0, flexGrow: 0 },
  filterRow: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, gap: Spacing.sm },
  filterTab: { paddingHorizontal: Spacing.md, paddingVertical: 3, borderRadius: BorderRadius.round, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  filterTabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterTabText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600' },
  filterTabTextActive: { color: Colors.white },

  listContent: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: 40 },
  hotelCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.md, padding: Spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  hotelCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: Spacing.md },
  statusDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  hotelCardInfo: { flex: 1 },
  hotelName: { color: Colors.text, fontSize: FontSize.md, fontWeight: 'bold' },
  hotelOwner: { color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 2 },
  hotelCity: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 1 },
  hotelCardRight: { alignItems: 'flex-end', gap: 4 },
  statusBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.round, borderWidth: 1 },
  statusText: { fontSize: 10, fontWeight: 'bold' },
  hotelDate: { fontSize: FontSize.xs, color: Colors.textMuted },

  emptyState: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  emptyText: { color: Colors.textMuted, fontSize: FontSize.md },

  // Detail Modal
  detailContainer: { flex: 1, backgroundColor: Colors.background },
  detailHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingTop: Spacing.xxl, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: Spacing.md },
  detailTitle: { flex: 1, fontSize: FontSize.xl, fontWeight: 'bold', color: Colors.text },
  detailScroll: { flex: 1 },
  detailSection: { backgroundColor: Colors.card, borderRadius: BorderRadius.md, padding: Spacing.lg, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  detailSectionTitle: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.md },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.xs, borderBottomWidth: 1, borderBottomColor: Colors.border },
  detailLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, flex: 1 },
  detailValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'flex-end' },
  detailValue: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  regDate: { color: Colors.textMuted, fontSize: FontSize.xs, textAlign: 'center', marginTop: Spacing.md },
  credentialsSection: { backgroundColor: Colors.card, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  credentialRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  credentialLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, width: 80 },
  credentialValue: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '600', flex: 1 },
  resetCredBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.info, borderRadius: BorderRadius.sm, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, alignSelf: 'flex-start', marginTop: Spacing.xs },
  resetCredBtnText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '600' },
  rejectBox: { flexDirection: 'row', backgroundColor: Colors.danger + '22', borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md, gap: Spacing.sm, alignItems: 'flex-start', borderWidth: 1, borderColor: Colors.danger },
  rejectBoxText: { color: Colors.danger, fontSize: FontSize.sm, flex: 1 },

  premiumToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.border,
  },
  premiumToggleBtnActive: { backgroundColor: '#F59E0B', borderColor: '#D97706' },
  premiumToggleEmoji: { fontSize: 20 },
  premiumToggleText: { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.textSecondary },
  premiumToggleTextActive: { color: Colors.white },
  detailActions: { flexDirection: 'row', paddingTop: Spacing.lg, paddingHorizontal: Spacing.lg, gap: Spacing.md, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md, borderRadius: BorderRadius.md, gap: Spacing.xs },
  actionBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: 'bold' },
  approveBtn: { backgroundColor: Colors.success },
  rejectBtn: { backgroundColor: Colors.danger },
  suspendBtn: { backgroundColor: Colors.warning },

  // Reject Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  rejectModal: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.xxl, width: '90%', gap: Spacing.lg },
  rejectModalTitle: { color: Colors.text, fontSize: FontSize.xl, fontWeight: 'bold', textAlign: 'center' },
  rejectInput: { backgroundColor: Colors.card, borderRadius: BorderRadius.md, padding: Spacing.md, color: Colors.text, fontSize: FontSize.md, borderWidth: 1, borderColor: Colors.border, minHeight: 80, textAlignVertical: 'top' },
  rejectModalActions: { flexDirection: 'row', gap: Spacing.md },
  cancelBtn: { flex: 1, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelBtnText: { color: Colors.textSecondary, fontSize: FontSize.lg },
  confirmRejectBtn: { flex: 1, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: Colors.danger, alignItems: 'center' },

  // Tab switcher
  tabRow: { backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border, flexShrink: 0, flexGrow: 0, height: 36 },
  tabBtn: { paddingVertical: 3, paddingHorizontal: Spacing.lg, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', flexDirection: 'row', gap: 5 },
  tabBtnActive: { borderBottomColor: Colors.primary },
  tabBtnText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600' },
  tabBtnTextActive: { color: Colors.primary },

  // Ticket styles
  ticketCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  ticketCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.xs },
  ticketSubject: { color: Colors.white, fontSize: FontSize.md, fontWeight: 'bold', flex: 1, marginRight: Spacing.sm },
  ticketMeta: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs, flexWrap: 'wrap' },
  ticketMetaText: { color: Colors.textMuted, fontSize: FontSize.xs },
  priorityBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.round },
  priorityText: { color: Colors.white, fontSize: 10, fontWeight: 'bold' },

  // Ticket detail
  threadContainer: { padding: Spacing.md, gap: Spacing.md },
  bubbleWrapper: { maxWidth: '85%' },
  bubbleRight: { alignSelf: 'flex-end' },
  bubbleLeft: { alignSelf: 'flex-start' },
  bubble: { borderRadius: BorderRadius.md, padding: Spacing.md },
  bubbleHotel: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  bubbleAdmin: { backgroundColor: Colors.primaryBg, borderWidth: 1, borderColor: Colors.primary + '40' },
  bubbleText: { color: Colors.white, fontSize: FontSize.sm },
  bubbleTime: { fontSize: 10, color: Colors.textMuted, marginTop: 4 },
  bubbleByLabel: { fontSize: 10, color: Colors.textSecondary, marginBottom: 4, fontWeight: '600' },
  replyBox: { backgroundColor: Colors.surface, padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border, gap: Spacing.sm },
  replyInput: { backgroundColor: Colors.card, borderRadius: BorderRadius.md, padding: Spacing.md, color: Colors.text, fontSize: FontSize.md, borderWidth: 1, borderColor: Colors.border, minHeight: 70, textAlignVertical: 'top' },
  sendBtn: { backgroundColor: '#7B1FA2', borderRadius: BorderRadius.md, paddingVertical: Spacing.md, alignItems: 'center' },
  sendBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: 'bold' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  statusChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: BorderRadius.round, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  statusChipActive: { borderColor: '#7B1FA2', backgroundColor: '#7B1FA222' },
  statusChipText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600' },
  statusChipTextActive: { color: '#CE93D8' },
});

export default SuperAdminDashboardScreen;
