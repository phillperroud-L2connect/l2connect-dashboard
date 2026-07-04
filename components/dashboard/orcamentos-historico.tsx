"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, FileDown, Trash2, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Orcamento, OrcamentoStatus } from "@/lib/types";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import {
  formatCurrency,
  formatCurrencyARS,
  formatCurrencyUSD,
  formatDate,
} from "@/lib/format";
import {
  OrcamentoPreview,
  gerarPdfDoElemento,
  type OrcamentoData,
  type PlanoPagamento,
} from "@/components/dashboard/orcamento-preview";

const STATUS: { v: OrcamentoStatus; label: string }[] = [
  { v: "rascunho", label: "Rascunho" },
  { v: "enviado", label: "Enviado" },
  { v: "aprovado", label: "Pago" },
  { v: "recusado", label: "Recusado" },
];

function statusStyle(status: OrcamentoStatus): { color: string; bg: string; border: string } {
  switch (status) {
    case "aprovado":
      return { color: "#34d399", bg: "rgba(52,211,153,0.12)", border: "rgba(52,211,153,0.3)" };
    case "enviado":
      return { color: "#00b4ff", bg: "rgba(0,180,255,0.12)", border: "rgba(0,180,255,0.3)" };
    case "recusado":
      return { color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)" };
    default: // rascunho
      return { color: "#94a3b8", bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.3)" };
  }
}

function fmtTotal(o: Orcamento): string {
  if (o.moeda === "BRL") return formatCurrency(o.total);
  if (o.moeda === "ARS") return formatCurrencyARS(o.total);
  return formatCurrencyUSD(o.total);
}

/** Converte uma linha salva do banco para os dados que a prévia/PDF consomem. */
function toOrcamentoData(o: Orcamento): OrcamentoData {
  const plano =
    (o.plano_pagamento as PlanoPagamento | null) ?? ({ tipo: "avista" } as PlanoPagamento);
  return {
    numero: o.numero,
    data: formatDate(o.created_at),
    template: o.template,
    idioma: o.idioma,
    moeda: o.moeda,
    cliente_nome: o.cliente_nome,
    cliente_email: o.cliente_email ?? "",
    cliente_telefone: o.cliente_telefone ?? "",
    servicos: Array.isArray(o.servicos) ? o.servicos : [],
    plano,
    total: Number(o.total) || 0,
    nota: o.nota ?? "",
    cotacaoDolar: o.cotacao_dolar,
  };
}

const statusSelectCls =
  "h-8 rounded-lg border px-2 text-xs font-semibold outline-none transition-all focus:ring-2 focus:ring-primary/20";

