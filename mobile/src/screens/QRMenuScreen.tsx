import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Share,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettings } from '../context/SettingsContext';
import { Colors } from '../utils/constants';
import { API_BASE_URL } from '../utils/constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PremiumGate } from '../components/PremiumGate';

// Derive the menu base URL from the API URL: strip /api → /menu
const DEFAULT_MENU_BASE = API_BASE_URL.replace(/\/api\/?$/, '/menu');

const TABLE_COUNT_KEY = 'qr_table_count';
const CUSTOM_URL_KEY  = 'qr_custom_menu_base';

function QRMenuScreenInner() {
  const { bottom } = useSafeAreaInsets();
  const { settings } = useSettings();
  const [tableCount,     setTableCount]     = useState(5);
  const [tempTableCount, setTempTableCount] = useState('5');
  const [selectedTable,  setSelectedTable]  = useState<number | null>(null);
  const [customBase,     setCustomBase]     = useState('');
  const [editingURL,     setEditingURL]     = useState(false);
  const [tempURL,        setTempURL]        = useState('');

  const menuBase = customBase || DEFAULT_MENU_BASE;
  const tableURL = (t: number) => `${menuBase}?table=${t}`;

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(TABLE_COUNT_KEY),
      AsyncStorage.getItem(CUSTOM_URL_KEY),
    ]).then(([tc, cu]) => {
      if (tc) { setTableCount(parseInt(tc, 10)); setTempTableCount(tc); }
      if (cu) setCustomBase(cu);
    });
  }, []);

  const saveTableCount = async () => {
    const n = parseInt(tempTableCount, 10);
    if (!n || n < 1 || n > 50) return;
    setTableCount(n);
    await AsyncStorage.setItem(TABLE_COUNT_KEY, String(n));
  };

  const saveURL = async () => {
    const url = tempURL.trim().replace(/\/$/, '');
    setCustomBase(url);
    setEditingURL(false);
    if (url) {
      await AsyncStorage.setItem(CUSTOM_URL_KEY, url);
    } else {
      await AsyncStorage.removeItem(CUSTOM_URL_KEY);
    }
  };

  const resetURL = async () => {
    setCustomBase('');
    setTempURL('');
    setEditingURL(false);
    await AsyncStorage.removeItem(CUSTOM_URL_KEY);
  };

  const shareTable = async (tableNum: number) => {
    try {
      await Share.share({
        message: `Table ${tableNum} Menu: ${tableURL(tableNum)}`,
        url: tableURL(tableNum),
      });
    } catch (_) {}
  };

  const tables = Array.from({ length: tableCount }, (_, i) => i + 1);

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: 48 + bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <MaterialIcons name="qr-code-2" size={32} color={Colors.primary} />
        <Text style={styles.title}>Table QR Codes</Text>
        <Text style={styles.subtitle}>
          Customers scan → view menu → place order instantly
        </Text>
      </View>

      {/* How it works */}
      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>⚡ How It Works</Text>
        {[
          '1️⃣  Print QR code and place on each table',
          '2️⃣  Customer scans with camera (works over internet)',
          '3️⃣  Menu opens in browser — add items & place order',
          '4️⃣  Order appears instantly in Admin → Orders tab',
        ].map((step, i) => (
          <Text key={i} style={styles.infoStep}>{step}</Text>
        ))}
      </View>

      {/* Menu URL */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Menu URL</Text>
        {editingURL ? (
          <View>
            <TextInput
              style={styles.input}
              value={tempURL}
              onChangeText={setTempURL}
              placeholder={DEFAULT_MENU_BASE}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <Text style={styles.hint}>Leave blank to use the default cloud URL</Text>
            <View style={styles.btnRow}>
              <TouchableOpacity style={styles.saveBtn} onPress={saveURL}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
              {customBase ? (
                <TouchableOpacity style={styles.resetBtn} onPress={resetURL}>
                  <Text style={styles.resetBtnText}>Reset to default</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.urlDisplay}
            onPress={() => { setTempURL(customBase); setEditingURL(true); }}>
            <MaterialIcons name="link" size={16} color={Colors.primary} style={{ marginRight: 8 }} />
            <Text style={styles.urlText} numberOfLines={2}>{menuBase}</Text>
            <MaterialIcons name="edit" size={14} color={Colors.textMuted} style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        )}
        {!customBase && (
          <View style={styles.autoTag}>
            <MaterialIcons name="cloud-done" size={14} color={Colors.success} />
            <Text style={styles.autoTagText}>Auto-detected from your server — no setup needed</Text>
          </View>
        )}
      </View>

      {/* Table count */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Number of Tables</Text>
        <View style={styles.editRow}>
          <TextInput
            style={[styles.input, { width: 100 }]}
            value={tempTableCount}
            onChangeText={setTempTableCount}
            keyboardType="numeric"
            placeholder="5"
            placeholderTextColor={Colors.textMuted}
          />
          <TouchableOpacity style={styles.saveBtn} onPress={saveTableCount}>
            <Text style={styles.saveBtnText}>Set</Text>
          </TouchableOpacity>
          <Text style={[styles.hint, { marginLeft: 8 }]}>max 50 tables</Text>
        </View>
      </View>

      {/* Table QR grid */}
      <View>
        <Text style={styles.sectionTitle}>Table QR Codes</Text>
        <Text style={[styles.hint, { marginBottom: 12 }]}>
          Tap to expand QR • Long press to share link
        </Text>

        {tables.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tableCard, selectedTable === t && styles.tableCardActive]}
            onPress={() => setSelectedTable(selectedTable === t ? null : t)}
            onLongPress={() => shareTable(t)}>

            <View style={styles.tableRow}>
              <View style={styles.tableNumBadge}>
                <MaterialIcons name="table-restaurant" size={16} color={Colors.primary} />
                <Text style={styles.tableNumText}>Table {t}</Text>
              </View>
              <Text style={styles.tableURL} numberOfLines={1}>{tableURL(t)}</Text>
              <MaterialIcons
                name={selectedTable === t ? 'expand-less' : 'expand-more'}
                size={22}
                color={Colors.textMuted}
              />
            </View>

            {selectedTable === t && (
              <View style={styles.qrExpanded}>
                <View style={styles.qrWrapper}>
                  <QRCode
                    value={tableURL(t)}
                    size={200}
                    backgroundColor="#ffffff"
                    color="#000000"
                  />
                </View>
                <Text style={styles.qrLabel}>
                  {settings.hotelName || 'Our Menu'} — Table {t}
                </Text>
                <Text style={styles.qrSub}>Scan to view menu & order</Text>
                <TouchableOpacity style={styles.shareBtn} onPress={() => shareTable(t)}>
                  <MaterialIcons name="share" size={16} color="#fff" />
                  <Text style={styles.shareBtnText}>Share Table {t} Link</Text>
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.printTip}>
        <MaterialIcons name="print" size={16} color={Colors.textMuted} />
        <Text style={styles.printText}>
          Take a screenshot of each QR, print & laminate. Place on tables.
        </Text>
      </View>
    </ScrollView>
  );
}

export default function QRMenuScreen() {
  return (
    <PremiumGate feature="QR Ordering Menu" description="Let customers scan a QR code at their table to browse the menu and place orders instantly.">
      <QRMenuScreenInner />
    </PremiumGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48 },

  header: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  title: { fontSize: 22, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },

  infoBox: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: `${Colors.primary}30`,
  },
  infoTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  infoStep: { fontSize: 13, color: Colors.textMuted, marginBottom: 6, lineHeight: 20 },

  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8,
  },

  editRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: Colors.card, color: Colors.text,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.primary,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
  hint: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },

  btnRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 10, marginLeft: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  resetBtn: {
    borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  resetBtnText: { color: Colors.textMuted, fontSize: 14 },

  urlDisplay: {
    backgroundColor: Colors.card, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    padding: 12, flexDirection: 'row', alignItems: 'center',
  },
  urlText: { flex: 1, fontSize: 13, color: Colors.text },

  autoTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6,
  },
  autoTagText: { fontSize: 12, color: Colors.success },

  tableCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  tableCardActive: { borderColor: Colors.primary },
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, gap: 10,
  },
  tableNumBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: `${Colors.primary}20`,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20,
  },
  tableNumText: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  tableURL: { flex: 1, fontSize: 11, color: Colors.textMuted },

  qrExpanded: { alignItems: 'center', paddingBottom: 20, paddingHorizontal: 16 },
  qrWrapper: {
    backgroundColor: '#fff', borderRadius: 14,
    padding: 14, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  qrLabel: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  qrSub: { fontSize: 12, color: Colors.textMuted, marginBottom: 14 },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  shareBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  printTip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: Colors.card, borderRadius: 10,
    padding: 12, marginTop: 16,
  },
  printText: { flex: 1, fontSize: 12, color: Colors.textMuted, lineHeight: 18 },
});
