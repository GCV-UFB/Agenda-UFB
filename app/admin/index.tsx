import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import * as Api from "@/lib/_core/api";
import { useState } from "react";
import { EmptyState, GCV, LoadingBlock, PrimaryButton, SectionCard, StatusPill } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { toFrenchDate } from "@/shared/gcv";

export default function AdminDashboard() {
  const router = useRouter();
  const auth = useAuth();
  const isPrimaryAdmin = auth.user?.adminRole === "PRIMARY_ADMIN";
  const canWrite = auth.user?.adminRole === "PRIMARY_ADMIN" || auth.user?.adminRole === "ADMIN";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const login = async () => {
    try {
      setLoggingIn(true); setLoginError("");
      await Api.loginAdmin(email, password);
      await auth.refresh();
      setPassword("");
    } catch (e) { setLoginError(e instanceof Error ? e.message : "Connexion impossible"); }
    finally { setLoggingIn(false); }
  };
  const dashboard = trpc.admin.dashboard.useQuery(undefined, { enabled: auth.isAuthenticated });
  const requests = trpc.admin.requests.useQuery({ status: ["PENDING"] }, { enabled: auth.isAuthenticated });
  const decide = trpc.admin.decide.useMutation({ onSuccess: () => { void dashboard.refetch(); void requests.refetch(); } });
  const action = async (requestId: number, choice: "CONFIRM" | "RELEASE") => { await decide.mutateAsync({ requestId, action: choice }); };
  if (auth.loading) return <ScreenContainer containerClassName="bg-[#F4F8FB]"><LoadingBlock label="Vérification de l’accès…" /></ScreenContainer>;
  if (!auth.isAuthenticated) return <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5 justify-center"><View style={styles.center}><SectionCard style={styles.loginCard}><Text style={styles.kicker}>ACCÈS SÉCURISÉ</Text><Text style={styles.title}>Espace administrateur</Text><Text style={styles.text}>Accès réservé aux responsables autorisés de l’Agenda UFB.</Text><TextInput value={email} onChangeText={setEmail} placeholder="Adresse e-mail" placeholderTextColor="#789" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={styles.passwordInput}/><TextInput secureTextEntry value={password} onChangeText={setPassword} placeholder="Mot de passe" placeholderTextColor="#789" onSubmitEditing={() => void login()} style={styles.passwordInput}/>{loginError ? <Text style={styles.error}>{loginError}</Text> : null}<PrimaryButton label={loggingIn ? "CONNEXION…" : "SE CONNECTER"} icon="log-in-outline" onPress={() => void login()} disabled={loggingIn || email.trim().length === 0 || password.length === 0} /><PrimaryButton label="RETOUR À L’ACCUEIL" tone="secondary" onPress={() => router.replace("/" as never)} /></SectionCard></View></ScreenContainer>;
  if (dashboard.isLoading) return <ScreenContainer containerClassName="bg-[#F4F8FB]"><LoadingBlock label="Chargement du tableau de bord…" /></ScreenContainer>;
  if (dashboard.error) return <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5 justify-center"><View style={styles.center}><SectionCard><Text style={styles.title}>Accès administrateur requis</Text><Text style={styles.text}>Cette identité est connectée mais ne fait pas partie des administrateurs autorisés. Contactez gcv.ufb@adventiste.org.</Text><PrimaryButton label="RETOUR À L’ACCUEIL" tone="secondary" onPress={() => router.replace("/" as never)} /></SectionCard></View></ScreenContainer>;
  const data = dashboard.data!;
  const months = Object.entries(data.perMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const maxMonth = Math.max(1, ...months.map(([, count]) => count));
  return <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5"><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.top}><View><Text style={styles.kicker}>UFB · ADMINISTRATION</Text><Text style={styles.title}>Bonjour {auth.user?.name?.split(" ")[0] || ""}</Text></View><PrimaryButton label="DÉCONNEXION" tone="secondary" onPress={() => auth.logout()} /></View>
    <View style={styles.quick}>
      <PrimaryButton label="DEMANDES" icon="file-tray-full-outline" onPress={() => router.push("/admin/requests" as never)} />
      <PrimaryButton label="AGENDA" icon="calendar-outline" onPress={() => router.push("/admin/calendar" as never)} />
      {isPrimaryAdmin ? <>
        <PrimaryButton label="RÉGLAGES" tone="secondary" icon="settings-outline" onPress={() => router.push("/admin/settings" as never)} />
        <PrimaryButton label="HISTORIQUE" tone="secondary" icon="time-outline" onPress={() => router.push("/admin/history" as never)} />
        <PrimaryButton label="DROITS RGPD" tone="secondary" icon="shield-checkmark-outline" onPress={() => router.push("/admin/privacy" as never)} />
      </> : null}
    </View>
    <View style={styles.metrics}><Metric label="Dates disponibles" value={data.available} tone="#176B43"/><Metric label="Demandes en attente" value={data.pending} tone="#A86B12"/><Metric label="Invitations confirmées" value={data.confirmed} tone="#176B9B"/><Metric label="Dates indisponibles" value={data.unavailable} tone="#8A3434"/></View>
    <SectionCard><Text style={styles.sectionTitle}>Prochaines interventions</Text>{data.upcoming.length ? data.upcoming.map(({ request, slot }) => <View key={request.id} style={styles.upcomingRow}><View style={{ flex: 1 }}><Text style={styles.nextDate}>{toFrenchDate(slot.date)}</Text><Text style={styles.text}>{request.church} · {request.federation}</Text></View><StatusPill status={slot.status}/></View>) : <Text style={styles.text}>Aucune intervention confirmée à venir.</Text>}<Text style={styles.year}>Interventions cette année : {data.yearlyInterventions}</Text></SectionCard>
    <SectionCard><Text style={styles.sectionTitle}>Interventions par mois</Text>{months.length ? months.map(([month, count]) => <View key={month} style={styles.monthRow}><Text style={styles.monthLabel}>{new Date(`${month}-01T12:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "numeric" })}</Text><View style={styles.track}><View style={[styles.bar, { width: `${Math.max(8, (count / maxMonth) * 100)}%` }]} /></View><Text style={styles.monthCount}>{count}</Text></View>) : <Text style={styles.text}>Aucune intervention confirmée enregistrée.</Text>}</SectionCard>
    <SectionCard><Text style={styles.sectionTitle}>Répartition par fédération</Text><View style={styles.federations}>{Object.entries(data.perFederation).map(([key, value]) => <View key={key} style={styles.federation}><Text style={styles.fedValue}>{value}</Text><Text style={styles.fedKey}>{key}</Text></View>)}</View></SectionCard>
    <View style={styles.pendingHeader}><Text style={styles.sectionTitle}>Demandes en attente</Text><Text style={styles.pendingCount}>{requests.data?.length ?? 0}</Text></View>
    {requests.isLoading ? <LoadingBlock label="Chargement des demandes…"/> : requests.data?.length ? requests.data.map(({ request, slot, department }) => <SectionCard key={request.id}><View style={styles.requestTop}><View style={{ flex: 1, gap: 2 }}><Text style={styles.requestDate}>{toFrenchDate(slot.date)}</Text><Text style={styles.requestChurch}>{request.church}</Text><Text style={styles.text}>{request.federation} · {request.contactName}</Text></View><StatusPill status={slot.status}/></View><Text style={styles.requestInfo}>{department?.name ?? `Département #${request.departmentId}`} · {request.interventionType} · {request.email}</Text>{canWrite ? <View style={styles.requestActions}><View style={{ flex: 1 }}><PrimaryButton label="CONFIRMER" icon="checkmark-circle-outline" onPress={() => action(request.id, "CONFIRM")} disabled={decide.isPending}/></View><View style={{ flex: 1 }}><PrimaryButton label="LIBÉRER" tone="warning" icon="arrow-undo-outline" onPress={() => action(request.id, "RELEASE")} disabled={decide.isPending}/></View></View> : null}{decide.error ? <Text style={styles.error}>{decide.error.message}</Text> : null}</SectionCard>) : <EmptyState title="Aucune demande en attente" detail="Les nouvelles invitations apparaîtront ici dès leur réception."/>}
  </ScrollView></ScreenContainer>;
}
function Metric({ label, value, tone }: { label: string; value: number; tone: string }) { return <View style={styles.metric}><Text style={[styles.metricValue, { color: tone }]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
const styles = StyleSheet.create<any>({
  center: { flex: 1, justifyContent: "center", alignSelf: "center", width: "100%", maxWidth: 520 }, loginCard: { gap: 15, padding: 24 }, passwordInput: { borderWidth: 1, borderColor: GCV.border, borderRadius: 10, backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 12, color: GCV.text, fontSize: 15 },
  content: { paddingTop: 18, paddingBottom: 36, gap: 14, alignSelf: "center", width: "100%", maxWidth: 960 }, top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, kicker: { color: GCV.blue, fontSize: 11, fontWeight: "900", letterSpacing: 1.05 }, title: { color: GCV.navy, fontSize: 27, lineHeight: 33, fontWeight: "850" }, text: { color: GCV.muted, fontSize: 13, lineHeight: 19 },
  quick: { gap: 8, flexDirection: "row", flexWrap: "wrap" }, metrics: { flexDirection: "row", flexWrap: "wrap", gap: 9 }, metric: { width: "48%", minWidth: 145, flexGrow: 1, backgroundColor: "#fff", borderWidth: 1, borderColor: GCV.border, borderRadius: 14, padding: 14, gap: 4 }, metricValue: { fontSize: 27, fontWeight: "900" }, metricLabel: { color: GCV.muted, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  sectionTitle: { color: GCV.navy, fontSize: 17, fontWeight: "850" }, nextDate: { color: GCV.navy, fontSize: 14, fontWeight: "800", textTransform: "capitalize" }, upcomingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: GCV.border }, year: { color: GCV.muted, fontSize: 13, fontWeight: "700" }, federations: { flexDirection: "row", gap: 10 }, federation: { flex: 1, borderRadius: 10, backgroundColor: "#EFF6FA", padding: 12, alignItems: "center" }, fedValue: { color: GCV.navy, fontSize: 21, fontWeight: "900" }, fedKey: { color: GCV.muted, fontSize: 12, fontWeight: "800" },
  monthRow: { flexDirection: "row", alignItems: "center", gap: 9 }, monthLabel: { width: 70, color: GCV.muted, fontSize: 11, textTransform: "capitalize" }, track: { flex: 1, height: 9, backgroundColor: "#E8F0F6", borderRadius: 99, overflow: "hidden" }, bar: { height: 9, backgroundColor: GCV.blue, borderRadius: 99 }, monthCount: { width: 22, textAlign: "right", color: GCV.navy, fontSize: 12, fontWeight: "850" },
  pendingHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, pendingCount: { color: GCV.blue, fontWeight: "900", fontSize: 17 }, requestTop: { flexDirection: "row", gap: 10 }, requestDate: { color: GCV.navy, fontWeight: "800", fontSize: 15, textTransform: "capitalize" }, requestChurch: { color: GCV.text, fontWeight: "800", fontSize: 16 }, requestInfo: { color: GCV.muted, fontSize: 13 }, requestActions: { flexDirection: "row", gap: 9 }, error: { color: GCV.danger, fontWeight: "700", fontSize: 12 },
});
