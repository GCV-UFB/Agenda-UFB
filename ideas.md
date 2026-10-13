# Direction de design — GCV-UFB

## Direction retenue

**Institutionnelle sereine.** L’application inspire confiance et disponibilité plutôt que conversion commerciale : une base bleu nuit, des surfaces blanches, des gris bleutés très légers et des repères de statut immédiatement lisibles.

## Écrans et parcours

| Écran | Contenu principal | Parcours tactile |
|---|---|---|
| Accueil | Icône calendrier GCV, titre institutionnel, présentation et deux entrées | Demander une date → formulaire; Espace administrateur → authentification et tableau de bord |
| Demande | Date réellement disponible, fédération, coordonnées, champs configurables et consentement RGPD | Choisir une date → remplir les coordonnées → accepter le traitement → envoyer → reçu avec référence |
| Reçu | Référence unique et indication transparente sur l’envoi ou le mode preview | Retour à l’accueil |
| Politique et droits | Finalité, conservation, demandes d’accès/suppression | Lire la politique → transmettre le droit d’accès ou d’effacement |
| Tableau de bord | Quatre indicateurs, prochaine intervention, total annuel, séries mensuelles et répartitions | Traiter le résumé en attente → ouvrir demandes, agenda, réglages ou droits RGPD |
| Agenda | Grille mensuelle lun.-dim., filtres d’état/fédération, légende et création rapide | Choisir un jour → bloquer/libérer ou ouvrir l’invitation associée |
| Demandes et invitations | Recherche, filtres par statut/mois/fédération, historique, détail et informations de contact | Confirmer/libérer une demande; modifier les coordonnées; annuler et libérer/bloquer; choisir une nouvelle date puis déplacer |
| Réglages | Fédérations, visibilité/obligation de champs, rappels, conservation, exports CSV/XLSX et compte Microsoft 365 | Modifier un réglage → enregistrer → voir le résultat du serveur |
| Droits RGPD | Liste des demandes ACCESS/DELETE, dossiers associés, export de données et anonymisation contrôlée | Sélectionner une demande → examiner les dossiers → répondre ou anonymiser après confirmation |
| Historique | Journal d’audit administratif, dates et acteurs | Parcourir les opérations récentes |

## Système visuel

- **Mouvement:** modernisme institutionnel calme; information organisée par blocs et séparateurs fins.
- **Couleurs:** bleu profond `#123A5A`, bleu action `#1C6FA8`, ciel `#86C6E6`, blanc et gris bleuté `#E8EEF3`; vert pour disponible/confirmé, ambre pour attente, rouge feutré pour indisponible/refus.
- **Mise en page:** portrait et usage à une main, largeur de lecture confortable, grandes zones tactiles, boutons primaires simples et navigation hiérarchisée; la version Web reste responsive.
- **Éléments signature:** calendrier plat à fond bleu plein, repère de date, jours teintés avec libellés accessibles et badges d’état; aucune imitation de marque officielle non fournie.
- **Interactions:** pas d’animation décorative; états de chargement, erreurs françaises et confirmations explicites pour mutations sensibles et suppression.
- **Typographie:** sans sérif humaine, lisible à petite taille; titres fermes, texte d’accompagnement chaleureux; chiffres d’agenda distincts.
- **Voix de marque:** fraternelle, précise et respectueuse; jamais commerciale ou pressante.
- **Logo/icône:** calendrier ouvert très lisible, surface blanche et bande bleu clair sur bleu nuit, sans texte ni coins arrondis intégrés; même identité au launcher, splash, favicon et icônes Android.

## Contraintes d’accessibilité

Les couleurs d’état sont toujours accompagnées d’un libellé et d’une structure accessible. Les actions sensibles attendent la réponse du serveur et les suppressions demandent une confirmation qui fonctionne sur Expo Web et sur mobile. Les libellés, messages d’erreur et champs restent en français de France avec les accents exacts.
