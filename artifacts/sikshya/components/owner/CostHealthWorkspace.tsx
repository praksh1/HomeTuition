import { Feather } from "@expo/vector-icons";
import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { buildCostHealthHistoryChart, hasCurrentDollarReading, measuredAt, meterFraction, providerBudgetId, usd, visibleSummary, type CostHealthDashboard, type CostHealthHistoryRange, type CostWarning, type HealthCheck, type ProviderReading } from "@/utils/costHealth";

type Tab = "overview" | "providers" | "alerts" | "settings";
type Icon = React.ComponentProps<typeof Feather>["name"];
type Props = {
  access: "checking" | "allowed" | "denied";
  dashboard: CostHealthDashboard | null; problem: string | null; feedback: string | null;
  busy: "refresh" | "save" | "email" | null;
  now: number; cooldownUntil: number; disabledRefresh: boolean;
  onBack: () => void; onReload: () => void; onRefresh: () => void; onEmail: () => void;
  renderProvider: (provider: ProviderReading) => React.ReactNode;
  renderBudget: () => React.ReactNode;
};

const providerIcons: Record<string, Icon> = { railway: "server", neon: "database", cloudflare: "cloud", brevo: "mail", livekit: "video", daily: "video" };
const providerNames: Record<string, string> = { railway: "Railway", neon: "Neon", cloudflare: "Cloudflare", brevo: "Brevo", livekit: "LiveKit", daily: "Daily" };

function Action({ label, icon, onPress, disabled = false, primary = false, testID }: { label: string; icon?: Icon; onPress: () => void; disabled?: boolean; primary?: boolean; testID?: string }) {
  const colors = useColors(); const { t, space, radius } = useLayout();
  return <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled }} aria-disabled={disabled} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, backgroundColor: primary ? colors.primary : pressed ? colors.actionSoft : colors.card, borderWidth: 1, borderColor: primary ? colors.primary : colors.border, opacity: disabled ? 0.55 : pressed ? 0.8 : 1 })}>
    {icon ? <Feather name={icon} size={16} color={primary ? colors.primaryForeground : colors.primary} /> : null}
    <Text style={[t.caption, { color: primary ? colors.primaryForeground : colors.primary, flexShrink: 1 }]}>{label}</Text>
  </Pressable>;
}

function Panel({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const colors = useColors(); const { space, radius } = useLayout();
  return <View testID={testID} style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.md, minWidth: 0 }}>{children}</View>;
}

function Label({ children }: { children: React.ReactNode }) {
  const colors = useColors(); const { t } = useLayout();
  return <Text style={[t.overline, { color: colors.mutedForeground }]}>{children}</Text>;
}

