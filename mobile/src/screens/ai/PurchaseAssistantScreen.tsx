import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, ScrollView, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, OcrJob, OcrReviewScreen } from '../../types';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../../utils/constants';
import { getAIOcrJobs, getAIOcrJobReview, approveAIOcrJob, rejectAIOcrJob } from '../../services/api';
import { useSettings } from '../../context/SettingsContext';
import { OfflineIndicator } from '../../components/OfflineIndicator';

type Props = NativeStackScreenProps<RootStackParamList, 'PurchaseAssistant'>;

function fmt(n: number | undefined, cur: string) {
  if (n === undefined) return '—';
  return `${cur}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_COLORS: Record<string, string> = {
  pending:    Colors.warning,
  processing: Colors.info,
  completed:  Colors.success,
  failed:     Colors.danger,
  rejected:   Colors.textMuted,
};

const STATUS_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  pending:    'hourglass-empty',
  processing: 'sync',
  completed:  'check-circle',
  failed:     'error',
  rejected:   'cancel',
};

const PurchaseAssistantScreen: React.FC<Props> = () => {
  const { settings } = useSettings();
  const { top } = useSafeAreaInsets();
  const cur = settings.currencySymbol || '₹';

  const [jobs, setJobs]             = useState<OcrJob[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const [selectedJob, setSelectedJob] = useState<OcrJob | null>(null);
  const [review, setReview]           = useState<OcrReviewScreen | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError]     = useState<string | null>(null);
  const [submitting, setSubmitting]       = useState(false);
  const [submitError, setSubmitError]     = useState<string | null>(null);
  const [detailOpen, setDetailOpen]       = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      setError(null);
      const data = await getAIOcrJobs(20);
      setJobs(data.jobs);
    } catch (e: any) {
      setError(e.message || 'Failed to load OCR jobs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadJobs(); }, [loadJobs]));
  const onRefresh = useCallback(() => { setRefreshing(true); loadJobs(); }, [loadJobs]);

  const openReview = useCallback(async (job: OcrJob) => {
    setSelectedJob(job);
    setReview(null);
    setReviewError(null);
    setSubmitError(null);
    setDetailOpen(true);
    setReviewLoading(true);
    try {
      const data = await getAIOcrJobReview(job._id);
      setReview(data);
    } catch (e: any) {
      setReviewError(e.message || 'Failed to load review');
    } finally {
      setReviewLoading(false);
    }
  }, []);

  const handleApprove = useCallback(async () => {
    if (!selectedJob) return;
    const vendorId = review?.vendorMatches?.[0]?.vendorId;
    Alert.alert(
      'Approve Invoice',
      'Create a purchase order from this invoice?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve', style: 'default',
          onPress: async () => {
            setSubmitting(true);
            setSubmitError(null);
            try {
              await approveAIOcrJob(selectedJob._id, vendorId);
              setDetailOpen(false);
              loadJobs();
              Alert.alert('Success', 'Purchase order created successfully.');
            } catch (e: any) {
              setSubmitError(e.message || 'Failed to approve invoice');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  }, [selectedJob, review, loadJobs]);

  const handleReject = useCallback(async () => {
    if (!selectedJob) return;
    Alert.alert(
      'Reject Invoice',
      'Reject this OCR job? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject', style: 'destructive',
          onPress: async () => {
            setSubmitting(true);
            setSubmitError(null);
            try {
              await rejectAIOcrJob(selectedJob._id);
              setDetailOpen(false);
              loadJobs();
            } catch (e: any) {
              setSubmitError(e.message || 'Failed to reject invoice');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  }, [selectedJob, loadJobs]);

  const renderJob = ({ item }: { item: OcrJob }) => {
    const statusColor = STATUS_COLORS[item.status] || Colors.textMuted;
    const statusIcon  = STATUS_ICONS[item.status]  || 'help';
    const canReview   = item.status === 'completed';
    return (
      <TouchableOpacity
        style={[styles.jobCard, !canReview && styles.jobCardDim]}
        onPress={() => canReview ? openReview(item) : null}
        activeOpacity={canReview ? 0.7 : 1}
      >
        <View style={styles.jobLeft}>
          <View style={[styles.jobIcon, { backgroundColor: statusColor + '18' }]}>
            <MaterialIcons name={statusIcon} size={20} color={statusColor} />
          </View>
          <View style={styles.jobInfo}>
            <Text style={styles.jobName} numberOfLines={1}>{item.fileName}</Text>
            <Text style={styles.jobMeta}>
              {fmtSize(item.fileSizeBytes)} · {new Date(item.createdAt).toLocaleDateString('en-IN')}
            </Text>
            {item.extractedData?.totalAmount !== undefined && (
              <Text style={styles.jobAmount}>{fmt(item.extractedData.totalAmount, cur)}</Text>
            )}
            {item.errorMessage && (
              <Text style={styles.jobError} numberOfLines={1}>{item.errorMessage}</Text>
            )}
          </View>
        </View>
        <View style={styles.jobRight}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{item.status.toUpperCase()}</Text>
          </View>
          {canReview && <MaterialIcons name="chevron-right" size={18} color={Colors.textMuted} style={{ marginTop: 4 }} />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.root}>
      <OfflineIndicator />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <MaterialIcons name="document-scanner" size={20} color={Colors.primary} />
          </View>
          <View>
            <Text style={styles.headerTitle}>OCR Purchase Assistant</Text>
            <Text style={styles.headerSub}>AI invoice extraction & review</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={() => { setRefreshing(true); loadJobs(); }}>
          <MaterialIcons name="refresh" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading && !refreshing && (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading OCR jobs…</Text>
        </View>
      )}

      {!loading && error && (
        <View style={styles.errorBox}>
          <MaterialIcons name="error-outline" size={20} color={Colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); loadJobs(); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && jobs.length === 0 && (
        <View style={styles.emptyBox}>
          <MaterialIcons name="document-scanner" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No OCR Jobs</Text>
          <Text style={styles.emptySub}>Upload invoices via the web dashboard to process them with AI.</Text>
        </View>
      )}

      {!loading && jobs.length > 0 && (
        <FlatList
          data={jobs}
          keyExtractor={item => item._id}
          renderItem={renderJob}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Review Modal */}
      <Modal
        visible={detailOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDetailOpen(false)}
      >
        <View style={[styles.modalRoot, { paddingTop: top }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setDetailOpen(false)}>
              <MaterialIcons name="arrow-back" size={20} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle} numberOfLines={1}>{selectedJob?.fileName ?? 'Review'}</Text>
            <View style={{ width: 36 }} />
          </View>

          {reviewLoading && (
            <View style={styles.centered}>
              <ActivityIndicator color={Colors.primary} size="large" />
              <Text style={styles.loadingText}>Extracting invoice data…</Text>
            </View>
          )}

          {reviewError && !reviewLoading && (
            <View style={styles.errorBox}>
              <MaterialIcons name="error-outline" size={20} color={Colors.danger} />
              <Text style={styles.errorText}>{reviewError}</Text>
            </View>
          )}

          {!reviewLoading && review && (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              {/* Duplicate Warning */}
              {review.duplicateWarning?.isDuplicate && (
                <View style={styles.dupWarn}>
                  <MaterialIcons name="warning" size={16} color="#92400E" />
                  <Text style={styles.dupWarnText}>{review.duplicateWarning.reason}</Text>
                </View>
              )}

              {/* Extracted Data */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Extracted Invoice</Text>
                {[
                  ['Invoice #', review.extractedData?.invoiceNumber],
                  ['Date', review.extractedData?.invoiceDate],
                  ['Vendor', review.extractedData?.vendorName],
                  ['GST', review.extractedData?.vendorGST],
                  ['Total', review.extractedData?.totalAmount !== undefined ? fmt(review.extractedData.totalAmount, cur) : undefined],
                  ['Tax', review.extractedData?.taxAmount !== undefined ? fmt(review.extractedData.taxAmount, cur) : undefined],
                ].map(([l, v]) => v !== undefined && (
                  <View key={l as string} style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{l}</Text>
                    <Text style={styles.fieldValue}>{v}</Text>
                  </View>
                ))}
              </View>

              {/* Line Items */}
              {review.extractedData?.lineItems && review.extractedData.lineItems.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Line Items</Text>
                  {review.extractedData.lineItems.map((li, i) => (
                    <View key={i} style={styles.lineItemRow}>
                      <View style={styles.lineItemLeft}>
                        <Text style={styles.lineItemDesc}>{li.description}</Text>
                        <Text style={styles.lineItemMeta}>
                          {li.qty} {li.unit ?? ''} × {fmt(li.unitPrice, cur)}
                        </Text>
                      </View>
                      <Text style={styles.lineItemTotal}>{fmt(li.total, cur)}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Vendor Matches */}
              {review.vendorMatches && review.vendorMatches.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Vendor Matches</Text>
                  {review.vendorMatches.map((v, i) => (
                    <View key={i} style={[styles.vendorRow, i === 0 && styles.vendorRowBest]}>
                      <View style={styles.vendorLeft}>
                        <Text style={styles.vendorName}>{v.businessName}</Text>
                        <Text style={styles.vendorGST}>GST: {v.gstNumber}</Text>
                      </View>
                      <View style={styles.vendorRight}>
                        <Text style={[styles.vendorConf, { color: v.confidence >= 0.8 ? Colors.success : v.confidence >= 0.5 ? Colors.warning : Colors.danger }]}>
                          {(v.confidence * 100).toFixed(0)}%
                        </Text>
                        {i === 0 && <Text style={styles.vendorBestTag}>Best Match</Text>}
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Submit Error */}
              {submitError && (
                <View style={styles.submitError}>
                  <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
                  <Text style={styles.submitErrorText}>{submitError}</Text>
                </View>
              )}

              {/* Actions */}
              {review.status === 'completed' && (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.rejectBtn, submitting && styles.btnDisabled]}
                    onPress={handleReject}
                    disabled={submitting}
                  >
                    {submitting ? <ActivityIndicator color={Colors.danger} size="small" /> : (
                      <>
                        <MaterialIcons name="cancel" size={16} color={Colors.danger} />
                        <Text style={styles.rejectBtnText}>Reject</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.approveBtn, submitting && styles.btnDisabled]}
                    onPress={handleApprove}
                    disabled={submitting}
                  >
                    {submitting ? <ActivityIndicator color={Colors.surface} size="small" /> : (
                      <>
                        <MaterialIcons name="check-circle" size={16} color={Colors.surface} />
                        <Text style={styles.approveBtnText}>Approve & Create PO</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: Colors.background },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerLeft:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerIcon:    { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primaryBg, alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  headerSub:     { fontSize: FontSize.xs, color: Colors.textMuted },
  refreshBtn:    { padding: Spacing.sm },
  centered:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText:   { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing.sm },
  errorBox:      { margin: Spacing.lg, backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  errorText:     { fontSize: FontSize.sm, color: Colors.danger, textAlign: 'center' },
  retryBtn:      { backgroundColor: Colors.danger, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText:     { fontSize: FontSize.sm, fontWeight: '600', color: Colors.surface },
  emptyBox:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxxl, gap: Spacing.md },
  emptyTitle:    { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub:      { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  listContent:   { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxxl },
  jobCard:       { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...Shadows.sm },
  jobCardDim:    { opacity: 0.75 },
  jobLeft:       { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, flex: 1, marginRight: Spacing.sm },
  jobIcon:       { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  jobInfo:       { flex: 1 },
  jobName:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  jobMeta:       { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  jobAmount:     { fontSize: FontSize.sm, fontWeight: '700', color: Colors.success, marginTop: 4 },
  jobError:      { fontSize: FontSize.xs, color: Colors.danger, marginTop: 2 },
  jobRight:      { alignItems: 'flex-end' },
  statusBadge:   { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  statusText:    { fontSize: FontSize.xs, fontWeight: '700' },
  modalRoot:     { flex: 1, backgroundColor: Colors.background },
  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:       { padding: 4 },
  modalTitle:    { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  scroll:        { flex: 1 },
  scrollContent: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxxl },
  dupWarn:       { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: '#FEF3C7', borderRadius: BorderRadius.md, padding: Spacing.md },
  dupWarnText:   { flex: 1, fontSize: FontSize.sm, color: '#92400E' },
  card:          { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, ...Shadows.sm },
  cardTitle:     { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  fieldRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  fieldLabel:    { fontSize: FontSize.sm, color: Colors.textMuted },
  fieldValue:    { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, maxWidth: '60%', textAlign: 'right' },
  lineItemRow:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  lineItemLeft:  { flex: 1, marginRight: Spacing.md },
  lineItemDesc:  { fontSize: FontSize.sm, fontWeight: '500', color: Colors.text },
  lineItemMeta:  { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  lineItemTotal: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  vendorRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  vendorRowBest: { backgroundColor: Colors.successBg, borderRadius: BorderRadius.sm, padding: Spacing.sm, marginBottom: Spacing.xs },
  vendorLeft:    { flex: 1 },
  vendorName:    { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  vendorGST:     { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  vendorRight:   { alignItems: 'flex-end' },
  vendorConf:    { fontSize: FontSize.lg, fontWeight: '800' },
  vendorBestTag: { fontSize: FontSize.xs, color: Colors.success, fontWeight: '600', marginTop: 2 },
  submitError:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.sm, padding: Spacing.md },
  submitErrorText:{ flex: 1, fontSize: FontSize.sm, color: Colors.danger },
  actionRow:     { flexDirection: 'row', gap: Spacing.md },
  rejectBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: Colors.danger, borderRadius: BorderRadius.md, paddingVertical: Spacing.md },
  rejectBtnText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.danger },
  approveBtn:    { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: Spacing.md },
  approveBtnText:{ fontSize: FontSize.md, fontWeight: '700', color: Colors.surface },
  btnDisabled:   { opacity: 0.5 },
});

export default PurchaseAssistantScreen;
