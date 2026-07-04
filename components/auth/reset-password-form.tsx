"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Status = "verificando" | "pronto" | "invalido" | "concluido";

export function ResetPasswordForm() {
  const [status, setStatus] = useState<Status>("verificando");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ao abrir o link do e-mail, a URL traz um `code` (fluxo PKCE) que precisa
  // ser trocado por uma sessão de recuperação antes de permitir a nova senha.
  useEffect(() => {
    const supabase = createClient();

    async function estabelecerSessao() {
      const code = new URLSearchParams(window.location.search).get("code");

      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setStatus("invalido");
          return;
        }
        setStatus("pronto");
        return;
      }

      // Sem code na URL: pode já existir sessão de recuperação (fluxo por hash).
      const { data } = await supabase.auth.getSession();
      setStatus(data.session ? "pronto" : "invalido");
    }

    estabelecerSessao();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }

      // Encerra a sessão de recuperação e envia para o login com a nova senha.
      await supabase.auth.signOut();
      setStatus("concluido");
      setTimeout(() => {
        window.location.href = "/login";
      }, 2000);
    } catch (err) {
      setError(
        `Erro de conexão: ${err instanceof Error ? err.message : "Tente novamente."}`
      );
      setLoading(false);
    }
  }

  if (status === "verificando") {
    return (
      <p className="text-sm text-muted-foreground">Validando o link...</p>
    );
  }

  if (status === "invalido") {
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Link inválido ou expirado. Solicite um novo link de recuperação.
        </p>
        <Link
          href="/auth/forgot-password"
          className="block text-center text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          Pedir novo link
        </Link>
      </div>
    );
  }

  if (status === "concluido") {
    return (
      <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
        Senha alterada com sucesso! Redirecionando para o login...
      </p>
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
        <Label htmlFor="password">Nova senha</Label>
        <Input
          id="password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirmar nova senha</Label>
        <Input
          id="confirm"
          type="password"
          placeholder="••••••••"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Salvando..." : "Redefinir senha"}
      </Button>
    </form>
  );
}
