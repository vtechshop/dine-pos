import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  TextInput, ActivityIndicator, StatusBar, Modal, ScrollView,
  KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { io, Socket } from 'socket.io-client';
import { RootStackParamList } from '../types';
import { showAlert } from '../utils/alert';
import { useSettings } from '../context/SettingsContext';
import { raiseTicket, getMyTickets, replyToTicket, Ticket, getToken, getStoredHotelId } from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius, API_BASE_URL } from '../utils/constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SOCKET_URL = API_BASE_URL.replace('/api', '');

interface ChatMsg {
  _id?: string;
  tableNumber: string;
  sender: 'customer' | 'admin';
  message: string;
  createdAt: string;
}

type Props = NativeStackScreenProps<RootStackParamList, 'Support'>;

const STATUS_COLORS: Record<string, string> = {
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

const SupportScreen: React.FC<Props> = ({ navigation }) => {
  const { bottom } = useSafeAreaInsets();
  const { settings } = useSettings();
  const [activeTab, setActiveTab] = useState<'tickets' | 'chat' | 'contact'>('tickets');

  // ── Tickets state ──
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Ticket['category']>('technical');
  const [priority, setPriority] = useState<Ticket['priority']>('medium');

  // ── Chat state ──
  const [chatTables, setChatTables] = useState<any[]>([]);
  const [selectedChatTable, setSelectedChatTable] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatUnread, setChatUnread] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const chatListRef = useRef<FlatList>(null);

  const phone = settings.phone || '';

  const loadTickets = useCallback(async () => {
    if (!phone) { setLoading(false); return; }
    try {
      const data = await getMyTickets(phone);
      setTickets(data);
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [phone]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  // ── Chat socket ──
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;
    socket.emit('join', 'admin');
    socket.on('new_message', (msg: ChatMsg) => {
      setChatTables(prev => {
        const exists = prev.find((t: any) => t._id === msg.tableNumber);
        if (exists) return prev.map((t: any) => t._id === msg.tableNumber ? { ...t, lastMessage: msg.message, lastSender: msg.sender, lastTime: msg.createdAt, unread: msg.sender === 'customer' ? t.unread + 1 : t.unread } : t);
        return [{ _id: msg.tableNumber, lastMessage: msg.message, lastSender: msg.sender, lastTime: msg.createdAt, unread: msg.sender === 'customer' ? 1 : 0 }, ...prev];
      });
      if (msg.tableNumber === selectedChatTable) {
        setChatMessages(prev => [...prev, msg]);
        setTimeout(() => chatListRef.current?.scrollToEnd({ animated: true }), 100);
      } else if (msg.sender === 'customer') {
        setChatUnread(n => n + 1);
      }
    });
    fetchChatTables();
    return () => { socket.disconnect(); };
  }, [selectedChatTable]);

  const chatAuthHeaders = async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchChatTables = async () => {
    try {
      const headers = await chatAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/chat`, { headers });
      const data = await res.json();
      setChatTables(data);
      const total = data.reduce((s: number, t: any) => s + (t.unread || 0), 0);
      setChatUnread(total);
    } catch (_) {}
  };

  const openChatTable = async (tableNum: string) => {
    setSelectedChatTable(tableNum);
    setChatMessages([]);
    try {
      const headers = await chatAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/chat/${tableNum}`, { headers });
      const data = await res.json();
      setChatMessages(data);
      setTimeout(() => chatListRef.current?.scrollToEnd({ animated: false }), 100);
      await fetch(`${API_BASE_URL}/chat/${tableNum}/read`, { method: 'PATCH', headers });
      setChatTables(prev => prev.map((t: any) => t._id === tableNum ? { ...t, unread: 0 } : t));
    } catch (_) {}
  };

  const sendChatReply = async () => {
    if (!chatInput.trim() || !selectedChatTable || !socketRef.current) return;
    const hotelId = await getStoredHotelId();
    if (!hotelId) return;
    socketRef.current.emit('admin_message', { hotelId, tableNumber: selectedChatTable, message: chatInput.trim() });
    setChatInput('');
  };

  const handleRaiseTicket = async () => {
    if (!subject.trim()) { showAlert('Required', 'Please enter subject'); return; }
    if (!description.trim()) { showAlert('Required', 'Please enter description'); return; }
    if (!phone) { showAlert('Error', 'Phone number not set in Settings'); return; }

    setSubmitting(true);
    try {
      await raiseTicket({
        hotelName: settings.hotelName,
        hotelPhone: phone,
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority,
      });
      showAlert('Submitted!', 'Your ticket has been raised. We will respond shortly.');
      setShowNewModal(false);
      setSubject(''); setDescription(''); setCategory('technical'); setPriority('medium');
      loadTickets();
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to raise ticket');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async () => {
    if (!selectedTicket || !replyText.trim()) return;
    setSubmitting(true);
    try {
      const updated = await replyToTicket(selectedTicket._id, replyText.trim());
      setSelectedTicket(updated);
      setReplyText('');
      loadTickets();
    } catch (error: any) {
      showAlert('Error', error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderTicketCard = ({ item }: { item: Ticket }) => (
    <TouchableOpacity
      style={styles.ticketCard}
      onPress={() => { setSelectedTicket(item); setShowDetailModal(true); }}
      activeOpacity={0.8}
    >
      <View style={styles.ticketTop}>
        <Text style={styles.ticketSubject} numberOfLines={1}>{item.subject}</Text>
        <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] + '22', borderColor: STATUS_COLORS[item.status] }]}>
          <Text style={[styles.badgeText, { color: STATUS_COLORS[item.status] }]}>
            {item.status.toUpperCase()}
          </Text>
        </View>
      </View>
      <Text style={styles.ticketDesc} numberOfLines={2}>{item.description}</Text>
      <View style={styles.ticketBottom}>
        <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[item.priority] }]} />
        <Text style={styles.ticketMeta}>{item.priority} priority • {item.category}</Text>
        <Text style={styles.ticketDate}>{new Date(item.createdAt).toLocaleDateString('en-IN')}</Text>
      </View>
      {item.replies.length > 0 && (
        <View style={styles.replyCount}>
          <MaterialIcons name="chat" size={12} color={Colors.info} />
          <Text style={styles.replyCountText}>{item.replies.length} replies</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderDetailModal = () => {
    if (!selectedTicket) return null;
    return (
      <Modal visible={showDetailModal} animationType="slide" onRequestClose={() => setShowDetailModal(false)}>
        <View style={styles.modalContainer}>
          <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDetailModal(false)}>
              <MaterialIcons name="arrow-back" size={24} color={Colors.white} />
            </TouchableOpacity>
            <Text style={styles.modalHeaderTitle} numberOfLines={1}>Ticket #{selectedTicket._id.slice(-6).toUpperCase()}</Text>
            <View style={[styles.badge, { backgroundColor: STATUS_COLORS[selectedTicket.status] + '33', borderColor: STATUS_COLORS[selectedTicket.status] }]}>
              <Text style={[styles.badgeText, { color: STATUS_COLORS[selectedTicket.status] }]}>
                {selectedTicket.status.toUpperCase()}
              </Text>
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 120 }}>
            <Text style={styles.detailSubject}>{selectedTicket.subject}</Text>
            <Text style={styles.detailMeta}>
              {selectedTicket.category} • {selectedTicket.priority} priority •{' '}
              {new Date(selectedTicket.createdAt).toLocaleString('en-IN')}
            </Text>
            <View style={styles.detailDescBox}>
              <Text style={styles.detailDesc}>{selectedTicket.description}</Text>
            </View>

            {selectedTicket.replies.length > 0 && (
              <>
                <Text style={styles.repliesTitle}>Conversation</Text>
                {selectedTicket.replies.map((reply, i) => (
                  <View key={i} style={[styles.replyBubble, reply.by === 'superadmin' ? styles.adminBubble : styles.hotelBubble]}>
                    <Text style={styles.replyBy}>{reply.by === 'superadmin' ? '🛡 Support Team' : '🏨 You'}</Text>
                    <Text style={styles.replyMsg}>{reply.message}</Text>
                    <Text style={styles.replyTime}>{new Date(reply.createdAt).toLocaleString('en-IN')}</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          {selectedTicket.status !== 'resolved' && selectedTicket.status !== 'closed' && (
            <View style={[styles.replyBar, { paddingBottom: Spacing.md + bottom }]}>
              <TextInput
                style={styles.replyInput}
                placeholder="Type your reply..."
                placeholderTextColor={Colors.textMuted}
                value={replyText}
                onChangeText={setReplyText}
                multiline
              />
              <TouchableOpacity style={styles.sendBtn} onPress={handleReply} disabled={submitting || !replyText.trim()}>
                {submitting ? <ActivityIndicator size="small" color={Colors.white} /> : (
                  <MaterialIcons name="send" size={20} color={Colors.white} />
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
    );
  };

  const renderNewTicketModal = () => (
    <Modal visible={showNewModal} animationType="slide" onRequestClose={() => setShowNewModal(false)}>
      <View style={styles.modalContainer}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setShowNewModal(false)}>
            <MaterialIcons name="close" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={styles.modalHeaderTitle}>Raise New Ticket</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Subject *</Text>
            <TextInput style={styles.fieldInput} value={subject} onChangeText={setSubject} placeholder="Brief description of issue" placeholderTextColor={Colors.textMuted} />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Category *</Text>
            <View style={styles.optionsRow}>
              {(['technical', 'billing', 'account', 'other'] as Ticket['category'][]).map((c) => (
                <TouchableOpacity key={c} style={[styles.optionBtn, category === c && styles.optionBtnActive]} onPress={() => setCategory(c)}>
                  <Text style={[styles.optionText, category === c && styles.optionTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Priority</Text>
            <View style={styles.optionsRow}>
              {(['low', 'medium', 'high'] as Ticket['priority'][]).map((p) => (
                <TouchableOpacity key={p} style={[styles.optionBtn, priority === p && { backgroundColor: PRIORITY_COLORS[p], borderColor: PRIORITY_COLORS[p] }]} onPress={() => setPriority(p)}>
                  <Text style={[styles.optionText, priority === p && { color: Colors.white }]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Description *</Text>
            <TextInput
              style={[styles.fieldInput, { minHeight: 100, textAlignVertical: 'top' }]}
              value={description}
              onChangeText={setDescription}
              placeholder="Describe your issue in detail..."
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={4}
            />
          </View>

          <TouchableOpacity style={styles.submitBtn} onPress={handleRaiseTicket} disabled={submitting}>
            {submitting ? <ActivityIndicator size="small" color={Colors.white} /> : (
              <>
                <MaterialIcons name="send" size={20} color={Colors.white} />
                <Text style={styles.submitBtnText}>Submit Ticket</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const renderChatTab = () => {
    if (selectedChatTable) {
      return (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={120}>
          <View style={styles.chatTableHeader}>
            <TouchableOpacity onPress={() => setSelectedChatTable(null)}>
              <MaterialIcons name="arrow-back" size={22} color={Colors.text} />
            </TouchableOpacity>
            <MaterialIcons name="table-restaurant" size={18} color={Colors.primary} style={{ marginLeft: 8 }} />
            <Text style={styles.chatTableTitle}>Table {selectedChatTable}</Text>
          </View>
          <FlatList
            ref={chatListRef}
            data={chatMessages}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={<View style={styles.centered}><Text style={{ color: Colors.textMuted, fontSize: 13 }}>No messages yet</Text></View>}
            renderItem={({ item }) => (
              <View style={{ alignItems: item.sender === 'admin' ? 'flex-end' : 'flex-start' }}>
                <View style={[styles.bubble, item.sender === 'admin' ? styles.bubbleAdmin : styles.bubbleCustomer]}>
                  <Text style={styles.bubbleText}>{item.message}</Text>
                  <Text style={styles.bubbleTime}>{formatTime(item.createdAt)}</Text>
                </View>
              </View>
            )}
          />
          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Reply to customer..."
              placeholderTextColor={Colors.textMuted}
              onSubmitEditing={sendChatReply}
              returnKeyType="send"
            />
            <TouchableOpacity style={[styles.chatSendBtn, !chatInput.trim() && { opacity: 0.4 }]} onPress={sendChatReply} disabled={!chatInput.trim()}>
              <MaterialIcons name="send" size={20} color={Colors.white} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      );
    }
    return (
      <FlatList
        data={chatTables}
        keyExtractor={(t: any) => t._id}
        onRefresh={fetchChatTables}
        refreshing={false}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialIcons name="chat-bubble-outline" size={60} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No table chats yet</Text>
            <Text style={styles.emptySubtitle}>Customers can chat via QR menu</Text>
          </View>
        }
        renderItem={({ item }: any) => (
          <TouchableOpacity style={styles.chatRow} onPress={() => openChatTable(item._id)}>
            <View style={styles.chatAvatar}>
              <MaterialIcons name="table-restaurant" size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.chatTableName}>Table {item._id}</Text>
                <Text style={styles.chatTime}>{formatTime(item.lastTime)}</Text>
              </View>
              <Text style={styles.chatLastMsg} numberOfLines={1}>
                {item.lastSender === 'admin' ? '✓ You: ' : ''}{item.lastMessage}
              </Text>
            </View>
            {item.unread > 0 && (
              <View style={styles.unreadBadge}><Text style={styles.unreadText}>{item.unread}</Text></View>
            )}
          </TouchableOpacity>
        )}
      />
    );
  };

  const renderContactTab = () => (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View style={styles.contactHeader}>
        <MaterialIcons name="support-agent" size={48} color={Colors.primary} />
        <Text style={styles.contactTitle}>Contact Support</Text>
        <Text style={styles.contactSub}>Available 24/7 for you</Text>
      </View>
      {[
        { icon: 'phone' as const, label: 'Call Support', value: '+91 98765 43210', color: '#4CAF50', onPress: () => Linking.openURL('tel:+919876543210') },
        { icon: 'chat' as const, label: 'WhatsApp', value: '+91 98765 43210', color: '#25D366', onPress: () => Linking.openURL('whatsapp://send?phone=919876543210') },
        { icon: 'email' as const, label: 'Email Support', value: 'support@dinepos.com', color: '#2196F3', onPress: () => Linking.openURL('mailto:support@dinepos.com') },
      ].map((c, i) => (
        <TouchableOpacity key={i} style={styles.contactCard} onPress={c.onPress}>
          <View style={[styles.contactIcon, { backgroundColor: c.color + '20' }]}>
            <MaterialIcons name={c.icon} size={24} color={c.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.contactLabel}>{c.label}</Text>
            <Text style={styles.contactValue}>{c.value}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={22} color={Colors.textMuted} />
        </TouchableOpacity>
      ))}
      <View style={styles.faqBox}>
        <Text style={styles.faqTitle}>Quick Help</Text>
        {[
          'Add products → Products tab → + button',
          'Print bills → Billing → Print Bill',
          'View reports → Reports tab',
          'Setup QR menu → QR Menu tab → enter IP',
          'Table chat → Support → Chat tab',
        ].map((q, i) => (
          <Text key={i} style={styles.faqItem}>• {q}</Text>
        ))}
      </View>
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Support</Text>
        {activeTab === 'tickets' && (
          <TouchableOpacity style={styles.newBtn} onPress={() => setShowNewModal(true)}>
            <MaterialIcons name="add" size={20} color={Colors.white} />
            <Text style={styles.newBtnText}>New Ticket</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tab switcher */}
      <View style={styles.tabBar}>
        {([
          { key: 'tickets', icon: 'confirmation-number', label: 'Tickets' },
          { key: 'chat', icon: 'chat', label: 'Chat', badge: chatUnread },
          { key: 'contact', icon: 'support-agent', label: 'Contact' },
        ] as any[]).map(tab => (
          <TouchableOpacity key={tab.key} style={[styles.tabBtn, activeTab === tab.key && styles.tabBtnActive]} onPress={() => { setActiveTab(tab.key); if (tab.key === 'chat') setChatUnread(0); }}>
            <View style={{ position: 'relative' }}>
              <MaterialIcons name={tab.icon} size={20} color={activeTab === tab.key ? Colors.primary : Colors.textMuted} />
              {tab.badge > 0 && <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{tab.badge}</Text></View>}
            </View>
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {activeTab === 'tickets' && (
        loading ? <View style={styles.centered}><ActivityIndicator size="large" color={Colors.primary} /></View> : (
          <FlatList
            data={tickets}
            keyExtractor={(item) => item._id}
            renderItem={renderTicketCard}
            contentContainerStyle={styles.listContent}
            onRefresh={loadTickets}
            refreshing={loading}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <MaterialIcons name="support-agent" size={60} color={Colors.textMuted} />
                <Text style={styles.emptyTitle}>No tickets yet</Text>
                <Text style={styles.emptySubtitle}>Tap "New Ticket" to raise a support request</Text>
              </View>
            }
          />
        )
      )}
      {activeTab === 'chat' && renderChatTab()}
      {activeTab === 'contact' && renderContactTab()}

      {renderDetailModal()}
      {renderNewTicketModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingTop: Spacing.xxl, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: Spacing.md },
  headerTitle: { flex: 1, fontSize: FontSize.xl, fontWeight: 'bold', color: Colors.text },
  newBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, gap: 4 },
  newBtnText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: 'bold' },

  listContent: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: 40 },
  ticketCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.xs },
  ticketTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ticketSubject: { flex: 1, color: Colors.text, fontSize: FontSize.md, fontWeight: 'bold', marginRight: Spacing.sm },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.round, borderWidth: 1 },
  badgeText: { fontSize: 9, fontWeight: 'bold' },
  ticketDesc: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 18 },
  ticketBottom: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  ticketMeta: { flex: 1, color: Colors.textMuted, fontSize: FontSize.xs },
  ticketDate: { color: Colors.textMuted, fontSize: FontSize.xs },
  replyCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  replyCountText: { color: Colors.info, fontSize: FontSize.xs },

  emptyState: { alignItems: 'center', paddingVertical: 80, gap: Spacing.md },
  emptyTitle: { color: Colors.textSecondary, fontSize: FontSize.xl, fontWeight: 'bold' },
  emptySubtitle: { color: Colors.textMuted, fontSize: FontSize.md },

  // Tab bar
  tabBar: { flexDirection: 'row', backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  tabLabelActive: { color: Colors.primary },
  tabBadge: { position: 'absolute', top: -4, right: -8, backgroundColor: Colors.danger, borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  tabBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },

  // Chat list
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  chatAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: `${Colors.primary}20`, alignItems: 'center', justifyContent: 'center' },
  chatTableName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  chatTime: { fontSize: 11, color: Colors.textMuted },
  chatLastMsg: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  unreadBadge: { backgroundColor: Colors.primary, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  // Chat messages
  chatTableHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  chatTableTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginLeft: 8, flex: 1 },
  bubble: { maxWidth: '75%', borderRadius: 16, padding: 10, marginBottom: 4 },
  bubbleAdmin: { backgroundColor: Colors.primaryBg, borderBottomRightRadius: 4, borderWidth: 1, borderColor: Colors.primary + '40' },
  bubbleCustomer: { backgroundColor: Colors.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: Colors.border },
  bubbleText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  bubbleTime: { fontSize: 10, color: Colors.textMuted, marginTop: 3, textAlign: 'right' },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border },
  chatInput: { flex: 1, backgroundColor: Colors.card, color: Colors.text, borderRadius: BorderRadius.lg, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: Colors.border },
  chatSendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },

  // Contact
  contactHeader: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  contactTitle: { fontSize: 22, fontWeight: '800', color: Colors.text },
  contactSub: { fontSize: 13, color: Colors.textMuted },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.card, borderRadius: BorderRadius.lg, padding: 14, borderWidth: 1, borderColor: Colors.border },
  contactIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  contactLabel: { fontSize: 14, fontWeight: '700', color: Colors.text },
  contactValue: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  faqBox: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, padding: 16, borderWidth: 1, borderColor: Colors.border, marginTop: 4 },
  faqTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  faqItem: { fontSize: 13, color: Colors.textMuted, marginBottom: 7, lineHeight: 20 },

  // Modals
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingTop: Spacing.xxl, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: Spacing.md },
  modalHeaderTitle: { flex: 1, fontSize: FontSize.xl, fontWeight: 'bold', color: Colors.text },

  detailSubject: { fontSize: FontSize.xxl, fontWeight: 'bold', color: Colors.text, marginBottom: Spacing.xs },
  detailMeta: { color: Colors.textMuted, fontSize: FontSize.sm, marginBottom: Spacing.md },
  detailDescBox: { backgroundColor: Colors.card, borderRadius: BorderRadius.md, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.lg },
  detailDesc: { color: Colors.textSecondary, fontSize: FontSize.md, lineHeight: 22 },

  repliesTitle: { fontSize: FontSize.lg, fontWeight: 'bold', color: Colors.primary, marginBottom: Spacing.md, textTransform: 'uppercase', letterSpacing: 1 },
  replyBubble: { borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, maxWidth: '90%', gap: 4 },
  hotelBubble: { backgroundColor: Colors.card, alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  adminBubble: { backgroundColor: Colors.primaryBg, borderWidth: 1, borderColor: Colors.primary + '40', alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  replyBy: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '600' },
  replyMsg: { color: Colors.text, fontSize: FontSize.md, lineHeight: 20 },
  replyTime: { fontSize: 10, color: Colors.textMuted, textAlign: 'right' },

  replyBar: { flexDirection: 'row', paddingTop: Spacing.md, paddingHorizontal: Spacing.md, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border, gap: Spacing.sm, alignItems: 'flex-end' },
  replyInput: { flex: 1, backgroundColor: Colors.card, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, color: Colors.text, fontSize: FontSize.md, maxHeight: 100, borderWidth: 1, borderColor: Colors.border },
  sendBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.md, justifyContent: 'center', alignItems: 'center' },

  fieldGroup: { marginBottom: Spacing.lg },
  fieldLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.xs },
  fieldInput: { backgroundColor: Colors.card, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, color: Colors.text, fontSize: FontSize.md, borderWidth: 1, borderColor: Colors.border },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  optionBtn: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.round, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  optionBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  optionText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600' },
  optionTextActive: { color: Colors.white },
  submitBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: Spacing.lg, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  submitBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: 'bold' },
});

export default SupportScreen;
