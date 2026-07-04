import { Suspense } from "react";
import { OrcamentosManager } from "@/components/dashboard/orcamentos-manager";

export default function NovoOrcamentoPage() {
  return (
    <Suspense fallback={null}>
      <OrcamentosManager />
    </Suspense>
  );
}
