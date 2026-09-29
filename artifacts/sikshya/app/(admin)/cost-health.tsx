import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import { CostHealthWorkspace } from "@/components/owner/CostHealthWorkspace";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPatch, apiPost, ApiError } from "@/utils/api";
import {
  BUDGET_PROVIDERS, budgetDraft, hasCurrentDollarReading, measuredAt, meterFraction, parseBudget, periodLabel, providerBudgetId,
  usd, type CostHealthDashboard, type CostHealthSettings,
  type ProviderReading,
} from "@/utils/costHealth";

const CACHE_POLL_MS = 60_000;
const MANUAL_REFRESH_MS = 5 * 60_000;

function foregroundVisible() {
  return AppState.currentState === "active" &&
    (Platform.OS !== "web" || typeof document === "undefined" || document.visibilityState === "visible");
}

export default function CostHealthScreen() {
  const { user } = useAuth();
  // A route may render briefly before the tab-group's role redirect. Never show owner data then.
  return user?.role === "admin" ? <OwnerCostHealth key={user.id} /> : null;
}

function OwnerCostHealth() {
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const [dashboard, setDashboard] = useState<CostHealthDashboard | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<"refresh" | "save" | "email" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const active = useRef(false);
  const authorized = useRef(false);
  const refreshInFlight = useRef(false);
  const lastRefreshAt = useRef(0);

  const loadCached = useCallback(async () => {
    if (!active.current || !authorized.current || refreshInFlight.current) return;
    try {
      const result = await apiGet<CostHealthDashboard>("/owner/cost-health");
      if (!active.current) return;
      setDashboard(result);
      setProblem(null);
    } catch (error) {
      if (!active.current) return;
      if (error instanceof ApiError && error.status === 403) {
        authorized.current = false; setAccess("denied"); setDashboard(null);
      } else {
        setProblem(error instanceof Error ? error.message : "The latest readings could not be loaded.");
      }
    }
  }, []);

  const refreshIfDue = useCallback(async () => {
    if (!active.current || !authorized.current || !foregroundVisible() || refreshInFlight.current) return;
    if (Date.now() - lastRefreshAt.current < MANUAL_REFRESH_MS) return;
    refreshInFlight.current = true;
    lastRefreshAt.current = Date.now();
    setCooldownUntil(lastRefreshAt.current + MANUAL_REFRESH_MS);
    try {
      const result = await apiPost<CostHealthDashboard>("/owner/cost-health/refresh", {}, { timeoutMs: 60_000 });
      if (active.current) { setDashboard(result); setProblem(null); }
    } catch (error) {
      if (!active.current) return;
      if (error instanceof ApiError && error.status === 403) {
        authorized.current = false; setAccess("denied"); setDashboard(null);
      } else {
        setProblem(error instanceof Error ? error.message : "The provider check could not be completed.");
      }
    } finally { refreshInFlight.current = false; }
  }, []);

  useFocusEffect(useCallback(() => {
    active.current = true;
    authorized.current = false;
    setAccess("checking");
    setDashboard(null);
    setProblem(null);
    void apiGet<{ allowed: boolean }>("/owner/access")
      .then(result => {
        if (!active.current) return;
        if (result.allowed === true) {
          authorized.current = true;
          setAccess("allowed");
          void loadCached().then(() => refreshIfDue());
        } else {
          authorized.current = false;
          setAccess("denied");
        }
      })
      .catch(() => { if (active.current) setAccess("denied"); });

    const interval = setInterval(() => {
      setNow(Date.now());
      if (active.current && foregroundVisible()) { void loadCached(); void refreshIfDue(); }
    }, CACHE_POLL_MS);
    const appListener = AppState.addEventListener("change", state => {
      if (state === "active" && active.current) { void loadCached(); void refreshIfDue(); }
    });
    const visibilityListener = () => {
      if (foregroundVisible() && active.current) { void loadCached(); void refreshIfDue(); }
    };
    if (Platform.OS === "web" && typeof document !== "undefined") document.addEventListener("visibilitychange", visibilityListener);
    return () => {
      active.current = false;
      authorized.current = false;
      clearInterval(interval);
      appListener.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") document.removeEventListener("visibilitychange", visibilityListener);
    };
  }, [loadCached, refreshIfDue]));

  const act = async (kind: "refresh" | "email", path: string) => {
    setBusy(kind); setFeedback(null); setProblem(null);
    try {
      if (kind === "refresh") {
        refreshInFlight.current = true;
        lastRefreshAt.current = Date.now();
        const result = await apiPost<CostHealthDashboard>(path, {}, { timeoutMs: 60_000 });
        if (active.current) {
          setDashboard(result);
          setCooldownUntil(Date.now() + MANUAL_REFRESH_MS);
          setFeedback("Latest available readings loaded. Provider reports can arrive later than the check.");
        }
      } else {
        const result = await apiPost<{ accepted: boolean }>(path, {});
        if (active.current) setFeedback(result.accepted ? "Test email accepted for delivery. Check your inbox." : "The test email was not accepted. Check the server email setup below.");
      }
    } catch (error) {
      if (!active.current) return;
      if (error instanceof ApiError && error.status === 403) { authorized.current = false; setAccess("denied"); setDashboard(null); }
      else setProblem(error instanceof Error ? error.message : "That action could not be completed.");
    } finally { if (kind === "refresh") refreshInFlight.current = false; if (active.current) setBusy(null); }
  };

  const disabledRefresh = busy !== null || refreshInFlight.current || (dashboard?.monitoring.refreshing ?? false) || now < cooldownUntil;
  return <CostHealthWorkspace
    access={access} dashboard={dashboard} problem={problem} busy={busy} feedback={feedback}
    now={now} cooldownUntil={cooldownUntil} disabledRefresh={disabledRefresh}
    onBack={() => router.replace("/(admin)")}
    onReload={() => void loadCached()}
    onRefresh={() => void act("refresh", "/owner/cost-health/refresh")}
    onEmail={() => void act("email", "/owner/cost-health/test-email")}
    renderProvider={provider => <ProviderCard provider={provider} alertBudget={dashboard?.settings.providerBudgetsUsd[providerBudgetId(provider.id)] ?? null} now={now} wide={false} />}
    renderBudget={() => dashboard ? <BudgetForm settings={dashboard.settings} busy={busy !== null} onSave={async settings => {
      setBusy("save"); setFeedback(null); setProblem(null);
      try {
        const result = await apiPatch<CostHealthDashboard>("/owner/cost-health/settings", settings);
        if (active.current) { setDashboard(result); setFeedback("Alert settings saved."); }
      } catch (error) {
        if (!active.current) return;
        if (error instanceof ApiError && error.status === 403) { authorized.current = false; setAccess("denied"); setDashboard(null); }
        else setProblem(error instanceof Error ? error.message : "Alert settings could not be saved.");
        throw error;
      } finally { if (active.current) setBusy(null); }
    }} /> : null}
  />;
}
function ProviderCard({ provider, alertBudget, now, wide }: { provider: ProviderReading; alertBudget: number | null; now: number; wide: boolean }) {
  const colors = useColors(); const { t, numeric, space, radius } = useLayout();
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
  const statusText = { connected: "Connected", partial: "Partial", not_connected: "Not connected", unavailable: "Unavailable" }[provider.status];
  const statusColor = provider.status === "connected" ? colors.success : provider.status === "unavailable" ? colors.destructive : colors.warn;
  const external = async () => { try { await Linking.openURL(provider.dashboardUrl); } catch { /* The account page remains a visible URL below. */ } };
  return <View testID={`cost-health-provider-${provider.id}`} style={{ width: "100%", minWidth: 0, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.xs }}><Text style={[t.title3, { color: colors.foreground, flex: 1 }]}>{provider.name}</Text><Text style={[t.caption, { color: statusColor }]}>{statusText}</Text></View>
    <Text style={[t.caption, { color: colors.mutedForeground }]}>{provider.scope}</Text>
    <View style={{ padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.muted, gap: space.xs }}>
      <Text style={[t.overline, { color: colors.mutedForeground }]}>Reported cost this period</Text>
      <Text testID={`cost-health-cost-${provider.id}`} style={[t.title2, numeric, { color: colors.foreground }]}>{usd(provider.cost?.amountUsd)}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>{provider.cost ? `${periodLabel(provider.cost.periodStart, provider.cost.periodEnd)} · ${provider.cost.basis === "provider_estimate" ? "Provider estimate" : provider.cost.basis === "manual" ? "Manual entry" : "Measured"}` : "No cost reading available"}</Text>
      {provider.cost?.projectedUsd !== null && provider.cost?.projectedUsd !== undefined ? <Text style={[t.caption, numeric, { color: colors.foreground }]}>Trend projection (estimate): {usd(provider.cost.projectedUsd)}</Text> : null}
      {provider.cost?.note ? <Text style={[t.callout, { color: colors.mutedForeground }]}>{provider.cost.note}</Text> : null}
      <Text style={[t.caption, numeric, { color: colors.warn }]}>Dollar warning target: {usd(alertBudget)}{alertBudget !== null ? " / month" : ""}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>{alertBudget === null ? "No dollar target saved" : hasCurrentDollarReading(provider, now) ? "Active for reported resource usage" : "Dollar alerts unavailable · target saved for reference"}</Text>
    </View>
    {provider.meters.map(meter => {
      const fraction = meterFraction(meter);
      return <View key={meter.id} style={{ gap: space.xxs }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.xs, flexWrap: "wrap" }}><Text style={[t.caption, { color: colors.foreground, flex: 1, minWidth: 100 }]}>{meter.label}</Text><Text style={[t.caption, numeric, { color: colors.foreground, flexShrink: 1, textAlign: "right" }]}>{Number.isFinite(meter.used) ? meter.used.toLocaleString() : "Unavailable"}{meter.limit === null ? "" : ` / ${meter.limit.toLocaleString()}`} {meter.unit}</Text></View>
        {fraction !== null ? <View style={{ height: 8, borderRadius: radius.xs, backgroundColor: colors.muted }}><View style={{ width: `${fraction * 100}%`, height: 8, borderRadius: radius.xs, backgroundColor: fraction >= 0.8 ? colors.warn : colors.primary }} /></View> : null}
        <Text style={[t.caption, { color: colors.inkFaint }]}>{periodLabel(meter.periodStart, meter.periodEnd)} · {meter.source === "provider" ? "Provider reading" : "Manual entry"}</Text>
      </View>;
    })}
    <Text style={[t.callout, { color: colors.mutedForeground }]}>{provider.note}</Text>
    <Text style={[t.caption, { color: colors.inkFaint }]}>Retrieved: {measuredAt(provider.observedAt)} · Checked: {measuredAt(provider.checkedAt)}. Provider data may lag.</Text>
    {provider.setup.length && provider.status !== "connected" ? <View style={{ gap: space.xxs, paddingTop: space.xs, borderTopWidth: 1, borderColor: colors.border }}><Pressable accessibilityRole="button" accessibilityState={{ expanded: showConnectionDetails }} onPress={() => setShowConnectionDetails(current => !current)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: space.xs }}><Feather name={showConnectionDetails ? "chevron-down" : "chevron-right"} size={16} color={colors.primary} /><Text style={[t.caption, { color: colors.primary }]}>Connection details</Text></Pressable>{showConnectionDetails ? <><Text style={[t.caption, { color: colors.mutedForeground }]}>A server administrator can add these variables:</Text>{provider.setup.map((item, index) => <Text key={`${index}-${item}`} style={[t.caption, { color: colors.foreground }]}>• {item}</Text>)}<Text style={[t.caption, { color: colors.mutedForeground }]}>Add server variables in Railway → API service → Variables. Never enter keys on this page.</Text></> : null}</View> : null}
    <Pressable accessibilityRole="link" onPress={() => void external()} style={{ minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: space.xxs }}><Text style={[t.caption, { color: colors.primary }]}>Open {provider.name} dashboard</Text><Feather name="external-link" size={14} color={colors.primary} /></Pressable>
  </View>;
}


