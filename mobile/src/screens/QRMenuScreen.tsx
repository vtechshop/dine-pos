import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Share,
  FlatList,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettings } from '../context/SettingsContext';
import { Colors } from '../utils/constants';

const STORAGE_KEY = 'qr_menu_ip';
const TABLE_COUNT_KEY = 'qr_table_count';

export default function QRMenuScreen() {
  const { settings } = useSettings();
  const [serverIP, setServerIP] = useState('');
  const [port, setPort] = useState('5000');
  const [editingIP, setEditingIP] = useState(false);
  const [tempIP, setTempIP] = useState('');
  const [tableCount, setTableCount] = useState(5);
  const [tempTableCount, setTempTableCount] = useState('5');
  const [selectedTable, setSelectedTable] = useState<number | null>(null);

  const menuBaseURL = serverIP ? `http://${serverIP}:${port}/menu` : '';
  const tableURL = (t: number) => `${menuBaseURL}?table=${t}`;

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(TABLE_COUNT_KEY),
    ]).then(([ip, tc]) => {
      if (ip) {
        const [i, p] = ip.split(':');
        setServerIP(i);
        if (p) setPort(p);
      }
      if (tc) {
        setTableCount(parseInt(tc, 10));
        setTempTableCount(tc);
      }
    });
  }, []);

  const saveIP = async () => {
    const trimmed = tempIP.trim();
    if (!trimmed) return;
    setServerIP(trimmed);
    setEditingIP(false);
    await AsyncStorage.setItem(STORAGE_KEY, `${trimmed}:${port}`);
  };

  const saveTableCount = async () => {
    const n = parseInt(tempTableCount, 10);
    if (!n || n < 1 || n > 50) return;
    setTableCount(n);
    await AsyncStorage.setItem(TABLE_COUNT_KEY, String(n));
  };

  const shareTable = async (tableNum: number) => {
    if (!menuBaseURL) return;
    try {
      await Share.share({
        message: `Table ${tableNum} Menu: ${tableURL(tableNum)}`,
        url: tableURL(tableNum),
      });
    } catch (_) {}
  };

  const tables = Array.from({ length: tableCount }, (_, i) => i + 1);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <MaterialIcons name="qr-code-2" size={32} color={Colors.primary} />
        <Text style={styles.title}>Table QR Codes</Text>
        <Text style={styles.subtitle}>
          One QR per table. Customers scan → view menu → place order.{'\n'}
          Works offline after first scan!
        </Text>
      </View>

      {/* How it works */}
      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>⚡ How It Works</Text>
        {[
          '1️⃣  Print QR code and place on each table',
          '2️⃣  Customer scans with Google Lens (needs WiFi once)',
          '3️⃣  Menu loads & is cached offline automatically',
          '4️⃣  Customer adds items and places order',
          '5️⃣  Order appears in your Admin → Orders tab instantly',
        ].map((step, i) => (
          <Text key={i} style={styles.infoStep}>{step}</Text>
        ))}
      </View>

      {/* Server IP */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Server IP Address</Text>
        {editingIP ? (
          <View style={styles.editRow}>
            <TextInput
              style={styles.input}
              value={tempIP}
              onChangeText={setTempIP}
              placeholder="192.168.1.5"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
              autoFocus
            />
            <TextInput
              style={[styles.input, { width: 80, marginLeft: 8 }]}
              value={port}
              onChangeText={setPort}
              placeholder="5000"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.saveBtn} onPress={saveIP}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.ipDisplay}
            onPress={() => { setTempIP(serverIP); setEditingIP(true); }}>
            <MaterialIcons name="edit" size={16} color={Colors.primary} style={{ marginRight: 8 }} />
            <Text style={[styles.ipText, !serverIP && { color: Colors.textMuted }]}>
              {serverIP ? `${serverIP}:${port}` : 'Tap to set IP (run: ipconfig)'}
            </Text>
          </TouchableOpacity>
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
          <Text style={styles.hint}>  (max 50 tables)</Text>
        </View>
      </View>

      {/* Table QR grid */}
      {menuBaseURL ? (
        <View>
          <Text style={styles.sectionTitle}>Table QR Codes</Text>
          <Text style={[styles.hint, { marginBottom: 12 }]}>
            Tap a table to expand QR. Long press to share link.
          </Text>

          {tables.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tableCard, selectedTable === t && styles.tableCardActive]}
              onPress={() => setSelectedTable(selectedTable === t ? null : t)}
              onLongPress={() => shareTable(t)}>

              {/* Table row header */}
              <View style={styles.tableRow}>
                <View style={styles.tableNumBadge}>
                  <MaterialIcons name="table-restaurant" size={16} color={Colors.primary} />
                  <Text style={styles.tableNumText}>Table {t}</Text>
                </View>
                <Text style={styles.tableURL} numberOfLines={1}>
                  {tableURL(t)}
                </Text>
                <MaterialIcons
                  name={selectedTable === t ? 'expand-less' : 'expand-more'}
                  size={22}
                  color={Colors.textMuted}
                />
              </View>

              {/* Expanded QR */}
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
                  <TouchableOpacity
                    style={styles.shareBtn}
                    onPress={() => shareTable(t)}>
                    <MaterialIcons name="share" size={16} color="#fff" />
                    <Text style={styles.shareBtnText}>Share Table {t} Link</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.emptyQR}>
          <MaterialIcons name="wifi-find" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyText}>Set your server IP above{'\n'}to generate table QR codes</Text>
          <View style={styles.hintBox}>
            <Text style={styles.hintBoxText}>
              Open terminal and run:{'\n'}
              <Text style={{ color: Colors.primary }}>ipconfig</Text>{'\n'}
              Copy the "IPv4 Address" value
            </Text>
          </View>
        </View>
      )}

      {menuBaseURL ? (
        <View style={styles.printTip}>
          <MaterialIcons name="print" size={16} color={Colors.textMuted} />
          <Text style={styles.printText}>
            Take a screenshot of each QR, print & laminate them. Place on tables.
          </Text>
        </View>
      ) : null}
    </ScrollView>
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
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
  },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 10, marginLeft: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  hint: { fontSize: 12, color: Colors.textMuted, marginLeft: 8 },

  ipDisplay: {
    backgroundColor: Colors.card, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    padding: 12, flexDirection: 'row', alignItems: 'center',
  },
  ipText: { fontSize: 15, color: Colors.text },

  // Table cards
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

  emptyQR: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 22 },
  hintBox: {
    backgroundColor: Colors.card, borderRadius: 10, padding: 14, marginTop: 4,
  },
  hintBoxText: { fontSize: 12, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },

  printTip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: Colors.card, borderRadius: 10,
    padding: 12, marginTop: 16,
  },
  printText: { flex: 1, fontSize: 12, color: Colors.textMuted, lineHeight: 18 },
});
