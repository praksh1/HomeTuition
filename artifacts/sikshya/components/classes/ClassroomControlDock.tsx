import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

interface ClassroomControlDockProps {
  bottom: number;
  chatOpen: boolean;
  unreadCount: number;
  videoHidden: boolean;
  participantCount?: number;
  raisedHands?: number;
  participantOpen?: boolean;
  materialOpen?: boolean;
  onToggleParticipants?: () => void;
  onToggleChat: () => void;
  onToggleVideo: () => void;
  onToggleMaterial?: () => void;
  onLeave: () => void;
  leaveLabel: string;
}

interface DockActionProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  tone?: "default" | "active" | "destructive";
  testID?: string;
  onPress: () => void;
}

/**
 * One compact control surface for the classroom.
 *
 * The old classroom rendered a permanent horizontal toolbar, another "Show call" pill, and a
 * second Hide action inside the video frame. On a phone those controls covered the lesson they
 * were meant to help. This dock keeps Messages visible, folds occasional actions into one button,
 * and makes Show/Hide one authoritative action. A pointer can reveal it on hover; a finger taps.
 */
export function ClassroomControlDock({
  bottom,
  chatOpen,
  unreadCount,
  videoHidden,
  participantCount,
  raisedHands = 0,
  participantOpen = false,
  materialOpen = false,
  onToggleParticipants,
  onToggleChat,
  onToggleVideo,
  onToggleMaterial,
  onLeave,
  leaveLabel,
}: ClassroomControlDockProps) {
  const colors = useColors();
  const { t, numeric, space, radius, elevation } = useLayout();
  const [expanded, setExpanded] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: expanded ? 1 : 0,
      damping: 20,
      stiffness: 235,
      mass: 0.72,
      useNativeDriver: true,
    }).start();
  }, [expanded, progress]);

  const hoverProps = useMemo(
    () =>
      Platform.OS === "web"
        ? ({
            onMouseEnter: () => setExpanded(true),
            onMouseLeave: () => setExpanded(false),
          } as Record<string, unknown>)
        : {},
    [],
  );

  const DockAction = ({ icon, label, tone = "default", testID, onPress }: DockActionProps) => {
    const active = tone === "active";
    const destructive = tone === "destructive";
    const foreground = destructive
      ? colors.destructive
      : active
        ? colors.primary
        : colors.foreground;

    return (
      <TouchableOpacity
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        activeOpacity={0.78}
        onPress={() => {
          onPress();
          setExpanded(false);
        }}
        style={[
          s.expandedAction,
          elevation.card,
          {
            minHeight: HIT_SLOP_MIN,
            gap: space.xs,
            paddingHorizontal: space.sm,
            borderRadius: radius.pill,
            borderColor: destructive ? colors.destructive : colors.border,
            backgroundColor: active ? colors.actionSoft : colors.card,
          },
        ]}
      >
        <Feather name={icon} size={18} color={foreground} />
        <Text style={[t.caption, { color: foreground }]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View
      pointerEvents="box-none"
      style={[s.layer, { right: space.md, bottom }]}
      {...(hoverProps as object)}
    >
      <Animated.View
        testID="classroom-dock-actions"
        pointerEvents={expanded ? "auto" : "none"}
        style={[
          s.expandedActions,
          { gap: space.xs, marginBottom: space.xs },
          {
            opacity: progress,
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [18, 0],
                }),
              },
              {
                scale: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.94, 1],
                }),
              },
            ],
          },
        ]}
      >
        {onToggleMaterial ? (
          <DockAction
            icon="paperclip"
            label="Teaching material"
            tone={materialOpen ? "active" : "default"}
            testID="classroom-dock-material"
            onPress={onToggleMaterial}
          />
        ) : null}
        <DockAction
          icon={videoHidden ? "video" : "eye-off"}
          label={videoHidden ? "Show call" : "Hide call"}
          tone={videoHidden ? "active" : "default"}
          testID="video-visibility-btn"
          onPress={onToggleVideo}
        />
        <DockAction
          icon="phone-off"
          label={leaveLabel}
          tone="destructive"
          testID="classroom-dock-leave"
          onPress={onLeave}
        />
      </Animated.View>

      <View
        pointerEvents="auto"
        style={[
          s.primaryRail,
          elevation.sheet,
          {
            gap: space.xxs,
            padding: space.xxs,
            borderRadius: radius.pill,
            borderColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        {onToggleParticipants ? (
          <TouchableOpacity
            testID="teacher-floor-participants"
            accessibilityRole="button"
            accessibilityLabel={
              raisedHands > 0
                ? `Open class list. ${raisedHands} ${raisedHands === 1 ? "hand is" : "hands are"} raised.`
                : `Open class list. ${participantCount ?? 0} people.`
            }
            activeOpacity={0.78}
            onPress={onToggleParticipants}
            style={[
              s.primaryButton,
              s.participantButton,
              {
                minWidth: HIT_SLOP_MIN + space.md,
                height: HIT_SLOP_MIN,
                gap: space.xxs,
                borderRadius: radius.pill,
                backgroundColor: participantOpen
                  ? colors.actionSoft
                  : raisedHands > 0
                    ? colors.warnSoft
                    : colors.card,
              },
            ]}
          >
            <Feather name="users" size={19} color={participantOpen ? colors.primary : raisedHands > 0 ? colors.warn : colors.foreground} />
            <Text style={[t.caption, numeric, { color: participantOpen ? colors.primary : raisedHands > 0 ? colors.warn : colors.foreground }]}>
              {participantCount ?? 0}
            </Text>
            {raisedHands > 0 ? (
              <View
                pointerEvents="none"
                testID="teacher-floor-hands"
                style={[
                  s.badge,
                  {
                    minWidth: space.lg,
                    height: space.lg,
                    paddingHorizontal: space.xxs,
                    borderRadius: radius.pill,
                    borderColor: colors.card,
                    backgroundColor: colors.warn,
                  },
                ]}
              >
                <Text style={[t.overline, numeric, { color: colors.primaryForeground }]}>
                  {raisedHands > 9 ? "9+" : raisedHands}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ) : null}

        {videoHidden ? (
          <TouchableOpacity
            testID="video-show-call-btn"
            accessibilityRole="button"
            accessibilityLabel="Show call window"
            activeOpacity={0.78}
            onPress={onToggleVideo}
            style={[
              s.primaryButton,
              {
                width: HIT_SLOP_MIN,
                height: HIT_SLOP_MIN,
                borderRadius: radius.pill,
                backgroundColor: colors.actionSoft,
              },
            ]}
          >
            <Feather name="video" size={19} color={colors.primary} />
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          testID="classroom-dock-chat"
          accessibilityRole="button"
          accessibilityLabel={chatOpen ? "Close class messages" : "Open class messages"}
          activeOpacity={0.78}
          onPress={onToggleChat}
          style={[
            s.primaryButton,
            {
              width: HIT_SLOP_MIN,
              height: HIT_SLOP_MIN,
              borderRadius: radius.pill,
              backgroundColor: chatOpen ? colors.actionSoft : colors.card,
            },
          ]}
        >
          <Feather
            name="message-circle"
            size={20}
            color={chatOpen ? colors.primary : colors.foreground}
          />
          {unreadCount > 0 && !chatOpen ? (
            <View
              pointerEvents="none"
              style={[
                s.badge,
                {
                  minWidth: space.lg,
                  height: space.lg,
                  paddingHorizontal: space.xxs,
                  borderRadius: radius.pill,
                  borderColor: colors.card,
                  backgroundColor: colors.brand,
                },
              ]}
            >
              <Text style={[t.overline, numeric, { color: colors.primaryForeground }]}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>

        <TouchableOpacity
          testID="classroom-dock-more"
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Close classroom controls" : "More classroom controls"}
          accessibilityState={{ expanded }}
          activeOpacity={0.78}
          onPress={() => setExpanded((value) => !value)}
          style={[
            s.primaryButton,
            {
              width: HIT_SLOP_MIN,
              height: HIT_SLOP_MIN,
              borderRadius: radius.pill,
              backgroundColor: expanded ? colors.primary : colors.card,
            },
          ]}
        >
          <Feather
            name={expanded ? "x" : "more-vertical"}
            size={20}
            color={expanded ? colors.primaryForeground : colors.foreground}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  layer: {
    position: "absolute",
    zIndex: 125,
    alignItems: "flex-end",
  },
  expandedActions: {
    alignItems: "flex-end",
  },
  expandedAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  primaryRail: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
  },
  primaryButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  participantButton: {
    flexDirection: "row",
    paddingHorizontal: 8,
  },
  badge: {
    position: "absolute",
    right: -3,
    top: -4,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
});
