import Image from "next/image";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4" style={{ background: "#0a0a0f" }}>
      {/* Radial glow background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 70% at 50% 35%, rgba(0,180,255,0.09) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <Image
            src="/l2connect-logo.png"
            alt="L2Connect"
            width={200}
            height={56}
            className="h-auto w-[170px]"
            priority
            unoptimized
          />
          <p className="text-sm text-muted-foreground">Dashboard financeiro</p>
        </div>

        {/* Glassmorphism card */}
        <div
          className="rounded-2xl border border-white/8 p-6 sm:p-8"
          style={{
            background: "rgba(255,255,255,0.03)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: "0 0 40px rgba(0,180,255,0.05), 0 8px 32px rgba(0,0,0,0.4)",
          }}
        >
          <h1 className="mb-1 text-xl font-bold tracking-tight text-foreground">
            Nova senha
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Defina uma nova senha para sua conta.
          </p>
          <ResetPasswordForm />
        </div>
      </div>
    </div>
  );
}
