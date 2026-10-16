import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { DEFAULT_FIELDS } from "@/shared/gcv";
import { EmptyState, Field, GCV, LoadingBlock, PrimaryButton, SectionCard } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

type ExtraField = "message" | "desiredTime" | "churchAddress";
type FieldRule = { visible: boolean; required: boolean };

type FormData = {
  departmentId: number;
  federation: string;
  interventionTypeId: number;
  church: string;
  contactName: string;
  email: string;
  phone: string;
  message: string;
  desiredTime: string;
  churchAddress: string;
  dateSlotId: number;
};

const OPTIONAL_LABELS: Record<ExtraField, string> = {
  message: "Message ou informations complémentaires",
  desiredTime: "Heure souhaitée",
  churchAddress: "Adresse de l’église",
};

export default function RequestScreen() {
  const router = useRouter();
  const bootstrap = trpc.public.bootstrap.useQuery();
  const submit = trpc.public.submitRequest.useMutation();

  const [consent, setConsent] = useState(false);
  const [summaryConfirmed, setSummaryConfirmed] = useState(false);

  const [form, setForm] = useState<FormData>({
    departmentId: 0,
    federation: "",
    interventionTypeId: 0,
    church: "",
    contactName: "",
    email: "",
    phone: "",
    message: "",
    desiredTime: "",
    churchAddress: "",
    dateSlotId: 0,
  });

  const fields = (bootstrap.data?.fields ?? DEFAULT_FIELDS) as Record<string, FieldRule>;

  const departments = bootstrap.data?.departments ?? [];

  const interventionTypes = useMemo(
    () =>
      (bootstrap.data?.interventionTypes ?? []).filter(
        (type) => type.departmentId === form.departmentId,
      ),
    [bootstrap.data?.interventionTypes, form.departmentId],
  );

  const dates = useMemo(
    () =>
      (bootstrap.data?.dates ?? []).filter(
        (slot) =>
          slot.departmentId === form.departmentId &&
          slot.federation === form.federation,
      ),
    [bootstrap.data?.dates, form.departmentId, form.federation],
  );

  const selectedDepartment = departments.find(
    (department) => department.id === form.departmentId,
  );

  const selectedInterventionType = interventionTypes.find(
    (type) => type.id === form.interventionTypeId,
  );

  const selectedSlot = dates.find((slot) => slot.id === form.dateSlotId);

  const requiredExtraMissing = (Object.keys(OPTIONAL_LABELS) as ExtraField[]).some(
    (key) => fields[key]?.visible && fields[key]?.required && !form[key].trim(),
  );

  const emailReady = bootstrap.data?.emailReady === true;

  const canSend = Boolean(
    consent &&
      summaryConfirmed &&
      form.departmentId &&
      form.federation &&
      form.interventionTypeId &&
      selectedSlot &&
      selectedDepartment &&
      selectedInterventionType &&
      form.church.trim() &&
      form.contactName.trim() &&
      form.email.trim() &&
      form.phone.trim() &&
      !requiredExtraMissing &&
      !submit.isPending,
  );

  const error = submit.error?.message;

  const set = (key: keyof FormData, value: string | number) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSummaryConfirmed(false);
  };

  const label = (key: ExtraField) =>
    `${OPTIONAL_LABELS[key]}${fields[key]?.required ? " *" : ""}`;

  const selectDepartment = (departmentId: number) => {
    setForm((current) => ({
      ...current,
      departmentId,
      federation: "",
      interventionTypeId: 0,
      dateSlotId: 0,
    }));
    setSummaryConfirmed(false);
  };

  const selectFederation = (federation: string) => {
    setForm((current) => ({
      ...current,
      federation,
      dateSlotId: 0,
    }));
    setSummaryConfirmed(false);
  };

  const selectInterventionType = (interventionTypeId: number) => {
    setForm((current) => ({
      ...current,
      interventionTypeId,
    }));
    setSummaryConfirmed(false);
  };

  const send = async () => {
    if (!canSend) return;

    try {
    const outcome = await submit.mutateAsync({
      dateSlotId: form.dateSlotId,
      federation: form.federation,
      church: form.church,
      contactName: form.contactName,
      email: form.email,
      phone: form.phone,
      interventionTypeId: form.interventionTypeId,
      message: form.message,
      desiredTime: form.desiredTime,
      churchAddress: form.churchAddress,
      consent: true,
    });

    router.replace({
      pathname: "/request/success" as never,
      params: {
        id: outcome.submissionId,
        emailStatus: outcome.adminEmailStatus,
      } as never,
    });
    } catch {
      // The mutation error is displayed below; refresh dates after a competing reservation.
      void bootstrap.refetch();
    }
  };

  return (
    <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>‹ Accueil</Text>
        </Pressable>

        <View>
          <Text style={styles.kicker}>UNION FRANCO-BELGE</Text>
          <Text style={styles.title}>Demander une intervention</Text>
          <Text style={styles.intro}>
            Choisissez le département de l’Union franco-belge que vous souhaitez solliciter,
            votre fédération, le type d’intervention et une date disponible. Votre demande
            sera ensuite transmise au responsable du département concerné.
          </Text>
        </View>

        {bootstrap.isLoading ? (
          <LoadingBlock label="Recherche des disponibilités…" />
        ) : bootstrap.error ? (
          <SectionCard>
            <Text style={styles.error}>
              Les disponibilités ne peuvent pas être chargées pour le moment.
              Veuillez réessayer plus tard.
            </Text>
          </SectionCard>
        ) : (
          <>
            {bootstrap.data && !emailReady ? (
              <View style={styles.mailWarning}>
                <Text style={styles.mailWarningTitle}>
                  Demandes ouvertes
                </Text>
                <Text style={styles.mailWarningText}>
                  Votre demande sera enregistrée et pourra être consultée par le département concerné. Les notifications par e-mail ne sont pas encore activées. Conservez votre numéro de référence après l’envoi.
                </Text>
              </View>
            ) : null}

            <SectionCard>
              <Text style={styles.sectionTitle}>1. Département *</Text>
              <Text style={styles.hint}>
                Choisissez le département de l’Union franco-belge que vous souhaitez solliciter.
              </Text>

              <View style={styles.optionRow}>
                {departments.map((department) => (
                  <Pressable
                    key={department.id}
                    onPress={() => selectDepartment(department.id)}
                    accessibilityRole="radio"
                    accessibilityState={{
                      selected: form.departmentId === department.id,
                    }}
                    style={[
                      styles.typeOption,
                      form.departmentId === department.id && styles.optionSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        form.departmentId === department.id &&
                          styles.optionTextSelected,
                      ]}
                    >
                      {department.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>2. Fédération *</Text>

              {!form.departmentId ? (
                <EmptyState
                  title="Choisissez d’abord un département"
                  detail="Vous pourrez ensuite sélectionner votre fédération."
                />
              ) : (
                <>
                  <Text style={styles.hint}>
                    Indiquez la fédération à laquelle appartient votre église ou votre district.
                  </Text>

                  <View style={styles.optionRow}>
                    {(bootstrap.data?.federations as string[] | undefined ?? [
                      "FFN",
                      "FFS",
                      "FBL",
                    ]).map((item) => (
                      <Pressable
                        key={item}
                        onPress={() => selectFederation(item)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: form.federation === item }}
                        style={[
                          styles.federationOption,
                          form.federation === item && styles.optionSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.federationOptionText,
                            form.federation === item && styles.optionTextSelected,
                          ]}
                        >
                          {item}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>3. Type d’intervention *</Text>

              {!form.departmentId ? (
                <EmptyState
                  title="Choisissez d’abord un département"
                  detail="Les interventions proposées par ce département apparaîtront ici."
                />
              ) : interventionTypes.length === 0 ? (
                <EmptyState
                  title="Aucun type d’intervention disponible"
                  detail="Ce département n’a pas encore configuré ses types d’intervention."
                />
              ) : (
                <View style={styles.optionRow}>
                  {interventionTypes.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => selectInterventionType(item.id)}
                      accessibilityRole="radio"
                      accessibilityState={{
                        selected: form.interventionTypeId === item.id,
                      }}
                      style={[
                        styles.typeOption,
                        form.interventionTypeId === item.id &&
                          styles.optionSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          form.interventionTypeId === item.id &&
                            styles.optionTextSelected,
                        ]}
                      >
                        {item.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>4. Date souhaitée *</Text>

              {!form.departmentId || !form.federation ? (
                <EmptyState
                  title="Choisissez d’abord le département et la fédération"
                  detail="Les dates disponibles correspondantes apparaîtront ensuite ici."
                />
              ) : (
                <>
                  <Text style={styles.hint}>
                    Seules les dates actuellement disponibles pour {form.federation} sont proposées.
                  </Text>

                  {dates.length === 0 ? (
                    <EmptyState
                      title={`Aucune date disponible pour ${form.federation}`}
                      detail="Veuillez revenir prochainement ou contacter le département concerné."
                    />
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.dateRow}
                    >
                      {dates.map((slot) => (
                        <Pressable
                          key={slot.id}
                          onPress={() => set("dateSlotId", slot.id)}
                          accessibilityRole="radio"
                          accessibilityState={{
                            selected: form.dateSlotId === slot.id,
                          }}
                          style={[
                            styles.dateChip,
                            form.dateSlotId === slot.id &&
                              styles.dateChipSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dateDay,
                              form.dateSlotId === slot.id &&
                                styles.dateTextSelected,
                            ]}
                          >
                            {new Date(`${slot.date}T12:00:00`).toLocaleDateString(
                              "fr-FR",
                              { day: "2-digit", month: "short" },
                            )}
                          </Text>
                          <Text
                            style={[
                              styles.dateYear,
                              form.dateSlotId === slot.id &&
                                styles.dateTextSelected,
                            ]}
                          >
                            {new Date(`${slot.date}T12:00:00`).getFullYear()}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                </>
              )}
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>5. Vos coordonnées</Text>

              <Field
                label="Église *"
                value={form.church}
                onChangeText={(value) => set("church", value)}
                placeholder="Nom de l’église"
              />

              <Field
                label="Nom et prénom *"
                value={form.contactName}
                onChangeText={(value) => set("contactName", value)}
                placeholder="Votre nom complet"
              />

              <Field
                label="Adresse e-mail *"
                value={form.email}
                onChangeText={(value) => set("email", value)}
                placeholder="nom@exemple.fr"
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <Field
                label="Téléphone *"
                value={form.phone}
                onChangeText={(value) => set("phone", value)}
                placeholder="06 00 00 00 00"
                keyboardType="phone-pad"
              />
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>
                6. Informations complémentaires
              </Text>

              {fields.message?.visible ? (
                <Field
                  label={label("message")}
                  value={form.message}
                  onChangeText={(value) => set("message", value)}
                  placeholder="Précisez ici toute autre demande ou besoin particulier"
                  multiline
                />
              ) : null}

              {fields.desiredTime?.visible ? (
                <Field
                  label={label("desiredTime")}
                  value={form.desiredTime}
                  onChangeText={(value) => set("desiredTime", value)}
                  placeholder="Ex. 11 h 00"
                />
              ) : null}

              {fields.churchAddress?.visible ? (
                <Field
                  label={label("churchAddress")}
                  value={form.churchAddress}
                  onChangeText={(value) => set("churchAddress", value)}
                  placeholder="Adresse postale"
                  multiline
                />
              ) : null}
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>
                7. Vérifiez votre demande
              </Text>

              <View style={styles.summaryBox}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Département</Text>
                  <Text style={styles.summaryValue}>
                    {selectedDepartment?.name ?? "—"}
                  </Text>
                </View>

                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Fédération</Text>
                  <Text style={styles.summaryValue}>
                    {form.federation || "—"}
                  </Text>
                </View>

                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Intervention</Text>
                  <Text style={styles.summaryValue}>
                    {selectedInterventionType?.name ?? "—"}
                  </Text>
                </View>

                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Église</Text>
                  <Text style={styles.summaryValue}>
                    {form.church.trim() || "—"}
                  </Text>
                </View>

                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Date souhaitée</Text>
                  <Text style={styles.summaryValue}>
                    {selectedSlot
                      ? new Date(`${selectedSlot.date}T12:00:00`).toLocaleDateString(
                          "fr-FR",
                          { day: "2-digit", month: "long", year: "numeric" },
                        )
                      : "—"}
                  </Text>
                </View>
              </View>

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: summaryConfirmed }}
                onPress={() => setSummaryConfirmed((current) => !current)}
                style={styles.consentRow}
              >
                <View
                  style={[
                    styles.checkbox,
                    summaryConfirmed && styles.checkboxChecked,
                  ]}
                >
                  <Text style={styles.checkmark}>
                    {summaryConfirmed ? "✓" : ""}
                  </Text>
                </View>

                <Text style={styles.consentText}>
                  Je confirme que les informations ci-dessus sont correctes. *
                </Text>
              </Pressable>
            </SectionCard>

            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                Les informations recueillies sont utilisées par l’Union franco-belge
                des Églises adventistes afin de recevoir, examiner et organiser votre
                demande d’intervention et d’assurer les échanges nécessaires à son suivi.
              </Text>

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: consent }}
                onPress={() => setConsent((current) => !current)}
                style={styles.consentRow}
              >
                <View
                  style={[styles.checkbox, consent && styles.checkboxChecked]}
                >
                  <Text style={styles.checkmark}>{consent ? "✓" : ""}</Text>
                </View>

                <Text style={styles.consentText}>
                  Je confirme avoir pris connaissance des informations relatives
                  au traitement de mes données personnelles. *
                </Text>
              </Pressable>

              <Pressable onPress={() => router.push("/privacy" as never)}>
                <Text style={styles.privacyLink}>
                  Lire la politique de confidentialité et connaître mes droits
                </Text>
              </Pressable>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <PrimaryButton
              label={
                submit.isPending
                  ? "ENVOI EN COURS…"
                  : "ENVOYER LA DEMANDE"
              }
              disabled={!canSend || submit.isPending}
              icon="send-outline"
              onPress={send}
            />
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create<any>({
  content: { paddingTop: 18, paddingBottom: 36, gap: 16, alignSelf: "center", width: "100%", maxWidth: 760 },
  back: { color: GCV.blue, fontWeight: "700", fontSize: 14 }, kicker: { color: GCV.blue, fontSize: 11, fontWeight: "900", letterSpacing: 1.3, marginBottom: 4 },
  title: { color: GCV.navy, fontSize: 29, lineHeight: 35, fontWeight: "800" }, intro: { color: GCV.muted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  sectionTitle: { color: GCV.navy, fontSize: 17, fontWeight: "800" }, hint: { color: GCV.muted, fontSize: 13, lineHeight: 18 }, dateRow: { gap: 9, paddingVertical: 2 },
  dateChip: { borderWidth: 1, borderColor: "#C7D6E0", borderRadius: 12, minWidth: 86, padding: 11, alignItems: "center", backgroundColor: "#FBFDFE" }, dateChipSelected: { backgroundColor: GCV.navy, borderColor: GCV.navy },
  dateDay: { color: GCV.text, fontSize: 15, fontWeight: "800", textTransform: "capitalize" }, dateYear: { color: GCV.muted, fontSize: 12, marginTop: 2 }, dateTextSelected: { color: "#FFFFFF" },
  fieldLabel: { color: GCV.text, fontSize: 13, fontWeight: "700" }, optionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { borderWidth: 1, borderColor: "#C7D6E0", paddingVertical: 9, paddingHorizontal: 12, borderRadius: 9, backgroundColor: "#fff" },
  federationOption: { borderWidth: 1.5, borderColor: "#C7D6E0", minWidth: 76, minHeight: 54, paddingVertical: 13, paddingHorizontal: 20, borderRadius: 11, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  federationOptionText: { color: GCV.text, fontSize: 16, fontWeight: "900", letterSpacing: 0.4 },
  typeOption: { borderWidth: 1, borderColor: "#C7D6E0", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, backgroundColor: "#fff" },
  optionSelected: { backgroundColor: "#E2F0F9", borderColor: GCV.blue }, optionText: { color: GCV.text, fontSize: 13, fontWeight: "700" }, optionTextSelected: { color: GCV.navy },
  notice: { backgroundColor: "#EAF3F8", borderRadius: 12, padding: 14, gap: 10 }, noticeText: { color: "#38566B", fontSize: 12, lineHeight: 18 },
  consentRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, checkbox: { width: 22, height: 22, borderWidth: 1.5, borderColor: GCV.blue, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  checkboxChecked: { backgroundColor: GCV.blue }, checkmark: { color: "#fff", fontWeight: "900" }, consentText: { flex: 1, color: GCV.text, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  summaryBox: { backgroundColor: "#F4F8FB", borderRadius: 10, padding: 12, gap: 9 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: 16, borderBottomWidth: 1, borderBottomColor: "#E1EAF0", paddingBottom: 7 },
  summaryLabel: { color: GCV.muted, fontSize: 12, fontWeight: "700", flex: 1 },
  summaryValue: { color: GCV.navy, fontSize: 13, fontWeight: "800", flex: 2, textAlign: "right" },
  privacyLink: { color: GCV.blue, fontWeight: "800", fontSize: 12 }, error: { color: "#A93838", fontSize: 13, lineHeight: 19, fontWeight: "700" },
  mailWarning: { backgroundColor: "#FFF6E7", borderColor: "#F0D8A7", borderWidth: 1, borderRadius: 12, padding: 14, gap: 5 }, mailWarningTitle: { color: "#84560B", fontSize: 14, fontWeight: "900" }, mailWarningText: { color: "#704C16", fontSize: 12, lineHeight: 18 },
});