function BudgetForm({ settings, busy, onSave }: { settings: CostHealthSettings; busy: boolean; onSave: (next: CostHealthSettings) => Promise<void> }) {
  const colors = useColors(); const { t, space, radius, isExpanded } = useLayout();
  const [providers, setProviders] = useState<Record<string, string>>(() => Object.fromEntries(BUDGET_PROVIDERS.map(item => [item.id, budgetDraft(settings.providerBudgetsUsd[item.id])])));
  const [email, setEmail] = useState(settings.emailAlertsEnabled);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (editing) return;
    setProviders(Object.fromEntries(BUDGET_PROVIDERS.map(item => [item.id, budgetDraft(settings.providerBudgetsUsd[item.id])])));
    setEmail(settings.emailAlertsEnabled);
  }, [settings, editing]);
  const save = async () => {
    try {
      const nextBudgets = { ...settings.providerBudgetsUsd };
      for (const item of BUDGET_PROVIDERS) {
        const amount = parseBudget(providers[item.id] ?? "");
        if (amount === null) delete nextBudgets[item.id]; else nextBudgets[item.id] = amount;
      }
      const next = { monthlyBudgetUsd: null, providerBudgetsUsd: nextBudgets, emailAlertsEnabled: email };
      setError(null);
      await onSave(next);
      setEditing(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Enter valid budget amounts."); }
  };
  const input = (label: string, value: string, change: (value: string) => void, id: string) => <View style={{ flexBasis: isExpanded ? "48%" : "100%", flexGrow: 1, minWidth: 250, gap: space.xxs }} key={id}><Text style={[t.caption, { color: colors.foreground }]}>{label}</Text><TextInput testID={`cost-health-budget-${id}`} accessibilityLabel={`${label} in US dollars`} inputMode="decimal" keyboardType="decimal-pad" value={value} onChangeText={text => { change(text); setEditing(true); }} placeholder="No alert budget" placeholderTextColor={colors.inkFaint} style={[t.body, { minHeight: 44, borderColor: colors.lineStrong, borderWidth: 1, borderRadius: radius.xs, paddingHorizontal: space.sm, color: colors.foreground, backgroundColor: colors.card }]} /></View>;
  return <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.md }}>
    <View style={{ gap: space.xs }}><Text accessibilityRole="header" style={[t.title2, { color: colors.foreground }]}>Monthly dollar warning targets</Text><Text style={[t.callout, { color: colors.mutedForeground }]}>Railway can trigger dollar warnings when connected. Neon, Cloudflare and Brevo targets are saved for reference; this dashboard cannot yet read their dollar charges. Available allowance warnings are separate. These are alerts, not spending caps. LiveKit is excluded for now.</Text></View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>{BUDGET_PROVIDERS.map(item => input(item.name, providers[item.id] ?? "", value => setProviders(current => ({ ...current, [item.id]: value })), item.id))}</View>
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: email, disabled: busy }} aria-checked={email} aria-disabled={busy} disabled={busy} onPress={() => { setEmail(current => !current); setEditing(true); }} style={{ minHeight: 44, flexDirection: "row", gap: space.sm, alignItems: "center" }}><Feather name={email ? "check-square" : "square"} size={22} color={colors.primary} /><Text style={[t.body, { color: colors.foreground, flex: 1 }]}>Email alerts enabled</Text></Pressable>
    {error ? <Text style={[t.callout, { color: colors.destructive }]}>{error}</Text> : null}
    <Pressable testID="cost-health-save-settings" accessibilityRole="button" accessibilityState={{ disabled: busy }} aria-disabled={busy} disabled={busy} onPress={() => void save()} style={{ minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: space.md, backgroundColor: colors.primary, borderRadius: radius.sm }}><Text style={[t.caption, { color: colors.primaryForeground }]}>{busy ? "Saving…" : "Save alert settings"}</Text></Pressable>
  </View>;
}
