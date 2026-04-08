const { randomUUID } = require("crypto");

const PLAN_CATALOG = {
  preparacao_metas: {
    code: "preparacao_metas",
    title: "Preparacao com Metas",
    description: "Encontro inicial e direcionamento de estudos",
    amount: 249.0,
  },
  mentoria_individual: {
    code: "mentoria_individual",
    title: "Mentoria Individual",
    description: "Sessoes individuais on-line com acompanhamento personalizado",
    amount: 749.0,
  },
};

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

function sanitizeText(value, maxLength) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function sanitizePhone(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (digits.startsWith("55") && digits.length > 11) {
    return digits.slice(2, 13);
  }
  return digits.slice(0, 11);
}

function splitName(fullName) {
  const parts = fullName.split(" ").filter(Boolean);
  if (parts.length <= 1) {
    return { firstName: fullName, lastName: "" };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildAbsoluteUrl(explicitUrl, fallbackUrl) {
  const value = sanitizeText(explicitUrl || fallbackUrl, 240);
  if (!value || !/^https:\/\//i.test(value)) {
    return "";
  }
  return value;
}

function buildPayer(customerName, customerEmail, customerPhone) {
  const payer = {};
  const { firstName, lastName } = splitName(customerName);
  if (firstName) payer.name = firstName;
  if (lastName) payer.surname = lastName;
  if (customerEmail) payer.email = customerEmail;
  if (customerPhone.length >= 10) {
    payer.phone = {
      area_code: customerPhone.slice(0, 2),
      number: customerPhone.slice(2),
    };
  }
  return Object.keys(payer).length ? payer : undefined;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return json(400, { error: "Corpo da requisicao invalido." });
  }

  const plan = PLAN_CATALOG[payload.planCode];
  if (!plan) {
    return json(400, { error: "Plano invalido para checkout." });
  }

  const customerName = sanitizeText(payload.customerName, 120);
  const customerEmail = sanitizeText(payload.customerEmail, 160).toLowerCase();
  const customerPhone = sanitizePhone(payload.customerPhone);
  const concursoTarget = sanitizeText(payload.concursoTarget, 160);

  if (customerName.length < 3) {
    return json(400, { error: "Informe seu nome completo." });
  }

  if (customerPhone.length < 10) {
    return json(400, { error: "Informe um WhatsApp valido com DDD." });
  }

  if (customerEmail && !isValidEmail(customerEmail)) {
    return json(400, { error: "Informe um e-mail valido." });
  }

  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!accessToken) {
    return json(500, { error: "MERCADO_PAGO_ACCESS_TOKEN nao configurado." });
  }

  const appBaseUrl = sanitizeText(process.env.APP_BASE_URL, 240).replace(/\/$/, "");
  const successUrl = buildAbsoluteUrl(process.env.MERCADO_PAGO_SUCCESS_URL, appBaseUrl ? `${appBaseUrl}/pagamento-sucesso.html` : "");
  const pendingUrl = buildAbsoluteUrl(process.env.MERCADO_PAGO_PENDING_URL, appBaseUrl ? `${appBaseUrl}/pagamento-pendente.html` : "");
  const failureUrl = buildAbsoluteUrl(process.env.MERCADO_PAGO_FAILURE_URL, appBaseUrl ? `${appBaseUrl}/pagamento-falhou.html` : "");
  const notificationUrl = buildAbsoluteUrl(process.env.MERCADO_PAGO_WEBHOOK_URL, "");

  if (!successUrl || !pendingUrl || !failureUrl) {
    return json(500, { error: "As URLs de retorno do Mercado Pago nao estao configuradas corretamente." });
  }

  const externalReference = `pp-${plan.code}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const preferenceBody = {
    items: [
      {
        id: plan.code,
        title: plan.title,
        description: plan.description,
        quantity: 1,
        currency_id: "BRL",
        unit_price: plan.amount,
      },
    ],
    back_urls: {
      success: successUrl,
      pending: pendingUrl,
      failure: failureUrl,
    },
    auto_return: "approved",
    external_reference: externalReference,
    metadata: {
      source: "site",
      plan_code: plan.code,
      plan_title: plan.title,
      customer_name: customerName,
      customer_email: customerEmail || null,
      customer_phone: customerPhone,
      concurso_target: concursoTarget || null,
    },
  };

  const payer = buildPayer(customerName, customerEmail, customerPhone);
  if (payer) {
    preferenceBody.payer = payer;
  }

  if (notificationUrl) {
    preferenceBody.notification_url = notificationUrl;
  }

  try {
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify(preferenceBody),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return json(response.status, {
        error: data.message || data.error || "Nao foi possivel criar a preferencia de pagamento.",
        details: data.cause || null,
      });
    }

    const initPoint = accessToken.startsWith("TEST-") && data.sandbox_init_point
      ? data.sandbox_init_point
      : (data.init_point || data.sandbox_init_point || "");

    if (!initPoint) {
      return json(502, { error: "O Mercado Pago nao retornou um link de checkout valido." });
    }

    return json(200, {
      initPoint,
      preferenceId: data.id,
      externalReference,
      plan: {
        code: plan.code,
        title: plan.title,
        amount: plan.amount,
      },
    });
  } catch (error) {
    return json(502, {
      error: "Falha ao comunicar com o Mercado Pago.",
      details: error.message,
    });
  }
};