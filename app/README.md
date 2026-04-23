# Projeto Posse - Area do Mentorado

Esta pasta contem a area autenticada do Projeto Posse, feita para rodar em hospedagem estatica e consumir o Supabase diretamente no front-end.

## Estrutura

- `login.html`: autenticação via Supabase Auth
- `mentorado.html`: dashboard principal do mentorado
- `metodos-de-estudo.html`: seção premium de métodos de estudo do aluno
- `metodos-de-estudo-revisao-semanal.html`: módulo de revisão semanal com OneNote, favoritas e erros relevantes
- `materials.html`: materiais gerais do concurso e materiais especificos do usuario
- `plano.html`: plano de estudos ativo com checklist
- `simulados.html`: resultados de simulados por usuario
- `evolucao.html`: weekly stats e pomodoro
- `admin.html`: painel administrativo do mentor
- `styles.css`: identidade visual da area autenticada
- `supabase.js`: cliente e utilitarios do Supabase
- `app.js`: regras de autenticacao, carregamento e CRUD do front-end
- `config.js`: URL e anon key do Supabase

## Configuracao do Supabase

1. Crie um projeto no Supabase.
2. Abra o SQL Editor e rode o arquivo [schema.sql](C:/Users/lnduarte/Desktop/projeto-posse/supabase/schema.sql).
3. Em `Authentication > Users`, crie pelo menos:
   - 1 usuario mentor
   - 2 usuarios mentorados
4. No SQL Editor, rode o bloco de seeds no final do `schema.sql`, ajustando os e-mails para bater com os usuarios criados no Auth.
5. Edite `app/config.js` e substitua:
   - `supabaseUrl`
   - `supabaseAnonKey`

Observacao:
- a `anon key` do Supabase pode ficar no front-end e no repositório
- a `service_role key` nunca deve ir para o front-end nem para o Git

## Storage

O schema cria o bucket `materiais` como privado e aplica politicas de acesso.

Fluxo atual:
- esta versao nao faz upload direto pela interface admin
- se o arquivo estiver no bucket `materiais`, informe o caminho em `file_path`
- se o material estiver hospedado fora, informe `externo_url`
- mentorados recebem URL assinada ao abrir a lista de materiais

Para plano mensal:

- use `pdf_url` quando o PDF estiver hospedado externamente
- use `pdf_path` quando o PDF ja estiver no bucket `materiais`

## Auth e redirecionamento

- nao autenticado -> `login.html`
- autenticado com `role = mentor` -> `admin.html`
- autenticado com `role = mentorado` -> `mentorado.html`

## Git + Netlify

Fluxo recomendado para manutencao continua:

1. Crie um repositório GitHub para este projeto.
2. Comite:
   - raiz do projeto
   - pasta `/app`
   - pasta `/supabase`
   - `netlify.toml`
3. Preencha `app/config.js` com a URL e a anon key reais do Supabase.
4. Envie para a branch principal, por exemplo `main`.
5. Na Netlify:
   - `Add new site`
   - `Import an existing project`
   - `GitHub`
   - selecione o repositório
6. Use estas configs:
   - `Build command`: vazio
   - `Publish directory`: `.`

Depois disso, cada `git push` na branch conectada gera um novo deploy automatico.

## Publicacao

Como o projeto e estatico, voce pode publicar em qualquer host de arquivos estaticos:

- Hostinger
- cPanel
- Vercel em modo static
- Netlify
- Cloudflare Pages

Passos:

1. Garanta que `index.html` fique na raiz publicada.
2. Garanta que os arquivos dentro de `/app` sejam publicados sem alteracao de caminho.
3. Depois da publicacao, teste:
   - `https://projetoposse.com.br`
   - `https://projetoposse.com.br/app/login.html`
   - `https://projetoposse.com.br/app/mentorado.html`
   - `https://projetoposse.com.br/app/admin.html`
   - `https://projetoposse.com.br/app/login`
   - `https://projetoposse.com.br/app/mentorado`

## Demo local

Para validar layout e navegacao sem Supabase, use:

- `painel.html`

Credenciais demo:

- login: `demo`
- senha: `demo`

## Observacao importante sobre cadastro de usuarios

O painel admin implementado aqui gerencia perfis, vinculos, materiais, planos e simulados.

Criar usuarios novos diretamente em `auth.users` com senha definida por um mentor nao e seguro do lado do cliente usando apenas anon key. Para manter a base segura, o fluxo recomendado nesta versao e:

- criar usuario pelo painel do Supabase Auth
- ou permitir auto-cadastro / convite em etapa futura via Edge Function segura

Ou seja: a parte de gestao academica ja esta no painel; a criacao segura de contas pelo mentor pode ser a proxima evolucao.

## Status atual do admin

O painel admin atual permite:

- ajustar mentorado existente
- criar concurso
- criar material por URL ou por `storage path`
- criar plano mensal
- criar meta de plano
- criar simulado

O painel admin atual ainda nao permite:

- criar usuario no Auth
- enviar convite
- fazer upload de arquivo direto pela interface
