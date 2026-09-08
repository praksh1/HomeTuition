import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import type {
  FloorActions,
  FloorRefusal,
  FloorRow,
  FloorView,
  StudentFloorView,
  TeacherFloorView,
} from "@/hooks/useClassroomSocket";
import {
  discussionControl,
  floorSummary,
  mediaChip,
  providerNote,
  studentOffer,
  teacherRowButtons,
  type FloorIntent,
  type TeacherIntent,
} from "@/utils/classroomFloorUi";
import { FloorButton, FloorChipView, FloorCount, floorStyles, initialsOf } from "./floor/FloorPieces";

/**
 * The classroom floor, on screen.
 *
 * One component for both roles, because they are two views of one thing and splitting them would
 * mean two places that have to agree about what "speaking" looks like. The switch is on
 * `floor.scope`, which the *server* sets — a student's payload has no way to express another
 * student, so a client bug cannot turn a student's screen into a teacher's.
 *
 * ## It draws what the server said, and never what it hopes
 *
 * Nothing here is optimistic. Press "Ask to speak" and the button does not change; the server
 * answers with a new `floor_state` and the screen follows. That is slower and it is correct: a
 * screen that showed "you may speak" before the SFU agreed would be a screen that lies to a child
 * who then presses unmute and is refused by LiveKit with no explanation.
 *
 * ## Where it sits
 *
 * A strip along the bottom of the classroom for a student, and a strip plus a sheet for a teacher.
 * Deliberately not a modal over the video: this app already has a complaint about overlays on a
 * phone that are hard to get out of, and the one thing a person must never lose sight of during a
 * lesson is the board.
 */

interface Props {
  /** Null before the first state arrives, and after the class ends. Nothing is drawn then. */
  floor: FloorView | null;
  refusal: FloorRefusal | null;
  onDismissRefusal: () => void;
  actions: FloorActions;
  /**
   * When the Monthly discussion may be opened, from the room payload.
   *
   * The server computed it. Null for a class that does not carry the benefit, in which case the
   * control is not drawn at all rather than drawn and disabled forever.
   */
  discussionOpensAt?: number | null;
  /**
   * True when the provider carrying this class can actually decide who publishes.
   *
   * From `capabilities.moderatesPublishing` in the room payload. False on Daily, where everybody
   * can unmute themselves anyway — so asking permission would be asking for something the student
   * already has, and the whole strip is hidden. The server refuses the actions independently.
   */
  canModerate?: boolean;
}

export default function ClassroomFloor({
  floor,
  refusal,
  onDismissRefusal,
  actions,
  discussionOpensAt = null,
  canModerate = true,
}: Props) {
  if (!floor || !canModerate) return null;
  return floor.scope === "teacher" ? (
    <TeacherFloor
      floor={floor}
      refusal={refusal}
      onDismissRefusal={onDismissRefusal}
      actions={actions}
      discussionOpensAt={discussionOpensAt}
    />
  ) : (
    <StudentFloor
      floor={floor}
      refusal={refusal}
      onDismissRefusal={onDismissRefusal}
      actions={actions}
    />
  );
}

/* ========================================================================== *
 * What the server said no to                                                  *
 * ========================================================================== */

/**
 * A refusal, shown to the one person who asked.
 *
 * Every refusal from the server carries its own sentence — "Discussion is part of the monthly
 * plan", "Another student has the camera" — and it is shown verbatim rather than mapped to a
 * generic apology. `refusals-must-name-their-reason.md`: a person told "that didn't work" tries
 * the same thing again, and a person told why does something else.
 *
 * Dismisses itself, because the common case is a refusal the person has already understood and a
 * banner that has to be closed is one more thing between them and the lesson.
 */
