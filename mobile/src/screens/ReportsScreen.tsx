import React, { useState, useEffect, useCallback } from 'react';
import { showAlert } from '../utils/alert';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, TextInput, Modal, Linking,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { DailyReport, GSTReport, TallyReport, GSTR1Json, Product } from '../types';
import { Colors, Spacing, FontSize, BorderRadius } from '../utils/constants';
import { getDailyReport, getRangeReport, getProductSalesReport, getLowStockProducts, getWasteAnalytics, createWasteLog, getGSTReport, getTallyExport, getGSTR1Json } from '../services/api';
import { useSettings } from '../context/SettingsContext';

type Tab = 'daily' | 'products' | 'stock' | 'waste' | 'gst';

interface ProductSale {
  productName: string;
  totalQty: number;
  totalRevenue: number;
}

const WASTE_REASONS = [
  { id: 'expired',     label: 'Expired',     color: '#C62828' },
  { id: 'damaged',     label: 'Damaged',     color: '#E65100' },
  { id: 'overcooked',  label: 'Overcooked',  color: '#F57F17' },
  { id: 'returned',    label: 'Returned',    color: '#1565C0' },
  { id: 'other',       label: 'Other',       color: '#616161' },
] as const;

type WasteReason = typeof WASTE_REASONS[number]['id'];

const getTodayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getMonthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const getWeekRange = (dateStr: string) => {
  const d = new Date(dateStr);
  const day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { from: fmtDate(mon), to: fmtDate(sun) };
};

const getMonthRange = (dateStr: string) => {
  const d = new Date(dateStr);
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from, to: fmtDate(last) };
};

const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const shortDate = (s: string) => { const d = new Date(s); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; };

