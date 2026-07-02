"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, FileDown, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Cliente } from "@/lib/types";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Template = "l2connect" | "zamy" | "l2connect-ar";
type Idioma = "pt" | "es";
type MoedaOrc = "BRL" | "ARS" | "USD";

// ── Pagamento ── (mesmo escopo do SaaS Gerador de Orçamento)
type OpcaoPagamento = "avista" | "entrada" | "parcelado";
type TipoParcelamento = "iguais" | "entrada_diferenciada";
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
  percentual_entrada: string; // opção "com entrada"
  parcelas: string; // opção "parcelado" (2 a 12)
  tipo_parcelamento: TipoParcelamento; // opção "parcelado"
  entrada_tipo: TipoEntrada; // parcelado com entrada diferenciada
  entrada_valor: string; // valor ou % da entrada diferenciada
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
  // Default: 50% entrada + 50% restante (comportamento atual)
  opcao_pagamento: "entrada",
  percentual_entrada: "50",
  parcelas: "2",
  tipo_parcelamento: "iguais",
  entrada_tipo: "percentual",
  entrada_valor: "30",
};

/** Plano de pagamento calculado a partir do total e das escolhas do formulário. */
type PlanoPagamento =
  | { tipo: "avista" }
  | { tipo: "entrada"; pct: number; entrada: number; restante: number }
  | {
      tipo: "parcelado";
      n: number;
      subtipo: TipoParcelamento;
      parcelas: { numero: number; valor: number; entrada: boolean }[];
    };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Converte total + escolhas do formulário num plano estruturado.
 * Espelha a lógica do SaaS Gerador de Orçamento (calcularPlano).
 */
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

// Textos de pagamento (PT/ES) usados na prévia/PDF.
type PagLabels = {
  avista: string;
  entradaPct: (p: number) => string;
  restantePct: (p: number) => string;
  doisPagamentosNota: string;
  parceladoIguais: (n: number) => string;
  parceladoEntradaDif: (n: number) => string;
  entradaPrimeira: string;
  parcelaN: (n: number) => string;
};

const PAG: Record<Idioma, PagLabels> = {
  pt: {
    avista: "Pagamento à vista",
    entradaPct: (p) => `Entrada (${p}%)`,
    restantePct: (p) => `Restante (${p}%)`,
    doisPagamentosNota:
      "* São 2 pagamentos separados: entrada e restante na entrega.",
    parceladoIguais: (n) => `Parcelado em ${n}x iguais`,
    parceladoEntradaDif: (n) => `Parcelado em ${n}x com entrada diferenciada`,
    entradaPrimeira: "Entrada (1ª parcela)",
    parcelaN: (n) => `Parcela ${n}`,
  },
  es: {
    avista: "Pago al contado",
    entradaPct: (p) => `Anticipo (${p}%)`,
    restantePct: (p) => `Resto (${p}%)`,
    doisPagamentosNota:
      "* Son 2 pagos separados: anticipo y resto a la entrega.",
    parceladoIguais: (n) => `En ${n} cuotas iguales`,
    parceladoEntradaDif: (n) => `En ${n} cuotas con anticipo diferenciado`,
    entradaPrimeira: "Anticipo (1ª cuota)",
    parcelaN: (n) => `Cuota ${n}`,
  },
};

/**
 * Bloco "Condições de Pagamento" reutilizável nos 3 templates.
 * Parametrizado pela cor de destaque, para evitar duplicação.
 */
