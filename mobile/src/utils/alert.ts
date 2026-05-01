import { Alert, Platform } from 'react-native';

// Web-compatible alert wrapper
// Alert.alert doesn't work on web, so we use window.alert/confirm as fallback
export const showAlert = (
  title: string,
  message: string,
  buttons?: Array<{
    text: string;
    onPress?: () => void;
    style?: 'default' | 'cancel' | 'destructive';
  }>
) => {
  if (Platform.OS === 'web') {
    if (buttons && buttons.length > 1) {
      // Has cancel + confirm → use window.confirm
      const confirmed = window.confirm(`${title}\n\n${message}`);
      if (confirmed) {
        const confirmBtn = buttons.find((b) => b.style !== 'cancel');
        confirmBtn?.onPress?.();
      } else {
        const cancelBtn = buttons.find((b) => b.style === 'cancel');
        cancelBtn?.onPress?.();
      }
    } else {
      // Simple alert
      window.alert(`${title}\n\n${message}`);
      if (buttons && buttons[0]?.onPress) {
        buttons[0].onPress();
      }
    }
  } else {
    Alert.alert(title, message, buttons);
  }
};
