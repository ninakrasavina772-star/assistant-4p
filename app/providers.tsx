"use client";

import { AssistantUpdateNotifier } from "@/components/AssistantUpdateNotifier";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      refetchOnWindowFocus={false}
      refetchWhenOffline={false}
    >
      {children}
      <AssistantUpdateNotifier />
    </SessionProvider>
  );
}