function Refusal({ refusal, onDismiss }: { refusal: FloorRefusal | null; onDismiss: () => void }) {
  const colors = useColors();
  const { t, space, radius } = useLayout();

  useEffect(() => {
    if (!refusal) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [refusal, onDismiss]);

  if (!refusal) return null;
  return (
    <View
      testID="floor-refusal"
      accessibilityRole="alert"
      style={[
        floorStyles.row,
        {
          gap: space.xs,
          paddingVertical: space.xs,
          paddingHorizontal: space.sm,
          borderRadius: radius.sm,
          backgroundColor: colors.warnSoft,
        },
      ]}
    >
      <Feather name="alert-circle" size={16} color={colors.warn} />
      <Text style={[t.caption, floorStyles.grow, { color: colors.warn }]}>{refusal.reason}</Text>
      <Pressable
        testID="floor-refusal-dismiss"
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Hide this message"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Feather name="x" size={16} color={colors.warn} />
      </Pressable>
    </View>
  );
}

/* ========================================================================== *
 * A student                                                                   *
 * ========================================================================== */

function StudentFloor({
  floor,
  refusal,
  onDismissRefusal,
  actions,
}: {
  floor: StudentFloorView;
  refusal: FloorRefusal | null;
  onDismissRefusal: () => void;
  actions: FloorActions;
}) {
  const colors = useColors();
  const { t, space, radius, isCompact } = useLayout();
  const offer = useMemo(() => studentOffer(floor), [floor]);
  const chip = mediaChip(floor.you.state, true);
  /*
    Only for the one case `studentOffer` deliberately leaves alone.

    A student who is already speaking keeps their ordinary offer — taking "Stop speaking" away from
    somebody mid-sentence because a *later* change is still going through would be worse than the
    problem — so without this their screen would say "You're speaking" and nothing else while the
    provider had not caught up. Every other state has the offer itself say it, in sentences that
    know which direction the outstanding change points. Drawing the chip there as well put "could
    not switch this on" underneath a heading warning that a microphone might still be live.
  */
  const speakingNow = floor.you.state === "speaking" || floor.you.state === "camera-active";
  const note = speakingNow ? providerNote(floor.you.provider, true) : null;

  const run = useCallback(
    (intent: FloorIntent) => {
      switch (intent.do) {
        case "ask": return actions.ask();
        case "cancelAsk": return actions.cancelAsk();
        case "accept": return actions.accept(intent.scope);
        case "setCamera": return actions.setCamera(intent.on);
        case "decline": return actions.decline();
        case "listenOnly": return actions.listenOnly();
        case "joinDiscussion": return actions.joinDiscussion(intent.scope);
        case "leaveDiscussion": return actions.leaveDiscussion();
      }
    },
    [actions],
  );

  return (
    <View
      testID="student-floor"
      style={{
        gap: space.xs,
        padding: space.sm,
        borderRadius: radius.md,
        backgroundColor: colors.card,
        borderWidth: 1,
        /*
          An invitation gets a border that changes, not a colour that shouts.

          The moment a teacher asks a child a question in front of forty people is not the moment
          for an alarm. `warn` is the attention colour in this palette; crimson is identity and
          destructive is rust, and neither is what "your teacher is speaking to you" means.
        */
        borderColor: offer.urgent ? colors.warn : colors.border,
      }}
    >
      <Refusal refusal={refusal} onDismiss={onDismissRefusal} />

      {offer.title ? (
        <View style={{ gap: space.xxs }}>
          <Text testID="student-floor-title" style={[t.bodyStrong, { color: colors.foreground }]}>
            {offer.title}
          </Text>
          {offer.body ? (
            <Text testID="student-floor-body" style={[t.caption, { color: colors.mutedForeground }]}>
              {offer.body}
            </Text>
          ) : null}
        </View>
      ) : (
        /*
          Nothing has happened, so nothing is announced — but the state is still shown.

          A student who muted themselves and a student who never asked look identical without it,
          and the first spends the lesson wondering why nobody can hear them.
        */
        <FloorChipView testID="student-floor-state" label={chip.label} tone={chip.tone} />
      )}

      {note ? (
        <FloorChipView testID="student-floor-provider" label={note.label} tone={note.tone} />
      ) : null}

      <View
        style={[
          isCompact ? floorStyles.rowWrap : floorStyles.row,
          { gap: space.xs },
        ]}
      >
        {offer.buttons.map((button) => (
          <FloorButton
            key={button.id}
            testID={`student-floor-${button.id}`}
            label={button.label}
            spoken={button.spoken}
            emphasis={button.emphasis}
            grow={isCompact}
            onPress={() => run(button.intent)}
          />
        ))}
      </View>

      {/* A count with no names, so a student knows the queue is real without seeing classmates. */}
      {floor.handsUp > 0 && floor.you.state !== "requested" ? (
        <Text testID="student-floor-hands" style={[t.caption, { color: colors.mutedForeground }]}>
          {floor.handsUp === 1 ? "1 hand is up." : `${floor.handsUp} hands are up.`}
        </Text>
      ) : null}
    </View>
  );
}

/* ========================================================================== *
 * The teacher                                                                 *
 * ========================================================================== */

function TeacherFloor({
  floor,
  refusal,
  onDismissRefusal,
  actions,
  discussionOpensAt,
}: {
  floor: TeacherFloorView;
  refusal: FloorRefusal | null;
  onDismissRefusal: () => void;
  actions: FloorActions;
  discussionOpensAt: number | null;
}) {
  const colors = useColors();
  const { t, space, radius, isCompact } = useLayout();
  const [sheetOpen, setSheetOpen] = useState(false);
  /*
    A clock that ticks only while it is being read.

    The discussion control counts down to the minute, so it needs re-rendering; a timer that runs
    for the whole lesson to update a control nobody is looking at is a timer on a phone's battery.
    Thirty seconds is enough for a to-the-minute countdown to never be more than a minute stale.
  */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!floor.discussionEligible) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [floor.discussionEligible]);

  const summary = useMemo(() => floorSummary(floor), [floor]);
  const discussion = discussionControl(floor, discussionOpensAt, now);

  /*
    Waiting hands first, then everybody else in a stable order.

    The queue's order is the server's, taken from its own clock, so a student on a slow connection
    does not lose their place. Everyone else is sorted by account id rather than by state: a list
    that re-sorts itself every time somebody mutes is a list a teacher cannot tap accurately.
  */
  const rows = useMemo(() => {
    const byId = new Map(floor.students.map((r) => [r.userId, r]));
    const queued = floor.queue.map((id) => byId.get(id)).filter((r): r is FloorRow => Boolean(r));
    const queuedIds = new Set(queued.map((r) => r.userId));
    const rest = floor.students
      .filter((r) => !queuedIds.has(r.userId))
      .sort((a, b) => a.userId - b.userId);
    return [...queued, ...rest];
  }, [floor.students, floor.queue]);

  const runRow = useCallback(
    (row: FloorRow, intent: TeacherIntent) => {
      switch (intent.do) {
        case "allow": return actions.allow(row.userId, intent.scope, intent.replace);
        case "dismiss": return actions.dismiss(row.userId);
        case "cancelInvite": return actions.cancelInvite(row.userId);
        case "mute": return actions.mute(row.userId);
        case "stopCamera": return actions.stopCamera(row.userId);
        case "returnToAudience": return actions.returnToAudience(row.userId);
        case "spotlight": return actions.spotlight(floor.spotlight === row.userId ? null : row.userId);
      }
    },
    [actions, floor.spotlight],
  );

  return (
    <View testID="teacher-floor" style={{ gap: space.xs }}>
      <Refusal refusal={refusal} onDismiss={onDismissRefusal} />

      <View
        style={[
          floorStyles.rowWrap,
          {
            gap: space.xs,
            padding: space.xs,
            borderRadius: radius.md,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
          },
        ]}
      >
        <Pressable
          testID="teacher-floor-participants"
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            summary.handsUp === 0
              ? "Open the class list"
              : `Open the class list. ${summary.handsUp} ${summary.handsUp === 1 ? "hand is" : "hands are"} up`
          }
          style={[
            floorStyles.row,
            {
              gap: space.xs,
              minHeight: HIT_SLOP_MIN,
              paddingHorizontal: space.sm,
              borderRadius: radius.sm,
              // The one control that changes colour on its own, because it is the one a teacher
              // needs to notice without looking for it.
              backgroundColor: summary.handsUp > 0 ? colors.warnSoft : colors.muted,
            },
          ]}
        >
          <Feather
            name="users"
            size={16}
            color={summary.handsUp > 0 ? colors.warn : colors.mutedForeground}
          />
          <Text
            style={[t.caption, { color: summary.handsUp > 0 ? colors.warn : colors.mutedForeground }]}
          >
            {isCompact ? "Class" : "Class list"}
          </Text>
          {summary.handsUp > 0 ? (
            <FloorCount
              testID="teacher-floor-hands"
              icon="arrow-up"
              count={summary.handsUp}
              label={`${summary.handsUp} ${summary.handsUp === 1 ? "hand" : "hands"} up`}
              tone="waiting"
            />
          ) : null}
        </Pressable>

        {summary.speaking + summary.onCamera > 0 ? (
          <FloorCount
            testID="teacher-floor-speaking"
            icon="mic"
            count={summary.speaking + summary.onCamera}
            label={`${summary.speaking + summary.onCamera} speaking`}
            tone="live"
          />
        ) : null}
        {summary.waitingToAnswer > 0 ? (
          <FloorCount
            testID="teacher-floor-waiting"
            icon="clock"
            count={summary.waitingToAnswer}
            label={`${summary.waitingToAnswer} invited, not answered yet`}
            tone="waiting"
          />
        ) : null}

        <View style={floorStyles.grow} />

        <FloorButton
          testID="teacher-floor-invite-all"
          label="Invite all"
          spoken="Invite every student to speak. Nobody's microphone comes on until they accept"
          emphasis="secondary"
          onPress={actions.inviteAll}
        />
        <FloorButton
          testID="teacher-floor-mute-all"
          label="Mute all"
          spoken="Turn off every student's microphone"
          emphasis="danger"
          onPress={actions.muteAll}
        />
        {discussion.show ? (
          <FloorButton
            testID="teacher-floor-discussion"
            label={discussion.label}
            spoken={discussion.hint ? `${discussion.label}. ${discussion.hint}` : discussion.label}
            emphasis={discussion.ending ? "danger" : "primary"}
            disabled={!discussion.enabled}
            onPress={discussion.ending ? actions.endDiscussion : actions.startDiscussion}
          />
        ) : null}
      </View>

      {discussion.show && discussion.hint ? (
        <Text testID="teacher-floor-discussion-hint" style={[t.caption, { color: colors.mutedForeground }]}>
          {discussion.hint}
        </Text>
      ) : null}

      <ParticipantSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        rows={rows}
        floor={floor}
        actions={actions}
        onRowAction={runRow}
      />
    </View>
  );
}

