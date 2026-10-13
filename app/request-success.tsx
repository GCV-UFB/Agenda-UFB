import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BrandMark, GCV, PrimaryButton, SectionCard } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";

export default function RequestSuccess() {
  const router = useRouter();
  const { id, emailStatus } = useLocalSearchParams<{ id?: string; emailStatus?: string }>();
  const summary = emailStatus === "SENT"
    ? "Votre date est maintenant réservée en attente de confirmation. La GCV-UFB a été informée et vous recevrez sa décision par e-mail."
    : "Votre date est maintenant réservée en attente de confirmation. La notification n’a pas été envoyée; l’équipe pourra consulter la demande dans l’espace administrateur. Ne soumettez pas une deuxième demande pour cette date.";
  const notice = emailStatus === "SENT"
    ? "La GCV-UFB a également reçu une notification par courriel."
    : emailStatus === "FAILED"
      ? "La demande est bien enregistrée, mais la notification par courriel n’a pas pu être envoyée. L’équipe pourra la consulter dans l’espace administrateur; ne soumettez pas une deuxième demande pour cette date."
      : "La demande est bien enregistrée, mais aucune notification par courriel n’a été envoyée car le service Gmail API n’est pas disponible. L’équipe pourra la consulter dans l’espace administrateur; ne soumettez pas une deuxième demande pour cette date.";
  return <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5 justify-center"><View style={styles.wrap}><BrandMark /><SectionCard style={styles.card}><Text style={styles.eyebrow}>DEMANDE ENREGISTRÉE</Text><Text style={styles.title}>Merci pour votre demande.</Text><Text style={styles.text}>{summary}</Text><Text style={[styles.notice, emailStatus === "SENT" ? styles.noticeSent : styles.noticePending]}>{notice}</Text>{id ? <View style={styles.id}><Text style={styles.idLabel}>Identifiant de la demande</Text><Text style={styles.idValue}>{id}</Text></View> : null}<PrimaryButton label="RETOUR À L’ACCUEIL" onPress={() => router.replace("/" as never)} /></SectionCard></View></ScreenContainer>;
}
const styles = StyleSheet.create<any>({ wrap: { alignSelf: "center", width: "100%", maxWidth: 510, gap: 18, alignItems: "center" }, card: { width: "100%", padding: 24, gap: 14 }, eyebrow: { color: GCV.blue, fontWeight: "900", letterSpacing: 1, fontSize: 11 }, title: { color: GCV.navy, fontSize: 27, lineHeight: 33, fontWeight: "800" }, text: { color: GCV.muted, fontSize: 15, lineHeight: 22 }, notice: { borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19, fontWeight: "700" }, noticeSent: { color: "#176B43", backgroundColor: "#E7F5EC" }, noticePending: { color: "#84560B", backgroundColor: "#FFF6E7" }, id: { backgroundColor: "#EFF6FA", borderRadius: 10, padding: 13, gap: 3 }, idLabel: { color: GCV.muted, fontSize: 12, fontWeight: "700" }, idValue: { color: GCV.navy, fontSize: 16, fontWeight: "900", letterSpacing: 0.6 } });
