# Mercado Pago: webhook e persistencia

## 1. Rode o SQL no Supabase
Abra o SQL Editor do Supabase e execute o arquivo:

- `supabase/mercado-pago-checkout.sql`

Esse script cria:

- `public.checkout_orders`
- `public.checkout_webhook_events`

## 2. Crie estas variaveis na Netlify
No site do Projeto Posse em `Project configuration > Environment variables`, adicione:

- `MERCADO_PAGO_WEBHOOK_URL=https://projetoposse.com.br/.netlify/functions/mercadopago-webhook`
- `MERCADO_PAGO_WEBHOOK_SECRET=COLE_A_CHAVE_SECRETA_DO_WEBHOOK`
- `SUPABASE_URL=https://kytayhfeorixstzwiebv.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=COLE_A_SERVICE_ROLE_KEY_DO_SUPABASE`

Observacoes:

- `SUPABASE_SERVICE_ROLE_KEY` nunca vai para o navegador nem para `app/config.js`.
- Depois de salvar as variaveis, faca um novo deploy da Netlify.

## 3. Configure o webhook no painel do Mercado Pago
No Mercado Pago Developers:

1. Abra a aplicacao `Projeto Posse`
2. Va em `Webhooks`
3. Crie uma notificacao para o topico `payment`
4. Use esta URL:
   - `https://projetoposse.com.br/.netlify/functions/mercadopago-webhook`
5. Salve e copie a `assinatura secreta`
6. Cole essa assinatura na variavel `MERCADO_PAGO_WEBHOOK_SECRET` na Netlify

## 4. O que o webhook faz
A funcao `netlify/functions/mercadopago-webhook.js`:

- valida `x-signature` e `x-request-id`
- consulta o pagamento real na API do Mercado Pago
- grava o evento em `checkout_webhook_events`
- faz upsert do pedido em `checkout_orders`

## 5. Teste recomendado
1. Gere um checkout de teste no site
2. Conclua um pagamento de teste no Mercado Pago
3. Veja se a pagina de retorno abre normalmente
4. No Supabase, confira se entrou linha em `checkout_orders`
5. Confira tambem a tabela `checkout_webhook_events`

## 6. Importante sobre testes
Em testes, a confirmacao mais confiavel continua sendo:

- pagina de retorno + consulta via backend
- validacao do evento no webhook quando o Mercado Pago enviar a notificacao

Se o pagamento aparecer no Checkout Pro mas nada entrar no Supabase, normalmente o problema esta em um destes pontos:

- webhook nao cadastrado no painel do Mercado Pago
- `MERCADO_PAGO_WEBHOOK_SECRET` errado
- `SUPABASE_SERVICE_ROLE_KEY` ausente ou invalida
- SQL ainda nao executado no Supabase