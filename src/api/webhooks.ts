import axios from "axios";
import Stripe from "stripe";
import { AccountData } from "./AccountData";
import { applyListOptions, generateId } from "./utils";
import { verify } from "./verify";
import { RestError } from "./RestError";
import log = require("loglevel");

export namespace webhooks {
  const accountWebhooks = new AccountData<Stripe.WebhookEndpoint>();
  const client = axios.create();
  const stripe = new Stripe("", { apiVersion: "2020-08-27" });

  export function create(
    accountId: string,
    // Augment the type to allow seeding the mock properly.
    params: Stripe.WebhookEndpointCreateParams & {
      id?: string;
      secret?: string;
    }
  ): Stripe.WebhookEndpoint {
    log.debug("webhook.create", accountId, params);

    verify.requiredParams(params, ["enabled_events"]);

    const whId = params.id ?? `we_${generateId()}`;
    if (accountWebhooks.contains(accountId, whId)) {
      throw new RestError(400, {
        code: "resource_already_exists",
        doc_url: "https://stripe.com/docs/error-codes/resource-already-exists",
        message: `Webhook Endpoint already exists.`,
        type: "invalid_request_error",
      });
    }

    const webhookEndpoint: Stripe.WebhookEndpoint = {
      id: whId,
      object: "webhook_endpoint",
      api_version: null,
      application: null,
      created: Date.now(),
      description: null,
      enabled_events: params.enabled_events,
      livemode: false,
      metadata: {},
      status: "enabled",
      url: params.url,

      // This is a hack - we should not be allowed to pass this in
      secret: params.secret ?? `whsec_${generateId(32)}`,
    };

    accountWebhooks.put(accountId, webhookEndpoint);
    return webhookEndpoint;
  }

  export function retrieve(
    accountId: string,
    webhookId: string,
    paramName: string
  ): Stripe.WebhookEndpoint {
    log.debug("webhookEndpoint.retrieve", accountId, webhookId);

    const wh = accountWebhooks.get(accountId, webhookId);
    if (!wh) {
      throw new RestError(404, {
        code: "resource_missing",
        doc_url: "https://stripe.com/docs/error-codes/resource-missing",
        message: `No such webhook endpoint Id: ${webhookId}`,
        param: paramName,
        type: "invalid_request_error",
      });
    }

    return wh;
  }

  export function list(
    accountId: string,
    params: Stripe.PaginationParams
  ): Stripe.ApiList<Stripe.WebhookEndpoint> {
    log.debug("webhookEndpoint.list", accountId, params);

    let data = accountWebhooks.getAll(accountId);

    if (params.limit !== undefined) {
      let count = 0;
      data = data.filter((d) => count++ < params.limit);
    }

    return applyListOptions(data, params, (id, paramName) =>
      retrieve(accountId, id, paramName)
    );
  }

  export async function post(
    accountId: string,
    data: string,
    eventType: Stripe.WebhookEndpointCreateParams.EnabledEvent
  ): Promise<void> {
    // check if we have an enxpoint for this account
    const webhookEndpoints = list(accountId, {});
    for (let itr = 0; itr < webhookEndpoints.data.length; itr++) {
      const whEndpoint = webhookEndpoints.data[itr];
      if (intersection(whEndpoint.enabled_events, eventType)) {
        const url = whEndpoint.url;
        const secret = whEndpoint.secret ?? "";

        const timestamp = Date.now();
        const payload = createPayload(data, eventType);
        const signature = stripe.webhooks.generateTestHeaderString({
          timestamp,
          payload,
          secret,
        });

        try {
          await client.post(`${url}`, payload, {
            headers: { "Stripe-Signature": signature },
          });
        } catch (err) {
          log.error("webhook.post", accountId, {
            url,
            timestamp,
            signature,
          });
        }
      }
    }

    return;
  }

  function createPayload(
    data: string,
    type: Stripe.WebhookEndpointCreateParams.EnabledEvent
  ): string {
    const payload = {
      id: `evt_${generateId(24)}`,
      object: "event",
      api_version: "2020-08-27",
      created: Date.now(),
      data: {
        object: JSON.parse(data),
      },
      livemode: false,
      pending_webhooks: 0,
      request: {
        id: `req_${generateId(14)}`,
        idempotency_key: `stripe-node-retry-${generateId(32)}`,
      },
      type,
    };

    return JSON.stringify(payload);
  }

  function intersection(
    registeredEvents: Array<string>,
    event: Stripe.WebhookEndpointCreateParams.EnabledEvent
  ): boolean {
    return registeredEvents.includes("*") || registeredEvents.includes(event);
  }
}
