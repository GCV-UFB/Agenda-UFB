import * as Api from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

const AUTH_QUERY_KEY = ["ufb-auth"] as const;

/** Share the verified server identity across every administration screen. */
export function useAuth(options?: { autoFetch?: boolean }) {
  const autoFetch = options?.autoFetch ?? true;
  const client = useQueryClient();
  const session = useQuery({
    queryKey: AUTH_QUERY_KEY,
    enabled: autoFetch,
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Auth.User | null> => {
      const user = await Api.getMe();
      if (!user) {
        await Auth.clearUserInfo();
        return null;
      }
      const verified = { ...user, lastSignedIn: new Date(user.lastSignedIn) };
      await Auth.setUserInfo(verified);
      return verified;
    },
  });
  const logout = useCallback(async () => {
    await Api.logout();
    await Auth.removeSessionToken();
    await Auth.clearUserInfo();
    await client.cancelQueries();
    // A later account must never see the preceding administrator's cached requests.
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== AUTH_QUERY_KEY[0] });
    client.setQueryData(AUTH_QUERY_KEY, null);
  }, [client]);

  return {
    user: session.data ?? null,
    loading: autoFetch && session.isPending,
    error: session.error,
    isAuthenticated: Boolean(session.data),
    refresh: session.refetch,
    logout,
  };
}
