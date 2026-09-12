import {
  Linking,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ClassGroupShell } from "@/components/classes/ClassGroupShell";
import {
  ProgramButton,
  ProgramNotice,
} from "@/components/programs/ProgramPieces";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPost } from "@/utils/api";
interface Material {
  id: number;
  title: string;
  note: string | null;
  url: string | null;
}
interface MaterialView {
  title: string;
  isTeacher: boolean;
  materials: Material[];
}
export default function ClassMaterialsScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const batchId = Number(id);
  const colors = useColors();
  const { t, space } = useLayout();
  const [view, setView] = useState<MaterialView | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const load = useCallback(async () => {
    try {
      setView(await apiGet<MaterialView>(`/class-groups/${batchId}/materials`));
      setProblem("");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load materials.");
    }
  }, [batchId]);
  useEffect(() => {
    void load();
  }, [load]);
  const add = async () => {
    setBusy(true);
    try {
      await apiPost(`/class-groups/${batchId}/materials`, { title, note, url });
      setTitle("");
      setNote("");
      setUrl("");
      await load();
    } catch (e) {
      setProblem(
        e instanceof Error ? e.message : "Could not add that material.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ClassGroupShell
      title="Class materials"
      eyebrow={view?.title ?? "Your class"}
    >
      {!view && !problem ? <ActivityIndicator color={colors.primary} /> : null}
      {problem ? (
        <ProgramNotice
          tone="stopped"
          title="Materials unavailable"
          body={problem}
        />
      ) : null}
      {view?.isTeacher ? (
        <View
          style={{
            gap: space.sm,
            padding: space.md,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Text style={[t.title3, { color: colors.foreground }]}>
            Share a material
          </Text>
          <TextInput
            accessibilityLabel="Material title"
            value={title}
            onChangeText={setTitle}
            placeholder="Example: Chapter 3 notes"
            placeholderTextColor={colors.mutedForeground}
            style={[
              t.body,
              {
                minHeight: 48,
                padding: space.sm,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                color: colors.foreground,
              },
            ]}
          />
          <TextInput
            accessibilityLabel="Material note"
            value={note}
            onChangeText={setNote}
            placeholder="A short explanation (optional)"
            placeholderTextColor={colors.mutedForeground}
            style={[
              t.body,
              {
                minHeight: 48,
                padding: space.sm,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                color: colors.foreground,
              },
            ]}
          />
          <TextInput
            accessibilityLabel="Material link"
            autoCapitalize="none"
            value={url}
            onChangeText={setUrl}
            placeholder="https://… (optional)"
            placeholderTextColor={colors.mutedForeground}
            style={[
              t.body,
              {
                minHeight: 48,
                padding: space.sm,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                color: colors.foreground,
              },
            ]}
          />
          <ProgramButton
            label={busy ? "Adding…" : "Add material"}
            emphasis="primary"
            disabled={busy || !title.trim()}
            onPress={() => void add()}
          />
        </View>
      ) : null}
      {view?.materials.length === 0 ? (
        <ProgramNotice
          title="Nothing shared yet"
          body={
            view.isTeacher
              ? "Add a note or trusted link students will need."
              : "Your teacher has not shared any class materials."
          }
        />
      ) : null}
      <View style={{ gap: space.md }}>
        {view?.materials.map((material) => (
          <View
            key={material.id}
            style={{
              gap: space.sm,
              padding: space.md,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <Text style={[t.title3, { color: colors.foreground }]}>
              {material.title}
            </Text>
            {material.note ? (
              <Text style={[t.body, { color: colors.foreground }]}>
                {material.note}
              </Text>
            ) : null}
            {material.url ? (
              <ProgramButton
                label="Open link"
                emphasis="secondary"
                onPress={() => void Linking.openURL(material.url!)}
              />
            ) : null}
          </View>
        ))}
      </View>
    </ClassGroupShell>
  );
}
