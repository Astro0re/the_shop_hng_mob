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
  plugins: ['expo-web-browser'],
});
