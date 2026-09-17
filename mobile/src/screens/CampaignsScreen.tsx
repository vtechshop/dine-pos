import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { Campaign, CampaignStatus, CampaignChannel, AudienceSegment } from '../services/api';
import { PremiumGate } from '../components/PremiumGate';

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUDIENCE_LABELS: Record<AudienceSegment, string> = {
  all:      'All Customers',
  loyalty:  'Loyalty Members',
  frequent: 'Frequent Visitors',
  inactive: 'Inactive Customers',
  custom:   'Custom',
};

const STATUS_FILTERS: Array<CampaignStatus | 'all'> = ['all', 'draft', 'scheduled', 'sent', 'failed'];

function statusStyle(status: CampaignStatus): { bg: string; color: string } {
  switch (status) {
    case 'draft':     return { bg: 'rgba(97,97,97,0.12)',    color: '#616161' };
    case 'scheduled': return { bg: Colors.infoBg,            color: Colors.info };
    case 'sending':   return { bg: Colors.infoBg,            color: Colors.info };
    case 'sent':      return { bg: Colors.successBg,         color: Colors.success };
    case 'cancelled': return { bg: 'rgba(97,97,97,0.12)',    color: '#616161' };
    case 'failed':    return { bg: Colors.dangerBg,          color: Colors.danger };
  }
}

function channelStyle(channel: CampaignChannel): { bg: string; color: string } {
  return channel === 'whatsapp'
    ? { bg: Colors.whatsAppBg, color: Colors.whatsApp }
    : { bg: Colors.infoBg,     color: Colors.info };
}

// ── Main Component ────────────────────────────────────────────────────────────

