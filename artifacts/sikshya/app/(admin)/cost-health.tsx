import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPatch, apiPost, ApiError } from "@/utils/api";
import {
  BUDGET_PROVIDERS, budgetDraft, measuredAt, meterFraction, parseBudget, periodLabel, providerBudgetId,
  usd, visibleSummary, type CostHealthDashboard, type CostHealthSettings,
  type ProviderReading, type HealthCheck,
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
  const colors = useColors();
  const { t, numeric, gutter, space, radius, isExpanded } = useLayout();
  const insets = useSafeAreaInsets();
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
  const urgentWarnings = dashboard?.warnings.filter(warning => !warning.key.startsWith("coverage:")) ?? [];
  const coverageCount = dashboard?.warnings.filter(warning => warning.key.startsWith("coverage:")).length ?? 0;
  const button = (label: string, action: () => void, disabled = false, primary = false, id?: string) => (
    <Pressable
      testID={id} accessibilityRole="button" accessibilityState={{ disabled }} aria-disabled={disabled}
      disabled={disabled} onPress={action}
      style={{ minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: primary ? colors.primary : colors.lineStrong, backgroundColor: primary ? colors.primary : colors.card }}
    >
      <Text style={[t.caption, { color: primary ? colors.primaryForeground : colors.primary }]}>{label}</Text>
    </Pressable>
  );

  const card = { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm } as const;

  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + 112, paddingHorizontal: gutter, gap: space.lg }}>
    <View style={{ maxWidth: 1120, width: "100%", alignSelf: "center", gap: space.lg }}>
      <View style={{ gap: space.xs }}>
        {button("← Support desk", () => router.replace("/(admin)"))}
        <Text accessibilityRole="header" style={[t.title1, { color: colors.foreground }]}>Cost & Health</Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>Private owner view · provider usage, service checks and alert settings in one place.</Text>
      </View>

      {access === "checking" ? <View testID="cost-health-access-checking" style={{ padding: space.xxl, alignItems: "center", gap: space.sm }}><ActivityIndicator color={colors.primary} /><Text style={[t.callout, { color: colors.mutedForeground }]}>Checking owner access…</Text></View> : null}
      {access === "denied" ? <View testID="cost-health-access-denied" style={card}><Text style={[t.title3, { color: colors.foreground }]}>Owner access required</Text><Text style={[t.callout, { color: colors.mutedForeground }]}>This page is only available to the account owner. Return to the support desk if you need help.</Text></View> : null}

      {access === "allowed" ? <>
        {problem ? <View testID="cost-health-error" style={[card, { backgroundColor: colors.warnSoft }]}><Text style={[t.bodyStrong, { color: colors.warn }]}>Could not update this view</Text><Text style={[t.callout, { color: colors.foreground }]}>{problem}</Text>{button("Try loading again", () => void loadCached())}</View> : null}
        {!dashboard && !problem ? <View style={{ padding: space.xxl, alignItems: "center", gap: space.sm }}><ActivityIndicator color={colors.primary} /><Text style={[t.callout, { color: colors.mutedForeground }]}>Loading the latest saved readings…</Text></View> : null}
        {dashboard ? <>
          <View style={[card, { backgroundColor: colors.secondary, borderColor: colors.secondary, padding: space.xl, gap: space.md }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.md, flexWrap: "wrap" }}>
              <View style={{ gap: space.xs, flex: 1, minWidth: 220 }}>
                <Text style={[t.overline, { color: colors.onInverseMuted }]}>Known metered usage</Text>
                <Text testID="cost-health-known-spend" style={[t.display, numeric, { color: colors.onInverse }]}>{visibleSummary(dashboard).known}</Text>
                <Text style={[t.callout, { color: colors.onInverseMuted }]}>{dashboard.summary.complete ? "All configured provider cost readings included" : "Partial view · some costs are unavailable"}</Text>
              </View>
              <View style={{ gap: space.xs, minWidth: 180 }}>
                <Text style={[t.overline, { color: colors.onInverseMuted }]}>Combined projection</Text>
                <Text testID="cost-health-projection" style={[t.title2, numeric, { color: colors.onInverse }]}>{visibleSummary(dashboard).projection}</Text>
                <Text style={[t.caption, { color: colors.onInverseMuted }]}>Shown only with a complete comparable picture</Text>
              </View>
            </View>
            <Text style={[t.callout, { color: colors.onInverseMuted }]}>{visibleSummary(dashboard).detail}</Text>
            <Text style={[t.caption, { color: colors.onInverseMuted }]}>Resource charges only where reported; fixed fees, taxes and missing providers are not included.</Text>
            <Text style={[t.caption, { color: colors.onInverseMuted }]}>Last saved check: {measuredAt(dashboard.snapshot?.checkedAt)}</Text>
          </View>

          <View style={[card, { backgroundColor: colors.actionSoft }]}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>An alert budget is not a spending cap</Text>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>This view warns you about usage. It cannot stop charges at Railway, Cloudflare, Neon or Brevo. Each provider controls its own billing and service limits.</Text>
          </View>

          {urgentWarnings.length > 0 ? <View style={{ gap: space.sm }} testID="cost-health-warnings">
            <Text accessibilityRole="header" style={[t.title2, { color: colors.foreground }]}>Needs attention</Text>
            {urgentWarnings.map(warning => <View key={warning.key} style={[card, { backgroundColor: warning.severity === "critical" ? colors.destructiveSoft : colors.warnSoft }]}><Text style={[t.bodyStrong, { color: warning.severity === "critical" ? colors.destructive : colors.warn }]}>{warning.title}</Text><Text style={[t.callout, { color: colors.foreground }]}>{warning.detail}</Text></View>)}
          </View> : null}

          <View style={{ gap: space.sm }}>
            <View style={{ gap: space.xs }}><Text accessibilityRole="header" style={[t.title2, { color: colors.foreground }]}>Providers</Text><Text style={[t.callout, { color: colors.mutedForeground }]}>Each card uses its provider's own period and reading time. Missing data stays missing.</Text>{coverageCount > 0 ? <Text testID="cost-health-coverage-summary" style={[t.callout, { color: colors.warn }]}>{coverageCount} {coverageCount === 1 ? "connection needs" : "connections need"} setup or have partial coverage. See the provider cards below.</Text> : null}</View>
            {dashboard.snapshot ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }} testID="cost-health-providers">
              {dashboard.snapshot.providers.map(provider => <ProviderCard key={provider.id} provider={provider} alertBudget={dashboard.settings.providerBudgetsUsd[providerBudgetId(provider.id)] ?? null} wide={isExpanded} />)}
            </View> : <View style={card}><Text style={[t.callout, { color: colors.mutedForeground }]}>No provider check has completed yet. Run a check when you are ready.</Text></View>}
          </View>

          <View style={[card, { gap: space.md }]}>
            <View style={{ gap: space.xs }}><Text accessibilityRole="header" style={[t.title2, { color: colors.foreground }]}>Checks & alerts</Text><Text style={[t.callout, { color: colors.mutedForeground }]}>Provider checks run when this page opens and about every 5 minutes while it stays visible. Saved readings reload every minute. {dashboard.monitoring.enabled ? `The background monitor is scheduled every ${dashboard.monitoring.intervalMinutes} minutes while its service is online.` : "Background monitoring is currently off."}</Text></View>
            <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap", alignItems: "center" }}>
              {button(busy === "refresh" ? "Checking…" : now < cooldownUntil ? `Refresh available in ${Math.min(5, Math.max(1, Math.ceil((cooldownUntil - now) / 60_000)))} min` : "Refresh provider readings", () => void act("refresh", "/owner/cost-health/refresh"), disabledRefresh, true, "cost-health-refresh")}
              {button(busy === "email" ? "Sending…" : "Send test email", () => void act("email", "/owner/cost-health/test-email"), busy !== null || !dashboard.monitoring.emailConfigured, false, "cost-health-test-email")}
            </View>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>Last monitor success: {measuredAt(dashboard.monitoring.lastSuccessAt)} · Next check: {measuredAt(dashboard.monitoring.nextCheckAt)}</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>Alert recipient: {dashboard.monitoring.alertRecipient ?? "Not configured"} · Email delivery: {dashboard.monitoring.emailConfigured ? "configured" : "not configured"}</Text>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>{dashboard.monitoring.limitation}</Text>
            {feedback ? <Text testID="cost-health-feedback" style={[t.callout, { color: colors.success }]}>{feedback}</Text> : null}
          </View>

          <BudgetForm settings={dashboard.settings} busy={busy !== null} onSave={async settings => {
            setBusy("save"); setFeedback(null); setProblem(null);
            try {
              const result = await apiPatch<CostHealthDashboard>("/owner/cost-health/settings", settings);
              if (active.current) { setDashboard(result); setFeedback("Alert settings saved."); }
            } catch (error) {
              if (!active.current) return;
              if (error instanceof ApiError && error.status === 403) { setAccess("denied"); setDashboard(null); }
              else setProblem(error instanceof Error ? error.message : "Alert settings could not be saved.");
            } finally { if (active.current) setBusy(null); }
          }} />

          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[t.title2, { color: colors.foreground }]}>Service health</Text>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>These checks describe what the monitor could reach at the last check; they are not a round-the-clock outage guarantee.</Text>
            {dashboard.snapshot?.health.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>{dashboard.snapshot.health.map(check => <HealthCard key={check.id} check={check} wide={isExpanded} />)}</View> : <View style={card}><Text style={[t.callout, { color: colors.mutedForeground }]}>No health readings yet.</Text></View>}
          </View>
        </> : null}
      </> : null}
    </View>
  </ScrollView>;
}

