import express from "express";
import { auth } from "./api/auth";
import { accounts } from "./api/accounts";
import { charges } from "./api/charges";
import { customers } from "./api/customers";
import { disputes } from "./api/disputes";
import { invoices } from "./api/invoices";
import { paymentMethods } from "./api/paymentMethod";
import { plans } from "./api/plans";
import { prices } from "./api/prices";
import { products } from "./api/products";
import { refunds } from "./api/refunds";
import { subscriptions } from "./api/subscriptions";
import { taxRates } from "./api/taxRates";
import { expandList, expandObject } from "./api/utils";
import { webhooks } from "./api/webhooks";

const routes = express.Router();

routes.get("/", (req, res) => {
  return res.status(200).json({
    message: "Hello world",
  });
});

routes.post("/v1/accounts", (req, res) => {
  const account = accounts.create(getRequestAccountId(req), req.body);
  return res.status(200).json(account);
});

routes.get("/v1/accounts", (req, res) => {
  const accountList = accounts.list(getRequestAccountId(req), req.query);
  return res.status(200).json(accountList);
});

routes.get("/v1/accounts/:id", (req, res) => {
  // Verify that we have access to the connected account.
  accounts.retrieve(
    "acct_default",
    req.params.id,
    auth.getCensoredAccessTokenFromRequest(req)
  );

  const account = accounts.retrieve(
    getRequestAccountId(req),
    req.params.id,
    auth.getCensoredAccessTokenFromRequest(req)
  );
  return res.status(200).json(account);
});

routes.delete("/v1/accounts/:id", (req, res) => {
  // Verify that we have access to the connected account.
  accounts.retrieve(
    "acct_default",
    req.params.id,
    auth.getCensoredAccessTokenFromRequest(req)
  );

  const account = accounts.del(
    getRequestAccountId(req),
    req.params.id,
    auth.getCensoredAccessTokenFromRequest(req)
  );
  return res.status(200).json(account);
});

routes.get("/v1/charges", (req, res) => {
  const chargeList = charges.list(getRequestAccountId(req), req.query);
  return res.status(200).json(chargeList);
});

routes.post("/v1/charges", (req, res) => {
  const charge = charges.create(getRequestAccountId(req), req.body);
  return res.status(200).json(charge);
});

routes.get("/v1/charges/:id", (req, res) => {
  const charge = charges.retrieve(
    getRequestAccountId(req),
    req.params.id,
    "id"
  );
  return res.status(200).json(charge);
});

routes.post("/v1/charges/:id", (req, res) => {
  const charge = charges.update(
    getRequestAccountId(req),
    req.params.id,
    req.body
  );
  return res.status(200).json(charge);
});

routes.post("/v1/charges/:id/capture", (req, res) => {
  const charge = charges.capture(
    getRequestAccountId(req),
    req.params.id,
    req.body
  );
  return res.status(200).json(charge);
});

// Old API.
routes.get("/v1/charges/:id/refunds", (req, res) => {
  const refundList = refunds.list(getRequestAccountId(req), {
    ...req.query,
    charge: req.params.id,
  });
  return res.status(200).json(refundList);
});

routes.post("/v1/customers", (req, res) => {
  const customer = customers.create(getRequestAccountId(req), req.body);
  const expandedCustomer = expandObject(
    customer,
    ["sources", "subscriptions"],
    req.body.expand
  );
  return res.status(200).json(expandedCustomer);
});

routes.get("/v1/customers", (req, res) => {
  const customerList = customers.list(getRequestAccountId(req), req.query);
  const expandedCustomerList = expandList(
    customerList,
    ["sources", "subscriptions"],
    req.query.expand as any
  );
  return res.status(200).json(expandedCustomerList);
});

routes.get("/v1/customers/:id", (req, res) => {
  const customer = customers.retrieve(
    getRequestAccountId(req),
    req.params.id,
    "id"
  );
  const expandedCustomer = expandObject(
    customer,
    ["sources", "subscriptions"],
    req.query.expand as any
  );
  return res.status(200).json(expandedCustomer);
});

routes.post("/v1/customers/:id", (req, res) => {
  const customer = customers.update(
    getRequestAccountId(req),
    req.params.id,
    req.body,
    {
      paymentMethods,
    }
  );
  const expandedCustomer = expandObject(
    customer,
    ["sources", "subscriptions"],
    req.body.expand
  );
  return res.status(200).json(expandedCustomer);
});

