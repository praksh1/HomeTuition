import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { confirm, notify } from "@/utils/alerts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { useAuth } from "@/context/AuthContext";
import { apiGet, apiPost, apiDelete } from "@/utils/api";
import StarRating from "@/components/StarRating";
import SessionCard from "@/components/SessionCard";
import PaymentSheet, { type PaymentMethod } from "@/components/PaymentSheet";
import { TEST_BOOKING_LABEL } from "@/utils/testAccess";
import type { Teacher, Student } from "@/context/AuthContext";

interface Session {
  id: string;
  teacherId: string;
  teacherName: string;
  subject: string;
  topic: string;
  date: string;
  duration: number;
  maxStudents: number;
  enrolledStudents: string[];
  price: number;
  status: "upcoming" | "live" | "completed" | "cancelled";
}

/** Server's verdict on whether this student may enter a given session. */
interface SessionAccess {
  canJoin: boolean;
  isTeacher: boolean;
  isEnrolled: boolean;
  hasPaid: boolean;
  status?: string;
  /** Paid and inside the early-join window, but the teacher has not started yet. */
  awaitingTeacher?: boolean;
  /**
   * The server says this signed-in person may take a place in this class without paying.
   *
   * All three gates, checked server-side against the authenticated user: the kill switch is on,
   * they hold a live operator grant, and this class was marked a test class when it was created.
   * Never derived here — a client that decided this for itself would be a client that could
   * decide to skip payment.
   *
   * It only controls whether a payment sheet is opened. `POST /sessions/:id/book` re-derives all
   * three inside its own transaction and is the only thing that actually decides.
   */
  canBookAsTest?: boolean;
  joinOpensAt?: string | null;
  /**
   * Whether the server actually answered.
   *
   * Absent means yes. False means the check failed, and the difference matters: "we could not
   * ask" and "you have not paid" look identical on screen otherwise, and the screen was showing
   * the second one — inviting a student who had already paid to pay a second time.
   */
  known?: boolean;
}

interface ApiReview {
  id: number;
  rating: number;
  comment: string;
  createdAt: string;
  /** True only for the review this reader wrote. Nobody is told whose the others are. */
  mine?: boolean;
}

interface ApiSession {
  id: number;
  teacherName: string;
  subject: string;
  topic: string;
  date: string;
  duration: number;
  maxStudents: number;
  enrolledCount: number;
  price: number;
  status: string;
  /**
   * The class is past its cutoff and will never be held, whatever the `status` column says.
   *
   * `status` stays "upcoming" on a class nobody ever started, so the server computes this from
   * the clock and sends it. On the live site 19 of the 20 "upcoming" classes on this list were
   * days old — students were being invited to pay for lessons that had already come and gone.
   */
  expired?: boolean;
}

function mapApiSession(s: ApiSession, teacherId: string): Session {
  return {
    id: String(s.id),
    teacherId,
    teacherName: s.teacherName,
    subject: s.subject,
    topic: s.topic,
    date: s.date,
    duration: s.duration,
    maxStudents: s.maxStudents,
    enrolledStudents: Array(s.enrolledCount).fill(""),
    price: s.price,
    status: s.status as Session["status"],
  };
}

type SessionTab = "upcoming" | "live" | "past";

