import Stripe from "stripe";
import { AccountData } from "./AccountData";
import { RestError } from "./RestError";
import { applyListOptions, generateId, stringifyMetadata } from "./utils";
import { customers } from "./customers";
import { prices } from "./prices";
import { verify } from "./verify";
import { taxRates } from "./taxRates";
import { accounts } from "./accounts";
import log = require("loglevel");
import { webhooks } from "./webhooks";
import { add } from "date-fns";

export namespace subscriptions {
  const accountSubscriptions = new AccountData<Stripe.Subscription>();
  const accountSubscriptionItems = new AccountData<Stripe.SubscriptionItem>();

  export function create(
    accountId: string,
    params: Stripe.SubscriptionCreateParams
  ): Stripe.Subscription {
    log.debug("subscriptions.create", accountId, params);

    let default_source: string;
    const paramsDefaultSource = params.default_source;
    if (paramsDefaultSource && typeof paramsDefaultSource !== "string") {
      const customer = params.customer;
      const card = customers.createCard(accountId, customer, {
        source: paramsDefaultSource,
      });
      default_source = card.id;
    } else if (typeof paramsDefaultSource === "string") {
      default_source = paramsDefaultSource;
    }

    const subscriptionId = (params as any).id || `sub_${generateId(14)}`;
    if (accountSubscriptions.contains(accountId, subscriptionId)) {
      throw new RestError(400, {
        code: "resource_already_exists",
        doc_url: "https://stripe.com/docs/error-codes/resource-already-exists",
        message: "Subscription already exists.",
        type: "invalid_request_error",
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const nextMonth = add(new Date(), { months: 1 });
    const nextYear = add(new Date(), { years: 1 });

    const subscription: Stripe.Subscription = {
      id: subscriptionId,
      object: "subscription",
      application: "",
      application_fee_percent: +params.application_fee_percent || null,
      automatic_tax: {
        enabled: params.automatic_tax?.enabled ?? false,
      },
      collection_method: params.collection_method || "charge_automatically",
      billing_cycle_anchor: +params.billing_cycle_anchor || now,
      billing_thresholds: params.billing_thresholds
        ? {
            amount_gte: params.billing_thresholds.amount_gte ?? null,
            reset_billing_cycle_anchor:
              params.billing_thresholds.reset_billing_cycle_anchor ?? null,
          }
        : null,
      cancel_at: null,
      cancel_at_period_end: false,
      canceled_at: null,
      created: now,

      // set to one month, however if we find a yearly price item, we'll revise
      current_period_end: Math.floor(nextMonth.getTime() / 1000),
      current_period_start: now,
      customer: params.customer,
      days_until_due: +params.days_until_due || null,
      default_payment_method: null,
      default_source: default_source || null,
      default_tax_rates: (params.default_tax_rates || null)?.map((t) =>
        taxRates.retrieve(accountId, t, "default_tax_rate")
      ),
      discount: null,
      ended_at: null,
      items: {
        object: "list",
        data: [],
        has_more: false,
        url: `/v1/subscription_items?subscription=${subscriptionId}`,
      },
      latest_invoice: `in_${generateId(14)}`,
      livemode: false,
      metadata: stringifyMetadata(params.metadata),
      next_pending_invoice_item_invoice: null,
      payment_settings: null,
      pause_collection: null,
      pending_invoice_item_interval: null,
      pending_setup_intent: null,
      pending_update: null,
      schedule: null,
      start_date: Math.floor(Date.now() / 1000),
      status: "active",
      test_clock: null,
      transfer_data: params.transfer_data
        ? {
            amount_percent: params.transfer_data.amount_percent ?? null,
            destination: accounts.retrieve(
              accountId,
              params.transfer_data.destination,
              ""
            ),
          }
        : null,
      trial_end: null,
      trial_start: null,
    };

    if (params.items) {
      for (const item of params.items) {
        const subscriptionItem = createItem(accountId, item, subscription.id);
        subscription.items.data.push(subscriptionItem);
        if (subscriptionItem.price.recurring?.interval === "year") {
          subscription.current_period_end = Math.floor(
            nextYear.getTime() / 1000
          );
        }
      }
    }

    accountSubscriptions.put(accountId, subscription);
    customers.addSubscription(
      accountId,
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id,
      subscription
    );

    webhooks.post(
      accountId,
      JSON.stringify(subscription),
      "customer.subscription.created"
    );

    postInvoicePaidEvent(accountId, subscription);

    return subscription;
  }

  function createItem(
    accountId: string,
    item: Stripe.SubscriptionCreateParams.Item,
    subscriptionId: string
  ): Stripe.SubscriptionItem {
    const paramId = (item as any).id;
    const subItemId = paramId || `si_${generateId(14)}`;

    const subscriptionItem: Stripe.SubscriptionItem = {
      object: "subscription_item",
      id: subItemId,
      billing_thresholds: item.billing_thresholds || null,
      created: Math.floor(Date.now() / 1000),
      deleted: undefined,
      metadata: stringifyMetadata(item.metadata),
      plan: null,
      price: item.price
        ? prices.retrieve(accountId, item.price, "price", {})
        : null,
      quantity: +item.quantity || 1,
      subscription: subscriptionId,
      tax_rates: (item.tax_rates || null)?.map((r) =>
        taxRates.retrieve(accountId, r, "tax_rate")
      ),
    };
    accountSubscriptionItems.put(accountId, subscriptionItem);

    return subscriptionItem;
  }

  export function updateItem(
    accountId: string,
    subscriptionItemId: string,
    params: Stripe.SubscriptionItemUpdateParams
  ): Stripe.SubscriptionItem {
    log.debug(
      "subscriptions.updateItem",
      accountId,
      subscriptionItemId,
      params
    );

    const subscriptionItem = retrieveItem(accountId, subscriptionItemId, "id");

    if (params.quantity) {
      subscriptionItem.quantity = +params.quantity;
    }

    if (params.price) {
      const price = prices.retrieve(accountId, params.price, "id", params);
      subscriptionItem.price = price;

      // we changed the price, maybe we need to change the interval
      const subscription = retrieve(
        accountId,
        subscriptionItem.subscription,
        "id"
      );

      const start = new Date(subscription.current_period_start * 1000);

      // take the created and add a year.
      subscription.current_period_end =
        (price.recurring.interval === "year"
          ? add(start, { years: 1 })
          : add(start, { months: 1 })
        ).getTime() / 1000;
    }

    return subscriptionItem;
  }

  export function update(
    accountId: string,
    subscriptionId: string,
    params: Stripe.SubscriptionUpdateParams
  ): Stripe.Subscription {
    log.debug("subscriptions.update", subscriptionId);

    const subscription = accountSubscriptions.get(accountId, subscriptionId);
    if (!subscription) {
      throw new RestError(404, {
        code: "resource_missing",
        doc_url: "https://stripe.com/docs/error-codes/resource-missing",
        message: `No such subscription: ${subscriptionId}`,
        type: "invalid_request_error",
      });
    }

    // now update it.
    // TODO: genric update for all properties included
    // in the params
    subscription.days_until_due =
      params.days_until_due ?? subscription.days_until_due;

    subscription.collection_method =
      params.collection_method ?? subscription.collection_method;

    subscription.automatic_tax =
      params.automatic_tax ?? subscription.automatic_tax;

    if (params.items !== undefined) {
      for (let itr = 0; itr < params.items.length; itr++) {
        updateItem(accountId, params.items[itr].id, params.items[itr]);
      }
    }

    webhooks.post(
      accountId,
      JSON.stringify(subscription),
      "customer.subscription.updated"
    );

    postInvoicePaidEvent(accountId, subscription);

    return subscription;
  }

  export function retrieve(
    accountId: string,
    subscriptionId: string,
    paramName: string
  ): Stripe.Subscription {
    log.debug("subscriptions.retrieve", subscriptionId);

    const subscription = accountSubscriptions.get(accountId, subscriptionId);
    if (!subscription) {
      throw new RestError(404, {
        code: "resource_missing",
        doc_url: "https://stripe.com/docs/error-codes/resource-missing",
        message: `No such subscription: ${subscriptionId}`,
        param: paramName,
        type: "invalid_request_error",
      });
    }
    return subscription;
  }

  export function del(
    accountId: string,
    subscriptionId: string
  ): Stripe.Subscription {
    log.debug("subscriptions.delete", subscriptionId);

    const subscription = accountSubscriptions.get(accountId, subscriptionId);
    if (!subscription) {
      throw new RestError(404, {
        code: "resource_missing",
        doc_url: "https://stripe.com/docs/error-codes/resource-missing",
        message: `No such subscription: ${subscriptionId}`,
        type: "invalid_request_error",
      });
    }

    // todo - find whatever is related to this.
    accountSubscriptions.remove(accountId, subscriptionId);

    webhooks.post(
      accountId,
      JSON.stringify(subscription),
      "customer.subscription.deleted"
    );

    return subscription;
  }

  export function retrieveItem(
    accountId: string,
    subscriptionItemId: string,
    paramName: string
  ): Stripe.SubscriptionItem {
    log.debug("subscriptions.retrieveItem", subscriptionItemId);

    const subscriptionItem = accountSubscriptionItems.get(
      accountId,
      subscriptionItemId
    );
    if (!subscriptionItem) {
      throw new RestError(404, {
        code: "resource_missing",
        doc_url: "https://stripe.com/docs/error-codes/resource-missing",
        message: `No such subscription_item: ${subscriptionItemId}`,
        param: paramName,
        type: "invalid_request_error",
      });
    }
    return subscriptionItem;
  }

  export function list(
    accountId: string,
    params: Stripe.SubscriptionListParams
  ): Stripe.ApiList<Stripe.Subscription> {
    log.debug("subscriptions.list", params);

    let data = accountSubscriptions.getAll(accountId);
    if (params.customer) {
      data = data.filter((d) => {
        if (typeof d.customer === "string") {
          return d.customer === params.customer;
        } else {
          return d.customer.id === params.customer;
        }
      });
    }

    return applyListOptions(data, params, (id, paramName) => {
      return retrieve(accountId, id, paramName);
    });
  }

  export function listItems(
    accountId: string,
    params: Partial<Stripe.SubscriptionItemListParams>
  ): Stripe.ApiList<Stripe.SubscriptionItem> {
    log.debug("subscriptionItems.list", params);

    verify.requiredParams(params, ["subscription"]);
    const data = accountSubscriptionItems.getAll(accountId).filter((d) => {
      return d.subscription === params.subscription;
    });

    return applyListOptions(data, params, (id, paramName) => {
      return retrieveItem(accountId, id, paramName);
    });
  }

  function postInvoicePaidEvent(
    accountId: string,
    subscription: Stripe.Subscription
  ) {
    const invoice: Stripe.Invoice = {
      id: "",
      object: "invoice",
      livemode: false,
      payment_intent: `pi_${subscription.id}`,
      status: "paid",
      account_country: "US",
      account_name: "Datagrid",
      account_tax_ids: null,
      amount_due: 0,
      amount_paid: 0,
      amount_remaining: 0,
      application: null,
      application_fee_amount: null,
      attempt_count: 1,
      attempted: true,
      auto_advance: false,
      automatic_tax: {
        enabled: false,
        status: null,
      },
      billing_reason: "subscription_cycle",
      charge: `ch_${generateId(14)}`,
      collection_method: "charge_automatically",
      created: Math.floor(Date.now() / 1000),
      currency: "usd",
      custom_fields: null,
      customer: subscription.customer,
      customer_address: null,
      customer_email: null,
      customer_name: null,
      customer_phone: null,
      customer_shipping: null,
      customer_tax_exempt: "none",
      customer_tax_ids: [],
      default_payment_method: null,
      default_source: null,
      default_tax_rates: [],
      description: null,
      discount: null,
      discounts: [],
      due_date: null,
      ending_balance: 0,
      footer: null,
      last_finalization_error: null,
      lines: {
        object: "list",
        data: [],
        has_more: false,
        url: "",
      },
      metadata: {},
      next_payment_attempt: null,
      number: generateId(14),
      on_behalf_of: null,
      paid: true,
      paid_out_of_band: false,
      payment_settings: {
        payment_method_options: null,
        payment_method_types: null,
      },
      period_end: Math.floor(add(new Date(), { months: 1 }).getTime() / 1000),
      period_start: Math.floor(Date.now() / 1000),
      post_payment_credit_notes_amount: 0,
      pre_payment_credit_notes_amount: 0,
      quote: null,
      receipt_number: null,
      starting_balance: 0,
      statement_descriptor: null,
      status_transitions: {
        finalized_at: Math.floor(Date.now() / 1000),
        marked_uncollectible_at: null,
        paid_at: Math.floor(Date.now() / 1000),
        voided_at: null,
      },
      subscription,
      subtotal: 0,
      tax: null,
      test_clock: null,
      total: 0,
      total_discount_amounts: [],
      total_tax_amounts: [],
      transfer_data: null,
      webhooks_delivered_at: null,
    };

    // simulate a delay between `customer.subscription.created` `invoice.paid` events
    setTimeout(
      () => webhooks.post(accountId, JSON.stringify(invoice), "invoice.paid"),
      3_000
    );
  }
}
