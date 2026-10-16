import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { STATUS_META, type SlotStatus } from "@/shared/gcv";

export const GCV = {
  navy: "#123A5A",
  blue: "#1C6FA8",
  pale: "#F4F8FB",
  border: "#DCE6ED",
  text: "#17324B",
  muted: "#61778A",
  danger: "#A93838",
};

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <Image accessibilityLabel="Logo officiel de l’Union Franco-Belge" source={require("../assets/images/ufb-logo.png")} resizeMode="contain" style={[styles.brandMark, compact && styles.brandMarkCompact]} />;
}

export function PrimaryButton({ label, onPress, disabled, tone = "primary", icon }: { label: string; onPress: () => void; disabled?: boolean; tone?: "primary" | "secondary" | "danger" | "warning"; icon?: keyof typeof Ionicons.glyphMap }) {
  const palette = tone === "danger" ? { bg: "#A93838", color: "#fff" } : tone === "warning" ? { bg: "#A86B12", color: "#fff" } : tone === "secondary" ? { bg: "#E8F0F6", color: GCV.navy } : { bg: GCV.blue, color: "#fff" };
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, { backgroundColor: palette.bg, opacity: disabled ? 0.5 : pressed ? 0.84 : 1 }]}><View style={styles.buttonContent}>{icon ? <Ionicons name={icon} size={18} color={palette.color} /> : null}<Text style={[styles.buttonText, { color: palette.color }]}>{label}</Text></View></Pressable>;
}

export function SectionCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field({ label, value, onChangeText, placeholder, multiline = false, keyboardType, autoCapitalize = "sentences", secureTextEntry = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: TextInputProps["keyboardType"]; autoCapitalize?: TextInputProps["autoCapitalize"]; secureTextEntry?: boolean }) {
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#91A1AF" multiline={multiline} keyboardType={keyboardType} autoCapitalize={autoCapitalize} secureTextEntry={secureTextEntry} style={[styles.input, multiline && styles.multiline]} /></View>;
}

export function StatusPill({ status }: { status: SlotStatus }) {
  const meta = STATUS_META[status];
  return <View accessibilityLabel={`Statut : ${meta.label}`} style={[styles.status, { backgroundColor: meta.background }]}><Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text></View>;
}

export function LoadingBlock({ label = "Chargement…" }: { label?: string }) {
  return <View style={styles.loading}><ActivityIndicator color={GCV.blue} /><Text style={styles.muted}>{label}</Text></View>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <View style={styles.empty}><Ionicons name="calendar-clear-outline" size={30} color="#7B97AB" /><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyDetail}>{detail}</Text></View>;
}

const styles = StyleSheet.create({
  brandMark: { width: 110, height: 40 },
  brandMarkCompact: { width: 120, height: 44 },
  button: { minHeight: 48, paddingHorizontal: 16, justifyContent: "center", borderRadius: 10 },
  buttonContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  buttonText: { fontSize: 14, fontWeight: "800", letterSpacing: 0.2, textAlign: "center" },
  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: GCV.border, borderRadius: 16, padding: 16, gap: 10, shadowColor: "#17324B", shadowOpacity: 0.045, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  fieldWrap: { gap: 6 },
  fieldLabel: { color: GCV.text, fontSize: 13, fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#C8D6E0", color: GCV.text, backgroundColor: "#FFFFFF", borderRadius: 10, minHeight: 48, paddingHorizontal: 13, fontSize: 15 },
  multiline: { minHeight: 105, paddingTop: 12, textAlignVertical: "top" },
  status: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5, alignSelf: "flex-start" },
  statusText: { fontSize: 12, fontWeight: "800" },
  loading: { minHeight: 160, alignItems: "center", justifyContent: "center", gap: 12 },
  muted: { color: GCV.muted, fontSize: 14 },
  empty: { borderWidth: 1, borderColor: GCV.border, borderStyle: "dashed", borderRadius: 14, padding: 26, alignItems: "center", gap: 7, backgroundColor: "#FBFDFE" },
  emptyTitle: { color: GCV.text, fontWeight: "800", fontSize: 15 },
  emptyDetail: { color: GCV.muted, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
