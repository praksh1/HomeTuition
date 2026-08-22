import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { notify } from "@/utils/alerts";
import { useColors } from "@/hooks/useColors";
import { apiPost } from "@/utils/api";

const REASONS = ["Payment Issue", "Technical Failure", "Inappropriate Behavior", "Other"] as const;
type Reason = (typeof REASONS)[number];

interface UploadUrlResponse {
  /** Note the capitalisation: the server returns `uploadURL`, and reading `uploadUrl` gets you
   *  `undefined` and a PUT to nowhere. That was the second of two faults in this upload. */
  uploadURL: string;
  objectPath: string;
}

interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  /** Bytes. The upload endpoint requires it, and a missing one is a 400. */
  size: number;
}

/**
 * The largest file worth trying to send.
 *
 * The owner asked for video, which is the reason there is a limit at all — a phone camera
 * produces tens of megabytes a minute, and the people using this app are on cheap Android
 * handsets and poor connections. Twenty-five megabytes is roughly a minute of phone video:
 * enough to show what went wrong, small enough to actually arrive.
 */
const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

export default function SupportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  /**
   * Arrived from a particular class, e.g. one whose teacher was late.
   *
   * When it is set, the report carries the class with it and the server can read its own
   * record of what happened — who joined, when, and for how long. See the API's
   * lib/participation.ts.
   */
  const { sessionId, reason: presetReason } = useLocalSearchParams<{ sessionId?: string; reason?: string }>();
  const [reason, setReason] = useState<Reason | null>(
    REASONS.includes(presetReason as Reason) ? (presetReason as Reason) : null,
  );
  const [reasonOpen, setReasonOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      // Video included because the owner asked for it: "a customer service menu activates
      // allowing a video attachment".
      type: ["image/*", "video/*", "application/pdf"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    // Checked before anything is read, so a huge video is refused instantly rather than after
    // the phone has spent a minute loading it into memory.
    const size = asset.size ?? 0;
    if (size > MAX_EVIDENCE_BYTES) {
      notify(
        "File too large",
        `That file is ${Math.round(size / 1024 / 1024)} MB. Please attach something under ` +
          `${MAX_EVIDENCE_BYTES / 1024 / 1024} MB — a short clip or a screenshot is enough.`,
      );
      return;
    }

    setFile({
      uri: asset.uri,
      name: asset.name ?? "evidence",
      mimeType: asset.mimeType ?? "application/octet-stream",
      size,
    });
  };

  const uploadEvidence = async (): Promise<string> => {
    if (!file) throw new Error("No file selected");
    /**
     * `name` and `size`, not `fileName`.
     *
     * This is why attaching anything to a report has never worked: the app sent `fileName` and
     * no size, the endpoint requires `name`, `size` and `contentType`, and every upload came
     * back 400 before a single byte left the phone. Nothing said so — the report simply failed.
     */
    const { uploadURL, objectPath } = await apiPost<UploadUrlResponse>("/storage/uploads/request-url", {
      name: file.name,
      size: file.size > 0 ? file.size : 1,
      contentType: file.mimeType,
    });

    if (Platform.OS === "web") {
      const fileResp = await fetch(file.uri);
      const blob = await fileResp.blob();
      const putResp = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.mimeType },
        body: blob,
      });
      if (!putResp.ok) throw new Error("Upload failed");
    } else {
      const FileSystem = await import("expo-file-system");
      const uploadResult = await FileSystem.uploadAsync(uploadURL, file.uri, {
        httpMethod: "PUT",
        headers: { "Content-Type": file.mimeType },
      });
      if (uploadResult.status < 200 || uploadResult.status >= 300) throw new Error("Upload failed");
    }

    return objectPath;
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      /**
       * A failed upload must never swallow the complaint.
       *
       * File storage is not set up on the server — the upload endpoint is left over from the
       * app's Replit origins and wants object-storage settings that do not exist on Railway.
       * Until that is sorted out, a report with a file attached would fail completely, which
       * is the worst possible outcome for the person filing it. So the words are sent either
       * way, and the person is told plainly that the attachment did not go with them.
       */
      let evidenceUrl: string | null = null;
      let attachmentFailed = false;
      if (file) {
        try {
          evidenceUrl = await uploadEvidence();
        } catch {
          attachmentFailed = true;
        }
      }
      await apiPost("/disputes", {
        reason,
        description: description.trim(),
        evidenceUrl,
        ...(sessionId ? { sessionId: Number(sessionId) } : {}),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notify(
        "Report Submitted",
        attachmentFailed
          ? "Your report has been sent, but we could not upload your file. Our support team " +
            "will be in touch and can ask for it directly."
          : "Our support team will review your report and get back to you shortly.",
      );
      // Clear the form rather than navigating: on the tab there is nowhere to go back to.
      setDescription("");
      setFile(null);
      setReason(null);
      if (router.canGoBack()) router.back();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      notify("Submission Failed", msg);
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Evidence is required only when there is nothing else to go on.
   *
   * Demanding a file from everybody was wrong for the case that matters most: a student whose
   * teacher never turned up has nothing to photograph. When the report carries a class with
   * it, the server already holds the record of who was in that room and when — better evidence
   * than a screenshot, and evidence neither side can edit.
   */
  const needsEvidence = !sessionId;
  const canSubmit =
    !!reason && description.trim().length > 0 && (!needsEvidence || !!file) && !submitting;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 60 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        {/*
          No arrow when this is a tab. The same screen is reached three ways — from Profile,
          from a class that went wrong, and now as a tab of its own — and a back arrow on the
          tab would be a control that does nothing.
        */}
        {router.canGoBack() ? (
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} testID="support-back-btn">
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 22 }} />
        )}
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Customer Support</Text>
        <View style={{ width: 22 }} />
      </View>

      <Text style={[styles.intro, { color: colors.mutedForeground }]}>
        {sessionId
          ? "Tell us what went wrong with this class. We already have our own record of who was " +
            "in the room and when, so you only need to attach something if you have it."
          : "Report an issue or file a dispute. Please provide as much detail as possible along " +
            "with supporting evidence so our team can help you quickly."}
      </Text>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.foreground }]}>Reason</Text>
        <TouchableOpacity
          style={[styles.select, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={() => setReasonOpen((v) => !v)}
          activeOpacity={0.7}
          testID="dispute-reason-select"
        >
          <Text style={[styles.selectText, { color: reason ? colors.foreground : colors.mutedForeground }]}>
            {reason ?? "Select a reason"}
          </Text>
          <Feather name={reasonOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
        {reasonOpen && (
          <View style={[styles.optionsList, { borderColor: colors.border, backgroundColor: colors.card }]}>
            {REASONS.map((r) => (
              <TouchableOpacity
                key={r}
                style={styles.optionRow}
                onPress={() => {
                  setReason(r);
                  setReasonOpen(false);
                }}
                activeOpacity={0.7}
                testID={`dispute-reason-option-${r}`}
              >
                <Text style={[styles.optionText, { color: colors.foreground }]}>{r}</Text>
                {reason === r && <Feather name="check" size={16} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.foreground }]}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Describe the issue in detail..."
          placeholderTextColor={colors.mutedForeground}
          style={[styles.textarea, { borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground }]}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
          testID="dispute-description-input"
        />
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.foreground }]}>
          {needsEvidence ? "Evidence (required)" : "Evidence (optional)"}
        </Text>
        <TouchableOpacity
          style={[
            styles.uploadBtn,
            { borderColor: file ? colors.success : colors.border, backgroundColor: file ? colors.success + "10" : colors.muted },
          ]}
          onPress={pickFile}
          activeOpacity={0.7}
          testID="dispute-upload-btn"
        >
          <Feather name={file ? "check-circle" : "paperclip"} size={18} color={file ? colors.success : colors.mutedForeground} />
          <Text style={[styles.uploadText, { color: file ? colors.success : colors.mutedForeground }]} numberOfLines={1}>
            {file
              ? file.name
              : needsEvidence
                ? "Attach a screenshot or document"
                : "Attach a photo or video, if you have one"}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.submitBtn, { backgroundColor: canSubmit ? colors.primary : colors.muted }]}
        onPress={submit}
        disabled={!canSubmit}
        activeOpacity={0.85}
        testID="dispute-submit-btn"
      >
        <Text style={[styles.submitText, { color: canSubmit ? "#fff" : colors.mutedForeground }]}>
          {submitting ? "Submitting..." : "Submit Report"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  field: { gap: 8 },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  select: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 14 },
  selectText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  optionsList: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  optionText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  textarea: { borderRadius: 12, borderWidth: 1, padding: 14, fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 130 },
  uploadBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, padding: 14 },
  uploadText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  submitBtn: { borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  submitText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