routes.delete("/v1/customers/:id", (req, res) => {
  const customer = customers.del(getRequestAccountId(req), req.params.id, "id");
  const expandedCustomer = expandObject(
    customer,
    ["sources", "subscriptions"],
    req.query.expand as any
  );
  return res.status(200).json(expandedCustomer);
});

// Old API.
routes.get("/v1/customers/:customerId/cards/:cardId", (req, res) => {
  const card = customers.retrieveCard(
    getRequestAccountId(req),
    req.params.customerId,
    req.params.cardId,
    "card"
  );
  return res.status(200).json(card);
});

// New API.
routes.get("/v1/customers/:customerId/sources/:cardId", (req, res) => {
  const card = customers.retrieveCard(
    getRequestAccountId(req),
    req.params.customerId,
    req.params.cardId,
    "card"
  );
  return res.status(200).json(card);
});

routes.delete("/v1/customers/:customerId/sources/:cardId", (req, res) => {
  const customer = customers.deleteCard(
    getRequestAccountId(req),
    req.params.customerId,
    req.params.cardId
  );
  return res.status(200).json(customer);
});

routes.post("/v1/customers/:customerId/sources", (req, res) => {
  const card = customers.createCard(
    getRequestAccountId(req),
    req.params.customerId,
    req.body
  );
  return res.status(200).json(card);
});

routes.get("/v1/disputes/:id", (req, res) => {
  const dispute = disputes.retrieve(
    getRequestAccountId(req),
    req.params.id,
    "dispute"
  );
  return res.status(200).json(dispute);
});

routes.get("/v1/invoices/upcoming/", (req, res) => {
  const dispute = invoices.upcoming(getRequestAccountId(req), req.query);
  return res.status(200).json(dispute);
});

routes.post("/v1/payment_methods", (req, res) => {
  const pm = paymentMethods.create(getRequestAccountId(req), req.body);
  return res.status(200).json(pm);
});

routes.post("/v1/payment_methods/:id/attach", (req, res) => {
  const accountId = getRequestAccountId(req);
  const cust = customers.retrieve(accountId, req.body.customer, "customer");

  const pm = paymentMethods.attach(accountId, req.params.id, cust.id);

  return res.status(200).json(pm);
});

routes.post("/v1/payment_methods/:id/detach", (req, res) => {
  const pm = paymentMethods.detach(getRequestAccountId(req), req.params.id);

  return res.status(200).json(pm);
});

routes.get("/v1/payment_methods", (req, res) => {
  const pmList = paymentMethods.list(getRequestAccountId(req), req.query);
  return res.status(200).json(pmList);
});

routes.get("/v1/payment_methods/:id", (req, res) => {
  const pm = paymentMethods.retrieve(
    getRequestAccountId(req),
    req.params.id,
    "id"
  );
  return res.status(200).json(pm);
});

routes.post("/v1/plans", (req, res) => {
  const plan = plans.create(getRequestAccountId(req), req.body);
  const planExpanded = expandObject(plan, ["tiers"], req.body.expand);
  return res.status(200).json(planExpanded);
});

routes.get("/v1/plans", (req, res) => {
  const planList = plans.list(getRequestAccountId(req), req.query);
  const planListExpanded = expandList(
    planList,
    ["tiers"],
    req.query.expand as any
  );
  return res.status(200).json(planListExpanded);
});

routes.get("/v1/plans/:id", (req, res) => {
  const plan = plans.retrieve(getRequestAccountId(req), req.params.id, "id");
  const planExpanded = expandObject(plan, ["tiers"], req.query.expand as any);
  return res.status(200).json(planExpanded);
});

routes.post("/v1/prices", (req, res) => {
  const price = prices.create(getRequestAccountId(req), req.body);
  return res.status(200).json(price);
});

routes.get("/v1/prices", (req, res) => {
  const priceList = prices.list(getRequestAccountId(req), req.query);
  return res.status(200).json(priceList);
});

routes.get("/v1/prices/:id", (req, res) => {
  const price = prices.retrieve(
    getRequestAccountId(req),
    req.params.id,
    "id",
    req.query
  );
  return res.status(200).json(price);
});

routes.post("/v1/prices/:id", (req, res) => {
  const price = prices.update(
    getRequestAccountId(req),
    req.params.id,
    req.body
  );
  return res.status(200).json(price);
});

routes.post("/v1/products", (req, res) => {
  const product = products.create(getRequestAccountId(req), req.body);
  return res.status(200).json(product);
});

routes.get("/v1/products", (req, res) => {
  const productList = products.list(getRequestAccountId(req), req.query);
  return res.status(200).json(productList);
});

