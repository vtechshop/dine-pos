import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView,
  Platform, Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, AIChatMessage } from '../../types';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../../utils/constants';
import { getAIChatHistory, sendAIChatMessage, clearAIChatHistory } from '../../services/api';
import { OfflineIndicator } from '../../components/OfflineIndicator';

type Props = NativeStackScreenProps<RootStackParamList, 'AIChat'>;

const SUGGESTIONS = [
  'What were our top selling items today?',
  'How can I improve my revenue?',
  'What is my busiest hour?',
  'Which items should I remove from the menu?',
  'How do I reduce cancellations?',
];

const AIChatScreen: React.FC<Props> = () => {
  const { bottom } = useSafeAreaInsets();

  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [typing, setTyping]     = useState(false);
  const flatRef = useRef<FlatList>(null);

  const loadHistory = useCallback(async () => {
    try {
      setError(null);
      const data = await getAIChatHistory();
      setMessages(data.messages || []);
    } catch (e: any) {
      if (e?.status !== 404) setError(e.message || 'Failed to load chat history');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadHistory(); }, [loadHistory]));

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || sending) return;
    setInput('');
    setSending(true);
    setTyping(true);
    setError(null);

    const userMsg: AIChatMessage = { role: 'user', content: msg, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await sendAIChatMessage(msg);
      const aiMsg: AIChatMessage = { role: 'assistant', content: res.reply, timestamp: res.timestamp };
      setMessages(prev => [...prev, aiMsg]);
    } catch (e: any) {
      setError(e.message || 'Failed to send message');
      setMessages(prev => prev.filter(m => m !== userMsg));
    } finally {
      setSending(false);
      setTyping(false);
    }
  };

  const confirmClear = () => {
    Alert.alert('Clear Chat History', 'This will delete all chat history. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: async () => {
          try { await clearAIChatHistory(); setMessages([]); } catch {}
        },
      },
    ]);
  };

  const renderMsg = ({ item }: { item: AIChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAI]}>
        {!isUser && (
          <View style={styles.aiBubbleIcon}>
            <MaterialIcons name="auto-awesome" size={14} color={Colors.primary} />
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
          <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAI]}>
            {item.content}
          </Text>
          <Text style={[styles.bubbleTime, isUser ? styles.bubbleTimeUser : styles.bubbleTimeAI]}>
            {new Date(item.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <OfflineIndicator />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.aiAvatar}>
            <MaterialIcons name="auto-awesome" size={18} color={Colors.primary} />
          </View>
          <View>
            <Text style={styles.headerTitle}>DineOS AI</Text>
            <Text style={styles.headerSub}>Restaurant intelligence assistant</Text>
          </View>
        </View>
        <TouchableOpacity onPress={confirmClear} style={styles.clearBtn}>
          <MaterialIcons name="delete-sweep" size={20} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.loadingText}>Loading conversation…</Text>
        </View>
      )}

      {!loading && (
        <>
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={(_, i) => String(i)}
            renderItem={renderMsg}
            contentContainerStyle={[styles.listContent, { paddingBottom: bottom + 16 }]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <MaterialIcons name="auto-awesome" size={32} color={Colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>Ask anything about your restaurant</Text>
                <Text style={styles.emptySub}>Get AI-powered insights on revenue, menu, and operations.</Text>
              </View>
            }
            ListFooterComponent={
              typing ? (
                <View style={[styles.msgRow, styles.msgRowAI]}>
                  <View style={styles.aiBubbleIcon}>
                    <MaterialIcons name="auto-awesome" size={14} color={Colors.primary} />
                  </View>
                  <View style={[styles.bubble, styles.bubbleAI, styles.typingBubble]}>
                    <View style={styles.typingDots}>
                      {[0, 1, 2].map(i => <View key={i} style={styles.typingDot} />)}
                    </View>
                  </View>
                </View>
              ) : null
            }
          />

          {/* Suggestions (only when empty) */}
          {messages.length === 0 && !loading && (
            <View style={styles.suggestions}>
              <Text style={styles.suggestLabel}>Suggested questions</Text>
              <View style={styles.suggestChips}>
                {SUGGESTIONS.map((s, i) => (
                  <TouchableOpacity key={i} style={styles.chip} onPress={() => send(s)}>
                    <Text style={styles.chipText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {error && (
            <View style={styles.errorBanner}>
              <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={() => setError(null)}>
                <MaterialIcons name="close" size={14} color={Colors.danger} />
              </TouchableOpacity>
            </View>
          )}

          {/* Input */}
          <View style={[styles.inputRow, { paddingBottom: Math.max(bottom, Spacing.md) }]}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask about your restaurant…"
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={() => send(input)}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
              onPress={() => send(input)}
              disabled={!input.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator color={Colors.surface} size="small" />
              ) : (
                <MaterialIcons name="send" size={18} color={Colors.surface} />
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: Colors.background },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerLeft:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  aiAvatar:      { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primaryBg, alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  headerSub:     { fontSize: FontSize.xs, color: Colors.textMuted },
  clearBtn:      { padding: Spacing.sm },
  centered:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText:   { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing.sm },
  listContent:   { padding: Spacing.lg, gap: Spacing.sm },
  msgRow:        { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  msgRowUser:    { justifyContent: 'flex-end' },
  msgRowAI:      { justifyContent: 'flex-start' },
  aiBubbleIcon:  { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.primaryBg, alignItems: 'center', justifyContent: 'center', marginBottom: 2, flexShrink: 0 },
  bubble:        { maxWidth: '78%', borderRadius: BorderRadius.lg, padding: Spacing.md },
  bubbleUser:    { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleAI:      { backgroundColor: Colors.surface, borderBottomLeftRadius: 4, ...Shadows.sm },
  bubbleText:    { fontSize: FontSize.sm, lineHeight: 20 },
  bubbleTextUser:{ color: Colors.surface },
  bubbleTextAI:  { color: Colors.text },
  bubbleTime:    { fontSize: 10, marginTop: 4 },
  bubbleTimeUser:{ color: 'rgba(255,255,255,0.6)', textAlign: 'right' },
  bubbleTimeAI:  { color: Colors.textMuted },
  typingBubble:  { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg },
  typingDots:    { flexDirection: 'row', gap: 4, alignItems: 'center' },
  typingDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.textMuted },
  emptyState:    { alignItems: 'center', paddingVertical: 60, paddingHorizontal: Spacing.xxxl, gap: Spacing.md },
  emptyIcon:     { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.primaryBg, alignItems: 'center', justifyContent: 'center' },
  emptyTitle:    { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptySub:      { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
  suggestions:   { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  suggestLabel:  { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textMuted, marginBottom: Spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  suggestChips:  { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip:          { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: Spacing.md, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border, ...Shadows.sm },
  chipText:      { fontSize: FontSize.xs, color: Colors.textSecondary },
  errorBanner:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, backgroundColor: Colors.dangerBg },
  errorText:     { flex: 1, fontSize: FontSize.xs, color: Colors.danger },
  inputRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border },
  input:         { flex: 1, backgroundColor: Colors.background, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: FontSize.sm, color: Colors.text, maxHeight: 100, borderWidth: 1, borderColor: Colors.border },
  sendBtn:       { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  sendBtnDisabled:{ opacity: 0.5 },
});

export default AIChatScreen;
