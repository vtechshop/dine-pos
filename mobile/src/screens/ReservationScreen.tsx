import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { Reservation } from '../types';

const STATUS_COLORS: Record<Reservation['status'], { text: string; bg: string }> = {
  confirmed: { text: Colors.info,    bg: Colors.infoBg },
  seated:    { text: Colors.success, bg: Colors.successBg },
  cancelled: { text: Colors.danger,  bg: Colors.dangerBg },
  'no-show': { text: Colors.textMuted, bg: Colors.elevated },
};

const todayStr = () => new Date().toISOString().slice(0, 10);

const fmtDate = (s: string) => {
  const d = new Date(s);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const ReservationScreen: React.FC = () => {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading]           = useState(true);
  const [date, setDate]                 = useState(todayStr());
  const [showModal, setShowModal]       = useState(false);
  const [saving, setSaving]             = useState(false);

  const emptyForm = { customerName: '', phone: '', partySize: '2', date: todayStr(), time: '19:00', tableNumber: '', notes: '' };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getReservations(date);
      setReservations(data);
    } catch { Alert.alert('Error', 'Failed to load reservations'); }
    finally { setLoading(false); }
  }, [date]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => { setForm({ ...emptyForm, date }); setShowModal(true); };

  const save = async () => {
    if (!form.customerName.trim() || !form.phone.trim()) {
      Alert.alert('Error', 'Name and phone are required'); return;
    }
    setSaving(true);
    try {
      await api.createReservation({
        customerName: form.customerName.trim(),
        phone:        form.phone.trim(),
        partySize:    parseInt(form.partySize) || 2,
        date:         form.date,
        time:         form.time,
        tableNumber:  form.tableNumber ? parseInt(form.tableNumber) : undefined,
        notes:        form.notes.trim(),
      });
      setShowModal(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const changeStatus = (r: Reservation) => {
    const opts: Reservation['status'][] = ['confirmed', 'seated', 'cancelled', 'no-show'];
    Alert.alert('Update Status', `${r.customerName} — ${r.time}`, [
      ...opts.map(s => ({
        text: s.charAt(0).toUpperCase() + s.slice(1),
        onPress: async () => {
          try { await api.updateReservationStatus(r._id, s); load(); }
          catch { Alert.alert('Error', 'Failed to update'); }
        },
      })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const del = (r: Reservation) => {
    Alert.alert('Delete?', `Remove reservation for ${r.customerName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await api.deleteReservation(r._id); load(); }
          catch { Alert.alert('Error', 'Failed'); }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: Reservation }) => {
    const sc = STATUS_COLORS[item.status];
    return (
      <TouchableOpacity style={styles.card} onPress={() => changeStatus(item)} activeOpacity={0.85}>
        <View style={styles.cardLeft}>
          <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
            <Text style={[styles.statusTxt, { color: sc.text }]}>{item.status}</Text>
          </View>
          <Text style={styles.name}>{item.customerName}</Text>
          <Text style={styles.meta}>
            {item.time}  ·  {item.partySize} pax
            {item.tableNumber ? `  ·  Table ${item.tableNumber}` : ''}
          </Text>
          <Text style={styles.phone}>{item.phone}</Text>
          {item.notes ? <Text style={styles.notes} numberOfLines={1}>{item.notes}</Text> : null}
        </View>
        <TouchableOpacity style={styles.delBtn} onPress={() => del(item)}>
          <MaterialIcons name="delete-outline" size={20} color={Colors.danger} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Reservations</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <MaterialIcons name="add" size={22} color={Colors.white} />
        </TouchableOpacity>
      </View>

      {/* Date picker row */}
      <View style={styles.datePicker}>
        <TouchableOpacity
          style={styles.dateArrow}
          onPress={() => {
            const d = new Date(date); d.setDate(d.getDate() - 1);
            setDate(d.toISOString().slice(0, 10));
          }}
        >
          <MaterialIcons name="chevron-left" size={26} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.dateText}>{fmtDate(date)}</Text>
        <TouchableOpacity
          style={styles.dateArrow}
          onPress={() => {
            const d = new Date(date); d.setDate(d.getDate() + 1);
            setDate(d.toISOString().slice(0, 10));
          }}
        >
          <MaterialIcons name="chevron-right" size={26} color={Colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.todayBtn} onPress={() => setDate(todayStr())}>
          <Text style={styles.todayTxt}>Today</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={reservations}
          renderItem={renderItem}
          keyExtractor={r => r._id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="event-available" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No Reservations</Text>
              <Text style={styles.emptyText}>Tap + to add a booking for this date</Text>
            </View>
          }
        />
      )}

      {/* Add Modal */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={styles.overlay}>
          <ScrollView>
            <View style={styles.modal}>
              <View style={styles.handle} />
              <Text style={styles.modalTitle}>New Reservation</Text>

              {[
                { label: 'Customer Name *', key: 'customerName', placeholder: 'Ramesh Kumar' },
                { label: 'Phone *', key: 'phone', placeholder: '98765 43210', kb: 'phone-pad' },
                { label: 'Party Size', key: 'partySize', placeholder: '2', kb: 'number-pad' },
                { label: 'Date (YYYY-MM-DD)', key: 'date', placeholder: todayStr() },
                { label: 'Time (HH:MM)', key: 'time', placeholder: '19:00' },
                { label: 'Table Number (optional)', key: 'tableNumber', placeholder: 'e.g. 5', kb: 'number-pad' },
                { label: 'Notes', key: 'notes', placeholder: 'Anniversary, window seat...' },
              ].map(f => (
                <View key={f.key}>
                  <Text style={styles.label}>{f.label}</Text>
                  <TextInput
                    style={styles.input}
                    value={(form as any)[f.key]}
                    onChangeText={v => setForm(p => ({ ...p, [f.key]: v }))}
                    placeholder={f.placeholder}
                    placeholderTextColor={Colors.textMuted}
                    keyboardType={(f.kb as any) || 'default'}
                  />
                </View>
              ))}

              <View style={styles.mActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={styles.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                  {saving ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.saveTxt}>Book</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.background },
  loader:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  addBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', ...Shadows.primary,
  },

  datePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.md, backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border, gap: Spacing.sm,
  },
  dateArrow: { padding: Spacing.sm },
  dateText:  { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, minWidth: 140, textAlign: 'center' },
  todayBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    backgroundColor: Colors.primaryBg, borderRadius: BorderRadius.round,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  todayTxt: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700' },

  list: { padding: Spacing.lg, paddingBottom: 100 },
  card: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadows.sm,
  },
  cardLeft:    { flex: 1 },
  statusPill:  { alignSelf: 'flex-start', paddingHorizontal: Spacing.md, paddingVertical: 3, borderRadius: BorderRadius.round, marginBottom: 6 },
  statusTxt:   { fontSize: FontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  name:        { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  meta:        { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  phone:       { fontSize: FontSize.sm, color: Colors.info, marginTop: 2 },
  notes:       { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  delBtn:      { padding: Spacing.sm },

  empty:      { alignItems: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.lg },
  emptyText:  { color: Colors.textSecondary, marginTop: Spacing.sm },

  overlay: { flex: 1, backgroundColor: Colors.overlay },
  modal: {
    backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.xxxl,
    borderTopRightRadius: BorderRadius.xxxl, padding: Spacing.xxl, paddingBottom: 40,
    marginTop: 80,
  },
  handle:      { width: 44, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg },
  modalTitle:  { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, textAlign: 'center', marginBottom: Spacing.lg },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600', marginBottom: 6, marginTop: Spacing.md },
  input: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: Spacing.lg, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.text,
  },
  mActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: BorderRadius.lg,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center',
  },
  cancelTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: FontSize.lg },
  saveBtn:   {
    flex: 2, paddingVertical: 14, borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary, alignItems: 'center', ...Shadows.primary,
  },
  saveTxt: { color: Colors.white, fontWeight: '800', fontSize: FontSize.lg },
});

export default ReservationScreen;
