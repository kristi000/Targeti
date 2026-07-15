"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GoogleAuthProvider, inMemoryPersistence, setPersistence, signInWithPopup, signOut } from "firebase/auth";
import { Loader2, LogIn, TrendingUp } from "lucide-react";
import { clientAuth } from "@/lib/firebase-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const signIn = async () => {
    setLoading(true);
    setError("");
    try {
      await setPersistence(clientAuth, inMemoryPersistence);
      const credential = await signInWithPopup(clientAuth, new GoogleAuthProvider());
      let idToken = await credential.user.getIdToken();
      let response = await fetch("/api/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
      if (response.status === 409) {
        idToken = await credential.user.getIdToken(true);
        response = await fetch("/api/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
      }
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Sign-in failed.");
      await signOut(clientAuth);
      const requested = searchParams.get("next");
      const destination = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/en";
      router.replace(destination);
      router.refresh();
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  };

  return <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="text-center"><div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><TrendingUp className="h-7 w-7" /></div><CardTitle className="text-2xl">Sign in to Target Master</CardTitle><CardDescription>Use your authorized Google account to continue.</CardDescription></CardHeader>
      <CardContent className="space-y-4"><Button className="w-full" size="lg" disabled={loading} onClick={() => void signIn()}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}Continue with Google</Button>{error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}<p className="text-center text-xs text-muted-foreground">Access and permissions are managed by your administrator.</p></CardContent>
    </Card>
  </main>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="flex min-h-svh items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></main>}><LoginForm /></Suspense>;
}