function CondicoesPagamento({
  plano,
  titulo,
  labels,
  total,
  fmtValor,
  usdRef,
  cor,
  corHeaderBg,
  corBorda,
  corCardBorda,
  rodapeNota,
}: {
  plano: PlanoPagamento;
  titulo: string;
  labels: PagLabels;
  total: number;
  fmtValor: (v: number) => string;
  usdRef: (v: number) => string | null;
  cor: string;
  corHeaderBg: string;
  corBorda: string;
  corCardBorda: string;
  rodapeNota: string | null;
}) {
  const usdCell = (v: number) => {
    const u = usdRef(v);
    return u ? (
      <div style={{ fontSize: "11px", color: "#888", marginTop: "4px" }}>
        ≈ {u}
      </div>
    ) : null;
  };

  return (
    <div
      style={{
        marginBottom: "24px",
        border: `1px solid ${corBorda}`,
        borderRadius: "8px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: corHeaderBg,
          padding: "10px 16px",
          fontWeight: 700,
          color: cor,
          fontSize: "12px",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {titulo}
      </div>

      <div style={{ padding: "16px" }}>
        {plano.tipo === "avista" && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "13px", color: "#555" }}>
              {labels.avista}
            </span>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: "22px", fontWeight: 800, color: cor }}>
                {fmtValor(total)}
              </span>
              {usdCell(total)}
            </div>
          </div>
        )}

        {plano.tipo === "entrada" && (
          <>
            <div style={{ display: "flex", gap: "16px" }}>
              <div
                style={{
                  flex: 1,
                  textAlign: "center",
                  background: "#fff",
                  border: `1px solid ${corCardBorda}`,
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <div
                  style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}
                >
                  {labels.entradaPct(Number(plano.pct.toFixed(0)))}
                </div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: cor }}>
                  {fmtValor(plano.entrada)}
                </div>
                {usdCell(plano.entrada)}
              </div>
              <div
                style={{
                  flex: 1,
                  textAlign: "center",
                  background: "#fff",
                  border: `1px solid ${corCardBorda}`,
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <div
                  style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}
                >
                  {labels.restantePct(Number((100 - plano.pct).toFixed(0)))}
                </div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: cor }}>
                  {fmtValor(plano.restante)}
                </div>
                {usdCell(plano.restante)}
              </div>
            </div>
            <div
              style={{
                marginTop: "12px",
                fontSize: "11px",
                color: "#888",
                textAlign: "center",
              }}
            >
              {labels.doisPagamentosNota}
            </div>
          </>
        )}

        {plano.tipo === "parcelado" && (
          <>
            <div style={{ marginBottom: "10px", fontSize: "12px", color: "#555" }}>
              {plano.subtipo === "entrada_diferenciada"
                ? labels.parceladoEntradaDif(plano.n)
                : labels.parceladoIguais(plano.n)}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {plano.parcelas.map((p) => (
                  <tr key={p.numero}>
                    <td
                      style={{
                        padding: "8px 12px",
                        borderBottom: "1px solid #eee",
                        fontSize: "12px",
                        color: "#444",
                      }}
                    >
                      {p.entrada ? labels.entradaPrimeira : labels.parcelaN(p.numero)}
                    </td>
                    <td
                      style={{
                        padding: "8px 12px",
                        borderBottom: "1px solid #eee",
                        textAlign: "right",
                        fontWeight: 700,
                        color: cor,
                        fontSize: "13px",
                      }}
                    >
                      {fmtValor(p.valor)}
                      {usdCell(p.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {rodapeNota && (
          <div
            style={{
              marginTop: "12px",
              paddingTop: "10px",
              fontSize: "11px",
              color: "#888",
              fontStyle: "italic",
              borderTop: "1px solid #eee",
            }}
          >
            {rodapeNota}
          </div>
        )}
      </div>
    </div>
  );
}

// L2Connect — textos bilíngues (inalterado)
const txt = {
  pt: {
    titulo: "Orçamento",
    data: "Data",
    numero: "Nº",
    cliente: "Cliente",
    email: "E-mail",
    telefone: "Telefone",
    servicos: "Serviços",
    servico: "Serviço / Descrição",
    valor: "Valor",
    total: "Total",
    pagamento: "Condições de Pagamento",
    entrada: "50% na entrada",
    entrega: "50% na entrega",
    nota_blue: "* Valor sujeito à cotação do dólar blue do dia.",
    ref_dolar: "Valor de referência em dólar blue",
    validade: "Validade",
    validade_val: "30 dias",
    rodape: "Obrigado pela preferência!",
  },
  es: {
    titulo: "Presupuesto",
    data: "Fecha",
    numero: "Nro.",
    cliente: "Cliente",
    email: "E-mail",
    telefone: "Teléfono",
    servicos: "Servicios",
    servico: "Servicio / Descripción",
    valor: "Valor",
    total: "Total",
    pagamento: "Condiciones de Pago",
    entrada: "50% a la firma",
    entrega: "50% a la entrega",
    nota_blue: "* Valor sujeto a la cotización del dólar blue del día.",
    ref_dolar: "Valor de referencia en dólar blue",
    validade: "Validez",
    validade_val: "30 días",
    rodape: "¡Gracias por su preferencia!",
  },
};

// Zamy Design — textos fixos em espanhol
const zamy = {
  titulo: "Presupuesto",
  data: "Fecha",
  numero: "Nro.",
  cliente: "Cliente",
  servicos: "Servicios",
  servico: "Servicio / Descripción",
  valor: "Valor",
  total: "Total",
  pagamento: "Condiciones de pago",
  entrada: "50% al inicio",
  entrega: "50% a la entrega",
  nota_blue_ars: "* Valor sujeto a la cotización del dólar blue del día.",
  nota_blue_usd:
    "* Los valores en dólares se calculan según la cotización del Dólar Blue del día de emisión del presupuesto.",
  ref_dolar: "Valor de referencia en dólar blue",
  validade: "Validez",
  validade_val: "30 días",
  rodape: "¡Gracias por su preferencia!",
  rodape_empresa: "Estudio Creativo Zamy Design | www.zamydesign.com",
};

// L2Connect Argentina — textos fixos em espanhol, cores L2Connect
const ar = {
  titulo: "Presupuesto",
  data: "Fecha",
  numero: "Nro.",
  cliente: "Cliente",
  servicos: "Servicios",
  servico: "Servicio / Descripción",
  valor: "Valor",
  total: "Total",
  pagamento: "Condiciones de pago",
  entrada: "50% al inicio",
  entrega: "50% a la entrega",
  nota_blue_ars: "* Valor sujeto a la cotización del dólar blue del día.",
  nota_blue_usd:
    "* Los valores en dólares se calculan según la cotización del Dólar Blue del día de emisión del presupuesto.",
  ref_dolar: "Valor de referencia en dólar blue",
  validade: "Validez",
  validade_val: "30 días",
  rodape: "¡Gracias por su preferencia!",
  rodape_empresa: "L2Connect | www.l2connect.com.br",
};

const Z = "#C2185B"; // fúcsia Zamy
const Za = (a: number) => `rgba(194,24,91,${a})`; // fúcsia com alpha

function gerarNumero() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `ORC-${yy}${mm}-${seq}`;
}

function formatDataBR(d: Date) {
  return d.toLocaleDateString("pt-BR");
}

function fmtBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
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

const selectCls =
  "flex h-9 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all";

export function OrcamentosManager() {
  const supabase = createClient();
  const previewRef = useRef<HTMLDivElement>(null);

  const [template, setTemplate] = useState<Template>("l2connect");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cotacaoDolar, setCotacaoDolar] = useState<number | null>(null);
  const [loadingDolar, setLoadingDolar] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [numero, setNumero] = useState("");
  const [dataHoje, setDataHoje] = useState("");

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
    setNumero(gerarNumero());
    setDataHoje(formatDataBR(new Date()));
  }, [loadClientes]);

  function switchTemplate(t: Template) {
    setTemplate(t);
    if (t === "l2connect") {
      setForm((f) => ({
        ...f,
        idioma: "pt",
        moeda: f.moeda === "USD" ? "ARS" : f.moeda,
      }));
    } else {
      // zamy e l2connect-ar: idioma fixo ES, sem BRL
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
  const totalUSD = cotacaoDolar && total > 0 && form.moeda === "ARS" ? total / cotacaoDolar : null;

  const plano = calcularPlano(total, form);
  const simbolo = form.moeda === "BRL" ? "R$" : form.moeda === "USD" ? "US$" : "$";

  // Referência ≈ USD por valor, só quando a moeda é ARS (dólar blue).
  const usdRef = (v: number): string | null =>
    form.moeda === "ARS" && cotacaoDolar ? fmtUSD(v / cotacaoDolar) : null;

  const t = txt[form.idioma];

  const fmtValor = (v: number): string => {
    if (form.moeda === "BRL") return fmtBRL(v);
    // Zamy e L2Connect AR: símbolo US$ ou $ com 2 casas decimais, sem conversão
    if (template !== "l2connect") {
      const n = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);
      return form.moeda === "USD" ? `US$ ${n}` : `$ ${n}`;
    }
    return form.moeda === "ARS" ? fmtARS(v) : fmtUSD(v);
  };

  async function gerarPDF() {
    if (!previewRef.current) return;
    setGerando(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const { jsPDF } = await import("jspdf");

      const canvas = await html2canvas(previewRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, imgWidth, imgHeight);

      const prefix = template === "l2connect" ? "orcamento" : "presupuesto";
      pdf.save(`${prefix}-${form.cliente_nome || "cliente"}-${numero}.pdf`);
    } catch (e) {
      console.error(e);
    }
    setGerando(false);
  }

  return (
    <div>
      <PageHeader
        title="Orçamentos"
        description="Gere orçamentos profissionais em PDF em português ou espanhol."
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
                  onChange={(e) => setForm((f) => ({ ...f, cliente_telefone: e.target.value }))}
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

            {/* Opção de pagamento */}
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
                    onClick={() =>
                      setForm((f) => ({ ...f, opcao_pagamento: opt.v }))
                    }
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

            {/* Com entrada — percentual */}
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

            {/* Parcelado */}
            {form.opcao_pagamento === "parcelado" && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="parcelas">Número de parcelas</Label>
                    <select
                      id="parcelas"
                      className={selectCls}
                      value={form.parcelas}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, parcelas: e.target.value }))
                      }
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
                      <option value="entrada_diferenciada">
                        Entrada diferenciada
                      </option>
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

          {/* Ações */}
          <div className="flex gap-3">
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

          {/* ════ L2CONNECT PREVIEW ════ */}
          {template === "l2connect" && (
            <div
              ref={previewRef}
              style={{
                background: "#ffffff",
                color: "#111111",
                fontFamily: "Helvetica Neue, Arial, sans-serif",
                padding: "40px",
                minHeight: "297mm",
                fontSize: "13px",
                lineHeight: "1.5",
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "32px",
                  paddingBottom: "24px",
                  borderBottom: "2px solid #0066FF",
                }}
              >
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/l2connect-logo-dark.png?v=4"
                    alt="L2Connect"
                    style={{ height: "56px", width: "auto", display: "block" }}
                    crossOrigin="anonymous"
                  />
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: "20px",
                      fontWeight: "700",
                      color: "#111",
                      textTransform: "uppercase",
                      letterSpacing: "1px",
                    }}
                  >
                    {t.titulo}
                  </div>
                  <div style={{ color: "#666", fontSize: "12px", marginTop: "4px" }}>
                    {t.numero} {numero}
                  </div>
                  <div style={{ color: "#666", fontSize: "12px" }}>
                    {t.data}: {dataHoje}
                  </div>
                  <div style={{ color: "#666", fontSize: "12px" }}>
                    {t.validade}: {t.validade_val}
                  </div>
                </div>
              </div>

              {/* Cliente */}
              <div
                style={{
                  marginBottom: "28px",
                  background: "#f8f9ff",
                  borderRadius: "8px",
                  padding: "16px",
                  borderLeft: "4px solid #0066FF",
                }}
              >
                <div style={{ fontWeight: "700", color: "#0066FF", marginBottom: "8px" }}>
                  {t.cliente}
                </div>
                <div style={{ fontWeight: "600" }}>
                  {form.cliente_nome || "Nome do Cliente"}
                </div>
                {form.cliente_email && (
                  <div style={{ color: "#555" }}>{form.cliente_email}</div>
                )}
                {form.cliente_telefone && (
                  <div style={{ color: "#555" }}>{form.cliente_telefone}</div>
                )}
              </div>

              {/* Serviços */}
              <div style={{ marginBottom: "28px" }}>
                <div
                  style={{
                    fontWeight: "700",
                    color: "#0066FF",
                    marginBottom: "12px",
                    textTransform: "uppercase",
                    fontSize: "11px",
                    letterSpacing: "1px",
                  }}
                >
                  {t.servicos}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#0066FF", color: "#fff" }}>
                      <th
                        style={{
                          padding: "10px 12px",
                          textAlign: "left",
                          fontWeight: "600",
                          fontSize: "12px",
                        }}
                      >
                        {t.servico}
                      </th>
                      <th
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          fontWeight: "600",
                          fontSize: "12px",
                          width: "140px",
                        }}
                      >
                        {t.valor}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.servicos
                      .filter((s) => s.descricao || s.valor)
                      .map((s, i) => (
                        <tr
                          key={s.id}
                          style={{ background: i % 2 === 0 ? "#fff" : "#f8f9ff" }}
                        >
                          <td
                            style={{ padding: "10px 12px", borderBottom: "1px solid #eee" }}
                          >
                            {s.descricao || `Serviço ${i + 1}`}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              textAlign: "right",
                              borderBottom: "1px solid #eee",
                            }}
                          >
                            {fmtValor(parseFloat(s.valor) || 0)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f0f4ff" }}>
                      <td
                        style={{ padding: "12px", fontWeight: "700", fontSize: "14px" }}
                      >
                        {t.total}
                      </td>
                      <td
                        style={{
                          padding: "12px",
                          textAlign: "right",
                          fontWeight: "800",
                          fontSize: "16px",
                          color: "#0066FF",
                        }}
                      >
                        {fmtValor(total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Condições de pagamento */}
              <CondicoesPagamento
                plano={plano}
                titulo={t.pagamento}
                labels={PAG[form.idioma]}
                total={total}
                fmtValor={fmtValor}
                usdRef={usdRef}
                cor="#0066FF"
                corHeaderBg="#f0f4ff"
                corBorda="#dde3ff"
                corCardBorda="#dde3ff"
                rodapeNota={
                  form.moeda === "ARS"
                    ? `${
                        cotacaoDolar
                          ? `${t.ref_dolar}: 1 USD = ${fmtARS(cotacaoDolar)}. `
                          : ""
                      }${t.nota_blue}`
                    : null
                }
              />

              {/* Nota adicional */}
              {form.nota && (
                <div
                  style={{
                    marginBottom: "24px",
                    padding: "12px 16px",
                    background: "#fffbf0",
                    border: "1px solid #ffe080",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "#555",
                  }}
                >
                  {form.nota}
                </div>
              )}

              {/* Rodapé */}
              <div
                style={{
                  marginTop: "40px",
                  textAlign: "center",
                  borderTop: "1px solid #eee",
                  paddingTop: "16px",
                }}
              >
                <div style={{ color: "#888", fontSize: "12px" }}>{t.rodape}</div>
                <div
                  style={{
                    marginTop: "6px",
                    color: "#aaa",
                    fontSize: "10px",
                    letterSpacing: "0.3px",
                  }}
                >
                  L2Connect | CNPJ: 65.433.467/0001-70 | www.l2connect.com.br
                </div>
              </div>
            </div>
          )}

          {/* ════ L2CONNECT ARGENTINA PREVIEW ════ */}
          {template === "l2connect-ar" && (
            <div
              ref={previewRef}
              style={{
                background: "#ffffff",
                color: "#111111",
                fontFamily: "Helvetica Neue, Arial, sans-serif",
                padding: "40px",
                minHeight: "297mm",
                fontSize: "13px",
                lineHeight: "1.5",
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "32px",
                  paddingBottom: "24px",
                  borderBottom: "2px solid #0066FF",
                }}
              >
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/l2connect-logo-dark.png?v=4"
                    alt="L2Connect"
                    style={{ height: "56px", width: "auto", display: "block" }}
                    crossOrigin="anonymous"
                  />
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: "20px",
                      fontWeight: "700",
                      color: "#111",
                      textTransform: "uppercase",
                      letterSpacing: "1px",
                    }}
                  >
                    {ar.titulo}
                  </div>
                  <div style={{ color: "#666", fontSize: "12px", marginTop: "4px" }}>
                    {ar.numero} {numero}
                  </div>
                  <div style={{ color: "#666", fontSize: "12px" }}>
                    {ar.data}: {dataHoje}
                  </div>
                  <div style={{ color: "#666", fontSize: "12px" }}>
                    {ar.validade}: {ar.validade_val}
                  </div>
                </div>
              </div>

              {/* Cliente */}
              <div
                style={{
                  marginBottom: "28px",
                  background: "#f8f9ff",
                  borderRadius: "8px",
                  padding: "16px",
                  borderLeft: "4px solid #0066FF",
                }}
              >
                <div style={{ fontWeight: "700", color: "#0066FF", marginBottom: "8px" }}>
                  {ar.cliente}
                </div>
                <div style={{ fontWeight: "600" }}>
                  {form.cliente_nome || "Nombre del Cliente"}
                </div>
                {form.cliente_email && (
                  <div style={{ color: "#555" }}>{form.cliente_email}</div>
                )}
                {form.cliente_telefone && (
                  <div style={{ color: "#555" }}>{form.cliente_telefone}</div>
                )}
              </div>

              {/* Servicios */}
              <div style={{ marginBottom: "28px" }}>
                <div
                  style={{
                    fontWeight: "700",
                    color: "#0066FF",
                    marginBottom: "12px",
                    textTransform: "uppercase",
                    fontSize: "11px",
                    letterSpacing: "1px",
                  }}
                >
                  {ar.servicos}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#0066FF", color: "#fff" }}>
                      <th
                        style={{
                          padding: "10px 12px",
                          textAlign: "left",
                          fontWeight: "600",
                          fontSize: "12px",
                        }}
                      >
                        {ar.servico}
                      </th>
                      <th
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          fontWeight: "600",
                          fontSize: "12px",
                          width: "140px",
                        }}
                      >
                        {ar.valor}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.servicos
                      .filter((s) => s.descricao || s.valor)
                      .map((s, i) => (
                        <tr
                          key={s.id}
                          style={{ background: i % 2 === 0 ? "#fff" : "#f8f9ff" }}
                        >
                          <td
                            style={{ padding: "10px 12px", borderBottom: "1px solid #eee" }}
                          >
                            {s.descricao || `Servicio ${i + 1}`}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              textAlign: "right",
                              borderBottom: "1px solid #eee",
                            }}
                          >
                            {fmtValor(parseFloat(s.valor) || 0)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f0f4ff" }}>
                      <td
                        style={{ padding: "12px", fontWeight: "700", fontSize: "14px" }}
                      >
                        {ar.total}
                      </td>
                      <td
                        style={{
                          padding: "12px",
                          textAlign: "right",
                          fontWeight: "800",
                          fontSize: "16px",
                          color: "#0066FF",
                        }}
                      >
                        {fmtValor(total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Condiciones de pago */}
              <CondicoesPagamento
                plano={plano}
                titulo={ar.pagamento}
                labels={PAG.es}
                total={total}
                fmtValor={fmtValor}
                usdRef={usdRef}
                cor="#0066FF"
                corHeaderBg="#f0f4ff"
                corBorda="#dde3ff"
                corCardBorda="#dde3ff"
                rodapeNota={
                  form.moeda === "ARS"
                    ? `${
                        cotacaoDolar
                          ? `${ar.ref_dolar}: 1 USD = ${fmtARS(cotacaoDolar)}. `
                          : ""
                      }${ar.nota_blue_ars}`
                    : null
                }
              />

              {/* Nota adicional */}
              {form.nota && (
                <div
                  style={{
                    marginBottom: "24px",
                    padding: "12px 16px",
                    background: "#fffbf0",
                    border: "1px solid #ffe080",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "#555",
                  }}
                >
                  {form.nota}
                </div>
              )}

              {/* Rodapé */}
              <div
                style={{
                  marginTop: "40px",
                  textAlign: "center",
                  borderTop: "1px solid #eee",
                  paddingTop: "16px",
                }}
              >
                <div style={{ color: "#888", fontSize: "12px" }}>{ar.rodape}</div>
                <div
                  style={{
                    marginTop: "6px",
                    color: "#aaa",
                    fontSize: "10px",
                    letterSpacing: "0.3px",
                  }}
                >
                  {ar.rodape_empresa}
                </div>
                {form.moeda === "USD" && (
                  <div
                    style={{
                      marginTop: "6px",
                      color: "#aaa",
                      fontSize: "10px",
                      fontStyle: "italic",
                    }}
                  >
                    {ar.nota_blue_usd}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════ ZAMY DESIGN PREVIEW ════ */}
          {template === "zamy" && (
            <div
              ref={previewRef}
              style={{
                background: "#ffffff",
                color: "#111111",
                fontFamily: "Helvetica Neue, Arial, sans-serif",
                padding: "40px",
                minHeight: "297mm",
                fontSize: "13px",
                lineHeight: "1.5",
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "32px",
                  paddingBottom: "24px",
                  borderBottom: `2px solid ${Z}`,
                }}
              >
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/Logotipo.Zamy.jpeg"
                    alt="Zamy Design"
                    style={{ height: "56px", width: "auto", display: "block" }}
                    crossOrigin="anonymous"
                  />
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: "20px",
                      fontWeight: "700",
                      color: "#111",
                      textTransform: "uppercase",
                      letterSpacing: "1px",
                    }}
                  >
                    {zamy.titulo}
                  </div>
                  <div style={{ color: "#666", fontSize: "12px", marginTop: "4px" }}>
                    {zamy.numero} {numero}
                  </div>
                  <div style={{ color: "#666", fontSize: "12px" }}>
                    {zamy.data}: {dataHoje}
                  </div>
                  <div style={{ color: "#666", fontSize: "12px" }}>
                    {zamy.validade}: {zamy.validade_val}
                  </div>
                </div>
              </div>

              {/* Cliente */}
              <div
                style={{
                  marginBottom: "28px",
                  background: Za(0.06),
                  borderRadius: "8px",
                  padding: "16px",
                  borderLeft: `4px solid ${Z}`,
                }}
              >
                <div style={{ fontWeight: "700", color: Z, marginBottom: "8px" }}>
                  {zamy.cliente}
                </div>
                <div style={{ fontWeight: "600" }}>
                  {form.cliente_nome || "Nombre del Cliente"}
                </div>
                {form.cliente_email && (
                  <div style={{ color: "#555" }}>{form.cliente_email}</div>
                )}
                {form.cliente_telefone && (
                  <div style={{ color: "#555" }}>{form.cliente_telefone}</div>
                )}
              </div>

              {/* Servicios */}
              <div style={{ marginBottom: "28px" }}>
                <div
                  style={{
                    fontWeight: "700",
                    color: Z,
                    marginBottom: "12px",
                    textTransform: "uppercase",
                    fontSize: "11px",
                    letterSpacing: "1px",
                  }}
                >
                  {zamy.servicos}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: Z, color: "#fff" }}>
                      <th
                        style={{
                          padding: "10px 12px",
                          textAlign: "left",
                          fontWeight: "600",
                          fontSize: "12px",
                        }}
                      >
                        {zamy.servico}
                      </th>
                      <th
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          fontWeight: "600",
                          fontSize: "12px",
                          width: "140px",
                        }}
                      >
                        {zamy.valor}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.servicos
                      .filter((s) => s.descricao || s.valor)
                      .map((s, i) => (
                        <tr
                          key={s.id}
                          style={{ background: i % 2 === 0 ? "#fff" : Za(0.04) }}
                        >
                          <td
                            style={{
                              padding: "10px 12px",
                              borderBottom: `1px solid ${Za(0.15)}`,
                            }}
                          >
                            {s.descricao || `Servicio ${i + 1}`}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              textAlign: "right",
                              borderBottom: `1px solid ${Za(0.15)}`,
                            }}
                          >
                            {fmtValor(parseFloat(s.valor) || 0)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: Za(0.08) }}>
                      <td
                        style={{
                          padding: "12px",
                          fontWeight: "700",
                          fontSize: "14px",
                          color: Z,
                        }}
                      >
                        {zamy.total}
                      </td>
                      <td
                        style={{
                          padding: "12px",
                          textAlign: "right",
                          fontWeight: "800",
                          fontSize: "16px",
                          color: Z,
                        }}
                      >
                        {fmtValor(total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Condiciones de pago */}
              <CondicoesPagamento
                plano={plano}
                titulo={zamy.pagamento}
                labels={PAG.es}
                total={total}
                fmtValor={fmtValor}
                usdRef={usdRef}
                cor={Z}
                corHeaderBg={Za(0.1)}
                corBorda={Za(0.3)}
                corCardBorda={Za(0.25)}
                rodapeNota={
                  form.moeda === "ARS"
                    ? `${
                        cotacaoDolar
                          ? `${zamy.ref_dolar}: 1 USD = ${fmtARS(cotacaoDolar)}. `
                          : ""
                      }${zamy.nota_blue_ars}`
                    : null
                }
              />

              {/* Nota adicional */}
              {form.nota && (
                <div
                  style={{
                    marginBottom: "24px",
                    padding: "12px 16px",
                    background: Za(0.05),
                    border: `1px solid ${Za(0.2)}`,
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "#555",
                  }}
                >
                  {form.nota}
                </div>
              )}

              {/* Rodapé */}
              <div
                style={{
                  marginTop: "40px",
                  textAlign: "center",
                  borderTop: `1px solid ${Z}`,
                  paddingTop: "16px",
                }}
              >
                <div style={{ color: "#888", fontSize: "12px" }}>{zamy.rodape}</div>
                <div
                  style={{
                    marginTop: "6px",
                    color: "#aaa",
                    fontSize: "10px",
                    letterSpacing: "0.3px",
                  }}
                >
                  {zamy.rodape_empresa}
                </div>
                {form.moeda === "USD" && (
                  <div
                    style={{
                      marginTop: "6px",
                      color: "#aaa",
                      fontSize: "10px",
                      fontStyle: "italic",
                    }}
                  >
                    {zamy.nota_blue_usd}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
