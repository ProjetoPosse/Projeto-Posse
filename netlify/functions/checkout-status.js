function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function sanitizeId(value) {
  return String(value || "").replace(/\D+/g, "").slice(0, 30);
}

function sanitizeReference(value) {
  return String(value || "").trim().slice(0, 120);
}

async function requestMercadoPago(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || "Erro ao consultar o Mercado Pago.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function normalizePayment(payment) {
  return {
    id: payment.id,
    status: payment.status || null,
    statusDetail: payment.status_detail || null,
    amount: payment.transaction_amount || null,
    currency: payment.currency_id || null,
    paymentType: payment.payment_type_id || null,
    paymentMethod: payment.payment_method_id || null,
    installments: payment.installments || null,
    externalReference: payment.external_reference || null,
    planCode: payment.metadata && payment.metadata.plan_code ? payment.metadata.plan_code : null,
    planTitle: payment.metadata && payment.metadata.plan_title ? payment.metadata.plan_title : (payment.description || null),
    payerEmail: payment.payer && payment.payer.email ? payment.payer.email : null,
    dateCreated: payment.date_created || null,
    dateApproved: payment.date_approved || null,
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!accessToken) {
    return json(500, { error: "MERCADO_PAGO_ACCESS_TOKEN nao configurado." });
  }

  const query = event.queryStringParameters || {};
  const paymentId = sanitizeId(query.payment_id || query.collection_id);
  const externalReference = sanitizeReference(query.external_reference);

  if (!paymentId && !externalReference) {
    return json(400, { error: "Informe payment_id, collection_id ou external_reference." });
  }

  try {
    let payment;

    if (paymentId) {
      payment = await requestMercadoPago(`https://api.mercadopago.com/v1/payments/${paymentId}`, accessToken);
    } else {
      const searchUrl = `https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(externalReference)}`;
      const searchResult = await requestMercadoPago(searchUrl, accessToken);
      const latestPayment = Array.isArray(searchResult.results) && searchResult.results.length ? searchResult.results[0] : null;
      if (!latestPayment || !latestPayment.id) {
        return json(404, { error: "Pagamento nao encontrado para essa referencia." });
      }
      payment = await requestMercadoPago(`https://api.mercadopago.com/v1/payments/${latestPayment.id}`, accessToken);
    }

    return json(200, { payment: normalizePayment(payment) });
  } catch (error) {
    return json(error.statusCode || 502, {
      error: error.message || "Nao foi possivel consultar o pagamento.",
      details: error.details || null,
    });
  }
};