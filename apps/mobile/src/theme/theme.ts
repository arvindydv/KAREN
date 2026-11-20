import {
  brand,
  colors,
  radius,
  spacing,
  typography,
  MIN_TOUCH_TARGET,
  type ColorScheme,
} from '@karen/ui';
import { useColorScheme } from 'react-native';

/** Native theme built from the shared, platform-neutral tokens in @karen/ui. */
export interface NativeTheme {
  scheme: 'light' | 'dark';
  colors: ColorScheme;
  brand: typeof brand;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  minTouchTarget: number;
  /** Frosted-glass surface colours for cards/pills over the space background. */
  glass: { fill: string; border: string };
}

export const buildTheme = (scheme: 'light' | 'dark'): NativeTheme => ({
  scheme,
  colors: colors[scheme],
  brand,
  spacing,
  radius,
  typography,
  minTouchTarget: MIN_TOUCH_TARGET,
  glass:
    scheme === 'dark'
      ? { fill: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)' }
      : { fill: 'rgba(255,255,255,0.75)', border: 'rgba(10,16,48,0.08)' },
});

/**
 * KAREN's signature look is the dark "deep space" theme (app.config sets
 * userInterfaceStyle: 'dark'); the light scheme stays available for when the user chooses it.
 */
export function useTheme(): NativeTheme {
  return buildTheme(useColorScheme() === 'light' ? 'light' : 'dark');
}