routes.get("/v1/products/:id", (req, res) => {
  const product = products.retrieve(
    getRequestAccountId(req),
    req.params.id,
    "id"
  );
  return res.status(200).json(product);
});

routes.post("/v1/refunds", (req, res) => {
  const refund = refunds.create(getRequestAccountId(req), req.body);
  return res.status(200).json(refund);
});

routes.get("/v1/refunds", (req, res) => {
  const refundList = refunds.list(getRequestAccountId(req), req.query);
  return res.status(200).json(refundList);
});

routes.get("/v1/refunds/:id", (req, res) => {
  const refund = refunds.retrieve(
    getRequestAccountId(req),
    req.params.id,
    "id"
  );
  return res.status(200).json(refund);
});

routes.post("/v1/subscriptions", (req, res) => {
  const subscription = subscriptions.create(getRequestAccountId(req), req.body);
  return res.status(200).json(subscription);
});

routes.post("/v1/subscriptions/:id", (req, res) => {
  const subscription = subscriptions.update(
    getRequestAccountId(req),
    req.params.id,
    req.body
  );
  return res.status(200).json(subscription);
});

routes.get("/v1/subscriptions", (req, res) => {
  const subscriptionList = subscriptions.list(
    getRequestAccountId(req),
    req.query
  );
  return res.status(200).json(subscriptionList);
});

routes.get("/v1/subscriptions/:id", (req, res) => {
  const subscription = subscriptions.retrieve(
    getRequestAccountId(req),
    req.params.id,
    "id"
  );
  return res.status(200).json(subscription);
});

routes.delete("/v1/subscriptions/:id", (req, res) => {
  const subscription = subscriptions.del(
    getRequestAccountId(req),
    req.params.id
  );
  return res.status(200).json(subscription);
});

routes.get("/v1/subscription_items", (req, res) => {
  const subscriptionItemList = subscriptions.listItems(
    getRequestAccountId(req),
    req.query
  );
  return res.status(200).json(subscriptionItemList);
});

routes.get("/v1/subscription_items/:id", (req, res) => {
  const subscriptionItem = subscriptions.retrieveItem(
    getRequestAccountId(req),
    req.params.id,
    "id"
  );
  return res.status(200).json(subscriptionItem);
});

routes.post("/v1/subscription_items/:id", (req, res) => {
  const subscriptionItem = subscriptions.updateItem(
    getRequestAccountId(req),
    req.params.id,
    req.body
  );
  return res.status(200).json(subscriptionItem);
});

routes.post("/v1/tax_rates", (req, res) => {
  const taxRate = taxRates.create(getRequestAccountId(req), req.body);
  return res.status(200).json(taxRate);
});

routes.get("/v1/tax_rates", (req, res) => {
  const taxRate = taxRates.list(getRequestAccountId(req), req.query);
  return res.status(200).json(taxRate);
});

routes.get("/v1/tax_rates/:id", (req, res) => {
  const taxRate = taxRates.retrieve(
    getRequestAccountId(req),
    req.params.id,
    "id"
  );
  return res.status(200).json(taxRate);
});

routes.post("/v1/tax_rates/:id", (req, res) => {
  const taxRate = taxRates.update(
    getRequestAccountId(req),
    req.params.id,
    req.body
  );
  return res.status(200).json(taxRate);
});

routes.post("/v1/webhook_endpoints", (req, res) => {
  const webhookEndpoint = webhooks.create(getRequestAccountId(req), req.body);
  return res.status(200).json(webhookEndpoint);
});

routes.get("/v1/webhook_endpoints/:id", (req, res) => {
  const webhookEndpoint = webhooks.retrieve(
    getRequestAccountId(req),
    req.params.id,
    "id"
  );
  return res.status(200).json(webhookEndpoint);
});

routes.get("/v1/webhook_endpoints", (req, res) => {
  const webhookEndpoint = webhooks.list(getRequestAccountId(req), req.params);
  return res.status(200).json(webhookEndpoint);
});

routes.all("*", (req, res) => {
  return res.status(404).json({
    error: {
      type: "invalid_request_error",
      message: `No matching path: ${req.path}`,
    },
  });
});

export function getRequestAccountId(req: express.Request): string {
  const connectAccountId = req.header("stripe-account");
  if (connectAccountId) {
    accounts.retrieve(
      "acct_default",
      connectAccountId,
      auth.getCensoredAccessTokenFromRequest(req)
    );
    return connectAccountId;
  }
  return "acct_default";
}

export { routes };