export function CostHealthWorkspace(props: Props) {
  const { access, dashboard, problem, feedback, now } = props;
  const colors = useColors(); const { t, numeric, gutter, space, radius, isExpanded, isCompact } = useLayout();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("overview");
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const navigate = (next: Tab) => { setTab(next); scroll.current?.scrollTo({ y: 0, animated: false }); };
  const openProvider = (id: string) => { setExpandedProvider(id); navigate("providers"); };
  const providers = dashboard?.snapshot?.providers ?? [];
  const urgent = dashboard?.warnings.filter(w => !w.key.startsWith("coverage:")) ?? [];
  const coverage = dashboard?.warnings.filter(w => w.key.startsWith("coverage:")) ?? [];
  const refreshLabel = props.busy === "refresh" || dashboard?.monitoring.refreshing ? "Checking…" : now < props.cooldownUntil ? `Refresh · ${Math.min(5, Math.max(1, Math.ceil((props.cooldownUntil - now) / 60_000)))}m` : "Refresh";

  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: gutter, backgroundColor: colors.card, borderBottomWidth: 1, borderColor: colors.border }}>
      <View style={{ width: "100%", maxWidth: 1320, alignSelf: "center", gap: space.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flex: 1, minWidth: 0 }}>
            <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}><Feather name="activity" size={22} color={colors.primaryForeground} /></View>
            <View style={{ gap: space.xxs, flexShrink: 1 }}><Text accessibilityRole="header" style={[t.title2, { color: colors.foreground }]}>Cost & Health</Text><Text style={[t.caption, { color: colors.mutedForeground }]}>Fadko · Owner workspace</Text></View>
          </View>
          <Action label={isCompact ? "Exit" : "Support desk"} icon="arrow-left" onPress={props.onBack} />
        </View>
        {access === "allowed" ? <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: isCompact ? 0 : space.lg }}>
          {([ ["overview", "Overview"], ["providers", "Providers"], ["alerts", `Alerts${urgent.length ? ` (${urgent.length})` : ""}`], ["settings", "Settings"] ] as [Tab, string][]).map(([id, label]) => <Pressable key={id} testID={`cost-health-tab-${id}`} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} aria-selected={tab === id} onPress={() => navigate(id)} style={({ pressed }) => ({ minHeight: 48, flex: isCompact ? 1 : undefined, paddingHorizontal: isCompact ? space.xxs : space.xs, justifyContent: "center", alignItems: "center", borderBottomWidth: 3, borderColor: tab === id ? colors.primary : colors.card, backgroundColor: pressed ? colors.actionSoft : colors.card })}><Text style={[t.caption, { color: tab === id ? colors.primary : colors.mutedForeground }]}>{label}</Text></Pressable>)}
        </View> : <View style={{ height: space.xs }} />}
      </View>
    </View>
    <ScrollView ref={scroll} testID="cost-health-scroll" style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.lg, paddingBottom: insets.bottom + space.xxl }}>
      <View style={{ maxWidth: 1320, width: "100%", alignSelf: "center", gap: space.lg }}>
        {access === "checking" ? <View testID="cost-health-access-checking" style={{ padding: space.xxl, gap: space.md, alignItems: "center" }}><ActivityIndicator color={colors.primary} /><Text style={[t.callout, { color: colors.mutedForeground }]}>Checking owner access…</Text></View> : null}
        {access === "denied" ? <Panel testID="cost-health-access-denied"><Feather name="lock" size={24} color={colors.primary} /><Text style={[t.title2, { color: colors.foreground }]}>Owner access required</Text><Text style={[t.body, { color: colors.mutedForeground }]}>This private workspace is only available to the account owner.</Text></Panel> : null}
        {access === "allowed" ? <>
          {problem ? <Panel testID="cost-health-error"><Text style={[t.bodyStrong, { color: colors.destructive }]}>Could not update this view</Text><Text style={[t.callout, { color: colors.mutedForeground }]}>{problem}</Text><Action label="Try loading again" onPress={props.onReload} /></Panel> : null}
          {feedback ? <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.actionSoft }}><Text testID="cost-health-feedback" accessibilityLiveRegion="polite" style={[t.callout, { color: colors.primary }]}>{feedback}</Text></View> : null}
          {!dashboard && !problem ? <ActivityIndicator style={{ padding: space.xxl }} color={colors.primary} /> : null}
          {dashboard ? <>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
              <View style={{ gap: space.xxs, flex: 1 }}><Text style={[t.title1, { color: colors.foreground }]}>{({ overview: "Overview", providers: "Providers", alerts: "Alerts", settings: "Settings" })[tab]}</Text>{!isCompact ? <Text style={[t.caption, { color: colors.mutedForeground }]}>{tab === "overview" ? "Spend. Usage. Uptime. One clear view." : tab === "providers" ? "Open a provider for usage and connection details." : tab === "alerts" ? "Usage warnings and connections to finish." : "Warning targets and email preferences."}</Text> : null}</View>
              <Action testID="cost-health-refresh" label={refreshLabel} icon="refresh-cw" disabled={props.disabledRefresh} onPress={props.onRefresh} />
            </View>

            {tab === "overview" ? <View testID="cost-health-panel-overview" style={{ gap: space.lg }}>
              <View style={{ flexDirection: isExpanded ? "row" : "column", gap: space.lg, alignItems: "stretch" }}>
                <View style={{ flex: isExpanded ? 2.2 : undefined, minWidth: 0 }}><SpendChart dashboard={dashboard} now={now} onConnect={() => navigate("providers")} /></View>
                <View style={{ flex: isExpanded ? 1 : undefined, minWidth: 0, gap: space.md }}>
                  <HealthPanel health={dashboard.snapshot?.health ?? []} now={now} />
                  <Panel>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}><Label>Needs attention</Label><Text style={[t.title2, numeric, { color: urgent.length ? colors.warn : colors.foreground }]}>{urgent.length}</Text></View>
                    {urgent[0] ? <><Text style={[t.bodyStrong, { color: colors.foreground }]}>{urgent[0].title}</Text><Text numberOfLines={2} style={[t.callout, { color: colors.mutedForeground }]}>{urgent[0].detail}</Text></> : <Text style={[t.callout, { color: colors.mutedForeground }]}>No usage warnings in the latest saved check.</Text>}
                    <Action label="Review alerts" icon="arrow-up-right" onPress={() => navigate("alerts")} />
                  </Panel>
                </View>
              </View>
              <View style={{ flexDirection: isExpanded ? "row" : "column", gap: space.lg, alignItems: "flex-start" }}>
                <View style={{ flex: isExpanded ? 2.2 : undefined, width: isExpanded ? undefined : "100%", minWidth: 0 }}>
                  <Panel><View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}><Text style={[t.title2, { color: colors.foreground }]}>Provider watchlist</Text><Text style={[t.caption, { color: colors.mutedForeground }]}>Latest readings</Text></View>
                    <ProviderWatchlist providers={providers} onSelect={openProvider} />
                    {coverage.length ? <Pressable testID="cost-health-coverage-summary" accessibilityRole="button" onPress={() => navigate("providers")} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: space.xs }}><Feather name="link" size={16} color={colors.warn} /><Text style={[t.caption, { color: colors.warn, flex: 1 }]}>{coverage.length} {coverage.length === 1 ? "connection needs" : "connections need"} attention</Text><Feather name="arrow-right" size={16} color={colors.warn} /></Pressable> : null}
                  </Panel>
                </View>
                <View style={{ flex: isExpanded ? 1 : undefined, width: isExpanded ? undefined : "100%", minWidth: 0 }}><Panel>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}><Feather name="shield" size={20} color={colors.primary} /><Text style={[t.title3, { color: colors.foreground }]}>Quietly keeping watch</Text></View>
                  <Text style={[t.callout, { color: colors.mutedForeground }]}>{dashboard.monitoring.enabled ? `Background checks every ${dashboard.monitoring.intervalMinutes} minutes while the service is online.` : "Background monitoring is off."}</Text>
                  <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.muted, gap: space.xxs }}><Label>Budget rules</Label><Text style={[t.title3, numeric, { color: colors.foreground }]}>{Object.keys(dashboard.settings.providerBudgetsUsd).length} provider targets</Text><Text style={[t.caption, { color: colors.mutedForeground }]}>Warnings, not spending caps. LiveKit excluded.</Text></View>
                  <Text style={[t.caption, { color: colors.mutedForeground }]}>Email alerts {dashboard.settings.emailAlertsEnabled && dashboard.monitoring.emailConfigured ? "enabled" : "not active"}</Text>
                  <Action label="Manage alerts & budgets" icon="sliders" onPress={() => navigate("settings")} />
                </Panel></View>
              </View>
            </View> : null}

            {tab === "providers" ? <View testID="cost-health-panel-providers" style={{ gap: space.md }}>
              <Panel><Text style={[t.callout, { color: colors.mutedForeground }]}>Usage and costs use each provider’s own reporting period. Dollar amounts are unavailable until a supported cost source is connected.</Text><View testID="cost-health-providers" style={{ gap: space.xs }}>{providers.map(provider => <View key={provider.id} style={{ minWidth: 0 }}><ProviderRow provider={provider} onPress={() => setExpandedProvider(expandedProvider === provider.id ? null : provider.id)} expanded={expandedProvider === provider.id} />{expandedProvider === provider.id ? <View style={{ paddingVertical: space.sm }}>{props.renderProvider(provider)}</View> : null}</View>)}</View>{!providers.length ? <Text style={[t.callout, { color: colors.mutedForeground }]}>No provider check has completed yet.</Text> : null}</Panel>
            </View> : null}

            {tab === "alerts" ? <View testID="cost-health-panel-alerts" style={{ gap: space.lg }}>
              <Panel><Text style={[t.title2, { color: colors.foreground }]}>Usage & service warnings ({urgent.length})</Text>{urgent.length ? urgent.map(w => <Warning key={w.key} warning={w} />) : <Text style={[t.body, { color: colors.mutedForeground }]}>No warnings reported. This does not include usage from providers that are not connected.</Text>}</Panel>
              {coverage.length ? <Panel><Text style={[t.title2, { color: colors.foreground }]}>Connections to finish ({coverage.length})</Text>{coverage.map(w => <Warning key={w.key} warning={w} />)}<Action label="Manage connections" onPress={() => navigate("providers")} /></Panel> : null}
              <Text style={[t.callout, { color: colors.mutedForeground }]}>Alerts cannot stop provider charges. Keep each provider’s own billing alerts enabled.</Text>
            </View> : null}

            {tab === "settings" ? <View testID="cost-health-panel-settings" style={{ flexDirection: isExpanded ? "row" : "column", gap: space.lg, alignItems: "flex-start" }}>
              <View style={{ flex: isExpanded ? 1.5 : undefined, width: isExpanded ? undefined : "100%", minWidth: 0 }}>{props.renderBudget()}</View>
              <View style={{ flex: isExpanded ? 1 : undefined, width: isExpanded ? undefined : "100%", minWidth: 0 }}><Panel>
                <Text style={[t.title2, { color: colors.foreground }]}>Checks & email delivery</Text>
                <Label>Alert recipient</Label><Text selectable style={[t.bodyStrong, { color: colors.foreground }]}>{dashboard.monitoring.alertRecipient ?? "Not configured"}</Text>
                <Action testID="cost-health-test-email" label={props.busy === "email" ? "Sending…" : "Send test email"} icon="mail" onPress={props.onEmail} disabled={props.busy !== null || !dashboard.monitoring.emailConfigured} />
                <Text style={[t.caption, { color: colors.mutedForeground }]}>Last email: {measuredAt(dashboard.monitoring.lastEmailAt)}{dashboard.monitoring.lastEmailStatus ? ` · ${dashboard.monitoring.lastEmailStatus}` : ""}</Text>
                <View style={{ height: 1, backgroundColor: colors.border }} />
                <Label>Refresh schedule</Label><Text style={[t.callout, { color: colors.mutedForeground }]}>Saved readings refresh every minute. Provider checks run about every 5 minutes while this page is visible. Provider reports may arrive later.</Text>
                <Text style={[t.callout, { color: colors.mutedForeground }]}>{dashboard.monitoring.enabled ? `Background checks: every ${dashboard.monitoring.intervalMinutes} minutes.` : "Background checks: off."}</Text>
                <Text style={[t.caption, { color: colors.mutedForeground }]}>Last success: {measuredAt(dashboard.monitoring.lastSuccessAt)}{"\n"}Next check: {measuredAt(dashboard.monitoring.nextCheckAt)}</Text>
                <Text style={[t.caption, { color: colors.warn }]}>{dashboard.monitoring.limitation}</Text>
              </Panel></View>
            </View> : null}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, flexWrap: "wrap", paddingTop: space.xs }}><Text style={[t.caption, { color: colors.inkFaint }]}>Private to you · USD</Text><Text style={[t.caption, numeric, { color: colors.inkFaint }]}>Last saved check: {measuredAt(dashboard.snapshot?.checkedAt)}</Text></View>
          </> : null}
        </> : null}
      </View>
    </ScrollView>
  </View>;
}

