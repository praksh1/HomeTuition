import React, { createContext, useContext, useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch, getToken, setToken, clearToken, ApiError } from "../utils/api";

export type TeacherApprovalStatus = "pending" | "approved" | "rejected";

export interface Credential {
  id: string;
  type: string;
  uri: string;
  name: string;
  uploadedAt: string;
}

export interface Review {
  id: string;
  studentId: string;
  studentName: string;
  rating: number;
  comment: string;
  date: string;
}

export interface Teacher {
  id: string;
  userId: number;
  name: string;
  email: string;
  role: "teacher";
  subject: string;
  subjects: string[];
  bio: string;
  approvalStatus: TeacherApprovalStatus;
  credentials: Credential[];
  rating: number;
  reviewCount: number;
  subscriptionActive: boolean;
  subscriptionTier: string;
  maxSessionsPerMonth: number;
  sessionsThisMonth: number;
  totalStudents: number;
  monthlyEarnings: number;
  avatarUrl?: string;
  location?: string;
  district?: string;
  experienceYears?: number;
  pricePerSession?: number;
  languages?: string[];
  isOnline?: boolean;
  emailVerified: boolean;
  authProviders: string[];
}

export interface Student {
  id: string;
  userId: number;
  name: string;
  email: string;
  role: "student";
  grade: string;
  bio?: string;
  enrolledSessions: string[];
  avatarUrl?: string;
  emailVerified: boolean;
  authProviders: string[];
}

/**
 * A customer-care agent.
 *
 * Kept deliberately thin: an agent has no profile, no classes and nothing to sell. There is
 * also no way to become one through the app — registration accepts teacher and student only,
 * and the role is set by the owner directly against the database. A support tool that can
 * create its own operators is one that only has to be breached once.
 */
export interface Agent {
  id: string;
  userId: number;
  name: string;
  email: string;
  role: "admin";
  avatarUrl?: string;
  emailVerified: boolean;
  authProviders: string[];
}

export type User = Teacher | Student | Agent;

interface RegisterData {
  name: string;
  email: string;
  password: string;
  role: "teacher" | "student";
  subject?: string;
  bio?: string;
  grade?: string;
}

interface RegisterResult {
  success: boolean;
  verificationEmailSent: boolean;
  emailConfigured: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string, role: "teacher" | "student") => Promise<User | null>;
  register: (data: RegisterData) => Promise<RegisterResult>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => Promise<void>;
}

interface ApiTeacher {
  id: number;
  userId: number;
  name: string;
  email: string;
  subject: string;
  subjects: string[];
  bio: string;
  approvalStatus: string;
  location?: string | null;
  district?: string | null;
  experienceYears?: number | null;
  pricePerSession?: number | null;
  languages: string[];
  isOnline: boolean;
  subscriptionActive: boolean;
  subscriptionTier?: string;
  maxSessionsPerMonth?: number;
  sessionsThisMonth: number;
  totalStudents: number;
  monthlyEarnings: number;
  rating: number;
  reviewCount: number;
  avatarUrl?: string | null;
}

interface ApiStudent {
  id: number;
  userId: number;
  grade: string;
  bio?: string | null;
  avatarUrl?: string | null;
}

interface ApiUserProfile {
  id: number;
  email: string;
  name: string;
  role: string;
  emailVerified?: boolean;
  authProviders?: string[];
  teacher?: ApiTeacher | null;
  student?: ApiStudent | null;
}

interface ApiAuthResponse {
  token: string;
  user: ApiUserProfile;
}

