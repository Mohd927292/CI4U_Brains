const baseUrl = (process.env.CI4U_SMOKE_API_BASE_URL ?? "http://127.0.0.1:4000/v1").replace(/\/$/, "");
const phoneSuffix = String(Date.now()).slice(-7);

const headers = {
  "content-type": "application/json",
  "x-ci4u-data-scope": "development",
  "x-ci4u-dev-user-id": "dev-smoke",
  "x-ci4u-dev-user-name": "Smoke Tester",
  "x-ci4u-dev-role": "FOUNDER",
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

async function request(method, path, body, auth = true) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: auth ? headers : { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(`${response.status} ${text}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function expectFailure(fn, expectedText) {
  try {
    await fn();
    throw new Error(`Expected failure containing "${expectedText}".`);
  } catch (error) {
    const text = `${error.status ?? ""} ${JSON.stringify(error.payload ?? {})} ${error.message}`;
    if (!text.includes(expectedText)) {
      throw error;
    }
  }
}

async function createLead(name, lastDigit) {
  const response = await request("POST", "/leads/manual", {
    businessName: name,
    phone: `98${phoneSuffix}${lastDigit}`,
    source: "SMOKE",
  });
  assert(response.outcome === "created", `${name} should create a new raw lead`);
  return response.lead;
}

async function saveOutcome(leadId, body) {
  return request("POST", `/leads/${leadId}/call-outcome`, body);
}

async function saveOutcomeAck(leadId, body) {
  return request("POST", `/leads/${leadId}/call-outcome/ack`, body);
}

const now = new Date();
const inMs = (milliseconds) => new Date(now.getTime() + milliseconds).toISOString();

await request("GET", "/health", undefined, false);
await expectFailure(() => request("GET", "/leads/counts", undefined, false), "DEV_DATA_SCOPE_REQUIRED");

const warmLead = await createLead("Smoke Warm", 1);
const warm = await saveOutcomeAck(warmLead.id, {
  callOutcome: "SPOKE",
  conversationSummary: "Customer asked to reconnect next month.",
  leadIntent: "WARM",
});
assert(warm.currentStage === "WARM", "warm lead moves to WARM");
assert(warm.followUpReason === "NURTURE", "warm lead uses NURTURE");
assert(Boolean(warm.nextFollowUpAt), "warm lead gets default follow-up");
assert(warm.serverConfirmed === true, "fast save ack confirms durable server write");

const quotationLead = await createLead("Smoke Quotation", 2);
const quotation = await saveOutcome(quotationLead.id, {
  callOutcome: "SPOKE",
  conversationSummary: "Customer needs an installation quotation.",
  leadIntent: "INSTALLATION",
  followUpReason: "QUOTATION",
  followUpAt: inMs(24 * 60 * 60 * 1000),
  quotation: {
    title: "Smoke CCTV Quote",
    packages: [
      {
        packageName: "Basic CCTV",
        multiplier: 2,
        items: [
          { itemName: "CCTV A", unitPriceRs: 1200, quantity: 1 },
          { itemName: "SMPS", unitPriceRs: 1300, quantity: 1 },
        ],
      },
    ],
  },
});
assert(quotation.currentStage === "HOT_INSTALLATION", "quotation lead becomes hot installation");
assert(quotation.latestQuotation.totalPricePaise === 500000, "quotation total is stored in paise");

const wonLead = await createLead("Smoke Won", 3);
await expectFailure(
  () =>
    saveOutcome(wonLead.id, {
      callOutcome: "SPOKE",
      conversationSummary: "Customer wants to finalize.",
      leadIntent: "INSTALLATION",
      followUpReason: "WON",
    }),
  "Won customer details",
);
const won = await saveOutcome(wonLead.id, {
  callOutcome: "SPOKE",
  conversationSummary: "Customer accepted the installation.",
  leadIntent: "INSTALLATION",
  followUpReason: "WON",
  wonDetails: {
    siteContactNumber: wonLead.phoneNormalized ?? `98${phoneSuffix}3`,
    useCustomerPhoneAsSiteContact: true,
    address: "Smoke test address",
    scopeOfWork: "Install cameras and configure mobile view.",
    scheduleStatus: "NOT_SCHEDULED",
    quotedPriceRs: 25000,
    acceptedPriceRs: 23000,
    advancePaymentRs: 5000,
  },
});
assert(won.currentStage === "CAPTURED_WON", "won lead moves to Won Leads");
assert(won.wonDetails.acceptedPricePaise === 2300000, "won accepted price stored in paise");

const counts = await request("GET", "/leads/counts");
console.log(
  JSON.stringify(
    {
      status: "ok",
      baseUrl,
      checked: ["health", "dev auth isolation", "raw create", "warm", "quotation", "won details"],
      counts,
    },
    null,
    2,
  ),
);
