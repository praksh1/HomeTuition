import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

/**
 * Trial-build safety screen. The native Daily SDK cannot coexist with LiveKit's WebRTC module.
 * This file is not part of the shipping phone app; see docs/NATIVE-LIVEKIT-TRIAL.md.
 * A trial build must never be distributed until its API routes it to LiveKit and device tests pass.
 */
export default function DailyEmbed({ style }: {
  roomUrl: string;
  meetingToken?: string | null;
  displayName: string;
  style?: StyleProp<ViewStyle>;
  onLeft?: () => void;
  watchUserName?: string;
  onWatchedParticipantLeft?: () => void;
  canScreenShare?: boolean;
  chatMessages?: { id: string; senderName: string; text: string; time: string; isMe: boolean }[];
  onSendChat?: (text: string) => void;
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  return (
    <View testID="daily-unavailable-native-trial" style={[styles.box, { backgroundColor: colors.ink, padding: space.xl }, style]}>
      <Text style={[t.bodyStrong, { color: colors.onInverse, textAlign: "center" }]}>This trial app cannot open a Daily call.</Text>
      <Text style={[t.caption, { color: colors.onInverseMuted, textAlign: "center", marginTop: space.sm }]}>Use the current Fadko app for this class. The LiveKit phone trial is not released yet.</Text>
    </View>
  );
}

const styles = StyleSheet.create({ box: { flex: 1, alignItems: "center", justifyContent: "center" } });