function mapApiUserToUser(profile: ApiUserProfile): User | null {
  if (profile.role === "teacher" && profile.teacher) {
    const t = profile.teacher;
    return {
      id: String(t.id),
      userId: profile.id,
      name: profile.name,
      email: profile.email,
      role: "teacher",
      subject: t.subject,
      subjects: t.subjects ?? [],
      bio: t.bio ?? "",
      approvalStatus: (t.approvalStatus as TeacherApprovalStatus) ?? "pending",
      credentials: [],
      rating: Number(t.rating) || 0,
      reviewCount: t.reviewCount ?? 0,
      subscriptionActive: t.subscriptionActive ?? false,
      subscriptionTier: t.subscriptionTier ?? "base",
      maxSessionsPerMonth: t.maxSessionsPerMonth ?? 10,
      sessionsThisMonth: t.sessionsThisMonth ?? 0,
      totalStudents: t.totalStudents ?? 0,
      monthlyEarnings: t.monthlyEarnings ?? 0,
      avatarUrl: t.avatarUrl ?? undefined,
      location: t.location ?? undefined,
      district: t.district ?? undefined,
      experienceYears: t.experienceYears ?? undefined,
      pricePerSession: t.pricePerSession ?? undefined,
      languages: t.languages ?? ["Nepali"],
      isOnline: t.isOnline ?? false,
      emailVerified: profile.emailVerified === true,
      authProviders: profile.authProviders ?? [],
    };
  } else if (profile.role === "student") {
    const s = profile.student;
    return {
      id: String(s?.id ?? profile.id),
      userId: profile.id,
      name: profile.name,
      email: profile.email,
      role: "student",
      grade: s?.grade ?? "",
      bio: s?.bio ?? undefined,
      enrolledSessions: [],
      avatarUrl: s?.avatarUrl ?? undefined,
      emailVerified: profile.emailVerified === true,
      authProviders: profile.authProviders ?? [],
    };
  } else if (profile.role === "admin") {
    // Nothing to map: an agent has no profile of their own. Returning null here would have
    // signed them straight back out, which is how a new role usually announces itself.
    return {
      id: String(profile.id),
      userId: profile.id,
      name: profile.name,
      email: profile.email,
      role: "admin",
      emailVerified: profile.emailVerified !== false,
      authProviders: profile.authProviders ?? [],
    };
  }
  return null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  login: async () => null,
  register: async () => ({ success: false, verificationEmailSent: false, emailConfigured: false }),
  logout: () => {},
  updateUser: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const token = await getToken();
      if (token) {
        const profile = await apiGet<ApiUserProfile>("/auth/me");
        const mapped = mapApiUserToUser(profile);
        setUser(mapped);
      }
    } catch (err) {
      // Only a rejected token means the login is actually invalid. Clearing on *any* failure
      // logged people out whenever the request merely failed to arrive — a dropped packet, a
      // sleeping phone, the dev server restarting — which on a phone over wi-fi is common.
      // The saved token is kept in that case so the next launch can try again.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        await clearToken();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string, _role: "teacher" | "student"): Promise<User | null> => {
    const res = await apiPost<ApiAuthResponse>("/auth/login", { email, password });
    await setToken(res.token);
    const mapped = mapApiUserToUser(res.user);
    if (!mapped) return null;
    setUser(mapped);
    return mapped;
  };

  const register = async (data: RegisterData): Promise<RegisterResult> => {
    const res = await apiPost<ApiAuthResponse & { verificationEmailSent?: boolean; emailConfigured?: boolean }>("/auth/register", {
      name: data.name,
      email: data.email,
      password: data.password,
      role: data.role,
      subject: data.subject,
      bio: data.bio,
      grade: data.grade,
    });
    await setToken(res.token);
    const mapped = mapApiUserToUser(res.user);
    if (!mapped) return { success: false, verificationEmailSent: false, emailConfigured: false };
    setUser(mapped);
    return {
      success: true,
      verificationEmailSent: res.verificationEmailSent === true,
      emailConfigured: res.emailConfigured === true,
    };
  };

  const logout = async () => {
    await clearToken();
    setUser(null);
  };

  const updateUser = async (updates: Partial<User>) => {
    if (!user) return;
    if (user.role === "teacher") {
      try {
        const teacherUser = user as Teacher;
        await apiPatch<unknown>(`/teachers/${teacherUser.id}`, updates);
      } catch (_e) {}
    }
    setUser({ ...user, ...updates } as User);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

export const TEACHERS_KEY = "@sikshya_teachers";
export const SESSIONS_KEY = "@sikshya_sessions";
export const REVIEWS_KEY = "@sikshya_reviews";
