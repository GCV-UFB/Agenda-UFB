import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { GCV, LoadingBlock, PrimaryButton, SectionCard } from "./gcv-ui";
import { trpc } from "@/lib/trpc";

const CATALOGUE = [
  "Prédication",
  "Formation",
  "Conférence",
  "Atelier pratique",
  "Séminaire",
  "Accompagnement",
  "Rencontre avec les responsables",
  "Présentation du département",
  "Animation d’un programme",
  "Sensibilisation",
  "Conseil et accompagnement",
  "Autre intervention",
] as const;

type Department = {
  id: number;
  name: string;
};

export function InterventionTypeManager({
  departments,
}: {
  departments: Department[];
}) {
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");

  const utils = trpc.useUtils();

  const types = trpc.admin.interventionTypes.useQuery(
    {
      departmentId: departmentId ?? undefined,
      includeInactive: true,
    },
    {
      enabled: departmentId !== null,
    }
  );

  const save = trpc.admin.saveInterventionType.useMutation({
    onSuccess: async () => {
      await utils.admin.interventionTypes.invalidate();
      await utils.public.bootstrap.invalidate();
      setFeedback("Modification enregistrée avec succès.");
    },
    onError: (error) => {
      setFeedback(error.message);
    },
  });

  const currentTypes = types.data ?? [];

  const selectDepartment = (id: number) => {
    setDepartmentId(id);
    setFeedback("");
    save.reset();
  };

  const toggleType = (
    name: string,
    existing?: {
      id: number;
      active: "YES" | "NO";
    }
  ) => {
    if (!departmentId || save.isPending) return;

    setFeedback("");

    save.mutate({
      id: existing?.id,
      departmentId,
      name,
      active: existing?.active === "YES" ? "NO" : "YES",
    });
  };

  return (
    <SectionCard>
      <Text
        style={{
          color: GCV.navy,
          fontWeight: "800",
          fontSize: 16,
          marginBottom: 8,
        }}
      >
        Types d’intervention par département
      </Text>

      <Text
        style={{
          color: GCV.muted,
          marginBottom: 16,
        }}
      >
        Sélectionnez les interventions proposées par votre département.
        Les églises verront uniquement les interventions activées.
      </Text>

      <Text
        style={{
          color: GCV.navy,
          fontWeight: "700",
          marginBottom: 8,
        }}
      >
        Département
      </Text>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 18,
        }}
      >
        {departments.map((department) => (
          <Pressable
            key={department.id}
            accessibilityRole="button"
            accessibilityState={{
              selected: departmentId === department.id,
            }}
            onPress={() => selectDepartment(department.id)}
            style={{
              borderWidth: 1,
              borderRadius: 18,
              padding: 10,
              borderColor: GCV.border,
              backgroundColor:
                departmentId === department.id ? GCV.navy : "#FFFFFF",
            }}
          >
            <Text
              style={{
                color:
                  departmentId === department.id ? "#FFFFFF" : GCV.text,
              }}
            >
              {department.name}
            </Text>
          </Pressable>
        ))}
      </View>

      {departmentId === null ? (
        <Text style={{ color: GCV.muted }}>
          Choisissez un département pour afficher le catalogue.
        </Text>
      ) : types.isLoading ? (
        <LoadingBlock label="Chargement des interventions…" />
      ) : types.error ? (
        <Text style={{ color: GCV.danger }}>
          {types.error.message}
        </Text>
      ) : (
        <>
          <Text
            style={{
              color: GCV.navy,
              fontWeight: "800",
              marginBottom: 12,
            }}
          >
            Catalogue des interventions
          </Text>

          {CATALOGUE.map((name) => {
            const existing = currentTypes.find(
              (item) => item.name === name
            );

            const active = existing?.active === "YES";

            return (
              <View
                key={name}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderColor: GCV.border,
                }}
              >
                <View style={{ flex: 1, minWidth: 150 }}>
                  <Text
                    style={{
                      color: GCV.text,
                      fontWeight: "700",
                    }}
                  >
                    {name}
                  </Text>

                  <Text
                    style={{
                      color: active ? "#176B43" : GCV.muted,
                      marginTop: 3,
                    }}
                  >
                    {active ? "Disponible pour les églises" : "Non proposé"}
                  </Text>
                </View>

                <PrimaryButton
                  label={active ? "DÉSACTIVER" : "ACTIVER"}
                  tone="secondary"
                  disabled={save.isPending}
                  onPress={() => toggleType(name, existing)}
                />
              </View>
            );
          })}

          {currentTypes
            .filter((item) => !CATALOGUE.some((name) => name === item.name))
            .map((item) => (
              <View
                key={item.id}
                style={{
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderColor: GCV.border,
                  gap: 8,
                }}
              >
                <Text style={{ color: GCV.text, fontWeight: "700" }}>
                  {item.name} — Type existant
                </Text>

                <PrimaryButton
                  label={
                    item.active === "YES" ? "DÉSACTIVER" : "RÉACTIVER"
                  }
                  tone="secondary"
                  disabled={save.isPending}
                  onPress={() => toggleType(item.name, item)}
                />
              </View>
            ))}

          {feedback ? (
            <Text
              style={{
                color: save.isError ? GCV.danger : "#176B43",
                marginTop: 16,
                fontWeight: "700",
              }}
            >
              {feedback}
            </Text>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
