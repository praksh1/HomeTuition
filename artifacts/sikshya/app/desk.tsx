import { router } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

/**
 * The door a customer-care agent bookmarks.
 *
 * The owner asked whether agents should sign in from a corner of the app or from a page of
 * their own. Neither, quite — and this is the honest answer to both.
 *
 * A link in the corner of every screen would advertise the support desk to everybody who uses
 * the app, which is the one place it should not be advertised. A separate login page would
 * mean a second set of passwords for the same people, and two password systems is how one of
 * them ends up unmaintained.
 *
 * So: agents sign in at the same form as everybody else, with their own account, and the app
 * knows from their role where to send them. What was missing was somewhere to *point* them —
 * an address to put in a bookmark or hand to somebody starting on Monday. That is this. It
 * holds no login of its own; it decides where you should be and sends you.
 *
 * None of this is a control. Every route under /admin re-reads the caller's role from the
 * database on every request, so an app that showed these screens to the wrong person would
 * show them nothing. This is signposting.
 */
export default function DeskEntry() {
  const { user, isLoading } = useAuth();
  const colors = useColors();

  /**
   * An agent, or somebody signed out, is sent on by the guard in app/_layout.tsx — which is
   * already watching every screen for exactly this. Redirecting from here as well raced it,
   * and the two of them landed the agent on the marketing page instead of the desk.
   *
   * So this screen only decides one thing: whether to explain itself. Everything else is
   * somebody else's job, done once.
   */
  if (isLoading || !user || user.role === "admin") {
    return (
      <View style={[styles.centre, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.secondary} />
      </View>
    );
  }

  /**
   * Signed in, but not as an agent.
   *
   * Said plainly rather than by silently bouncing them somewhere else. Somebody who typed this
   * address meant to go here, and a redirect with no explanation reads as the app being broken.
   */
  return (
    <View style={[styles.centre, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>Support desk</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        This is for Sikshya's customer-care agents. You are signed in as a{" "}
        {user.role === "teacher" ? "teacher" : "student"}, so there is nothing for you here.
      </Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        If you need help with a class or a payment, report it from Support — you can follow the
        answer under My Requests.
      </Text>
      <TouchableOpacity
        testID="desk-support-btn"
        activeOpacity={0.85}
        onPress={() => router.replace("/support")}
        style={[styles.btn, { backgroundColor: colors.secondary }]}
      >
        <Text style={styles.btnText}>Go to Support</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 20 },
  body: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 340 },
  btn: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 24, marginTop: 8 },
  btnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" },
});
