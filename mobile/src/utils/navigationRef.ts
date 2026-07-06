import { createNavigationContainerRef, ParamListBase } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<ParamListBase>();

export const navigateGlobal = (name: string, params?: Record<string, unknown>): void => {
  if (navigationRef.isReady()) {
    (navigationRef as any).navigate(name, params);
  }
};
