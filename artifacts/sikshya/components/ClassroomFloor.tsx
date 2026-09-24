import { Feather, FontAwesome5 } from "@expo/vector-icons";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useVisibleViewport } from "@/hooks/useVisibleViewport";
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
import { FloorButton, FloorChipView, floorStyles, initialsOf } from "./floor/FloorPieces";

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
  microphoneOn?: boolean;
  onToggleMicrophone?: () => void;
  cameraOn?: boolean;
  onToggleCamera?: () => void;
  dockControls?: React.ReactNode;
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
  microphoneOn = false,
  onToggleMicrophone,
  cameraOn = false,
  onToggleCamera,
  dockControls,
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
      microphoneOn={microphoneOn}
      onToggleMicrophone={onToggleMicrophone}
      cameraOn={cameraOn}
      onToggleCamera={onToggleCamera}
      dockControls={dockControls}
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
  microphoneOn,
  onToggleMicrophone,
  cameraOn,
  onToggleCamera,
  dockControls,
}: {
  floor: StudentFloorView;
  refusal: FloorRefusal | null;
  onDismissRefusal: () => void;
  actions: FloorActions;
  microphoneOn: boolean;
  onToggleMicrophone?: () => void;
  cameraOn: boolean;
  onToggleCamera?: () => void;
  dockControls?: React.ReactNode;
}) {
  const colors = useColors();
  const { t, space, radius, isCompact } = useLayout();
  const handRaised = floor.you.requestedAt !== null;
  const canToggleMicrophone = Boolean(onToggleMicrophone && (microphoneOn || (floor.you.allowedMic && floor.you.provider === "ok" && floor.you.state !== "muted-by-teacher")));
  const provider = providerNote(floor.you.provider, true);
  const canToggleCamera = Boolean(onToggleCamera && (cameraOn || (floor.you.allowedCamera && floor.you.provider === "ok")));
  const mediaStatus = microphoneOn && cameraOn ? "Camera and microphone on" : cameraOn ? "Camera on · microphone off" : microphoneOn ? "Microphone on · camera off" : "Camera and microphone off";

  return (
    <View
      testID="student-floor"
      style={{
        gap: space.xs,
        alignSelf: "center",
        maxWidth: "100%",
      }}
    >
      <Refusal refusal={refusal} onDismiss={onDismissRefusal} />

      <View
        style={[
          floorStyles.row,
          {
            alignSelf: "center",
            gap: space.xxs,
            padding: space.xxs,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: handRaised ? colors.primary : colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <Pressable
          testID={handRaised ? "student-floor-cancel-ask" : "student-floor-ask"}
          accessibilityRole="button"
          accessibilityLabel={handRaised ? "Lower your hand" : "Raise your hand for the teacher"}
          accessibilityState={{ selected: handRaised }}
          onPress={() => {
            if (handRaised) actions.cancelAsk();
            else actions.ask();
          }}
          style={[
            floorStyles.row,
            {
              minWidth: HIT_SLOP_MIN,
              height: HIT_SLOP_MIN,
              justifyContent: "center",
              gap: space.xxs,
              paddingHorizontal: isCompact ? space.sm : space.md,
              borderRadius: radius.pill,
              backgroundColor: handRaised ? colors.actionSoft : colors.card,
            },
          ]}
        >
          <FontAwesome5 name="hand-paper" size={18} color={handRaised ? colors.primary : colors.foreground} />
          {!isCompact && !dockControls ? (
            <Text style={[t.caption, { color: handRaised ? colors.primary : colors.foreground }]}>
              {handRaised ? "Hand raised" : "Raise hand"}
            </Text>
          ) : null}
        </Pressable>
        <Pressable testID="student-floor-microphone" accessibilityRole="button"
          accessibilityLabel={microphoneOn ? "Mute microphone" : canToggleMicrophone ? "Turn on microphone" : "Microphone off until teacher allows you to speak"}
          accessibilityState={{ disabled: !canToggleMicrophone, selected: microphoneOn }}
          disabled={!canToggleMicrophone} onPress={onToggleMicrophone}
          style={[floorStyles.row, { minWidth: HIT_SLOP_MIN, height: HIT_SLOP_MIN, justifyContent: "center", gap: space.xxs,
            paddingHorizontal: isCompact ? space.sm : space.md, borderRadius: radius.pill,
            backgroundColor: microphoneOn ? colors.actionSoft : colors.card, opacity: canToggleMicrophone ? 1 : 0.65 }]}>
          <Feather name={microphoneOn ? "mic" : "mic-off"} size={19} color={microphoneOn ? colors.primary : colors.mutedForeground} />
          {!isCompact && !dockControls ? <Text style={[t.caption, { color: microphoneOn ? colors.primary : colors.mutedForeground }]}>{microphoneOn ? "Mic on" : "Mic off"}</Text> : null}
        </Pressable>
        <Pressable testID="student-floor-camera" accessibilityRole="button"
          accessibilityLabel={cameraOn ? "Turn off camera" : canToggleCamera ? "Turn on camera" : "Camera off until teacher allows it"}
          accessibilityState={{ disabled: !canToggleCamera, selected: cameraOn }}
          aria-disabled={!canToggleCamera}
          disabled={!canToggleCamera} onPress={onToggleCamera}
          style={{ width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center", borderRadius: radius.pill,
            backgroundColor: cameraOn ? colors.actionSoft : colors.card, opacity: canToggleCamera ? 1 : 0.65 }}>
          <Feather name={cameraOn ? "video" : "video-off"} size={19} color={cameraOn ? colors.primary : colors.mutedForeground} />
        </Pressable>
        {dockControls}
      </View>

      <Text testID="student-media-status" accessibilityLiveRegion="polite"
        style={[t.overline, { color: microphoneOn || cameraOn ? colors.success : colors.inkFaint, textAlign: "center", paddingHorizontal: space.sm }]}>
        {mediaStatus}
      </Text>
      {floor.you.state === "muted-by-teacher" ? (
        <FloorChipView testID="student-floor-muted" label="Muted by teacher" tone="stopped" />
      ) : null}

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
      <ParticipantSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        rows={rows}
        floor={floor}
        actions={actions}
        onRowAction={runRow}
        discussion={discussion}
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
  discussion,
}: {
  open: boolean;
  onClose: () => void;
  rows: FloorRow[];
  floor: TeacherFloorView;
  actions: FloorActions;
  onRowAction: (row: FloorRow, intent: TeacherIntent) => void;
  discussion: ReturnType<typeof discussionControl>;
}) {
  const colors = useColors();
  const { t, space, radius, isCompact } = useLayout();
  const summary = floorSummary(floor);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "hands" | "speaking" | "camera">("all");
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const viewport = useVisibleViewport(open);
  const safeArea = useContext(SafeAreaInsetsContext);
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

        {discussion.show ? (
          <View style={{ gap: space.xxs }}>
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
              grow
            />
            {discussion.hint ? (
              <Text testID="teacher-floor-discussion-hint" style={[t.caption, { color: colors.mutedForeground }]}>
                {discussion.hint}
              </Text>
            ) : null}
          </View>
        ) : null}

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

        <View style={[floorStyles.row, { gap: space.xs, flexWrap: "wrap" }]}>
          {([
            ["all", `All (${rows.length})`], ["hands", `Hands (${floor.queue.length})`], ["speaking", "Speaking"], ["camera", "Camera"],
          ] as const).map(([value, label]) => (
            <Pressable
              key={value}
              testID={`participant-filter-${value}`}
              onPress={() => setFilter(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === value }} aria-selected={filter === value}
              style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center", paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: filter === value ? colors.actionSoft : colors.card, borderWidth: 1, borderColor: filter === value ? colors.primary : colors.border }}
            >
              <Text style={[t.caption, { color: filter === value ? colors.primary : colors.mutedForeground }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        testID="participant-list"
        style={{ flex: 1, minHeight: 0 }}
        data={filtered}
        keyExtractor={(row) => String(row.userId)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.md, paddingBottom: space.xl, gap: space.sm, flexGrow: filtered.length === 0 ? 1 : undefined }}
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

      {permissionsOpen ? (
        <ScrollView
          testID="class-permissions-surface"
          contentContainerStyle={{ gap: space.lg, padding: space.md, paddingBottom: space.xl }}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            backgroundColor: colors.card,
          } as object}
        >
          <View style={[floorStyles.row, { gap: space.xs }]}>
            <Pressable
              testID="class-permissions-back"
              accessibilityRole="button"
              accessibilityLabel="Back to class list"
              onPress={() => setPermissionsOpen(false)}
              style={{ width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" }}
            >
              <Feather name="arrow-left" size={20} color={colors.foreground} />
            </Pressable>
            <View style={floorStyles.grow}>
              <Text style={[t.title3, { color: colors.foreground }]}>Class permissions</Text>
              <Text style={[t.caption, { color: colors.mutedForeground }]}>What students can use in this lesson</Text>
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[t.overline, { color: colors.primary }]}>Student audio</Text>
            <View style={{ gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceSunk }}>
              <PermissionRow label="Join muted" detail="Students enter without broadcasting" />
              <PermissionRow label="Teacher approval required" detail="Students can unmute only after you allow them" />
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[t.overline, { color: colors.primary }]}>Student camera</Text>
            <View style={{ gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceSunk }}>
              <PermissionRow label="Teacher approval required" detail="A student's camera stays off until you allow it" />
            </View>
          </View>
        </ScrollView>
      ) : null}
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
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <View style={[{ backgroundColor: colors.scrim, justifyContent: "flex-end", flex: 1 }, Platform.OS === "web" ? { position: "absolute", top: viewport.top, height: viewport.height, left: 0, right: 0, paddingTop: "max(8px, env(safe-area-inset-top))", paddingBottom: "env(safe-area-inset-bottom)" } as object : { paddingTop: Math.max(safeArea?.top ?? 0, space.xs), paddingBottom: safeArea?.bottom ?? space.md }]}>
        <Pressable testID="participant-sheet-scrim" accessibilityLabel="Close class list" onPress={onClose} style={{ position: "absolute", inset: 0 } as object} />
        <Animated.View style={{ flex: 1, minHeight: 0, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: "hidden", transform: [{ translateY: sheetDrag }] }}>
          <Pressable
            onPress={() => {}}
            accessibilityLabel="Swipe down to close the class list"
            style={{ height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center", backgroundColor: colors.card }}
            {...sheetPan.panHandlers}
          >
            <View style={{ width: 44, height: 4, borderRadius: radius.pill, backgroundColor: colors.border }} />
          </Pressable>
          <View style={{ flex: 1, minHeight: 0 }}>
            {panel}
          </View>
        </Animated.View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PermissionRow({ label, detail }: { label: string; detail: string }) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return (
    <View style={[floorStyles.row, { gap: space.sm }]}>
      <View style={floorStyles.grow}>
        <Text style={[t.body, { color: colors.foreground }]}>{label}</Text>
        <Text style={[t.caption, { color: colors.mutedForeground }]}>{detail}</Text>
      </View>
      <View
        accessibilityLabel={`${label}: active classroom rule`}
        style={{
          minWidth: 32,
          height: 32,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.pill,
          backgroundColor: colors.actionSoft,
        }}
      >
        <Feather name="check" size={17} color={colors.primary} />
      </View>
    </View>
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
        <View style={[floorStyles.rowWrap, { gap: space.xs, maxWidth: "100%" }]}>
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
