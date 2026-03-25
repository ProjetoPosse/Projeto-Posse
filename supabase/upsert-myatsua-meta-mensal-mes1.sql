-- Meta mensal do primeiro mes para myatsua@gmail.com
-- Antes de rodar:
-- 1. Envie o PDF para o bucket `materiais`
-- 2. Use o caminho exato: diarios/diario-mes-01-myatsua.pdf

do $$
declare
  v_email constant text := 'myatsua@gmail.com';
  v_diario_path constant text := 'diarios/diario-mes-01-myatsua.pdf';
  v_profile_id uuid;
  v_mentor_id uuid;
  v_plano_abril uuid;
begin
  select id
    into v_profile_id
  from public.profiles
  where email = v_email
  limit 1;

  if v_profile_id is null then
    raise exception 'Perfil nao encontrado para %.', v_email;
  end if;

  select id
    into v_mentor_id
  from public.profiles
  where role = 'mentor'
  order by created_at
  limit 1;

  select id
    into v_plano_abril
  from public.planos_mensais
  where mentorado_id = v_profile_id
    and mes_referencia = date '2026-04-01'
  limit 1;

  if v_plano_abril is null then
    raise exception 'Plano de abril/2026 nao encontrado para %.', v_email;
  end if;

  insert into public.materiais (
    titulo,
    descricao,
    tipo,
    visibilidade,
    concurso_id,
    mentorado_id,
    externo_url,
    file_path,
    created_by
  )
  select
    'Diario mes 01',
    'Meta mensal individual do primeiro mes do aluno.',
    'meta_mensal',
    'aluno',
    null,
    v_profile_id,
    null,
    v_diario_path,
    v_mentor_id
  where not exists (
    select 1
    from public.materiais
    where mentorado_id = v_profile_id
      and file_path = v_diario_path
  );

  delete from public.plano_itens
  where plano_id = v_plano_abril
    and mentorado_id = v_profile_id
    and tipo = 'meta_mensal';

  insert into public.plano_itens (
    plano_id,
    mentorado_id,
    titulo,
    descricao,
    tipo,
    data_prevista,
    ordem,
    tec_url,
    material_url,
    concluida
  )
  values (
    v_plano_abril,
    v_profile_id,
    'Meta mensal - Mes 01',
    'Diario e meta mensal individual do primeiro mes. Use este PDF como guia de acompanhamento pessoal.',
    'meta_mensal',
    date '2026-04-01',
    0,
    null,
    v_diario_path,
    false
  );
end $$;
