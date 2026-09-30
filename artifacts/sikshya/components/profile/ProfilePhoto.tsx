import React, { useEffect, useRef, useState } from "react";
import { Image, StyleSheet } from "react-native";

import { apiGet } from "@/utils/api";

const photoCache = new Map<number, { url: string | null; until: number }>();
const inFlight = new Map<number, Promise<string | null>>();

function teacherPhotoUrl(userId: number): Promise<string | null> {
  const cached = photoCache.get(userId);
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.url);
  const pending = inFlight.get(userId);
  if (pending) return pending;
  const request = apiGet<{ url: string }>(`/profiles/${userId}/photo`)
    .then(({ url }) => {
      photoCache.set(userId, { url, until: Date.now() + 8 * 60_000 });
      return url;
    })
    .catch(() => {
      photoCache.set(userId, { url: null, until: Date.now() + 5 * 60_000 });
      return null;
    })
    .finally(() => { inFlight.delete(userId); });
  inFlight.set(userId, request);
  return request;
}

/**
 * R2 remains private. Callers receive a short-lived signed image URL with their normal
 * profile/directory response, so rendering a list adds no photo-metadata requests. If an
 * already-open page outlives that URL, retry exactly once; initials remain underneath.
 */
export function ProfilePhoto({ uri, userId, self = false, loadIfMissing = false }: {
  uri?: string | null;
  userId?: number;
  self?: boolean;
  loadIfMissing?: boolean;
}) {
  const [currentUri, setCurrentUri] = useState(uri ?? null);
  const retried = useRef(false);

  useEffect(() => {
    setCurrentUri(uri ?? null);
    retried.current = false;
  }, [uri]);

  useEffect(() => {
    if (uri || !loadIfMissing || !userId || self) return;
    let mounted = true;
    void teacherPhotoUrl(userId).then((url) => { if (mounted) setCurrentUri(url); });
    return () => { mounted = false; };
  }, [uri, loadIfMissing, userId, self]);

  if (!currentUri) return null;

  return (
    <Image
      testID="profile-photo"
      source={{ uri: currentUri }}
      resizeMode="cover"
      style={styles.photo}
      onError={() => {
        setCurrentUri(null);
        if (retried.current || (!self && !userId)) return;
        retried.current = true;
        const path = self ? "/onboarding/me/profile-photo/view" : `/profiles/${userId}/photo`;
        void apiGet<{ url: string }>(path)
          .then((answer) => { if (answer.url && answer.url !== currentUri) setCurrentUri(answer.url); })
          .catch(() => { /* Keep the person's initials; never spin on a broken image. */ });
      }}
    />
  );
}

const styles = StyleSheet.create({
  photo: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%", borderRadius: 999 },
});
