import type { ExpoConfig } from 'expo/config';

/**
 * Blue Collar employee app. Values that differ per environment come from EAS environment
 * variables (eas.json / EAS dashboard), never from source code.
 */
const config: ExpoConfig = {
  name: 'Blue Collar',
  slug: 'blue-collar',
  scheme: 'bluecollar',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.bluecollarshift.app',
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      // Foreground ("when in use") only — no background location tracking.
      NSLocationWhenInUseUsageDescription:
        'Blue Collar uses your location only when you clock in, clock out or take a break, to confirm you are at the job site.',
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
      ],
    },
  },
  android: {
    package: 'com.bluecollarshift.app',
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#FFFFFF' },
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'POST_NOTIFICATIONS', 'RECORD_AUDIO', 'CAMERA'],
    blockedPermissions: ['ACCESS_BACKGROUND_LOCATION'],
    config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY } },
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-secure-store',
    'expo-background-task',
    ['expo-location', { locationWhenInUsePermission: 'Blue Collar uses your location only when you clock in, clock out or take a break, to confirm you are at the job site.', isAndroidBackgroundLocationEnabled: false, isIosBackgroundLocationEnabled: false }],
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#016B93' }],
    // Microphone: only while recording a voice note for feedback (never in the background).
    ['expo-audio', { microphonePermission: 'Blue Collar uses the microphone only when you record a voice note to send feedback.', enableBackgroundRecording: false }],
    // Photos/camera: only when you attach a screenshot or a safety photo.
    ['expo-image-picker', { photosPermission: 'Blue Collar uses your photos only when you attach a screenshot or a safety photo.', cameraPermission: 'Blue Collar uses the camera only when you take a safety photo.', microphonePermission: false }],
    ['expo-splash-screen', { image: './assets/logo.png', imageWidth: 220, backgroundColor: '#FFFFFF' }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
