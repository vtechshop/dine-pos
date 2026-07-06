import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, StatusBar, Modal, TextInput, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import {
  getCashiers, addCashier, updateCashier, deleteCashier,
  toggleCashier, resetCashierPin, CashierProfile,
} from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'CashierManagement'>;
type ModalMode = 'add' | 'edit' | 'pin' | null;

const CashierManagementScreen: React.FC<Props> = ({ navigation }) => {
  const { top } = useSafeAreaInsets();
  const [cashiers, setCashiers] = useState<CashierProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selected, setSelected] = useState<CashierProfile | null>(null);

  const [name, setName] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await getCashiers();
      setCashiers(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setSelected(null);
    setName(''); setEmployeeCode(''); setMobile(''); setPin(''); setFormError('');
    setModalMode('add');
  };

  const openEdit = (c: CashierProfile) => {
    setSelected(c);
    setName(c.name); setEmployeeCode(c.employeeCode); setMobile(c.mobile); setPin(''); setFormError('');
    setModalMode('edit');
  };

  const openPin = (c: CashierProfile) => {
    setSelected(c);
    setPin(''); setFormError('');
    setModalMode('pin');
  };

  const closeModal = () => { setModalMode(null); setSelected(null); };

  const handleSave = async () => {
    if (!name.trim())         { setFormError('Name is required'); return; }
    if (!employeeCode.trim()) { setFormError('Employee code is required'); return; }
    if (modalMode === 'add' && (pin.length < 4 || pin.length > 6)) {
      setFormError('PIN must be 4–6 digits'); return;
    }
    setFormError('');
    setSaving(true);
    try {
      if (modalMode === 'add') {
        const c = await addCashier({ name: name.trim(), employeeCode, pin, mobile });
        setCashiers(prev => [c, ...prev]);
      } else if (modalMode === 'edit' && selected) {
        const c = await updateCashier(selected._id, { name: name.trim(), employeeCode, mobile });
        setCashiers(prev => prev.map(x => x._id === c._id ? c : x));
      }
      closeModal();
    } catch (e: any) {
      setFormError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPin = async () => {
    if (pin.length < 4 || pin.length > 6) { setFormError('PIN must be 4–6 digits'); return; }
    setFormError('');
    setSaving(true);
    try {
      if (selected) await resetCashierPin(selected._id, pin);
      closeModal();
      Alert.alert('Success', 'PIN updated successfully');
    } catch (e: any) {
      setFormError(e.message || 'Failed to update PIN');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (c: CashierProfile) => {
    try {
      const { isActive } = await toggleCashier(c._id);
      setCashiers(prev => prev.map(x => x._id === c._id ? { ...x, isActive } : x));
    } catch { /* silent */ }
  };

  const handleDelete = (c: CashierProfile) => {
    Alert.alert('Delete Cashier', `Remove ${c.name} (${c.employeeCode})?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await deleteCashier(c._id);
            setCashiers(prev => prev.filter(x => x._id !== c._id));
          } catch { /* silent */ }
        },
      },
    ]);
  };

  const renderCashier = ({ item }: { item: CashierProfile }) => (
    <View style={[styles.card, !item.isActive && styles.cardInactive]}>
      <View style={styles.cardLeft}>
        <View style={[styles.avatar, !item.isActive && styles.avatarInactive]}>
          <Text style={{ fontSize: 22 }}>💰</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.cashierName}>{item.name}</Text>
            {!item.isActive && (
              <View style={styles.inactiveBadge}>
                <Text style={styles.inactiveBadgeText}>INACTIVE</Text>
              </View>
            )}
          </View>
          <Text style={styles.empCode}>{item.employeeCode}</Text>
          {!!item.mobile && <Text style={styles.mobile}>{item.mobile}</Text>}
        </View>
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(item)}>
          <MaterialIcons name="edit" size={18} color={Colors.info} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => openPin(item)}>
          <MaterialIcons name="lock-reset" size={18} color={Colors.warning} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => handleToggle(item)}>
          <MaterialIcons
            name={item.isActive ? 'toggle-on' : 'toggle-off'}
            size={24}
            color={item.isActive ? Colors.success : Colors.textMuted}
          />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => handleDelete(item)}>
          <MaterialIcons name="delete-outline" size={18} color={Colors.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Cashiers</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <MaterialIcons name="add" size={22} color={Colors.white} />
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.info} />
        </View>
      ) : cashiers.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>💰</Text>
          <Text style={styles.emptyTitle}>No cashiers yet</Text>
          <Text style={styles.emptySub}>Tap Add to create the first cashier account</Text>
          <TouchableOpacity style={[styles.addBtn, { marginTop: Spacing.xl }]} onPress={openAdd}>
            <MaterialIcons name="add" size={20} color={Colors.white} />
            <Text style={styles.addBtnText}>Add Cashier</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={cashiers}
          keyExtractor={c => c._id}
          renderItem={renderCashier}
          contentContainerStyle={{ padding: Spacing.md }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal visible={modalMode === 'add' || modalMode === 'edit'} transparent animationType="slide" onRequestClose={closeModal}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeModal} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{modalMode === 'add' ? 'Add Cashier' : 'Edit Cashier'}</Text>

          <View style={styles.inputWrap}>
            <MaterialIcons name="person-outline" size={18} color={Colors.textMuted} />
            <TextInput style={styles.input} placeholder="Full Name *" placeholderTextColor={Colors.textMuted}
              value={name} onChangeText={setName} />
          </View>
          <View style={styles.inputWrap}>
            <MaterialIcons name="badge" size={18} color={Colors.textMuted} />
            <TextInput style={styles.input} placeholder="Employee Code (e.g. C001) *"
              placeholderTextColor={Colors.textMuted} value={employeeCode}
              onChangeText={v => setEmployeeCode(v.toUpperCase())} autoCapitalize="characters" />
          </View>
          <View style={styles.inputWrap}>
            <MaterialIcons name="phone" size={18} color={Colors.textMuted} />
            <TextInput style={styles.input} placeholder="Mobile (optional)" placeholderTextColor={Colors.textMuted}
              value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
          </View>
          {modalMode === 'add' && (
            <View style={styles.inputWrap}>
              <MaterialIcons name="lock-outline" size={18} color={Colors.textMuted} />
              <TextInput style={[styles.input, { letterSpacing: 4 }]} placeholder="PIN (4–6 digits) *"
                placeholderTextColor={Colors.textMuted} value={pin}
                onChangeText={v => setPin(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad" secureTextEntry />
            </View>
          )}
          {!!formError && <Text style={styles.formError}>{formError}</Text>}
          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={modalMode === 'pin'} transparent animationType="slide" onRequestClose={closeModal}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeModal} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Reset PIN — {selected?.name}</Text>
          <View style={styles.inputWrap}>
            <MaterialIcons name="lock-outline" size={18} color={Colors.textMuted} />
            <TextInput style={[styles.input, { letterSpacing: 4 }]} placeholder="New PIN (4–6 digits)"
              placeholderTextColor={Colors.textMuted} value={pin}
              onChangeText={v => setPin(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad" secureTextEntry autoFocus />
          </View>
          {!!formError && <Text style={styles.formError}>{formError}</Text>}
          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleResetPin} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.saveBtnText}>Update PIN</Text>}
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.background },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  emptySub:   { fontSize: FontSize.md, color: Colors.textMuted, textAlign: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1.5, borderBottomColor: Colors.border, ...Shadows.sm,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border, marginRight: Spacing.md,
  },
  headerTitle: { flex: 1, fontSize: FontSize.xl, fontWeight: '900', color: Colors.text },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.info, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
  },
  addBtnText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.md },
  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
    flexDirection: 'row', alignItems: 'center', ...Shadows.sm,
  },
  cardInactive: { opacity: 0.6 },
  cardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: Colors.infoBg, alignItems: 'center', justifyContent: 'center',
  },
  avatarInactive: { backgroundColor: Colors.elevated },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  cashierName:   { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  inactiveBadge: { backgroundColor: Colors.danger + '20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  inactiveBadgeText: { fontSize: 9, fontWeight: '800', color: Colors.danger, letterSpacing: 0.5 },
  empCode: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },
  mobile:  { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 1 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionBtn: { padding: 8, borderRadius: 10 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: Spacing.xl, paddingBottom: 40,
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  sheetHandle: { width: 36, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.lg },
  sheetTitle: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.text, marginBottom: Spacing.lg },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.background, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  input: { flex: 1, paddingVertical: 13, fontSize: FontSize.md, color: Colors.text },
  formError: { color: Colors.danger, fontSize: FontSize.sm, marginBottom: Spacing.sm, paddingLeft: 4 },
  saveBtn: {
    backgroundColor: Colors.info, borderRadius: BorderRadius.xl,
    paddingVertical: 14, alignItems: 'center', marginTop: Spacing.md,
  },
  saveBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
});

export default CashierManagementScreen;
