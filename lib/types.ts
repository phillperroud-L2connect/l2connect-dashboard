export type Cliente = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  created_at: string;
};

export type Moeda = "BRL" | "ARS";
export type ParcelaStatus = "pago" | "pendente";

export type Pagamento = {
  id: string;
  cliente_id: string;
  descricao: string | null;
  moeda: Moeda;
  valor_parcela1: number;
  data_parcela1: string;
  status_parcela1: ParcelaStatus;
  valor_parcela2: number | null;
  data_parcela2: string | null;
  status_parcela2: ParcelaStatus | null;
  created_at: string;
  clientes?: Pick<Cliente, "nome"> | null;
  cotacao_ars_brl?: number | null;
};

export type OrcamentoStatus = "rascunho" | "enviado" | "aprovado" | "recusado";

export type Orcamento = {
  id: string;
  numero: string;
  cliente_nome: string;
  cliente_email: string | null;
  cliente_telefone: string | null;
  template: "l2connect" | "l2connect-ar" | "zamy";
  idioma: "pt" | "es";
  moeda: "BRL" | "ARS" | "USD";
  cotacao_dolar: number | null;
  total: number;
  plano_pagamento: unknown | null;
  servicos: { descricao: string; valor: number }[];
  nota: string | null;
  status: OrcamentoStatus;
  created_at: string;
};

export type GastoMoeda = "BRL" | "USD";
export type GastoTipo = "recorrente" | "avulso";

export type Gasto = {
  id: string;
  descricao: string;
  valor: number;
  moeda: GastoMoeda;
  tipo: GastoTipo;
  categoria: string | null;
  data: string;
  created_at: string;
};
