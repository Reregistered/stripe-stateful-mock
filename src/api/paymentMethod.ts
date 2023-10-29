import Stripe from "stripe";
import { AccountData } from "./AccountData";
import { applyListOptions, generateId } from "./utils";
import { verify } from "./verify";
import { RestError } from "./RestError";
import log = require("loglevel");
import { cards } from "./cards";
import { customers } from "./customers";

export namespace paymentMethods {
  function assertsIsPaymentMethodListParams(
    params: unknown
  ): asserts params is Stripe.PaymentMethodListParams {
    if ((params as any).type === undefined) {
      throw new Error("Not PaymentMethodListParams");
    }
    return;
  }

  const accountPaymentMethods = new AccountData<Stripe.PaymentMethod>();

  export function create(
    accountId: string,
    params: Stripe.PaymentMethodCreateParams
  ): Stripe.PaymentMethod {
    log.debug("paymentMethod.create", accountId, params);

    verify.requiredParams(params, ["type"]);

    const pmId = `pm_${generateId()}`;
    if (accountPaymentMethods.contains(accountId, pmId)) {
      throw new RestError(400, {
        code: "resource_already_exists",
        doc_url: "https://stripe.com/docs/error-codes/resource-already-exists",
        message: `Product already exists.`,
        type: "invalid_request_error",
      });
    }

    const cardBrand = cards.getCardBrand((params.card as any)?.number);
    const type = params.type;
    const paymentMethod: Stripe.PaymentMethod = {
      id: pmId,
      object: "payment_method",
      type,
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
        name: params.billing_details?.name ?? null,
        phone: null,
      },
      card: {
        brand: cardBrand,
        checks: {
          address_line1_check: null,
          address_postal_code_check: null,
          cvc_check: "pass",
        },
        country: "IE",
        exp_month: Number((params.card as any)?.exp_month ?? 12),
        exp_year: Number((params.card as any)?.exp_year ?? 2034),
        fingerprint: "AmDDvzuWgGPLlns0",
        funding: "credit",
        last4: (params.card as any)?.number.slice(-4) ?? "3220",
        networks: {
          available: [cardBrand],
          preferred: null,
        },
        three_d_secure_usage: {
          supported: true,
        },
        wallet: null,
      },
      created: Date.now(),
      customer: params.customer,
      livemode: false,
      metadata: null,
    };

    accountPaymentMethods.put(accountId, paymentMethod);
    return paymentMethod;
  }

  export function retrieve(
    accountId: string,
    pmId: string,
    paramName: string
  ): Stripe.PaymentMethod {
    log.debug("paymentMethods.retrieve", accountId, pmId);

    const pm = accountPaymentMethods.get(accountId, pmId);
    if (!pm) {
      throw new RestError(404, {
        code: "resource_missing",
        doc_url: "https://stripe.com/docs/error-codes/resource-missing",
        message: `No such payment method: ${pmId}`,
        param: paramName,
        type: "invalid_request_error",
      });
    }
    return pm;
  }

  export function list(
    accountId: string,
    params: Stripe.PaginationParams
  ): Stripe.ApiList<Stripe.PaymentMethod> {
    log.debug("paymentMethod.list", accountId, params);

    let data = accountPaymentMethods.getAll(accountId);

    assertsIsPaymentMethodListParams(params);

    if (params.type !== undefined) {
      data = data.filter((d) => d.type === params.type);
    }

    if (params.customer) {
      data = data.filter(
        (d) =>
          params.customer.indexOf(
            (typeof d.customer === "string" ? d.customer : d.customer?.id) ?? ""
          ) !== -1
      );
    }

    return applyListOptions(data, params, (id, paramName) =>
      retrieve(accountId, id, paramName)
    );
  }

  export function attach(
    accountId: string,
    pmId: string,
    customerId: string
  ): Stripe.PaymentMethod {
    log.debug("paymentMethods.attach", accountId, pmId);

    // make sure its a real thing
    const pm = retrieve(accountId, pmId, "id");

    pm.customer = customerId;

    return pm;
  }

  export function detach(
    accountId: string,
    pmId: string
  ): Stripe.PaymentMethod {
    log.debug("paymentMethods.detach", accountId, pmId);

    // make sure its a real thing
    const pm = retrieve(accountId, pmId, "id");

    // check the customer
    if (pm.customer) {
      const customer =
        typeof pm.customer === "string"
          ? customers.retrieve(accountId, pm.customer, "id")
          : pm.customer;
      // check the default payment
      if (customer.invoice_settings) {
        if (
          typeof customer.invoice_settings.default_payment_method === "string"
        ) {
          if (customer.invoice_settings.default_payment_method === pm.id) {
            customer.invoice_settings.default_payment_method = null;
          }
        } else if (
          customer.invoice_settings.default_payment_method?.id === pm.id
        ) {
          customer.invoice_settings.default_payment_method = null;
        }
      }
    }

    pm.customer = null;

    accountPaymentMethods.remove(accountId, pm.id);

    // but its a little expensive to find it
    // so leave it alone
    return pm;
  }
}
