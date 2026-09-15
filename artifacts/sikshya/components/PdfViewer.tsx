import React from "react";
import { StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { WebView } from "react-native-webview";

interface Props {
  uri: string;
  style?: StyleProp<ViewStyle>;
  /** Web reader zoom; native WebView supplies its own pinch zoom. */
  zoom?: number;
}

/**
 * Native (iOS/Android): render the PDF in a WebView.
 * The `uri` may be a `file://` path (from DocumentPicker) or an `https://` URL.
 * JS is intentionally disabled — we only need passive document rendering.
 */
export default function PdfViewer({ uri, style }: Props) {
  return (
    <WebView
      source={{ uri }}
      style={[styles.fill, style]}
      originWhitelist={["*"]}
      allowFileAccess
      javaScriptEnabled={false}
    />
  );
}

const styles = StyleSheet.create({
  fill: StyleSheet.absoluteFillObject,
});
