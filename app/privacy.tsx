import { ScrollView, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { GCV, PrimaryButton, SectionCard } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";

export default function PrivacyScreen() {
  const router = useRouter();

  return (
    <ScreenContainer containerClassName="bg-[#F4F8FB]" className="px-5">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.back} onPress={() => router.back()}>
          ‹ Retour
        </Text>

        <Text style={styles.title}>Politique de confidentialité</Text>
        <Text style={styles.intro}>
          Cette politique explique comment les données personnelles sont
          traitées dans le cadre de l’Agenda des invitations de prédication de
          la GCV-UFB.
        </Text>

        <SectionCard>
          <Text style={styles.heading}>Responsable du traitement</Text>
          <Text style={styles.text}>
            Le responsable du traitement est l’Union Franco-Belge des Églises
            adventistes de la France, Belgique et Luxembourg (UFB).
          </Text>
          <Text style={styles.text}>
            Le Département de la Gestion Chrétienne de la Vie (GCV-UFB) assure
            la gestion opérationnelle de ce service.
          </Text>
          <Text style={styles.text}>
            Contact pour les questions relatives aux données personnelles :
            gcv.ufb@adventiste.org.
          </Text>
        </SectionCard>

        <SectionCard>
          <Text style={styles.heading}>Finalités du traitement</Text>
          <Text style={styles.text}>
            Les données sont traitées afin de recevoir, examiner et organiser
            les demandes d’invitation de prédication, communiquer avec les
            personnes concernées, confirmer ou libérer les dates demandées et
            assurer les rappels nécessaires à l’organisation des interventions.
          </Text>
          <Text style={styles.text}>
            Elles ne sont pas utilisées à des fins commerciales ou
            publicitaires.
          </Text>
        </SectionCard>

        <SectionCard>
          <Text style={styles.heading}>Données traitées</Text>
          <Text style={styles.text}>
            Selon les informations fournies lors de la demande, le service peut
            traiter notamment : fédération, église, nom du contact, adresse
            e-mail, numéro de téléphone, date souhaitée, horaire, type
            d’intervention, adresse de l’église et message d’organisation.
          </Text>
          <Text style={styles.text}>
            Des informations techniques nécessaires au fonctionnement, à la
            sécurité, à l’envoi des e-mails et au suivi administratif de la
            demande peuvent également être enregistrées.
          </Text>
        </SectionCard>

        <SectionCard>
          <Text style={styles.heading}>Contexte religieux</Text>
          <Text style={styles.text}>
            Le service est principalement destiné aux responsables GCV et aux
            membres des églises adventistes du territoire de l’UFB. Dans ce
            contexte, certaines informations peuvent révéler ou permettre de
            déduire une appartenance ou une conviction religieuse. Ces données
            font l’objet d’une protection renforcée et ne doivent être traitées
            que dans le cadre des activités légitimes de l’organisation et avec
            les garanties applicables.
          </Text>
        </SectionCard>

        <SectionCard>
          <Text style={styles.heading}>Base juridique</Text>
          <Text style={styles.text}>
            Les traitements sont mis en œuvre dans le cadre de l’organisation
            des activités de la GCV-UFB et de la gestion des demandes adressées
            au service. Les bases juridiques applicables sont documentées par
            l’UFB en fonction de la finalité concernée et de la nature des
            données traitées.
          </Text>
        </SectionCard>

        <SectionCard>
          <Text style={styles.heading}>Destinataires et prestataires</Text>
          <Text style={styles.text}>
            L’accès aux données est limité aux personnes habilitées qui en ont
            besoin pour gérer les invitations et administrer le service.
          </Text>
          <Text style={styles.text}>
            Des prestataires techniques peuvent traiter certaines données pour
            assurer l’hébergement, la base de données et l’envoi des e-mails.
            Ils interviennent dans le cadre des services techniques nécessaires
            au fonctionnement de l’application.
          </Text>
        </SectionCard>

        <SectionCard>
          <Text style={styles.heading}>E-mails et sécurité</Text>
          <Text style={styles.text}>
            Les e-mails liés aux invitations sont envoyés au moyen de l’API
            Gmail avec une autorisation OAuth sécurisée côté serveur. Les
            secrets et jetons nécessaires au fonctionnement du service ne sont
            pas affichés dans l’application.
          </Text>
          <Text style={styles.text}>
            Des mesures techniques et organisationnelles sont mises en œuvre
            afin de limiter l’accès aux données et de protéger le service.
          </Text>
        </SectionCard>

        <SectionCard>
          <Text style={styles.heading}>Cookies et traceurs</Text>
          <Text style={styles.text}>
            L’application utilise des cookies techniques strictement
            nécessaires à l’authentification, à la sécurité et au fonctionnement
            du service. Aucun cookie publicitaire ou de profilage n’est utilisé
            par l’application.
          </Text>
        </SectionCard>

        <SectionCard>
          <Text style={styles.heading}>Durée de conservation</Text>
          <Text style={styles.text}>
            Les données personnelles ne sont conservées que pendant la durée
            nécessaire aux finalités pour lesquelles elles sont traitées, puis
            sont supprimées ou anonymisées selon les règles de conservation
            définies par l’UFB. Les durées opérationnelles sont régulièrement
            réexaminées afin de rester proportionnées aux besoins du service.
          </Text>
        </SectionCard>

        <SectionCard>
          <Text style={styles.heading}>Vos droits</Text>
          <Text style={styles.text}>
            Dans les conditions prévues par le RGPD, vous pouvez notamment
            demander l’accès à vos données, leur rectification ou leur
            effacement, ainsi que la limitation du traitement et, lorsque le
            droit est applicable, vous opposer au traitement.
          </Text>
          <Text style={styles.text}>
            Vous pouvez exercer vos droits auprès de la GCV-UFB à l’adresse
            gcv.ufb@adventiste.org. Une vérification d’identité peut être
            demandée lorsqu’elle est nécessaire pour protéger vos données.
          </Text>
          <PrimaryButton
            label="EXERCER MES DROITS"
            tone="secondary"
            onPress={() => router.push("/data-rights" as never)}
          />
        </SectionCard>

        <SectionCard>
          <Text style={styles.heading}>Réclamation</Text>
          <Text style={styles.text}>
            Si vous estimez, après avoir contacté l’UFB, que vos droits relatifs
            à la protection de vos données ne sont pas respectés, vous pouvez
            introduire une réclamation auprès de l’autorité de contrôle
            compétente, notamment la CNIL en France.
          </Text>
        </SectionCard>

        <Text style={styles.contact}>
          Contact données personnelles : gcv.ufb@adventiste.org
        </Text>
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
    maxWidth: 720,
  },
  back: {
    color: GCV.blue,
    fontWeight: "700",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: GCV.navy,
  },
  intro: {
    color: GCV.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  heading: {
    color: GCV.navy,
    fontSize: 17,
    fontWeight: "800",
  },
  text: {
    color: GCV.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  contact: {
    color: GCV.muted,
    fontSize: 13,
    textAlign: "center",
  },
});
