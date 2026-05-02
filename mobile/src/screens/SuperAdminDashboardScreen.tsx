import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  TextInput, ActivityIndicator, StatusBar, Modal, ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Hotel, SuperAdminStats } from '../types';
import { showAlert } from '../utils/alert';
import { getSuperAdminStats, getAllHotels, approveHotelWithCredentials, rejectHotel, suspendHotel, activateHotel, getAllTickets, adminReplyTicket, updateTicketStatus, getBranchRevenue, Ticket } from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'SuperAdminDashboard'>;

type TabView = 'hotels' | 'tickets' | 'revenue';
type StatusFilter = 'all' | 'pending' | 'active' | 'suspended' | 'rejected';
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
  active: Colors.success,
  suspended: Colors.danger,
  rejected: '#9E9E9E',
};

const STATUS_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  pending: 'hourglass-empty',
  active: 'check-circle',
  suspended: 'block',
  rejected: 'cancel',
};

const SuperAdminDashboardScreen: React.FC<Props> = ({ navigation }) => {
  const [activeTab, setActiveTab] = useState<TabView>('hotels');
  const [stats, setStats] = useState<SuperAdminStats | null>(null);
  const [hotels, setHotels] = useState<Hotel[]>([]);
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

  // Tickets
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>('all');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [showTicketDetail, setShowTicketDetail] = useState(false);
  const [adminReply, setAdminReply] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [statsData, hotelsData, ticketsData] = await Promise.all([
        getSuperAdminStats(),
        getAllHotels(filterStatus === 'all' ? undefined : filterStatus, search || undefined),
        getAllTickets(ticketFilter === 'all' ? undefined : ticketFilter),
      ]);
      setStats(statsData);
      setHotels(hotelsData);
      setTickets(ticketsData);
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterStatus, search, ticketFilter]);

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
    setNewAdminId('');
    setNewPassword('');
    setShowCredentialsModal(true);
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
      const isReset = selectedHotel.status === 'active';
      showAlert(
        isReset ? 'Credentials Updated!' : 'Approved!',
        `${selectedHotel.hotelName} ${isReset ? 'credentials updated' : 'approved'}.\n\nAdmin ID: ${newAdminId.trim()}\nPassword: ${newPassword}\n\nShare these with the hotel owner.`
      );
      setShowCredentialsModal(false);
      if (!isReset) setShowDetail(false);
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

  const renderStatCard = (label: string, value: number, color: string, icon: keyof typeof MaterialIcons.glyphMap) => (
    <View style={[styles.statCard, { borderTopColor: color }]}>
      <MaterialIcons name={icon} size={24} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  const renderHotelCard = ({ item }: { item: Hotel }) => (
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
        <Text style={styles.hotelDate}>
          {new Date(item.createdAt).toLocaleDateString('en-IN')}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderDetailModal = () => {
    if (!selectedHotel) return null;
    const hotel = selectedHotel;

    return (
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

            {/* Registration Date */}
            <Text style={styles.regDate}>
              Registered: {new Date(hotel.createdAt).toLocaleString('en-IN')}
            </Text>
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.detailActions}>
            {hotel.status === 'pending' && (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.rejectBtn]}
                  onPress={() => { setShowRejectModal(true); }}
                  disabled={actionLoading}
                >
                  <MaterialIcons name="cancel" size={18} color={Colors.white} />
                  <Text style={styles.actionBtnText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.approveBtn]}
                  onPress={() => handleApprove(hotel)}
                  disabled={actionLoading}
                >
                  {actionLoading ? <ActivityIndicator size="small" color={Colors.white} /> : (
                    <>
                      <MaterialIcons name="check-circle" size={18} color={Colors.white} />
                      <Text style={styles.actionBtnText}>Approve</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
            {hotel.status === 'active' && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.suspendBtn]}
                onPress={() => handleSuspend(hotel)}
                disabled={actionLoading}
              >
                <MaterialIcons name="block" size={18} color={Colors.white} />
                <Text style={styles.actionBtnText}>Suspend</Text>
              </TouchableOpacity>
            )}
            {(hotel.status === 'suspended' || hotel.status === 'rejected') && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.approveBtn]}
                onPress={() => handleActivate(hotel)}
                disabled={actionLoading}
              >
                <MaterialIcons name="check-circle" size={18} color={Colors.white} />
                <Text style={styles.actionBtnText}>Activate</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Reject Reason Modal */}
        {/* Credentials modal for approval */}
        <Modal visible={showCredentialsModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.rejectModal}>
              <Text style={styles.rejectModalTitle}>
                {selectedHotel?.status === 'active' ? 'Reset Login Credentials' : 'Set Login Credentials'}
              </Text>
              <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, marginBottom: Spacing.md }}>
                {selectedHotel?.status === 'active'
                  ? 'Update the login credentials for this hotel. Share the new credentials with the hotel owner.'
                  : 'These will be the hotel admin\'s login details. Share them with the hotel owner after approval.'}
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
                  placeholder="Password (min 6 chars)"
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
                    <Text style={styles.actionBtnText}>Approve</Text>
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

            <View style={{ flexDirection: 'row', padding: Spacing.md, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border, gap: Spacing.sm, alignItems: 'flex-end' }}>
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
        <View style={styles.statsRow}>
          {renderStatCard('Total', stats.total, Colors.info, 'store')}
          {renderStatCard('Pending', stats.pending, Colors.warning, 'hourglass-empty')}
          {renderStatCard('Active', stats.active, Colors.success, 'check-circle')}
          {renderStatCard('Tickets', tickets.filter(t => t.status === 'open').length, Colors.danger, 'support-agent')}
        </View>
      )}

      {/* Tab Switch */}
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'hotels' && styles.tabBtnActive]} onPress={() => setActiveTab('hotels')}>
          <MaterialIcons name="store" size={18} color={activeTab === 'hotels' ? Colors.white : Colors.textSecondary} />
          <Text style={[styles.tabBtnText, activeTab === 'hotels' && styles.tabBtnTextActive]}>Hotels ({hotels.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'tickets' && styles.tabBtnActive]} onPress={() => setActiveTab('tickets')}>
          <MaterialIcons name="support-agent" size={18} color={activeTab === 'tickets' ? Colors.white : Colors.textSecondary} />
          <Text style={[styles.tabBtnText, activeTab === 'tickets' && styles.tabBtnTextActive]}>
            Tickets {tickets.filter(t => t.status === 'open').length > 0 ? `(${tickets.filter(t => t.status === 'open').length} open)` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'revenue' && styles.tabBtnActive]}
          onPress={async () => {
            setActiveTab('revenue');
            if (!branchRevenue) {
              try { setBranchRevenue(await getBranchRevenue()); } catch {}
            }
          }}
        >
          <MaterialIcons name="bar-chart" size={18} color={activeTab === 'revenue' ? Colors.white : Colors.textSecondary} />
          <Text style={[styles.tabBtnText, activeTab === 'revenue' && styles.tabBtnTextActive]}>Revenue</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'revenue' ? (
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
            {(['all', 'pending', 'active', 'suspended', 'rejected'] as StatusFilter[]).map((s) => (
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

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingTop: Spacing.xxl, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: 'bold', color: Colors.text },
  headerSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },

  statsRow: { flexDirection: 'row', padding: Spacing.md, gap: Spacing.sm },
  statCard: { flex: 1, backgroundColor: Colors.card, borderRadius: BorderRadius.md, padding: Spacing.md, alignItems: 'center', borderTopWidth: 3, gap: 4 },
  statValue: { fontSize: FontSize.xxl, fontWeight: 'bold' },
  statLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center' },

  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, marginHorizontal: Spacing.md, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.sm },
  searchInput: { flex: 1, paddingVertical: Spacing.sm, color: Colors.text, fontSize: FontSize.md },

  filterScroll: { maxHeight: 44 },
  filterRow: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm },
  filterTab: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xs, borderRadius: BorderRadius.round, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
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

  emptyState: { alignItems: 'center', paddingVertical: 60, gap: Spacing.md },
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

  detailActions: { flexDirection: 'row', padding: Spacing.lg, gap: Spacing.md, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border },
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
  tabRow: { flexDirection: 'row', backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn: { flex: 1, paddingVertical: Spacing.md, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: Colors.primary },
  tabBtnText: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: '600' },
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
