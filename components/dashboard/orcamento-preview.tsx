"use client";

import type { RefObject } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos compartilhados entre o gerador (orcamentos-manager) e o histórico.
// ─────────────────────────────────────────────────────────────────────────────
export type Template = "l2connect" | "zamy" | "l2connect-ar";
export type Idioma = "pt" | "es";
export type MoedaOrc = "BRL" | "ARS" | "USD";

export type OrcamentoServico = { descricao: string; valor: number };

// ── Pagamento ──
export type OpcaoPagamento = "avista" | "entrada" | "parcelado";
export type TipoParcelamento = "iguais" | "entrada_diferenciada";

export type PlanoPagamento =
  | { tipo: "avista" }
  | { tipo: "entrada"; pct: number; entrada: number; restante: number }
  | {
      tipo: "parcelado";
      n: number;
      subtipo: TipoParcelamento;
      parcelas: { numero: number; valor: number; entrada: boolean }[];
    };

/** Dados completos para renderizar um orçamento (usados na prévia e no PDF). */
export type OrcamentoData = {
  numero: string;
  data: string; // já formatada (dd/mm/aaaa)
  template: Template;
  idioma: Idioma;
  moeda: MoedaOrc;
  cliente_nome: string;
  cliente_email: string;
  cliente_telefone: string;
  servicos: OrcamentoServico[];
  plano: PlanoPagamento;
  total: number;
  nota: string;
  cotacaoDolar: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatação de moeda
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Geração de PDF a partir de um elemento renderizado (prévia).
// Reutilizado pelo gerador e pelo histórico.
// ─────────────────────────────────────────────────────────────────────────────
export async function gerarPdfDoElemento(el: HTMLElement, filename: string) {
  // Garante que as imagens (logos) terminaram de carregar antes do snapshot.
  const imgs = Array.from(el.querySelectorAll("img"));
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((res) => {
            img.onload = () => res(null);
            img.onerror = () => res(null);
          })
    )
  );

  const { default: html2canvas } = await import("html2canvas");
  const { jsPDF } = await import("jspdf");

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
  });

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const imgWidth = 210;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, imgWidth, imgHeight);
  pdf.save(filename);
}

// ─────────────────────────────────────────────────────────────────────────────
// Textos de pagamento (PT/ES)
// ─────────────────────────────────────────────────────────────────────────────
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

/** Bloco "Condições de Pagamento" reutilizável nos 3 templates. */
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

// ─────────────────────────────────────────────────────────────────────────────
// Textos por template
// ─────────────────────────────────────────────────────────────────────────────
const txt = {
  pt: {
    titulo: "Orçamento",
    data: "Data",
    numero: "Nº",
    cliente: "Cliente",
    servicos: "Serviços",
    servico: "Serviço / Descrição",
    valor: "Valor",
    total: "Total",
    pagamento: "Condições de Pagamento",
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
    servicos: "Servicios",
    servico: "Servicio / Descripción",
    valor: "Valor",
    total: "Total",
    pagamento: "Condiciones de Pago",
    nota_blue: "* Valor sujeto a la cotización del dólar blue del día.",
    ref_dolar: "Valor de referencia en dólar blue",
    validade: "Validez",
    validade_val: "30 días",
    rodape: "¡Gracias por su preferencia!",
  },
};

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
  nota_blue_ars: "* Valor sujeto a la cotización del dólar blue del día.",
  nota_blue_usd:
    "* Los valores en dólares se calculan según la cotización del Dólar Blue del día de emisión del presupuesto.",
  ref_dolar: "Valor de referencia en dólar blue",
  validade: "Validez",
  validade_val: "30 días",
  rodape: "¡Gracias por su preferencia!",
  rodape_empresa: "Estudio Creativo Zamy Design | www.zamydesign.com",
};

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
const Za = (a: number) => `rgba(194,24,91,${a})`;

