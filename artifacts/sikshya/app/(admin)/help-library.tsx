import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPost, apiPut } from "@/utils/api";
import { confirm } from "@/utils/alerts";

type Intent = "billing" | "class_access" | "messaging" | "homework" | "account" | "safety" | "general";
type Article = { id: number; slug: string; title: string; answer: string; intent: Intent; keywords: string[]; status: "draft" | "published" | "archived"; updatedAt: string; starterReview?: { version: string; check: string; sources: string[] } | null };
type Editor = { id: number | null; title: string; answer: string; intent: Intent; keywords: string; slug: string; status: Article["status"] };
const INTENTS: { id: Intent; label: string }[] = [
  { id: "class_access", label: "Classes" }, { id: "billing", label: "Payments" },
  { id: "messaging", label: "Messages" }, { id: "homework", label: "Homework" },
  { id: "account", label: "Account" }, { id: "safety", label: "Safety" }, { id: "general", label: "Other" },
];
const blank = (): Editor => ({ id: null, title: "", answer: "", intent: "general", keywords: "", slug: "", status: "draft" });
const slugFor = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/** Editorial desk: only explicitly published, operator-reviewed answers reach the assistant. */
export default function HelpLibrary() {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [articles, setArticles] = useState<Article[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const wide = width >= 820;

  const load = useCallback(async () => {
    try {
      const result = await apiGet<{ articles: Article[] }>("/admin/support/articles");
      setArticles(result.articles ?? []);
      setLoadError("");
    } catch { setLoadError("Could not load the help library. Try again."); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const importDrafts = async () => {
    if (importing) return;
    setImporting(true); setNotice("");
    try {
      const result = await apiPost<{ created: number }>("/admin/support/articles/starter-drafts", {});
      setNotice(result.created ? `${result.created} starter drafts added. Review each answer before publishing.` : "Starter drafts already exist. Your edits and publication choices were preserved.");
      await load();
    } catch { setNotice("Could not add starter drafts. Please try again; existing answers were not replaced."); }
    finally { setImporting(false); }
  };
  const visibleArticles = articles.filter((article) => `${article.title} ${article.intent} ${article.status}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  const review = articles.find((article) => article.id === editor?.id)?.starterReview;

  const open = (article?: Article) => {
    setError("");
    setEditor(article ? { id: article.id, title: article.title, answer: article.answer,
      intent: article.intent, keywords: article.keywords.join(", "), slug: article.slug, status: article.status } : blank());
  };
  const save = async (status: Article["status"]) => {
    if (!editor || saving) return;
    const title = editor.title.trim();
    const answer = editor.answer.trim();
    const slug = editor.slug || slugFor(title);
    if (!title || !answer || !slug) { setError("Add a clear title and answer before saving."); return; }
    if (status === "published") {
      const approved = await confirm("Publish this answer?", "Fadko Support will use these exact words when answering users. Confirm the information is current and correct.");
      if (!approved) return;
    }
    setSaving(true);
    setError("");
    const payload = { slug, title, answer, intent: editor.intent,
      keywords: editor.keywords.split(",").map((item) => item.trim()).filter(Boolean), locale: "en" };
    try {
      let id = editor.id;
      if (!id) {
        const created = await apiPost<{ article: Article }>("/admin/support/articles", payload);
        id = created.article.id;
        setEditor((current) => current && { ...current, id });
      }
      await apiPut(`/admin/support/articles/${id}`, { ...payload, status });
      setEditor(null);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the answer."); }
    finally { setSaving(false); }
  };

  const fieldStyle = [styles.field, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }];
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={[styles.page, { maxWidth: 1120, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + 110, gap: space.lg }]}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Feather name="arrow-left" size={18} color={colors.primary} />
          <Text style={[t.body, { color: colors.primary }]}>Support desk</Text>
        </Pressable>
        <View style={[styles.hero, { backgroundColor: colors.primary, borderRadius: radius.lg }]}>
          <View style={styles.heroIcon}><Feather name="book-open" size={26} color={colors.primary} /></View>
          <Text style={[t.title1, { color: colors.primaryForeground }]}>Help library</Text>
          <Text style={[t.body, { color: colors.primaryForeground, opacity: 0.87 }]}>Short, reviewed answers for the Fadko assistant. Drafts stay private until you publish them.</Text>
          <Pressable accessibilityRole="button" testID="help-article-new" onPress={() => open()}
            style={[styles.heroButton, { borderRadius: radius.md }]}>
            <Feather name="plus" size={18} color={colors.primary} />
            <Text style={[t.body, { color: colors.primary, fontWeight: "700" }]}>Write an answer</Text>
          </Pressable>
        </View>
        <View style={{ gap: space.sm }}>
          <Pressable accessibilityRole="button" testID="help-starter-import" disabled={importing || loading || !!loadError} onPress={() => void importDrafts()}
            style={[styles.action, { flex: 0, borderColor: colors.border, borderRadius: radius.md, flexDirection: "row", gap: space.sm, padding: space.sm }]}>
            <Feather name="book-open" size={18} color={colors.primary} />
            <Text style={[t.bodyStrong, { color: colors.primary }]}>{importing ? "Adding drafts…" : "Add Fadko starter guides"}</Text>
          </Pressable>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>Source-linked drafts for common questions. Nothing goes live until you review and publish it.</Text>
          {!!notice && <Text accessibilityRole="alert" testID="help-starter-notice" style={[t.callout, { color: colors.foreground }]}>{notice}</Text>}
          <TextInput accessibilityLabel="Search help library" testID="help-library-search" placeholder="Search answers, topics or status" value={query} onChangeText={setQuery}
            placeholderTextColor={colors.mutedForeground} style={fieldStyle} />
        </View>
        <View style={styles.sectionHeading}>
          <View>
            <Text style={[t.title3, { color: colors.foreground }]}>Answers</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>{articles.filter((article) => article.status === "published").length} live · {articles.filter((article) => article.status === "draft").length} drafts</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh help library" onPress={() => void load()}>
            <Feather name="refresh-cw" size={19} color={colors.primary} />
          </Pressable>
        </View>
        {loading ? <ActivityIndicator color={colors.primary} /> : loadError ?
          <Text accessibilityRole="alert" style={[t.body, { color: colors.destructive }]}>{loadError}</Text> : articles.length === 0 ?
          <View style={[styles.empty, { borderColor: colors.border, borderRadius: radius.lg }]}>
            <Feather name="book" size={28} color={colors.mutedForeground} />
            <Text style={[t.title3, { color: colors.foreground }]}>No answers published yet</Text>
            <Text style={[t.body, { color: colors.mutedForeground, textAlign: "center" }]}>The assistant will say when it does not know and offer you a human request. Add verified answers as common questions emerge.</Text>
          </View> :
          <View style={[styles.cards, { flexDirection: wide ? "row" : "column" }]}>
            {!visibleArticles.length && <Text style={[t.body, { color: colors.mutedForeground }]}>No matching answers. Try another search.</Text>}
            {visibleArticles.map((article) => <Pressable key={article.id} accessibilityRole="button" onPress={() => open(article)}
              style={({ pressed }) => [styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, width: wide ? "48.5%" : "100%" }, pressed && { opacity: 0.76 }]}>
              <View style={styles.cardTop}>
                <Text style={[t.caption, { color: article.status === "published" ? colors.success : colors.mutedForeground, fontWeight: "700" }]}>{article.status.toUpperCase()}</Text>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </View>
              <Text style={[t.title3, { color: colors.foreground }]}>{article.title}</Text>
              <Text numberOfLines={2} style={[t.body, { color: colors.mutedForeground }]}>{article.answer}</Text>
            </Pressable>)}
          </View>}
      </ScrollView>

      <Modal visible={!!editor} animationType="slide" transparent onRequestClose={() => setEditor(null)}>
        <View style={[styles.modalBackdrop, { backgroundColor: colors.scrim }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.background, borderRadius: radius.lg, width: Math.min(width - 24, 680), maxHeight: "92%" }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[t.title2, { color: colors.foreground }]}>{editor?.id ? "Edit answer" : "New answer"}</Text>
                <Text style={[t.caption, { color: colors.mutedForeground }]}>Publish only after checking every claim.</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close editor" onPress={() => setEditor(null)}><Feather name="x" size={22} color={colors.foreground} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md }} keyboardShouldPersistTaps="handled">
              {!!review && <View testID="help-starter-review" style={{ padding: space.md, gap: space.sm, backgroundColor: colors.actionSoft, borderRadius: radius.md }}>
                <Text style={[t.bodyStrong, { color: colors.primary }]}>Before publishing</Text>
                <Text style={[t.body, { color: colors.foreground }]}>{review.check}</Text>
                <Text style={[t.caption, { color: colors.mutedForeground }]}>Starter version {review.version}. Verify any changes you make; this checklist is not approval.</Text>
              </View>}
              <Text style={[t.caption, { color: colors.foreground, fontWeight: "700" }]}>Question or title</Text>
              <TextInput testID="help-article-title" value={editor?.title ?? ""} onChangeText={(title) => setEditor((current) => current && { ...current, title })}
                placeholder="How do I join my class?" placeholderTextColor={colors.mutedForeground} style={fieldStyle} maxLength={140} />
              <Text style={[t.caption, { color: colors.foreground, fontWeight: "700" }]}>Topic</Text>
              <View style={styles.chips}>{INTENTS.map((intent) => <Pressable key={intent.id} onPress={() => setEditor((current) => current && { ...current, intent: intent.id })}
                style={[styles.chip, { borderColor: editor?.intent === intent.id ? colors.primary : colors.border, backgroundColor: editor?.intent === intent.id ? colors.actionSoft : colors.card, borderRadius: radius.pill }]}>
                <Text style={[t.caption, { color: editor?.intent === intent.id ? colors.primary : colors.foreground }]}>{intent.label}</Text>
              </Pressable>)}</View>
              <Text style={[t.caption, { color: colors.foreground, fontWeight: "700" }]}>Answer users will see</Text>
              <TextInput testID="help-article-answer" value={editor?.answer ?? ""} onChangeText={(answer) => setEditor((current) => current && { ...current, answer })}
                placeholder="Use short steps and name the exact Fadko screen…" placeholderTextColor={colors.mutedForeground}
                multiline textAlignVertical="top" style={[fieldStyle, { minHeight: 150 }]} maxLength={3000} />
              <Text style={[t.caption, { color: colors.foreground, fontWeight: "700" }]}>Search words, separated by commas</Text>
              <TextInput testID="help-article-keywords" value={editor?.keywords ?? ""} onChangeText={(keywords) => setEditor((current) => current && { ...current, keywords })}
                placeholder="join, class, lesson" placeholderTextColor={colors.mutedForeground} style={fieldStyle} />
              {!!error && <Text accessibilityRole="alert" style={[t.caption, { color: colors.destructive }]}>{error}</Text>}
              <View style={styles.actions}>
                <Pressable disabled={saving} accessibilityRole="button" onPress={() => void save("draft")}
                  style={[styles.action, { borderColor: colors.primary, borderRadius: radius.md }]}><Text style={[t.body, { color: colors.primary, fontWeight: "700" }]}>Save draft</Text></Pressable>
                <Pressable disabled={saving} accessibilityRole="button" testID="help-article-publish" onPress={() => void save("published")}
                  style={[styles.action, { borderColor: colors.primary, backgroundColor: colors.primary, borderRadius: radius.md }]}>
                  <Text style={[t.body, { color: colors.primaryForeground, fontWeight: "700" }]}>{saving ? "Saving…" : "Publish answer"}</Text>
                </Pressable>
              </View>
              {editor?.id && editor.status === "published" && <Pressable disabled={saving} onPress={() => void save("archived")} style={{ alignSelf: "center", padding: space.sm }}>
                <Text style={[t.caption, { color: colors.destructive }]}>Remove from assistant answers</Text>
              </Pressable>}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: "100%", alignSelf: "center", paddingHorizontal: 20 },
  back: { minHeight: 44, flexDirection: "row", gap: 8, alignItems: "center" },
  hero: { padding: 26, gap: 10 },
  heroIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: "white", alignItems: "center", justifyContent: "center" },
  heroButton: { marginTop: 12, minHeight: 48, paddingHorizontal: 18, backgroundColor: "white", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, alignSelf: "flex-start" },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cards: { flexWrap: "wrap", gap: 14, justifyContent: "space-between" },
  card: { borderWidth: 1, padding: 18, gap: 8 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  empty: { borderWidth: 1, alignItems: "center", gap: 8, padding: 32 },
  modalBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 12 },
  modalCard: { overflow: "hidden" },
  modalHeader: { padding: 18, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 16 },
  field: { borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, minHeight: 40, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1, minHeight: 48, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
});
