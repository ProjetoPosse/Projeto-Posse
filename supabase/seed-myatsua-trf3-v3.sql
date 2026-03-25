-- Implantacao completa do plano TRF-3 V3 para o aluno teste myatsua@gmail.com
-- Compatibilidade: inclui suporte a bases antigas em que `public.simulados`
-- ainda possui a coluna obrigatoria `user_id`.
--
-- Pre-requisitos:
-- 1. O usuario ja deve existir em Authentication > Users.
-- 2. O schema principal do projeto ja deve estar aplicado.
-- 3. Envie o PDF para o bucket privado `materiais` no caminho:
--    planos/trf3-v3-myatsua.pdf

do $$
declare
  v_email constant text := 'myatsua@gmail.com';
  v_concurso_nome constant text := 'TRF 3 - Analista Judiciario - Area Judiciaria';
  v_pdf_path constant text := 'planos/trf3-v3-myatsua.pdf';
  v_tec_url constant text := 'https://www.tecconcursos.com.br/';
  v_user_id uuid;
  v_profile_id uuid;
  v_mentor_id uuid;
  v_concurso_id uuid;
  v_plano_abril uuid;
  v_plano_maio uuid;
  v_plano_junho uuid;
  v_plano_julho uuid;
  v_has_simulados_user_id boolean;
  v_has_simulados_name boolean;
  v_has_weekly_user_id boolean;
  v_has_pomodoro_user_id boolean;
  v_has_weekly_day boolean;
  v_has_pomodoro_day boolean;
