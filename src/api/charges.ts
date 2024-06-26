import Stripe from "stripe";
import { RestError } from "./RestError";
import { applyListOptions, generateId, stringifyMetadata } from "./utils";
import {
  getEffectiveSourceTokenFromChain,
  isSourceTokenChain,
} from "./sourceTokenChains";
import { cards } from "./cards";
import { AccountData } from "./AccountData";
import { customers } from "./customers";
import { disputes } from "./disputes";
import { refunds } from "./refunds";
import { verify } from "./verify";
import log = require("loglevel");

function assertAddressIsAddress(
  val: unknown
): asserts val is Stripe.AddressParam {
  if ((val as Stripe.AddressParam).line1 === undefined) {
    throw new Error("Address missing Line1");
  }

  return;
}

export namespace charges {
  const accountCharges = new AccountData<Stripe.Charge>();

  const minChargeAmount: { [code: string]: number } = {
    usd: 50,
    aud: 50,
    brl: 50,
    cad: 50,
    chf: 50,
    dkk: 250,
    eur: 50,
    hkd: 400,
    jpy: 50,
    mxn: 10,
    nok: 300,
    nzd: 50,
    sek: 300,
    sgd: 50,
  };

  const bigBrandToSmallBrandMap: { [brand: string]: string } = {
    Visa: "visa",
    "American Express": "amex",
    MasterCard: "mastercard",
    Discover: "discover",
    JCB: "jcb",
    "Diners Club": "diners",
    Unknown: "unknown",
  };

  export function create(
    accountId: string,
    params: Stripe.ChargeCreateParams
  ): Stripe.Charge {
    log.debug("charges.create", accountId, params);

    handlePrechargeSpecialTokens(params.source);
    verify.requiredParams(params, ["amount", "currency"]);
    if (params.amount < 1) {
      throw new RestError(400, {
        code: "parameter_invalid_integer",
        doc_url:
          "https://stripe.com/docs/error-codes/parameter-invalid-integer",
        message: "Invalid positive integer",
        param: "amount",
        type: "invalid_request_error",
      });
    }
    if (params.amount > 99999999) {
      throw new RestError(400, {
        code: "amount_too_large",
        doc_url: "https://stripe.com/docs/error-codes/amount-too-large",
        message: "Amount must be no more than $999,999.99",
        param: "amount",
        type: "invalid_request_error",
      });
    }
    verify.currency(params.currency.toLowerCase(), "currency");
    if (
      minChargeAmount[params.currency.toLowerCase()] &&
      +params.amount < minChargeAmount[params.currency.toLowerCase()]
    ) {
      throw new RestError(400, {
        code: "amount_too_small",
        doc_url: "https://stripe.com/docs/error-codes/amount-too-small",
        message: "Amount must be at least 50 cents",
        param: "amount",
        type: "invalid_request_error",
      });
    }

    let charge: Stripe.Charge;
    if (typeof params.customer === "string") {
      const customer = customers.retrieve(
        accountId,
        params.customer,
        "customer"
      );
      let cardId: string;

      if (params.source) {
        const source = customer.sources.data.find(
          (s) => s.id === params.source
        );
        if (!source) {
          throw new RestError(404, {
            code: "missing",
            doc_url: "https://stripe.com/docs/error-codes/missing",
            message: `Customer ${customer.id} does not have a linked source with ID ${params.source}.`,
            param: "source",
            type: "invalid_request_error",
          });
        }
        cardId = source.id;
      } else if (customer.default_source) {
        cardId = customer.default_source as string;
      } else {
        throw new RestError(404, {
          code: "missing",
          doc_url: "https://stripe.com/docs/error-codes/missing",
          message: "Cannot charge a customer that has no active card",
          param: "card",
          type: "card_error",
        });
      }

      const card = customers.retrieveCard(
        accountId,
        customer.id,
        cardId,
        "card"
      );
      const cardExtra = cards.getCardExtra(card.id);
      charge = getChargeFromCard(params, card);
      accountCharges.put(accountId, charge);
      handleSpecialChargeTokens(accountId, charge, cardExtra.sourceToken);
    } else if (typeof params.source === "string") {
      let sourceToken = params.source;
      if (isSourceTokenChain(sourceToken)) {
        sourceToken = getEffectiveSourceTokenFromChain(sourceToken);
      }

      handlePrechargeSpecialTokens(sourceToken);

      const card = cards.createFromSource(sourceToken);
      charge = getChargeFromCard(params, card);
      if (params.source !== "tok_forget") {
        accountCharges.put(accountId, charge);
      }
      handleSpecialChargeTokens(accountId, charge, sourceToken);
    } else {
      throw new RestError(400, {
        code: "parameter_missing",
        doc_url: "https://stripe.com/docs/error-codes/parameter-missing",
        message: "Must provide source or customer.",
        type: "invalid_request_error",
      });
    }

    return charge;
  }

