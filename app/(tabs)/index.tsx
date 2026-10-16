import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { BrandMark, GCV, PrimaryButton, SectionCard } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";

export default function HomeScreen() {
  const router = useRouter();
  return <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5">
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}><View style={styles.logoPosition}><BrandMark /></View><View style={styles.wordmark}><Text style={styles.kicker}>UNION FRANCO-BELGE</Text><Text style={styles.brand}>Agenda des invitations</Text></View></View>
      <View style={styles.hero}><Text style={styles.heroEyebrow}>DÉPARTEMENTS DE L’UNION FRANCO-BELGE</Text><Text style={styles.heroTitle}>Invitations et interventions UFB</Text><Text style={styles.heroText}>Union Franco-Belge</Text><View style={styles.rule} /><Text style={styles.description}>Choisissez un département et demandez une date de prédication, de formation ou d’intervention.</Text></View>
      <View style={styles.actions}><PrimaryButton label="DEMANDER UNE DATE" icon="calendar-outline" onPress={() => router.push("/request" as never)} /><PrimaryButton label="ESPACE ADMINISTRATEUR" tone="secondary" icon="shield-checkmark-outline" onPress={() => router.push("/admin" as never)} /></View>
      <SectionCard style={styles.quoteCard}><Text style={styles.quote}>« Innover pour servir, connecter pour avancer »</Text><Text style={styles.quoteBy}>Les départements au service des églises · Union Franco-Belge</Text></SectionCard>
      <Text style={styles.footer}>Les informations transmises sont utilisées exclusivement pour l’organisation des interventions UFB.</Text>
    </ScrollView>
  </ScreenContainer>;
}

const styles = StyleSheet.create({
  content: { paddingTop: 20, paddingBottom: 34, gap: 22, flexGrow: 1, maxWidth: 720, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "center", width: "100%", minHeight: 64, position: "relative" }, logoPosition: { position: "absolute", left: 0, top: 12 },
  wordmark: { gap: 4, alignItems: "center", flexShrink: 1, paddingHorizontal: 115 }, kicker: { fontSize: 15, fontWeight: "900", letterSpacing: 0.8, color: GCV.blue }, brand: { fontSize: 24, fontWeight: "800", color: GCV.navy },
  hero: { backgroundColor: GCV.navy, padding: 26, borderRadius: 20, gap: 10, overflow: "hidden" },
  heroEyebrow: { color: "#93CDE9", fontSize: 11, fontWeight: "900", letterSpacing: 1.2 }, heroTitle: { color: "#FFFFFF", fontSize: 30, lineHeight: 36, fontWeight: "800", letterSpacing: -0.5 }, heroText: { color: "#DCECF7", fontSize: 17, fontWeight: "600" }, rule: { width: 56, height: 3, borderRadius: 3, backgroundColor: "#7DC3E6", marginVertical: 5 }, description: { color: "#DCECF7", fontSize: 15, lineHeight: 22, maxWidth: 480 },
  actions: { gap: 11 }, quoteCard: { alignItems: "center", paddingVertical: 20 }, quote: { color: GCV.navy, fontStyle: "italic", fontSize: 16, lineHeight: 23, textAlign: "center", fontWeight: "600" }, quoteBy: { color: GCV.muted, fontSize: 12, textAlign: "center" }, footer: { color: GCV.muted, fontSize: 12, lineHeight: 18, textAlign: "center", paddingHorizontal: 18 },
});
