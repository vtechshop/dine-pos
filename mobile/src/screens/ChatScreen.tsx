import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { io, Socket } from 'socket.io-client';
import { Colors, Spacing, FontSize, BorderRadius } from '../utils/constants';
import { API_BASE_URL } from '../utils/constants';
import { PremiumGate } from '../components/PremiumGate';
import { getToken, getStoredHotelId } from '../services/api';

const SOCKET_URL = API_BASE_URL.replace('/api', '');

interface ChatMsg {
  _id: string;
  tableNumber: string;
  sender: 'customer' | 'admin';
  message: string;
  createdAt: string;
  read: boolean;
}

interface TableChat {
  _id: string; // tableNumber
  lastMessage: string;
  lastSender: string;
  lastTime: string;
  unread: number;
}

function ChatScreenInner() {
  const { bottom } = useSafeAreaInsets();
  const [tables, setTables] = useState<TableChat[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const socketRef = useRef<Socket | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const selectedTableRef = useRef<string | null>(null);

  // Keep ref in sync so socket listener always has the latest value without reconnecting
  useEffect(() => { selectedTableRef.current = selectedTable; }, [selectedTable]);

  // Connect socket ONCE on mount — never disconnect on tab/table change
  useEffect(() => {
    let mounted = true;

    (async () => {
      const [token, hotelId] = await Promise.all([getToken(), getStoredHotelId()]);
      if (!mounted) return;

      const socket = io(SOCKET_URL, {
        transports: ['websocket'],
        auth: { token: token || '' },
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        if (hotelId) socket.emit('join_hotel', hotelId);
      });

      socket.on('new_message', (msg: ChatMsg) => {
        const current = selectedTableRef.current;

        setTables(prev => {
          const exists = prev.find(t => t._id === msg.tableNumber);
          if (exists) {
            return prev.map(t => t._id === msg.tableNumber
              ? { ...t, lastMessage: msg.message, lastSender: msg.sender, lastTime: msg.createdAt,
                  unread: msg.sender === 'customer' && current !== msg.tableNumber ? t.unread + 1 : t.unread }
              : t
            );
          }
          return [{ _id: msg.tableNumber, lastMessage: msg.message, lastSender: msg.sender, lastTime: msg.createdAt, unread: msg.sender === 'customer' ? 1 : 0 }, ...prev];
        });

        if (msg.tableNumber === current) {
          setMessages(prev => {
            if (prev.some(m => m._id === msg._id)) return prev;
            return [...prev, msg];
          });
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        }
      });
    })();

    return () => {
      mounted = false;
      if (socketRef.current) {
        socketRef.current.off();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  // Load table list
  useEffect(() => {
    fetchTables();
  }, []);

  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchTables = async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/chat`, { headers });
      const data = await res.json();
      setTables(data);
    } catch (_) {}
    setLoading(false);
  };

  const openTable = async (tableNumber: string) => {
    setSelectedTable(tableNumber);
    setMessages([]);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE_URL}/chat/${tableNumber}`, { headers });
      const data = await res.json();
      setMessages(data);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
      await fetch(`${API_BASE_URL}/chat/${tableNumber}/read`, { method: 'PATCH', headers });
      setTables(prev => prev.map(t => t._id === tableNumber ? { ...t, unread: 0 } : t));
    } catch (_) {}
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || !selectedTable || !socketRef.current) return;
    const hotelId = await getStoredHotelId();
    if (!hotelId) {
      alert('Session error. Please log out and log in again.');
      return;
    }
    // Optimistic update — show message immediately without waiting for server echo
    const optimistic: ChatMsg = {
      _id: `opt_${Date.now()}`,
      tableNumber: selectedTable,
      sender: 'admin',
      message: text,
      createdAt: new Date().toISOString(),
      read: true,
    };
    setMessages(prev => [...prev, optimistic]);
    setInputText('');
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);

    socketRef.current.emit('admin_message', { hotelId, tableNumber: selectedTable, message: text });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  // ── Table List ─────────────────────────────────────────
  if (!selectedTable) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <MaterialIcons name="chat" size={22} color={Colors.primary} />
          <Text style={styles.headerTitle}>Table Chats</Text>
          <TouchableOpacity onPress={fetchTables}>
            <MaterialIcons name="refresh" size={22} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : tables.length === 0 ? (
          <View style={styles.center}>
            <MaterialIcons name="chat-bubble-outline" size={56} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptyHint}>Customers will appear here when they chat</Text>
          </View>
        ) : (
          <FlatList
            data={tables}
            keyExtractor={t => t._id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.tableRow} onPress={() => openTable(item._id)}>
                <View style={styles.tableAvatar}>
                  <MaterialIcons name="table-restaurant" size={20} color={Colors.primary} />
                </View>
                <View style={styles.tableInfo}>
                  <View style={styles.tableTop}>
                    <Text style={styles.tableName}>Table {item._id}</Text>
                    <Text style={styles.tableTime}>{formatTime(item.lastTime)}</Text>
                  </View>
                  <View style={styles.tableBottom}>
                    <Text style={styles.tableLastMsg} numberOfLines={1}>
                      {item.lastSender === 'admin' ? '✓ You: ' : ''}{item.lastMessage}
                    </Text>
                    {item.unread > 0 && (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadText}>{item.unread}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    );
  }

  // ── Chat View ──────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}>

      <View style={styles.header}>
        <TouchableOpacity onPress={() => setSelectedTable(null)}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <MaterialIcons name="table-restaurant" size={18} color={Colors.primary} style={{ marginLeft: 10 }} />
        <Text style={styles.headerTitle}>Table {selectedTable}</Text>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={m => m._id}
        contentContainerStyle={styles.messagesList}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyHint}>No messages yet. Customer will see your replies.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.sender === 'admin' ? styles.bubbleAdmin : styles.bubbleCustomer]}>
            <Text style={[styles.bubbleText, item.sender === 'admin' ? styles.bubbleTextAdmin : styles.bubbleTextCustomer]}>
              {item.message}
            </Text>
            <Text style={styles.bubbleTime}>{formatTime(item.createdAt)}</Text>
          </View>
        )}
      />

      <View style={[styles.inputRow, { paddingBottom: 12 + bottom }]}>
        <TextInput
          style={styles.chatInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Reply to customer..."
          placeholderTextColor={Colors.textMuted}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[styles.sendBtn, !inputText.trim() && { opacity: 0.4 }]}
          onPress={sendMessage}
          disabled={!inputText.trim()}>
          <MaterialIcons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

