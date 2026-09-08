import { usePreventRemove } from "@react-navigation/native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ProgramStudio from "@/components/programs/ProgramStudio";
import { ProgramFailure } from "@/components/programs/ProgramPieces";
import { useAuth } from "@/context/AuthContext";
import { space } from "@/constants/layout";
import { useBrowserLeaveGuard } from "@/hooks/useLeaveGuard";
import { useColors } from "@/hooks/useColors";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/utils/api";
import {
  draftDiffers,
  saveBody,
  wouldLoseWork,
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
 * It is held twice: in state, which draws the screen, and in `draftRef`, which is always the newest
 * value. Every asynchronous answer — a save, a publish, an archive — is judged against the ref
 * rather than against whatever was on screen when the request left. Three of the four ways this
 * screen could lose work came from comparing against the older value.
 *
 * ## One save at a time
 *
 * Saves are **serialized**: a request while one is in flight sets `queuedRef` and runs when the
 * first returns, so two responses can never arrive out of order. That is the smallest mechanism
 * that makes the ordering question go away, rather than tagging requests and hoping the comparison
 * is right at every branch.
 *
 * ## Nothing dangerous runs while work is at risk
 *
 * Publish, take down, archive and restore all act on the server's copy, and their answers replace
 * the editor's baseline. While anything is unsaved, saving or failed, they are not offered and this
 * screen will not dispatch them even if asked. Delete is the exception, because discarding is the
 * point — but its confirmation says the work on screen goes too.
 */
export default function ProgramStudioScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const navigation = useNavigation();
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

  /** The newest draft, readable from inside a promise that started before it was typed. */
  const draftRef = useRef<ProgramDraft | null>(null);
  /** True while a PATCH is out. Nothing else may start one. */
  const savingRef = useRef(false);
  /** Set when Save is pressed during a save. The in-flight one runs it again when it returns. */
  const queuedRef = useRef(false);

  const atRisk = wouldLoseWork(saveState);

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
    draftRef.current = detail.draft;
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
    draftRef.current = next;
    setDraft(next);
    setSaveState((current) => {
      // A failed save stays failed until another save is attempted; overwriting it with "unsaved"
      // would quietly remove the one message telling a teacher their work is not on the server.
      if (current === "failed") return "failed";
      return "unsaved";
    });
  }, []);

  const save = useCallback(async () => {
    if (!id) return;
    if (savingRef.current) {
      // One at a time. This press is remembered and runs on the way out of the loop below, so the
      // server never has two writes for this program in flight and no answer can arrive stale.
      queuedRef.current = true;
      return;
    }
    savingRef.current = true;
    try {
      do {
        queuedRef.current = false;
        const sending = draftRef.current;
        if (!sending) break;
        setSaveState("saving");
        setSaveError(null);
        try {
          const answer = await apiPatch<{ program: ProgramDetail }>(
            `/learning-programs/${id}`,
            saveBody(sending),
          );
          /*
            The server's answer is authoritative about *its* copy, so `program` and `accepted` take
            it — including the validation issues, which now describe what was just written.

            The editor keeps whatever is on screen. Replacing it would delete anything typed while
            the request was in flight, which on a Nepali connection is a whole sentence. And the
            save state is decided by comparing the answer with `draftRef.current` — the newest text
            — not with `sending`. Comparing with `sending` is the bug Codex found: type during a
            slow PATCH and the old response would come back and write "Saved" over work the server
            has never seen.
          */
          setProgram(answer.program);
          setAccepted(answer.program.draft);
          const newest = draftRef.current ?? sending;
          setSaveState(draftDiffers(newest, answer.program.draft) ? "unsaved" : "saved");
        } catch (err) {
          setSaveState("failed");
          // Only what went wrong. The studio adds the reassurance that the work is still on screen,
          // so saying it here too would print it twice.
          setSaveError(err instanceof ApiError ? err.message : "Fadko could not reach the server.");
          // Do not run a queued save on top of a failure: it would replace the message explaining
          // why the work is not on the server with a second copy of the same failure.
          break;
        }
      } while (queuedRef.current);
    } finally {
      savingRef.current = false;
      queuedRef.current = false;
    }
  }, [id]);

  const act = useCallback(async (action: ProgramAction) => {
    if (!id) return;
    /*
      The second door on the same rule.

      `ProgramStudio` does not draw these buttons while work is at risk, so this should be
      unreachable — which is exactly why it is here. A lifecycle request publishes or files away the
      server's copy, and its answer becomes the editor's new baseline; dispatching one over unsaved
      text publishes the wrong thing and then overwrites the right thing.

      Delete is deliberately outside the guard: discarding the work is what it is for, and the
      confirmation says so in as many words.
    */
    if (action !== "delete" && wouldLoseWork(saveState)) return;

    const before = draftRef.current;
    setBusyAction(action);
    setActionError(null);
    try {
      if (action === "delete") {
        await apiDelete(`/learning-programs/${id}`);
        // Through `depart` rather than straight to `router.replace`, so the guard is switched off
        // before the navigation happens. Otherwise a teacher who deleted a draft with unsaved text
        // would be asked whether they want to lose work belonging to a program that is now gone.
        depart(() => router.replace("/(teacher)/programs"));
        return;
      }
      const answer = await apiPost<{ program: ProgramDetail }>(`/learning-programs/${id}/${action}`, {});
      setProgram(answer.program);
      setAccepted(answer.program.draft);
      if (draftRef.current === before) {
        // Nobody typed while it was in flight, so the server's copy and the screen agree.
        setDraft(answer.program.draft);
        draftRef.current = answer.program.draft;
        setSaveState("clean");
      } else {
        // Something was typed after this action began. It stays, and it is unsaved — a successful
        // publish must not swallow a sentence written a second after it was pressed.
        setSaveState(draftDiffers(draftRef.current!, answer.program.draft) ? "unsaved" : "clean");
      }
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
  }, [id, saveState]);

  /* ------------------------------------------------------------------ leaving */

  /** Set while the "you have unsaved work" sheet is open, holding what to do if they go anyway. */
  const [leaveAsk, setLeaveAsk] = useState<null | (() => void)>(null);
  /**
   * An agreed departure, held for one render before it happens.
   *
   * Every guard below is switched off by this being set, and the effect underneath performs the
   * navigation on the *next* render — so the guard is already down when the route changes. Doing it
   * in one step, with a ref, does not work: a ref does not re-render, so `usePreventRemove` would
   * still be armed and would catch the very departure that had just been agreed to. The case that
   * makes it obvious is deleting a draft with unsaved text — the program is gone, and asking
   * whether to keep working on it is nonsense.
   */
  const [departure, setDeparture] = useState<null | (() => void)>(null);
  const depart = useCallback((go: () => void) => {
    setLeaveAsk(null);
    setDeparture(() => go);
  }, []);
  useEffect(() => {
    if (departure) departure();
  }, [departure]);

  const guarded = atRisk && departure === null;

  // Reload, closing the tab, the address bar. Web only; the file beside the hook is a no-op.
  useBrowserLeaveGuard(guarded);

  // Anything React Navigation drives, on either platform: a tab, the Android hardware button, a
  // parent screen popping this one.
  usePreventRemove(guarded, ({ data }) => {
    setLeaveAsk(() => () => depart(() => navigation.dispatch(data.action)));
  });

  /** The studio's own "‹ Programs". It is a plain link, so nothing else would intercept it. */
  const back = useCallback(() => {
    const go = () => router.replace("/(teacher)/programs");
    if (guarded) {
      setLeaveAsk(() => () => depart(go));
      return;
    }
    depart(go);
  }, [guarded, depart]);

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
        onBack={back}
        template={template}
        leaveAsk={leaveAsk}
        onLeaveCancel={() => setLeaveAsk(null)}
      />
    </SafeAreaView>
  );
}