  export function retrieve(
    accountId: string,
    chargeId: string,
    paramName: string
  ): Stripe.Charge {
    log.debug("charges.retrieve", accountId, chargeId);

    const charge = accountCharges.get(accountId, chargeId);
    if (!charge) {
      throw new RestError(404, {
        code: "resource_missing",
        doc_url: "https://stripe.com/docs/error-codes/resource-missing",
        message: `No such charge: ${chargeId}`,
        param: paramName,
        type: "invalid_request_error",
      });
    }
    return charge;
  }

  export function list(
    accountId: string,
    params: Stripe.ChargeListParams
  ): Stripe.ApiList<Stripe.Charge> {
    log.debug("charges.list", accountId, params);

    let data = accountCharges.getAll(accountId);
    if (params.customer) {
      data = data.filter((d) => d.customer === params.customer);
    }
    return applyListOptions(data, params, (id, paramName) =>
      retrieve(accountId, id, paramName)
    );
  }

  export function update(
    accountId: string,
    chargeId: string,
    params: Stripe.ChargeUpdateParams
  ): Stripe.Charge {
    log.debug("charges.update", accountId, chargeId, params);

    const charge = retrieve(accountId, chargeId, "id");

    if (params.description !== undefined) {
      charge.description = params.description;
    }
    if (params.fraud_details !== undefined) {
      charge.fraud_details = params.fraud_details;
    }
    if (params.metadata !== undefined) {
      charge.metadata = stringifyMetadata(params.metadata);
    }
    if (params.receipt_email !== undefined) {
      charge.receipt_email = params.receipt_email;
    }
    if (params.shipping !== undefined) {
      charge.shipping = getShippingFromParams(params.shipping);
    }

    return charge;
  }

  export function capture(
    accountId: string,
    chargeId: string,
    params: Stripe.ChargeCaptureParams
  ): Stripe.Charge {
    log.debug("charges.capture", accountId, chargeId, params);

    const charge = accountCharges.get(accountId, chargeId);
    if (!charge) {
      throw new RestError(404, {
        code: "resource_missing",
        doc_url: "https://stripe.com/docs/error-codes/resource-missing",
        message: `No such charge: ${chargeId}`,
        param: "charge",
        type: "invalid_request_error",
      });
    }

    if (charge.captured) {
      throw new RestError(400, {
        code: "charge_already_captured",
        doc_url: "https://stripe.com/docs/error-codes/charge-already-captured",
        message:
          "Charge ch_1FAOQz2eZvKYlo2CVwG2N5Kl has already been captured.",
        type: "invalid_request_error",
      });
    }

    const captureAmount = Object.prototype.hasOwnProperty.call(params, "amount")
      ? +params.amount
      : charge.amount;
    if (captureAmount < 1) {
      throw new RestError(400, {
        code: "parameter_invalid_integer",
        doc_url:
          "https://stripe.com/docs/error-codes/parameter-invalid-integer",
        message: "Invalid positive integer",
        param: "amount",
        type: "invalid_request_error",
      });
    }
    if (
      minChargeAmount[charge.currency.toLowerCase()] &&
      +params.amount < minChargeAmount[charge.currency.toLowerCase()]
    ) {
      throw new RestError(400, {
        code: "amount_too_small",
        doc_url: "https://stripe.com/docs/error-codes/amount-too-small",
        message: "Amount must be at least 50 cents",
        type: "invalid_request_error",
      });
    }

    if (captureAmount < charge.amount) {
      charge.captured = true;
      refunds.create(accountId, {
        amount: charge.amount - captureAmount,
        charge: charge.id,
      });
    } else {
      charge.captured = true;
    }
    charge.amount_captured += captureAmount;
    charge.balance_transaction = "txn_" + generateId(24);

    return charge;
  }

