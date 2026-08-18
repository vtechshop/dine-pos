import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { Colors, FontSize, Spacing, BorderRadius } from '../utils/constants';
import { navigationRef } from '../utils/navigationRef';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'Unknown error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error?.message, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' });
    // Reset navigation to the initial route of whichever stack is active.
    // CommonActions.reset works in both authenticated and unauthenticated stacks;
    // if RoleSelect is not registered (authenticated stack), the navigator falls back to MainTabs.
    if (navigationRef.isReady()) {
      navigationRef.dispatch(
        CommonActions.reset({ index: 0, routes: [{ name: 'RoleSelect' }] }),
      );
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <MaterialIcons name="error-outline" size={56} color={Colors.danger} />
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          An unexpected error occurred. Your data is safe — tap below to return to the home screen.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={this.handleReset} activeOpacity={0.8}>
          <MaterialIcons name="home" size={20} color={Colors.white} />
          <Text style={styles.btnText}>Return to Home</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

export default ErrorBoundary;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  body: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xxxl,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xxl,
    borderRadius: BorderRadius.md,
  },
  btnText: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
});
