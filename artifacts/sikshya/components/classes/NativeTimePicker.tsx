import React, { useEffect, useState } from "react";
import { Modal, Platform, Text, View } from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { marketplaceColumnMax } from "@/constants/layout";
import { batchTimeDraft, batchTimeValue } from "@/utils/programBatches";
import { ProgramButton } from "@/components/programs/ProgramPieces";
export function NativeTimePicker({
  visible,
  value,
  onCancel,
  onPick,
}: {
  visible: boolean;
  value: string;
  onCancel: () => void;
  onPick: (value: string) => void;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const [draft, setDraft] = useState(batchTimeValue(value));
  useEffect(() => {
    if (visible) setDraft(batchTimeValue(value));
  }, [visible, value]);
  if (!visible || Platform.OS === "web") return null;
  const changed = (event: DateTimePickerEvent, next?: Date) => {
    if (Platform.OS === "android") {
      if (event.type === "set" && next) onPick(batchTimeDraft(next));
      else onCancel();
    } else if (next) setDraft(next);
  };
  if (Platform.OS === "android")
    return <DateTimePicker value={draft} mode="time" onChange={changed} />;
  return (
    <Modal visible transparent onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: space.md,
          backgroundColor: colors.scrim,
        }}
      >
        <View
          style={{
            backgroundColor: colors.card,
            padding: space.md,
            borderRadius: radius.lg,
            maxWidth: marketplaceColumnMax,
            width: "100%",
            gap: space.md,
          }}
        >
          <Text style={[t.title3, { color: colors.foreground }]}>
            Choose a Nepal start time
          </Text>
          <DateTimePicker
            value={draft}
            mode="time"
            display="spinner"
            onChange={changed}
          />
          <ProgramButton
            label="Use this time"
            emphasis="primary"
            onPress={() => onPick(batchTimeDraft(draft))}
          />
          <ProgramButton label="Cancel" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}