  function getChargeFromCard(
    params: Stripe.ChargeCreateParams,
    source: Stripe.Card
  ): Stripe.Charge {
    const chargeId = "ch_" + generateId();
    const captured = (params.capture as any) !== "false";
    return {
      id: chargeId,
      object: "charge",
      amount: +params.amount,
      amount_captured: captured ? +params.amount : 0,
      amount_refunded: 0,
      application: null,
      application_fee: null,
      application_fee_amount: null,
      balance_transaction:
        (params.capture as any as string) !== "false"
          ? "txn_" + generateId(24)
          : null,
      billing_details: {
        address: {
          city: null,
          country: null,
          line1: null,
          line2: null,
          postal_code: null,
          state: null,
        },
        email: null,
        name: null,
        phone: null,
      },
      calculated_statement_descriptor: null,
      captured: captured,
      created: (Date.now() / 1000) | 0,
      currency: params.currency.toLowerCase(),
      customer: null,
      description: params.description || null,
      destination: null,
      dispute: null,
      disputed: false,
      failure_balance_transaction: null,
      failure_code: null,
      failure_message: null,
      fraud_details: {},
      invoice: null,
      livemode: false,
      metadata: stringifyMetadata(params.metadata),
      on_behalf_of: params.on_behalf_of || null,
      order: null,
      outcome: {
        network_status: "approved_by_network",
        reason: null,
        risk_level: "normal",
        risk_score: 5,
        seller_message: "Payment complete.",
        type: "authorized",
      },
      paid: true,
      payment_intent: null,
      payment_method: "card_" + generateId(24),
      payment_method_details: {
        card: {
          brand: bigBrandToSmallBrandMap[source.brand],
          checks: {
            address_line1_check: null,
            address_postal_code_check: null,
            cvc_check: null,
          },
          country: source.country,
          exp_month: source.exp_month,
          exp_year: source.exp_year,
          fingerprint: generateId(16),
          funding: source.funding,
          installments: null,
          last4: source.last4,
          mandate: null,
          network: bigBrandToSmallBrandMap[source.brand],
          three_d_secure: null,
          wallet: null,
        },
        type: "card",
      },
      receipt_email: params.receipt_email || null,
      receipt_number: null,
      receipt_url: `https://pay.stripe.com/receipts/acct_${generateId(
        16
      )}/${chargeId}/rcpt_${generateId(32)}`,
      refunded: false,
      refunds: {
        object: "list",
        data: [],
        has_more: false,
        url: `/v1/charges/${chargeId}/refunds`,
      },
      review: null,
      shipping: getShippingFromParams(params.shipping),
      source: source,
      source_transfer: null,
      statement_descriptor: params.statement_descriptor || null,
      statement_descriptor_suffix:
        params.statement_descriptor_suffix ||
        params.statement_descriptor ||
        null,
      status: "succeeded",
      transfer_data: null,
      transfer_group: params.transfer_group || null,
    };
  }

  function handlePrechargeSpecialTokens(sourceToken?: any): void {
    switch (sourceToken) {
      case "tok_429":
        // An educated guess as to what this looks like.
        throw new RestError(429, {
          message: "Too many requests in a period of time.",
          type: "rate_limit_error",
          code: "rate_limit",
        });
      case "tok_500":
        // Actual 500 as seen from the server.
        throw new RestError(500, {
          message: "An unknown error occurred",
          type: "api_error",
        });
    }
  }

