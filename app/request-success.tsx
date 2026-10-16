import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BrandMark, GCV, PrimaryButton, SectionCard } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";

export default function RequestSuccess() {
  const router = useRouter();
  const { id, emailStatus } = useLocalSearchParams<{
    id?: string;
    emailStatus?: string;
  }>();

  const notification =
    emailStatus === "SENT"
      ? "Une notification a également été envoyée à l’équipe concernée."
      : "Les notifications par e-mail ne sont pas encore disponibles. Votre demande reste enregistrée et accessible à l’administration.";

  return (
    <ScreenContainer
      containerClassName="bg-[#F4F8FB]"
      className="px-5 justify-center"
    >
      <View style={styles.wrap}>
        <BrandMark />

        <SectionCard style={styles.card}>
          <Text style={styles.eyebrow}>UNION FRANCO-BELGE</Text>

          <Text style={styles.success}>
            ✓ Votre demande a bien été enregistrée !
          </Text>

          <Text style={styles.text}>
            Votre demande d’intervention a été enregistrée et sera examinée
            par le département concerné.
          </Text>

          <View style={styles.reference}>
            <Text style={styles.referenceLabel}>
              NUMÉRO DE RÉFÉRENCE
            </Text>

            <Text selectable style={styles.referenceValue}>
              {id || "Référence indisponible"}
            </Text>

            <Text style={styles.referenceHint}>
              Conservez ce numéro pour tout échange concernant votre demande.
            </Text>
          </View>

          <View style={styles.status}>
            <Text style={styles.statusText}>
              Statut : En attente de confirmation
            </Text>
          </View>

          <Text style={styles.text}>
            {notification}
          </Text>

          <Text style={styles.reminder}>
            Il n’est pas nécessaire de soumettre une nouvelle demande.
          </Text>

          <PrimaryButton
            label="RETOUR À L’ACCUEIL"
            onPress={() => router.replace("/" as never)}
          />
        </SectionCard>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 540,
    gap: 18,
    alignItems: "center",
  },
  card: {
    width: "100%",
    padding: 26,
    gap: 18,
  },
  eyebrow: {
    color: GCV.blue,
    fontWeight: "800",
    letterSpacing: 1.2,
    fontSize: 11,
  },
  success: {
    color: "#176B43",
    fontSize: 25,
    lineHeight: 33,
    fontWeight: "800",
  },
  text: {
    color: GCV.muted,
    fontSize: 15,
    lineHeight: 23,
  },
  reference: {
    backgroundColor: "#EFF6FA",
    borderRadius: 12,
    padding: 22,
    gap: 10,
    alignItems: "center",
  },
  referenceLabel: {
    color: GCV.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  referenceValue: {
    color: GCV.navy,
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
  },
  referenceHint: {
    color: GCV.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  status: {
    backgroundColor: "#FFF6E7",
    padding: 14,
    borderRadius: 10,
  },
  statusText: {
    color: "#84560B",
    fontSize: 14,
    fontWeight: "700",
  },
  reminder: {
    color: GCV.navy,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});
