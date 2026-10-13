import { useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { GCV, LoadingBlock, PrimaryButton, SectionCard } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { toFrenchDate } from "@/shared/gcv";

export default function AdminPrivacyScreen() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const requests = trpc.admin.privacyRequests.useQuery();
  const details = trpc.admin.privacyDetails.useQuery({ requestId: selectedId ?? 0 }, { enabled: selectedId !== null });
  const utils = trpc.useUtils();
  const status = trpc.admin.privacyStatus.useMutation({ onSuccess: () => { void utils.admin.privacyRequests.invalidate(); void details.refetch(); } });
  const complete = trpc.admin.privacyComplete.useMutation({ onSuccess: async () => { await utils.admin.privacyRequests.invalidate(); await details.refetch(); } });
  const current = requests.data?.find((item) => item.id === selectedId);
  const exportData = useMemo(() => details.data ? JSON.stringify({ privacyRequest: details.data.request, invitations: details.data.records }, null, 2) : "", [details.data]);

  const download = () => {
    if (Platform.OS !== "web" || typeof window === "undefined" || !exportData) return;
    const blob = new Blob([exportData], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `gcv-ufb-demande-acces-${selectedId}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const confirm = (title: string, message: string, action: () => void, destructive = false) => {
    if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) action(); return; }
    Alert.alert(title, message, [{ text: "Annuler", style: "cancel" }, { text: "Confirmer", style: destructive ? "destructive" : "default", onPress: action }]);
  };

  return <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5"><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.back} onPress={() => router.back()}>‹ Tableau de bord</Text><Text style={styles.kicker}>CONFIDENTIALITÉ · RGPD</Text><Text style={styles.title}>Demandes de droits</Text>
    <SectionCard><Text style={styles.body}>Les demandes d’accès sont consultables et exportables ci-dessous afin de répondre au demandeur. Un effacement est bloqué tant qu’une demande reste en attente ou qu’une intervention confirmée est future; après traitement, les renseignements des invitations closes sont anonymisés et les liens d’action supprimés.</Text></SectionCard>
    {requests.isLoading ? <LoadingBlock label="Chargement des demandes de confidentialité…" /> : requests.error ? <SectionCard><Text style={styles.error}>{requests.error.message}</Text></SectionCard> : requests.data?.length ? requests.data.map((item) => <Pressable key={item.id} onPress={() => setSelectedId(item.id)}><SectionCard style={selectedId === item.id ? styles.selected : undefined}>
      <View style={styles.row}><View style={{ flex: 1, gap: 4 }}><Text style={styles.itemTitle}>{item.requestType === "ACCESS" ? "Droit d’accès" : "Droit à l’effacement"}</Text><Text style={styles.body}>{item.email}</Text><Text style={styles.muted}>Reçue le {new Date(item.createdAt).toLocaleString("fr-FR")}</Text></View><Text style={styles.status}>{item.status === "COMPLETED" ? "Terminée" : item.status === "IN_PROGRESS" ? "En cours" : "Nouvelle"}</Text></View>
      {item.message ? <Text style={styles.body}>{item.message}</Text> : null}
    </SectionCard></Pressable>) : <SectionCard><Text style={styles.itemTitle}>Aucune demande de confidentialité</Text><Text style={styles.body}>Les demandes ACCESS ou DELETE transmises depuis le formulaire public apparaîtront ici.</Text></SectionCard>}
    {selectedId !== null ? <SectionCard><Text style={styles.itemTitle}>Traitement de la demande #{selectedId}</Text>{details.isLoading ? <LoadingBlock label="Recherche des données concernées…" /> : details.error ? <Text style={styles.error}>{details.error.message}</Text> : details.data ? <>
      <Text style={styles.body}>{details.data.records.length} invitation(s) associée(s) à cette adresse.</Text>
      {details.data.records.map(({ request, slot }) => <View key={request.id} style={styles.record}><Text style={styles.recordTitle}>{toFrenchDate(slot.date)} · {request.church}</Text><Text style={styles.muted}>{request.status} · {request.federation} · {request.contactName}</Text></View>)}
      {current?.requestType === "ACCESS" ? <><Text selectable style={styles.json}>{exportData}</Text><PrimaryButton label="TÉLÉCHARGER LES DONNÉES JSON" tone="secondary" icon="download-outline" onPress={download} /><Text style={styles.muted}>Après avoir communiqué ces données à la personne concernée, marquez sa demande comme traitée.</Text><PrimaryButton label="MARQUER COMME TRAITÉE" icon="checkmark-circle-outline" onPress={() => confirm("Terminer le traitement du droit d’accès ?", "Confirmez uniquement après avoir répondu au demandeur.", () => complete.mutate({ requestId: selectedId }))} disabled={complete.isPending || current.status === "COMPLETED"} /></> : <><Text style={styles.muted}>L’action anonymise les demandes closes et conserve uniquement une trace minimale de la demande RGPD.</Text><PrimaryButton label="MARQUER EN COURS" tone="secondary" onPress={() => status.mutate({ requestId: selectedId, status: "IN_PROGRESS" })} disabled={status.isPending || current?.status === "COMPLETED"} /><PrimaryButton label="ANONYMISER LES DONNÉES ET TERMINER" tone="danger" icon="trash-outline" onPress={() => confirm("Anonymiser les données personnelles ?", "Cette opération supprime les informations de contact, le message, les anciens liens d’action et remplace l’adresse de la demande. Elle est irréversible.", () => complete.mutate({ requestId: selectedId }), true)} disabled={complete.isPending || current?.status === "COMPLETED"} /></>}
    </> : null}</SectionCard> : null}
    {status.error || complete.error ? <SectionCard><Text style={styles.error}>{status.error?.message ?? complete.error?.message}</Text></SectionCard> : null}
  </ScrollView></ScreenContainer>;
}

const styles = StyleSheet.create<any>({ content: { paddingTop: 18, paddingBottom: 40, gap: 13, alignSelf: "center", width: "100%", maxWidth: 900 }, back: { color: GCV.blue, fontWeight: "800" }, kicker: { color: GCV.blue, fontSize: 10, letterSpacing: 1.1, fontWeight: "900" }, title: { color: GCV.navy, fontSize: 27, fontWeight: "900" }, body: { color: GCV.text, fontSize: 13, lineHeight: 20 }, muted: { color: GCV.muted, fontSize: 11, lineHeight: 17 }, row: { flexDirection: "row", alignItems: "center", gap: 9 }, itemTitle: { color: GCV.navy, fontSize: 16, fontWeight: "850" }, status: { color: GCV.blue, backgroundColor: "#E8F0F6", padding: 7, borderRadius: 99, fontSize: 10, fontWeight: "850" }, selected: { borderColor: GCV.blue, borderWidth: 2 }, record: { borderTopWidth: 1, borderColor: GCV.border, paddingTop: 9 }, recordTitle: { color: GCV.text, fontSize: 13, fontWeight: "800" }, json: { color: GCV.muted, backgroundColor: "#F4F8FB", maxHeight: 240, padding: 10, fontSize: 9 }, error: { color: GCV.danger, fontWeight: "800", fontSize: 12 } });
