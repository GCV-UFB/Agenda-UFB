export const FEDERATIONS = ["FFN", "FFS", "FBL"] as const;

export const DEPARTMENTS = [
  { code: "GCV", name: "Gestion chrétienne de la vie (GCV)" },
  { code: "JEUNESSE", name: "Ministère de la Jeunesse" },
  { code: "FAMILLE", name: "Ministère de la Famille" },
  { code: "SANTE", name: "Ministère de la Santé" },
  { code: "EDUCATION", name: "Éducation" },
  { code: "EDS_MP", name: "École du sabbat et Ministères personnels" },
  { code: "FEMMES", name: "Ministère des Femmes" },
  { code: "ENFANTS", name: "Ministère auprès des enfants" },
  { code: "COMMUNICATION", name: "Communication" },
  { code: "LIBERTE_RELIGIEUSE", name: "Liberté religieuse" },
  { code: "ASSOCIATION_PASTORALE", name: "Association pastorale" },
  { code: "HOPE_CHANNEL", name: "Hope Channel" },
  { code: "HOPE_MEDIA", name: "Hope Media" },
  { code: "HOPE_RADIO", name: "Hope Radio" },
  { code: "BESOINS_SPECIFIQUES", name: "Ministère des Besoins spécifiques" },
  { code: "MUSULMANS", name: "Ministère auprès des musulmans" },
  { code: "PRIERE", name: "Ministère de la Prière" },
] as const;

export type FederationCode = (typeof FEDERATIONS)[number];
export type DepartmentCode = (typeof DEPARTMENTS)[number]["code"];

export function departmentName(code: string) {
  return DEPARTMENTS.find((department) => department.code === code)?.name ?? code;
}