const ReportsScreen: React.FC = () => {
  const { settings } = useSettings();
  const [tab, setTab] = useState<Tab>('daily');
  const [date, setDate] = useState(getTodayString());
  const [report, setReport] = useState<DailyReport | null>(null);
  const [productSales, setProductSales] = useState<ProductSale[]>([]);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [wasteData, setWasteData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [wasteSaving, setWasteSaving] = useState(false);
  const [gstReport, setGstReport] = useState<GSTReport | null>(null);
  const [gstLoading, setGstLoading] = useState(false);
  const [gstExporting, setGstExporting] = useState(false);
  const [tallyExporting, setTallyExporting] = useState(false);
  const [gstr1Exporting, setGstr1Exporting] = useState(false);
  const [gstFrom, setGstFrom] = useState(getMonthStart());
  const [gstTo, setGstTo] = useState(getTodayString());
  const emptyWasteForm = { productName: '', quantity: '', unit: 'portion', reason: 'expired' as WasteReason, estimatedLoss: '', notes: '' };
  const [wasteForm, setWasteForm] = useState(emptyWasteForm);
  const cur = settings.currencySymbol || '₹';

  // Premium gate modal
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [premiumFeature, setPremiumFeature] = useState('');

  const requirePremium = (featureName: string, action: () => void) => {
    if (settings.isPremium) { action(); return; }
    setPremiumFeature(featureName);
    setShowPremiumModal(true);
  };

  // WhatsApp share modal
  type SharePeriod = 'daily' | 'weekly' | 'monthly';
  const [showShareModal, setShowShareModal] = useState(false);
  const [sharePeriod, setSharePeriod] = useState<SharePeriod>('daily');
  const [shareDate, setShareDate] = useState(getTodayString());
  const [shareLoading, setShareLoading] = useState(false);

  const fetchDaily = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const [daily, products] = await Promise.all([
        getDailyReport(d),
        getProductSalesReport(d),
      ]);
      setReport(daily);
      setProductSales(products.products);
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLowStock = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLowStockProducts(5);
      setLowStock(res.products);
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to load stock');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWaste = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const data = await getWasteAnalytics(d);
      setWasteData(data);
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to load waste data');
    } finally { setLoading(false); }
  }, []);

  const fetchGSTReport = useCallback(async (from: string, to: string) => {
    setGstLoading(true);
    try {
      const data = await getGSTReport(from, to);
      setGstReport(data);
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to load GST report');
    } finally {
      setGstLoading(false);
    }
  }, []);

  const handleWhatsAppSummary = () => {
    if (!report || report.totalOrders === 0) {
      showAlert('No Data', 'No orders to report for this date');
      return;
    }
    const avg = (report.totalSales / report.totalOrders).toFixed(2);
    const msg =
      `📊 *Daily Sales Summary*\n` +
      `📅 Date: ${date}\n` +
      `🏨 ${settings.hotelName}\n\n` +
      `💰 Total Sales: ${cur}${report.totalSales.toFixed(2)}\n` +
      `📋 Orders: ${report.totalOrders}\n` +
      `💸 Tax Collected: ${cur}${report.totalTax.toFixed(2)}\n` +
      `📊 Avg Order: ${cur}${avg}\n\n` +
      `💳 *Payments:*\n` +
      `• Cash: ${cur}${report.paymentBreakdown.cash.toFixed(2)}\n` +
      `• UPI: ${cur}${report.paymentBreakdown.upi.toFixed(2)}\n` +
      `• Card: ${cur}${report.paymentBreakdown.card.toFixed(2)}\n\n` +
      `_Sent via Dine POS_`;
    const raw = (settings.phone || '').replace(/\D/g, '');
    const waPhone = raw.startsWith('91') ? raw : `91${raw}`;
    Linking.openURL(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`);
  };

  const handleShareSubmit = async () => {
    setShareLoading(true);
    try {
      let r: DailyReport;
      let header: string;
      let dateLabel: string;

      if (sharePeriod === 'daily') {
        r = await getDailyReport(shareDate);
        header = '📊 *Daily Sales Summary*';
        dateLabel = `📅 Date: ${shareDate}`;
      } else if (sharePeriod === 'weekly') {
        const { from, to } = getWeekRange(shareDate);
        r = await getRangeReport(from, to);
        header = '📊 *Weekly Sales Summary*';
        dateLabel = `📅 Week: ${shortDate(from)} → ${shortDate(to)}`;
      } else {
        const { from, to } = getMonthRange(shareDate);
        r = await getRangeReport(from, to);
        const d = new Date(shareDate);
        header = '📊 *Monthly Sales Summary*';
        dateLabel = `📅 Month: ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
      }

      if (r.totalOrders === 0) {
        showAlert('No Data', 'No orders found for this period');
        return;
      }

      const avg = (r.totalSales / r.totalOrders).toFixed(2);
      const msg =
        `${header}\n` +
        `${dateLabel}\n` +
        `🏨 ${settings.hotelName}\n\n` +
        `💰 Total Sales: ${cur}${r.totalSales.toFixed(2)}\n` +
        `📋 Orders: ${r.totalOrders}\n` +
        `💸 Tax Collected: ${cur}${r.totalTax.toFixed(2)}\n` +
        `📊 Avg Order: ${cur}${avg}\n\n` +
        `💳 *Payments:*\n` +
        `• Cash: ${cur}${r.paymentBreakdown.cash.toFixed(2)}\n` +
        `• UPI: ${cur}${r.paymentBreakdown.upi.toFixed(2)}\n` +
        `• Card: ${cur}${r.paymentBreakdown.card.toFixed(2)}\n\n` +
        `_Sent via Dine POS_`;

      const raw = (settings.phone || '').replace(/\D/g, '');
      const waPhone = raw.startsWith('91') ? raw : `91${raw}`;
      setShowShareModal(false);
      Linking.openURL(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`);
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to fetch report');
    } finally {
      setShareLoading(false);
    }
  };

  const handleExportGST = async () => {
    if (!gstReport || gstReport.rows.length === 0) {
      showAlert('No Data', 'No tax data for this period');
      return;
    }
    setGstExporting(true);
    try {
      const hotelName = settings.hotelName || 'My Restaurant';
      const rowsHTML = gstReport.rows.map(r => `
        <tr>
          <td style="color:#E8380D;font-weight:700">${r.taxPercent}%</td>
          <td>${cur}${r.taxableValue.toFixed(2)}</td>
          <td>${cur}${r.cgst.toFixed(2)}</td>
          <td>${cur}${r.sgst.toFixed(2)}</td>
          <td style="color:#E8380D;font-weight:700">${cur}${r.totalTax.toFixed(2)}</td>
          <td>${cur}${r.totalValue.toFixed(2)}</td>
        </tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GST Report</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;background:#FFF6EE;color:#1C0800}
.hdr{background:#E8380D;color:#fff;padding:20px 24px}
.hdr h1{font-size:22px;font-weight:800}
.hdr p{font-size:13px;opacity:.85;margin-top:4px}
.body{padding:20px 16px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(139,58,26,.1);margin-bottom:16px}
thead{background:#E8380D;color:#fff}
th{padding:10px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
td{padding:10px;font-size:13px;border-bottom:1px solid #F0D9C8}
.tot{background:#FFF0E6;font-weight:800}
.tot td{border:none}
.summary{display:flex;gap:10px;flex-wrap:wrap}
.sc{flex:1;min-width:100px;background:#fff;border-radius:10px;padding:12px;border:1px solid #F0D9C8;text-align:center}
.sc .v{font-size:17px;font-weight:800;color:#E8380D}
.sc .l{font-size:10px;color:#7A4F3A;margin-top:2px;text-transform:uppercase}
.footer{text-align:center;padding:24px 16px;color:#C4A090;font-size:11px}
</style></head><body>
<div class="hdr"><h1>GST Report — GSTR-1</h1><p>${hotelName} &nbsp;|&nbsp; ${gstFrom} &rarr; ${gstTo}</p></div>
<div class="body">
<table>
<thead><tr><th>Tax Rate</th><th>Taxable Value</th><th>CGST</th><th>SGST</th><th>Total Tax</th><th>Grand Total</th></tr></thead>
<tbody>
${rowsHTML}
<tr class="tot"><td>TOTAL</td><td>${cur}${gstReport.totalTaxableValue.toFixed(2)}</td><td>${cur}${gstReport.totalCGST.toFixed(2)}</td><td>${cur}${gstReport.totalSGST.toFixed(2)}</td><td style="color:#E8380D">${cur}${gstReport.totalTax.toFixed(2)}</td><td>${cur}${gstReport.totalValue.toFixed(2)}</td></tr>
</tbody></table>
<div class="summary">
<div class="sc"><div class="v">${cur}${gstReport.totalTaxableValue.toFixed(0)}</div><div class="l">Taxable Sales</div></div>
<div class="sc"><div class="v">${cur}${gstReport.totalCGST.toFixed(0)}</div><div class="l">CGST</div></div>
<div class="sc"><div class="v">${cur}${gstReport.totalSGST.toFixed(0)}</div><div class="l">SGST</div></div>
<div class="sc"><div class="v">${cur}${gstReport.totalTax.toFixed(0)}</div><div class="l">Total GST</div></div>
</div></div>
<div class="footer">Generated by Dine POS &bull; ${new Date().toLocaleDateString('en-IN')}</div>
</body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Export GST Report' });
    } catch (e: any) {
      showAlert('Export Error', e.message || 'Failed to export');
    } finally {
      setGstExporting(false);
    }
  };

  const handleExportTally = async () => {
    setTallyExporting(true);
    try {
      const data: TallyReport = await getTallyExport(gstFrom, gstTo);
      if (data.rows.length === 0) {
        showAlert('No Data', 'No orders in this period to export');
        return;
      }
      const hotelName = settings.hotelName || 'My Restaurant';
      const rowsHTML = data.rows.map((r, i) => `
        <tr style="background:${i % 2 === 0 ? '#fff' : '#FFFAF5'}">
          <td>${r.date}</td>
          <td style="color:#1565C0;font-weight:600">${r.voucherNo}</td>
          <td>${r.party}</td>
          <td><span style="background:#E3F2FD;color:#1565C0;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">${r.paymentMode}</span></td>
          <td>${cur}${r.subtotal.toFixed(2)}</td>
          <td>${cur}${r.cgst.toFixed(2)}</td>
          <td>${cur}${r.sgst.toFixed(2)}</td>
          <td>${r.discount > 0 ? cur + r.discount.toFixed(2) : '-'}</td>
          <td style="font-weight:700;color:#1565C0">${cur}${r.grandTotal.toFixed(2)}</td>
          <td style="color:#7A4F3A;font-size:11px">${r.narration}</td>
        </tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tally Export</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;background:#F0F4FF;color:#1C0800}
.hdr{background:#1565C0;color:#fff;padding:20px 24px}
.hdr h1{font-size:22px;font-weight:800}
.hdr p{font-size:13px;opacity:.85;margin-top:4px}
.body{padding:20px 16px}
.info{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.ic{flex:1;min-width:90px;background:#fff;border-radius:10px;padding:12px;border:1px solid #BBDEFB;text-align:center}
.ic .v{font-size:17px;font-weight:800;color:#1565C0}
.ic .l{font-size:10px;color:#5C6BC0;margin-top:2px;text-transform:uppercase}
.note{background:#E3F2FD;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#1565C0;line-height:1.5}
.tw{overflow-x:auto}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);min-width:700px}
thead{background:#1565C0;color:#fff}
th{padding:9px 8px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}
td{padding:9px 8px;font-size:12px;border-bottom:1px solid #E8EAF6;vertical-align:middle}
.footer{text-align:center;padding:24px 16px;color:#9FA8DA;font-size:11px}
</style></head><body>
<div class="hdr"><h1>Tally Export</h1><p>${hotelName} &nbsp;|&nbsp; ${gstFrom} &rarr; ${gstTo}</p></div>
<div class="body">
<div class="info">
<div class="ic"><div class="v">${data.totalOrders}</div><div class="l">Orders</div></div>
<div class="ic"><div class="v">${cur}${data.totalRevenue.toFixed(0)}</div><div class="l">Revenue</div></div>
<div class="ic"><div class="v">${cur}${data.totalTax.toFixed(0)}</div><div class="l">Total Tax</div></div>
</div>
<p class="note">Share with your accountant for Tally data entry (CGST + SGST split included)</p>
<div class="tw"><table>
<thead><tr><th>Date</th><th>Voucher No</th><th>Party</th><th>Payment</th><th>Sales</th><th>CGST</th><th>SGST</th><th>Discount</th><th>Grand Total</th><th>Narration</th></tr></thead>
<tbody>${rowsHTML}</tbody>
</table></div></div>
<div class="footer">Generated by Dine POS &bull; ${new Date().toLocaleDateString('en-IN')}</div>
</body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Tally Export' });
    } catch (e: any) {
      showAlert('Export Error', e.message || 'Failed to export Tally data');
    } finally {
      setTallyExporting(false);
    }
  };

  const handleExportGSTR1Json = async () => {
    setGstr1Exporting(true);
    try {
      const data: GSTR1Json = await getGSTR1Json(gstFrom, gstTo);
      if (!data.gstin) {
        showAlert('GSTIN Missing', 'Please set your GSTIN in Settings → Legal before exporting GSTR-1');
        return;
      }
      if (data.b2cs.length === 0 && data.hsn.hsn_b2c.length === 0) {
        showAlert('No Data', 'No taxable orders in this period');
        return;
      }
      const jsonStr = JSON.stringify(data, null, 2);
      const filename = `GSTR1_${data.gstin}_${data.fp}.json`;
      const fileUri = (FileSystem.documentDirectory || '') + filename;
      await FileSystem.writeAsStringAsync(fileUri, jsonStr, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: 'GSTR-1 JSON Export', UTI: 'public.json' });
    } catch (e: any) {
      showAlert('Export Error', e.message || 'Failed to export GSTR-1 JSON');
    } finally {
      setGstr1Exporting(false);
    }
  };

  useEffect(() => {
    if (tab === 'daily' || tab === 'products') fetchDaily(date);
    else if (tab === 'stock') fetchLowStock();
    else if (tab === 'waste') fetchWaste(date);
    else if (tab === 'gst') fetchGSTReport(gstFrom, gstTo);
  }, [tab, date, fetchDaily, fetchLowStock, fetchWaste, fetchGSTReport]);

  const navigateDate = (dir: -1 | 1) => {
    const d = new Date(date);
    if (isNaN(d.getTime())) return;
    d.setDate(d.getDate() + dir);
    setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  };

  const saveWasteLog = async () => {
    if (!wasteForm.productName.trim() || !wasteForm.quantity) {
      showAlert('Error', 'Product name and quantity are required'); return;
    }
    setWasteSaving(true);
    try {
      await createWasteLog({
        productName:   wasteForm.productName.trim(),
        quantity:      parseFloat(wasteForm.quantity) || 1,
        unit:          wasteForm.unit.trim() || 'portion',
        reason:        wasteForm.reason,
        estimatedLoss: parseFloat(wasteForm.estimatedLoss) || 0,
        notes:         wasteForm.notes.trim(),
        date:          date,
      });
      setShowWasteModal(false);
      setWasteForm(emptyWasteForm);
      fetchWaste(date);
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to save waste log');
    } finally { setWasteSaving(false); }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Reports</Text>
        {tab === 'daily' && (
          <TouchableOpacity
            style={[styles.headerAddBtn, { backgroundColor: '#25D366' }]}
            onPress={() => requirePremium('WhatsApp Report Share', () => {
              setShareDate(date); setSharePeriod('daily'); setShowShareModal(true);
            })}
            activeOpacity={0.8}
          >
            <MaterialIcons name={settings.isPremium ? 'share' : 'lock'} size={20} color={Colors.white} />
          </TouchableOpacity>
        )}
        {tab === 'waste' && (
          <TouchableOpacity
            style={styles.headerAddBtn}
            onPress={() => { setWasteForm({ ...emptyWasteForm }); setShowWasteModal(true); }}
            activeOpacity={0.8}
          >
            <MaterialIcons name="add" size={22} color={Colors.white} />
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {([
          { key: 'daily',    label: 'Daily',    icon: 'bar-chart' },
          { key: 'products', label: 'Products', icon: 'restaurant-menu' },
          { key: 'stock',    label: 'Stock',    icon: 'warning' },
          { key: 'waste',    label: 'Waste',    icon: 'delete-sweep' },
          { key: 'gst',      label: 'GST',      icon: 'receipt' },
        ] as { key: Tab; label: string; icon: any }[]).map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name={t.icon}
              size={15}
              color={tab === t.key ? Colors.primary : Colors.textSecondary}
            />
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
              {t.label}
            </Text>
            {t.key === 'stock' && lowStock.length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{lowStock.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Date selector (not shown on stock or gst tabs) */}
      {tab !== 'stock' && tab !== 'gst' && (
        <View style={styles.dateRow}>
          <TouchableOpacity style={styles.dateArrow} onPress={() => navigateDate(-1)} activeOpacity={0.7}>
            <Text style={styles.dateArrowText}>{'<'}</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.dateInput}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={Colors.textMuted}
            onSubmitEditing={() => fetchDaily(date)}
          />
          <TouchableOpacity style={styles.dateArrow} onPress={() => navigateDate(1)} activeOpacity={0.7}>
            <Text style={styles.dateArrowText}>{'>'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.todayBtn} onPress={() => setDate(getTodayString())} activeOpacity={0.7}>
            <Text style={styles.todayBtnText}>Today</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* ── DAILY TAB ── */}
          {tab === 'daily' && (
            <>
              <View style={styles.statsRow}>
                <View style={[styles.statCard, { borderLeftColor: Colors.primary }]}>
                  <Text style={styles.statLabel}>Total Sales</Text>
                  <Text style={styles.statValueBig}>{cur}{report?.totalSales.toFixed(2) ?? '0.00'}</Text>
                </View>
              </View>

              <View style={styles.statsRowDouble}>
                <View style={[styles.statCardHalf, { borderLeftColor: Colors.cardPayment }]}>
                  <Text style={styles.statLabel}>Total Orders</Text>
                  <Text style={styles.statValueMed}>{report?.totalOrders ?? 0}</Text>
                </View>
                <View style={[styles.statCardHalf, { borderLeftColor: Colors.warning }]}>
                  <Text style={styles.statLabel}>Total Tax</Text>
                  <Text style={styles.statValueMed}>{cur}{report?.totalTax.toFixed(2) ?? '0.00'}</Text>
                </View>
              </View>

              {(report?.totalOrders ?? 0) > 0 && (
                <View style={styles.statsRow}>
                  <View style={[styles.statCard, { borderLeftColor: Colors.success }]}>
                    <Text style={styles.statLabel}>Avg Order Value</Text>
                    <Text style={styles.statValueMed}>
                      {cur}{((report!.totalSales) / report!.totalOrders).toFixed(2)}
                    </Text>
                  </View>
                </View>
              )}

              {/* Payment breakdown */}
              {report && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Payment Breakdown</Text>
                  {[
                    { label: 'Cash', value: report.paymentBreakdown.cash, color: Colors.success },
                    { label: 'UPI', value: report.paymentBreakdown.upi, color: Colors.upi },
                    { label: 'Card', value: report.paymentBreakdown.card, color: Colors.cardPayment },
                    { label: 'Split', value: report.paymentBreakdown.split, color: Colors.warning },
                  ].filter(p => p.value > 0).map(p => (
                    <View key={p.label} style={styles.payRow}>
                      <View style={[styles.payDot, { backgroundColor: p.color }]} />
                      <Text style={styles.payLabel}>{p.label}</Text>
                      <Text style={[styles.payValue, { color: p.color }]}>{cur}{p.value.toFixed(2)}</Text>
                    </View>
                  ))}
                  {Object.values(report.paymentBreakdown).every(v => v === 0) && (
                    <Text style={styles.emptyText}>No orders on this date</Text>
                  )}
                </View>
              )}

              {/* Order type breakdown — Dine In vs Takeaway */}
              {report && report.totalOrders > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Order Type Summary</Text>
                  {[
                    {
                      label: '🍽 Dine In',
                      orders: report.totalOrders - (report.parcelOrders ?? 0),
                      revenue: report.totalSales - (report.parcelRevenue ?? 0),
                      color: Colors.primary,
                    },
                    {
                      label: '🛍 Takeaway',
                      orders: report.parcelOrders ?? 0,
                      revenue: report.parcelRevenue ?? 0,
                      color: Colors.warning,
                    },
                  ].map(t => (
                    <View key={t.label} style={styles.payRow}>
                      <View style={[styles.payDot, { backgroundColor: t.color }]} />
                      <Text style={styles.payLabel}>{t.label}</Text>
                      <Text style={[styles.payLabel, { color: Colors.textMuted, marginLeft: 4 }]}>{t.orders} orders</Text>
                      <Text style={[styles.payValue, { color: t.color }]}>{cur}{t.revenue.toFixed(2)}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Order source breakdown */}
              {report?.sourceBreakdown && Object.values(report.sourceBreakdown).some(s => s.revenue > 0) && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Order Source Breakdown</Text>
                  {([
                    { key: 'dine-in' as const,  label: '🍴 Dine-in',  color: Colors.primary },
                    { key: 'takeaway' as const,  label: '🥡 Takeaway', color: Colors.warning },
                    { key: 'swiggy' as const,    label: '🛵 Swiggy',   color: '#FC8019' },
                    { key: 'zomato' as const,    label: '🍕 Zomato',   color: '#E23744' },
                    { key: 'qr' as const,        label: '📲 QR Order', color: Colors.upi },
                  ] as { key: keyof NonNullable<typeof report.sourceBreakdown>; label: string; color: string }[])
                    .filter(s => report.sourceBreakdown![s.key]?.revenue > 0)
                    .map(s => {
                      const sd = report.sourceBreakdown![s.key];
                      return (
                        <View key={s.key} style={styles.payRow}>
                          <View style={[styles.payDot, { backgroundColor: s.color }]} />
                          <Text style={styles.payLabel}>{s.label}</Text>
                          <Text style={[styles.payLabel, { color: Colors.textMuted, marginLeft: 4 }]}>{sd.orders} orders</Text>
                          <Text style={[styles.payValue, { color: s.color }]}>{cur}{sd.revenue.toFixed(2)}</Text>
                        </View>
                      );
                    })}
                </View>
              )}
            </>
          )}

          {/* ── PRODUCTS TAB ── */}
          {tab === 'products' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Top Selling Items</Text>
              {productSales.length === 0 ? (
                <View style={styles.emptyBox}>
                  <MaterialIcons name="restaurant-menu" size={40} color={Colors.textMuted} />
                  <Text style={styles.emptyText}>No orders on this date</Text>
                </View>
              ) : (
                productSales.map((p, i) => (
                  <View key={p.productName} style={styles.productRow}>
                    <View style={[styles.rank, { backgroundColor: i < 3 ? Colors.primary : Colors.card }]}>
                      <Text style={[styles.rankText, { color: i < 3 ? Colors.white : Colors.textSecondary }]}>
                        #{i + 1}
                      </Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: Spacing.md }}>
                      <Text style={styles.productName}>{p.productName}</Text>
                      <Text style={styles.productSub}>{p.totalQty} sold</Text>
                    </View>
                    <Text style={styles.productRevenue}>{cur}{p.totalRevenue.toFixed(0)}</Text>
                  </View>
                ))
              )}
            </View>
          )}

          {/* ── WASTE TAB ── */}
          {tab === 'waste' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Food Waste Analytics</Text>
              {!wasteData || wasteData.totalEntries === 0 ? (
                <View style={styles.emptyBox}>
                  <MaterialIcons name="delete-sweep" size={40} color={Colors.textMuted} />
                  <Text style={styles.emptyText}>No waste logged today</Text>
                </View>
              ) : (
                <>
                  <View style={styles.statsRowDouble}>
                    <View style={[styles.statCardHalf, { borderLeftColor: Colors.danger }]}>
                      <Text style={styles.statLabel}>Total Loss</Text>
                      <Text style={[styles.statValueMed, { color: Colors.danger }]}>{cur}{wasteData.totalLoss.toFixed(2)}</Text>
                    </View>
                    <View style={[styles.statCardHalf, { borderLeftColor: Colors.warning }]}>
                      <Text style={styles.statLabel}>Entries</Text>
                      <Text style={styles.statValueMed}>{wasteData.totalEntries}</Text>
                    </View>
                  </View>
                  {wasteData.topItems.length > 0 && (
                    <>
                      <Text style={[styles.sectionTitle, { marginTop: Spacing.lg }]}>Top Wasted Items</Text>
                      {wasteData.topItems.map((item: any, i: number) => (
                        <View key={i} style={styles.stockRow}>
                          <Text style={[styles.productName, { flex: 1 }]}>{item.productName}</Text>
                          <Text style={styles.productSub}>Qty: {item.totalQty}</Text>
                          <View style={[styles.stockBadge, { backgroundColor: Colors.danger + '22', marginLeft: 8 }]}>
                            <Text style={[styles.stockCount, { color: Colors.danger }]}>{cur}{item.totalLoss.toFixed(0)}</Text>
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                  {wasteData.byReason.length > 0 && (
                    <>
                      <Text style={[styles.sectionTitle, { marginTop: Spacing.lg }]}>By Reason</Text>
                      {wasteData.byReason.map((r: any, i: number) => (
                        <View key={i} style={styles.stockRow}>
                          <Text style={[styles.productName, { flex: 1, textTransform: 'capitalize' }]}>{r._id}</Text>
                          <Text style={styles.productSub}>{r.count}x</Text>
                          <View style={[styles.stockBadge, { backgroundColor: Colors.warningBg, marginLeft: 8 }]}>
                            <Text style={[styles.stockCount, { color: Colors.warning }]}>{cur}{r.totalLoss.toFixed(0)}</Text>
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                </>
              )}
            </View>
          )}

          {/* ── GST TAB ── */}
          {tab === 'gst' && (
            <>
              {/* Date Range Picker */}
              <View style={styles.gstRangeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gstRangeLabel}>From</Text>
                  <TextInput
                    style={styles.gstRangeInput}
                    value={gstFrom}
                    onChangeText={setGstFrom}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.textMuted}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                  <Text style={styles.gstRangeLabel}>To</Text>
                  <TextInput
                    style={styles.gstRangeInput}
                    value={gstTo}
                    onChangeText={setGstTo}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.textMuted}
                  />
                </View>
                <TouchableOpacity
                  style={styles.gstFetchBtn}
                  onPress={() => fetchGSTReport(gstFrom, gstTo)}
                  activeOpacity={0.8}
                >
                  {gstLoading
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.gstFetchBtnText}>Fetch</Text>
                  }
                </TouchableOpacity>
              </View>

              {gstReport && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Tax Breakup ({gstReport.from} → {gstReport.to})</Text>

                  {/* Table Header */}
                  <View style={[styles.gstRow, styles.gstHeaderRow]}>
                    <Text style={[styles.gstCell, styles.gstCellHdr, { flex: 1 }]}>Tax%</Text>
                    <Text style={[styles.gstCell, styles.gstCellHdr, { flex: 2 }]}>Taxable</Text>
                    <Text style={[styles.gstCell, styles.gstCellHdr, { flex: 2 }]}>CGST</Text>
                    <Text style={[styles.gstCell, styles.gstCellHdr, { flex: 2 }]}>SGST</Text>
                    <Text style={[styles.gstCell, styles.gstCellHdr, { flex: 2 }]}>Total Tax</Text>
                  </View>

                  {gstReport.rows.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <MaterialIcons name="receipt" size={40} color={Colors.textMuted} />
                      <Text style={styles.emptyText}>No taxable orders in this period</Text>
                    </View>
                  ) : (
                    <>
                      {gstReport.rows.map(r => (
                        <View key={r.taxPercent} style={styles.gstRow}>
                          <Text style={[styles.gstCell, { flex: 1, color: Colors.primary, fontWeight: '700' }]}>{r.taxPercent}%</Text>
                          <Text style={[styles.gstCell, { flex: 2 }]}>{cur}{r.taxableValue.toFixed(2)}</Text>
                          <Text style={[styles.gstCell, { flex: 2 }]}>{cur}{r.cgst.toFixed(2)}</Text>
                          <Text style={[styles.gstCell, { flex: 2 }]}>{cur}{r.sgst.toFixed(2)}</Text>
                          <Text style={[styles.gstCell, { flex: 2, color: Colors.warning, fontWeight: '700' }]}>{cur}{r.totalTax.toFixed(2)}</Text>
                        </View>
                      ))}

                      {/* Totals Row */}
                      <View style={[styles.gstRow, styles.gstTotalRow]}>
                        <Text style={[styles.gstCell, styles.gstTotalCell, { flex: 1, fontSize: 9 }]}>TOTAL</Text>
                        <Text style={[styles.gstCell, styles.gstTotalCell, { flex: 2 }]}>{cur}{gstReport.totalTaxableValue.toFixed(2)}</Text>
                        <Text style={[styles.gstCell, styles.gstTotalCell, { flex: 2 }]}>{cur}{gstReport.totalCGST.toFixed(2)}</Text>
                        <Text style={[styles.gstCell, styles.gstTotalCell, { flex: 2 }]}>{cur}{gstReport.totalSGST.toFixed(2)}</Text>
                        <Text style={[styles.gstCell, styles.gstTotalCell, { flex: 2, color: Colors.primary }]}>{cur}{gstReport.totalTax.toFixed(2)}</Text>
                      </View>
                    </>
                  )}
                </View>
              )}

              {gstReport && gstReport.rows.length > 0 && (
                <TouchableOpacity
                  style={styles.exportBtn}
                  onPress={() => requirePremium('GST PDF Export', handleExportGST)}
                  disabled={gstExporting}
                  activeOpacity={0.8}
                >
                  {gstExporting
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <>
                        <MaterialIcons name={settings.isPremium ? 'download' : 'lock'} size={18} color={Colors.white} />
                        <Text style={styles.exportBtnText}>Export PDF (GSTR-1)</Text>
                        {!settings.isPremium && <View style={styles.premiumTag}><Text style={styles.premiumTagTxt}>PRO</Text></View>}
                      </>
                  }
                </TouchableOpacity>
              )}

              {/* Tally Export — order-level for accountant */}
              <TouchableOpacity
                style={[styles.exportBtn, { backgroundColor: '#1565C0', marginTop: 10 }]}
                onPress={() => requirePremium('Tally Export', handleExportTally)}
                disabled={tallyExporting}
                activeOpacity={0.8}
              >
                {tallyExporting
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <>
                      <MaterialIcons name={settings.isPremium ? 'account-balance' : 'lock'} size={18} color={Colors.white} />
                      <Text style={styles.exportBtnText}>Tally Export (Accountant)</Text>
                      {!settings.isPremium && <View style={styles.premiumTag}><Text style={styles.premiumTagTxt}>PRO</Text></View>}
                    </>
                }
              </TouchableOpacity>

              {/* GSTR-1 JSON — portal upload format */}
              <TouchableOpacity
                style={[styles.exportBtn, { backgroundColor: '#2E7D32', marginTop: 10 }]}
                onPress={() => requirePremium('GSTR-1 JSON Export', handleExportGSTR1Json)}
                disabled={gstr1Exporting}
                activeOpacity={0.8}
              >
                {gstr1Exporting
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <>
                      <MaterialIcons name={settings.isPremium ? 'upload-file' : 'lock'} size={18} color={Colors.white} />
                      <Text style={styles.exportBtnText}>GSTR-1 JSON (Portal Upload)</Text>
                      {!settings.isPremium && <View style={styles.premiumTag}><Text style={styles.premiumTagTxt}>PRO</Text></View>}
                    </>
                }
              </TouchableOpacity>
            </>
          )}

          {/* ── LOW STOCK TAB ── */}
          {tab === 'stock' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Low Stock Alert (≤ 5 units)</Text>
              {lowStock.length === 0 ? (
                <View style={styles.emptyBox}>
                  <MaterialIcons name="check-circle" size={40} color={Colors.success} />
                  <Text style={[styles.emptyText, { color: Colors.success }]}>All items well stocked!</Text>
                </View>
              ) : (
                lowStock.map(p => (
                  <View key={p._id} style={styles.stockRow}>
                    <View style={styles.stockLeft}>
                      <View style={[styles.vegDot, { backgroundColor: p.isVeg ? Colors.veg : Colors.nonVeg }]} />
                      <View style={{ marginLeft: Spacing.sm }}>
                        <Text style={styles.productName}>{p.name}</Text>
                        <Text style={styles.productSub}>{(p as any).category?.name ?? 'Uncategorised'}</Text>
                      </View>
                    </View>
                    <View style={[styles.stockBadge, { backgroundColor: p.stock! <= 2 ? Colors.danger + '33' : Colors.warning + '33' }]}>
                      <Text style={[styles.stockCount, { color: p.stock! <= 2 ? Colors.danger : Colors.warning }]}>
                        {p.stock} left
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

        </ScrollView>
      )}
      {/* ── Premium Gate Modal ── */}
      <Modal visible={showPremiumModal} transparent animationType="fade" onRequestClose={() => setShowPremiumModal(false)}>
        <TouchableOpacity style={styles.premiumOverlay} activeOpacity={1} onPress={() => setShowPremiumModal(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.premiumCard}>
            <View style={styles.premiumIconCircle}>
              <Text style={styles.premiumCrown}>👑</Text>
            </View>
            <Text style={styles.premiumLabel}>Premium Feature</Text>
            <Text style={styles.premiumFeatureName}>{premiumFeature}</Text>
            <Text style={styles.premiumDesc}>
              Upgrade to a paid plan to unlock exports, WhatsApp reports, and more advanced features.
            </Text>

            <View style={styles.premiumPlanRow}>
              {['Basic ₹499/mo', 'Pro ₹999/mo'].map(plan => (
                <View key={plan} style={styles.premiumPlanChip}>
                  <MaterialIcons name="star" size={11} color={Colors.primary} />
                  <Text style={styles.premiumPlanTxt}>{plan}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={styles.premiumUpgradeBtn}
              onPress={() => { setShowPremiumModal(false); }}
              activeOpacity={0.85}
            >
              <MaterialIcons name="upgrade" size={18} color={Colors.white} />
              <Text style={styles.premiumUpgradeTxt}>Contact Support to Upgrade</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.premiumDismiss} onPress={() => setShowPremiumModal(false)}>
              <Text style={styles.premiumDismissTxt}>Maybe later</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── WhatsApp Share Modal ── */}
      <Modal visible={showShareModal} transparent animationType="slide" onRequestClose={() => setShowShareModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Share Sales Report</Text>

            {/* Period selector */}
            <View style={styles.sharePeriodRow}>
              {(['daily', 'weekly', 'monthly'] as const).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.sharePeriodChip, sharePeriod === p && styles.sharePeriodChipActive]}
                  onPress={() => setSharePeriod(p)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.sharePeriodTxt, sharePeriod === p && styles.sharePeriodTxtActive]}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Date / range display */}
            {sharePeriod === 'daily' && (
              <>
                <Text style={styles.modalLabel}>Date</Text>
                <TextInput
                  style={styles.modalInput}
                  value={shareDate}
                  onChangeText={setShareDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={Colors.textMuted}
                />
              </>
            )}

            {sharePeriod === 'weekly' && (
              <>
                <Text style={styles.modalLabel}>Pick any date in the week</Text>
                <TextInput
                  style={styles.modalInput}
                  value={shareDate}
                  onChangeText={setShareDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={Colors.textMuted}
                />
                {(() => { const { from, to } = getWeekRange(shareDate); return (
                  <Text style={styles.shareRangeHint}>
                    Week: {shortDate(from)} → {shortDate(to)}
                  </Text>
                ); })()}
              </>
            )}

            {sharePeriod === 'monthly' && (
              <>
                <Text style={styles.modalLabel}>Month (any date in month)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={shareDate}
                  onChangeText={setShareDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={Colors.textMuted}
                />
                {(() => { const d = new Date(shareDate); return (
                  <Text style={styles.shareRangeHint}>
                    {MONTHS_LONG[d.getMonth()]} {d.getFullYear()}
                  </Text>
                ); })()}
              </>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowShareModal(false)}>
                <Text style={styles.modalCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveBtn, { backgroundColor: '#25D366' }]}
                onPress={handleShareSubmit}
                disabled={shareLoading}
              >
                {shareLoading
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <>
                      <MaterialIcons name="send" size={18} color={Colors.white} />
                      <Text style={styles.modalSaveTxt}>Send on WhatsApp</Text>
                    </>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Log Waste Modal ── */}
      <Modal visible={showWasteModal} transparent animationType="slide" onRequestClose={() => setShowWasteModal(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.modal}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Log Food Waste</Text>

              <Text style={styles.modalLabel}>Item Name *</Text>
              <TextInput
                style={styles.modalInput}
                value={wasteForm.productName}
                onChangeText={v => setWasteForm(p => ({ ...p, productName: v }))}
                placeholder="e.g. Chicken Tikka"
                placeholderTextColor={Colors.textMuted}
              />

              <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalLabel}>Quantity *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={wasteForm.quantity}
                    onChangeText={v => setWasteForm(p => ({ ...p, quantity: v }))}
                    placeholder="1"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalLabel}>Unit</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={wasteForm.unit}
                    onChangeText={v => setWasteForm(p => ({ ...p, unit: v }))}
                    placeholder="portion / kg / pcs"
                    placeholderTextColor={Colors.textMuted}
                  />
                </View>
              </View>

              <Text style={styles.modalLabel}>Reason</Text>
              <View style={styles.reasonRow}>
                {WASTE_REASONS.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.reasonChip, wasteForm.reason === r.id && { backgroundColor: r.color, borderColor: r.color }]}
                    onPress={() => setWasteForm(p => ({ ...p, reason: r.id }))}
                  >
                    <Text style={[styles.reasonChipTxt, wasteForm.reason === r.id && { color: Colors.white }]}>{r.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.modalLabel}>Estimated Loss ({cur})</Text>
              <TextInput
                style={styles.modalInput}
                value={wasteForm.estimatedLoss}
                onChangeText={v => setWasteForm(p => ({ ...p, estimatedLoss: v }))}
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />

              <Text style={styles.modalLabel}>Notes (optional)</Text>
              <TextInput
                style={styles.modalInput}
                value={wasteForm.notes}
                onChangeText={v => setWasteForm(p => ({ ...p, notes: v }))}
                placeholder="Additional details..."
                placeholderTextColor={Colors.textMuted}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowWasteModal(false)}>
                  <Text style={styles.modalCancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSaveBtn} onPress={saveWasteLog} disabled={wasteSaving}>
                  {wasteSaving
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.modalSaveTxt}>Save Log</Text>
                  }
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
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: 'bold', color: Colors.text },
  headerAddBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },

  tabs: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    gap: 2,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: Colors.primary },
  tabText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: Colors.primary },
  badge: {
    backgroundColor: Colors.danger,
    borderRadius: BorderRadius.round,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: Colors.white, fontSize: 9, fontWeight: 'bold' },

  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  dateArrow: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.sm,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dateArrowText: { color: Colors.text, fontSize: FontSize.lg, fontWeight: 'bold' },
  dateInput: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    color: Colors.text,
    fontSize: FontSize.sm,
    textAlign: 'center',
    marginHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  todayBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginLeft: Spacing.sm,
  },
  todayBtnText: { color: Colors.white, fontWeight: '600', fontSize: FontSize.sm },

  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: Colors.textSecondary, marginTop: Spacing.md },
  scrollContent: { padding: Spacing.lg, paddingBottom: 80 },

  statsRow: { marginBottom: Spacing.md },
  statsRowDouble: { flexDirection: 'row', marginBottom: Spacing.md, gap: Spacing.md },
  statCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.xl,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statCardHalf: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.xs,
  },
  statValueBig: { fontSize: 34, fontWeight: 'bold', color: Colors.text },
  statValueMed: { fontSize: FontSize.xxl, fontWeight: 'bold', color: Colors.text },

  section: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.md,
  },

  payRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm },
  payDot: { width: 10, height: 10, borderRadius: 5, marginRight: Spacing.sm },
  payLabel: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.md },
  payValue: { fontSize: FontSize.md, fontWeight: '700' },

  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rank: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.card,
  },
  rankText: { fontSize: FontSize.sm, fontWeight: 'bold' },
  productName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  productSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  productRevenue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },

  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  stockLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  vegDot: { width: 8, height: 8, borderRadius: 4 },
  stockBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
  },
  stockCount: { fontSize: FontSize.sm, fontWeight: '700' },

  emptyBox: { alignItems: 'center', paddingVertical: Spacing.xl },
  emptyText: { color: Colors.textSecondary, fontSize: FontSize.md, marginTop: Spacing.sm },

  // GST tab
  gstRangeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  gstRangeLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '600',
    marginBottom: 4,
  },
  gstRangeInput: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    color: Colors.text,
    fontSize: FontSize.sm,
  },
  gstFetchBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    alignSelf: 'flex-end',
    minWidth: 56,
    alignItems: 'center',
  },
  gstFetchBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
  gstRow: {
    flexDirection: 'row',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  gstHeaderRow: { backgroundColor: Colors.card },
  gstCell: {
    fontSize: FontSize.sm,
    color: Colors.text,
    paddingHorizontal: 2,
  },
  gstCellHdr: {
    fontWeight: '700',
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    textTransform: 'uppercase',
  },
  gstTotalRow: {
    backgroundColor: Colors.card,
    borderTopWidth: 2,
    borderTopColor: Colors.primary + '40',
  },
  gstTotalCell: { fontWeight: '800', color: Colors.text },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: 14,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  exportBtnText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.md },

  // Waste log modal
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay },
  modal: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xxxl, borderTopRightRadius: BorderRadius.xxxl,
    padding: Spacing.xxl, paddingBottom: 40, marginTop: 80,
  },
  modalHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg },
  modalTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, textAlign: 'center', marginBottom: Spacing.lg },
  modalLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600', marginBottom: 6, marginTop: Spacing.md },
  modalInput: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.lg, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.text,
  },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  reasonChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: BorderRadius.round, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  reasonChipTxt: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  modalActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
  modalCancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: BorderRadius.lg,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center',
  },
  modalCancelTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: FontSize.lg },
  modalSaveBtn: {
    flex: 2, paddingVertical: 14, borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  modalSaveTxt: { color: Colors.white, fontWeight: '800', fontSize: FontSize.lg },

  // Premium tag badge on buttons
  premiumTag: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: BorderRadius.round,
    paddingHorizontal: 7, paddingVertical: 2,
    marginLeft: Spacing.xs,
  },
  premiumTagTxt: { fontSize: 9, fontWeight: '900', color: Colors.white, letterSpacing: 0.5 },

  // Premium gate modal
  premiumOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: Spacing.xl,
  },
  premiumCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xxl,
    padding: Spacing.xxl, alignItems: 'center', width: '100%',
    borderWidth: 2, borderColor: Colors.primary + '40',
  },
  premiumIconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md,
  },
  premiumCrown: { fontSize: 36 },
  premiumLabel: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  premiumFeatureName: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.text, marginBottom: Spacing.sm, textAlign: 'center' },
  premiumDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.lg },
  premiumPlanRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.xl, flexWrap: 'wrap', justifyContent: 'center' },
  premiumPlanChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryBg, borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  premiumPlanTxt: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },
  premiumUpgradeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.xl,
    paddingVertical: Spacing.lg, paddingHorizontal: Spacing.xl,
    width: '100%', justifyContent: 'center',
  },
  premiumUpgradeTxt: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },
  premiumDismiss: { marginTop: Spacing.md, paddingVertical: Spacing.sm },
  premiumDismissTxt: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },

  // WhatsApp share modal
  sharePeriodRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  sharePeriodChip: {
    flex: 1, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md,
    borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.card, alignItems: 'center',
  },
  sharePeriodChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  sharePeriodTxt: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },
  sharePeriodTxtActive: { color: Colors.white },
  shareRangeHint: {
    fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600',
    marginTop: 6, marginBottom: Spacing.sm, textAlign: 'center',
  },
});

export default ReportsScreen;
