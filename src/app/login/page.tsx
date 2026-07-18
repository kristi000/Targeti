"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const configurationError = searchParams.get("error") === "database"
    ? "Sign-in succeeded, but the database connection is not configured on this server. Configure Firestore credentials, then try again."
    : "";

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Sign-in failed.");
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
      <CardHeader className="text-center"><div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><TrendingUp className="h-7 w-7" /></div><CardTitle className="text-2xl">Sign in to Target Master</CardTitle><CardDescription>Enter the credentials provided by your administrator.</CardDescription></CardHeader>
      <CardContent><form className="space-y-4" onSubmit={signIn}><div className="space-y-2"><Label htmlFor="username">Username</Label><Input id="username" name="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required autoFocus /></div><div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></div><Button className="w-full" size="lg" type="submit" disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}Sign in</Button>{(error || configurationError) && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error || configurationError}</p>}<p className="text-center text-xs text-muted-foreground">Contact your administrator if you need an account.</p></form></CardContent>
    </Card>
  </main>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="flex min-h-svh items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></main>}><LoginForm /></Suspense>;
}