function coverageAvailable(dashboard: CostHealthDashboard) {
  return dashboard.history.some(point => point.knownSpendUsd !== null && Number.isFinite(point.knownSpendUsd) && point.knownSpendUsd >= 0) ||
    dashboard.snapshot?.providers.some(provider => provider.cost !== null);
}

function SpendChart({ dashboard, now, onConnect }: { dashboard: CostHealthDashboard; now: number; onConnect: () => void }) {
  const colors = useColors(); const { t, numeric, space, radius, isCompact } = useLayout();
  const [range, setRange] = useState<CostHealthHistoryRange>("7D");
  const [selectedReading, setSelectedReading] = useState<string | null>(null);
  const [chartWidth, setChartWidth] = useState(600);
  const chart = useMemo(() => buildCostHealthHistoryChart(dashboard.history, range, now), [dashboard.history, range, now]);
  const selected = chart.points.find(point => `${point.timestamp}:${point.amountUsd}` === selectedReading);
  const hasAnyReading = coverageAvailable(dashboard);
  const max = Math.max(1, ...chart.points.map(p => p.amountUsd));
  const coverage = dashboard.snapshot?.providers.filter(p => hasCurrentDollarReading(p, now)).length ?? 0;
  const chartLabel = selected ? `${usd(selected.amountUsd)} · ${measuredAt(selected.checkedAt)}` : chart.points.length ? `${chart.points.length} recorded readings · ${chart.isStale ? "last reading is stale" : "select a reading for details"}` : "No dollar readings in this range";
  return <Panel>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space.sm }}><Label>Reported resource spend</Label><View style={{ backgroundColor: dashboard.summary.complete ? colors.successSoft : colors.warnSoft, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: space.xxs }}><Text style={[t.caption, { color: dashboard.summary.complete ? colors.success : colors.warn }]}>{dashboard.summary.complete ? "Cost sources connected" : "Partial coverage"}</Text></View></View>
    <View style={{ gap: space.xxs }}><Text testID="cost-health-known-spend" style={[dashboard.summary.knownSpendUsd === null ? t.title1 : t.display, numeric, { color: colors.foreground }]}>{visibleSummary(dashboard).known}</Text><Text style={[t.callout, { color: colors.mutedForeground }]}>Reported amounts only · not your total invoice</Text></View>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}><Text style={[t.caption, { color: colors.mutedForeground }]}>Spending activity</Text><View style={{ flexDirection: "row", backgroundColor: colors.muted, padding: space.xxs, borderRadius: radius.pill }}>{(["1D", "7D", "30D"] as const).map(item => <Pressable key={item} testID={`cost-health-range-${item}`} accessibilityRole="button" accessibilityLabel={`Past ${item === "1D" ? "day" : item === "7D" ? "7 days" : "30 days"}`} accessibilityState={{ selected: range === item }} aria-pressed={range === item} onPress={() => { setRange(item); setSelectedReading(null); }} style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xs, borderRadius: radius.pill, backgroundColor: range === item ? colors.card : colors.muted }}><Text style={[t.caption, { color: range === item ? colors.primary : colors.mutedForeground }]}>{item}</Text></Pressable>)}</View></View>
    <View onLayout={event => { if (event.nativeEvent.layout.width > 0) setChartWidth(event.nativeEvent.layout.width); }} style={{ height: chart.points.length ? 224 : undefined, minHeight: 224, padding: chart.points.length ? 0 : space.md, justifyContent: "center", borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.background }}>
      <Svg style={{ position: "absolute", top: 0, left: 0 }} width="100%" height="100%" viewBox={`0 0 ${chartWidth} 224`} preserveAspectRatio="none" accessibilityLabel="Recorded resource usage chart">
        {[28, 82, 136, 190].map(y => <Line key={y} x1={16} x2={chartWidth - 16} y1={y} y2={y} stroke={colors.border} strokeWidth={1} strokeDasharray="3 6" />)}
        {chart.points.map((point, index) => <Circle key={`${point.timestamp}-${index}`} testID={`cost-health-chart-point-${index}`} cx={24 + ((point.timestamp - chart.rangeStart) / Math.max(1, chart.rangeEnd - chart.rangeStart)) * (chartWidth - 48)} cy={190 - point.amountUsd / max * 160} r={selectedReading === `${point.timestamp}:${point.amountUsd}` ? 6 : 4} fill={colors.primary} />)}
      </Svg>
      {!chart.points.length ? <View testID="cost-health-chart-empty" style={{ alignItems: "center", gap: space.sm }}><View style={{ backgroundColor: colors.card, padding: space.sm, borderRadius: radius.pill }}><Feather name="bar-chart-2" size={24} color={colors.primary} /></View><Text style={[t.bodyStrong, { color: colors.foreground, textAlign: "center" }]}>{hasAnyReading ? "No dollar readings in this range" : "A clear picture starts with connected data"}</Text><Text style={[t.caption, { color: colors.mutedForeground, textAlign: "center", backgroundColor: colors.background }]}>{hasAnyReading ? "Try another range. Only available checks are shown; gaps are never filled." : "Actual dollar readings will appear here. Nothing is estimated to fill the gaps."}</Text>{hasAnyReading ? range !== "30D" ? <Action label="View 30 days" onPress={() => setRange("30D")} /> : null : <Action label="Manage connections" onPress={onConnect} />}</View> : null}
    </View>
    {chart.points.length ? <><View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={[t.caption, numeric, { color: colors.inkFaint }]}>{new Date(chart.rangeStart).toLocaleDateString()}</Text><Text style={[t.caption, numeric, { color: colors.inkFaint }]}>USD</Text><Text style={[t.caption, numeric, { color: colors.inkFaint }]}>Now</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={{ flexDirection: "row", gap: space.xs }}>{chart.points.map((point, index) => <Pressable key={`${point.timestamp}-${index}`} testID={`cost-health-reading-${index}`} accessibilityRole="button" accessibilityLabel={`${usd(point.amountUsd)} recorded ${measuredAt(point.checkedAt)}`} onPress={() => setSelectedReading(`${point.timestamp}:${point.amountUsd}`)} style={{ minHeight: 44, paddingHorizontal: space.sm, justifyContent: "center", borderRadius: radius.sm, backgroundColor: selectedReading === `${point.timestamp}:${point.amountUsd}` ? colors.actionSoft : colors.muted }}><Text style={[t.caption, numeric, { color: colors.primary }]}>{usd(point.amountUsd)}</Text></Pressable>)}</View></ScrollView><Text testID="cost-health-chart-detail" accessibilityLiveRegion="polite" style={[t.caption, numeric, { color: colors.mutedForeground }]}>{chartLabel}</Text></> : null}
    <View style={{ flexDirection: "row", gap: space.lg, paddingTop: space.md, borderTopWidth: 1, borderColor: colors.border }}><View style={{ flex: 1, gap: space.xxs }}><Label>Combined projection</Label><Text testID="cost-health-projection" style={[t.bodyStrong, numeric, { color: colors.foreground }]}>{visibleSummary(dashboard).projection}</Text></View><View style={{ flex: 1, gap: space.xxs }}><Label>Current cost sources</Label><Text style={[t.bodyStrong, numeric, { color: colors.foreground }]}>{coverage} of {dashboard.snapshot?.providers.length ?? 0}</Text></View></View>
    <Text style={[t.caption, { color: colors.inkFaint }]}>Excludes unreported charges, fixed fees and taxes. History shows available checks, not a complete billing period; source coverage can change.</Text>
  </Panel>;
}

