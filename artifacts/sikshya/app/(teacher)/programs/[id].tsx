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
  /** The render-side copy of `opRef`. It decides what is drawn; `opRef` decides what may run. */
  const [operation, setOperation] = useState<null | { kind: "save" } | { kind: "action"; action: ProgramAction }>(null);

  /** The newest draft, readable from inside a promise that started before it was typed. */
  const draftRef = useRef<ProgramDraft | null>(null);
  /** The last draft the server accepted, readable synchronously for the same reason. */
  const acceptedRef = useRef<ProgramDraft | null>(null);
  /**
   * The one operation this screen is allowed to have in flight, or `null`.
   *
   * A ref rather than state, and set **before** anything is awaited, because a React state update
   * does not land until the next render — and two presses a few milliseconds apart both happen
   * before that. Every dispatch below reads this first. The state copy underneath drives the
   * drawing only.
   */
  const opRef = useRef<null | { kind: "save" } | { kind: "action"; action: ProgramAction }>(null);
  /** Set when Save is pressed during a save. The in-flight one runs it again when it returns. */
  const queuedRef = useRef(false);
  /** True while the last save failed, so a dispatch can see it without a render. */
  const failedRef = useRef(false);

  const atRisk = wouldLoseWork(saveState);

  /**
   * Whether the server's copy is behind this screen — asked **now**, not at the last render.
   *
   * `wouldLoseWork(saveState)` is a render value, and by the time a press reaches a callback it can
   * be a frame out of date. This reads the refs instead: a save in flight or queued, a failed save,
   * or a draft that differs from the last one the server accepted. Codex asked for exactly this at
   * the dispatch boundary, and the reason is the frame in between.
   */
  const atRiskNow = useCallback(() => {
    if (failedRef.current) return true;
    if (opRef.current?.kind === "save" || queuedRef.current) return true;
    const local = draftRef.current;
    const server = acceptedRef.current;
    return local !== null && server !== null && draftDiffers(local, server);
  }, []);

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
    acceptedRef.current = detail.draft;
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
    /*
      Recorded even while a lifecycle action has the editor locked.

      The lock is drawn on the next render, and a keystroke can land in the frame before it does.
      Dropping it would be the silent loss this whole screen exists to prevent, so it is kept and
      counted as unsaved; `act` below then leaves it alone when its answer comes back.
    */
    draftRef.current = next;
    setDraft(next);
    setSaveState((current) => {
      // A failed save stays failed until another save is attempted; overwriting it with "unsaved"
      // would quietly remove the one message telling a teacher their work is not on the server.
      if (current === "failed") return "failed";
      return "unsaved";
    });
  }, []);

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

  /*
    The browser's own ways of leaving. Web only; the file beside the hook is a real no-op.

    `dirty` arms the reload/close dialog and stays on while the question is open — a teacher who
    reloads instead of answering must still be asked. `armHistory` goes off while the question is
    open, so the Back guard does not re-arm underneath the answer they are about to give.
  */
  useBrowserLeaveGuard({
    dirty: atRisk && departure === null,
    armHistory: guarded,
    questionOpen: leaveAsk !== null,
    departing: departure !== null,
    onHistoryBack: useCallback(
      (goBack: () => void) => setLeaveAsk(() => () => depart(goBack)),
      [depart],
    ),
  });

  // Anything React Navigation drives, on either platform: a tab, the Android hardware button, a
  // parent screen popping this one.
  usePreventRemove(guarded, ({ data }) => {
    setLeaveAsk(() => () => depart(() => navigation.dispatch(data.action)));
  });

  const save = useCallback(async () => {
    if (!id) return;
    /*
      One operation at a time, decided synchronously.

      If a save is already out this press is remembered and runs on the way out of the loop below,
      so the server never has two writes for this program in flight. If a *lifecycle* action is out,
      this does nothing at all: the studio has the editor and Save locked while one runs, and a
      PATCH crossing a publish is two writes racing for the same row lock, where whichever wins
      decides what students were given.
    */
    if (opRef.current) {
      if (opRef.current.kind === "save") queuedRef.current = true;
      return;
    }
    opRef.current = { kind: "save" };
    setOperation({ kind: "save" });
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
          acceptedRef.current = answer.program.draft;
          failedRef.current = false;
          const newest = draftRef.current ?? sending;
          setSaveState(draftDiffers(newest, answer.program.draft) ? "unsaved" : "saved");
        } catch (err) {
          failedRef.current = true;
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
      opRef.current = null;
      queuedRef.current = false;
      setOperation(null);
    }
  }, [id]);

  const act = useCallback(async (action: ProgramAction) => {
    if (!id) return;
    /*
      Three refusals, all decided before anything is awaited.

      1. Something is already running. Two lifecycle presses a few milliseconds apart both arrive
         before React can draw either button as busy, and both would reach the server; a publish and
         an archive racing for the same row lock is a program whose final state depends on which
         packet won. One at a time, and the ref is what says so — `busyAction` is a render value and
         is a frame behind.
      2. The server's copy is behind this screen. `ProgramStudio` does not draw these buttons then,
         so this should be unreachable, which is why it is here: a lifecycle request acts on the
         *saved* text and its answer becomes the editor's baseline, so dispatching one over unsaved
         work publishes the wrong words and then overwrites the right ones. Asked of the refs rather
         than of `saveState`, for the same frame.
      3. Delete is deliberately outside the second rule: discarding the work is what it is for, and
         the confirmation says so in as many words. It is still inside the first.
    */
    if (opRef.current) return;
    if (action !== "delete" && atRiskNow()) return;

    opRef.current = { kind: "action", action };
    setOperation({ kind: "action", action });

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
      /*
        An empty body, which is the whole reason typing cannot join a publication by accident.

        The server publishes the draft it already holds. Nothing typed after this press is sent, and
        the branch below then leaves it on screen as unsaved rather than folding it into what was
        just published.
      */
      const answer = await apiPost<{ program: ProgramDetail }>(`/learning-programs/${id}/${action}`, {});
      setProgram(answer.program);
      setAccepted(answer.program.draft);
      acceptedRef.current = answer.program.draft;
      if (draftRef.current === before) {
        // Nobody typed while it was in flight, so the server's copy and the screen agree.
        setDraft(answer.program.draft);
        draftRef.current = answer.program.draft;
        setSaveState("clean");
      } else {
        // Something was typed after this action began — in the frame before the editor locked. It
        // stays, and it is unsaved: a successful publish must not swallow a sentence written a
        // moment after it was pressed, and must not claim to have published it either.
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
      opRef.current = null;
      setOperation(null);
      setBusyAction(null);
    }
  }, [id, atRiskNow, depart]);

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
        onPlanBatches={() => router.push(`/(teacher)/program-batches/${id}`)}
        template={template}
        /*
          Locked while a lifecycle action is out, and only then.

          Publish, take down, archive and restore act on the saved copy and replace the editor's
          baseline when they answer. Leaving the fields live through that invites a teacher to write
          into a draft that is about to be overwritten by a server response about a different one.
          A save does *not* lock the editor: typing through a slow save is the ordinary case this
          screen was built to survive.
        */
        editingLocked={operation?.kind === "action"}
        leaveAsk={leaveAsk}
        onLeaveCancel={() => setLeaveAsk(null)}
      />
    </SafeAreaView>
  );
}
