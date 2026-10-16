import { useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/hooks/use-auth";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Field, GCV, LoadingBlock, PrimaryButton, SectionCard } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { FEDERATIONS, toFrenchDate } from "@/shared/gcv";

type RequestStatus = "PENDING" | "CONFIRMED" | "REFUSED" | "CANCELLED" | "RESCHEDULED";
type Disposition = "AVAILABLE" | "UNAVAILABLE";
type Editor = { requestId: number; federation: string; church: string; contactName: string; email: string; phone: string; interventionType: string; message: string; desiredTime: string; churchAddress: string };
const statusOptions: { value: RequestStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Toutes" }, { value: "PENDING", label: "En attente" }, { value: "CONFIRMED", label: "Confirmées" },
  { value: "REFUSED", label: "Refusées" }, { value: "CANCELLED", label: "Annulées" }, { value: "RESCHEDULED", label: "Déplacées" },
];
const labelStatus: Record<RequestStatus, string> = { PENDING: "En attente", CONFIRMED: "Confirmée", REFUSED: "Refusée", CANCELLED: "Annulée", RESCHEDULED: "Déplacée" };
const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const currentYear = String(now.getFullYear());

export default function AdminRequestsScreen() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const selectedRequestId = requestId && /^\d+$/.test(requestId)
    ? Number(requestId)
    : undefined;
  const { user } = useAuth();
  const canWrite = user?.adminRole === "PRIMARY_ADMIN" || user?.adminRole === "ADMIN";
  const [status, setStatus] = useState<RequestStatus | "ALL">("ALL");
  const [departmentId, setDepartmentId] = useState<number | undefined>();
  const departments = trpc.admin.departments.useQuery();
  const [search, setSearch] = useState("");
  const [federation, setFederation] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [rescheduling, setRescheduling] = useState<number | null>(null);
  const [targetSlotId, setTargetSlotId] = useState<number | null>(null);
  const [oldDisposition, setOldDisposition] = useState<Disposition>("AVAILABLE");
  const [calendarMonth, setCalendarMonth] = useState(currentMonth);
  const filters = useMemo(() => ({ departmentId, status: status === "ALL" ? undefined : [status], search: search.trim() || undefined, federation: federation || undefined, month: month || undefined, year: /^\d{4}$/.test(year) ? year : undefined }), [departmentId, status, search, federation, month, year]);
  const requests = trpc.admin.requests.useQuery(filters);
  const visibleRequests = selectedRequestId === undefined
    ? requests.data
    : requests.data?.filter(({ request }) => request.id === selectedRequestId);
  const settings = trpc.admin.formOptions.useQuery();
  const federations = (settings.data?.federations as string[] | undefined) ?? [...FEDERATIONS];
  const reschedulingRequest = requests.data?.find(({ request }) => request.id === rescheduling)?.request;
  const reschedulingDepartmentId = reschedulingRequest?.departmentId;
  const availableSlots = trpc.admin.calendar.useQuery(
    { month: calendarMonth, status: "AVAILABLE", departmentId: reschedulingDepartmentId, federation: reschedulingRequest?.federation },
    { enabled: reschedulingDepartmentId !== undefined },
  );
  const utils = trpc.useUtils();
  const decide = trpc.admin.decide.useMutation({ onSuccess: () => { void utils.admin.requests.invalidate(); void utils.admin.dashboard.invalidate(); void utils.admin.calendar.invalidate(); } });
  const cancel = trpc.admin.cancel.useMutation({ onSuccess: () => { void utils.admin.requests.invalidate(); void utils.admin.dashboard.invalidate(); void utils.admin.calendar.invalidate(); setRescheduling(null); } });
  const reschedule = trpc.admin.reschedule.useMutation({ onSuccess: () => { void utils.admin.requests.invalidate(); void utils.admin.dashboard.invalidate(); void utils.admin.calendar.invalidate(); setRescheduling(null); setTargetSlotId(null); } });
  const update = trpc.admin.updateInvitation.useMutation({ onSuccess: () => { void utils.admin.requests.invalidate(); setEditor(null); } });
  const error = decide.error?.message ?? cancel.error?.message ?? reschedule.error?.message ?? update.error?.message;
  const confirm = (title: string, message: string, action: () => void) => {
    if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) action(); return; }
    Alert.alert(title, message, [{ text: "Annuler", style: "cancel" }, { text: "Confirmer", style: "destructive", onPress: action }]);
  };
  const openEditor = (request: NonNullable<typeof requests.data>[number]["request"]) => setEditor({
    requestId: request.id, federation: request.federation, church: request.church, contactName: request.contactName, email: request.email,
    phone: request.phone, interventionType: request.interventionType ?? "", message: request.message ?? "", desiredTime: request.desiredTime ?? "", churchAddress: request.churchAddress ?? "",
  });
  const saveEditor = () => { if (editor) update.mutate({ ...editor, message: editor.message || null, desiredTime: editor.desiredTime || null, churchAddress: editor.churchAddress || null }); };

  return <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5">
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.back} onPress={() => router.back()}>‹ Tableau de bord</Text>
      <View style={styles.heading}><View style={{ flex: 1 }}><Text style={styles.kicker}>ESPACE ADMINISTRATEUR</Text><Text style={styles.title}>Demandes et invitations</Text></View><PrimaryButton label="AGENDA" icon="calendar-outline" tone="secondary" onPress={() => router.push("/admin/calendar" as never)} /></View>
      <SectionCard>
        <Text style={styles.section}>Rechercher et filtrer</Text>
        <Text style={styles.fieldLabel}>Département</Text>
        <View style={styles.filters}>
          <Chip label="Tous les départements autorisés" selected={departmentId === undefined} onPress={() => { setDepartmentId(undefined); setRescheduling(null); setTargetSlotId(null); }} />
          {(departments.data ?? []).map((department) => <Chip key={department.id} label={department.name} selected={departmentId === department.id} onPress={() => { setDepartmentId(department.id); setRescheduling(null); setTargetSlotId(null); }} />)}
        </View>
        {departments.isLoading ? <Text style={styles.muted}>Chargement des départements…</Text> : null}
        {departments.isError ? <Text style={styles.error}>Les départements ne peuvent pas être chargés.</Text> : null}
        <Field label="Église, contact ou e-mail" value={search} onChangeText={setSearch} placeholder="Rechercher…" autoCapitalize="none" />
        <View style={styles.filters}>{statusOptions.map((item) => <Chip key={item.value} label={item.label} selected={status === item.value} onPress={() => setStatus(item.value)} />)}</View>
        <Text style={styles.fieldLabel}>Fédération</Text><View style={styles.filters}>{["", ...federations].map((value) => <Chip key={value || "ALL"} label={value || "Toutes"} selected={federation === value} onPress={() => setFederation(value)} />)}</View>
        <Field label="Mois (AAAA-MM, facultatif)" value={month} onChangeText={setMonth} placeholder="2026-10" autoCapitalize="none" />
        <Field label="Année (AAAA, facultatif)" value={year} onChangeText={setYear} placeholder={currentYear} keyboardType="number-pad" />
        {visibleRequests ? <Text style={styles.muted}>{visibleRequests.length} demande(s) correspondant aux filtres.</Text> : null}
      </SectionCard>
      {requests.isLoading ? <LoadingBlock label="Chargement des demandes…" /> : requests.error ? <SectionCard><Text style={styles.error}>{requests.error.message}</Text></SectionCard> : visibleRequests?.length ? visibleRequests.map(({ request, slot, department }) => <SectionCard key={request.id}>
        <View style={styles.cardTop}><View style={{ flex: 1, gap: 3 }}><Text style={styles.date}>{toFrenchDate(slot.date)}</Text><Text style={styles.church}>{request.church}</Text><Text style={styles.muted}>{request.federation} · {request.contactName}</Text></View><View style={[styles.badge, { backgroundColor: request.status === "CONFIRMED" ? "#DCEFFC" : request.status === "PENDING" ? "#FFF0CF" : "#EEF1F3" }]}><Text style={styles.badgeText}>{labelStatus[request.status as RequestStatus]}</Text></View></View>
        <Text style={styles.detail}>Département : {department?.name ?? `Département #${request.departmentId}`}</Text>
        <Text style={styles.detail}>{request.email} · {request.phone}</Text>
        {request.interventionType ? <Text style={styles.detail}>Intervention : {request.interventionType}{request.desiredTime ? ` · ${request.desiredTime}` : ""}</Text> : null}
        {request.churchAddress ? <Text style={styles.detail}>Adresse : {request.churchAddress}</Text> : null}
        {request.message ? <Text style={styles.message}>{request.message}</Text> : null}
        <Text style={styles.small}>Référence {request.submissionId} · soumis le {new Date(request.submittedAt).toLocaleString("fr-FR")}</Text>
        {canWrite && request.status === "PENDING" ? <View style={styles.actionRow}><View style={{ flex: 1 }}><PrimaryButton label="CONFIRMER" icon="checkmark-circle-outline" onPress={() => confirm("Confirmer l’invitation ?", `${request.church} · ${toFrenchDate(slot.date)}`, () => decide.mutate({ requestId: request.id, action: "CONFIRM" }))} disabled={decide.isPending} /></View><View style={{ flex: 1 }}><PrimaryButton label="LIBÉRER / REFUSER" tone="warning" icon="arrow-undo-outline" onPress={() => confirm("Refuser la demande et libérer la date ?", `${request.church} · ${toFrenchDate(slot.date)}`, () => decide.mutate({ requestId: request.id, action: "RELEASE" }))} disabled={decide.isPending} /></View></View> : null}
        {canWrite && request.status === "CONFIRMED" ? <View style={styles.actions}><View style={styles.actionRow}><View style={{ flex: 1 }}><PrimaryButton label="MODIFIER LES INFORMATIONS" tone="secondary" icon="create-outline" onPress={() => openEditor(request)} /></View><View style={{ flex: 1 }}><PrimaryButton label="DÉPLACER LA DATE" tone="secondary" icon="calendar-outline" onPress={() => { setRescheduling(rescheduling === request.id ? null : request.id); setTargetSlotId(null); }} /></View></View><View style={styles.actionRow}><View style={{ flex: 1 }}><PrimaryButton label="ANNULER ET LIBÉRER" tone="warning" icon="arrow-undo-outline" onPress={() => confirm("Annuler l’invitation et libérer la date ?", "La date redeviendra disponible et le demandeur sera informé par e-mail si le service Gmail API est disponible.", () => cancel.mutate({ requestId: request.id, disposition: "AVAILABLE" }))} disabled={cancel.isPending} /></View><View style={{ flex: 1 }}><PrimaryButton label="ANNULER ET BLOQUER" tone="danger" icon="ban-outline" onPress={() => confirm("Annuler l’invitation et bloquer la date ?", "La date restera indisponible et le demandeur sera informé par e-mail si le service Gmail API est disponible.", () => cancel.mutate({ requestId: request.id, disposition: "UNAVAILABLE" }))} disabled={cancel.isPending} /></View></View></View> : null}
        {request.status === "CONFIRMED" && rescheduling === request.id ? <View style={styles.rescheduleBox}><Text style={styles.section}>Choisir une nouvelle date disponible</Text><MonthPicker value={calendarMonth} onChange={(value) => { setCalendarMonth(value); setTargetSlotId(null); }} /><View style={styles.filters}>{(availableSlots.data ?? []).map(({ slot: target }) => <Chip key={target.id} label={new Date(`${target.date}T12:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} selected={targetSlotId === target.id} onPress={() => setTargetSlotId(target.id)} />)}</View>{availableSlots.isLoading ? <LoadingBlock label="Recherche des dates libres…" /> : !availableSlots.data?.length ? <Text style={styles.muted}>Aucune date disponible pendant ce mois.</Text> : null}<Text style={styles.fieldLabel}>Après le déplacement, l’ancienne date :</Text><View style={styles.filters}><Chip label="Sera libérée" selected={oldDisposition === "AVAILABLE"} onPress={() => setOldDisposition("AVAILABLE")} /><Chip label="Sera bloquée" selected={oldDisposition === "UNAVAILABLE"} onPress={() => setOldDisposition("UNAVAILABLE")} /></View><PrimaryButton label="CONFIRMER LE DÉPLACEMENT" disabled={!targetSlotId || !availableSlots.data?.some(({ slot }) => slot.id === targetSlotId) || reschedule.isPending} onPress={() => targetSlotId && confirm("Déplacer l’invitation ?", `Nouvelle date : ${toFrenchDate(availableSlots.data?.find(({ slot: target }) => target.id === targetSlotId)?.slot.date ?? "")}`, () => reschedule.mutate({ requestId: request.id, newSlotId: targetSlotId, oldDisposition }))} />
        </View> : null}
        {editor?.requestId === request.id ? <View style={styles.editor}><Text style={styles.section}>Modifier les informations de l’invitation</Text><Field label="Fédération" value={editor.federation} onChangeText={(value) => setEditor({ ...editor, federation: value })}/><Field label="Église" value={editor.church} onChangeText={(value) => setEditor({ ...editor, church: value })}/><Field label="Nom et prénom" value={editor.contactName} onChangeText={(value) => setEditor({ ...editor, contactName: value })}/><Field label="E-mail" value={editor.email} onChangeText={(value) => setEditor({ ...editor, email: value })} autoCapitalize="none" keyboardType="email-address"/><Field label="Téléphone" value={editor.phone} onChangeText={(value) => setEditor({ ...editor, phone: value })} keyboardType="phone-pad"/><Field label="Type d’intervention" value={editor.interventionType} onChangeText={(value) => setEditor({ ...editor, interventionType: value })}/><Field label="Heure souhaitée" value={editor.desiredTime} onChangeText={(value) => setEditor({ ...editor, desiredTime: value })}/><Field label="Adresse de l’église" value={editor.churchAddress} onChangeText={(value) => setEditor({ ...editor, churchAddress: value })}/><Field label="Informations complémentaires" value={editor.message} onChangeText={(value) => setEditor({ ...editor, message: value })} multiline/><View style={styles.actionRow}><View style={{ flex: 1 }}><PrimaryButton label="ENREGISTRER" icon="save-outline" onPress={saveEditor} disabled={update.isPending}/></View><View style={{ flex: 1 }}><PrimaryButton label="ANNULER" tone="secondary" onPress={() => setEditor(null)}/></View></View></View> : null}
      </SectionCard>) : <SectionCard><Text style={styles.section}>Aucune demande pour ces filtres</Text><Text style={styles.muted}>Modifiez la période ou le statut pour afficher l’historique des invitations.</Text></SectionCard>}
      {error ? <SectionCard><Text style={styles.error}>{error}</Text></SectionCard> : null}
    </ScrollView>
  </ScreenContainer>;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}
function MonthPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const shift = (amount: number) => { const date = new Date(`${value}-01T12:00:00`); date.setMonth(date.getMonth() + amount); onChange(date.toISOString().slice(0, 7)); };
  return <View style={styles.monthPicker}><Pressable onPress={() => shift(-1)}><Text style={styles.link}>‹</Text></Pressable><Text style={styles.month}>{new Date(`${value}-01T12:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</Text><Pressable onPress={() => shift(1)}><Text style={styles.link}>›</Text></Pressable></View>;
}

const styles = StyleSheet.create<any>({
  content: { paddingTop: 18, paddingBottom: 40, gap: 14, alignSelf: "center", width: "100%", maxWidth: 960 },
  back: { color: GCV.blue, fontWeight: "800" }, kicker: { color: GCV.blue, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, title: { color: GCV.navy, fontSize: 27, fontWeight: "900" },
  section: { color: GCV.navy, fontSize: 16, fontWeight: "850" }, fieldLabel: { color: GCV.text, fontSize: 12, fontWeight: "800" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, chip: { borderWidth: 1, borderColor: GCV.border, borderRadius: 99, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: "#fff" },
  chipSelected: { backgroundColor: GCV.navy, borderColor: GCV.navy }, chipText: { color: GCV.text, fontSize: 11, fontWeight: "800" }, chipTextSelected: { color: "#fff" },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 9 }, date: { color: GCV.navy, fontSize: 15, fontWeight: "900", textTransform: "capitalize" }, church: { color: GCV.text, fontSize: 16, fontWeight: "850" },
  badge: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: 99 }, badgeText: { color: GCV.navy, fontSize: 11, fontWeight: "850" },
  muted: { color: GCV.muted, fontSize: 12, lineHeight: 18 }, detail: { color: GCV.text, fontSize: 13, lineHeight: 19 }, message: { color: GCV.text, fontSize: 13, lineHeight: 20, backgroundColor: "#F4F8FB", borderRadius: 10, padding: 11 },
  small: { color: GCV.muted, fontSize: 10 }, actionRow: { flexDirection: "row", gap: 8 }, actions: { gap: 8 }, rescheduleBox: { gap: 11, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: GCV.border, backgroundColor: "#F8FBFD" },
  monthPicker: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8 }, month: { color: GCV.navy, fontWeight: "850", textTransform: "capitalize" }, link: { color: GCV.blue, fontWeight: "900", fontSize: 22, paddingHorizontal: 12 },
  editor: { gap: 9, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: GCV.border, backgroundColor: "#F8FBFD" }, error: { color: GCV.danger, fontWeight: "800", fontSize: 12 },
});
