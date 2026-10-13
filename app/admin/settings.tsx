import { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { DEFAULT_EMAIL_TEMPLATES, DEFAULT_FIELDS, FEDERATIONS, type RequestStatus } from "@/shared/gcv";
import { Field, GCV, LoadingBlock, PrimaryButton, SectionCard } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

type ExtraField = keyof typeof DEFAULT_FIELDS;
type FieldRule = { visible: boolean; required: boolean };
type TemplateKey = keyof typeof DEFAULT_EMAIL_TEMPLATES;
type TemplateSet = Record<TemplateKey, string>;
type ExportScope = "ALL" | "CONFIRMED" | "PENDING" | "HISTORY";

const FIELD_LABELS: Record<ExtraField, string> = {
  interventionType: "Type d’intervention",
  message: "Message ou informations complémentaires",
  desiredTime: "Heure souhaitée",
  churchAddress: "Adresse de l’église",
};
const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  requestSubject: "Nouvelle demande — objet",
  requestBody: "Nouvelle demande — message",
  confirmationSubject: "Confirmation — objet",
  confirmationBody: "Confirmation — message",
  refusalSubject: "Refus / libération — objet",
  refusalBody: "Refus / libération — message",
  cancellationSubject: "Annulation — objet",
  cancellationBody: "Annulation — message",
  rescheduleSubject: "Déplacement — objet",
  rescheduleBody: "Déplacement — message",
  updateSubject: "Modification — objet",
  updateBody: "Modification — message",
  reminderSubject: "Rappel — objet",
  reminderBody: "Rappel — message",
};
const TEMPLATE_HELP = "Variables : {{prenom}}, {{date}}, {{eglise}}, {{federation}}, {{contact}}, {{email}}, {{telephone}}, {{type}}, {{heure}}, {{adresse}}, {{message}}, {{identifiant}}, {{lien_agenda}}.";
const CURRENT_YEAR = String(new Date().getFullYear());
const OUTBOX_LABEL = { PENDING: "En attente", PREVIEW: "Preview · pas encore envoyé", SENDING: "Envoi en cours", SENT: "Envoyé", FAILED: "Échec d’envoi" } as const;

type SettingsPayload = { federations?: unknown; fields?: unknown; reminders?: unknown; retention?: unknown; emailTemplates?: unknown };
type SettingsDraft = {
  federations: string[];
  fieldRules: Record<ExtraField, FieldRule>;
  reminders: { enabled: boolean; includeRequester: boolean };
  retentionMonths: string;
  templates: TemplateSet;
};

function makeSettingsDraft(data?: SettingsPayload): SettingsDraft {
  const incomingFields = data?.fields as Partial<Record<ExtraField, Partial<FieldRule>>> | undefined;
  const incomingReminders = data?.reminders as { enabled?: boolean; includeRequester?: boolean } | undefined;
  const retention = data?.retention as { months?: number } | undefined;
  return {
    federations: Array.isArray(data?.federations) ? data.federations as string[] : [...FEDERATIONS],
    fieldRules: {
      interventionType: { ...DEFAULT_FIELDS.interventionType, ...incomingFields?.interventionType },
      message: { ...DEFAULT_FIELDS.message, ...incomingFields?.message },
      desiredTime: { ...DEFAULT_FIELDS.desiredTime, ...incomingFields?.desiredTime },
      churchAddress: { ...DEFAULT_FIELDS.churchAddress, ...incomingFields?.churchAddress },
    },
    reminders: { enabled: incomingReminders?.enabled ?? true, includeRequester: incomingReminders?.includeRequester ?? false },
    retentionMonths: String(retention?.months ?? 36),
    templates: { ...DEFAULT_EMAIL_TEMPLATES, ...(data?.emailTemplates as Partial<TemplateSet> | undefined) },
  };
}

