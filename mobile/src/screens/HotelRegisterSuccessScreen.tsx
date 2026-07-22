import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Colors } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'HotelRegisterSuccess'>;

const HotelRegisterSuccessScreen: React.FC<Props> = ({ navigation }) => {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <MaterialIcons name="check-circle" size={72} color={Colors.success} style={styles.icon} />
        <Text style={styles.title}>Registration Submitted!</Text>
        <Text style={styles.body}>
          Your hotel has been registered successfully. Our team will review your application and approve it within 24 hours.
        </Text>
        <Text style={styles.body}>
          Once approved, you will receive your login credentials via phone or email.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.btn}
        onPress={() => navigation.navigate('AdminLogin')}
        activeOpacity={0.85}
      >
        <Text style={styles.btnText}>Back to Login</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background, padding: 24, justifyContent: 'center' },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  icon:    { marginBottom: 16 },
  title:   { fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center', marginBottom: 14 },
  body:    { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  btn:     {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 28,
  },
  btnText: { fontSize: 15, fontWeight: '700', color: Colors.surface },
});

export default HotelRegisterSuccessScreen;
