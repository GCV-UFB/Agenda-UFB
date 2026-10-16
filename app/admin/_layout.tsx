import { Redirect, Slot, usePathname } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { LoadingBlock } from "@/components/gcv-ui";
import { ScreenContainer } from "@/components/screen-container";

export default function AdminLayout() {
  const { loading, isAuthenticated } = useAuth();
  const pathname = usePathname();
  if (loading) return <ScreenContainer><LoadingBlock label="Vérification de l’accès…" /></ScreenContainer>;
  if (!isAuthenticated && pathname !== "/admin") return <Redirect href="/admin" />;
  return <Slot />;
}
