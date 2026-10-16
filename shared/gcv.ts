export const ADMIN_EMAIL = "gcv.ufb@adventiste.org";

export const SLOT_STATUSES = [
  "AVAILABLE",
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "UNAVAILABLE",
] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export const REQUEST_STATUSES = ["PENDING", "CONFIRMED", "REFUSED", "CANCELLED", "RESCHEDULED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const FEDERATIONS = ["FFN", "FFS", "FBL"] as const;
export const STATUS_META: Record<SlotStatus, { label: string; color: string; background: string }> = {
  AVAILABLE: { label: "Disponible", color: "#177245", background: "#DDF5E7" },
  PENDING_CONFIRMATION: { label: "En attente", color: "#9A5B04", background: "#FFF0CF" },
  CONFIRMED: { label: "Confirmée", color: "#155A83", background: "#DCEFFC" },
  UNAVAILABLE: { label: "Indisponible", color: "#8B2B2B", background: "#FCE3E3" },
};

export const DEFAULT_FIELDS = {
  interventionType: { visible: true, required: true },
  message: { visible: true, required: false },
  desiredTime: { visible: true, required: false },
  churchAddress: { visible: true, required: false },
} as const;

export const DEFAULT_EMAIL_TEMPLATES = {
  requestSubject: "Nouvelle invitation {{departement}} — {{date}} — {{eglise}}",
  requestBody: "Nouvelle demande d’intervention UFB\n\nDépartement : {{departement}}\nFédération : {{federation}}\nÉglise : {{eglise}}\nNom et prénom : {{contact}}\nE-mail : {{email}}\nTéléphone : {{telephone}}\nDate demandée : {{date}}\nType d’intervention : {{type}}\nHeure souhaitée : {{heure}}\nAdresse de l’église : {{adresse}}\nInformations complémentaires : {{message}}\nIdentifiant de la demande : {{identifiant}}",
  confirmationSubject: "Confirmation de votre invitation — UFB",
  confirmationBody: "Bonjour {{prenom}},\n\nNous avons le plaisir de vous confirmer votre demande d’invitation pour :\n\nDate : {{date}}\nÉglise : {{eglise}}\nFédération : {{federation}}\nType d’intervention : {{type}}\n\nVotre invitation est désormais enregistrée dans l’agenda UFB.\n\nPour toute information complémentaire, vous pouvez nous contacter à gcv.ufb@adventiste.org.\n\nBien fraternellement,\nDépartements de l’Union Franco-Belge\nUnion Franco-Belge\nUFB",
  refusalSubject: "Votre demande d’invitation — UFB",
  refusalBody: "Bonjour {{prenom}},\n\nMerci pour votre demande d’invitation auprès de la Départements de l’Union Franco-Belge de l’Union Franco-Belge.\n\nMalheureusement, nous ne sommes pas en mesure de confirmer la date suivante : {{date}}.\n\nNous vous invitons à consulter de nouveau les dates disponibles et, si vous le souhaitez, à effectuer une nouvelle demande.\n\n{{lien_agenda}}\n\nPour toute question : gcv.ufb@adventiste.org\n\nBien fraternellement,\nDépartements de l’Union Franco-Belge\nUnion Franco-Belge\nUFB",
  cancellationSubject: "Mise à jour de votre invitation — UFB",
  cancellationBody: "Bonjour {{prenom}},\n\nVotre invitation prévue le {{date}} à {{eglise}} a été annulée.\n\nPour toute question, contactez gcv.ufb@adventiste.org.\n\nBien fraternellement,\nDépartements de l’Union Franco-Belge\nUnion Franco-Belge\nUFB",
  rescheduleSubject: "Modification de votre invitation — UFB",
  rescheduleBody: "Bonjour {{prenom}},\n\nVotre invitation a été déplacée au {{date}} à {{eglise}}.\n\nPour toute question, contactez gcv.ufb@adventiste.org.\n\nBien fraternellement,\nDépartements de l’Union Franco-Belge\nUnion Franco-Belge\nUFB",
  updateSubject: "Mise à jour de votre invitation — UFB",
  updateBody: "Bonjour {{prenom}},\n\nLes informations de votre invitation ont été mises à jour :\n\nDate : {{date}}\nÉglise : {{eglise}}\nFédération : {{federation}}\nContact : {{contact}}\nType d’intervention : {{type}}\n\nPour toute question, contactez gcv.ufb@adventiste.org.\n\nBien fraternellement,\nDépartements de l’Union Franco-Belge\nUnion Franco-Belge\nUFB",
  reminderSubject: "Rappel UFB — {{date}} — {{eglise}}",
  reminderBody: "Rappel : une intervention est prévue le {{date}} à {{eglise}}.\n\nFédération : {{federation}}\nType d’intervention : {{type}}\n\nPour toute question, contactez gcv.ufb@adventiste.org.",
} as const;

export function toFrenchDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(`${value}T12:00:00`) : value;
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
