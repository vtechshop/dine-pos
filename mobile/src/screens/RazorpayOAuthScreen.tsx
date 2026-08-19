import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Colors, FontSize, BorderRadius, Spacing } from '../utils/constants';
import {
  getRazorpayOAuthStatus, getRazorpayOAuthConnectUrl, disconnectRazorpayOAuth,
  type MobileRazorpayOAuthStatus,
} from '../services/api';

type Props = NativeStackScreenProps<RootStackParamList, 'RazorpayOAuth'>;

function fmtDate(s?: string): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysUntil(s?: string): number | null {
  if (!s) return null;
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000);
}

export default function RazorpayOAuthScreen({ navigation, route }: Props) {
  const { top } = useSafeAreaInsets();
  const [status,       setStatus]       = useState<MobileRazorpayOAuthStatus | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [connecting,   setConnecting]   = useState(false);
  const [disconnecting,setDisconnecting]= useState(false);
  const [bannerMsg,    setBannerMsg]    = useState<{ text: string; ok: boolean } | null>(null);

  // Handle deep-link return params (dinepos://razorpay/oauth?status=connected or ?error=...)
  useEffect(() => {
    const p = route.params;
    if (!p) return;
    if (p.status === 'connected') {
      setBannerMsg({ text: 'Razorpay account connected successfully.', ok: true });
    } else if (p.error) {
      setBannerMsg({ text: `Connection failed: ${p.error}`, ok: false });
    }
  }, [route.params]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getRazorpayOAuthStatus());
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleConnect = async () => {
    setConnecting(true);
    setBannerMsg(null);
    try {
      const { authorizeUrl } = await getRazorpayOAuthConnectUrl();
      const canOpen = await Linking.canOpenURL(authorizeUrl);
      if (!canOpen) {
        Alert.alert('Cannot Open Browser', 'Unable to open the system browser. Please check your device settings.');
        return;
      }
      await Linking.openURL(authorizeUrl);
    } catch (e) {
      Alert.alert('Error', (e as Error).message ?? 'Failed to start OAuth connection.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect Razorpay',
      'This will revoke your Razorpay OAuth connection. You will need to reconnect to accept online payments via Razorpay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setDisconnecting(true);
            setBannerMsg(null);
            try {
              await disconnectRazorpayOAuth();
              setBannerMsg({ text: 'Razorpay account disconnected.', ok: true });
              await load();
            } catch (e) {
              setBannerMsg({ text: (e as Error).message ?? 'Disconnect failed.', ok: false });
            } finally {
              setDisconnecting(false);
            }
          },
        },
      ],
    );
  };

  const refreshExpiry = status?.connected ? daysUntil(status.refreshExpiresAt) : null;
  const accessExpiry  = status?.connected ? daysUntil(status.expiresAt) : null;

  return (
    <View style={[s.root, { paddingTop: top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={s.title}>Razorpay OAuth</Text>
        <TouchableOpacity onPress={load} style={s.back} hitSlop={12} disabled={loading}>
          <MaterialIcons name="refresh" size={22} color={loading ? Colors.textSecondary : Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>

        {/* Deep-link return banner */}
        {bannerMsg && (
          <View style={[s.banner, bannerMsg.ok ? s.bannerOk : s.bannerErr]}>
            <MaterialIcons
              name={bannerMsg.ok ? 'check-circle' : 'error'}
              size={18}
              color={bannerMsg.ok ? Colors.success ?? '#2E7D32' : Colors.danger}
            />
            <Text style={[s.bannerText, { color: bannerMsg.ok ? Colors.success ?? '#2E7D32' : Colors.danger }]}>
              {bannerMsg.text}
            </Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator style={s.center} color={Colors.primary} size="large" />
        ) : (
          <>
            {/* Status card */}
            <View style={s.card}>
              <View style={s.cardRow}>
                <View style={[s.dot, status?.connected ? s.dotGreen : s.dotGrey]} />
                <Text style={s.cardTitle}>
                  {status?.connected ? 'Connected' : 'Not Connected'}
                </Text>
              </View>
              {status?.connected && (
                <>
                  <Row label="Account ID"   value={status.accountId ?? '—'} />
                  <Row label="Environment"  value={status.environment ?? '—'} />
                  <Row label="Connected On" value={fmtDate(status.connectedAt)} />
                  <Row label="Access Token Expires" value={
                    accessExpiry !== null
                      ? accessExpiry <= 0 ? 'Expired' : `${accessExpiry} day${accessExpiry === 1 ? '' : 's'}`
                      : fmtDate(status.expiresAt)
                  } />
                  <Row label="Refresh Token Expires" value={
                    refreshExpiry !== null
                      ? refreshExpiry <= 0 ? 'Expired' : `${refreshExpiry} day${refreshExpiry === 1 ? '' : 's'}`
                      : fmtDate(status.refreshExpiresAt)
                  } />
                </>
              )}
            </View>

            {/* Refresh token warning */}
            {status?.connected && status.refreshTokenWarning && (
              <View style={s.warning}>
                <MaterialIcons name="warning" size={18} color={Colors.warning ?? '#F57C00'} />
                <Text style={s.warningText}>
                  Your Razorpay refresh token expires in less than 30 days. Reconnect now to avoid losing OAuth access permanently.
                </Text>
              </View>
            )}

            {/* KYC / info note */}
            <View style={s.info}>
              <MaterialIcons name="info-outline" size={16} color={Colors.textSecondary} />
              <Text style={s.infoText}>
                Razorpay OAuth lets your hotel accept payments via Razorpay's Technology Partner program.
                Connecting opens the Razorpay authorization page in your system browser.
                Token storage and automatic refresh happen entirely on the server — no secrets are stored on this device.
              </Text>
            </View>

            {/* Actions */}
            {!status?.connected ? (
              <TouchableOpacity
                style={[s.btn, s.btnPrimary, connecting && s.btnDisabled]}
                onPress={handleConnect}
                disabled={connecting}
                activeOpacity={0.8}
              >
                {connecting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <MaterialIcons name="link" size={20} color="#fff" />
                }
                <Text style={s.btnText}>{connecting ? 'Opening Browser…' : 'Connect Razorpay Account'}</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={[s.btn, s.btnSecondary, connecting && s.btnDisabled]}
                  onPress={handleConnect}
                  disabled={connecting}
                  activeOpacity={0.8}
                >
                  {connecting
                    ? <ActivityIndicator color={Colors.primary} size="small" />
                    : <MaterialIcons name="refresh" size={20} color={Colors.primary} />
                  }
                  <Text style={[s.btnText, { color: Colors.primary }]}>
                    {connecting ? 'Opening Browser…' : 'Reconnect Account'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.btn, s.btnDanger, disconnecting && s.btnDisabled]}
                  onPress={handleDisconnect}
                  disabled={disconnecting}
                  activeOpacity={0.8}
                >
                  {disconnecting
                    ? <ActivityIndicator color={Colors.danger} size="small" />
                    : <MaterialIcons name="link-off" size={20} color={Colors.danger} />
                  }
                  <Text style={[s.btnText, { color: Colors.danger }]}>
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: Colors.background },
  header:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  back:       { padding: 4 },
  title:      { flex: 1, textAlign: 'center', fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  body:       { padding: Spacing.md, paddingBottom: 40 },
  center:     { marginTop: 60 },
  banner:     { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: BorderRadius.md, padding: 12, marginBottom: Spacing.md },
  bannerOk:   { backgroundColor: '#E8F5E9' },
  bannerErr:  { backgroundColor: '#FDECEA' },
  bannerText: { flex: 1, fontSize: FontSize.sm, fontWeight: '600' },
  card:       { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  cardRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardTitle:  { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  dot:        { width: 10, height: 10, borderRadius: 5 },
  dotGreen:   { backgroundColor: Colors.success ?? '#2E7D32' },
  dotGrey:    { backgroundColor: Colors.textSecondary },
  row:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  rowLabel:   { fontSize: FontSize.sm, color: Colors.textSecondary },
  rowValue:   { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  warning:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FFF8E1', borderRadius: BorderRadius.md, padding: 12, marginBottom: Spacing.md, borderWidth: 1, borderColor: '#FFE082' },
  warningText:{ flex: 1, fontSize: FontSize.sm, color: '#E65100', lineHeight: 18 },
  info:       { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: 12, marginBottom: Spacing.md },
  infoText:   { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 18 },
  btn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: BorderRadius.md, paddingVertical: 14, paddingHorizontal: Spacing.md, marginBottom: 12 },
  btnPrimary: { backgroundColor: Colors.primary },
  btnSecondary:{ backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.primary },
  btnDanger:  { backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.danger },
  btnDisabled:{ opacity: 0.6 },
  btnText:    { fontSize: FontSize.md, fontWeight: '700', color: '#fff' },
});
