const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Declares the foreground service `@daily-co/react-native-daily-js` needs on Android.
 *
 * Daily keeps a call alive while the app is backgrounded by running
 * `DailyOngoingMeetingForegroundService`. The library ships the Java class but its own
 * AndroidManifest is empty, so unless the app declares the service the call drops the moment
 * the teacher switches away — which is exactly what happens when they go to pick the window
 * to share.
 *
 * Screen capture itself is already covered: `@daily-co/react-native-webrtc` declares its own
 * `MediaProjectionService` (foregroundServiceType="mediaProjection") plus the
 * FOREGROUND_SERVICE_MEDIA_PROJECTION permission, and Gradle merges that in automatically.
 * Duplicating it here would cause a manifest merge conflict.
 */
const SERVICE_NAME = "com.daily.reactlibrary.DailyOngoingMeetingForegroundService";

const withDailyAndroid = (config) =>
  withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults?.manifest?.application?.[0];
    if (!application) {
      throw new Error(
        "withDailyAndroid: no <application> node in AndroidManifest — cannot add Daily's foreground service.",
      );
    }

    application.service = application.service ?? [];

    const already = application.service.some(
      (s) => s?.$?.["android:name"] === SERVICE_NAME,
    );
    if (already) return cfg;

    application.service.push({
      $: {
        "android:name": SERVICE_NAME,
        // camera|microphone matches what the service actually holds open during a call.
        // Screen sharing runs through react-native-webrtc's separate mediaProjection service.
        "android:foregroundServiceType": "camera|microphone",
        "android:exported": "false",
      },
    });

    return cfg;
  });

module.exports = withDailyAndroid;
