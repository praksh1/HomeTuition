import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { openAttachment } from "@/utils/openAttachment";
import type { UploadableFile } from "@/utils/uploadFile";

export function HomeworkFilePicker({
  file,
  onPick,
  label,
  testID,
}: {
  file: UploadableFile | null;
  onPick: (file: UploadableFile | null) => void;
  label: string;
  testID?: string;
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  const choose = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/*", "application/pdf"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const selected = result.assets[0];
    onPick({
      uri: selected.uri,
      name: selected.name || "attachment",
      mimeType: selected.mimeType || "application/octet-stream",
      size: selected.size || 1,
    });
  };
  return (
    <View style={{ gap: space.xs }}>
      <TouchableOpacity
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={file ? `Choose a different file. Selected ${file.name}` : label}
        onPress={() => void choose()}
        style={{
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.sm,
          borderWidth: 1,
          borderRadius: 10,
          borderColor: file ? colors.primary : colors.border,
        }}
      >
        <Feather
          name={file ? "check-circle" : "paperclip"}
          size={18}
          color={file ? colors.primary : colors.mutedForeground}
        />
        <Text
          numberOfLines={1}
          style={[t.callout, { flex: 1, color: file ? colors.foreground : colors.mutedForeground }]}
        >
          {file ? file.name : label}
        </Text>
      </TouchableOpacity>
      {file ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Remove ${file.name}`}
          onPress={() => onPick(null)}
          style={{ minHeight: 44, alignSelf: "flex-start", justifyContent: "center" }}
        >
          <Text style={[t.caption, { color: colors.destructive }]}>Remove selected file</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function HomeworkFileButton({ fileKey, label }: { fileKey: string; label: string }) {
  const colors = useColors();
  const { t, space } = useLayout();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const open = async () => {
    setBusy(true);
    setProblem("");
    const result = await openAttachment(fileKey);
    if (!result.ok) setProblem(result.reason || "Could not open that file.");
    setBusy(false);
  };
  return (
    <View style={{ gap: space.xs }}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy }}
        aria-disabled={busy}
        disabled={busy}
        onPress={() => void open()}
        style={{
          minHeight: 46,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.xs,
          paddingHorizontal: space.sm,
          borderWidth: 1,
          borderRadius: 10,
          borderColor: colors.primary,
        }}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Feather name="download" size={16} color={colors.primary} />
        )}
        <Text style={[t.callout, { color: colors.primary }]}>{label}</Text>
      </TouchableOpacity>
      {problem ? <Text style={[t.caption, { color: colors.destructive }]}>{problem}</Text> : null}
    </View>
  );
}
