import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import PdfViewer from "@/components/PdfViewer";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { attachmentKind, attachmentKindLabel } from "@/utils/attachmentTypes";
import { attachmentUrl, openAttachment } from "@/utils/openAttachment";
import { attachmentLabel, type Attachment } from "@/utils/reactions";

interface Props {
  file: Attachment;
  visible: boolean;
  onClose: () => void;
  onProblem?: (reason: string) => void;
  /** Reuse a still-valid thumbnail link instead of making a second request. */
  initialUrl?: string | null;
}

/**
 * A private, in-Fadko attachment viewer.
 *
 * Photos and PDFs never throw the reader into another browser tab. Office documents remain in
 * this shell too, but are not sent to Google/Microsoft preview services: doing that would hand a
 * third party the short-lived private URL. They get one honest Download/Save action instead.
 */
export default function AttachmentViewer({ file, visible, onClose, onProblem, initialUrl }: Props) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const { width, height } = useWindowDimensions();
  const kind = attachmentKind(file.fileType);
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem(null);
    try {
      setUrl(await attachmentUrl(file.fileKey));
    } catch (error) {
      setProblem(error instanceof Error && error.message ? error.message : "We could not open that file.");
    } finally {
      setLoading(false);
    }
  }, [file.fileKey]);

  useEffect(() => {
    if (!visible) return;
    setZoom(1);
    if (kind !== "image" && kind !== "pdf") return;
    if (initialUrl) setUrl(initialUrl);
    else void load();
  }, [initialUrl, kind, load, visible]);

  const download = async () => {
    const result = await openAttachment(file.fileKey, {
      download: true,
      fileName: attachmentLabel(file),
    });
    if (!result.ok) {
      const reason = result.reason ?? "We could not save that file.";
      setProblem(reason);
      onProblem?.(reason);
    }
  };

  const pageWidth = Math.max(260, width - 32);
  const pageHeight = Math.max(320, height - 150);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} testID="attachment-viewer">
        <View style={[styles.header, { borderBottomColor: colors.border, paddingHorizontal: space.sm }]}>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.iconButton, { borderColor: colors.border, borderRadius: radius.pill }]}
            accessibilityRole="button"
            accessibilityLabel="Close file preview"
            testID="attachment-viewer-close"
          >
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <View style={styles.titleCopy}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]} numberOfLines={1}>
              {attachmentLabel(file)}
            </Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>
              {attachmentKindLabel(file.fileType)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => void download()}
            style={[styles.downloadButton, { minHeight: HIT_SLOP_MIN, borderColor: colors.primary, borderRadius: radius.pill }]}
            accessibilityRole="button"
            accessibilityLabel={Platform.OS === "web" ? "Download file" : "Save or open file"}
            testID="attachment-viewer-download"
          >
            <Feather name="download" size={17} color={colors.primary} />
            <Text style={[t.caption, { color: colors.primary }]}>{Platform.OS === "web" ? "Download" : "Save"}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {loading || ((kind === "image" || kind === "pdf") && !url && !problem) ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[t.callout, { color: colors.mutedForeground }]}>Opening securely…</Text>
            </View>
          ) : problem ? (
            <View style={[styles.problem, { backgroundColor: colors.destructiveSoft, borderColor: colors.destructive, borderRadius: radius.md }]} accessibilityRole="alert">
              <Feather name="alert-circle" size={22} color={colors.destructive} />
              <Text style={[t.bodyStrong, { color: colors.foreground }]}>This file could not be opened</Text>
              <Text style={[t.callout, styles.centerText, { color: colors.mutedForeground }]}>{problem}</Text>
              <TouchableOpacity onPress={() => void load()} style={[styles.retry, { backgroundColor: colors.primary, borderRadius: radius.sm }]}>
                <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : url && kind === "pdf" ? (
            <View style={[styles.documentFrame, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <PdfViewer uri={url} style={styles.pdf} />
            </View>
          ) : url && kind === "image" ? (
            <View style={styles.imageStage}>
              <ScrollView horizontal maximumZoomScale={3} minimumZoomScale={1} showsHorizontalScrollIndicator>
                <ScrollView showsVerticalScrollIndicator contentContainerStyle={styles.imageScroll}>
                  <Image
                    source={{ uri: url }}
                    style={{ width: pageWidth * zoom, height: pageHeight * zoom }}
                    resizeMode="contain"
                    accessibilityLabel={attachmentLabel(file)}
                  />
                </ScrollView>
              </ScrollView>
              <View style={[styles.zoomBar, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.pill }]}>
                <TouchableOpacity
                  onPress={() => setZoom((value) => Math.max(0.75, Number((value - 0.25).toFixed(2))))}
                  style={styles.zoomButton}
                  accessibilityLabel="Zoom out"
                  disabled={zoom <= 0.75}
                  aria-disabled={zoom <= 0.75}
                >
                  <Feather name="minus" size={19} color={zoom <= 0.75 ? colors.inkFaint : colors.foreground} />
                </TouchableOpacity>
                <Text style={[t.caption, { color: colors.foreground, minWidth: 48, textAlign: "center" }]}>{Math.round(zoom * 100)}%</Text>
                <TouchableOpacity
                  onPress={() => setZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))))}
                  style={styles.zoomButton}
                  accessibilityLabel="Zoom in"
                  disabled={zoom >= 3}
                  aria-disabled={zoom >= 3}
                >
                  <Feather name="plus" size={19} color={zoom >= 3 ? colors.inkFaint : colors.foreground} />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={[styles.officeCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
              <View style={[styles.officeIcon, { backgroundColor: colors.actionSoft, borderRadius: radius.md }]}>
                <Feather name={kind === "spreadsheet" ? "grid" : "file-text"} size={30} color={colors.primary} />
              </View>
              <Text style={[t.title3, styles.centerText, { color: colors.foreground }]}>{attachmentLabel(file)}</Text>
              <Text style={[t.callout, styles.centerText, { color: colors.mutedForeground }]}>
                Fadko keeps this file private. Download it to open it in {kind === "word" ? "Word" : kind === "spreadsheet" ? "Excel" : "an app on your device"}.
              </Text>
              <TouchableOpacity onPress={() => void download()} style={[styles.primaryDownload, { backgroundColor: colors.primary, borderRadius: radius.sm }]}>
                <Feather name="download" size={18} color={colors.primaryForeground} />
                <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Download file</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 10 },
  iconButton: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  titleCopy: { flex: 1, minWidth: 0 },
  downloadButton: { borderWidth: 1, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 7 },
  body: { flex: 1, padding: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  centerText: { textAlign: "center" },
  problem: { alignSelf: "center", marginTop: 48, maxWidth: 460, borderWidth: 1, padding: 24, alignItems: "center", gap: 12 },
  retry: { minHeight: HIT_SLOP_MIN, paddingHorizontal: 22, alignItems: "center", justifyContent: "center" },
  documentFrame: { flex: 1, position: "relative", overflow: "hidden", borderWidth: 1, borderRadius: 12 },
  pdf: { position: "relative", flex: 1, width: "100%", height: "100%" },
  imageStage: { flex: 1, position: "relative" },
  imageScroll: { minWidth: "100%", minHeight: "100%", alignItems: "center", justifyContent: "center" },
  zoomBar: { position: "absolute", bottom: 14, alignSelf: "center", flexDirection: "row", alignItems: "center", borderWidth: 1, paddingHorizontal: 4 },
  zoomButton: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" },
  officeCard: { alignSelf: "center", width: "100%", maxWidth: 460, marginTop: 48, borderWidth: 1, padding: 24, alignItems: "center", gap: 13 },
  officeIcon: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  primaryDownload: { minHeight: HIT_SLOP_MIN, width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
});