// ─────────────────────────────────────────────────────────────────────────────
// Componente de prévia — renderiza o orçamento a partir de OrcamentoData.
// O mesmo markup vira o PDF (via gerarPdfDoElemento).
// ─────────────────────────────────────────────────────────────────────────────
export function OrcamentoPreview({
  data,
  previewRef,
}: {
  data: OrcamentoData;
  previewRef: RefObject<HTMLDivElement | null>;
}) {
  const {
    template,
    idioma,
    moeda,
    cotacaoDolar,
    numero,
    data: dataHoje,
    total,
    plano,
    nota,
  } = data;

  const t = txt[idioma];

  const fmtValor = (v: number): string => {
    if (moeda === "BRL") return fmtBRL(v);
    if (template !== "l2connect") {
      const n = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);
      return moeda === "USD" ? `US$ ${n}` : `$ ${n}`;
    }
    return moeda === "ARS" ? fmtARS(v) : fmtUSD(v);
  };

  const usdRef = (v: number): string | null =>
    moeda === "ARS" && cotacaoDolar ? fmtUSD(v / cotacaoDolar) : null;

  const servicos = data.servicos.filter((s) => s.descricao || s.valor);

  // ════ L2CONNECT / L2CONNECT AR ════ (mesmo layout, textos diferentes)
  if (template === "l2connect" || template === "l2connect-ar") {
    const L = template === "l2connect" ? t : ar;
    return (
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
              {L.titulo}
            </div>
            <div style={{ color: "#666", fontSize: "12px", marginTop: "4px" }}>
              {L.numero} {numero}
            </div>
            <div style={{ color: "#666", fontSize: "12px" }}>
              {L.data}: {dataHoje}
            </div>
            <div style={{ color: "#666", fontSize: "12px" }}>
              {L.validade}: {L.validade_val}
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
            {L.cliente}
          </div>
          <div style={{ fontWeight: "600" }}>
            {data.cliente_nome ||
              (template === "l2connect" ? "Nome do Cliente" : "Nombre del Cliente")}
          </div>
          {data.cliente_email && (
            <div style={{ color: "#555" }}>{data.cliente_email}</div>
          )}
          {data.cliente_telefone && (
            <div style={{ color: "#555" }}>{data.cliente_telefone}</div>
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
            {L.servicos}
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
                  {L.servico}
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
                  {L.valor}
                </th>
              </tr>
            </thead>
            <tbody>
              {servicos.map((s, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8f9ff" }}>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #eee" }}>
                    {s.descricao ||
                      `${template === "l2connect" ? "Serviço" : "Servicio"} ${i + 1}`}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      textAlign: "right",
                      borderBottom: "1px solid #eee",
                    }}
                  >
                    {fmtValor(s.valor || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#f0f4ff" }}>
                <td style={{ padding: "12px", fontWeight: "700", fontSize: "14px" }}>
                  {L.total}
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
          titulo={L.pagamento}
          labels={PAG[idioma]}
          total={total}
          fmtValor={fmtValor}
          usdRef={usdRef}
          cor="#0066FF"
          corHeaderBg="#f0f4ff"
          corBorda="#dde3ff"
          corCardBorda="#dde3ff"
          rodapeNota={
            moeda === "ARS"
              ? `${
                  cotacaoDolar
                    ? `${L.ref_dolar}: 1 USD = ${fmtARS(cotacaoDolar)}. `
                    : ""
                }${template === "l2connect" ? t.nota_blue : ar.nota_blue_ars}`
              : null
          }
        />

        {/* Nota adicional */}
        {nota && (
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
            {nota}
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
          <div style={{ color: "#888", fontSize: "12px" }}>{L.rodape}</div>
          <div
            style={{
              marginTop: "6px",
              color: "#aaa",
              fontSize: "10px",
              letterSpacing: "0.3px",
            }}
          >
            {template === "l2connect"
              ? "L2Connect | CNPJ: 65.433.467/0001-70 | www.l2connect.com.br"
              : ar.rodape_empresa}
          </div>
          {template === "l2connect-ar" && moeda === "USD" && (
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
    );
  }

  // ════ ZAMY DESIGN ════
  return (
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
          {data.cliente_nome || "Nombre del Cliente"}
        </div>
        {data.cliente_email && (
          <div style={{ color: "#555" }}>{data.cliente_email}</div>
        )}
        {data.cliente_telefone && (
          <div style={{ color: "#555" }}>{data.cliente_telefone}</div>
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
            {servicos.map((s, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : Za(0.04) }}>
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
                  {fmtValor(s.valor || 0)}
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
          moeda === "ARS"
            ? `${
                cotacaoDolar ? `${zamy.ref_dolar}: 1 USD = ${fmtARS(cotacaoDolar)}. ` : ""
              }${zamy.nota_blue_ars}`
            : null
        }
      />

      {/* Nota adicional */}
      {nota && (
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
          {nota}
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
        {moeda === "USD" && (
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
  );
}
