import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  count: number;
}

const UnreadBadge: React.FC<Props> = ({ count }) => {
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <View style={[styles.badge, label.length > 2 && styles.badgeWide]}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E53935',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeWide: { borderRadius: 10 },
  text: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
});

export default UnreadBadge;