/* ========================================================================== *
 * The class list                                                              *
 * ========================================================================== */

function ParticipantSheet({
  open,
  onClose,
  rows,
  floor,
  actions,
  onRowAction,
}: {
  open: boolean;
  onClose: () => void;
  rows: FloorRow[];
  floor: TeacherFloorView;
  actions: FloorActions;
  onRowAction: (row: FloorRow, intent: TeacherIntent) => void;
}) {
  const colors = useColors();
  const { t, space, radius, isCompact } = useLayout();
  const summary = floorSummary(floor);

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      // Android's back button closes it, which is what `onRequestClose` is for. Without this the
      // sheet is a trap on exactly the device this product is built for.
    >
      <Pressable
        testID="participant-sheet-scrim"
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close the class list"
        style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" }}
      >
        {/* Stops a tap inside the sheet from closing it, without swallowing the buttons. */}
        <Pressable
          testID="participant-sheet"
          onPress={() => {}}
          style={{
            maxHeight: "80%",
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            backgroundColor: colors.card,
            paddingBottom: space.lg,
          }}
        >
          <View
            style={[
              floorStyles.row,
              {
                gap: space.xs,
                minHeight: HIT_SLOP_MIN,
                paddingHorizontal: space.md,
                paddingTop: space.sm,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                paddingBottom: space.sm,
              },
            ]}
          >
            <Text style={[t.title3, floorStyles.grow, { color: colors.foreground }]}>Class list</Text>
            {summary.away > 0 ? (
              <Text style={[t.caption, { color: colors.mutedForeground }]}>
                {summary.connected} here · {summary.away} away
              </Text>
            ) : (
              <Text style={[t.caption, { color: colors.mutedForeground }]}>
                {summary.connected} {summary.connected === 1 ? "student" : "students"}
              </Text>
            )}
            <Pressable
              testID="participant-sheet-close"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close the class list"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN, alignItems: "flex-end", justifyContent: "center" }}
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {summary.waitingToAnswer > 0 ? (
            <View style={{ paddingHorizontal: space.md, paddingTop: space.sm }}>
              <FloorButton
                testID="participant-sheet-cancel-invites"
                label={`Take back ${summary.waitingToAnswer} unanswered ${summary.waitingToAnswer === 1 ? "invitation" : "invitations"}`}
                spoken="Withdraw every invitation nobody has answered yet"
                emphasis="quiet"
                onPress={actions.cancelInvites}
                grow
              />
            </View>
          ) : null}

          {rows.length === 0 ? (
            <View style={{ padding: space.xl, alignItems: "center", gap: space.xs }}>
              <Feather name="users" size={24} color={colors.inkFaint} />
              <Text style={[t.callout, { color: colors.mutedForeground, textAlign: "center" }]}>
                Nobody has joined yet.
              </Text>
              <Text style={[t.caption, { color: colors.inkFaint, textAlign: "center" }]}>
                Students appear here as they arrive.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.sm, gap: space.sm }}>
              {rows.map((row) => (
                <ParticipantRow
                  key={row.userId}
                  row={row}
                  featured={floor.spotlight === row.userId}
                  buttons={teacherRowButtons(row, floor)}
                  onAction={(intent) => onRowAction(row, intent)}
                  stack={isCompact}
                />
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ParticipantRow({
  row,
  featured,
  buttons,
  onAction,
  stack,
}: {
  row: FloorRow;
  featured: boolean;
  buttons: ReturnType<typeof teacherRowButtons>;
  onAction: (intent: TeacherIntent) => void;
  stack: boolean;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const chip = mediaChip(row.state);
  /*
    The half of Codex's second finding that lives on this screen.

    The state chip says what the *classroom* decided. This says whether the thing carrying the audio
    agreed. Without it a mute that never reached LiveKit was drawn exactly like one that did, and a
    teacher who had turned a microphone off believed the class could no longer hear it — while it
    was still open. Null when the two are in step, which is nearly always.
  */
  const note = providerNote(row.provider, false);

  return (
    <View
      testID={`participant-row-${row.userId}`}
      style={{
        gap: space.xs,
        padding: space.sm,
        borderRadius: radius.sm,
        backgroundColor: colors.surfaceSunk,
        // A featured student is outlined rather than tinted: the tint slots are already spoken
        // for by the media states, and a second meaning on the same colour is unreadable.
        borderWidth: featured ? 2 : 0,
        borderColor: featured ? colors.primary : "transparent",
        // A student who has dropped is dimmed rather than removed — they are still in the class.
        opacity: row.connected ? 1 : 0.6,
      }}
    >
      <View style={[floorStyles.row, { gap: space.xs }]}>
        <View
          style={{
            width: HIT_SLOP_MIN - space.xs,
            height: HIT_SLOP_MIN - space.xs,
            borderRadius: radius.pill,
            backgroundColor: colors.muted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={[t.caption, { color: colors.mutedForeground }]}>{initialsOf(row.name)}</Text>
        </View>
        <View style={floorStyles.grow}>
          <Text style={[t.body, { color: colors.foreground }]} numberOfLines={1}>
            {row.name}
          </Text>
        </View>
        <FloorChipView testID={`participant-state-${row.userId}`} label={chip.label} tone={chip.tone} />
      </View>

      {note ? (
        <FloorChipView testID={`participant-provider-${row.userId}`} label={note.label} tone={note.tone} />
      ) : null}

      {buttons.length > 0 ? (
        <View style={[stack ? floorStyles.rowWrap : floorStyles.row, { gap: space.xs }]}>
          {buttons.map((button) => (
            <FloorButton
              key={button.id}
              testID={`participant-${row.userId}-${button.id}`}
              label={button.label}
              spoken={button.spoken}
              emphasis={button.emphasis}
              grow={stack}
              onPress={() => onAction(button.intent)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
