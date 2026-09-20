import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
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
  teacherRowButtons,
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
  /** Shared classroom panel state: participants and messages never stack. */
  participantOpen?: boolean;
  onParticipantOpenChange?: (open: boolean) => void;
}

export default function ClassroomFloor({
  floor,
  refusal,
  onDismissRefusal,
  actions,
  discussionOpensAt = null,
  canModerate = true,
  participantOpen,
  onParticipantOpenChange,
}: Props) {
  if (!floor || !canModerate) return null;
  return floor.scope === "teacher" ? (
    <TeacherFloor
      floor={floor}
      refusal={refusal}
      onDismissRefusal={onDismissRefusal}
      actions={actions}
      discussionOpensAt={discussionOpensAt}
      participantOpen={participantOpen}
      onParticipantOpenChange={onParticipantOpenChange}
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
  const chip = floor.you.acceptedCamera
    ? { label: "Camera on", tone: "live" as const }
    : floor.you.acceptedMic
      ? { label: "Microphone on", tone: "live" as const }
      : floor.you.state === "muted-by-teacher"
        ? { label: "Muted by teacher", tone: "stopped" as const }
        : floor.you.requestedAt !== null
          ? { label: "Hand up", tone: "waiting" as const }
          : { label: "Microphone off", tone: "neutral" as const };
  const handRaised = floor.you.requestedAt !== null;
  const provider = providerNote(floor.you.provider, true);

  return (
    <View
      testID="student-floor"
      style={{
        gap: space.xs,
        padding: space.sm,
        borderRadius: radius.md,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: handRaised ? colors.primary : colors.border,
      }}
    >
      <Refusal refusal={refusal} onDismiss={onDismissRefusal} />

      <View
        style={[
          isCompact ? floorStyles.rowWrap : floorStyles.row,
          { gap: space.xs },
        ]}
      >
        <FloorButton
          testID={handRaised ? "student-floor-cancel-ask" : "student-floor-ask"}
          label={handRaised ? "Lower hand" : "Raise hand"}
          spoken={handRaised ? "Lower your hand" : "Raise your hand for the teacher"}
          emphasis={handRaised ? "secondary" : "primary"}
          grow={isCompact}
          onPress={() => {
            if (handRaised) actions.cancelAsk();
            else actions.ask();
          }}
        />
        <FloorChipView testID="student-floor-state" label={chip.label} tone={chip.tone} />
        <FloorChipView
          testID="student-floor-camera"
          label={floor.you.allowedCamera ? "Camera available" : "Camera off · teacher controlled"}
          tone={floor.you.allowedCamera ? "live" : "neutral"}
        />
      </View>

      {provider ? (
        <FloorChipView testID="student-floor-provider" label={provider.label} tone={provider.tone} />
      ) : null}

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
  participantOpen,
  onParticipantOpenChange,
}: {
  floor: TeacherFloorView;
  refusal: FloorRefusal | null;
  onDismissRefusal: () => void;
  actions: FloorActions;
  discussionOpensAt: number | null;
  participantOpen?: boolean;
  onParticipantOpenChange?: (open: boolean) => void;
}) {
  const colors = useColors();
  const { t, space, radius, isCompact } = useLayout();
  const [localSheetOpen, setLocalSheetOpen] = useState(false);
  const sheetOpen = participantOpen ?? localSheetOpen;
  const setSheetOpen = useCallback((open: boolean) => {
    if (participantOpen === undefined) setLocalSheetOpen(open);
    onParticipantOpenChange?.(open);
  }, [onParticipantOpenChange, participantOpen]);
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
          testID="teacher-floor-mute-all"
          label="Mute all"
          spoken="Turn off every student's microphone"
          emphasis="danger"
          onPress={() => actions.muteAll()}
        />
        {discussion.show ? (
          <FloorButton
            testID="teacher-floor-discussion"
            label={discussion.label}
            spoken={discussion.hint ? `${discussion.label}. ${discussion.hint}` : discussion.label}
            emphasis={discussion.ending ? "danger" : "primary"}
            disabled={!discussion.enabled}
            onPress={() => {
              if (discussion.ending) actions.endDiscussion();
              else actions.startDiscussion();
            }}
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "hands" | "speaking" | "camera">("all");
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const sheetDrag = useRef(new Animated.Value(0)).current;
  const sheetPan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => sheetDrag.setValue(Math.max(0, gesture.dy)),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > 72 || gesture.vy > 0.85) {
            Animated.timing(sheetDrag, {
              toValue: 700,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              sheetDrag.setValue(0);
              onClose();
            });
            return;
          }
          Animated.spring(sheetDrag, {
            toValue: 0,
            speed: 28,
            bounciness: 0,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(sheetDrag, {
            toValue: 0,
            speed: 28,
            bounciness: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [onClose, sheetDrag],
  );

  useEffect(() => {
    if (open) sheetDrag.setValue(0);
  }, [open, sheetDrag]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (needle && !row.name.toLocaleLowerCase().includes(needle)) return false;
      if (filter === "hands") return row.requestedAt !== null;
      if (filter === "speaking") return row.state === "speaking" || row.state === "camera-active";
      if (filter === "camera") return row.allowedCamera && row.state !== "camera-active";
      return true;
    });
  }, [filter, query, rows]);

  if (!open) return null;

  const panel = (
    <View
      testID={isCompact ? "participant-sheet" : "participant-drawer"}
      style={{ flex: 1, minHeight: 0, backgroundColor: colors.card }}
    >
      <View style={{ gap: space.sm, padding: space.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={[floorStyles.row, { gap: space.xs }]}>
          <View style={floorStyles.grow}>
            <Text style={[t.title3, { color: colors.foreground }]}>Class · {floor.participantCount}</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>
              {summary.connected} here{summary.away > 0 ? ` · ${summary.away} away` : ""}
            </Text>
          </View>
          <Pressable
            testID="participant-sheet-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close the class list"
            style={{ width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" }}
          >
            <Feather name="x" size={21} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <View style={[floorStyles.row, { gap: space.xs, minHeight: HIT_SLOP_MIN, paddingHorizontal: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surfaceSunk }]}>
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            testID="participant-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Search students"
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Search students"
            style={[t.body, { flex: 1, minWidth: 0, color: colors.foreground, outlineStyle: "none" } as object]}
          />
        </View>

        <View style={[floorStyles.row, { gap: space.xs }]}>
          <FloorButton testID="participant-mute-all" label="Mute all" spoken="Mute every student" emphasis="danger" onPress={() => actions.muteAll()} grow />
          <FloorButton testID="participant-permissions" label="Permissions" spoken="Open class permissions" emphasis={permissionsOpen ? "primary" : "secondary"} onPress={() => setPermissionsOpen((value) => !value)} grow />
        </View>

        {permissionsOpen ? (
          <View testID="class-permissions" style={{ gap: space.xxs, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.muted }}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>Class permissions</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>Student audio · joins muted · self-unmute allowed until teacher mutes</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>Student camera · teacher approval required</Text>
          </View>
        ) : null}

        <View style={[floorStyles.row, { gap: space.xs, flexWrap: "wrap" }]}>
          {([
            ["all", "All"], ["hands", "Hands raised"], ["speaking", "Speaking"], ["camera", "Camera requests"],
          ] as const).map(([value, label]) => (
            <Pressable
              key={value}
              testID={`participant-filter-${value}`}
              onPress={() => setFilter(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === value }}
              style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center", paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: filter === value ? colors.actionSoft : colors.card, borderWidth: 1, borderColor: filter === value ? colors.primary : colors.border }}
            >
              <Text style={[t.caption, { color: filter === value ? colors.primary : colors.mutedForeground }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(row) => String(row.userId)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.md, gap: space.sm, flexGrow: filtered.length === 0 ? 1 : undefined }}
        renderItem={({ item: row }) => (
          <ParticipantRow
            row={row}
            featured={floor.spotlight === row.userId}
            buttons={teacherRowButtons(row, floor)}
            onAction={(intent) => onRowAction(row, intent)}
            stack={isCompact}
          />
        )}
        ListEmptyComponent={
          <View style={{ flex: 1, padding: space.xl, alignItems: "center", justifyContent: "center", gap: space.xs }}>
            <Feather name="users" size={24} color={colors.inkFaint} />
            <Text style={[t.callout, { color: colors.mutedForeground, textAlign: "center" }]}>No students match this view.</Text>
          </View>
        }
      />
    </View>
  );

  if (!isCompact && Platform.OS === "web") {
    return (
      <View
        pointerEvents="auto"
        style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 380, maxWidth: "38vw", zIndex: 220, borderLeftWidth: 1, borderLeftColor: colors.border, backgroundColor: colors.card, boxShadow: "-18px 0 48px rgba(15,23,42,0.16)" } as object}
      >
        {panel}
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable testID="participant-sheet-scrim" onPress={onClose} style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" }}>
        <Animated.View style={{ height: "62%", maxHeight: "92%", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: "hidden", transform: [{ translateY: sheetDrag }] }}>
          <Pressable
            onPress={() => {}}
            accessibilityLabel="Swipe down to close the class list"
            style={{ minHeight: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center", backgroundColor: colors.card }}
            {...sheetPan.panHandlers}
          >
            <View style={{ width: 44, height: 4, borderRadius: radius.pill, backgroundColor: colors.border }} />
          </Pressable>
          <Pressable onPress={() => {}} style={{ flex: 1, minHeight: 0 }}>
            {panel}
          </Pressable>
        </Animated.View>
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
  const [expanded, setExpanded] = useState(false);
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
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={`${row.name}. ${chip.label}. ${expanded ? "Hide" : "Show"} actions`}
        accessibilityState={{ expanded }}
        style={[floorStyles.row, { gap: space.xs, minHeight: HIT_SLOP_MIN }]}
      >
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
        <Feather name={expanded ? "chevron-up" : "more-horizontal"} size={18} color={colors.mutedForeground} />
      </Pressable>

      {note ? (
        <FloorChipView testID={`participant-provider-${row.userId}`} label={note.label} tone={note.tone} />
      ) : null}

      {expanded && buttons.length > 0 ? (
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
