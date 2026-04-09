const { createHmac, timingSafeEqual } = require("crypto");

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

function getHeader(event, name) {
  const headers = event.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function sanitizeText(value, maxLength) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function sanitizeResourceId(value) {
  return String(value || "").trim().slice(0, 80);
}

function sanitizeNotificationId(value) {
  return String(value || "").replace(/\D+/g, "").slice(0, 30);
}

function parseSignatureHeader(header) {
  return String(header || "")
    .split(",")
    .map((part) => part.trim())
    .reduce((accumulator, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return accumulator;
      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (key) accumulator[key] = value;
      return accumulator;
    }, {});
}

function extractTopic(event, payload) {
  const query = event.queryStringParameters || {};
  return sanitizeText(query.topic || query.type || payload.topic || payload.type, 40).toLowerCase();
}

function extractDataId(event, payload) {
  const query = event.queryStringParameters || {};
  return sanitizeResourceId(
    query["data.id"] ||
    query.data_id ||
    query["data[id]"] ||
    (payload && payload.data && payload.data.id) ||
    payload.resource ||
    ""
  );
}

function buildSignatureManifest(dataId, requestId, timestamp) {
  return `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${timestamp};`;
}

function validateSignature(event, secret, dataId) {
  const signatureHeader = getHeader(event, "x-signature");
  const requestId = sanitizeText(getHeader(event, "x-request-id"), 120);
  const signatureParts = parseSignatureHeader(signatureHeader);
  const timestamp = signatureParts.ts || "";
  const receivedHash = (signatureParts.v1 || "").toLowerCase();

  if (!secret) {
    throw new Error("MERCADO_PAGO_WEBHOOK_SECRET nao configurado.");
  }
  if (!dataId) {
    throw new Error("A notificacao nao informou data.id.");
  }
  if (!requestId || !timestamp || !receivedHash) {
    throw new Error("Cabecalhos de assinatura ausentes ou invalidos.");
  }

  const manifest = buildSignatureManifest(dataId, requestId, timestamp);
  const generatedHash = createHmac("sha256", secret).update(manifest).digest("hex");
  const receivedBuffer = Buffer.from(receivedHash, "hex");
  const generatedBuffer = Buffer.from(generatedHash, "hex");

  if (
    !receivedBuffer.length ||
    receivedBuffer.length !== generatedBuffer.length ||
    !timingSafeEqual(receivedBuffer, generatedBuffer)
  ) {
    throw new Error("Assinatura do webhook invalida.");
  }
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

function buildSupabaseHeaders(serviceRoleKey, prefer) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function upsertSupabaseRow({ supabaseUrl, serviceRoleKey, table, onConflict, row }) {
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildSupabaseHeaders(serviceRoleKey, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify([row]),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Falha ao salvar ${table} no Supabase.`);
    error.statusCode = response.status;
    error.details = errorText;
    throw error;
  }
}

function buildWebhookEventRow(payload, topic, resourceId, payment) {
  return {
    notification_id: payload.id || null,
    topic,
    action: payload.action || null,
    resource_id: resourceId || null,
    payment_id: payment && payment.id ? String(payment.id) : null,
    external_reference: payment && payment.external_reference ? payment.external_reference : null,
    payload,
  };
}

function buildCheckoutOrderRow(payload, payment) {
  const metadata = payment.metadata || {};
  const payer = payment.payer || {};
  const fallbackReference = payment.external_reference || `mp-payment-${payment.id}`;

  return {
    external_reference: fallbackReference,
    plan_code: metadata.plan_code || null,
    plan_title: metadata.plan_title || payment.description || null,
    customer_name: metadata.customer_name || null,
    customer_email: metadata.customer_email || payer.email || null,
    customer_phone: metadata.customer_phone || null,
    concurso_target: metadata.concurso_target || null,
    amount: payment.transaction_amount || null,
    currency: payment.currency_id || "BRL",
    status: payment.status || "pending",
    status_detail: payment.status_detail || null,
    payment_id: payment.id ? String(payment.id) : null,
    payment_type: payment.payment_type_id || null,
    payment_method: payment.payment_method_id || null,
    installments: payment.installments || null,
    payer_email: payer.email || null,
    approved_at: payment.date_approved || null,
    last_event_action: payload.action || null,
    last_notification_id: payload.id || null,
    raw_payment: payment,
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!accessToken) {
    return json(500, { error: "MERCADO_PAGO_ACCESS_TOKEN nao configurado." });
  }
  if (!webhookSecret) {
    return json(500, { error: "MERCADO_PAGO_WEBHOOK_SECRET nao configurado." });
  }
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return json(500, { error: "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configurados." });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return json(400, { error: "Corpo da notificacao invalido." });
  }

  const topic = extractTopic(event, payload);
  const dataId = extractDataId(event, payload);

  try {
    validateSignature(event, webhookSecret, dataId);
  } catch (error) {
    return json(401, { error: error.message });
  }

  if (topic && topic !== "payment") {
    return json(200, { received: true, ignored: true, topic });
  }

  if (!dataId) {
    return json(400, { error: "Notificacao sem data.id para consulta do pagamento." });
  }

  try {
    const payment = await requestMercadoPago(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, accessToken);
    const eventRow = buildWebhookEventRow(payload, topic || "payment", dataId, payment);
    const orderRow = buildCheckoutOrderRow(payload, payment);

    if (eventRow.notification_id) {
      await upsertSupabaseRow({
        supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
        table: "checkout_webhook_events",
        onConflict: "notification_id",
        row: eventRow,
      });
    }

    await upsertSupabaseRow({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      table: "checkout_orders",
      onConflict: "external_reference",
      row: orderRow,
    });

    return json(200, {
      received: true,
      topic: topic || "payment",
      paymentId: payment.id,
      status: payment.status,
      externalReference: payment.external_reference || null,
    });
  } catch (error) {
    return json(error.statusCode || 500, {
      error: error.message || "Nao foi possivel processar o webhook.",
      details: error.details || null,
    });
  }
};