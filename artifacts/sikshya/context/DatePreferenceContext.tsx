import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { formatDate, formatDateBoth, type DateSystem, type FormatOptions } from "@/utils/nepaliDate";

/**
 * Which calendar this person reads dates in.
 *
 * **Bikram Sambat by default**, because this is a Nepali product and Bikram Sambat is the civil
 * calendar there — a school timetable, a government form and a wall calendar all use it. A
 * parent told their child's class is on "9/1/2026" has to convert in their head; told it is on
 * "8 Bhadra 2083" they simply know.
 *
 * Gregorian stays one tap away rather than being removed. Nepal is not sealed off: people
 * coordinate with relatives abroad, read international timetables, and some younger users think
 * in Gregorian first. Forcing either calendar on everyone would be the same mistake in the
 * other direction.
 *
 * The choice is stored on the device rather than the account. It is about how somebody reads a
 * screen, not about who they are, and it should survive being signed out.
 */

const STORAGE_KEY = "@sikshya_date_system";

interface DatePreferenceValue {
  system: DateSystem;
  /** Devanagari numerals and month names. Only meaningful alongside Bikram Sambat. */
  nepaliNumerals: boolean;
  setSystem: (system: DateSystem) => Promise<void>;
  setNepaliNumerals: (on: boolean) => Promise<void>;
  /** Format a date the way this person reads them. */
  format: (value: Date | string | number, options?: FormatOptions) => string;
  /** Both calendars, for the places where being certain matters. */
  formatBoth: (value: Date | string | number, options?: FormatOptions) => string;
  /** False until the stored choice has been read, so nothing renders the wrong calendar first. */
  ready: boolean;
}

const DatePreferenceContext = createContext<DatePreferenceValue | undefined>(undefined);

export function DatePreferenceProvider({ children }: { children: React.ReactNode }) {
  const [system, setSystemState] = useState<DateSystem>("bs");
  const [nepaliNumerals, setNepaliNumeralsState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as { system?: DateSystem; nepaliNumerals?: boolean };
          if (parsed.system === "ad" || parsed.system === "bs") setSystemState(parsed.system);
          if (typeof parsed.nepaliNumerals === "boolean") setNepaliNumeralsState(parsed.nepaliNumerals);
        }
      } catch {
        // No stored choice, or storage unavailable. The default is the right answer for Nepal.
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persist = useCallback(async (next: { system: DateSystem; nepaliNumerals: boolean }) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The choice still applies for this session; it just will not be remembered.
    }
  }, []);

  const setSystem = useCallback(async (next: DateSystem) => {
    setSystemState(next);
    await persist({ system: next, nepaliNumerals });
  }, [nepaliNumerals, persist]);

  const setNepaliNumerals = useCallback(async (on: boolean) => {
    setNepaliNumeralsState(on);
    await persist({ system, nepaliNumerals: on });
  }, [system, persist]);

  const value = useMemo<DatePreferenceValue>(() => ({
    system,
    nepaliNumerals,
    setSystem,
    setNepaliNumerals,
    ready,
    format: (v, options = {}) =>
      formatDate(v, { system, nepali: nepaliNumerals && system === "bs", ...options }),
    formatBoth: (v, options = {}) =>
      formatDateBoth(v, { system, nepali: nepaliNumerals && system === "bs", ...options }),
  }), [system, nepaliNumerals, setSystem, setNepaliNumerals, ready]);

  return <DatePreferenceContext.Provider value={value}>{children}</DatePreferenceContext.Provider>;
}

/**
 * How this person reads dates.
 *
 * Usable outside the provider so a screen rendered in isolation — a test, a error boundary
 * fallback — still shows dates rather than crashing. It falls back to the Nepali default.
 */
export function useDates(): DatePreferenceValue {
  const context = useContext(DatePreferenceContext);
  if (context) return context;
  return {
    system: "bs",
    nepaliNumerals: false,
    ready: true,
    setSystem: async () => {},
    setNepaliNumerals: async () => {},
    format: (v, options = {}) => formatDate(v, { system: "bs", ...options }),
    formatBoth: (v, options = {}) => formatDateBoth(v, { system: "bs", ...options }),
  };
}
