"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, LockKeyhole } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { restrictedAccessQueryKey } from "@/hooks/use-restricted-access";

type AccessCodeFormProps = { onGranted: () => void };

function AccessCodeForm({ onGranted }: AccessCodeFormProps) {
  const queryClient = useQueryClient();
  const t = useTranslations("RestrictedAccess");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submittedCodeRef = useRef("");

  useEffect(() => {
    if (code.length !== 5 || code === submittedCodeRef.current) return;
    submittedCodeRef.current = code;
    setLoading(true);
    setError("");
    void fetch("/api/auth/restricted-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).then(async response => {
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || t("verificationFailed"));
      await queryClient.cancelQueries({ queryKey: restrictedAccessQueryKey });
      queryClient.setQueryData(restrictedAccessQueryKey, true);
      onGranted();
    }).catch(error => {
      setError(error instanceof Error ? error.message : t("verificationFailed"));
      setCode("");
      submittedCodeRef.current = "";
    }).finally(() => setLoading(false));
  }, [code, onGranted, queryClient, t]);

  return <div className="space-y-3">
    <div className="space-y-2">
      <Label htmlFor="restricted-access-code">{t("codeLabel")}</Label>
      <div className="relative">
        <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="restricted-access-code"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          autoFocus
          maxLength={5}
          className="pl-9 pr-9 text-center text-lg tracking-[0.4em]"
          value={code}
          disabled={loading}
          onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 5))}
          aria-describedby={error ? "restricted-access-error" : undefined}
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
    </div>
    <p className="text-xs text-muted-foreground">{t("automaticHint")}</p>
    {error && <p id="restricted-access-error" role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

export function RestrictedAccessPage({ onGranted }: AccessCodeFormProps) {
  const t = useTranslations("RestrictedAccess");
  return <div className="flex min-h-[60vh] items-center justify-center p-4">
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><LockKeyhole className="h-5 w-5" /></div>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent><AccessCodeForm onGranted={onGranted} /></CardContent>
    </Card>
  </div>;
}

export function RestrictedAccessDialog({ open, onOpenChange, onGranted }: AccessCodeFormProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("RestrictedAccess");
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><LockKeyhole className="h-5 w-5 text-primary" />{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <AccessCodeForm onGranted={onGranted} />
    </DialogContent>
  </Dialog>;
}
