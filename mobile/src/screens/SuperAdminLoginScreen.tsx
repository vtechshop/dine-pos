import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { showAlert } from '../utils/alert';
import { superAdminLogin, setSuperAdminCredentials } from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'SuperAdminLogin'>;

const SuperAdminLoginScreen: React.FC<Props> = ({ navigation }) => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!userId.trim() || !password.trim()) {
      showAlert('Error', 'Please enter credentials');
      return;
    }
    setLoading(true);
    try {
      await superAdminLogin(userId.trim(), password.trim());
      setSuperAdminCredentials(userId.trim(), password.trim());
      navigation.replace('SuperAdminDashboard');
    } catch (error: any) {
      showAlert('Login Failed', error.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.replace('RoleSelect')}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>

        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="security" size={50} color={Colors.white} />
          </View>
          <Text style={styles.title}>Super Admin</Text>
          <Text style={styles.subtitle}>Platform Management Portal</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <MaterialIcons name="person" size={22} color={Colors.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Admin ID"
              placeholderTextColor={Colors.textMuted}
              value={userId}
              onChangeText={setUserId}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputContainer}>
            <MaterialIcons name="lock" size={22} color={Colors.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={Colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <MaterialIcons name={showPassword ? 'visibility' : 'visibility-off'} size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={loading} activeOpacity={0.8}>
            {loading ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <>
                <Text style={styles.loginBtnText}>Login</Text>
                <MaterialIcons name="arrow-forward" size={22} color={Colors.white} />
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: Colors.background, justifyContent: 'center', padding: Spacing.xxl },
  backBtn: { position: 'absolute', top: 50, left: 20, padding: Spacing.sm, borderRadius: BorderRadius.round, backgroundColor: Colors.card, zIndex: 10 },
  header: { alignItems: 'center', marginBottom: 40 },
  iconCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#7B1FA2', justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.lg },
  title: { fontSize: FontSize.title, fontWeight: 'bold', color: Colors.text },
  subtitle: { fontSize: FontSize.md, color: Colors.textSecondary, marginTop: Spacing.xs },
  form: { gap: Spacing.lg },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.lg, borderWidth: 1, borderColor: Colors.border },
  inputIcon: { marginRight: Spacing.md },
  input: { flex: 1, paddingVertical: Spacing.lg, fontSize: FontSize.lg, color: Colors.text },
  loginBtn: { flexDirection: 'row', backgroundColor: '#7B1FA2', paddingVertical: Spacing.lg, borderRadius: BorderRadius.md, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  loginBtnText: { color: Colors.white, fontSize: FontSize.xl, fontWeight: 'bold' },
});

export default SuperAdminLoginScreen;