function ProviderWatchlist({ providers, onSelect }: { providers: ProviderReading[]; onSelect: (id: string) => void }) {
  const colors = useColors(); const { t, space } = useLayout();
  // One compact row per billing provider. Details retain every project/product reading.
  const groups = new Map<string, ProviderReading[]>();
  for (const provider of providers) { const id = providerBudgetId(provider.id); groups.set(id, [...(groups.get(id) ?? []), provider]); }
  return <View style={{ gap: space.xxs }}>{[...groups].map(([id, readings]) => {
    const representative = readings.find(p => p.meters.length || p.cost) ?? readings[0];
    const reporting = readings.filter(p => (p.status === "connected" || p.status === "partial") && (p.meters.length || p.cost)).length;
    return <ProviderRow key={id} provider={representative} groupName={providerNames[id] ?? representative.name} groupCount={readings.length} groupReporting={reporting} onPress={() => onSelect(representative.id)} />;
  })}{!groups.size ? <Text style={[t.callout, { color: colors.mutedForeground }]}>Provider readings will appear after the first check.</Text> : null}</View>;
}

function ProviderRow({ provider, onPress, expanded, groupName, groupCount = 1, groupReporting = 0 }: { provider: ProviderReading; onPress: () => void; expanded?: boolean; groupName?: string; groupCount?: number; groupReporting?: number }) {
  const colors = useColors(); const { t, numeric, space, radius, isCompact } = useLayout();
  const meter = groupCount > 1 ? undefined : provider.meters.find(m => meterFraction(m) !== null) ?? provider.meters[0];
  const fraction = meter ? meterFraction(meter) : null;
  const status = groupCount > 1 ? `${groupReporting} of ${groupCount} sources reporting` : ({ connected: "Connected", partial: "Partial data", not_connected: "Not connected", unavailable: "Unavailable" })[provider.status];
  return <Pressable testID={`cost-health-row-${provider.id}`} accessibilityRole="button" accessibilityLabel={`${groupName ?? provider.name}, ${status}, ${expanded ? "hide" : "view"} details`} accessibilityState={expanded === undefined ? undefined : { expanded }} aria-expanded={expanded} onPress={onPress} style={({ pressed }) => ({ borderTopWidth: 1, borderColor: colors.border, paddingVertical: space.md, paddingHorizontal: pressed ? space.xxs : 0, gap: space.sm, backgroundColor: expanded || pressed ? colors.actionSoft : colors.card, borderRadius: expanded || pressed ? radius.sm : 0 })}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}><Feather name={providerIcons[providerBudgetId(provider.id)] ?? "box"} size={19} color={colors.primary} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{groupName ?? provider.name}</Text><Text numberOfLines={1} style={[t.caption, { color: colors.mutedForeground }]}>{status}</Text></View>
      <View style={{ alignItems: "flex-end", maxWidth: isCompact ? "45%" : "50%", gap: space.xxs }}><Text style={[t.bodyStrong, numeric, { color: colors.foreground }]}>{groupCount > 1 ? `${groupReporting} / ${groupCount}` : provider.cost ? usd(provider.cost.amountUsd) : meter ? `${Number.isFinite(meter.used) ? meter.used.toLocaleString() : "Unavailable"}${meter.limit !== null ? ` / ${meter.limit.toLocaleString()}` : ""}` : "—"}</Text><Text numberOfLines={1} style={[t.caption, { color: colors.mutedForeground }]}>{groupCount > 1 ? "Reporting" : provider.cost ? "Reported usage" : meter ? meter.unit : "No usage connected"}</Text></View>
      <Feather name={expanded ? "chevron-down" : "chevron-right"} size={16} color={colors.inkFaint} />
    </View>
    {fraction !== null ? <View style={{ marginLeft: 52, height: 4, backgroundColor: colors.muted, borderRadius: radius.pill }}><View style={{ height: 4, width: `${fraction * 100}%`, backgroundColor: fraction >= 0.8 ? colors.warn : colors.primary, borderRadius: radius.pill }} /></View> : null}
  </Pressable>;
}

