import { useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { Field, GCV, LoadingBlock, PrimaryButton, SectionCard } from "@/components/gcv-ui";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

export default function OwnPasswordScreen() {
  const router = useRouter();
  const auth = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const change = trpc.admin.changeOwnPassword.useMutation({
    onSuccess: () => {
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setFeedback({ error: false, message: "Votre mot de passe a été modifié. Utilisez le nouveau mot de passe lors de votre prochaine connexion." });
      change.reset();
    },
    onError: (error) => {
      setFeedback({ error: true, message: error.message });
      change.reset();
    },
  });
  const submit = () => {
    setFeedback(null);
    if (!currentPassword) { setFeedback({ error: true, message: "Saisissez votre mot de passe actuel." }); return; }
    if (newPassword.length < 12 || newPassword.length > 200) { setFeedback({ error: true, message: "Le nouveau mot de passe doit contenir entre 12 et 200 caractères." }); return; }
    if (newPassword !== confirmPassword) { setFeedback({ error: true, message: "Les nouveaux mots de passe ne correspondent pas." }); return; }
    if (currentPassword === newPassword) { setFeedback({ error: true, message: "Choisissez un nouveau mot de passe différent du mot de passe actuel." }); return; }
    change.mutate({ currentPassword, newPassword, confirmPassword });
  };
  if (auth.loading) return <ScreenContainer><LoadingBlock label="Vérification de l’accès…" /></ScreenContainer>;
  if (!auth.user?.adminRole) return <ScreenContainer><Text style={styles.error}>Connectez-vous avec un compte autorisé.</Text></ScreenContainer>;
  return <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5">
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <PrimaryButton label="RETOUR AU TABLEAU DE BORD" tone="secondary" onPress={() => router.replace("/admin" as never)} />
      <Text style={styles.title}>Mon mot de passe</Text>
      <Text style={styles.text}>Vous modifiez uniquement le mot de passe de votre propre compte.</Text>
      <SectionCard>
        <Text style={styles.account}>{auth.user.email}</Text>
        <Field label="Mot de passe actuel" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoCapitalize="none" />
        <Field label="Nouveau mot de passe" value={newPassword} onChangeText={setNewPassword} placeholder="12 caractères minimum" secureTextEntry autoCapitalize="none" />
        <Field label="Confirmer le nouveau mot de passe" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoCapitalize="none" />
        <Text style={styles.text}>Choisissez un mot de passe différent, de 12 à 200 caractères. Les espaces éventuels font partie du mot de passe.</Text>
        {feedback ? <View accessibilityRole="alert"><Text style={feedback.error ? styles.error : styles.success}>{feedback.message}</Text></View> : null}
        <PrimaryButton label={change.isPending ? "MODIFICATION…" : "MODIFIER MON MOT DE PASSE"} icon="key-outline" onPress={submit} disabled={change.isPending || !currentPassword || !newPassword || !confirmPassword} />
      </SectionCard>
      <Text style={styles.text}>Vous avez oublié le mot de passe actuel ? Demandez à l’administration générale UFB de vous attribuer un mot de passe provisoire, puis revenez ici pour le remplacer.</Text>
    </ScrollView>
  </ScreenContainer>;
}

const styles = StyleSheet.create({
  content: { paddingVertical: 24, gap: 16, width: "100%", maxWidth: 620, alignSelf: "center" },
  title: { color: GCV.navy, fontSize: 27, fontWeight: "800" },
  account: { color: GCV.navy, fontSize: 14, fontWeight: "700" },
  text: { color: GCV.muted, fontSize: 13, lineHeight: 20 },
  error: { color: GCV.danger, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  success: { color: "#176B43", fontSize: 14, lineHeight: 20, fontWeight: "700" },
});
