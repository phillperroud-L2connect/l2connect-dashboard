-- =============================================================================
-- L2Connect Dashboard — Histórico de Orçamentos
-- Execute UMA vez no SQL Editor do Supabase (projeto kwhgqhbgelmvnmwmgkxg)
-- =============================================================================
-- Cria:
--   • tabela  public.orcamentos          (o histórico em si)
--   • tabela  public.orcamento_contador  (controle da sequência por ano)
--   • função  gerar_numero_orcamento()   (numeração ORC-AAAA-NNN automática)
--   • trigger before insert              (preenche o número no INSERT)
--   • GRANT + RLS para o papel authenticated
-- Não apaga nem altera nenhuma tabela existente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABELA PRINCIPAL: orcamentos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orcamentos (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero           text UNIQUE NOT NULL,               -- ORC-2025-001 (gerado por trigger)
  cliente_nome     text NOT NULL,
  cliente_email    text,
  cliente_telefone text,
  template         text NOT NULL DEFAULT 'l2connect'
                     CHECK (template IN ('l2connect', 'l2connect-ar', 'zamy')),
  idioma           text NOT NULL DEFAULT 'pt'
                     CHECK (idioma IN ('pt', 'es')),
  moeda            text NOT NULL DEFAULT 'BRL'
                     CHECK (moeda IN ('BRL', 'ARS', 'USD')),
  cotacao_dolar    numeric(12, 4),                     -- dólar blue usado (quando moeda = ARS)
  total            numeric(12, 2) NOT NULL DEFAULT 0,
  plano_pagamento  jsonb,                              -- { tipo: 'entrada'|'parcelado'|'avista', ... }
  servicos         jsonb NOT NULL DEFAULT '[]'::jsonb, -- [ { descricao, valor }, ... ]
  nota             text,
  status           text NOT NULL DEFAULT 'rascunho'
                     CHECK (status IN ('rascunho', 'enviado', 'aprovado', 'recusado')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orcamentos_created_at ON public.orcamentos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orcamentos_status     ON public.orcamentos(status);

-- -----------------------------------------------------------------------------
-- 2. CONTADOR POR ANO (numeração sequencial real, à prova de concorrência)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orcamento_contador (
  ano    int PRIMARY KEY,
  ultimo int NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------------
-- 3. FUNÇÃO + TRIGGER: gera ORC-AAAA-NNN automaticamente no INSERT
--    SECURITY DEFINER → o incremento do contador é atômico e não depende de
--    permissão/RLS do usuário autenticado sobre a tabela orcamento_contador.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gerar_numero_orcamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ano int := EXTRACT(YEAR FROM now())::int;
  v_seq int;
BEGIN
  -- Se um número já veio explicitamente do cliente, respeita.
  IF NEW.numero IS NOT NULL AND NEW.numero <> '' THEN
    RETURN NEW;
  END IF;

  -- Incremento atômico do contador do ano corrente.
  INSERT INTO public.orcamento_contador (ano, ultimo)
    VALUES (v_ano, 1)
    ON CONFLICT (ano)
    DO UPDATE SET ultimo = public.orcamento_contador.ultimo + 1
    RETURNING ultimo INTO v_seq;

  NEW.numero := 'ORC-' || v_ano || '-' || lpad(v_seq::text, 3, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gerar_numero_orcamento ON public.orcamentos;
CREATE TRIGGER trg_gerar_numero_orcamento
  BEFORE INSERT ON public.orcamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.gerar_numero_orcamento();

-- -----------------------------------------------------------------------------
-- 4. PERMISSÕES (GRANT) — SELECT / INSERT / UPDATE para authenticated
--    (sem DELETE por padrão; o contador é acessado só pela função definer)
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.orcamentos TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

REVOKE ALL ON public.orcamentos          FROM anon;
REVOKE ALL ON public.orcamento_contador  FROM anon;

-- -----------------------------------------------------------------------------
-- 5. RLS — acesso total para usuários autenticados
-- -----------------------------------------------------------------------------
ALTER TABLE public.orcamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_orcamentos" ON public.orcamentos;
CREATE POLICY "authenticated_all_orcamentos"
  ON public.orcamentos
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- orcamento_contador: acessada apenas pela função SECURITY DEFINER.
-- Mantém RLS ligada e sem policy → nenhum acesso direto do cliente.
ALTER TABLE public.orcamento_contador ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 6. Recarregar cache da API (PostgREST)
-- -----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 7. Verificação
-- -----------------------------------------------------------------------------
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'orcamentos'
ORDER BY ordinal_position;

SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'orcamentos';
