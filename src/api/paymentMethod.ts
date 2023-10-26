import Stripe from "stripe";
import { AccountData } from "./AccountData";
import { applyListOptions, generateId } from "./utils";
import { verify } from "./verify";
import { RestError } from "./RestError";
import log = require("loglevel");

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
  const customersPaymentMethods = new Map<string, Set<string>>();

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
        name: null,
        phone: null,
      },
      card: {
        brand: "visa",
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
          available: ["visa"],
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
      data = data.filter((d) => params.customer.indexOf(d.id) !== -1);
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
    // make sure its a real thing
    const pm = retrieve(accountId, pmId, "id");

    const customerPaymentMethods =
      customersPaymentMethods.get(customerId) ?? new Set();

    customerPaymentMethods.add(pmId);

    customersPaymentMethods.set(customerId, customerPaymentMethods);

    return pm;
  }

  export function detach(
    accountId: string,
    pmId: string
  ): Stripe.PaymentMethod {
    // make sure its a real thing
    const pm = retrieve(accountId, pmId, "id");

    // but its a little expensive to find it
    // so leave it alone
    return pm;
  }
}