export default function TeacherDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { t, numeric, gutter, space, radius, elevation, isExpanded } =
    useLayout();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [teacher, setTeacher] = useState<
    (Teacher & { isFollowing?: boolean }) | null
  >(null);
  const [upcomingSessions, setUpcomingSessions] = useState<Session[]>([]);
  const [liveSessions, setLiveSessions] = useState<Session[]>([]);
  const [pastSessions, setPastSessions] = useState<Session[]>([]);
  const [sessionTab, setSessionTab] = useState<SessionTab>("upcoming");
  const [reviews, setReviews] = useState<ApiReview[]>([]);
  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState("");
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [canRate, setCanRate] = useState(false);
  const [checkingRateEligibility, setCheckingRateEligibility] = useState(true);
  const [bookingSessionId, setBookingSessionId] = useState<string | null>(null);
  const [paySession, setPaySession] = useState<Session | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [subjectsExpanded, setSubjectsExpanded] = useState(false);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [detailsLoadState, setDetailsLoadState] = useState<
    "loading" | "ready" | "failed"
  >("loading");

  const studentId = user?.role === "student" ? (user as Student).id : undefined;

  /**
   * Per-session answer to "may this student actually join?", straight from the server.
   * Without it the screen offered "Join Live Class" to anyone, including students who had
   * never enrolled — the tap then failed, or worse, let them watch a class they had not
   * paid for. It also tells us which upcoming sessions they are already signed up for.
   */
  const [access, setAccess] = useState<Record<string, SessionAccess>>({});

  /**
   * Re-read when the signed-in student becomes known, not only when the route changes.
   *
   * `loadData` skips the whole per-session access block unless `studentId` is set, and on a cold
   * open — a refresh, a shared link — `useAuth` has not restored the session by the time this
   * first runs. It depended on `[id]` alone, so it never ran again: `access` stayed empty for the
   * life of the screen, every upcoming class showed "Book & pay" whatever the server thought, and
   * a student who had already booked was invited to buy it a second time.
   *
   * It surfaced here because a Book button that must not open a payment sheet cannot decide that
   * from a verdict the screen never asked for.
   */
  useEffect(() => {
    loadData();
  }, [id, studentId]);

  /**
   * Look again when the student comes back to this screen, and while a class is live.
   *
   * This page used to read the world once, on mount, and then keep insisting on it. So a
   * student who opened a teacher's profile, watched the teacher start the class, and looked
   * back was still told to "Book & Pay to join" — the owner hit exactly that, joined from the
   * Sessions tab instead, came back here and found it stale again.
   *
   * Two triggers, because they catch different things: coming back to the tab catches a booking
   * made elsewhere, and the interval catches a teacher starting the class while the student is
   * sitting on this page. Only while something is live, so a profile left open on a quiet day
   * costs nothing.
   */
  useFocusEffect(
    useCallback(() => {
      loadData();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, studentId]),
  );

  useEffect(() => {
    if (liveSessions.length === 0) return;
    const timer = setInterval(loadData, 20000);
    return () => clearInterval(timer);
  }, [liveSessions.length, id]);

  const loadData = async () => {
    // The route param `id` is the teacher's *profile* id; the reviews and sessions APIs key on
    // the teacher's *user* id. Kept here so the eligibility check below uses the same id the
    // review is later submitted with — they disagreed, so the rating box appeared for teachers
    // the student had never studied with (and stayed hidden for ones they had).
    let teacherUserId: number | null = null;
    let profileLoaded = false;
    try {
      // No `?studentId=` any more. The server answers "do you follow this teacher" from the
      // token, because the id this screen holds is the student's *profile* row and the follow
      // table keys on their *users* row — so the two only ever matched by coincidence.
      const apiTeacher = await apiGet<
        Teacher & { userId: number; isFollowing?: boolean }
      >(`/teachers/${id}`);
      profileLoaded = true;
      teacherUserId = apiTeacher.userId;
      setProfileLoadFailed(false);
      setTeacher({ ...apiTeacher, id: String(apiTeacher.id), credentials: [] });

      const [upcomingRes, liveRes, pastRes, revRes] = await Promise.all([
        apiGet<{ sessions: ApiSession[] }>(
          `/sessions?teacherId=${apiTeacher.userId}&status=upcoming`,
        ),
        apiGet<{ sessions: ApiSession[] }>(
          `/sessions?teacherId=${apiTeacher.userId}&status=live`,
        ),
        apiGet<{ sessions: ApiSession[] }>(
          `/sessions?teacherId=${apiTeacher.userId}&status=completed`,
        ),
        apiGet<{ reviews: ApiReview[] }>(`/teachers/${id}/reviews?limit=10`),
      ]);

      /**
       * A class whose moment has passed belongs in the past list, not on sale.
       *
       * `status=upcoming` filters on the status column, and that column still reads "upcoming"
       * for every class nobody got round to starting. The server tells us which ones are really
       * over; this is the screen finally reading it.
       */
      const stillToCome = upcomingRes.sessions.filter((s) => !s.expired);
      const goneBy = upcomingRes.sessions.filter((s) => s.expired);

      setUpcomingSessions(
        stillToCome.map((s) => mapApiSession(s, String(apiTeacher.id))),
      );
      setLiveSessions(
        liveRes.sessions.map((s) => mapApiSession(s, String(apiTeacher.id))),
      );
      // Shown under Past, where they belong, rather than vanishing — a student who booked one
      // still needs to see that it existed.
      setPastSessions(
        [...goneBy, ...pastRes.sessions].map((s) =>
          mapApiSession(s, String(apiTeacher.id)),
        ),
      );
      setReviews(revRes.reviews);
      setDetailsLoadState("ready");

      if (studentId) {
        const joinable = [...liveRes.sessions, ...stillToCome];
        const entries = await Promise.all(
          joinable.map(async (s) => {
            try {
              return [
                String(s.id),
                await apiGet<SessionAccess>(`/sessions/${s.id}/access`),
              ] as const;
            } catch {
              /*
               * We do not know, and must not guess.
               *
               * This used to answer "not enrolled", which reads on screen as "Book & Pay" — so
               * one failed request told a student who had already paid to pay again. `known:
               * false` keeps the question open and the screen says so instead.
               */
              return [
                String(s.id),
                {
                  canJoin: false,
                  isTeacher: false,
                  isEnrolled: false,
                  hasPaid: false,
                  known: false,
                },
              ] as const;
            }
          }),
        );
        setAccess(Object.fromEntries(entries));
      }

      if (liveRes.sessions.length > 0) setSessionTab("live");
    } catch (_e) {
      // A failed profile request is not an empty profile, and a failed details request is not
      // "no classes" or "no reviews". Keep those pictures distinct so a poor connection does
      // not rewrite the teacher's public record as zero.
      if (!profileLoaded && !teacher) setProfileLoadFailed(true);
      if (profileLoaded) setDetailsLoadState("failed");
    }

    if (studentId && teacherUserId != null) {
      try {
        const rateRes = await apiGet<{ canRate: boolean }>(
          `/reviews/can-rate?teacherId=${teacherUserId}`,
        );
        setCanRate(rateRes.canRate);
      } catch (_e) {
        setCanRate(false);
      } finally {
        setCheckingRateEligibility(false);
      }
    } else {
      setCheckingRateEligibility(false);
    }
  };

  const bookSession = (session: Session) => {
    if (bookingSessionId) return;
    /**
     * A payment sheet is opened only when there is a payment.
     *
     * The server had been bypassing the gateway *behind* the sheet: the student chose eSewa or
     * Khalti, typed a phone number and a PIN, watched a confirmation — and no payment was ever
     * attempted. A ritual for a transaction that does not happen is not a smaller lie than the
     * banner was, and the walkthrough handed to the owner said no payment screen would appear.
     *
     * The verdict is the server's, taken from `/access`. If it is stale or wrong the booking
     * endpoint refuses independently, so the worst case is a refusal rather than a free class.
     */
    if (access[session.id]?.canBookAsTest) {
      void confirmBooking(session, null);
      return;
    }
    setPaySession(session);
  };

  /**
   * Re-asks the server whether this student may now join a session.
   *
   * Booking used to leave this state untouched, so the card kept showing "Book & Pay" for a
   * class the student had just paid for — and tapping it offered to sell it to them again. The
   * server is the only thing that knows the truth, so we ask it rather than guessing locally.
   */
  const refreshAccess = async (sessionId: string | number) => {
    try {
      const a = await apiGet<SessionAccess>(`/sessions/${sessionId}/access`);
      setAccess((prev) => ({ ...prev, [String(sessionId)]: a }));
    } catch {
      // Leave the previous verdict in place; a failed refresh should not downgrade a booking
      // the server already accepted.
    }
  };

  /**
   * Take the booking, and let a failure reach the payment sheet.
   *
   * The sheet used to be closed on the way in and told nothing afterwards, so it announced
   * "Payment Successful" and this then popped a separate "Booking failed" over the top of it.
   * It stays open now and this rethrows, so one screen tells the truth instead of two
   * contradicting each other.
   */
  const confirmBooking = async (
    session: Session,
    /**
     * `null` when no payment sheet was opened, because the server said this booking bypasses the
     * gateway. Nothing is sent in that case — no method, no phone number, no PIN — so there are
     * no payment credentials to leak into a request that will never reach a provider.
     */
    paymentMethod: PaymentMethod | null,
  ) => {
    if (bookingSessionId === session.id) return;
    setBookingSessionId(session.id);
    try {
      // One call. It either comes back booked and paid, or nothing was created and we say so.
      // The old flow enrolled first and paid second, which is why students ended up holding
      // classes marked "payment pending" that they could never get into.
      const res = await apiPost<{
        paid?: boolean;
        alreadyBooked?: boolean;
        /** The server's own word for it: *this booking* took no payment. utils/testAccess.ts. */
        testBooking?: boolean;
        testBookingLabel?: string;
      }>(
        `/sessions/${session.id}/book`,
        paymentMethod ? { paymentMethod } : {},
      );
      await refreshAccess(session.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      setPaySession(null);
      if (res?.alreadyBooked) {
        notify(
          "Already booked",
          res.testBooking
            // Saying "you have already paid" about a place nobody was charged for is the same
            // untruth the label exists to prevent, said at the one moment somebody is thinking
            // about money.
            ? `You already have a place in this class. ${res.testBookingLabel ?? TEST_BOOKING_LABEL}. ` +
              "Check your Sessions tab to join."
            : "You have already paid for this session. Check your Sessions tab to join.",
        );
        return;
      }

      if (res?.testBooking) {
        // No payment sheet was involved and no method was charged, so the confirmation must not
        // name one. "Paid with eSewa. You're in." after a booking that charged nobody is exactly
        // the sentence a teacher or student would later quote back as evidence they had paid.
        if (
          await confirm(
            "You're in — no payment was taken",
            `${res.testBookingLabel ?? TEST_BOOKING_LABEL}.\n\n` +
              "This is a test class, so nothing was charged. You can join from your Sessions " +
              "tab — the class opens a few minutes before it starts.",
            "View My Sessions",
          )
        ) {
          router.push("/(student)/sessions");
        }
        return;
      }
      if (
        await confirm(
          "Booked!",
          `Paid with ${paymentMethod === "esewa" ? "eSewa" : "Khalti"}. You're in.

You can join from your Sessions tab — the class opens a few minutes before it starts.`,
          "View My Sessions",
        )
      ) {
        router.push("/(student)/sessions");
      }
    } catch (e: unknown) {
      // The attempt may have raced with another device; re-sync rather than assume.
      await refreshAccess(session.id);
      // Rethrown so the payment sheet shows this instead of a success it has not earned.
      // Nothing was charged and nothing was booked, which is what the sheet says.
      const msg =
        e instanceof Error
          ? e.message
          : "That did not go through. Please try again.";
      // "Nothing has been charged" is reassurance about a charge that was going to happen. Where
      // none was, it implies one was attempted and raises a question rather than settling it.
      if (!paymentMethod) {
        notify("That did not go through", msg);
        return;
      }
      throw new Error(`${msg} Nothing has been charged.`);
    } finally {
      setBookingSessionId(null);
    }
  };

  const openLiveSession = (session: Session) => {
    // Only genuinely active classes are routable; anything else is a no-op tap.
    if (session.status !== "live") return;
    const a = access[session.id];
    /*
     * Never send somebody to pay on the strength of a check that failed, or one they already
     * passed. The owner tapped "Join Live Session" here on a class they had paid for and got
     * "Setting up video room" spinning forever; the honest answers are "go in" or "we do not
     * know yet", and only a genuine not-enrolled leads to the payment sheet.
     */
    if (a?.canJoin) {
      router.push(`/(student)/classroom/${session.id}`);
      return;
    }
    if (a?.known === false || a?.isEnrolled) {
      // Ask again rather than guess; the answer usually arrives before they tap twice.
      void loadData();
      return;
    }
    bookSession(session);
  };

  const submitRating = async () => {
    if (myRating === 0 || !teacher || !canRate) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await apiPost("/reviews", {
        teacherId: (teacher as Teacher & { userId: number }).userId,
        rating: myRating,
        // What the student actually wrote. This used to send an invented sentence — every
        // review in the database read "Great teacher! Rated 4 stars." in a real student's
        // name, whatever they thought — which made the whole list worthless to read.
        comment: myComment.trim(),
      });
      setRatingSubmitted(true);
      notify(
        "Thank you!",
        `You rated ${teacher.name} ${myRating} star${myRating !== 1 ? "s" : ""}.`,
      );
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : "You can only rate teachers after attending a completed session.";
      notify("Can't Submit Rating", msg);
    }
  };

  const toggleSubscribe = async () => {
    if (!teacher || subscribing) return;
    setSubscribing(true);
    const nowFollowing = !teacher.isFollowing;
    try {
      if (nowFollowing) {
        await apiPost(`/teachers/${teacher.id}/follow`, {});
      } else {
        await apiDelete(`/teachers/${teacher.id}/follow`);
      }
      setTeacher({ ...teacher, isFollowing: nowFollowing });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (_e) {
      notify("Something went wrong", "Please try again.");
    } finally {
      setSubscribing(false);
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(student)");
  };

  if (!teacher) {
    return (
      <View
        style={[
          styles.loadScreen,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top + space.md,
            paddingBottom: insets.bottom + space.md,
            paddingHorizontal: gutter,
            gap: space.xl,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.loadBack,
            { borderColor: colors.border, borderRadius: radius.sm },
          ]}
          onPress={goBack}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back to Discover"
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>

        {profileLoadFailed ? (
          <View style={[styles.loadCard, { gap: space.md }]}>
            <View
              style={[
                styles.loadIcon,
                {
                  backgroundColor: colors.destructiveSoft,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <Feather name="wifi-off" size={24} color={colors.destructive} />
            </View>
            <Text
              style={[
                t.title2,
                { color: colors.foreground, textAlign: "center" },
              ]}
            >
              Couldn&apos;t load this teacher
            </Text>
            <Text
              style={[
                t.body,
                { color: colors.mutedForeground, textAlign: "center" },
              ]}
            >
              Your connection may have dropped. Nothing on the teacher&apos;s
              profile has been changed.
            </Text>
            <TouchableOpacity
              style={[
                styles.loadRetry,
                { backgroundColor: colors.primary, borderRadius: radius.sm },
              ]}
              onPress={() => {
                setProfileLoadFailed(false);
                void loadData();
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>
                Try again
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.loadCard, { gap: space.md }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[t.body, { color: colors.mutedForeground }]}>
              Loading teacher profile…
            </Text>
          </View>
        )}
      </View>
    );
  }

  const initials = teacher.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const activeSessions =
    sessionTab === "upcoming"
      ? upcomingSessions
      : sessionTab === "live"
        ? liveSessions
        : pastSessions;
  const visibleSubjects = subjectsExpanded
    ? teacher.subjects
    : teacher.subjects.slice(0, 4);
  const hasMoreSubjects = teacher.subjects.length > 4;
  const isRated = teacher.reviewCount > 0;
  const onNavy = { color: colors.onInverse };
  const onNavyMuted = { color: colors.onInverseMuted };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: insets.bottom + space.xxxl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient
        colors={[colors.secondary, colors.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.hero,
          {
            paddingTop: insets.top + space.md,
            paddingHorizontal: gutter,
            paddingBottom: space.xxl,
            gap: space.sm,
          },
        ]}
      >
        <View style={styles.heroTopRow}>
          <TouchableOpacity
            style={[
              styles.backBtn,
              { borderColor: colors.onInverseMuted, borderRadius: radius.sm },
            ]}
            onPress={goBack}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Back to Discover"
          >
            <Feather name="arrow-left" size={20} color={colors.onInverse} />
          </TouchableOpacity>
          <View style={[styles.heroTopActions, { gap: space.xs }]}>
            {studentId && (
              <TouchableOpacity
                style={[
                  styles.heroAction,
                  {
                    borderColor: colors.onInverseMuted,
                    borderRadius: radius.pill,
                    paddingHorizontal: space.sm,
                    gap: space.xxs,
                  },
                ]}
                onPress={() =>
                  router.push({
                    pathname: "/conversation/[id]",
                    params: {
                      id: String(
                        (teacher as Teacher & { userId: number }).userId,
                      ),
                      name: teacher.name,
                    },
                  })
                }
                activeOpacity={0.8}
                testID="contact-teacher-btn"
                accessibilityRole="button"
              >
                <Feather
                  name="message-circle"
                  size={14}
                  color={colors.onInverse}
                />
                <Text style={[t.caption, onNavy]}>Message</Text>
              </TouchableOpacity>
            )}
            {studentId && (
              <TouchableOpacity
                style={[
                  styles.heroAction,
                  {
                    borderColor: colors.onInverseMuted,
                    borderRadius: radius.pill,
                    paddingHorizontal: space.sm,
                    gap: space.xxs,
                  },
                ]}
                onPress={toggleSubscribe}
                disabled={subscribing}
                activeOpacity={0.8}
                testID="subscribe-follow-btn"
                accessibilityRole="button"
                accessibilityLabel={
                  teacher.isFollowing
                    ? `Unfollow ${teacher.name}`
                    : `Follow ${teacher.name} for updates`
                }
              >
                <Feather
                  name={teacher.isFollowing ? "check" : "plus"}
                  size={14}
                  color={colors.onInverse}
                />
                {/*
                  This is a free follow, not either paid subscription product. Calling it
                  "Subscribe" on the screen where students pay blurred that distinction at the
                  exact moment it matters.
                */}
                <Text style={[t.caption, onNavy]}>
                  {subscribing
                    ? "Saving…"
                    : teacher.isFollowing
                      ? "Following"
                      : "Follow"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <View
          style={[
            styles.heroAvatar,
            { backgroundColor: colors.actionSoft, borderRadius: radius.pill },
          ]}
        >
          <Text style={[t.display, { color: colors.primary }]}>{initials}</Text>
        </View>
        <Text style={[t.title1, onNavy, { textAlign: "center" }]}>
          {teacher.name}
        </Text>
        <View
          style={[
            styles.heroSubjectTag,
            {
              backgroundColor: colors.card,
              borderRadius: radius.pill,
              paddingHorizontal: space.md,
              paddingVertical: space.xxs,
            },
          ]}
        >
          <Text style={[t.overline, { color: colors.secondary }]}>
            {teacher.subject}
          </Text>
        </View>
        {isRated ? (
          <View style={[styles.heroRating, { gap: space.xs }]}>
            <StarRating
              rating={teacher.rating}
              size={18}
              color={colors.accent}
            />
            <Text style={[t.callout, numeric, onNavy]}>
              {teacher.rating.toFixed(1)} · {teacher.reviewCount}{" "}
              {teacher.reviewCount === 1 ? "review" : "reviews"}
            </Text>
          </View>
        ) : (
          <Text style={[t.callout, onNavyMuted]}>Not yet reviewed</Text>
        )}

        <View style={[styles.heroStats, { paddingTop: space.xs }]}>
          <View style={styles.heroStat}>
            <Text style={[t.title2, numeric, onNavy]}>
              {teacher.totalStudents}
            </Text>
            <Text style={[t.caption, onNavyMuted]}>Paid bookings</Text>
          </View>
          <View
            style={[
              styles.heroStatDivider,
              { backgroundColor: colors.onInverseMuted },
            ]}
          />
          <View style={styles.heroStat}>
            {teacher.experienceYears != null ? (
              <Text style={[t.title2, numeric, onNavy]}>
                {teacher.experienceYears}
              </Text>
            ) : (
              <Text style={[t.title2, onNavyMuted]}>—</Text>
            )}
            <Text style={[t.caption, onNavyMuted]}>Years teaching</Text>
          </View>
          <View
            style={[
              styles.heroStatDivider,
              { backgroundColor: colors.onInverseMuted },
            ]}
          />
          <View style={styles.heroStat}>
            <Text style={[t.title2, numeric, onNavy]}>
              {teacher.subjects.length}
            </Text>
            <Text style={[t.caption, onNavyMuted]}>
              {teacher.subjects.length === 1 ? "Subject" : "Subjects"}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <View
        style={[
          styles.body,
          {
            paddingHorizontal: gutter,
            paddingTop: space.xl,
            gap: space.xl,
          },
        ]}
      >
        <View
          style={{
            flexDirection: isExpanded ? "row" : "column",
            alignItems: "flex-start",
            gap: space.lg,
          }}
        >
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: space.md,
                gap: space.sm,
                width: isExpanded ? 320 : "100%",
              },
              elevation.card,
            ]}
          >
            <Text style={[t.title3, { color: colors.foreground }]}>About</Text>
            <Text style={[t.body, { color: colors.mutedForeground }]}>
              {teacher.bio?.trim() || "No introduction provided yet."}
            </Text>

            <View style={[styles.expandableHeader, { marginTop: space.xxs }]}>
              <Text
                style={[t.bodyStrong, numeric, { color: colors.foreground }]}
              >
                Subjects taught ({teacher.subjects.length})
              </Text>
              {hasMoreSubjects && (
                <TouchableOpacity
                  onPress={() => setSubjectsExpanded((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Text style={[t.caption, { color: colors.primary }]}>
                    {subjectsExpanded ? "Show less" : "Show all"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={[styles.tagRow, { gap: space.xs }]}>
              {visibleSubjects.map((s) => (
                <View
                  key={s}
                  style={[
                    styles.tag,
                    {
                      backgroundColor: colors.actionSoft,
                      borderRadius: radius.pill,
                      paddingHorizontal: space.sm,
                      paddingVertical: space.xxs,
                    },
                  ]}
                >
                  <Text style={[t.caption, { color: colors.primary }]}>
                    {s}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={{ flex: 1, width: "100%" }}>
            <Text style={[t.title2, { color: colors.foreground }]}>
              Book a class
            </Text>
            <Text
              style={[
                t.callout,
                {
                  color: colors.mutedForeground,
                  marginTop: space.xxs,
                  marginBottom: space.sm,
                },
              ]}
            >
              These are pay-per-class bookings. Each price covers one scheduled
              class; monthly courses are a separate product.
            </Text>

            {detailsLoadState === "loading" && (
              <View
                style={[
                  styles.detailsState,
                  {
                    backgroundColor: colors.muted,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    gap: space.sm,
                    padding: space.md,
                  },
                ]}
              >
                <ActivityIndicator color={colors.primary} />
                <Text style={[t.callout, { color: colors.mutedForeground }]}>
                  Loading classes and reviews…
                </Text>
              </View>
            )}

            {detailsLoadState === "failed" && (
              <View
                style={[
                  styles.detailsState,
                  {
                    backgroundColor: colors.destructiveSoft,
                    borderColor: colors.destructive,
                    borderRadius: radius.md,
                    gap: space.sm,
                    marginBottom: space.md,
                    padding: space.md,
                  },
                ]}
              >
                <Feather name="wifi-off" size={18} color={colors.destructive} />
                <View style={{ flex: 1 }}>
                  <Text style={[t.bodyStrong, { color: colors.destructive }]}>
                    Couldn&apos;t refresh classes and reviews
                  </Text>
                  <Text style={[t.callout, { color: colors.mutedForeground }]}>
                    Existing information stays visible; an empty list is not
                    being treated as a real zero.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => void loadData()}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                >
                  <Text style={[t.bodyStrong, { color: colors.primary }]}>
                    Retry
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {detailsLoadState !== "loading" && (
              <View
                style={[
                  styles.tabRow,
                  { gap: space.xs, marginBottom: space.sm },
                ]}
              >
                {(
                  [
                    { key: "upcoming", label: "Upcoming" },
                    {
                      key: "live",
                      label: `Live${liveSessions.length > 0 ? ` (${liveSessions.length})` : ""}`,
                    },
                    { key: "past", label: "Past" },
                  ] as { key: SessionTab; label: string }[]
                ).map((tab) => {
                  const active = sessionTab === tab.key;
                  return (
                    <TouchableOpacity
                      key={tab.key}
                      style={[
                        styles.tabBtn,
                        {
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active
                            ? colors.actionSoft
                            : colors.muted,
                          borderRadius: radius.pill,
                          paddingHorizontal: space.sm,
                        },
                      ]}
                      onPress={() => setSessionTab(tab.key)}
                      activeOpacity={0.7}
                      testID={`session-tab-${tab.key}`}
                    >
                      {tab.key === "live" && liveSessions.length > 0 && (
                        <View
                          style={[
                            styles.liveDot,
                            { backgroundColor: colors.brand },
                          ]}
                        />
                      )}
                      <Text
                        style={[
                          t.caption,
                          {
                            color: active
                              ? colors.primary
                              : colors.mutedForeground,
                          },
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {detailsLoadState === "ready" && activeSessions.length === 0 && (
              <View
                style={[
                  styles.noSessions,
                  {
                    backgroundColor: colors.muted,
                    borderRadius: radius.md,
                    padding: space.lg,
                    gap: space.sm,
                  },
                ]}
              >
                <Feather
                  name="calendar"
                  size={24}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[
                    t.callout,
                    { color: colors.mutedForeground, flex: 1 },
                  ]}
                >
                  {sessionTab === "upcoming" &&
                    "No upcoming sessions. Check back soon."}
                  {sessionTab === "live" && "No active class right now."}
                  {sessionTab === "past" && "No past sessions yet."}
                </Text>
              </View>
            )}

            {sessionTab === "upcoming" &&
              activeSessions.map((s) => {
                const a = access[s.id];
                // Already signed up: say so, rather than inviting them to pay a second time.
                if (a?.isEnrolled) {
                  return (
                    <View key={s.id}>
                      <SessionCard session={s} onPress={() => {}} />
                      <View
                        style={[
                          styles.bookBtnRow,
                          { marginTop: -space.xxs, marginBottom: space.xs },
                        ]}
                      >
                        <View
                          style={[
                            styles.bookBtn,
                            {
                              backgroundColor: colors.successSoft,
                              borderColor: colors.success,
                              borderRadius: radius.sm,
                              gap: space.xs,
                              paddingHorizontal: space.sm,
                            },
                          ]}
                        >
                          <Feather
                            name="check-circle"
                            size={14}
                            color={colors.success}
                          />
                          <Text
                            style={[
                              t.callout,
                              { color: colors.success, textAlign: "center" },
                            ]}
                          >
                            {a.awaitingTeacher
                              ? "Booked — waiting for the teacher to start"
                              : "Booked & paid — opens 5 minutes before it starts"}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                }
                return (
                  <View key={s.id}>
                    <SessionCard session={s} onPress={() => bookSession(s)} />
                    <View
                      style={[
                        styles.bookBtnRow,
                        { marginTop: -space.xxs, marginBottom: space.xs },
                      ]}
                    >
                      <TouchableOpacity
                        style={[
                          styles.bookBtn,
                          {
                            backgroundColor: colors.actionSoft,
                            borderColor: colors.primary,
                            borderRadius: radius.sm,
                            gap: space.xs,
                            paddingHorizontal: space.sm,
                          },
                          bookingSessionId === s.id && { opacity: 0.6 },
                        ]}
                        onPress={() => bookSession(s)}
                        disabled={bookingSessionId === s.id}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        testID={`book-btn-${s.id}`}
                        accessibilityLabel={
                          // The button must not promise a payment that will not be taken, nor a
                          // free place to somebody who will be charged. The verdict is the
                          // server's; only the wording is decided here.
                          a?.canBookAsTest
                            ? `Take a test place in ${s.topic}. No payment will be processed.`
                            : `Book ${s.topic} for NPR ${s.price.toLocaleString()}, one class`
                        }
                      >
                        <Feather
                          name={a?.canBookAsTest ? "check-circle" : "credit-card"}
                          size={14}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            t.bodyStrong,
                            numeric,
                            { color: colors.primary, textAlign: "center" },
                          ]}
                        >
                          {bookingSessionId === s.id
                            ? "Booking…"
                            : a?.canBookAsTest
                              ? "Take a test place — no payment"
                              : `Book & pay NPR ${s.price.toLocaleString()} for this class`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}

            {sessionTab === "live" &&
              activeSessions.map((s) => {
                // "Join Live Class" is only offered when the server says it would be honoured.
                // Anyone else is shown the way in — enrolling — instead of a button that leads
                // to a locked door.
                const a = access[s.id];
                const canJoin = !!a?.canJoin;
                // We asked and could not get an answer. Saying "Book & Pay" here is a lie to
                // anybody who already has, so the screen admits it instead.
                const unknown = a?.known === false;
                return (
                  <View key={s.id}>
                    <SessionCard
                      session={s}
                      onPress={() => openLiveSession(s)}
                    />
                    <View
                      style={[
                        styles.bookBtnRow,
                        { marginTop: -space.xxs, marginBottom: space.xs },
                      ]}
                    >
                      {canJoin ? (
                        <TouchableOpacity
                          style={[
                            styles.bookBtn,
                            {
                              backgroundColor: colors.primary,
                              borderColor: colors.primary,
                              borderRadius: radius.sm,
                              gap: space.xs,
                            },
                          ]}
                          onPress={() => openLiveSession(s)}
                          activeOpacity={0.85}
                          accessibilityRole="button"
                        >
                          <View
                            style={[
                              styles.liveDot,
                              { backgroundColor: colors.brandForeground },
                            ]}
                          />
                          <Text
                            style={[
                              t.bodyStrong,
                              { color: colors.primaryForeground },
                            ]}
                          >
                            Join live class
                          </Text>
                        </TouchableOpacity>
                      ) : unknown ? (
                        <View
                          style={[
                            styles.bookBtn,
                            {
                              backgroundColor: colors.muted,
                              borderColor: colors.border,
                              borderRadius: radius.sm,
                              gap: space.xs,
                            },
                          ]}
                        >
                          <Feather
                            name="wifi-off"
                            size={14}
                            color={colors.mutedForeground}
                          />
                          <Text
                            style={[
                              t.callout,
                              {
                                color: colors.mutedForeground,
                                textAlign: "center",
                              },
                            ]}
                          >
                            Could not check — open Sessions to join
                          </Text>
                        </View>
                      ) : a?.isEnrolled ? (
                        // Paid, and the class is live, but the door is not open to them yet.
                        // Offering payment again would be the same lie in a different place.
                        <View
                          style={[
                            styles.bookBtn,
                            {
                              backgroundColor: colors.successSoft,
                              borderColor: colors.success,
                              borderRadius: radius.sm,
                              gap: space.xs,
                            },
                          ]}
                        >
                          <Feather
                            name="check-circle"
                            size={14}
                            color={colors.success}
                          />
                          <Text style={[t.callout, { color: colors.success }]}>
                            Booked & paid — opening shortly
                          </Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[
                            styles.bookBtn,
                            {
                              backgroundColor: colors.actionSoft,
                              borderColor: colors.primary,
                              borderRadius: radius.sm,
                              gap: space.xs,
                              paddingHorizontal: space.sm,
                            },
                          ]}
                          onPress={() => bookSession(s)}
                          activeOpacity={0.85}
                          disabled={bookingSessionId === s.id}
                          accessibilityRole="button"
                          testID={`book-btn-${s.id}`}
                          // The same rule as the upcoming tab: never promise a payment that will
                          // not be taken, nor a free place to somebody who will be charged.
                          accessibilityLabel={
                            a?.canBookAsTest
                              ? `Take a test place in ${s.topic}. No payment will be processed.`
                              : `Book ${s.topic} for NPR ${s.price.toLocaleString()}, one live class`
                          }
                        >
                          <Feather
                            name={a?.canBookAsTest ? "check-circle" : "credit-card"}
                            size={14}
                            color={colors.primary}
                          />
                          <Text
                            style={[
                              t.bodyStrong,
                              numeric,
                              { color: colors.primary, textAlign: "center" },
                            ]}
                          >
                            {a?.canBookAsTest
                              ? "Take a test place — no payment"
                              : `Book & pay NPR ${s.price.toLocaleString()} for this live class`}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}

            {sessionTab === "past" &&
              activeSessions.map((s) => (
                <SessionCard key={s.id} session={s} onPress={() => {}} />
              ))}
          </View>
        </View>

        {studentId &&
          (!checkingRateEligibility && !ratingSubmitted && canRate ? (
            <View
              style={[
                styles.rateCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  padding: space.md,
                  gap: space.sm,
                },
                elevation.card,
              ]}
            >
              <Text style={[t.title3, { color: colors.foreground }]}>
                Rate this teacher
              </Text>
              <Text
                style={[
                  t.callout,
                  { color: colors.mutedForeground, textAlign: "center" },
                ]}
              >
                Your feedback helps other students choose the right teacher.
              </Text>
              <View style={{ paddingVertical: space.xs }}>
                <StarRating
                  rating={myRating}
                  size={36}
                  color={colors.accent}
                  interactive
                  onRate={(r) => setMyRating(r)}
                />
              </View>
              {/*
                Optional on purpose. A star with nothing beside it is still a real opinion, and
                demanding a sentence is how the app ended up writing them itself.
              */}
              <TextInput
                testID="review-comment-input"
                style={[
                  t.body,
                  styles.reviewInput,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                    borderRadius: radius.sm,
                    padding: space.sm,
                    marginBottom: space.xs,
                  },
                ]}
                placeholder="Say what the class was like (optional)"
                placeholderTextColor={colors.mutedForeground}
                value={myComment}
                onChangeText={setMyComment}
                multiline
                maxLength={1000}
                textAlignVertical="top"
              />
              <Text
                style={[
                  t.caption,
                  { color: colors.mutedForeground, marginBottom: space.sm },
                ]}
              >
                Your name is never shown with your review.
              </Text>
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  {
                    backgroundColor:
                      myRating > 0 ? colors.actionSoft : colors.muted,
                    borderColor: myRating > 0 ? colors.primary : colors.border,
                    borderRadius: radius.sm,
                    paddingHorizontal: space.xxl,
                  },
                ]}
                onPress={submitRating}
                disabled={myRating === 0}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    t.bodyStrong,
                    {
                      color:
                        myRating > 0 ? colors.primary : colors.mutedForeground,
                    },
                  ]}
                >
                  Submit Rating
                </Text>
              </TouchableOpacity>
            </View>
          ) : ratingSubmitted ? (
            <View
              style={[
                styles.ratingThanks,
                {
                  backgroundColor: colors.successSoft,
                  borderColor: colors.success,
                  borderRadius: radius.md,
                  padding: space.md,
                  gap: space.xs,
                },
              ]}
            >
              <Feather name="check-circle" size={20} color={colors.success} />
              <Text style={[t.bodyStrong, { color: colors.success }]}>
                Rating submitted! Thank you.
              </Text>
            </View>
          ) : !checkingRateEligibility ? (
            <View
              style={[
                styles.rateLocked,
                {
                  backgroundColor: colors.muted,
                  borderRadius: radius.md,
                  padding: space.md,
                  gap: space.xs,
                },
              ]}
            >
              <Feather name="lock" size={16} color={colors.mutedForeground} />
              <Text
                style={[t.callout, { color: colors.mutedForeground, flex: 1 }]}
              >
                You can rate this teacher after attending a completed session
                with them (within the last 15 days).
              </Text>
            </View>
          ) : null)}

        <Text style={[t.title2, { color: colors.foreground }]}>
          Student reviews
        </Text>
        {reviews.map((review) => (
          <View
            key={review.id}
            style={[
              styles.reviewCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: space.md,
                gap: space.xs,
              },
            ]}
          >
            <View style={[styles.reviewHeader, { gap: space.xs }]}>
              <View
                style={[
                  styles.reviewAvatar,
                  {
                    backgroundColor: colors.actionSoft,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Feather name="user" size={14} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                {/*
                  No name, for anybody. The owner asked for reviews to be anonymous to the
                  teacher, and anonymous only on the teacher's own screen is not anonymous —
                  this page is public, and a teacher can read it signed out. The server does not
                  send the name at all; see routes/teachers.ts.
                */}
                <Text style={[t.bodyStrong, { color: colors.foreground }]}>
                  {review.mine ? "Your review" : "A student"}
                </Text>
                <Text style={[t.caption, { color: colors.mutedForeground }]}>
                  {new Date(review.createdAt).toLocaleDateString("en-NP", {
                    month: "short",
                    year: "numeric",
                  })}
                </Text>
              </View>
              <StarRating
                rating={review.rating}
                size={14}
                color={colors.accent}
              />
            </View>
            {review.comment ? (
              <Text
                style={[
                  t.callout,
                  styles.reviewComment,
                  { color: colors.mutedForeground },
                ]}
              >
                "{review.comment}"
              </Text>
            ) : null}
          </View>
        ))}
        {detailsLoadState === "ready" && reviews.length === 0 && (
          <View
            style={[
              styles.noSessions,
              {
                backgroundColor: colors.muted,
                borderRadius: radius.md,
                padding: space.lg,
                gap: space.sm,
              },
            ]}
          >
            <Feather
              name="message-circle"
              size={20}
              color={colors.mutedForeground}
            />
            <Text
              style={[t.callout, { color: colors.mutedForeground, flex: 1 }]}
            >
              No reviews yet. Be the first to rate!
            </Text>
          </View>
        )}
      </View>

      {paySession && (
        <PaymentSheet
          visible
          amount={paySession.price}
          label={`Pay per class · ${paySession.topic}`}
          onClose={() => setPaySession(null)}
          /**
           * The promise is **returned**, not just started.
           *
           * Without the return, the sheet awaited `undefined`, resolved immediately and showed
           * its success screen while the real booking was still in flight — so a class that was
           * full still produced "You're booked", and the rejection became an unhandled promise
           * nobody saw. Caught by a browser test; no server test could have seen it.
           */
          onSuccess={(method) => confirmBooking(paySession, method)}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%" },
  loadScreen: { flex: 1, minHeight: "100%", alignItems: "center" },
  loadBack: {
    alignSelf: "flex-start",
    width: HIT_SLOP_MIN,
    height: HIT_SLOP_MIN,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    alignItems: "center",
  },
  loadCard: {
    flex: 1,
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    justifyContent: "center",
  },
  loadIcon: {
    width: 56,
    height: 56,
    justifyContent: "center",
    alignItems: "center",
  },
  loadRetry: {
    minHeight: HIT_SLOP_MIN,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "stretch",
  },
  hero: { alignItems: "center" },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  backBtn: {
    width: HIT_SLOP_MIN,
    height: HIT_SLOP_MIN,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    alignItems: "center",
  },
  heroTopActions: { flexDirection: "row", alignItems: "center" },
  heroAction: {
    minHeight: HIT_SLOP_MIN,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  heroAvatar: {
    width: 88,
    height: 88,
    justifyContent: "center",
    alignItems: "center",
  },
  heroSubjectTag: { minHeight: 28, justifyContent: "center" },
  heroRating: { flexDirection: "row", alignItems: "center" },
  heroStats: {
    flexDirection: "row",
    width: "100%",
    maxWidth: 560,
    justifyContent: "space-around",
  },
  heroStat: { flex: 1, alignItems: "center" },
  heroStatDivider: { width: StyleSheet.hairlineWidth },
  body: { width: "100%", maxWidth: 960, alignSelf: "center" },
  card: { borderWidth: StyleSheet.hairlineWidth },
  expandableHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tagRow: { flexDirection: "row", flexWrap: "wrap" },
  tag: { minHeight: 28, justifyContent: "center" },
  detailsState: {
    minHeight: 72,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  tabRow: { flexDirection: "row", flexWrap: "wrap" },
  tabBtn: {
    minHeight: HIT_SLOP_MIN,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  noSessions: { flexDirection: "row", alignItems: "center" },
  bookBtnRow: { width: "100%" },
  bookBtn: {
    minHeight: HIT_SLOP_MIN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  rateCard: { borderWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  submitBtn: {
    minHeight: HIT_SLOP_MIN,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    alignItems: "center",
  },
  ratingThanks: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  rateLocked: { flexDirection: "row", alignItems: "center" },
  reviewCard: { borderWidth: StyleSheet.hairlineWidth },
  reviewHeader: { flexDirection: "row", alignItems: "center" },
  reviewAvatar: {
    width: 38,
    height: 38,
    justifyContent: "center",
    alignItems: "center",
  },
  reviewInput: {
    width: "100%",
    minHeight: 84,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reviewComment: { fontStyle: "italic" },
});