export function OrcamentosHistorico() {
  const supabase = createClient();
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Regeneração de PDF: renderiza uma prévia oculta e captura.
  const pdfRef = useRef<HTMLDivElement>(null);
  const [pdfData, setPdfData] = useState<OrcamentoData | null>(null);
  const [regenId, setRegenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase
      .from("orcamentos")
      .select("*")
      .order("created_at", { ascending: false });
    if (e) setError(e.message);
    else {
      setOrcamentos((data as Orcamento[]) ?? []);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Dispara a captura assim que a prévia oculta é montada com os dados.
  useEffect(() => {
    if (!pdfData || !pdfRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const prefix = pdfData.template === "l2connect" ? "orcamento" : "presupuesto";
        await gerarPdfDoElemento(
          pdfRef.current!,
          `${prefix}-${pdfData.cliente_nome || "cliente"}-${pdfData.numero}.pdf`
        );
      } catch (err) {
        console.error(err);
      }
      if (!cancelled) {
        setPdfData(null);
        setRegenId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfData]);

  function regenerarPDF(o: Orcamento) {
    setRegenId(o.id);
    setPdfData(toOrcamentoData(o));
  }

  async function mudarStatus(o: Orcamento, status: OrcamentoStatus) {
    // Otimista: atualiza local antes da resposta.
    setOrcamentos((list) =>
      list.map((x) => (x.id === o.id ? { ...x, status } : x))
    );
    const { error: e } = await supabase
      .from("orcamentos")
      .update({ status })
      .eq("id", o.id);
    if (e) {
      setError(e.message);
      await load(); // reverte para o estado real
    }
  }

  async function excluirOrcamento(o: Orcamento) {
    if (
      !confirm(
        `Excluir o orçamento ${o.numero} (${o.cliente_nome})? Esta ação não pode ser desfeita.`
      )
    )
      return;
    const anterior = orcamentos;
    setOrcamentos((list) => list.filter((x) => x.id !== o.id)); // otimista
    const { error: e } = await supabase.from("orcamentos").delete().eq("id", o.id);
    if (e) {
      setError(e.message);
      setOrcamentos(anterior); // reverte
    }
  }

  return (
    <div className="overflow-x-hidden">
      <PageHeader
        title="Orçamentos"
        description="Histórico de todos os orçamentos salvos."
        action={
          <Button asChild>
            <Link href="/dashboard/orcamentos/novo">
              <Plus className="size-4" />
              Novo orçamento
            </Link>
          </Button>
        }
      />

      {error && (
        <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : orcamentos.length === 0 ? (
        <EmptyState message="Nenhum orçamento salvo ainda. Crie um em “Novo orçamento”." />
      ) : (
        <>
          {/* ── Mobile: card por orçamento ── */}
          <div className="space-y-3 lg:hidden">
            {orcamentos.map((o) => {
              const st = statusStyle(o.status);
              return (
                <div
                  key={o.id}
                  className="rounded-xl border p-4"
                  style={{ borderColor: "rgba(255,255,255,0.08)", background: "#0f0f1c" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-sm font-semibold text-primary">
                        {o.numero}
                      </div>
                      <div className="mt-0.5 font-medium text-foreground">
                        {o.cliente_nome}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(o.created_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-foreground">{fmtTotal(o)}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {o.template}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <select
                      className={statusSelectCls}
                      style={{ color: "#fff", background: st.bg, borderColor: st.border }}
                      value={o.status}
                      onChange={(e) =>
                        mudarStatus(o, e.target.value as OrcamentoStatus)
                      }
                    >
                      {STATUS.map((s) => (
                        <option
                          key={s.v}
                          value={s.v}
                          style={{ color: "#fff", background: "#0f0f1c" }}
                        >
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/dashboard/orcamentos/novo?id=${o.id}`}>
                          <Pencil className="size-4" />
                          Editar
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => regenerarPDF(o)}
                        disabled={regenId === o.id}
                      >
                        <FileDown className="size-4" />
                        {regenId === o.id ? "Gerando..." : "PDF"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => excluirOrcamento(o)}
                        aria-label="Excluir orçamento"
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop: tabela ── */}
          <div
            className="hidden overflow-hidden rounded-xl border lg:block"
            style={{ borderColor: "rgba(255,255,255,0.08)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-xs uppercase tracking-wide text-muted-foreground"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <th className="px-4 py-3 font-medium">Número</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {orcamentos.map((o) => {
                  const st = statusStyle(o.status);
                  return (
                    <tr
                      key={o.id}
                      className="border-t"
                      style={{ borderColor: "rgba(255,255,255,0.06)" }}
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-primary">
                        {o.numero}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{o.cliente_nome}</div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {o.template}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">
                        {fmtTotal(o)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(o.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className={statusSelectCls}
                          style={{
                            color: "#fff",
                            background: st.bg,
                            borderColor: st.border,
                          }}
                          value={o.status}
                          onChange={(e) =>
                            mudarStatus(o, e.target.value as OrcamentoStatus)
                          }
                        >
                          {STATUS.map((s) => (
                            <option
                              key={s.v}
                              value={s.v}
                              style={{ color: "#fff", background: "#0f0f1c" }}
                            >
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/dashboard/orcamentos/novo?id=${o.id}`}>
                              <Pencil className="size-4" />
                              Editar
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => regenerarPDF(o)}
                            disabled={regenId === o.id}
                          >
                            <FileDown className="size-4" />
                            {regenId === o.id ? "Gerando..." : "Regerar PDF"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => excluirOrcamento(o)}
                            aria-label="Excluir orçamento"
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Prévia oculta usada apenas para regenerar o PDF */}
      {pdfData && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: "-10000px",
            top: 0,
            width: "800px",
            pointerEvents: "none",
          }}
        >
          <OrcamentoPreview data={pdfData} previewRef={pdfRef} />
        </div>
      )}
    </div>
  );
}