export default function SettingsScreen() {
  const router = useRouter();
  const settings = trpc.admin.settings.useQuery();
  const update = trpc.admin.updateSetting.useMutation({ onSuccess: () => { void settings.refetch(); } });
  const gmail = trpc.admin.gmailMailStatus.useQuery();
  const scheduler = trpc.admin.schedulerStatus.useQuery();
  const outbox = trpc.admin.emailOutbox.useQuery();
  const retentionRun = trpc.admin.runRetention.useMutation({ onSuccess: () => { void settings.refetch(); } });
  const retryEmail = trpc.admin.retryEmail.useMutation({ onSuccess: () => { void outbox.refetch(); } });

  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const configuration = draft ?? makeSettingsDraft(settings.data as SettingsPayload | undefined);
  const { federations, fieldRules, reminders, retentionMonths, templates } = configuration;
  const updateDraft = (change: (current: SettingsDraft) => SettingsDraft) => setDraft((current) => change(current ?? makeSettingsDraft(settings.data as SettingsPayload | undefined)));
  const setFederations = (value: string[] | ((current: string[]) => string[])) => updateDraft((current) => ({ ...current, federations: typeof value === "function" ? value(current.federations) : value }));
  const setFieldRules = (value: Record<ExtraField, FieldRule> | ((current: Record<ExtraField, FieldRule>) => Record<ExtraField, FieldRule>)) => updateDraft((current) => ({ ...current, fieldRules: typeof value === "function" ? value(current.fieldRules) : value }));
  const setReminders = (value: { enabled: boolean; includeRequester: boolean } | ((current: { enabled: boolean; includeRequester: boolean }) => { enabled: boolean; includeRequester: boolean })) => updateDraft((current) => ({ ...current, reminders: typeof value === "function" ? value(current.reminders) : value }));
  const setRetentionMonths = (value: string | ((current: string) => string)) => updateDraft((current) => ({ ...current, retentionMonths: typeof value === "function" ? value(current.retentionMonths) : value }));
  const setTemplates = (value: TemplateSet | ((current: TemplateSet) => TemplateSet)) => updateDraft((current) => ({ ...current, templates: typeof value === "function" ? value(current.templates) : value }));
  const [newFederation, setNewFederation] = useState("");
  const [exportYear, setExportYear] = useState(CURRENT_YEAR);
  const [exportFederation, setExportFederation] = useState("");
  const [exportScope, setExportScope] = useState<ExportScope>("ALL");

  const exportFilters = useMemo(() => ({
    year: /^\d{4}$/.test(exportYear) ? exportYear : undefined,
    federation: exportFederation || undefined,
    status: exportScope === "ALL" ? undefined : exportScope === "HISTORY" ? ["REFUSED", "CANCELLED", "RESCHEDULED"] as RequestStatus[] : [exportScope] as RequestStatus[],
  }), [exportYear, exportFederation, exportScope]);
  const exportCsv = trpc.admin.export.useQuery({ format: "csv", ...exportFilters }, { enabled: false });
  const exportXlsx = trpc.admin.export.useQuery({ format: "xlsx", ...exportFilters }, { enabled: false });

  const saveFederations = () => update.mutate({ key: "federations", value: federations });
  const addFederation = () => {
    const value = newFederation.trim();
    if (!value || federations.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    setFederations((current) => [...current, value]);
    setNewFederation("");
  };
  const removeFederation = (value: string) => setFederations((current) => current.filter((item) => item !== value));
  const saveFields = () => update.mutate({ key: "fields", value: fieldRules });
  const saveReminders = () => update.mutate({ key: "reminders", value: { ...reminders, recipient: "gcv.ufb@adventiste.org" } });
  const saveRetention = () => update.mutate({ key: "retention", value: { months: Number(retentionMonths) } });
  const saveTemplates = () => update.mutate({ key: "emailTemplates", value: templates });

  const download = async (format: "csv" | "xlsx") => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const result = format === "csv" ? await exportCsv.refetch() : await exportXlsx.refetch();
    const payload = result.data;
    if (!payload) return;
    const raw = atob(payload.contentBase64);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: payload.mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = payload.filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const requestRetention = () => {
    const run = () => retentionRun.mutate();
    const message = `Les anciennes demandes terminées au-delà de ${retentionMonths} mois seront anonymisées. Cette opération ne supprime pas les demandes en attente ou les interventions futures.`;
    if (Platform.OS === "web") {
      if (window.confirm(`${message}\n\nContinuer ?`)) run();
    } else {
      Alert.alert("Exécuter la rétention RGPD ?", message, [
        { text: "Annuler", style: "cancel" },
        { text: "Anonymiser", style: "destructive", onPress: run },
      ]);
    }
  };

  if (settings.isLoading) return <ScreenContainer containerClassName="bg-[#F4F8FB]"><LoadingBlock label="Chargement des réglages…" /></ScreenContainer>;

  return <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5"><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.back} onPress={() => router.back()}>‹ Tableau de bord</Text>
    <Text style={styles.title}>Réglages</Text>

    <SectionCard>
      <Text style={styles.section}>Fédérations</Text>
      <Text style={styles.text}>Les catégories ajoutées ici apparaissent dans le formulaire public et dans les filtres du tableau de bord.</Text>
      <View style={styles.chips}>{federations.map((item) => <View key={item} style={styles.federationChip}><Text style={styles.chipText}>{item}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${item}`} onPress={() => removeFederation(item)}><Text style={styles.remove}>×</Text></Pressable></View>)}</View>
      <Field label="Ajouter une fédération ou un territoire" value={newFederation} onChangeText={setNewFederation} placeholder="Ex. Fédération Suisse Romande" />
      <View style={styles.row}><View style={{ flex: 1 }}><PrimaryButton label="AJOUTER" tone="secondary" onPress={addFederation} disabled={!newFederation.trim()} /></View><View style={{ flex: 1 }}><PrimaryButton label="ENREGISTRER" onPress={saveFederations} disabled={update.isPending || federations.length === 0} /></View></View>
    </SectionCard>

    <SectionCard>
      <Text style={styles.section}>Champs du formulaire public</Text>
      <Text style={styles.text}>Les quatre champs facultatifs du formulaire peuvent être masqués ou rendus obligatoires. Les champs obligatoires sont toujours visibles.</Text>
      {(Object.keys(FIELD_LABELS) as ExtraField[]).map((key) => <View key={key} style={styles.ruleRow}>
        <Text style={styles.fieldTitle}>{FIELD_LABELS[key]}</Text>
        <View style={styles.row}><Toggle label={fieldRules[key].visible ? "Visible" : "Masqué"} selected={fieldRules[key].visible} onPress={() => setFieldRules((current) => ({ ...current, [key]: { visible: !current[key].visible, required: current[key].visible ? false : current[key].required } }))} /><Toggle label={fieldRules[key].required ? "Obligatoire" : "Facultatif"} selected={fieldRules[key].required} disabled={!fieldRules[key].visible} onPress={() => setFieldRules((current) => ({ ...current, [key]: { ...current[key], required: !current[key].required } }))} /></View>
      </View>)}
      <PrimaryButton label="ENREGISTRER LES CHAMPS" onPress={saveFields} disabled={update.isPending} />
    </SectionCard>

    <SectionCard>
      <Text style={styles.section}>Modèles d’e-mail</Text>
      <Text style={styles.text}>Modifiez les objets et les messages en texte brut. Le système échappe automatiquement le contenu HTML. Les boutons de décision et l’adresse de réponse gcv.ufb@adventiste.org restent fixes.</Text>
      <Text style={styles.helper}>{TEMPLATE_HELP}</Text>
      {(Object.keys(TEMPLATE_LABELS) as TemplateKey[]).map((key) => <Field key={key} label={TEMPLATE_LABELS[key]} value={templates[key]} onChangeText={(value) => setTemplates((current) => ({ ...current, [key]: value }))} multiline={!key.endsWith("Subject")} placeholder={DEFAULT_EMAIL_TEMPLATES[key]} />)}
      <PrimaryButton label="ENREGISTRER LES MODÈLES" onPress={saveTemplates} disabled={update.isPending} />
    </SectionCard>

    <SectionCard>
      <Text style={styles.section}>Rappels automatiques</Text>
      <Text style={styles.text}>Le schedule quotidien vérifie J-30, J-7 et J-1. L’adresse administrative reçoit les rappels; l’envoi au demandeur est facultatif.</Text>
      <Toggle label={reminders.enabled ? "Rappels activés" : "Rappels désactivés"} selected={reminders.enabled} onPress={() => setReminders((current) => ({ ...current, enabled: !current.enabled }))} />
      <Toggle label={reminders.includeRequester ? "Copie au demandeur" : "Ne pas envoyer au demandeur"} selected={reminders.includeRequester} onPress={() => setReminders((current) => ({ ...current, includeRequester: !current.includeRequester }))} />
      <PrimaryButton label="ENREGISTRER LES RAPPELS" tone="secondary" onPress={saveReminders} disabled={update.isPending} />
      {scheduler.isLoading ? <LoadingBlock label="Vérification du travail planifié…" /> : <Text style={scheduler.data?.configured && scheduler.data.active ? styles.connected : styles.pending}>{scheduler.data?.configured && scheduler.data.active ? "Schedule lié à l’application." : "Le schedule sera créé après la première publication réussie."}</Text>}
      <Text style={styles.helper}>La rétention RGPD peut également être réglée ici. Les demandes en attente et les interventions futures ne sont jamais anonymisées automatiquement.</Text>
      <Field label="Conservation des demandes terminées (mois, 1–120)" value={retentionMonths} onChangeText={setRetentionMonths} keyboardType="number-pad" />
      <View style={styles.row}><View style={{ flex: 1 }}><PrimaryButton label="ENREGISTRER LA DURÉE" tone="secondary" onPress={saveRetention} disabled={update.isPending} /></View><View style={{ flex: 1 }}><PrimaryButton label={retentionRun.isPending ? "ANONYMISATION…" : "EXÉCUTER MAINTENANT"} tone="warning" onPress={requestRetention} disabled={retentionRun.isPending || !/^\d+$/.test(retentionMonths)} /></View></View>
      {retentionRun.data ? <Text style={styles.connected}>{retentionRun.data.anonymized} demande(s) anonymisée(s); seuil configuré : {retentionRun.data.months} mois.</Text> : null}
      {retentionRun.error ? <Text style={styles.error}>{retentionRun.error.message}</Text> : null}
    </SectionCard>

    <SectionCard>
      <Text style={styles.section}>Gmail API · envoi des e-mails</Text>
      <Text style={styles.text}>L’envoi des e-mails est assuré par l’API Gmail avec une autorisation OAuth sécurisée. Les identifiants et jetons d’autorisation sont conservés de manière sécurisée sur le serveur et ne sont jamais affichés dans l’application.</Text>
      {gmail.isLoading ? (
        <LoadingBlock label="Vérification de la configuration Gmail…" />
      ) : gmail.error ? (
        <Text style={styles.error}>{gmail.error.message}</Text>
      ) : gmail.data?.configured && gmail.data?.connected ? (
        <>
          <Text style={styles.connected}>Service Gmail configuré et prêt.</Text>
          <Text style={styles.helper}>Compte d’envoi : {gmail.data.email}</Text>
          <Text style={styles.helper}>Adresse administrative et de réponse : gcv.ufb@adventiste.org.</Text>
        </>
      ) : (
        <>
          <Text style={styles.pending}>Le service Gmail API n’est pas encore configuré.</Text>
          <Text style={styles.helper}>L’autorisation Google doit être effectuée par l’administrateur avant de pouvoir envoyer des e-mails.</Text>
        </>
      )}
    </SectionCard>

    <SectionCard>
      <Text style={styles.section}>Journal des e-mails</Text>
      <Text style={styles.text}>Les derniers messages et leurs statuts. Une retentative peut dupliquer un message si le serveur de messagerie l’a déjà accepté avant une interruption réseau; utilisez-la uniquement après vérification.</Text>
      {outbox.isLoading ? <LoadingBlock label="Chargement de la file d’e-mails…" /> : outbox.error ? <Text style={styles.error}>{outbox.error.message}</Text> : outbox.data?.length ? outbox.data.map((item) => <View key={item.id} style={styles.outboxRow}>
        <View style={{ flex: 1, gap: 3 }}><Text style={styles.fieldTitle}>{item.subject}</Text><Text style={styles.helper}>{item.recipient} · {new Date(item.createdAt).toLocaleString("fr-FR")}</Text><Text style={item.status === "SENT" ? styles.connected : item.status === "FAILED" ? styles.error : styles.pending}>{OUTBOX_LABEL[item.status]}</Text>{item.lastError ? <Text style={styles.error}>{item.lastError}</Text> : null}</View>
        {item.status === "FAILED" || item.status === "PREVIEW" ? <Pressable accessibilityRole="button" onPress={() => retryEmail.mutate({ id: item.id })} disabled={retryEmail.isPending} style={styles.retryButton}><Text style={styles.retryText}>RÉESSAYER</Text></Pressable> : null}
      </View>) : <Text style={styles.helper}>Aucun e-mail enregistré.</Text>}
      {retryEmail.error ? <Text style={styles.error}>{retryEmail.error.message}</Text> : null}
    </SectionCard>

    <SectionCard>
      <Text style={styles.section}>Export des données</Text>
      <Text style={styles.text}>Téléchargez l’agenda et l’historique filtrés en CSV ou Excel. Le filtre porte sur l’année de la date de prédication.</Text>
      <Field label="Année (AAAA; vide = toutes)" value={exportYear} onChangeText={setExportYear} placeholder={CURRENT_YEAR} keyboardType="number-pad" />
      <Text style={styles.fieldTitle}>Fédération</Text><View style={styles.chips}><Chip label="Toutes" selected={!exportFederation} onPress={() => setExportFederation("")} />{federations.map((item) => <Chip key={item} label={item} selected={exportFederation === item} onPress={() => setExportFederation(item)} />)}</View>
      <Text style={styles.fieldTitle}>État</Text><View style={styles.chips}><Chip label="Tous" selected={exportScope === "ALL"} onPress={() => setExportScope("ALL")} /><Chip label="Confirmées" selected={exportScope === "CONFIRMED"} onPress={() => setExportScope("CONFIRMED")} /><Chip label="En attente" selected={exportScope === "PENDING"} onPress={() => setExportScope("PENDING")} /><Chip label="Historique clos" selected={exportScope === "HISTORY"} onPress={() => setExportScope("HISTORY")} /></View>
      <View style={styles.row}><View style={{ flex: 1 }}><PrimaryButton label={exportCsv.isFetching ? "PRÉPARATION…" : "TÉLÉCHARGER CSV"} tone="secondary" icon="download-outline" onPress={() => void download("csv")} disabled={exportCsv.isFetching || Platform.OS !== "web"} /></View><View style={{ flex: 1 }}><PrimaryButton label={exportXlsx.isFetching ? "PRÉPARATION…" : "TÉLÉCHARGER EXCEL"} tone="secondary" icon="download-outline" onPress={() => void download("xlsx")} disabled={exportXlsx.isFetching || Platform.OS !== "web"} /></View></View>
      {Platform.OS !== "web" ? <Text style={styles.helper}>Ouvrez le même espace administrateur dans un navigateur pour télécharger les fichiers sur mobile.</Text> : null}
      {exportCsv.error ? <Text style={styles.error}>{exportCsv.error.message}</Text> : null}{exportXlsx.error ? <Text style={styles.error}>{exportXlsx.error.message}</Text> : null}
    </SectionCard>

    {update.error ? <Text style={styles.error}>{update.error.message}</Text> : null}
  </ScrollView></ScreenContainer>;
}

function Toggle({ label, selected, onPress, disabled = false }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} onPress={onPress} disabled={disabled} style={[styles.toggle, selected && styles.toggleSelected, disabled && styles.toggleDisabled]}><View style={[styles.toggleDot, selected && styles.toggleDotSelected]} /><Text style={[styles.toggleLabel, selected && styles.toggleLabelSelected]}>{label}</Text></Pressable>;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create<any>({
  content: { paddingTop: 18, paddingBottom: 40, gap: 15, alignSelf: "center", width: "100%", maxWidth: 780 },
  back: { color: GCV.blue, fontWeight: "700" },
  title: { color: GCV.navy, fontSize: 28, fontWeight: "900" },
  section: { color: GCV.navy, fontSize: 17, fontWeight: "850" },
  text: { color: GCV.muted, fontSize: 13, lineHeight: 20 },
  helper: { color: GCV.muted, fontSize: 12, lineHeight: 18 },
  fieldTitle: { color: GCV.text, fontSize: 12, fontWeight: "850" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  federationChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EFF6FA", borderRadius: 99, paddingVertical: 7, paddingHorizontal: 11 },
  chipText: { color: GCV.text, fontSize: 11, fontWeight: "800" },
  remove: { color: GCV.danger, fontSize: 17, fontWeight: "900" },
  ruleRow: { gap: 7, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: GCV.border },
  toggle: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: GCV.border, borderRadius: 99, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: "#fff" },
  toggleSelected: { borderColor: GCV.blue, backgroundColor: "#EAF3F8" },
  toggleDisabled: { opacity: 0.45 },
  toggleDot: { width: 9, height: 9, borderRadius: 99, backgroundColor: "#AAB8C2" },
  toggleDotSelected: { backgroundColor: GCV.blue },
  toggleLabel: { color: GCV.text, fontSize: 11, fontWeight: "750" },
  toggleLabelSelected: { color: GCV.navy },
  chip: { borderWidth: 1, borderColor: GCV.border, borderRadius: 99, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: "#fff" },
  chipSelected: { borderColor: GCV.navy, backgroundColor: GCV.navy },
  chipTextSelected: { color: "#fff" },
  outboxRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: GCV.border },
  retryButton: { backgroundColor: "#E8F0F6", borderRadius: 8, paddingVertical: 9, paddingHorizontal: 10 },
  retryText: { color: GCV.navy, fontSize: 10, fontWeight: "900" },
  uri: { color: GCV.blue, backgroundColor: "#F4F8FB", padding: 10, borderRadius: 8, fontFamily: Platform.OS === "web" ? "monospace" : undefined, fontSize: 12 },
  pending: { color: "#84560B", backgroundColor: "#FFF6E7", padding: 11, borderRadius: 9, fontSize: 12, lineHeight: 18, fontWeight: "750" },
  connected: { color: "#176B43", backgroundColor: "#E7F5EC", padding: 11, borderRadius: 9, fontSize: 12, lineHeight: 18, fontWeight: "800" },
  error: { color: GCV.danger, fontSize: 13, lineHeight: 19, fontWeight: "700" },
});