const CampaignsScreen: React.FC = () => {
  const { bottom } = useSafeAreaInsets();

  const [campaigns, setCampaigns]   = useState<Campaign[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [pages, setPages]           = useState(1);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'all'>('all');

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving]       = useState(false);
  const emptyForm = () => ({
    name:         '',
    channel:      'whatsapp' as CampaignChannel,
    audience:     'all' as AudienceSegment,
    templateName: '',
    message:      '',
  });
  const [form, setForm] = useState(emptyForm());

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async (p = 1, refresh = false) => {
    if (p === 1) refresh ? setRefreshing(true) : setLoading(true);
    try {
      const params: Parameters<typeof api.fetchCampaigns>[0] = { page: p, limit: 20 };
      if (statusFilter !== 'all') params.status = statusFilter;
      const data = await api.fetchCampaigns(params);
      if (p === 1) setCampaigns(data.campaigns);
      else setCampaigns(prev => [...prev, ...data.campaigns]);
      setTotal(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch {
      Alert.alert('Error', 'Failed to load campaigns');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter]);

  useFocusEffect(useCallback(() => { load(1); }, [load]));

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleSend = (item: Campaign) => {
    Alert.alert(
      'Send Campaign',
      `Send "${item.name}" to ~${item.recipientCount} recipients?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send', onPress: async () => {
            try {
              await api.sendCampaign(item._id);
              load(1);
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Failed to send campaign');
            }
          },
        },
      ],
    );
  };

  const handleDelete = (item: Campaign) => {
    Alert.alert(
      'Delete Campaign',
      `Delete "${item.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              await api.deleteCampaign(item._id);
              load(1);
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Failed to delete campaign');
            }
          },
        },
      ],
    );
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { Alert.alert('Validation', 'Campaign name is required'); return; }
    if (form.channel === 'whatsapp' && !form.templateName.trim()) {
      Alert.alert('Validation', 'Template name is required for WhatsApp campaigns');
      return;
    }
    if (form.channel === 'sms' && !form.message.trim()) {
      Alert.alert('Validation', 'Message is required for SMS campaigns');
      return;
    }
    setSaving(true);
    try {
      await api.createCampaign({
        name:         form.name.trim(),
        channel:      form.channel,
        audience:     form.audience,
        templateName: form.channel === 'whatsapp' ? form.templateName.trim() : undefined,
        message:      form.channel === 'sms' ? form.message.trim() : undefined,
      });
      setShowModal(false);
      setForm(emptyForm());
      load(1);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create campaign');
    } finally {
      setSaving(false);
    }
  };

  // ── Render Item ───────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: Campaign }) => {
    const ss = statusStyle(item.status);
    const cs = channelStyle(item.channel);
    const isDraft = item.status === 'draft';
    return (
      <View style={styles.card}>
        {/* Row 1: name + badges */}
        <View style={styles.cardRow}>
          <Text style={styles.campaignName} numberOfLines={1}>{item.name}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: cs.bg }]}>
              <Text style={[styles.badgeTxt, { color: cs.color }]}>
                {item.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: ss.bg }]}>
              {item.status === 'sending'
                ? <ActivityIndicator size={10} color={Colors.info} style={{ marginRight: 4 }} />
                : null}
              <Text style={[styles.badgeTxt, { color: ss.color }]}>
                {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
              </Text>
            </View>
          </View>
        </View>

        {/* Row 2: audience */}
        <Text style={styles.cardMeta}>
          <Text style={styles.metaLabel}>Audience: </Text>
          {AUDIENCE_LABELS[item.audience] || item.audience}
        </Text>

        {/* Row 3: delivery stats (only if sent) */}
        {item.status === 'sent' && (
          <Text style={styles.cardMeta}>
            <Text style={styles.metaLabel}>Delivered: </Text>
            {item.deliveredCount} / {item.recipientCount}
          </Text>
        )}

        {/* Row 4: date */}
        <Text style={styles.cardDate}>
          {new Date(item.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </Text>

        {/* Draft actions */}
        {isDraft && (
          <View style={styles.cardActions}>
            <TouchableOpacity style={styles.actionBtnSend} onPress={() => handleSend(item)}>
              <MaterialIcons name="send" size={14} color={Colors.white} />
              <Text style={styles.actionBtnSendTxt}>Send</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtnDelete} onPress={() => handleDelete(item)}>
              <MaterialIcons name="delete-outline" size={14} color={Colors.danger} />
              <Text style={styles.actionBtnDeleteTxt}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  // ── Create Modal ──────────────────────────────────────────────────────────

  const AUDIENCE_OPTIONS: AudienceSegment[] = ['all', 'loyalty', 'frequent', 'inactive'];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Campaigns</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => { setForm(emptyForm()); setShowModal(true); }}
        >
          <MaterialIcons name="add" size={22} color={Colors.white} />
        </TouchableOpacity>
      </View>

      {/* Status filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}
      >
        {STATUS_FILTERS.map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
            onPress={() => setStatusFilter(s)}
          >
            <Text style={[styles.filterChipTxt, statusFilter === s && styles.filterChipTxtActive]}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* List */}
      {loading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={campaigns}
          renderItem={renderItem}
          keyExtractor={i => i._id}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={() => load(1, true)}
          onEndReached={() => { if (page < pages) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            page < pages
              ? <ActivityIndicator color={Colors.primary} style={{ margin: 16 }} />
              : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="campaign" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No campaigns yet</Text>
              <Text style={styles.emptyText}>Tap + to create your first campaign</Text>
            </View>
          }
        />
      )}

      {/* Create Campaign Modal */}
      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.overlay}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={[styles.sheet, { paddingBottom: 40 + bottom }]}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>New Campaign</Text>

              {/* Name */}
              <Text style={styles.label}>Campaign Name *</Text>
              <TextInput
                style={styles.input}
                value={form.name}
                onChangeText={v => setForm(p => ({ ...p, name: v }))}
                placeholder="e.g. Weekend Offer"
                placeholderTextColor={Colors.textMuted}
              />

              {/* Channel toggle */}
              <Text style={styles.label}>Channel</Text>
              <View style={styles.segmentRow}>
                {(['whatsapp', 'sms'] as CampaignChannel[]).map(ch => (
                  <TouchableOpacity
                    key={ch}
                    style={[styles.segment, form.channel === ch && styles.segmentActive]}
                    onPress={() => setForm(p => ({ ...p, channel: ch }))}
                  >
                    <MaterialIcons
                      name={ch === 'whatsapp' ? 'chat' : 'sms'}
                      size={16}
                      color={form.channel === ch ? Colors.white : Colors.textSecondary}
                    />
                    <Text style={[styles.segmentTxt, form.channel === ch && styles.segmentTxtActive]}>
                      {ch === 'whatsapp' ? 'WhatsApp' : 'SMS'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Audience chips */}
              <Text style={styles.label}>Audience Segment</Text>
              <View style={styles.audienceGrid}>
                {AUDIENCE_OPTIONS.map(a => (
                  <TouchableOpacity
                    key={a}
                    style={[styles.audienceChip, form.audience === a && styles.audienceChipActive]}
                    onPress={() => setForm(p => ({ ...p, audience: a }))}
                  >
                    <Text style={[styles.audienceChipTxt, form.audience === a && styles.audienceChipTxtActive]}>
                      {AUDIENCE_LABELS[a]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Template name (WhatsApp only) */}
              {form.channel === 'whatsapp' && (
                <>
                  <Text style={styles.label}>Template Name *</Text>
                  <TextInput
                    style={styles.input}
                    value={form.templateName}
                    onChangeText={v => setForm(p => ({ ...p, templateName: v }))}
                    placeholder="e.g. promo_weekend_offer"
                    placeholderTextColor={Colors.textMuted}
                  />
                </>
              )}

              {/* Message (SMS only) */}
              {form.channel === 'sms' && (
                <>
                  <Text style={styles.label}>Message *</Text>
                  <TextInput
                    style={[styles.input, styles.inputMulti]}
                    value={form.message}
                    onChangeText={v => setForm(p => ({ ...p, message: v }))}
                    placeholder="Type your SMS message here..."
                    placeholderTextColor={Colors.textMuted}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                </>
              )}

              {/* Actions */}
              <View style={styles.mActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setShowModal(false)}
                >
                  <Text style={styles.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                  onPress={handleCreate}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.saveTxt}>Save as Draft</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  addBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    ...Shadows.primary,
  },

  filterBar:        { maxHeight: 48, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  filterBarContent: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm, alignItems: 'center' as const },
  filterChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.round,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  filterChipActive:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipTxt:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  filterChipTxtActive: { color: Colors.white },

  list: { padding: Spacing.lg, paddingBottom: 100 },

  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg,
    marginBottom: Spacing.md, ...Shadows.sm,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 },
  campaignName: { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: FontSize.xs, fontWeight: '700' },
  cardMeta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: 4 },
  metaLabel: { fontWeight: '600', color: Colors.textMuted },
  cardDate: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  cardActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: Spacing.md },

  actionBtnSend: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderRadius: BorderRadius.md, ...Shadows.primary,
  },
  actionBtnSendTxt: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '700' },
  actionBtnDelete: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.dangerBg, paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.danger + '40',
  },
  actionBtnDeleteTxt: { color: Colors.danger, fontSize: FontSize.sm, fontWeight: '700' },

  empty:      { alignItems: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.lg },
  emptyText:  { color: Colors.textSecondary, marginTop: Spacing.sm },

  // Modal
  overlay: { flex: 1, backgroundColor: Colors.overlay },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xxxl, borderTopRightRadius: BorderRadius.xxxl,
    padding: Spacing.xxl, paddingBottom: 40, marginTop: 60,
  },
  handle:     { width: 44, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg },
  sheetTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, textAlign: 'center', marginBottom: Spacing.lg },

  label: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600', marginBottom: 6, marginTop: Spacing.md },
  input: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: Spacing.lg, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.text,
  },
  inputMulti: { minHeight: 100, paddingTop: 12 },

  segmentRow: { flexDirection: 'row', gap: Spacing.sm },
  segment: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  segmentActive:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  segmentTxt:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  segmentTxtActive: { color: Colors.white },

  audienceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  audienceChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: BorderRadius.round,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  audienceChipActive:    { backgroundColor: Colors.primaryBg, borderColor: Colors.primary },
  audienceChipTxt:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  audienceChipTxtActive: { color: Colors.primary, fontWeight: '700' },

  mActions:  { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  cancelTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: FontSize.lg },
  saveBtn:   { flex: 2, paddingVertical: 14, borderRadius: BorderRadius.lg, backgroundColor: Colors.primary, alignItems: 'center', ...Shadows.primary },
  saveTxt:   { color: Colors.white, fontWeight: '800', fontSize: FontSize.lg },
});

// ── Gated Export ──────────────────────────────────────────────────────────────

const CampaignsScreenGated: React.FC = () => (
  <PremiumGate feature="Campaigns" description="Create and send WhatsApp and SMS campaigns to your customers.">
    <CampaignsScreen />
  </PremiumGate>
);

export default CampaignsScreenGated;
