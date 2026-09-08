import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ProgramStudio from "@/components/programs/ProgramStudio";
import { ProgramFailure } from "@/components/programs/ProgramPieces";
import { useAuth } from "@/context/AuthContext";
import { space } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/utils/api";
import {
  draftDiffers,
  saveBody,
  type ProgramAction,
  type ProgramDetail,
  type ProgramDraft,
  type SaveState,
} from "@/utils/learningProgramUi";

interface Template {
  type: string;
  promisePrompt?: string;
  learnerPrompt?: string;
  referencePrompt?: string | null;
}

/**
 * One program, open for editing.
 *
 * ## The draft is held here and nowhere else
 *
 * `ProgramStudio` is given the working copy and a way to change it, and this screen owns it. That
 * matters for the rule the brief states plainly: **never lose typed work silently.** A component
 * that re-derived its own value from the last server response would drop a keystroke every time a
 * save came back, and on a slow connection that is the sentence a teacher was in the middle of.
 *
 * ## Save state is what the server said, and nothing else
 *
 * `unsaved` the moment the draft differs from what was last accepted, `saving` while the request is
 * in flight, and `saved` **only** when the API answers. A failure says so and keeps the work on
 * screen. Nothing here optimistically calls a save done.
 */
export default function ProgramStudioScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === "string" ? params.id : "";

  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [draft, setDraft] = useState<ProgramDraft | null>(null);
  /** The last draft the server accepted. Everything about "unsaved" is measured against this. */
  const [accepted, setAccepted] = useState<ProgramDraft | null>(null);
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<ProgramAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * Whether this teacher's account has been approved.
   *
   * Read from the profile the app already holds rather than asked for again. It decides only which
   * *explanation* the studio shows; the server checks approval itself at publication, so a stale or
   * missing value here can make the screen optimistic but can never make a publication happen.
   */
  const approved = user?.role === "teacher" && user.approvalStatus === "approved";

  const apply = useCallback((detail: ProgramDetail) => {
    setProgram(detail);
    setAccepted(detail.draft);
    setDraft(detail.draft);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setFailure(null);
    try {
      const [detail, templates] = await Promise.all([
        apiGet<{ program: ProgramDetail }>(`/learning-programs/${id}`),
        apiGet<{ templates: Template[] }>("/learning-programs/templates").catch(() => ({ templates: [] })),
      ]);
      apply(detail.program);
      setTemplate(templates.templates.find((entry) => entry.type === detail.program.draft.type) ?? null);
      setSaveState("clean");
    } catch (err) {
      setFailure(
        err instanceof ApiError
          ? err.message
          : "Fadko could not reach the server. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [id, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDraftChange = useCallback((next: ProgramDraft) => {
    setDraft(next);
    setSaveState((current) => {
      // A failed save stays failed until another save is attempted; overwriting it with "unsaved"
      // would quietly remove the one message telling a teacher their work is not on the server.
      if (current === "failed") return "failed";
      return "unsaved";
    });
  }, []);

  const save = useCallback(async () => {
    if (!draft || !id) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const answer = await apiPatch<{ program: ProgramDetail }>(`/learning-programs/${id}`, saveBody(draft));
      /*
        Keep what the teacher has typed since this request left.

        The server's answer is authoritative about *its* copy, and `program`/`accepted` take it. The
        editor keeps the local draft, because replacing it would delete anything typed while the
        request was in flight — which on a Nepali connection is a whole sentence.
      */
      setProgram(answer.program);
      setAccepted(answer.program.draft);
      setSaveState(draftDiffers(draft, answer.program.draft) ? "unsaved" : "saved");
    } catch (err) {
      setSaveState("failed");
      // Only what went wrong. The studio adds the reassurance that the work is still on screen,
      // so saying it here too would print it twice.
      setSaveError(err instanceof ApiError ? err.message : "Fadko could not reach the server.");
    }
  }, [draft, id]);

  const act = useCallback(async (action: ProgramAction) => {
    if (!id) return;
    setBusyAction(action);
    setActionError(null);
    try {
      if (action === "delete") {
        await apiDelete(`/learning-programs/${id}`);
        router.replace("/(teacher)/programs");
        return;
      }
      const answer = await apiPost<{ program: ProgramDetail }>(`/learning-programs/${id}/${action}`, {});
      apply(answer.program);
      setSaveState("clean");
    } catch (err) {
      /*
        The server's own sentence, verbatim.

        A conflict here is a real one — the program moved while this screen was looking at it — and
        the server names which state it expected. Rewording that would send a teacher looking for
        the wrong thing.
      */
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Fadko could not reach the server. Nothing was changed.",
      );
    } finally {
      setBusyAction(null);
    }
  }, [id, apply]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View testID="program-studio-loading" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (failure || !program || !draft || !accepted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View style={{ flex: 1, justifyContent: "center", padding: space.md }}>
          <ProgramFailure
            testID="program-studio-failure"
            message={failure ?? "That program could not be opened."}
            onRetry={() => void load()}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ProgramStudio
        program={program}
        draft={draft}
        onDraftChange={onDraftChange}
        saveState={saveState}
        saveError={saveError}
        onSave={() => void save()}
        approved={approved}
        onAction={(action) => void act(action)}
        busyAction={busyAction}
        actionError={actionError}
        onBack={() => router.replace("/(teacher)/programs")}
        template={template}
      />
    </SafeAreaView>
  );
}