export default function ChatScreen() {
  return (
    <PremiumGate feature="Customer Chat" description="Chat with customers at their tables in real time and improve their dining experience.">
      <ChatScreenInner />
    </PremiumGate>
  );
}

// ── Support Contact Screen ─────────────────────────────────
export function SupportScreen() {
  const contacts = [
    { icon: 'phone' as const, label: 'Call Support', value: '+91 98765 43210', action: 'tel:+919876543210', color: '#4CAF50' },
    { icon: 'chat' as const, label: 'WhatsApp', value: '+91 98765 43210', action: 'whatsapp://send?phone=919876543210', color: '#25D366' },
    { icon: 'email' as const, label: 'Email Support', value: 'support@dinepos.com', action: 'mailto:support@dinepos.com', color: '#2196F3' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.supportHeader}>
        <MaterialIcons name="support-agent" size={52} color={Colors.primary} />
        <Text style={styles.supportTitle}>Support</Text>
        <Text style={styles.supportSubtitle}>We're here to help you 24/7</Text>
      </View>

      {contacts.map((c, i) => (
        <TouchableOpacity key={i} style={styles.contactCard}>
          <View style={[styles.contactIcon, { backgroundColor: c.color + '20' }]}>
            <MaterialIcons name={c.icon} size={24} color={c.color} />
          </View>
          <View style={styles.contactInfo}>
            <Text style={styles.contactLabel}>{c.label}</Text>
            <Text style={styles.contactValue}>{c.value}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={22} color={Colors.textMuted} />
        </TouchableOpacity>
      ))}

      <View style={styles.faqBox}>
        <Text style={styles.faqTitle}>Quick Help</Text>
        {[
          'How to add products?  →  Products tab → + button',
          'How to print bills?  →  Billing → Print Bill',
          'How to see reports?  →  Reports tab',
          'How to setup QR menu?  →  QR Menu tab → enter IP',
        ].map((q, i) => (
          <Text key={i} style={styles.faqItem}>• {q}</Text>
        ))}
      </View>

      <Text style={styles.version}>Dine POS v1.0.1</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, paddingHorizontal: 16,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { flex: 1, fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },

  emptyText: { fontSize: 16, color: Colors.textMuted, marginTop: 12, fontWeight: '600' },
  emptyHint: { fontSize: 13, color: Colors.textMuted, marginTop: 6, textAlign: 'center' },

  // Table list
  tableRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tableAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: `${Colors.primary}20`,
    alignItems: 'center', justifyContent: 'center',
  },
  tableInfo: { flex: 1 },
  tableTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  tableName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  tableTime: { fontSize: 11, color: Colors.textMuted },
  tableBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tableLastMsg: { flex: 1, fontSize: 13, color: Colors.textMuted },
  unreadBadge: {
    backgroundColor: Colors.primary, borderRadius: 10,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  // Chat bubbles
  messagesList: { padding: 16, gap: 8, paddingBottom: 20 },
  bubble: { maxWidth: '78%', borderRadius: 16, padding: 10, marginBottom: 6 },
  bubbleAdmin: { alignSelf: 'flex-end', backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleCustomer: { alignSelf: 'flex-start', backgroundColor: Colors.card, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextAdmin: { color: '#fff' },
  bubbleTextCustomer: { color: Colors.text },
  bubbleTime: { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 3, alignSelf: 'flex-end' },

  // Input
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  chatInput: {
    flex: 1, backgroundColor: Colors.card, color: Colors.text,
    borderRadius: BorderRadius.lg, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, borderWidth: 1, borderColor: Colors.border,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  // Support
  supportHeader: { alignItems: 'center', paddingVertical: 32, gap: 6 },
  supportTitle: { fontSize: 24, fontWeight: '800', color: Colors.text },
  supportSubtitle: { fontSize: 13, color: Colors.textMuted },
  contactCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.card, marginHorizontal: 16, marginBottom: 10,
    borderRadius: BorderRadius.lg, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  contactIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  contactInfo: { flex: 1 },
  contactLabel: { fontSize: 14, fontWeight: '700', color: Colors.text },
  contactValue: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  faqBox: {
    backgroundColor: Colors.card, margin: 16, borderRadius: BorderRadius.lg,
    padding: 16, borderWidth: 1, borderColor: Colors.border,
  },
  faqTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  faqItem: { fontSize: 13, color: Colors.textMuted, marginBottom: 7, lineHeight: 20 },
  version: { textAlign: 'center', fontSize: 12, color: Colors.textMuted, marginTop: 8, marginBottom: 24 },
});
