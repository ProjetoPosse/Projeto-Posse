(function () {
  const stateMeta = {
    success: {
      title: 'Conferindo seu pagamento',
      message: 'Estamos consultando o Mercado Pago para confirmar os dados do pagamento.',
    },
    pending: {
      title: 'Aguardando confirmacao',
      message: 'O pagamento ainda esta em processamento ou aguardando compensacao.',
    },
    failure: {
      title: 'Nao identificamos aprovacao',
      message: 'Voce pode revisar o pagamento e tentar novamente quando quiser.',
    },
  };

  const visualMeta = {
    success: {
      badgeClass: 'is-success',
      icon: 'OK',
      title: 'Pagamento confirmado',
      message: 'O Mercado Pago confirmou o pagamento. Vamos entrar em contato no WhatsApp informado para iniciar o atendimento.',
      helper: 'Se quiser agilizar, voce tambem pode nos chamar pelo WhatsApp com o comprovante em maos.',
    },
    pending: {
      badgeClass: 'is-pending',
      icon: '...',
      title: 'Pagamento em analise ou pendente',
      message: 'O pagamento ainda nao foi finalizado pelo Mercado Pago. Pix costuma ser confirmado rapidamente; boleto pode levar mais tempo.',
      helper: 'Se voce gerou um boleto, aguarde a compensacao. Se pagou por Pix e o status nao mudou, atualize esta pagina em alguns instantes.',
    },
    failure: {
      badgeClass: 'is-failure',
      icon: '!',
      title: 'Pagamento nao aprovado',
      message: 'Nao houve aprovacao do pagamento ate agora. Voce pode tentar novamente ou pedir suporte para o time do Projeto Posse.',
      helper: 'Se a tentativa falhou por limite do cartao ou expiracao, basta iniciar um novo checkout.',
    },
  };

  const paymentState = document.body.dataset.paymentState || 'success';
  const query = new URLSearchParams(window.location.search);
  const paymentId = query.get('payment_id') || query.get('collection_id') || '';
  const externalReference = query.get('external_reference') || '';
  const reportedStatus = query.get('status') || query.get('collection_status') || '';

  const badgeEl = document.getElementById('paymentBadge');
  const titleEl = document.getElementById('paymentTitle');
  const messageEl = document.getElementById('paymentMessage');
  const helperEl = document.getElementById('paymentHelper');
  const iconEl = document.getElementById('paymentIcon');
  const detailsEl = document.getElementById('paymentDetails');

  function setVisual(state, customTitle, customMessage, customHelper) {
    const meta = visualMeta[state] || visualMeta.success;
    badgeEl.className = 'status-badge ' + meta.badgeClass;
    badgeEl.textContent = customTitle || meta.title;
    titleEl.textContent = customTitle || meta.title;
    messageEl.textContent = customMessage || meta.message;
    helperEl.textContent = customHelper || meta.helper;
    iconEl.textContent = meta.icon;
    document.body.dataset.visualState = state;
  }

  function clearDetails() {
    while (detailsEl.firstChild) {
      detailsEl.removeChild(detailsEl.firstChild);
    }
  }

  function appendDetail(label, value) {
    if (!value) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'detail-item';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    wrapper.appendChild(dt);
    wrapper.appendChild(dd);
    detailsEl.appendChild(wrapper);
  }

  function formatAmount(amount, currency) {
    if (typeof amount !== 'number') return '';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'BRL',
    }).format(amount);
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  }

  function labelForPaymentType(value) {
    const labels = {
      credit_card: 'Cartao de credito',
      debit_card: 'Cartao de debito',
      ticket: 'Boleto',
      bank_transfer: 'Transferencia bancaria',
      account_money: 'Saldo Mercado Pago',
      pix: 'Pix',
    };
    return labels[value] || value || '';
  }

  function mapStatusToVisual(status) {
    if (status === 'approved') return 'success';
    if (status === 'pending' || status === 'in_process' || status === 'in_mediation' || status === 'authorized') return 'pending';
    if (status === 'rejected' || status === 'cancelled' || status === 'refunded' || status === 'charged_back') return 'failure';
    return paymentState === 'failure' ? 'failure' : (paymentState === 'pending' ? 'pending' : 'success');
  }

  function renderPayment(payment) {
    clearDetails();
    const visualState = mapStatusToVisual(payment.status);
    setVisual(visualState);

    appendDetail('Plano', payment.planTitle);
    appendDetail('Valor', formatAmount(payment.amount, payment.currency));
    appendDetail('Forma de pagamento', labelForPaymentType(payment.paymentType || payment.paymentMethod));
    appendDetail('Status', payment.status);
    appendDetail('Detalhe', payment.statusDetail);
    appendDetail('Pagamento', payment.id ? String(payment.id) : '');
    appendDetail('Referencia', payment.externalReference);
    appendDetail('Aprovado em', formatDate(payment.dateApproved));
    appendDetail('Criado em', formatDate(payment.dateCreated));
    appendDetail('Parcelas', payment.installments ? String(payment.installments) : '');
  }

  function renderFallback() {
    clearDetails();
    const fallback = stateMeta[paymentState] || stateMeta.success;
    setVisual(paymentState, fallback.title, fallback.message, 'Se o status nao atualizar automaticamente, volte ao site e tente novamente em alguns instantes.');

    if (reportedStatus) appendDetail('Status informado na URL', reportedStatus);
    if (paymentId) appendDetail('Pagamento', paymentId);
    if (externalReference) appendDetail('Referencia', externalReference);
  }

  async function verifyPayment() {
    if (!paymentId && !externalReference) {
      renderFallback();
      return;
    }

    try {
      const search = new URLSearchParams();
      if (paymentId) search.set('payment_id', paymentId);
      if (externalReference) search.set('external_reference', externalReference);

      const response = await fetch('/.netlify/functions/checkout-status?' + search.toString(), {
        headers: {
          Accept: 'application/json',
        },
      });

      const data = await response.json().catch(function () { return {}; });
      if (!response.ok || !data.payment) {
        throw new Error(data.error || 'Nao foi possivel confirmar o pagamento agora.');
      }

      renderPayment(data.payment);
    } catch (error) {
      renderFallback();
      helperEl.textContent = error.message || 'Nao foi possivel confirmar o pagamento agora. Tente novamente em alguns instantes.';
    }
  }

  renderFallback();
  verifyPayment();
})();