import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Field, GCV, PrimaryButton, SectionCard } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

export default function DataRightsScreen() {
  const router = useRouter();
  const mutation = trpc.public.privacyRequest.useMutation();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"ACCESS" | "DELETE">("ACCESS");
  const [sent, setSent] = useState(false);

  const submit = async () => {
    await mutation.mutateAsync({
      email: email.trim(),
      requestType: kind,
      message: message.trim() || undefined,
    });
    setSent(true);
  };

  return (
    <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.back} onPress={() => router.back()}>‹ Retour</Text>

        <Text style={styles.title}>Vos données personnelles</Text>
        <Text style={styles.intro}>
          Vous pouvez exercer les droits qui vous sont applicables concernant les données personnelles traitées dans le cadre de l’Agenda GCV-UFB.
        </Text>

        {sent ? (
          <SectionCard>
            <Text style={styles.success}>Votre demande a bien été transmise à la GCV-UFB.</Text>
            <Text style={styles.text}>
              Elle sera examinée et une réponse vous sera apportée dans les délais prévus par la réglementation applicable.
            </Text>
            <PrimaryButton label="RETOUR À L’ACCUEIL" onPress={() => router.replace("/" as never)} />
          </SectionCard>
        ) : (
          <>
            <SectionCard>
              <Text style={styles.sectionTitle}>Demande en ligne</Text>
              <Text style={styles.text}>
                Ce formulaire permet de demander l’accès aux données associées à votre adresse e-mail ou leur effacement lorsqu’il est applicable.
              </Text>

              <View style={styles.options}>
                {(["ACCESS", "DELETE"] as const).map((item) => (
                  <Pressable
                    key={item}
                    onPress={() => setKind(item)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: kind === item }}
                    style={[styles.option, kind === item && styles.selected]}
                  >
                    <Text style={[styles.optionText, kind === item && styles.selectedText]}>
                      {item === "ACCESS" ? "Accéder à mes données" : "Demander l’effacement"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Field
                label="Adresse e-mail"
                value={email}
                onChangeText={setEmail}
                placeholder="nom@exemple.fr"
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <Field
                label="Précision facultative"
                value={message}
                onChangeText={setMessage}
                placeholder="Précisez votre demande si nécessaire"
                multiline
              />

              <PrimaryButton
                label={mutation.isPending ? "ENVOI…" : "ENVOYER LA DEMANDE"}
                disabled={!email.trim() || mutation.isPending}
                onPress={submit}
              />

              {mutation.error ? <Text style={styles.error}>{mutation.error.message}</Text> : null}
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Autres droits</Text>
              <Text style={styles.text}>
                Pour demander la rectification de données inexactes, la limitation d’un traitement ou exercer votre droit d’opposition lorsqu’il est applicable, contactez la GCV-UFB à l’adresse gcv.ufb@adventiste.org.
              </Text>
              <Text style={styles.text}>
                Une vérification de votre identité peut être demandée lorsqu’elle est nécessaire pour protéger vos données.
              </Text>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Responsable du traitement</Text>
              <Text style={styles.text}>
                Union Franco-Belge des Églises adventistes de la France, Belgique et Luxembourg (UFB).
              </Text>
              <Text style={styles.text}>
                Contact opérationnel : Département de la Gestion Chrétienne de la Vie (GCV-UFB) — gcv.ufb@adventiste.org.
              </Text>
              <Pressable onPress={() => router.push("/privacy" as never)}>
                <Text style={styles.link}>Consulter la politique de confidentialité</Text>
              </Pressable>
            </SectionCard>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create<any>({
  content: {
    paddingTop: 18,
    paddingBottom: 36,
    gap: 16,
    alignSelf: "center",
    width: "100%",
    maxWidth: 680,
  },
  back: { color: GCV.blue, fontWeight: "700" },
  title: { color: GCV.navy, fontSize: 28, fontWeight: "800" },
  intro: { color: GCV.muted, fontSize: 14, lineHeight: 21 },
  sectionTitle: { color: GCV.navy, fontSize: 17, fontWeight: "800" },
  text: { color: GCV.muted, fontSize: 14, lineHeight: 21 },
  options: { gap: 8 },
  option: {
    borderWidth: 1,
    borderColor: "#C7D6E0",
    padding: 12,
    borderRadius: 10,
  },
  selected: {
    borderColor: GCV.blue,
    backgroundColor: "#E2F0F9",
  },
  optionText: { color: GCV.text, fontWeight: "700" },
  selectedText: { color: GCV.navy },
  success: {
    color: "#176B43",
    fontWeight: "800",
    fontSize: 16,
    lineHeight: 22,
  },
  link: { color: GCV.blue, fontWeight: "800", fontSize: 13 },
  error: { color: "#A93838", fontSize: 13, fontWeight: "700" },
});
