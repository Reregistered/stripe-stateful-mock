import Stripe from "stripe";
import { generateId } from "./utils";
import log = require("loglevel");
import { subscriptions } from "./subscriptions";
import { customers } from "./customers";

export namespace invoices {
  export function upcoming(
    accountId: string,
    params: Stripe.InvoiceRetrieveUpcomingParams
  ): Stripe.Invoice {
    log.debug("invoice.upcoming", accountId, params);

    const id = `il_tmp_${generateId()}`;

    let amount_due = 0;
    let customerId = `cus_${generateId()}`;
    const lines: Stripe.ApiList<Stripe.InvoiceLineItem> = {
      object: "list",
      data: [],
      has_more: false,
      url: "/v1/invoices/upcoming/lines",
    };

    let subscription = null;
    let customer: Stripe.Customer | undefined;
    if (params.subscription) {
      subscription = subscriptions.retrieve(
        accountId,
        params.subscription,
        "id"
      );
      const subItems = subscriptions.listItems(accountId, params);

      // augment the lines
      customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
      lines.url = lines.url += `?customer=${subscription.customer}`;

      for (let itr = 0; itr < subItems.data.length; itr++) {
        const subItem = subItems.data[itr];
        const lineItem = getLineItem(id, subItem);
        lines.data.push(lineItem);
        amount_due += lineItem.amount * lineItem.quantity;
      }

      customer = customers.retrieve(accountId, customerId, "id");
    }

    const period = getStartAndEndDates();

    const invoice: Stripe.Invoice = {
      id,
      object: "invoice",
      account_country: "US",
      account_name: "Toric",
      account_tax_ids: null,
      amount_due: amount_due,
      amount_paid: 0,
      amount_remaining: amount_due,
      application: null,
      application_fee_amount: null,
      attempt_count: 0,
      attempted: false,
      automatic_tax: {
        enabled: false,
        status: null,
      },
      billing_reason: "manual",
      charge: null,
      collection_method: "charge_automatically",
      created: calculatedCreatedTime(subscription),
      currency: "usd",
      custom_fields: null,
      customer: customerId,
      customer_address: null,
      customer_email: customer.email ?? "uknown@unknown.com",
      customer_name: customer.name ?? "Unknown User",
      customer_phone: customer?.phone ?? null,
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
      ending_balance: null,
      footer: null,
      last_finalization_error: null,
      lines,
      livemode: false,
      metadata: {},
      next_payment_attempt: null,
      number: null,
      on_behalf_of: null,
      paid: false,
      paid_out_of_band: false,
      payment_intent: null,
      payment_settings: {
        payment_method_options: null,
        payment_method_types: null,
      },
      period_end: period.end.getTime(),
      period_start: period.start.getTime(),
      post_payment_credit_notes_amount: 0,
      pre_payment_credit_notes_amount: 0,
      quote: null,
      receipt_number: null,
      starting_balance: 0,
      statement_descriptor: null,
      status: "draft",
      status_transitions: {
        finalized_at: null,
        marked_uncollectible_at: null,
        paid_at: null,
        voided_at: null,
      },
      subscription,
      subtotal: amount_due,
      tax: null,
      test_clock: null,
      total: amount_due,
      total_discount_amounts: [],
      total_tax_amounts: [],
      transfer_data: null,
      webhooks_delivered_at: null,
    };

    return invoice;
  }

  function getLineItem(
    invoiceId: string,
    subscriptionItem: Stripe.SubscriptionItem
  ): Stripe.InvoiceLineItem {
    const period = getStartAndEndDates();

    const lineItem: Stripe.InvoiceLineItem = {
      id: `il_${generateId()}`,
      type: "invoiceitem",
      object: "line_item",
      amount: subscriptionItem.price.unit_amount,
      currency: subscriptionItem.price.currency,
      description: "My First Invoice Item (created for API docs)",
      discount_amounts: null,
      discountable: true,
      discounts: null,
      invoice_item: invoiceId,
      livemode: false,
      metadata: {},
      period: {
        end: period.end.getTime(),
        start: period.start.getTime(),
      },
      price: subscriptionItem.price,
      proration: false,
      proration_details: {
        credited_items: null,
      },
      plan: null,
      quantity: subscriptionItem.quantity ?? 1,
      subscription: subscriptionItem.subscription,
      tax_amounts: [],
      tax_rates: [],
    };

    return lineItem;
  }

  function getStartAndEndDates(): {
    start: Date;
    end: Date;
  } {
    const start = new Date();
    const end = new Date();
    end.setMonth(start.getMonth() + 1);
    if (start.getMonth() === 11) {
      end.setFullYear(start.getFullYear() + 1);
    }
    return {
      start,
      end,
    };
  }

  function calculatedCreatedTime(
    subscription: Stripe.Subscription | null
  ): number {
    if (subscription === null) {
      return Date.now() / 1000;
    }

    // we need to calculate the next invoice
    return subscription.current_period_end;
  }
}