begin
  select id
    into v_user_id
  from auth.users
  where email = v_email
  limit 1;

  if v_user_id is null then
    raise exception 'Usuario % nao encontrado em auth.users. Crie o usuario antes de rodar este seed.', v_email;
  end if;

  select id
    into v_mentor_id
  from public.profiles
  where role = 'mentor'
  order by created_at
  limit 1;

  insert into public.concursos (nome, cargo, orgao, descricao, status)
  select
    v_concurso_nome,
    'Analista Judiciario',
    'TRF 3',
    'Concurso TRF-3 com plano TRF-3 V3 implantado individualmente.',
    'ativo'
  where not exists (
    select 1 from public.concursos where nome = v_concurso_nome
  );

  select id
    into v_concurso_id
  from public.concursos
  where nome = v_concurso_nome
  order by created_at
  limit 1;

  insert into public.profiles (id, email, nome, role, ativo, concurso_id)
  values (
    v_user_id,
    v_email,
    'Aluno Teste TRF-3',
    'mentorado',
    true,
    v_concurso_id
  )
  on conflict (id) do update
  set
    email = excluded.email,
    nome = excluded.nome,
    role = 'mentorado',
    ativo = true,
    concurso_id = excluded.concurso_id;

  v_profile_id := v_user_id;

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
    'Plano de Estudos TRF-3 V3',
    'PDF individual implantado para o aluno teste com acesso apenas deste mentorado.',
    'pdf',
    'aluno',
    null,
    v_profile_id,
    null,
    v_pdf_path,
    v_mentor_id
  where not exists (
    select 1
    from public.materiais
    where mentorado_id = v_profile_id
      and file_path = v_pdf_path
  );

  insert into public.planos_mensais (
    mentorado_id,
    titulo,
    descricao,
    mes_referencia,
    status,
    pdf_url,
    pdf_path,
    created_by
  )
  values
    (
      v_profile_id,
      'Plano Abril 2026 - TRF-3 V3',
      'Semanas 1 a 4 do plano oficial: nivelamento em Tributario e entrada forte em Previdenciario.',
      date '2026-04-01',
      'ativo',
      null,
      v_pdf_path,
      v_mentor_id
    ),
    (
      v_profile_id,
      'Plano Maio 2026 - TRF-3 V3',
      'Semanas 5 a 9: consolidacao de Previdenciario, Administracao e inicio da fase de topicos TRF-3.',
      date '2026-05-01',
      'ativo',
      null,
      v_pdf_path,
      v_mentor_id
    ),
    (
      v_profile_id,
      'Plano Junho 2026 - TRF-3 V3',
      'Semanas 10 a 13: legislacao dos tribunais, revisoes D+14, simulados completos e discursivas.',
      date '2026-06-01',
      'ativo',
      null,
      v_pdf_path,
      v_mentor_id
    ),
    (
      v_profile_id,
      'Plano Julho 2026 - TRF-3 V3',
      'Semanas 14 a 16: sprint final, ajustes dinamicos, simulados e revisao de topicos certeza.',
      date '2026-07-01',
      'ativo',
      null,
      v_pdf_path,
      v_mentor_id
    )
  on conflict (mentorado_id, mes_referencia) do update
  set
    titulo = excluded.titulo,
    descricao = excluded.descricao,
    status = excluded.status,
    pdf_url = excluded.pdf_url,
    pdf_path = excluded.pdf_path,
    created_by = excluded.created_by;

  select id into v_plano_abril
  from public.planos_mensais
  where mentorado_id = v_profile_id and mes_referencia = date '2026-04-01';

  select id into v_plano_maio
  from public.planos_mensais
  where mentorado_id = v_profile_id and mes_referencia = date '2026-05-01';

  select id into v_plano_junho
  from public.planos_mensais
  where mentorado_id = v_profile_id and mes_referencia = date '2026-06-01';

  select id into v_plano_julho
  from public.planos_mensais
  where mentorado_id = v_profile_id and mes_referencia = date '2026-07-01';

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'simulados'
      and column_name = 'user_id'
  )
  into v_has_simulados_user_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'simulados'
      and column_name = 'name'
  )
  into v_has_simulados_name;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_logs'
      and column_name = 'user_id'
  )
  into v_has_weekly_user_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pomodoro_logs'
      and column_name = 'user_id'
  )
  into v_has_pomodoro_user_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_logs'
      and column_name = 'day'
  )
  into v_has_weekly_day;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pomodoro_logs'
      and column_name = 'day'
  )
  into v_has_pomodoro_day;

  delete from public.plano_itens
  where mentorado_id = v_profile_id
    and plano_id in (v_plano_abril, v_plano_maio, v_plano_junho, v_plano_julho);

  delete from public.simulados
  where mentorado_id = v_profile_id
    and titulo in (
      'Simulado 1 - Diagnostico TRF-3',
      'Simulado 3 - Consolidacao',
      'Simulado Final - Ensaio Geral'
    );

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
  values
    (v_plano_abril, v_profile_id, 'Semana 1 - Tributario A00-A02 + RLM diagnostico', 'Nivelamento entre 30/03 e 04/04 com especies de tributo, principios, imunidades e associacao de informacoes.', 'teoria', date '2026-03-30', 1, v_tec_url, null, false),
    (v_plano_abril, v_profile_id, 'Semana 2 - Competencia, obrigacoes e responsabilidade tributaria', 'Cobrir A03-A06 de Tributario e entrada em Seguridade Social conforme o PDF.', 'teoria', date '2026-04-06', 2, v_tec_url, null, false),
    (v_plano_abril, v_profile_id, 'Semana 3 - Credito, suspensao e segurados do RGPS', 'Trabalhar A07-A09 de Tributario, suspensao do credito e segurados obrigatorios e facultativos.', 'questoes', date '2026-04-13', 3, v_tec_url, null, false),
    (v_plano_abril, v_profile_id, 'Semana 4 - Exclusao, administracao tributaria e custeio', 'Concluir A10-A12 de Tributario e abrir A03-A05 de Previdenciario com foco em custeio.', 'teoria', date '2026-04-20', 4, v_tec_url, null, false),
    (v_plano_abril, v_profile_id, 'Encerramento de abril - checklist de fixacao', 'Fechar abril com revisao D+7, mapa mental tributario e conferencia da carga semanal.', 'revisao', date '2026-04-26', 5, v_tec_url, null, false),
    (v_plano_maio, v_profile_id, 'Semana 5 - Arrecadacao, beneficios e Prescricao/Decadencia', 'Trabalhar A06-A08 de Previdenciario e aprofundar Civil em Prescricao e Decadencia.', 'teoria', date '2026-04-27', 1, v_tec_url, null, false),
    (v_plano_maio, v_profile_id, 'Semana 6 - Regras de transicao RGPS + Responsabilidade Civil + art. 5', 'Cruzar EC 103/2019, responsabilidade civil e garantias constitucionais centrais para FCC.', 'teoria', date '2026-05-04', 2, v_tec_url, null, false),
    (v_plano_maio, v_profile_id, 'Semana 7 - Administracao Geral/Publica + RPPS', 'Semana dedicada a PODC, administracao gerencial e RPPS com art. 40 da CF.', 'teoria', date '2026-05-11', 3, v_tec_url, null, false),
    (v_plano_maio, v_profile_id, 'Semana 8 - Previdencia complementar, impostos e Reforma Tributaria', 'A14-A15 de Previdenciario com CTC e LC 109/2001, alem de A13-A17 de Tributario.', 'teoria', date '2026-05-18', 4, v_tec_url, null, false),
    (v_plano_maio, v_profile_id, 'Semana 9 - Penal federal + Inquerito Policial', 'Abrir fase 3 com prescricao penal, concurso de pessoas e inquerito policial.', 'questoes', date '2026-05-25', 5, v_tec_url, null, false),
    (v_plano_junho, v_profile_id, 'Semana 10 - LOMAN, CNJ 75/2009 e Lei 13.146/2015', 'Topicos estrategicos TRF-3: magistratura, codigo de etica e pessoas com deficiencia.', 'teoria', date '2026-06-01', 1, v_tec_url, null, false),
    (v_plano_junho, v_profile_id, 'Semana 11 - Revisao geral D+14 da fase 1 e 2', 'Rodada pesada com foco em Tributario, Previdenciario, Administrativo e Processo.', 'revisao', date '2026-06-08', 2, v_tec_url, null, false),
    (v_plano_junho, v_profile_id, 'Semana 12 - Reforco de pontos fracos + Discursiva 1', 'Ajustar materias de menor rendimento e produzir discursiva FCC em Responsabilidade Civil.', 'redacao', date '2026-06-15', 3, v_tec_url, null, false),
    (v_plano_junho, v_profile_id, 'Semana 13 - Simulados intensivos e ajuste dinamico', 'Analise de desempenho, reforco duplo nas duas materias mais fracas e rotacao completa com cronometro.', 'simulado', date '2026-06-22', 4, v_tec_url, null, false),
    (v_plano_julho, v_profile_id, 'Semana 14 - Dobrar as 2 materias mais fracas', 'Ajuste dinamico com simulados, discursiva e reforco em Processo, Administrativo e topicos TRF-3.', 'questoes', date '2026-06-29', 1, v_tec_url, null, false),
    (v_plano_julho, v_profile_id, 'Semana 15 - Sprint final FCC 2024 + discursiva cronometrada', 'Blocos de 20 questoes em Tributario, Previdenciario, Portugues, Civil, Constitucional e RLM.', 'questoes', date '2026-07-06', 2, v_tec_url, null, false),
    (v_plano_julho, v_profile_id, 'Simulado 6 - prova completa cronometrada', 'Aplicar simulado final de 4h30 e revisar ultimas duvidas antes da semana 16.', 'simulado', date '2026-07-11', 3, v_tec_url, null, false),
    (v_plano_julho, v_profile_id, 'Semana 16 - Topicos certeza + mapas mentais', 'Revisao final de extincao e suspensao do credito, seguridade, RLM, TRFs, LOMAN e CNJ.', 'revisao', date '2026-07-13', 4, v_tec_url, null, false),
    (v_plano_julho, v_profile_id, 'Descanso estrategico de sexta', 'Sexta da semana 16 reservada para descanso total, conforme o plano.', 'revisao', date '2026-07-17', 5, null, null, false),
    (v_plano_julho, v_profile_id, 'Ensaio geral final', 'Ultima leitura dos mapas mentais e mini simulado misto antes da reta final.', 'simulado', date '2026-07-18', 6, v_tec_url, null, false);

  if v_has_simulados_user_id and v_has_simulados_name then
    execute $sql$
      insert into public.simulados (
        user_id,
        name,
        mentorado_id,
        concurso_id,
        titulo,
        data_aplicacao,
        acertos,
        total_questoes,
        observacoes
      )
      values
        ($1, 'Simulado 1 - Diagnostico TRF-3', $1, $2, 'Simulado 1 - Diagnostico TRF-3', date '2026-05-23', 41, 62, 'Base para ajustar Penal, Processo Penal e RLM no meio do ciclo.'),
        ($1, 'Simulado 3 - Consolidacao', $1, $2, 'Simulado 3 - Consolidacao', date '2026-06-20', 46, 62, 'Evolucao consistente em Tributario e Previdenciario; ainda reforcar topicos TRF-3.'),
        ($1, 'Simulado Final - Ensaio Geral', $1, $2, 'Simulado Final - Ensaio Geral', date '2026-07-18', 46, 62, 'Ensaio final da reta decisiva com leitura posterior das discursivas treinadas.')
    $sql$
    using v_profile_id, v_concurso_id;
  elsif v_has_simulados_user_id then
    execute $sql$
      insert into public.simulados (
        user_id,
        mentorado_id,
        concurso_id,
        titulo,
        data_aplicacao,
        acertos,
        total_questoes,
        observacoes
      )
      values
        ($1, $1, $2, 'Simulado 1 - Diagnostico TRF-3', date '2026-05-23', 41, 62, 'Base para ajustar Penal, Processo Penal e RLM no meio do ciclo.'),
        ($1, $1, $2, 'Simulado 3 - Consolidacao', date '2026-06-20', 46, 62, 'Evolucao consistente em Tributario e Previdenciario; ainda reforcar topicos TRF-3.'),
        ($1, $1, $2, 'Simulado Final - Ensaio Geral', date '2026-07-18', 46, 62, 'Ensaio final da reta decisiva com leitura posterior das discursivas treinadas.')
    $sql$
    using v_profile_id, v_concurso_id;
  else
    insert into public.simulados (
      mentorado_id,
      concurso_id,
      titulo,
      data_aplicacao,
      acertos,
      total_questoes,
      observacoes
    )
    values
      (v_profile_id, v_concurso_id, 'Simulado 1 - Diagnostico TRF-3', date '2026-05-23', 41, 62, 'Base para ajustar Penal, Processo Penal e RLM no meio do ciclo.'),
      (v_profile_id, v_concurso_id, 'Simulado 3 - Consolidacao', date '2026-06-20', 46, 62, 'Evolucao consistente em Tributario e Previdenciario; ainda reforcar topicos TRF-3.'),
      (v_profile_id, v_concurso_id, 'Simulado Final - Ensaio Geral', date '2026-07-18', 46, 62, 'Ensaio final da reta decisiva com leitura posterior das discursivas treinadas.');
  end if;

  delete from public.weekly_logs
  where mentorado_id = v_profile_id
    and referencia in (date '2026-04-04', date '2026-05-02', date '2026-06-06', date '2026-07-11');

  if v_has_weekly_user_id and v_has_weekly_day then
    execute $sql$
      insert into public.weekly_logs (
        user_id,
        mentorado_id,
        day,
        referencia,
        horas,
        questoes,
        acertos
      )
      values
        ($1, $1, date '2026-04-04', date '2026-04-04', 16.50, 420, 287),
        ($1, $1, date '2026-05-02', date '2026-05-02', 18.00, 460, 318),
        ($1, $1, date '2026-06-06', date '2026-06-06', 20.00, 520, 379),
        ($1, $1, date '2026-07-11', date '2026-07-11', 14.00, 360, 271)
    $sql$
    using v_profile_id;
  elsif v_has_weekly_user_id then
    execute $sql$
      insert into public.weekly_logs (
        user_id,
        mentorado_id,
        referencia,
        horas,
        questoes,
        acertos
      )
      values
        ($1, $1, date '2026-04-04', 16.50, 420, 287),
        ($1, $1, date '2026-05-02', 18.00, 460, 318),
        ($1, $1, date '2026-06-06', 20.00, 520, 379),
        ($1, $1, date '2026-07-11', 14.00, 360, 271)
    $sql$
    using v_profile_id;
  else
    insert into public.weekly_logs (
      mentorado_id,
      referencia,
      horas,
      questoes,
      acertos
    )
    values
      (v_profile_id, date '2026-04-04', 16.50, 420, 287),
      (v_profile_id, date '2026-05-02', 18.00, 460, 318),
      (v_profile_id, date '2026-06-06', 20.00, 520, 379),
      (v_profile_id, date '2026-07-11', 14.00, 360, 271);
  end if;

  delete from public.pomodoro_logs
  where mentorado_id = v_profile_id
    and referencia in (date '2026-04-04', date '2026-05-16', date '2026-06-28');

  if v_has_pomodoro_user_id and v_has_pomodoro_day then
    execute $sql$
      insert into public.pomodoro_logs (
        user_id,
        mentorado_id,
        day,
        referencia,
        sessoes,
        minutos
      )
      values
        ($1, $1, date '2026-04-04', date '2026-04-04', 22, 550),
        ($1, $1, date '2026-05-16', date '2026-05-16', 24, 600),
        ($1, $1, date '2026-06-28', date '2026-06-28', 26, 650)
    $sql$
    using v_profile_id;
  elsif v_has_pomodoro_user_id then
    execute $sql$
      insert into public.pomodoro_logs (
        user_id,
        mentorado_id,
        referencia,
        sessoes,
        minutos
      )
      values
        ($1, $1, date '2026-04-04', 22, 550),
        ($1, $1, date '2026-05-16', 24, 600),
        ($1, $1, date '2026-06-28', 26, 650)
    $sql$
    using v_profile_id;
  else
    insert into public.pomodoro_logs (
      mentorado_id,
      referencia,
      sessoes,
      minutos
    )
    values
      (v_profile_id, date '2026-04-04', 22, 550),
      (v_profile_id, date '2026-05-16', 24, 600),
      (v_profile_id, date '2026-06-28', 26, 650);
  end if;
end $$;