function ProviderCard({ provider, alertBudget, wide }: { provider: ProviderReading; alertBudget: number | null; wide: boolean }) {
  const colors = useColors(); const { t, numeric, space, radius } = useLayout();
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
  const statusText = { connected: "Connected", partial: "Partial", not_connected: "Not connected", unavailable: "Unavailable" }[provider.status];
  const statusColor = provider.status === "connected" ? colors.success : provider.status === "unavailable" ? colors.destructive : colors.warn;
  const external = async () => { try { await Linking.openURL(provider.dashboardUrl); } catch { /* The account page remains a visible URL below. */ } };
  return <View testID={`cost-health-provider-${provider.id}`} style={{ flexBasis: wide ? "48%" : "100%", flexGrow: 1, minWidth: 270, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.xs }}><Text style={[t.title3, { color: colors.foreground, flex: 1 }]}>{provider.name}</Text><Text style={[t.caption, { color: statusColor }]}>{statusText}</Text></View>
    <Text style={[t.caption, { color: colors.mutedForeground }]}>{provider.scope}</Text>
    <View style={{ padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.muted, gap: space.xs }}>
      <Text style={[t.overline, { color: colors.mutedForeground }]}>Reported cost this period</Text>
      <Text testID={`cost-health-cost-${provider.id}`} style={[t.title2, numeric, { color: colors.foreground }]}>{usd(provider.cost?.amountUsd)}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>{provider.cost ? `${periodLabel(provider.cost.periodStart, provider.cost.periodEnd)} · ${provider.cost.basis === "provider_estimate" ? "Provider estimate" : provider.cost.basis === "manual" ? "Manual entry" : "Measured"}` : "No cost reading available"}</Text>
      {provider.cost?.projectedUsd !== null && provider.cost?.projectedUsd !== undefined ? <Text style={[t.caption, numeric, { color: colors.foreground }]}>Trend projection (estimate): {usd(provider.cost.projectedUsd)}</Text> : null}
      {provider.cost?.note ? <Text style={[t.callout, { color: colors.mutedForeground }]}>{provider.cost.note}</Text> : null}
      <Text style={[t.caption, numeric, { color: colors.warn }]}>Alert budget: {usd(alertBudget)}{alertBudget !== null ? " / month" : ""}</Text>
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
    <Text style={[t.caption, { color: colors.inkFaint }]}>Observed: {measuredAt(provider.observedAt)} · Checked: {measuredAt(provider.checkedAt)}</Text>
    {provider.setup.length && provider.status !== "connected" ? <View style={{ gap: space.xxs, paddingTop: space.xs, borderTopWidth: 1, borderColor: colors.border }}><Pressable accessibilityRole="button" accessibilityState={{ expanded: showConnectionDetails }} onPress={() => setShowConnectionDetails(current => !current)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: space.xs }}><Feather name={showConnectionDetails ? "chevron-down" : "chevron-right"} size={16} color={colors.primary} /><Text style={[t.caption, { color: colors.primary }]}>Connection details</Text></Pressable>{showConnectionDetails ? <><Text style={[t.caption, { color: colors.mutedForeground }]}>A server administrator can add these variables:</Text>{provider.setup.map((item, index) => <Text key={`${index}-${item}`} style={[t.caption, { color: colors.foreground }]}>• {item}</Text>)}<Text style={[t.caption, { color: colors.mutedForeground }]}>Add server variables in Railway → API service → Variables. Never enter keys on this page.</Text></> : null}</View> : null}
    <Pressable accessibilityRole="link" onPress={() => void external()} style={{ minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: space.xxs }}><Text style={[t.caption, { color: colors.primary }]}>Open {provider.name} dashboard</Text><Feather name="external-link" size={14} color={colors.primary} /></Pressable>
  </View>;
}

