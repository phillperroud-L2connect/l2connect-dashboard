"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        { redirectTo: `${window.location.origin}/auth/reset-password` }
      );

      if (resetError) {
        setError(resetError.message);
        setLoading(false);
        return;
      }

      // Sucesso: não revelamos se o e-mail existe (evita enumeração de contas).
      setSent(true);
    } catch (err) {
      setError(
        `Erro de conexão: ${err instanceof Error ? err.message : "Tente novamente."}`
      );
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          Se existir uma conta com esse e-mail, enviamos um link para redefinir a
          senha. Verifique sua caixa de entrada (e o spam).
        </p>
        <Link
          href="/login"
          className="block text-center text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          placeholder="seu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Enviando..." : "Enviar link de recuperação"}
      </Button>
      <Link
        href="/login"
        className="block text-center text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        Voltar para o login
      </Link>
    </form>
  );
}
