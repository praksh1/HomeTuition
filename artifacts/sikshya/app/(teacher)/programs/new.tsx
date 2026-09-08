import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import ProgramTypeChooser from "@/components/programs/ProgramTypeChooser";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost, ApiError } from "@/utils/api";
import { offerableTypes, type ProgramType, type ProgramTypeChoice } from "@/utils/learningProgramUi";

/**
 * Choosing what kind of program this is, which is the only decision on the screen.
 *
 * The templates are fetched here because they decide what the menu may offer: `offerableTypes`
 * keeps only the kinds the server returned a template for, so this screen can never invite a
 * teacher to create something the API will refuse. The wording and icons stay local — see
 * `ProgramTypeChooser`.
 *
 * The studio fetches the templates again when it opens, for the prompts inside its sections. That
 * is a second round trip and it is deliberate: passing them through a route parameter would put a
 * copy of the server's contract in a URL, and holding them in a module-level cache would serve a
 * stale one after a deploy. Two small reads beat either.
 *
 * Creating the draft is the one write. It sends only the type; the server owns the id, the status,
 * the ownership and both timestamps, and there is nowhere in this request to say otherwise.
 */
export default function NewProgramScreen() {
  const colors = useColors();
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [creating, setCreating] = useState<ProgramType | null>(null);
  const [choices, setChoices] = useState<readonly ProgramTypeChoice[]>([]);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      const answer = await apiGet<{ templates: { type?: unknown }[] }>("/learning-programs/templates");
      setChoices(offerableTypes(answer.templates));
    } catch (err) {
      setChoices([]);
      setFailure(
        err instanceof ApiError
          ? err.message
          : "Fadko could not reach the server. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const choose = useCallback(async (type: ProgramType) => {
    // Guarded rather than debounced: a double tap on a slow connection would otherwise leave a
    // teacher with two empty programs and no idea which one they are in.
    if (creating !== null) return;
    setCreating(type);
    setFailure(null);
    try {
      const created = await apiPost<{ program: { id: number } }>("/learning-programs", { type });
      // `replace` rather than `push`: going back from the studio should reach the list, not the
      // chooser, which would offer to make a second program the teacher does not want.
      router.replace(`/(teacher)/programs/${created.program.id}`);
    } catch (err) {
      setCreating(null);
      setFailure(
        err instanceof ApiError
          ? err.message
          : "Fadko could not start the program. Check your connection and try again.",
      );
    }
  }, [creating]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ProgramTypeChooser
        choices={choices}
        loading={loading}
        failure={failure}
        onRetry={() => void loadTemplates()}
        onChoose={(type) => void choose(type)}
        creating={creating}
        onCancel={() => router.replace("/(teacher)/programs")}
      />
    </SafeAreaView>
  );
}