function HealthCard({ check, wide }: { check: HealthCheck; wide: boolean }) {
  const colors = useColors(); const { t, numeric, space, radius } = useLayout();
  const color = check.status === "healthy" ? colors.success : check.status === "degraded" ? colors.warn : colors.destructive;
  return <View style={{ flexBasis: wide ? "31%" : "100%", flexGrow: 1, minWidth: 250, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.xs }}><View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}><Feather name={check.status === "healthy" ? "check-circle" : "alert-circle"} size={18} color={color} /><Text style={[t.title3, { color: colors.foreground, flex: 1 }]}>{check.name}</Text></View><Text style={[t.caption, { color }]}>{check.status === "healthy" ? "Reachable" : check.status === "degraded" ? "Degraded" : "Unavailable"}</Text><Text style={[t.callout, { color: colors.mutedForeground }]}>{check.note}</Text><Text style={[t.caption, numeric, { color: colors.inkFaint }]}>{measuredAt(check.checkedAt)}{check.latencyMs === null ? "" : ` · ${check.latencyMs} ms`}</Text></View>;
}

function BudgetForm({ settings, busy, onSave }: { settings: CostHealthSettings; busy: boolean; onSave: (next: CostHealthSettings) => Promise<void> }) {
  const colors = useColors(); const { t, space, radius, isExpanded } = useLayout();
  const [total, setTotal] = useState(budgetDraft(settings.monthlyBudgetUsd));
  const [providers, setProviders] = useState<Record<string, string>>(() => Object.fromEntries(BUDGET_PROVIDERS.map(item => [item.id, budgetDraft(settings.providerBudgetsUsd[item.id])])));
  const [email, setEmail] = useState(settings.emailAlertsEnabled);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (editing) return;
    setTotal(budgetDraft(settings.monthlyBudgetUsd));
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
      const next = { monthlyBudgetUsd: parseBudget(total), providerBudgetsUsd: nextBudgets, emailAlertsEnabled: email };
      setError(null);
      await onSave(next);
      setEditing(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Enter valid budget amounts."); }
  };
  const input = (label: string, value: string, change: (value: string) => void, id: string) => <View style={{ flexBasis: isExpanded ? "48%" : "100%", flexGrow: 1, minWidth: 250, gap: space.xxs }} key={id}><Text style={[t.caption, { color: colors.foreground }]}>{label}</Text><TextInput testID={`cost-health-budget-${id}`} accessibilityLabel={`${label} in US dollars`} inputMode="decimal" keyboardType="decimal-pad" value={value} onChangeText={text => { change(text); setEditing(true); }} placeholder="No alert budget" placeholderTextColor={colors.inkFaint} style={[t.body, { minHeight: 44, borderColor: colors.lineStrong, borderWidth: 1, borderRadius: radius.xs, paddingHorizontal: space.sm, color: colors.foreground, backgroundColor: colors.card }]} /></View>;
  return <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.md }}>
    <View style={{ gap: space.xs }}><Text accessibilityRole="header" style={[t.title2, { color: colors.foreground }]}>Monthly alert budgets</Text><Text style={[t.callout, { color: colors.mutedForeground }]}>These thresholds send warnings only. Choose a monthly warning amount for each provider. LiveKit is excluded for now; leave the overall amount empty unless you choose one.</Text></View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>{BUDGET_PROVIDERS.map(item => input(item.name, providers[item.id] ?? "", value => setProviders(current => ({ ...current, [item.id]: value })), item.id))}{input("Overall (optional)", total, setTotal, "overall")}</View>
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: email, disabled: busy }} aria-checked={email} aria-disabled={busy} disabled={busy} onPress={() => { setEmail(current => !current); setEditing(true); }} style={{ minHeight: 44, flexDirection: "row", gap: space.sm, alignItems: "center" }}><Feather name={email ? "check-square" : "square"} size={22} color={colors.primary} /><Text style={[t.body, { color: colors.foreground, flex: 1 }]}>Email alerts enabled</Text></Pressable>
    {error ? <Text style={[t.callout, { color: colors.destructive }]}>{error}</Text> : null}
    <Pressable testID="cost-health-save-settings" accessibilityRole="button" accessibilityState={{ disabled: busy }} aria-disabled={busy} disabled={busy} onPress={() => void save()} style={{ minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: space.md, backgroundColor: colors.primary, borderRadius: radius.sm }}><Text style={[t.caption, { color: colors.primaryForeground }]}>{busy ? "Saving…" : "Save alert settings"}</Text></Pressable>
  </View>;
}
