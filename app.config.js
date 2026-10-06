module.exports = ({ config }) => ({
  ...config,
  name: 'The Shop',
  slug: 'the-shop-mobile',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  scheme: process.env.EXPO_PUBLIC_APP_SCHEME || 'the-shop-dev',
  ios: {
    ...config.ios,
    bundleIdentifier: process.env.EXPO_IOS_BUNDLE_ID || 'com.example.theshop',
    supportsTablet: true,
  },
  android: {
    ...config.android,
    package: process.env.EXPO_ANDROID_PACKAGE || 'com.example.theshop',
    adaptiveIcon: { backgroundColor: '#52684f' },
  },
  extra: {
    ...(config.extra || {}),
    eas: {
      ...((config.extra && config.extra.eas) || {}),
      projectId: '338c5bbf-b014-4b33-95f3-218eeb937961',
    },
  },
  plugins: ['expo-web-browser'],
});
