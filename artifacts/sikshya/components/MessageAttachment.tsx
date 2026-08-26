import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/utils/api";
import { openAttachment } from "@/utils/openAttachment";
import { attachmentLabel, type Attachment } from "@/utils/reactions";

/**
 * A file on a message: shown, if it can be.
 *
 * The owner's ask: *"for images, can we have like a preview/actual image showing up instead of
 * the file link."* They are right — a photo of somebody's working is the message, and a row
 * reading `Gemini_Generated_Image_6vk27u….png` is a filing cabinet where a conversation should
 * be. Anything that is not a picture keeps the chip, because there is nothing to show.
 *
 * ### The ten-minute problem
 *
 * View links are signed and die in ten minutes (`VIEW_URL_MINUTES`), which is deliberate — a
 * link that leaks stops working almost immediately. It means a thread left open on a desk goes
 * to broken images unless somebody fetches a fresh one, so a failed load asks for a new link
 * and tries again. Once: a second failure is a real problem and falls back to the chip, rather
 * than hammering the server on a loop nobody can see.
 *
 * One component for both conversations. The private thread and the class thread both carry
 * files now, and two copies of this would be two answers to "what does a photo look like".
 */

interface Props {
  file: Attachment;
  /** Drawn on the sender's own bubble, which is a solid colour rather than the page. */
  mine: boolean;
  /** Told when a file cannot be opened, so the screen can say so in its own words. */
  onProblem?: (reason: string) => void;
}

export default function MessageAttachment({ file, mine, onProblem }: Props) {
  const colors = useColors();
  const isImage = file.fileType.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  const fetchLink = useCallback(async () => {
    try {
      const { url: signed } = await apiGet<{ url: string }>(
        `/storage/file?key=${encodeURIComponent(file.fileKey)}`,
      );
      if (alive.current) setUrl(signed);
    } catch {
      // No link, no preview. The chip below still opens it, which goes through the same
      // route and can report a real reason to the person.
      if (alive.current) setFailed(true);
    }
  }, [file.fileKey]);

  useEffect(() => {
    if (!isImage) return;
    void fetchLink();
  }, [isImage, fetchLink]);

  const open = async () => {
    const result = await openAttachment(file.fileKey);
    if (!result.ok) onProblem?.(result.reason ?? "We could not open that file.");
  };

  if (isImage && !failed) {
    return (
      <TouchableOpacity
        onPress={() => void open()}
        activeOpacity={0.85}
        testID={`attachment-image-${file.fileKey}`}
        style={[styles.imageWrap, { borderColor: mine ? "rgba(255,255,255,0.28)" : colors.border }]}
      >
        {url ? (
          <Image
            source={{ uri: url }}
            style={styles.image}
            // Fills the frame without distorting a photo taken in any shape.
            resizeMode="cover"
            onError={() => {
              /*
               * Almost always the ten minutes running out on a thread left open. Ask for a
               * fresh link once; a second failure means something else and shows the chip.
               */
              if (retried.current) { setFailed(true); return; }
              retried.current = true;
              setUrl(null);
              void fetchLink();
            }}
          />
        ) : (
          <View style={[styles.image, styles.loading, { backgroundColor: colors.muted }]}>
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={() => void open()}
      activeOpacity={0.75}
      testID={`attachment-file-${file.fileKey}`}
      style={[
        styles.chip,
        {
          backgroundColor: mine ? "rgba(255,255,255,0.16)" : colors.muted,
          borderColor: mine ? "rgba(255,255,255,0.28)" : colors.border,
        },
      ]}
    >
      <Feather
        name={isImage ? "image" : "file-text"}
        size={14}
        color={mine ? "#fff" : colors.primary}
      />
      <Text style={[styles.name, { color: mine ? "#fff" : colors.foreground }]} numberOfLines={1}>
        {attachmentLabel(file)}
      </Text>
      <Feather name="external-link" size={12} color={mine ? "#ffffffCC" : colors.mutedForeground} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  /**
   * Big enough to recognise a page of working at a glance, small enough that three in a row do
   * not push the conversation off the screen. Sized rather than aspect-fitted so a thread of
   * mixed photos stays a tidy column.
   */
  imageWrap: { borderRadius: 12, borderWidth: 1, overflow: "hidden", width: 200, height: 150 },
  image: { width: "100%", height: "100%" },
  loading: { alignItems: "center", justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  name: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
});
