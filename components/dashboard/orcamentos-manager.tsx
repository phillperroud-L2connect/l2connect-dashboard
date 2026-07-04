"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, Trash2, FileDown, Eye, Save, History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Cliente, Orcamento } from "@/lib/types";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  OrcamentoPreview,
  gerarPdfDoElemento,
  type Template,
  type Idioma,
  type MoedaOrc,
  type PlanoPagamento,
  type TipoParcelamento,
  type OpcaoPagamento,
  type OrcamentoData,
} from "@/components/dashboard/orcamento-preview";

type TipoEntrada = "percentual" | "valor";

type ServicoItem = {
  id: string;
  descricao: string;
  valor: string;
};

type FormState = {
  cliente_id: string;
  cliente_nome: string;
  cliente_email: string;
  cliente_telefone: string;
  idioma: Idioma;
  moeda: MoedaOrc;
  servicos: ServicoItem[];
  nota: string;
  // ── Pagamento ──
  opcao_pagamento: OpcaoPagamento;
  percentual_entrada: string;
  parcelas: string;
  tipo_parcelamento: TipoParcelamento;
  entrada_tipo: TipoEntrada;
  entrada_valor: string;
};

const emptyForm: FormState = {
  cliente_id: "",
  cliente_nome: "",
  cliente_email: "",
  cliente_telefone: "",
  idioma: "pt",
  moeda: "BRL",
  servicos: [{ id: "1", descricao: "", valor: "" }],
  nota: "",
  opcao_pagamento: "entrada",
  percentual_entrada: "50",
  parcelas: "2",
  tipo_parcelamento: "iguais",
  entrada_tipo: "percentual",
  entrada_valor: "30",
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** Converte total + escolhas do formulário num plano estruturado. */
function calcularPlano(total: number, form: FormState): PlanoPagamento {
  if (form.opcao_pagamento === "entrada") {
    const pct = clamp(parseFloat(form.percentual_entrada) || 0, 0, 100);
    const entrada = (total * pct) / 100;
    return { tipo: "entrada", pct, entrada, restante: total - entrada };
  }

  if (form.opcao_pagamento === "parcelado") {
    const n = clamp(parseInt(form.parcelas, 10) || 2, 2, 12);

    if (form.tipo_parcelamento === "entrada_diferenciada") {
      const bruto =
        form.entrada_tipo === "percentual"
          ? (total * (parseFloat(form.entrada_valor) || 0)) / 100
          : parseFloat(form.entrada_valor) || 0;
      const entrada = clamp(bruto, 0, total);
      const nRest = n - 1;
      const valorRest = nRest > 0 ? (total - entrada) / nRest : 0;
      return {
        tipo: "parcelado",
        n,
        subtipo: "entrada_diferenciada",
        parcelas: [
          { numero: 1, valor: entrada, entrada: true },
          ...Array.from({ length: nRest }, (_, i) => ({
            numero: i + 2,
            valor: valorRest,
            entrada: false,
          })),
        ],
      };
    }

    const valor = total / n;
    return {
      tipo: "parcelado",
      n,
      subtipo: "iguais",
      parcelas: Array.from({ length: n }, (_, i) => ({
        numero: i + 1,
        valor,
        entrada: false,
      })),
    };
  }

  return { tipo: "avista" };
}

/** Reconstrói o estado do formulário a partir de um orçamento salvo (edição). */
function formFromOrcamento(o: Orcamento): FormState {
  const servicos: ServicoItem[] = (Array.isArray(o.servicos) ? o.servicos : []).map(
    (s) => ({
      id: crypto.randomUUID(),
      descricao: s.descricao ?? "",
      valor: s.valor != null ? String(s.valor) : "",
    })
  );

  const base: FormState = {
    ...emptyForm,
    cliente_id: "",
    cliente_nome: o.cliente_nome ?? "",
    cliente_email: o.cliente_email ?? "",
    cliente_telefone: o.cliente_telefone ?? "",
    idioma: o.idioma,
    moeda: o.moeda,
    servicos: servicos.length ? servicos : emptyForm.servicos,
    nota: o.nota ?? "",
  };

  const plano = o.plano_pagamento as PlanoPagamento | null;
  if (!plano) return base;

  if (plano.tipo === "avista") return { ...base, opcao_pagamento: "avista" };

  if (plano.tipo === "entrada")
    return {
      ...base,
      opcao_pagamento: "entrada",
      percentual_entrada: String(Math.round(plano.pct)),
    };

  // parcelado
  if (plano.subtipo === "entrada_diferenciada") {
    const entrada = plano.parcelas[0]?.valor ?? 0;
    return {
      ...base,
      opcao_pagamento: "parcelado",
      parcelas: String(plano.n),
      tipo_parcelamento: "entrada_diferenciada",
      entrada_tipo: "valor",
      entrada_valor: String(entrada),
    };
  }
  return {
    ...base,
    opcao_pagamento: "parcelado",
    parcelas: String(plano.n),
    tipo_parcelamento: "iguais",
  };
}

function formatDataBR(d: Date) {
  return d.toLocaleDateString("pt-BR");
}

function fmtARS(v: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

function fmtUSD(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

function fmtBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

const selectCls =
  "flex h-9 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all";

export function OrcamentosManager() {
  const supabase = createClient();
  const previewRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");

  const [template, setTemplate] = useState<Template>("l2connect");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cotacaoDolar, setCotacaoDolar] = useState<number | null>(null);
  const [loadingDolar, setLoadingDolar] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [numero, setNumero] = useState(""); // preenchido pelo banco ao salvar
  const [dataHoje, setDataHoje] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadClientes = useCallback(async () => {
    const { data } = await supabase.from("clientes").select("*").order("nome");
    if (data) setClientes(data as Cliente[]);
  }, [supabase]);

  async function fetchDolar() {
    setLoadingDolar(true);
    try {
      const res = await fetch("https://dolarapi.com/v1/dolares/blue");
      const data = await res.json();
      setCotacaoDolar(Number(data?.venta) || null);
    } catch {
      setCotacaoDolar(null);
    }
    setLoadingDolar(false);
  }

  useEffect(() => {
    loadClientes();
    fetchDolar();
    setDataHoje(formatDataBR(new Date()));
  }, [loadClientes]);

  // Edição: carrega o orçamento salvo quando há ?id= na URL.
  useEffect(() => {
    if (!editId) return;
    let active = true;
    (async () => {
      const { data, error: e } = await supabase
        .from("orcamentos")
        .select("*")
        .eq("id", editId)
        .single();
      if (!active) return;
      if (e || !data) {
        setError("Não foi possível carregar o orçamento para edição.");
        return;
      }
      const o = data as Orcamento;
      setEditingId(o.id);
      setTemplate(o.template);
      setNumero(o.numero);
      setDataHoje(formatDataBR(new Date(o.created_at)));
      if (o.moeda === "ARS" && o.cotacao_dolar) setCotacaoDolar(o.cotacao_dolar);
      setForm(formFromOrcamento(o));
    })();
    return () => {
      active = false;
    };
  }, [editId, supabase]);

  function switchTemplate(t: Template) {
    setTemplate(t);
    if (t === "l2connect") {
      setForm((f) => ({
        ...f,
        idioma: "pt",
        moeda: f.moeda === "USD" ? "ARS" : f.moeda,
      }));
    } else {
      setForm((f) => ({
        ...f,
        idioma: "es",
        moeda: f.moeda === "BRL" ? "ARS" : f.moeda,
      }));
    }
  }

  function selecionarCliente(id: string) {
    const c = clientes.find((c) => c.id === id);
    setForm((f) => ({
      ...f,
      cliente_id: id,
      cliente_nome: c?.nome ?? "",
      cliente_email: c?.email ?? "",
      cliente_telefone: c?.telefone ?? "",
    }));
  }

  function addServico() {
    setForm((f) => ({
      ...f,
      servicos: [...f.servicos, { id: crypto.randomUUID(), descricao: "", valor: "" }],
    }));
  }

  function removeServico(id: string) {
    setForm((f) => ({ ...f, servicos: f.servicos.filter((s) => s.id !== id) }));
  }

  function updateServico(id: string, field: "descricao" | "valor", value: string) {
    setForm((f) => ({
      ...f,
      servicos: f.servicos.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
    }));
  }

  const total = form.servicos.reduce((sum, s) => sum + (parseFloat(s.valor) || 0), 0);
  const totalUSD =
    cotacaoDolar && total > 0 && form.moeda === "ARS" ? total / cotacaoDolar : null;

  const plano = calcularPlano(total, form);
  const simbolo = form.moeda === "BRL" ? "R$" : form.moeda === "USD" ? "US$" : "$";

  const fmtValor = (v: number): string => {
    if (form.moeda === "BRL") return fmtBRL(v);
    if (template !== "l2connect") {
      const n = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);
      return form.moeda === "USD" ? `US$ ${n}` : `$ ${n}`;
    }
    return form.moeda === "ARS" ? fmtARS(v) : fmtUSD(v);
  };

  // Dados usados pela prévia compartilhada (e pelo PDF).
  const previewData: OrcamentoData = {
    numero: numero || "—",
    data: dataHoje,
    template,
    idioma: form.idioma,
    moeda: form.moeda,
    cliente_nome: form.cliente_nome,
    cliente_email: form.cliente_email,
    cliente_telefone: form.cliente_telefone,
    servicos: form.servicos.map((s) => ({
      descricao: s.descricao,
      valor: parseFloat(s.valor) || 0,
    })),
    plano,
    total,
    nota: form.nota,
    cotacaoDolar,
  };

  async function salvarOrcamento() {
    setSalvando(true);
    setSaveMsg(null);
    setError(null);

    // Campos comuns a criação e edição (status e numero não são alterados na edição).
    const dados = {
      cliente_nome: form.cliente_nome.trim(),
      cliente_email: form.cliente_email.trim() || null,
      cliente_telefone: form.cliente_telefone.trim() || null,
      template,
      idioma: form.idioma,
      moeda: form.moeda,
      cotacao_dolar: form.moeda === "ARS" ? cotacaoDolar : null,
      total,
      plano_pagamento: plano,
      servicos: form.servicos
        .filter((s) => s.descricao || s.valor)
        .map((s) => ({ descricao: s.descricao, valor: parseFloat(s.valor) || 0 })),
      nota: form.nota.trim() || null,
    };

    if (editingId) {
      const { error: e } = await supabase
        .from("orcamentos")
        .update(dados)
        .eq("id", editingId);
      setSalvando(false);
      if (e) {
        setError(e.message);
        return;
      }
      setSaveMsg(`Orçamento ${numero} atualizado com sucesso!`);
      return;
    }

    const { data: row, error: e } = await supabase
      .from("orcamentos")
      .insert({ ...dados, status: "rascunho" })
      .select("id, numero")
      .single();

    setSalvando(false);
    if (e) {
      setError(e.message);
      return;
    }
    if (row?.numero) setNumero(row.numero);
    if (row?.id) setEditingId(String(row.id)); // salvar de novo vira atualização
    setSaveMsg(
      `Orçamento ${row?.numero ?? ""} salvo com sucesso! Já aparece no histórico.`
    );
  }

  async function gerarPDF() {
    if (!previewRef.current) return;
    setGerando(true);
    try {
      const prefix = template === "l2connect" ? "orcamento" : "presupuesto";
      await gerarPdfDoElemento(
        previewRef.current,
        `${prefix}-${form.cliente_nome || "cliente"}-${numero || "orcamento"}.pdf`
      );
    } catch (e) {
      console.error(e);
    }
    setGerando(false);
  }

  return (
    <div>
      <PageHeader
        title={editingId ? `Editar orçamento ${numero}` : "Novo orçamento"}
        description="Gere orçamentos profissionais em PDF em português ou espanhol."
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard/orcamentos">
              <History className="size-4" />
              Ver histórico
            </Link>
          </Button>
        }
      />

      {/* ── Seletor de template ── */}
      <div className="mb-6 flex gap-2">
        <button
          type="button"
          onClick={() => switchTemplate("l2connect")}
          className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all ${
            template === "l2connect"
              ? "border-primary bg-primary text-white"
              : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
          }`}
        >
          L2Connect
        </button>
        <button
          type="button"
          onClick={() => switchTemplate("l2connect-ar")}
          className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all ${
            template === "l2connect-ar"
              ? "border-primary bg-primary text-white"
              : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
          }`}
        >
          L2Connect AR
        </button>
        <button
          type="button"
          onClick={() => switchTemplate("zamy")}
          className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all ${
            template === "zamy"
              ? "border-[#C2185B] bg-[#C2185B] text-white"
              : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
          }`}
        >
          Zamy Design
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Formulário ── */}
        <div className="space-y-5">
          {/* Cliente */}
          <section
            className="space-y-3 rounded-xl border p-4"
            style={{ borderColor: "rgba(255,255,255,0.08)", background: "#0f0f1c" }}
          >
            <h3 className="text-sm font-semibold text-foreground">Dados do Cliente</h3>

            <div className="space-y-2">
              <Label>Selecionar cliente cadastrado</Label>
              <select
                className={selectCls}
                value={form.cliente_id}
                onChange={(e) => selecionarCliente(e.target.value)}
              >
                <option value="">— ou preencha manualmente —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cli_nome">Nome *</Label>
                <Input
                  id="cli_nome"
                  value={form.cliente_nome}
                  onChange={(e) => setForm((f) => ({ ...f, cliente_nome: e.target.value }))}
                  placeholder="Nome do cliente"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cli_email">E-mail</Label>
                <Input
                  id="cli_email"
                  type="email"
                  value={form.cliente_email}
                  onChange={(e) => setForm((f) => ({ ...f, cliente_email: e.target.value }))}
                  placeholder="email@exemplo.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cli_tel">Telefone</Label>
                <Input
                  id="cli_tel"
                  value={form.cliente_telefone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cliente_telefone: e.target.value }))
                  }
                  placeholder="+55 11 99999-9999"
                />
              </div>
            </div>
          </section>

          {/* Serviços */}
          <section
            className="space-y-3 rounded-xl border p-4"
            style={{ borderColor: "rgba(255,255,255,0.08)", background: "#0f0f1c" }}
          >
            <h3 className="text-sm font-semibold text-foreground">Serviços</h3>

            {form.servicos.map((s, i) => (
              <div key={s.id} className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <Input
                    placeholder={`Serviço ${i + 1}`}
                    value={s.descricao}
                    onChange={(e) => updateServico(s.id, "descricao", e.target.value)}
                  />
                </div>
                <div className="w-32 space-y-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Valor"
                    value={s.valor}
                    onChange={(e) => updateServico(s.id, "valor", e.target.value)}
                  />
                </div>
                {form.servicos.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="mt-0.5"
                    onClick={() => removeServico(s.id)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={addServico}>
              <Plus className="size-4" />
              Adicionar serviço
            </Button>

            <div className="flex items-center justify-between border-t border-border/60 pt-3">
              <span className="text-sm font-semibold">Total</span>
              <span className="text-base font-bold text-primary">{fmtValor(total)}</span>
            </div>
          </section>

          {/* Condições de Pagamento */}
          <section
            className="space-y-3 rounded-xl border p-4"
            style={{ borderColor: "rgba(255,255,255,0.08)", background: "#0f0f1c" }}
          >
            <h3 className="text-sm font-semibold text-foreground">
              Condições de Pagamento
            </h3>

            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { v: "avista", label: "À vista" },
                  { v: "entrada", label: "Com entrada" },
                  { v: "parcelado", label: "Parcelado" },
                ] as { v: OpcaoPagamento; label: string }[]
              ).map((opt) => {
                const ativo = form.opcao_pagamento === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, opcao_pagamento: opt.v }))}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
                      ativo
                        ? "border-primary bg-primary text-white"
                        : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {form.opcao_pagamento === "entrada" && (
              <div className="space-y-2">
                <Label htmlFor="pct_entrada">Percentual de entrada (%)</Label>
                <Input
                  id="pct_entrada"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={form.percentual_entrada}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, percentual_entrada: e.target.value }))
                  }
                />
                {plano.tipo === "entrada" && (
                  <p className="text-xs text-muted-foreground">
                    Entrada ({Number(plano.pct.toFixed(0))}%):{" "}
                    <span className="font-semibold text-foreground">
                      {fmtValor(plano.entrada)}
                    </span>{" "}
                    · Restante: {fmtValor(plano.restante)}
                  </p>
                )}
              </div>
            )}

            {form.opcao_pagamento === "parcelado" && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="parcelas">Número de parcelas</Label>
                    <select
                      id="parcelas"
                      className={selectCls}
                      value={form.parcelas}
                      onChange={(e) => setForm((f) => ({ ...f, parcelas: e.target.value }))}
                    >
                      {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                        <option key={n} value={String(n)}>
                          {n}x
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tipo_parc">Tipo de parcelamento</Label>
                    <select
                      id="tipo_parc"
                      className={selectCls}
                      value={form.tipo_parcelamento}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          tipo_parcelamento: e.target.value as TipoParcelamento,
                        }))
                      }
                    >
                      <option value="iguais">Parcelas iguais</option>
                      <option value="entrada_diferenciada">Entrada diferenciada</option>
                    </select>
                  </div>
                </div>

                {form.tipo_parcelamento === "entrada_diferenciada" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="entrada_tipo">Entrada em</Label>
                      <select
                        id="entrada_tipo"
                        className={selectCls}
                        value={form.entrada_tipo}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            entrada_tipo: e.target.value as TipoEntrada,
                          }))
                        }
                      >
                        <option value="percentual">Percentual (%)</option>
                        <option value="valor">Valor ({simbolo})</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="entrada_valor">
                        {form.entrada_tipo === "percentual"
                          ? "% da entrada"
                          : `Valor da entrada (${simbolo})`}
                      </Label>
                      <Input
                        id="entrada_valor"
                        type="number"
                        min="0"
                        step={form.entrada_tipo === "percentual" ? "1" : "0.01"}
                        value={form.entrada_valor}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, entrada_valor: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Opções */}
          <section
            className="space-y-3 rounded-xl border p-4"
            style={{ borderColor: "rgba(255,255,255,0.08)", background: "#0f0f1c" }}
          >
            <h3 className="text-sm font-semibold text-foreground">Opções</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {template === "l2connect" && (
                <div className="space-y-2">
                  <Label>Idioma</Label>
                  <select
                    className={selectCls}
                    value={form.idioma}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, idioma: e.target.value as Idioma }))
                    }
                  >
                    <option value="pt">Português (BR)</option>
                    <option value="es">Español (AR)</option>
                  </select>
                </div>
              )}
              <div className={template === "zamy" ? "space-y-2 sm:col-span-2" : "space-y-2"}>
                <Label>Moeda</Label>
                <select
                  className={selectCls}
                  value={form.moeda}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, moeda: e.target.value as MoedaOrc }))
                  }
                >
                  {template === "l2connect" ? (
                    <>
                      <option value="BRL">Real (R$)</option>
                      <option value="ARS">Peso Argentino (ARS)</option>
                    </>
                  ) : (
                    <>
                      <option value="ARS">Peso Argentino (ARS)</option>
                      <option value="USD">Dólar (USD)</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            {form.moeda === "ARS" && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium text-amber-400">Dólar blue hoje</p>
                {loadingDolar ? (
                  <p className="text-muted-foreground">Buscando cotação...</p>
                ) : cotacaoDolar ? (
                  <p className="text-foreground">
                    1 USD = {fmtARS(cotacaoDolar)} · Total ≈{" "}
                    {totalUSD ? fmtUSD(totalUSD) : "—"}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Cotação indisponível.{" "}
                    <button
                      type="button"
                      onClick={fetchDolar}
                      className="text-amber-400 underline"
                    >
                      Tentar novamente
                    </button>
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="nota">Nota adicional</Label>
              <Input
                id="nota"
                value={form.nota}
                onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))}
                placeholder="Observações, prazo de entrega..."
              />
            </div>
          </section>

          {/* Mensagens */}
          {saveMsg && (
            <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
              {saveMsg}
            </p>
          )}
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {/* Ações */}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowPreview((v) => !v)}
              className="flex-1 lg:hidden"
            >
              <Eye className="size-4" />
              {showPreview ? "Ocultar prévia" : "Ver prévia"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={salvarOrcamento}
              disabled={salvando || !form.cliente_nome || total === 0}
              className="flex-1"
            >
              <Save className="size-4" />
              {salvando
                ? "Salvando..."
                : editingId
                  ? "Salvar alterações"
                  : "Salvar orçamento"}
            </Button>
            <Button
              type="button"
              onClick={gerarPDF}
              disabled={gerando || !form.cliente_nome || total === 0}
              className="flex-1"
            >
              <FileDown className="size-4" />
              {gerando ? "Gerando PDF..." : "Gerar PDF"}
            </Button>
          </div>
        </div>

        {/* ── Prévia do PDF ── */}
        <div className={showPreview ? "block" : "hidden lg:block"}>
          <p className="mb-2 text-xs text-muted-foreground">
            Prévia do documento — o PDF terá aparência idêntica.
          </p>
          <OrcamentoPreview data={previewData} previewRef={previewRef} />
        </div>
      </div>
    </div>
  );
}
