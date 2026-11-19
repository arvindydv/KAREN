import { colors, radius, spacing, typography, MIN_TOUCH_TARGET, type ColorScheme } from '@karen/ui';
import { useColorScheme } from 'react-native';

/** Native theme built from the shared, platform-neutral tokens in @karen/ui. */
export interface NativeTheme {
  scheme: 'light' | 'dark';
  colors: ColorScheme;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  minTouchTarget: number;
}

export const buildTheme = (scheme: 'light' | 'dark'): NativeTheme => ({
  scheme,
  colors: colors[scheme],
  spacing,
  radius,
  typography,
  minTouchTarget: MIN_TOUCH_TARGET,
});

export function useTheme(): NativeTheme {
  return buildTheme(useColorScheme() === 'dark' ? 'dark' : 'light');
}
