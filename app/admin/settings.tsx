import { useMemo, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { DEFAULT_EMAIL_TEMPLATES, DEFAULT_FIELDS, FEDERATIONS, type RequestStatus } from "@/shared/gcv";
import { Field, GCV, LoadingBlock, PrimaryButton, SectionCard } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { getApiBaseUrl } from "@/constants/oauth";
import { useAuth } from "@/hooks/use-auth";

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
const TEMPLATE_HELP = "Variables : {{departement}}, {{prenom}}, {{date}}, {{eglise}}, {{federation}}, {{contact}}, {{email}}, {{telephone}}, {{type}}, {{heure}}, {{adresse}}, {{message}}, {{identifiant}}, {{lien_agenda}}.";
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
      interventionType: { ...DEFAULT_FIELDS.interventionType },
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
  const { user, loading } = useAuth();
  const isPrimaryAdmin = user?.adminRole === "PRIMARY_ADMIN";
  const canAccessSettings = isPrimaryAdmin;
  const admins = trpc.admin.admins.useQuery(undefined, {
    enabled: isPrimaryAdmin,
  });
  const adminDepartments = trpc.admin.departments.useQuery(undefined, {
    enabled: true,
  });

  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminRole, setAdminRole] = useState<"PRIMARY_ADMIN" | "ADMIN" | "READ_ONLY">("ADMIN");
  const [adminDepartmentIds, setAdminDepartmentIds] = useState<number[]>([]);

  const [editingAdminId, setEditingAdminId] = useState<number | null>(null);
  const [editingAdminName, setEditingAdminName] = useState("");
  const [editingAdminEmail, setEditingAdminEmail] = useState("");
  const [editingAdminRole, setEditingAdminRole] = useState<"PRIMARY_ADMIN" | "ADMIN" | "READ_ONLY">("ADMIN");
  const [editingAdminActive, setEditingAdminActive] = useState<"YES" | "NO">("YES");
  const [editingAdminDepartmentIds, setEditingAdminDepartmentIds] = useState<number[]>([]);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [adminEditFeedback, setAdminEditFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const updateAdmin = trpc.admin.updateAdmin.useMutation({
    onSuccess: async () => {
      await admins.refetch();
      setAdminEditFeedback({
        type: "success",
        message: "Compte administrateur mis à jour avec succès.",
      });
    },
    onError: (error) => {
      setAdminEditFeedback({
        type: "error",
        message: error.message || "Le compte n’a pas pu être modifié.",
      });
    },
  });

  const resetAdminPassword = trpc.admin.resetAdminPassword.useMutation({
    onSuccess: () => {
      setTemporaryPassword("");
      setAdminEditFeedback({
        type: "success",
        message: "Mot de passe provisoire modifié avec succès.",
      });
    },
    onError: (error) => {
      setAdminEditFeedback({
        type: "error",
        message: error.message || "Le mot de passe n’a pas pu être modifié.",
      });
    },
  });

  const [adminCreateFeedback, setAdminCreateFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const createAdmin = trpc.admin.createAdmin.useMutation({
    onSuccess: async (_data, variables) => {
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
      setAdminRole("ADMIN");
      setAdminDepartmentIds([]);
      await admins.refetch();
      const createdRole = variables.role;
      const successMessage =
        createdRole === "PRIMARY_ADMIN"
          ? "Compte d’administration générale UFB créé avec succès."
          : createdRole === "READ_ONLY"
            ? "Compte en lecture seule créé avec succès."
            : "Compte administrateur créé avec succès.";

      setAdminCreateFeedback({
        type: "success",
        message: successMessage,
      });
    },
    onError: (error) => {
      setAdminCreateFeedback({
        type: "error",
        message:
          error.message ||
          "Le compte administrateur n’a pas pu être créé.",
      });
    },
  });
  const settings = trpc.admin.settings.useQuery(undefined, { enabled: canAccessSettings });
  const update = trpc.admin.updateSetting.useMutation({ onSuccess: () => { void settings.refetch(); } });
  const gmail = trpc.admin.gmailMailStatus.useQuery(undefined, { enabled: canAccessSettings });
  const scheduler = trpc.admin.schedulerStatus.useQuery(undefined, { enabled: canAccessSettings });
  const outbox = trpc.admin.emailOutbox.useQuery(undefined, { enabled: canAccessSettings });
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
  const [exportDepartmentId, setExportDepartmentId] = useState<number | undefined>();
  const [exportFederation, setExportFederation] = useState("");
  const [exportScope, setExportScope] = useState<ExportScope>("ALL");

  const exportFilters = useMemo(() => ({
    departmentId: exportDepartmentId,
    year: /^\d{4}$/.test(exportYear) ? exportYear : undefined,
    federation: exportFederation || undefined,
    status: exportScope === "ALL" ? undefined : exportScope === "HISTORY" ? ["REFUSED", "CANCELLED", "RESCHEDULED"] as RequestStatus[] : [exportScope] as RequestStatus[],
  }), [exportDepartmentId, exportYear, exportFederation, exportScope]);
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

  if (loading) return <ScreenContainer containerClassName="bg-[#F4F8FB]"><LoadingBlock label="Vérification des autorisations…" /></ScreenContainer>;
  if (!canAccessSettings) return <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5"><View style={{ padding: 24, alignItems: "center", gap: 12 }}><Text style={{ fontSize: 22, fontWeight: "800", color: GCV.navy }}>Accès non autorisé</Text><Text style={{ textAlign: "center", color: GCV.muted }}>Votre profil ne permet pas d’accéder aux réglages administratifs.</Text><PrimaryButton label="RETOUR AU TABLEAU DE BORD" onPress={() => router.replace("/admin" as never)} /></View></ScreenContainer>;
  if (settings.isLoading) return <ScreenContainer containerClassName="bg-[#F4F8FB]"><LoadingBlock label="Chargement des réglages…" /></ScreenContainer>;

  return <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5"><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.back} onPress={() => router.back()}>‹ Tableau de bord</Text>
    <Text style={styles.title}>Réglages</Text>

    {isPrimaryAdmin ? (
      <SectionCard>
        <Text style={styles.section}>Gestion des administrateurs</Text>
        <Text style={styles.text}>
          Créez des accès individuels et limitez chaque responsable aux départements dont il a la charge.
        </Text>

        <Text style={styles.fieldTitle}>Départements et responsables</Text>

        {adminDepartments.isLoading || admins.isLoading ? (
          <LoadingBlock label="Chargement des attributions…" />
        ) : adminDepartments.error ? (
          <Text style={styles.error}>{adminDepartments.error.message}</Text>
        ) : admins.error ? (
          <Text style={styles.error}>{admins.error.message}</Text>
        ) : (
          <View>
            {(adminDepartments.data ?? []).map((department) => {
              const responsables = (admins.data ?? []).filter(
                (admin) =>
                  admin.profile.role !== "PRIMARY_ADMIN" &&
                  admin.departments.some(
                    (assignedDepartment) =>
                      assignedDepartment.id === department.id,
                  ),
              );

              return (
                <View key={department.id} style={styles.outboxRow}>
                  <Text style={styles.fieldTitle}>{department.name}</Text>

                  {responsables.length ? (
                    responsables.map((responsable) => (
                      <Text
                        key={responsable.profile.id}
                        style={styles.helper}
                      >
                        {responsable.user.name || responsable.profile.email}
                        {" · "}
                        {responsable.profile.role === "ADMIN"
                          ? "ADMINISTRATEUR"
                          : "LECTURE SEULE"}
                        {" · "}
                        {responsable.profile.active === "YES"
                          ? "ACCÈS ACTIF"
                          : "ACCÈS DÉSACTIVÉ"}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.helper}>SANS RESPONSABLE</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        <Text style={styles.fieldTitle}>Responsables actuels</Text>

        {admins.isLoading ? (
          <LoadingBlock label="Chargement des responsables…" />
        ) : admins.error ? (
          <Text style={styles.error}>{admins.error.message}</Text>
        ) : (
          <View>
            {(admins.data ?? []).map((admin) => (
              <View key={admin.profile.id} style={styles.outboxRow}>
                <Text style={styles.fieldTitle}>
                  {admin.user.name || admin.profile.email}
                </Text>

                <Text style={styles.text}>{admin.profile.email}</Text>

                <Text style={styles.helper}>
                  {admin.profile.role === "PRIMARY_ADMIN"
                    ? "ADMINISTRATION GÉNÉRALE UFB"
                    : admin.profile.role === "ADMIN"
                      ? "ADMINISTRATEUR"
                      : "LECTURE SEULE"}
                  {" · "}
                  {admin.profile.active === "YES" ? "ACCÈS ACTIF" : "ACCÈS DÉSACTIVÉ"}
                </Text>

                <Text style={styles.helper}>
                  {admin.allDepartments
                    ? "Tous les départements"
                    : admin.departments.length
                      ? admin.departments.map((department) => department.name).join(" · ")
                      : "Aucun département attribué"}
                </Text>

                <Pressable
                  onPress={() => {
                    setEditingAdminId(admin.profile.id);
                    setEditingAdminName(admin.user.name ?? "");
                    setEditingAdminEmail(admin.profile.email);
                    setEditingAdminRole(admin.profile.role);
                    setEditingAdminActive(admin.profile.active);
                    setEditingAdminDepartmentIds(
                      admin.profile.role === "PRIMARY_ADMIN"
                        ? []
                        : admin.departments.map((department) => department.id),
                    );
                    setTemporaryPassword("");
                  }}
                  style={styles.retryButton}
                >
                  <Text style={styles.retryText}>MODIFIER</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {editingAdminId !== null ? (
          <View>
            <Text style={styles.fieldTitle}>Modifier le responsable</Text>

            {adminEditFeedback ? (
              <View
                style={[
                  styles.feedbackBanner,
                  adminEditFeedback.type === "success"
                    ? styles.feedbackBannerSuccess
                    : styles.feedbackBannerError,
                ]}
                accessibilityRole="alert"
              >
                <Text
                  style={[
                    styles.feedbackIcon,
                    adminEditFeedback.type === "success"
                      ? styles.feedbackSuccessText
                      : styles.feedbackErrorText,
                  ]}
                >
                  {adminEditFeedback.type === "success" ? "✓" : "!"}
                </Text>

                <View style={styles.feedbackContent}>
                  <Text
                    style={[
                      styles.feedbackTitle,
                      adminEditFeedback.type === "success"
                        ? styles.feedbackSuccessText
                        : styles.feedbackErrorText,
                    ]}
                  >
                    {adminEditFeedback.type === "success"
                      ? "Modification enregistrée"
                      : "Action requise"}
                  </Text>

                  <Text style={styles.feedbackMessage}>
                    {adminEditFeedback.message}
                  </Text>
                </View>
              </View>
            ) : null}

            <Field
              label="Nom et prénom"
              value={editingAdminName}
              onChangeText={setEditingAdminName}
            />

            <Field
              label="Adresse e-mail de connexion"
              value={editingAdminEmail}
              onChangeText={setEditingAdminEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={[styles.fieldTitle, styles.adminSectionSpacing]}>Niveau d’accès</Text>
            <View style={styles.chips}>
              <Chip
                label="ADMINISTRATION GÉNÉRALE UFB"
                selected={editingAdminRole === "PRIMARY_ADMIN"}
                onPress={() => {
                  setEditingAdminRole("PRIMARY_ADMIN");
                  setEditingAdminDepartmentIds([]);
                }}
              />
              <Chip
                label="ADMINISTRATEUR"
                selected={editingAdminRole === "ADMIN"}
                onPress={() => setEditingAdminRole("ADMIN")}
              />
              <Chip
                label="LECTURE SEULE"
                selected={editingAdminRole === "READ_ONLY"}
                onPress={() => setEditingAdminRole("READ_ONLY")}
              />
            </View>

            <Text style={[styles.fieldTitle, styles.adminSectionSpacing]}>État de l’accès</Text>
            <View style={styles.chips}>
              <Chip
                label="ACCÈS ACTIF"
                selected={editingAdminActive === "YES"}
                onPress={() => setEditingAdminActive("YES")}
              />
              <Chip
                label="ACCÈS DÉSACTIVÉ"
                selected={editingAdminActive === "NO"}
                onPress={() => setEditingAdminActive("NO")}
              />
            </View>

            {editingAdminRole === "PRIMARY_ADMIN" ? (
              <Text style={styles.helper}>
                Accès complet à tous les départements et à l’administration générale de l’UFB.
              </Text>
            ) : (
              <>
                <Text style={styles.fieldTitle}>Départements autorisés</Text>
                <View style={styles.chips}>
                  {(adminDepartments.data ?? []).map((department) => (
                    <Chip
                      key={department.id}
                      label={department.name}
                      selected={editingAdminDepartmentIds.includes(department.id)}
                      onPress={() =>
                        setEditingAdminDepartmentIds((current) =>
                          current.includes(department.id)
                            ? current.filter((id) => id !== department.id)
                            : [...current, department.id]
                        )
                      }
                    />
                  ))}
                </View>
              </>
            )}

            <Text style={[styles.fieldTitle, styles.adminPasswordSpacing]}>Mot de passe provisoire</Text>

            <Field
              label="Nouveau mot de passe provisoire"
              value={temporaryPassword}
              onChangeText={setTemporaryPassword}
              placeholder="12 caractères minimum"
              autoCapitalize="none"
              secureTextEntry
            />

            <PrimaryButton
              label={
                resetAdminPassword.isPending
                  ? "MODIFICATION…"
                  : "DÉFINIR LE MOT DE PASSE PROVISOIRE"
              }
              onPress={() => {
                setAdminEditFeedback(null);
                if (temporaryPassword.length < 12) {
                  setAdminEditFeedback({
                    type: "error",
                    message: "Le mot de passe provisoire doit contenir au moins 12 caractères.",
                  });
                  return;
                }

                if (editingAdminId === null) {
                  return;
                }

                resetAdminPassword.mutate({
                  adminProfileId: editingAdminId,
                  newPassword: temporaryPassword,
                });
              }}
              disabled={resetAdminPassword.isPending}
            />

            <Text style={styles.helper}>
              Cette opération remplace immédiatement le mot de passe actuel du responsable.
            </Text>

            <PrimaryButton
              label={updateAdmin.isPending ? "ENREGISTREMENT…" : "ENREGISTRER LES MODIFICATIONS"}
              onPress={() => {
                const name = editingAdminName.trim();
                const email = editingAdminEmail.trim().toLowerCase();

                setAdminEditFeedback(null);
                if (!name || !email || !email.includes("@")) {
                  setAdminEditFeedback({
                    type: "error",
                    message: "Vérifiez le nom et l’adresse e-mail.",
                  });
                  return;
                }

                if (
                  editingAdminRole !== "PRIMARY_ADMIN" &&
                  editingAdminDepartmentIds.length === 0
                ) {
                  setAdminEditFeedback({
                    type: "error",
                    message: "Sélectionnez au moins un département.",
                  });
                  return;
                }

                updateAdmin.mutate({
                  adminProfileId: editingAdminId,
                  name,
                  email,
                  role: editingAdminRole,
                  active: editingAdminActive,
                  departmentIds: editingAdminDepartmentIds,
                });
              }}
              disabled={updateAdmin.isPending}
            />

            <Pressable
              onPress={() => {
                setEditingAdminId(null);
                setTemporaryPassword("");
                setAdminEditFeedback(null);
              }}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>ANNULER</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.fieldTitle}>Nouvel administrateur</Text>

        {adminCreateFeedback ? (
          <View
            style={[
              styles.feedbackBanner,
              adminCreateFeedback.type === "success"
                ? styles.feedbackBannerSuccess
                : styles.feedbackBannerError,
            ]}
            accessibilityRole="alert"
          >
            <Text
              style={[
                styles.feedbackIcon,
                adminCreateFeedback.type === "success"
                  ? styles.feedbackSuccessText
                  : styles.feedbackErrorText,
              ]}
            >
              {adminCreateFeedback.type === "success" ? "✓" : "!"}
            </Text>

            <View style={styles.feedbackContent}>
              <Text
                style={[
                  styles.feedbackTitle,
                  adminCreateFeedback.type === "success"
                    ? styles.feedbackSuccessText
                    : styles.feedbackErrorText,
                ]}
              >
                {adminCreateFeedback.type === "success"
                  ? "Compte créé"
                  : "Création impossible"}
              </Text>

              <Text style={styles.feedbackMessage}>
                {adminCreateFeedback.message}
              </Text>
            </View>
          </View>
        ) : null}

        <Field
          label="Nom et prénom"
          value={adminName}
          onChangeText={setAdminName}
          placeholder="Ex. Jean Dupont"
        />

        <Field
          label="Adresse e-mail"
          value={adminEmail}
          onChangeText={setAdminEmail}
          placeholder="nom@exemple.fr"
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Field
          label="Mot de passe initial"
          value={adminPassword}
          onChangeText={setAdminPassword}
          placeholder="12 caractères minimum"
          autoCapitalize="none"
          secureTextEntry
        />

        <Text style={styles.fieldTitle}>Niveau d’accès</Text>
        <View style={styles.chips}>
          <Chip
            label="ADMINISTRATION GÉNÉRALE UFB"
            selected={adminRole === "PRIMARY_ADMIN"}
            onPress={() => {
              setAdminRole("PRIMARY_ADMIN");
              setAdminDepartmentIds([]);
            }}
          />
          <Chip
            label="ADMINISTRATEUR"
            selected={adminRole === "ADMIN"}
            onPress={() => setAdminRole("ADMIN")}
          />
          <Chip
            label="LECTURE SEULE"
            selected={adminRole === "READ_ONLY"}
            onPress={() => setAdminRole("READ_ONLY")}
          />
        </View>

        {adminRole === "PRIMARY_ADMIN" ? (
          <Text style={styles.helper}>
            Accès complet à tous les départements et à l’administration générale de l’UFB.
          </Text>
        ) : (
          <>
            <Text style={styles.fieldTitle}>Départements autorisés</Text>

            {adminDepartments.isLoading ? (
              <LoadingBlock label="Chargement des départements…" />
            ) : adminDepartments.error ? (
              <Text style={styles.error}>{adminDepartments.error.message}</Text>
            ) : (
              <View style={styles.chips}>
                {(adminDepartments.data ?? []).map((department) => (
                  <Chip
                    key={department.id}
                    label={department.name}
                    selected={adminDepartmentIds.includes(department.id)}
                    onPress={() =>
                      setAdminDepartmentIds((current) =>
                        current.includes(department.id)
                          ? current.filter((id) => id !== department.id)
                          : [...current, department.id]
                      )
                    }
                  />
                ))}
              </View>
            )}
          </>
        )}

        <PrimaryButton
          label={createAdmin.isPending ? "CRÉATION…" : "CRÉER LE COMPTE"}
          onPress={() => {
            setAdminCreateFeedback(null);
            const name = adminName.trim();
            const email = adminEmail.trim().toLowerCase();

            if (!name) {
              setAdminCreateFeedback({
                type: "error",
                message: "Indiquez le nom et le prénom.",
              });
              return;
            }

            if (!email || !email.includes("@")) {
              setAdminCreateFeedback({
                type: "error",
                message: "Indiquez une adresse e-mail valide.",
              });
              return;
            }

            if (adminPassword.length < 12) {
              setAdminCreateFeedback({
                type: "error",
                message: "Le mot de passe doit contenir au moins 12 caractères.",
              });
              return;
            }

            if (
              adminRole !== "PRIMARY_ADMIN" &&
              adminDepartmentIds.length === 0
            ) {
              setAdminCreateFeedback({
                type: "error",
                message: "Sélectionnez au moins un département.",
              });
              return;
            }

            createAdmin.mutate({
              name,
              email,
              password: adminPassword,
              role: adminRole,
              departmentIds: adminDepartmentIds,
            });
          }}
          disabled={createAdmin.isPending}
        />

        <Text style={styles.helper}>
          Chaque compte utilise une adresse e-mail et un mot de passe individuels. L’Administration générale UFB dispose d’un accès global ; les autres comptes sont limités aux départements sélectionnés.
        </Text>
      </SectionCard>
    ) : null}

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
        {key === "interventionType" ? <Text style={styles.helper}>Toujours visible et obligatoire : le type d’intervention dépend du département choisi.</Text> : <View style={styles.row}><Toggle label={fieldRules[key].visible ? "Visible" : "Masqué"} selected={fieldRules[key].visible} onPress={() => setFieldRules((current) => ({ ...current, [key]: { visible: !current[key].visible, required: current[key].visible ? false : current[key].required } }))} /><Toggle label={fieldRules[key].required ? "Obligatoire" : "Facultatif"} selected={fieldRules[key].required} disabled={!fieldRules[key].visible} onPress={() => setFieldRules((current) => ({ ...current, [key]: { ...current[key], required: !current[key].required } }))} /></View>}
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
      <Text style={styles.text}>Les rappels concernent les interventions à J-30, J-7 et J-1. Leur envoi automatique nécessite une planification active. Les responsables concernés et l’adresse administrative reçoivent les rappels; l’envoi au demandeur est facultatif.</Text>
      <Toggle label={reminders.enabled ? "Rappels activés" : "Rappels désactivés"} selected={reminders.enabled} onPress={() => setReminders((current) => ({ ...current, enabled: !current.enabled }))} />
      <Toggle label={reminders.includeRequester ? "Copie au demandeur" : "Ne pas envoyer au demandeur"} selected={reminders.includeRequester} onPress={() => setReminders((current) => ({ ...current, includeRequester: !current.includeRequester }))} />
      <PrimaryButton label="ENREGISTRER LES RAPPELS" tone="secondary" onPress={saveReminders} disabled={update.isPending} />
      {scheduler.isLoading ? <LoadingBlock label="Vérification du travail planifié…" /> : <Text style={scheduler.data?.configured && scheduler.data.active ? styles.connected : styles.pending}>{scheduler.data?.configured && scheduler.data.active ? "Planification automatique active." : "Planification automatique non configurée : aucun rappel automatique ne sera envoyé, même si les rappels sont activés ci-dessus."}</Text>}
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
          <Text style={styles.pending}>{gmail.data?.authorizationReady ? "Configuration Gmail prête; autorisation du compte Google en attente." : "Le service Gmail API n’est pas encore configuré."}</Text>
          <Text style={styles.helper}>L’autorisation Google doit être effectuée par l’administrateur avant de pouvoir envoyer des e-mails.</Text>
        </>
      )}
      {gmail.data?.redirectUri ? <Text selectable style={styles.uri}>Adresse de retour Google : {gmail.data.redirectUri}</Text> : null}
      {gmail.data?.authorizationReady ? <PrimaryButton label="AUTORISER LE COMPTE GOOGLE" icon="mail-outline" tone="secondary" onPress={() => { const url = `${getApiBaseUrl()}/api/google/oauth/start`; if (Platform.OS === "web") window.location.assign(url); else void Linking.openURL(url); }} /> : <Text style={styles.helper}>L’adresse publique, le compte d’envoi et les clés Google de cette application doivent être configurés sur le serveur.</Text>}
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
      <Text style={styles.fieldTitle}>Département</Text>
      <View style={styles.chips}><Chip label="Tous les départements autorisés" selected={exportDepartmentId === undefined} onPress={() => setExportDepartmentId(undefined)} />{(adminDepartments.data ?? []).map((department) => <Chip key={department.id} label={department.name} selected={exportDepartmentId === department.id} onPress={() => setExportDepartmentId(department.id)} />)}</View>
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
  adminSectionSpacing: { marginTop: 14, marginBottom: 5 },
  adminPasswordSpacing: { marginTop: 22, marginBottom: 5 },
  retryButton: { backgroundColor: "#E8F0F6", borderRadius: 8, paddingVertical: 9, paddingHorizontal: 10 },
  retryText: { color: GCV.navy, fontSize: 10, fontWeight: "900" },
  uri: { color: GCV.blue, backgroundColor: "#F4F8FB", padding: 10, borderRadius: 8, fontFamily: Platform.OS === "web" ? "monospace" : undefined, fontSize: 12 },
  pending: { color: "#84560B", backgroundColor: "#FFF6E7", padding: 11, borderRadius: 9, fontSize: 12, lineHeight: 18, fontWeight: "750" },
  connected: { color: "#176B43", backgroundColor: "#E7F5EC", padding: 11, borderRadius: 9, fontSize: 12, lineHeight: 18, fontWeight: "800" },
  feedbackBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
    marginBottom: 14,
  },
  feedbackBannerSuccess: {
    backgroundColor: "#EAF7EF",
    borderColor: "#A8D5B9",
  },
  feedbackBannerError: {
    backgroundColor: "#FFF1F0",
    borderColor: "#E8AAA5",
  },
  feedbackIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    textAlign: "center",
    lineHeight: 26,
    fontSize: 16,
    fontWeight: "900",
  },
  feedbackContent: {
    flex: 1,
  },
  feedbackTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
    marginBottom: 2,
  },
  feedbackMessage: {
    color: GCV.navy,
    fontSize: 13,
    lineHeight: 19,
  },
  feedbackSuccessText: {
    color: "#176B43",
  },
  feedbackErrorText: {
    color: GCV.danger,
  },
  success: { color: "#176B43", backgroundColor: "#E7F5EC", padding: 11, borderRadius: 9, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  error: { color: GCV.danger, fontSize: 13, lineHeight: 19, fontWeight: "700" },
});