function HealthPanel({ health, now }: { health: HealthCheck[]; now: number }) {
  const colors = useColors(); const { t, numeric, space } = useLayout();
  return <Panel><View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}><Feather name="activity" size={18} color={colors.primary} /><Text style={[t.title3, { color: colors.foreground }]}>Service pulse</Text></View>{health.map(check => {
    const stale = !Number.isFinite(Date.parse(check.checkedAt)) || now - Date.parse(check.checkedAt) > 2 * 3_600_000;
    const color = stale || check.status === "degraded" ? colors.warn : check.status === "healthy" ? colors.success : colors.destructive;
    return <View key={check.id} style={{ flexDirection: "row", alignItems: "center", gap: space.xs, paddingVertical: space.xxs }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} /><Text style={[t.caption, { color: colors.foreground, flex: 1 }]}>{check.name}</Text><Text style={[t.caption, numeric, { color, textAlign: "right" }]}>{stale ? "Stale" : check.status === "healthy" ? check.latencyMs === null ? "Reachable" : `${check.latencyMs} ms` : check.status === "degraded" ? "Degraded" : "Unavailable"}</Text></View>;
  })}{!health.length ? <Text style={[t.callout, { color: colors.mutedForeground }]}>Awaiting first check</Text> : null}<Text style={[t.caption, { color: colors.inkFaint }]}>Reachability at the last check, not a full app test or uptime guarantee.</Text></Panel>;
}

function Warning({ warning }: { warning: CostWarning }) {
  const colors = useColors(); const { t, space, radius } = useLayout();
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm, borderTopWidth: 1, borderColor: colors.border, paddingTop: space.md }}><View style={{ padding: space.xs, borderRadius: radius.sm, backgroundColor: warning.severity === "critical" ? colors.destructiveSoft : colors.warnSoft }}><Feather name="alert-circle" size={18} color={warning.severity === "critical" ? colors.destructive : colors.warn} /></View><View style={{ flex: 1, gap: space.xxs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{warning.title}</Text><Text style={[t.callout, { color: colors.mutedForeground }]}>{warning.detail}</Text></View></View>;
}
