-- =============================================================================
-- L2Connect Dashboard — habilita EXCLUSÃO de orçamentos
-- Execute no SQL Editor do Supabase se você JÁ rodou o supabase-orcamentos.sql
-- (a policy RLS já é FOR ALL; falta apenas o GRANT DELETE na tabela).
-- =============================================================================
GRANT DELETE ON public.orcamentos TO authenticated;

NOTIFY pgrst, 'reload schema';
