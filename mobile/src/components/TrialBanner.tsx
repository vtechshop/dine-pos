import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  daysRemaining: number;
  onContactSupport?: () => void;
}

export default function TrialBanner({ daysRemaining, onContactSupport }: Props) {
  if (daysRemaining > 7) return null;

  const isUrgent = daysRemaining <= 1;
  const bgColor = isUrgent ? '#E8380D' : daysRemaining <= 3 ? '#F59E0B' : '#3B82F6';

  const label =
    daysRemaining <= 0
      ? 'Your trial has expired'
      : daysRemaining === 1
      ? '⚠️ Trial expires today!'
      : `⏳ ${daysRemaining} days left in your trial`;

  return (
    <View style={[styles.banner, { backgroundColor: bgColor }]}>
      <Text style={styles.text}>{label}</Text>
      {onContactSupport && (
        <TouchableOpacity onPress={onContactSupport} activeOpacity={0.8}>
          <Text style={styles.link}>Contact Support</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  text: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  link: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginLeft: 8,
  },
});
