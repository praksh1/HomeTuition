import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { confirm, notify } from "@/utils/alerts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { apiGet, apiPost, apiDelete } from "@/utils/api";
import StarRating from "@/components/StarRating";
import SessionCard from "@/components/SessionCard";
import PaymentSheet, { type PaymentMethod } from "@/components/PaymentSheet";
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
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [teacher, setTeacher] = useState<(Teacher & { isFollowing?: boolean }) | null>(null);
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
  const [sessionsHostedExpanded, setSessionsHostedExpanded] = useState(false);

  const studentId = user?.role === "student" ? (user as Student).id : undefined;

  /**
   * Per-session answer to "may this student actually join?", straight from the server.
   * Without it the screen offered "Join Live Class" to anyone, including students who had
   * never enrolled — the tap then failed, or worse, let them watch a class they had not
   * paid for. It also tells us which upcoming sessions they are already signed up for.
   */
  const [access, setAccess] = useState<Record<string, SessionAccess>>({});

  useEffect(() => {
    loadData();
  }, [id]);

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
    }, [id]),
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
    try {
      // No `?studentId=` any more. The server answers "do you follow this teacher" from the
      // token, because the id this screen holds is the student's *profile* row and the follow
      // table keys on their *users* row — so the two only ever matched by coincidence.
      const apiTeacher = await apiGet<Teacher & { userId: number; isFollowing?: boolean }>(`/teachers/${id}`);
      teacherUserId = apiTeacher.userId;
      setTeacher({ ...apiTeacher, id: String(apiTeacher.id), credentials: [] });

      const [upcomingRes, liveRes, pastRes, revRes] = await Promise.all([
        apiGet<{ sessions: ApiSession[] }>(`/sessions?teacherId=${apiTeacher.userId}&status=upcoming`),
        apiGet<{ sessions: ApiSession[] }>(`/sessions?teacherId=${apiTeacher.userId}&status=live`),
        apiGet<{ sessions: ApiSession[] }>(`/sessions?teacherId=${apiTeacher.userId}&status=completed`),
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

      setUpcomingSessions(stillToCome.map((s) => mapApiSession(s, String(apiTeacher.id))));
      setLiveSessions(liveRes.sessions.map((s) => mapApiSession(s, String(apiTeacher.id))));
      // Shown under Past, where they belong, rather than vanishing — a student who booked one
      // still needs to see that it existed.
      setPastSessions(
        [...goneBy, ...pastRes.sessions].map((s) => mapApiSession(s, String(apiTeacher.id))),
      );
      setReviews(revRes.reviews);

      if (studentId) {
        const joinable = [...liveRes.sessions, ...stillToCome];
        const entries = await Promise.all(
          joinable.map(async (s) => {
            try {
              return [String(s.id), await apiGet<SessionAccess>(`/sessions/${s.id}/access`)] as const;
            } catch {
              /*
               * We do not know, and must not guess.
               *
               * This used to answer "not enrolled", which reads on screen as "Book & Pay" — so
               * one failed request told a student who had already paid to pay again. `known:
               * false` keeps the question open and the screen says so instead.
               */
              return [String(s.id), { canJoin: false, isTeacher: false, isEnrolled: false, hasPaid: false, known: false }] as const;
            }
          }),
        );
        setAccess(Object.fromEntries(entries));
      }

      if (liveRes.sessions.length > 0) setSessionTab("live");
    } catch (_e) {}

    if (studentId && teacherUserId != null) {
      try {
        const rateRes = await apiGet<{ canRate: boolean }>(`/reviews/can-rate?teacherId=${teacherUserId}`);
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
  const confirmBooking = async (session: Session, paymentMethod: PaymentMethod) => {
    if (bookingSessionId === session.id) return;
    setBookingSessionId(session.id);
    try {
      // One call. It either comes back booked and paid, or nothing was created and we say so.
      // The old flow enrolled first and paid second, which is why students ended up holding
      // classes marked "payment pending" that they could never get into.
      const res = await apiPost<{ paid?: boolean; alreadyBooked?: boolean }>(
        `/sessions/${session.id}/book`,
        { paymentMethod },
      );
      await refreshAccess(session.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      setPaySession(null);
      if (res?.alreadyBooked) {
        notify("Already booked", "You have already paid for this session. Check your Sessions tab to join.");
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
      const msg = e instanceof Error ? e.message : "That did not go through. Please try again.";
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
      notify("Thank you!", `You rated ${teacher.name} ${myRating} star${myRating !== 1 ? "s" : ""}.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "You can only rate teachers after attending a completed session.";
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

  if (!teacher) return null;

  const initials = teacher.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  const activeSessions = sessionTab === "upcoming" ? upcomingSessions : sessionTab === "live" ? liveSessions : pastSessions;
  const visibleSubjects = subjectsExpanded ? teacher.subjects : teacher.subjects.slice(0, 4);
  const hasMoreSubjects = teacher.subjects.length > 4;
  const totalHosted = upcomingSessions.length + liveSessions.length + pastSessions.length;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient colors={["#1A365D", "#2D4A7A"]} style={[styles.hero, { paddingTop: insets.top + 16 }]}>
        <View style={styles.heroTopRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.heroTopActions}>
            {studentId && (
              <TouchableOpacity
                style={[styles.contactBtn, { backgroundColor: "rgba(255,255,255,0.18)" }]}
                onPress={() =>
                  router.push({
                    pathname: "/conversation/[id]",
                    params: { id: String((teacher as Teacher & { userId: number }).userId), name: teacher.name },
                  })
                }
                activeOpacity={0.8}
                testID="contact-teacher-btn"
              >
                <Feather name="message-circle" size={14} color="#fff" />
                <Text style={styles.subscribeBtnText}>Message</Text>
              </TouchableOpacity>
            )}
            {studentId && (
              <TouchableOpacity
                style={[
                  styles.subscribeBtn,
                  teacher.isFollowing ? styles.subscribeBtnActive : styles.subscribeBtnInactive,
                ]}
                onPress={toggleSubscribe}
                disabled={subscribing}
                activeOpacity={0.8}
                testID="subscribe-follow-btn"
              >
                <Feather name={teacher.isFollowing ? "check" : "plus"} size={14} color="#fff" />
                <Text style={styles.subscribeBtnText}>{teacher.isFollowing ? "Subscribed" : "Subscribe"}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <View style={styles.heroAvatar}>
          <Text style={styles.heroAvatarText}>{initials}</Text>
        </View>
        <Text style={styles.heroName}>{teacher.name}</Text>
        <View style={[styles.heroSubjectTag, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
          <Text style={styles.heroSubjectText}>{teacher.subject}</Text>
        </View>
        <View style={styles.heroRating}>
          <StarRating rating={teacher.rating} size={18} color="#F5A623" />
          <Text style={styles.heroRatingText}>{teacher.rating.toFixed(1)} ({teacher.reviewCount} reviews)</Text>
        </View>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatNum}>{teacher.totalStudents}</Text>
            <Text style={styles.heroStatLabel}>Students</Text>
          </View>
          <View style={styles.heroStatDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatNum}>{teacher.sessionsThisMonth}</Text>
            <Text style={styles.heroStatLabel}>Sessions/mo</Text>
          </View>
          <View style={styles.heroStatDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatNum}>{teacher.subjects.length}</Text>
            <Text style={styles.heroStatLabel}>Subjects</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.body}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>About</Text>
          <Text style={[styles.bio, { color: colors.mutedForeground }]}>{teacher.bio}</Text>

          <View style={styles.expandableHeader}>
            <Text style={[styles.expandableLabel, { color: colors.foreground }]}>
              Subjects Taught ({teacher.subjects.length})
            </Text>
            {hasMoreSubjects && (
              <TouchableOpacity onPress={() => setSubjectsExpanded((v) => !v)} activeOpacity={0.7}>
                <Text style={[styles.expandToggle, { color: colors.primary }]}>
                  {subjectsExpanded ? "Show less" : "Show all"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.tagRow}>
            {visibleSubjects.map((s) => (
              <View key={s} style={[styles.tag, { backgroundColor: colors.secondary + "12" }]}>
                <Text style={[styles.tagText, { color: colors.secondary }]}>{s}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.expandableHeader}
            onPress={() => setSessionsHostedExpanded((v) => !v)}
            activeOpacity={0.7}
          >
            <Text style={[styles.expandableLabel, { color: colors.foreground }]}>
              Sessions Hosted ({totalHosted})
            </Text>
            <Feather name={sessionsHostedExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
          {sessionsHostedExpanded && (
            <View style={styles.hostedBreakdown}>
              <Text style={[styles.hostedRow, { color: colors.mutedForeground }]}>Upcoming: {upcomingSessions.length}</Text>
              <Text style={[styles.hostedRow, { color: colors.mutedForeground }]}>Live now: {liveSessions.length}</Text>
              <Text style={[styles.hostedRow, { color: colors.mutedForeground }]}>Completed: {pastSessions.length}</Text>
            </View>
          )}
        </View>

        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Sessions</Text>
          <View style={styles.tabRow}>
            {([
              { key: "upcoming", label: "Upcoming" },
              { key: "live", label: `Live${liveSessions.length > 0 ? ` (${liveSessions.length})` : ""}` },
              { key: "past", label: "Past" },
            ] as { key: SessionTab; label: string }[]).map((t) => {
              const active = sessionTab === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  style={[
                    styles.tabBtn,
                    { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + "12" : colors.muted },
                  ]}
                  onPress={() => setSessionTab(t.key)}
                  activeOpacity={0.7}
                  testID={`session-tab-${t.key}`}
                >
                  {t.key === "live" && liveSessions.length > 0 && <View style={styles.liveDot} />}
                  <Text style={[styles.tabBtnText, { color: active ? colors.primary : colors.mutedForeground }]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {activeSessions.length === 0 && (
            <View style={[styles.noSessions, { backgroundColor: colors.muted }]}>
              <Feather name="calendar" size={24} color={colors.mutedForeground} />
              <Text style={[styles.noSessionsText, { color: colors.mutedForeground }]}>
                {sessionTab === "upcoming" && "No upcoming sessions. Check back soon."}
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
                    <View style={styles.bookBtnRow}>
                      <View style={[styles.bookBtn, { backgroundColor: colors.success + "1A", borderWidth: 1, borderColor: colors.success }]}>
                        <Feather name="check-circle" size={14} color={colors.success} />
                        <Text style={[styles.bookBtnText, { color: colors.success }]}>
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
                <TouchableOpacity
                  key={s.id}
                  onPress={() => bookSession(s)}
                  activeOpacity={0.85}
                  disabled={bookingSessionId === s.id}
                >
                  <SessionCard session={s} onPress={() => bookSession(s)} />
                  <View style={styles.bookBtnRow}>
                    <TouchableOpacity
                      style={[styles.bookBtn, { backgroundColor: colors.primary }, bookingSessionId === s.id && { opacity: 0.6 }]}
                      onPress={() => bookSession(s)}
                      disabled={bookingSessionId === s.id}
                      activeOpacity={0.85}
                    >
                      <Feather name="credit-card" size={14} color="#fff" />
                      <Text style={styles.bookBtnText}>
                        {bookingSessionId === s.id ? "Booking..." : `Book & Pay · NPR ${s.price.toLocaleString()}`}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
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
                <TouchableOpacity key={s.id} onPress={() => openLiveSession(s)} activeOpacity={0.85} disabled={bookingSessionId === s.id}>
                  <SessionCard session={s} onPress={() => openLiveSession(s)} />
                  <View style={styles.bookBtnRow}>
                    {canJoin ? (
                      <View style={[styles.bookBtn, { backgroundColor: colors.destructive }]}>
                        <View style={styles.liveDotWhite} />
                        <Text style={styles.bookBtnText}>Join Live Class</Text>
                      </View>
                    ) : unknown ? (
                      <View style={[styles.bookBtn, { backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }]}>
                        <Feather name="wifi-off" size={14} color={colors.mutedForeground} />
                        <Text style={[styles.bookBtnText, { color: colors.mutedForeground }]}>
                          Could not check — open Sessions to join
                        </Text>
                      </View>
                    ) : a?.isEnrolled ? (
                      // Paid, and the class is live, but the door is not open to them yet.
                      // Offering payment again would be the same lie in a different place.
                      <View style={[styles.bookBtn, { backgroundColor: colors.success + "1A", borderWidth: 1, borderColor: colors.success }]}>
                        <Feather name="check-circle" size={14} color={colors.success} />
                        <Text style={[styles.bookBtnText, { color: colors.success }]}>Booked & paid — opening shortly</Text>
                      </View>
                    ) : (
                      <View style={[styles.bookBtn, { backgroundColor: colors.primary }]}>
                        <Feather name="credit-card" size={14} color="#fff" />
                        <Text style={styles.bookBtnText}>
                          {`Book & Pay to join · NPR ${s.price.toLocaleString()}`}
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}

          {sessionTab === "past" &&
            activeSessions.map((s) => <SessionCard key={s.id} session={s} onPress={() => {}} />)}
        </View>

        {studentId && (
          !checkingRateEligibility && !ratingSubmitted && canRate ? (
            <View style={[styles.rateCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Rate this Teacher</Text>
              <Text style={[styles.rateSubtitle, { color: colors.mutedForeground }]}>
                Your feedback helps other students choose the right teacher
              </Text>
              <View style={styles.starRow}>
                <StarRating rating={myRating} size={36} interactive onRate={(r) => setMyRating(r)} />
              </View>
              {/*
                Optional on purpose. A star with nothing beside it is still a real opinion, and
                demanding a sentence is how the app ended up writing them itself.
              */}
              <TextInput
                testID="review-comment-input"
                style={[styles.reviewInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                placeholder="Say what the class was like (optional)"
                placeholderTextColor={colors.mutedForeground}
                value={myComment}
                onChangeText={setMyComment}
                multiline
                maxLength={1000}
                textAlignVertical="top"
              />
              <Text style={[styles.reviewHint, { color: colors.mutedForeground }]}>
                Your name is never shown with your review.
              </Text>
              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: myRating > 0 ? colors.secondary : colors.muted }]}
                onPress={submitRating}
                disabled={myRating === 0}
                activeOpacity={0.8}
              >
                <Text style={[styles.submitBtnText, { color: myRating > 0 ? "#fff" : colors.mutedForeground }]}>
                  Submit Rating
                </Text>
              </TouchableOpacity>
            </View>
          ) : ratingSubmitted ? (
            <View style={[styles.ratingThanks, { backgroundColor: colors.success + "12", borderColor: colors.success + "30" }]}>
              <Feather name="check-circle" size={20} color={colors.success} />
              <Text style={[styles.ratingThanksText, { color: colors.success }]}>Rating submitted! Thank you.</Text>
            </View>
          ) : !checkingRateEligibility ? (
            <View style={[styles.rateLocked, { backgroundColor: colors.muted }]}>
              <Feather name="lock" size={16} color={colors.mutedForeground} />
              <Text style={[styles.noSessionsText, { color: colors.mutedForeground }]}>
                You can rate this teacher after attending a completed session with them (within the last 15 days).
              </Text>
            </View>
          ) : null
        )}

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Student Reviews</Text>
        {reviews.map((review) => (
          <View key={review.id} style={[styles.reviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.reviewHeader}>
              <View style={[styles.reviewAvatar, { backgroundColor: colors.primary + "15" }]}>
                <Feather name="user" size={14} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                {/*
                  No name, for anybody. The owner asked for reviews to be anonymous to the
                  teacher, and anonymous only on the teacher's own screen is not anonymous —
                  this page is public, and a teacher can read it signed out. The server does not
                  send the name at all; see routes/teachers.ts.
                */}
                <Text style={[styles.reviewName, { color: colors.foreground }]}>
                  {review.mine ? "Your review" : "A student"}
                </Text>
                <Text style={[styles.reviewDate, { color: colors.mutedForeground }]}>
                  {new Date(review.createdAt).toLocaleDateString("en-NP", { month: "short", year: "numeric" })}
                </Text>
              </View>
              <StarRating rating={review.rating} size={14} />
            </View>
            {review.comment ? (
              <Text style={[styles.reviewComment, { color: colors.mutedForeground }]}>"{review.comment}"</Text>
            ) : null}
          </View>
        ))}
        {reviews.length === 0 && (
          <View style={[styles.noSessions, { backgroundColor: colors.muted }]}>
            <Feather name="message-circle" size={20} color={colors.mutedForeground} />
            <Text style={[styles.noSessionsText, { color: colors.mutedForeground }]}>No reviews yet. Be the first to rate!</Text>
          </View>
        )}
      </View>

      <PaymentSheet
        visible={paySession !== null}
        amount={paySession?.price ?? 0}
        label={paySession ? `Book · ${paySession.topic}` : "Book Session"}
        onClose={() => setPaySession(null)}
        /**
         * The promise is **returned**, not just started.
         *
         * Without the return, the sheet awaited `undefined`, resolved immediately and showed
         * its success screen while the real booking was still in flight — so a class that was
         * full still produced "You're booked", and the rejection became an unhandled promise
         * nobody saw. Caught by a browser test; no server test could have seen it.
         */
        onSuccess={(method) => (paySession ? confirmBooking(paySession, method) : Promise.resolve())}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {},
  hero: { paddingHorizontal: 20, paddingBottom: 28, alignItems: "center", gap: 10 },
  heroTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: 4 },
  backBtn: { alignSelf: "flex-start" },
  heroTopActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  contactBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  subscribeBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  subscribeBtnInactive: { backgroundColor: "rgba(255,255,255,0.18)" },
  subscribeBtnActive: { backgroundColor: "#22C55E60" },
  subscribeBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  heroAvatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: "rgba(255,255,255,0.25)", justifyContent: "center", alignItems: "center" },
  heroAvatarText: { fontSize: 32, fontFamily: "Inter_700Bold", color: "#fff" },
  heroName: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  heroSubjectTag: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  heroSubjectText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#ffffffdd" },
  heroRating: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroRatingText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#ffffffcc" },
  heroStats: { flexDirection: "row", width: "100%", justifyContent: "space-around", paddingTop: 8 },
  heroStat: { alignItems: "center" },
  heroStatNum: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  heroStatLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#ffffff80" },
  heroStatDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.2)" },
  body: { padding: 20, gap: 20 },
  card: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 12 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  bio: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  expandableHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  expandableLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  expandToggle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  hostedBreakdown: { gap: 4, paddingTop: 2 },
  hostedRow: { fontSize: 13, fontFamily: "Inter_400Regular" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  tagText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginBottom: 10 },
  tabRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  tabBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  tabBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#EF4444" },
  liveDotWhite: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  noSessions: { borderRadius: 14, padding: 20, flexDirection: "row", alignItems: "center", gap: 12 },
  noSessionsText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  rateLocked: { borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  bookBtnRow: { marginTop: -4, marginBottom: 8, paddingHorizontal: 2 },
  bookBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12 },
  bookBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  rateCard: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 12, alignItems: "center" },
  rateSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  starRow: { paddingVertical: 8 },
  submitBtn: { borderRadius: 14, paddingHorizontal: 32, paddingVertical: 13 },
  submitBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  ratingThanks: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
  ratingThanksText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  reviewCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  reviewHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  reviewAvatar: { width: 38, height: 38, borderRadius: 19, justifyContent: "center", alignItems: "center" },
  reviewAvatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  reviewName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  reviewDate: { fontSize: 12, fontFamily: "Inter_400Regular" },
  reviewInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 76,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginBottom: 8,
  },
  reviewHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 12 },
  reviewComment: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, fontStyle: "italic" },
});
