# Deploy e Configuracao Final

## Rotas principais

- Site publico: `/index.html`
- Login: `/app/login.html`
- Mentorado: `/app/mentorado.html`
- Plano: `/app/plano.html`
- Admin: `/app/admin.html`
- Demo local sem Supabase: `/painel.html`

## Checklist de publicacao

1. Publique a raiz do projeto.
2. Garanta que a pasta `/app` suba inteira, sem mudar caminhos.
3. Mantenha a pasta `/supabase` no repositorio, mesmo que ela nao seja enviada para o servidor.
4. Se usar Netlify, mantenha [netlify.toml](C:\Users\lnduarte\Desktop\projeto-posse\netlify.toml) na raiz.
5. Confirme que os links publicos apontam para `/app/login.html`.

## Checklist do Supabase

1. Crie o projeto no Supabase.
2. Rode [schema.sql](C:\Users\lnduarte\Desktop\projeto-posse\supabase\schema.sql) no SQL Editor.
3. Se o banco ja existia antes do modelo de plano mensal, rode tambem [plano-mensal-migration.sql](C:\Users\lnduarte\Desktop\projeto-posse\supabase\plano-mensal-migration.sql).
4. Em `Authentication > Users`, crie pelo menos:
   - 1 usuario mentor
   - os usuarios mentorados
5. Ajuste o role do mentor em `public.profiles`.
6. Revise [config.js](C:\Users\lnduarte\Desktop\projeto-posse\app\config.js) e confirme:
   - `supabaseUrl`
   - `supabaseAnonKey`

## Como definir o mentor

```sql
update public.profiles
set role = 'mentor'
where email = 'mentor@projetoposse.com.br';
```

## Fluxo atual de materiais e PDF

- O front atual nao faz upload de arquivo pela interface.
- O admin cadastra:
  - `URL externa`, quando o material ou PDF ja esta hospedado;
  - ou `storage path`, quando o arquivo ja foi enviado ao bucket `materiais`.
- Para `pdf_path` e `file_path`, o bucket precisa existir como `materiais` e as policies do schema precisam estar aplicadas.

## Teste minimo em producao

1. Abra `/app/login.html`.
2. Faça login com um mentorado.
3. Confirme acesso a:
   - `/app/mentorado.html`
   - `/app/materials.html`
   - `/app/plano.html`
   - `/app/simulados.html`
   - `/app/evolucao.html`
4. Marque uma meta como concluida em `/app/plano.html`.
5. Faça login com um mentor.
6. Confirme acesso a `/app/admin.html`.
7. No admin, teste criar:
   - 1 concurso
   - 1 material por URL
   - 1 plano mensal
   - 1 meta do plano
   - 1 simulado

## Revisao de seguranca

- O front nunca decide permissao por `user_metadata`.
- O role valido e `public.profiles.role`.
- Mentorados leem apenas o proprio perfil, seus logs e materiais permitidos por concurso ou por vinculo individual.
- Mentores administram concursos, materiais, planos e simulados via RLS.
- `profiles` nao pode ser atualizado por mentorados.
- O bucket `materiais` e privado e depende do registro correspondente em `public.materiais`.

## Riscos residuais

- Criacao de usuarios no Auth nao deve ser feita pelo front com anon key.
- Upload direto de arquivos no painel admin ainda nao existe nesta versao.
- Se `profiles.role` ficar incorreto no banco, o redirecionamento tambem fica incorreto.

## Proximo passo recomendado

Se quiser fechar o fluxo administrativo inteiro dentro do painel, o passo seguro e adicionar:

- upload de arquivo com interface do mentor;
- criacao de usuarios por convite;
- Edge Function ou backend proprio para operacoes administrativas no Auth.