  function handleSpecialChargeTokens(
    accountId: string,
    charge: Stripe.Charge,
    sourceToken: string
  ): void {
    switch (sourceToken) {
      case "tok_chargeCustomerFail":
        charge.failure_code = "card_declined";
        charge.failure_message = "Your card was declined.";
        charge.outcome = {
          network_status: "declined_by_network",
          reason: "generic_decline",
          risk_level: "normal",
          risk_score: 4,
          seller_message:
            "The bank did not return any further details with this decline.",
          type: "issuer_declined",
        };
        charge.paid = false;
        charge.status = "failed";
        throw new RestError(402, {
          charge: charge.id,
          code: "card_declined",
          decline_code: "generic_decline",
          doc_url: "https://stripe.com/docs/error-codes/card-declined",
          message: "Your card was declined.",
          type: "card_error",
        });
      case "tok_riskLevelElevated":
        charge.outcome = {
          network_status: "approved_by_network",
          reason: "elevated_risk_level",
          risk_level: "elevated",
          risk_score: 74,
          rule: "manual_review_if_elevated_risk",
          seller_message:
            "Stripe evaluated this payment as having elevated risk, and placed it in your manual review queue.",
          type: "manual_review",
        };
        break;
      case "tok_chargeDeclined":
        charge.failure_code = "card_declined";
        charge.failure_message = "Your card was declined.";
        charge.outcome = {
          network_status: "declined_by_network",
          reason: "generic_decline",
          risk_level: "normal",
          risk_score: 63,
          seller_message:
            "The bank did not return any further details with this decline.",
          type: "issuer_declined",
        };
        charge.paid = false;
        charge.status = "failed";
        throw new RestError(402, {
          charge: charge.id,
          code: "card_declined",
          decline_code: "generic_decline",
          doc_url: "https://stripe.com/docs/error-codes/card-declined",
          message: "Your card was declined.",
          type: "card_error",
        });
      case "tok_chargeDeclinedInsufficientFunds":
        charge.failure_code = "card_declined";
        charge.failure_message = "Your card has insufficient funds.";
        charge.outcome = {
          network_status: "declined_by_network",
          reason: "generic_decline",
          risk_level: "normal",
          risk_score: 63,
          seller_message:
            "The bank did not return any further details with this decline.",
          type: "issuer_declined",
        };
        charge.paid = false;
        charge.status = "failed";
        throw new RestError(402, {
          charge: charge.id,
          code: "card_declined",
          decline_code: "insufficient_funds",
          doc_url: "https://stripe.com/docs/error-codes/card-declined",
          message: "Your card has insufficient funds.",
          type: "card_error",
        });
      case "tok_chargeDeclinedFraudulent":
        charge.failure_code = "card_declined";
        charge.failure_message = "Your card was declined.";
        charge.outcome = {
          network_status: "not_sent_to_network",
          reason: "merchant_blacklist",
          risk_level: "highest",
          risk_score: 79,
          seller_message: "Stripe blocked this payment.",
          type: "blocked",
        };
        charge.paid = false;
        charge.status = "failed";
        throw new RestError(402, {
          charge: charge.id,
          code: "card_declined",
          decline_code: "fraudulent",
          doc_url: "https://stripe.com/docs/error-codes/card-declined",
          message: "Your card was declined.",
          type: "card_error",
        });
      case "tok_chargeDeclinedIncorrectCvc":
        charge.failure_code = "incorrect_cvc";
        charge.failure_message = "Your card's security code is incorrect.";
        charge.outcome = {
          network_status: "declined_by_network",
          reason: "incorrect_cvc",
          risk_level: "normal",
          risk_score: 63,
          seller_message: "The bank returned the decline code `incorrect_cvc`.",
          type: "issuer_declined",
        };
        charge.paid = false;
        charge.status = "failed";
        throw new RestError(402, {
          charge: charge.id,
          code: "incorrect_cvc",
          doc_url: "https://stripe.com/docs/error-codes/incorrect-cvc",
          message: "Your card's security code is incorrect.",
          param: "cvc",
          type: "card_error",
        });
      case "tok_chargeDeclinedExpiredCard":
        charge.failure_code = "expired_card";
        charge.failure_message = "Your card has expired.";
        charge.outcome = {
          network_status: "declined_by_network",
          reason: "expired_card",
          risk_level: "normal",
          risk_score: 63,
          seller_message: "The bank returned the decline code `expired_card`.",
          type: "issuer_declined",
        };
        charge.paid = false;
        charge.status = "failed";
        throw new RestError(402, {
          charge: charge.id,
          code: "expired_card",
          doc_url: "https://stripe.com/docs/error-codes/expired-card",
          message: "Your card has expired.",
          param: "exp_month",
          type: "card_error",
        });
      case "tok_chargeDeclinedProcessingError":
        charge.failure_code = "processing_error";
        charge.failure_message =
          "An error occurred while processing your card. Try again in a little bit.";
        charge.outcome = {
          network_status: "declined_by_network",
          reason: "processing_error",
          risk_level: "normal",
          risk_score: 47,
          seller_message:
            "The bank returned the decline code `processing_error`.",
          type: "issuer_declined",
        };
        charge.paid = false;
        charge.status = "failed";
        throw new RestError(402, {
          charge: charge.id,
          code: "processing_error",
          doc_url: "https://stripe.com/docs/error-codes/processing-error",
          message:
            "An error occurred while processing your card. Try again in a little bit.",
          type: "card_error",
        });
      case "tok_createDispute":
      case "tok_createDisputeProductNotReceived":
      case "tok_createDisputeInquiry":
        setTimeout(() => {
          const dispute = disputes.createFromSource(
            accountId,
            sourceToken,
            charge,
            sourceToken !== "tok_createDisputeInquiry"
          );
          charge.dispute = dispute.id;
          charge.disputed = true;
        });
        break;
    }
  }

  export function getShippingFromParams(
    params: Stripe.ChargeUpdateParams.Shipping | "" | null
  ): Stripe.Charge.Shipping | null {
    if (params == null || params === "" || params.address.line1 === undefined) {
      return null;
    }

    const address = params.address;
    assertAddressIsAddress(address);

    return {
      address: getAddressFromParams(address),
      carrier: params.carrier || null,
      name: params.name || null,
      phone: params.phone || null,
      tracking_number: params.tracking_number || null,
    };
  }

  export function getAddressFromParams(
    params: Stripe.AddressParam | "" | null
  ): Stripe.Address | null {
    if (params == null || params === "") {
      return null;
    }

    return {
      city: params.city || null,
      country: params.country || null,
      line1: params.line1,
      line2: params.line2 || null,
      postal_code: params.postal_code || null,
      state: params.state || null,
    };
  }
}
