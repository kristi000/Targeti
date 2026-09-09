"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { AlertCircle, Loader2 } from "lucide-react";
import { z } from "zod";
import { AppLayout } from "@/components/app-layout";
import { QueryProvider } from "@/components/query-provider";
import { ShopProvider } from "@/components/shop-provider";
import { fetchShopData, type ShopData } from "@/app/actions";
import { db, firebaseAuth } from "@/lib/firebase-client";
import { setCurrentClientActor } from "@/lib/client-access";
import type { AppActor } from "@/lib/auth-types";

const sessionResponseSchema = z.object({
  firebaseToken: z.string().min(1),
  actor: z.object({
    id: z.string().min(1),
    username: z.string().min(1),
    name: z.string().min(1),
    role: z.enum(["admin", "editor", "viewer"]),
  }),
});

const accessProfileSchema = z.object({
  username: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(["admin", "editor", "viewer"]),
});

type BootstrapState = { actor: AppActor; data: ShopData } | null;

export function ClientApplication({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<BootstrapState>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribeProfile: (() => void) | undefined;
    const initialize = async () => {
      try {
        const response = await fetch("/api/auth/session", { method: "GET", cache: "no-store" });
        if (response.status === 401) {
          await signOut(firebaseAuth);
          setCurrentClientActor(null);
          router.replace("/login");
          return;
        }
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Could not initialize your session.");
        const session = sessionResponseSchema.parse(body);
        await signInWithCustomToken(firebaseAuth, session.firebaseToken);
        setCurrentClientActor(session.actor);
        const data = await fetchShopData();
        if (!active) return;
        setState({ actor: session.actor, data });
        unsubscribeProfile = onSnapshot(doc(db, "accessProfiles", session.actor.id), snapshot => {
          const profile = accessProfileSchema.safeParse(snapshot.data());
          if (!profile.success) return;
          const actor = { id: session.actor.id, ...profile.data } satisfies AppActor;
          setCurrentClientActor(actor);
          setState(current => current ? { ...current, actor } : current);
        });
      } catch (initializationError) {
        console.error("Client application initialization failed:", initializationError);
        if (active) setError(initializationError instanceof Error ? initializationError.message : "Could not load the application.");
      }
    };
    void initialize();
    return () => {
      active = false;
      unsubscribeProfile?.();
    };
  }, [router]);

  if (error) {
    return <main className="flex min-h-svh items-center justify-center p-6"><div className="max-w-lg rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-center"><AlertCircle className="mx-auto mb-3 h-6 w-6 text-destructive" /><p className="font-medium">The client application could not start.</p><p className="mt-1 text-sm text-muted-foreground">{error}</p></div></main>;
  }
  if (!state) {
    return <main className="flex min-h-svh items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" aria-label="Loading application" /></main>;
  }

  return <QueryProvider><ShopProvider initialData={state.data} actor={state.actor}><AppLayout>{children}</AppLayout></ShopProvider></QueryProvider>;
}
