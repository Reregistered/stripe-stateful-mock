import Stripe from "stripe";
import { AccountData } from "./AccountData";
import { applyListOptions, generateId, stringifyMetadata } from "./utils";
import { verify } from "./verify";
import { RestError } from "./RestError";
import log = require("loglevel");

export namespace products {
  const accountProducts = new AccountData<Stripe.Product>();

  export function create(
    accountId: string,
    params: Stripe.ProductCreateParams
  ): Stripe.Product {
    log.debug("products.create", accountId, params);

    verify.requiredParams(params, ["name"]);
    if (params.type) {
      verify.requiredValue(params, "type", ["service", "good"]);
    }

    const productId = params.id || `prod_${generateId()}`;
    if (accountProducts.contains(accountId, productId)) {
      throw new RestError(400, {
        code: "resource_already_exists",
        doc_url: "https://stripe.com/docs/error-codes/resource-already-exists",
        message: `Product already exists.`,
        type: "invalid_request_error",
      });
    }

    const type = params.type ?? "service";
    const product: Stripe.Product = {
      id: productId,
      object: "product",
      active: params.active ?? true,
      attributes: params.attributes || [],
      created: (Date.now() / 1000) | 0,
      caption: type === "good" ? params.caption || null : undefined,
      deactivate_on: type === "good" ? params.deactivate_on || [] : undefined,
      deleted: undefined,
      description: params.description || null,
      images: params.images || [],
      livemode: false,
      metadata: stringifyMetadata(params.metadata),
      name: params.name,
      package_dimensions:
        type === "good" ? params.package_dimensions || null : undefined,
      shippable: type === "good" ? params.shippable || true : undefined,
      statement_descriptor: type === "good" ? undefined : null,
      tax_code: null,
      type: type,
      updated: (Date.now() / 1000) | 0,
      unit_label: params.unit_label || type === "good" ? undefined : null,
      url: type === "good" ? params.url || null : undefined,
    };

    accountProducts.put(accountId, product);
    return product;
  }

  export function retrieve(
    accountId: string,
    productId: string,
    paramName: string
  ): Stripe.Product {
    log.debug("products.retrieve", accountId, productId);

    const product = accountProducts.get(accountId, productId);
    if (!product) {
      throw new RestError(404, {
        code: "resource_missing",
        doc_url: "https://stripe.com/docs/error-codes/resource-missing",
        message: `No such product: ${productId}`,
        param: paramName,
        type: "invalid_request_error",
      });
    }
    return product;
  }

  export function list(
    accountId: string,
    params: Stripe.ProductListParams
  ): Stripe.ApiList<Stripe.Product> {
    log.debug("products.list", accountId, params);

    let data = accountProducts.getAll(accountId);
    if (params.active !== undefined) {
      data = data.filter((d) => d.active === params.active);
    }
    if (params.ids) {
      data = data.filter((d) => params.ids.indexOf(d.id) !== -1);
    }
    if (params.shippable !== undefined) {
      data = data.filter((d) => d.shippable === params.shippable);
    }
    if (params.url) {
      data = data.filter((d) => d.url === params.url);
    }
    if (params.type) {
      data = data.filter((d) => d.type === params.type);
    }
    return applyListOptions(data, params, (id, paramName) =>
      retrieve(accountId, id, paramName)
    );
  }
}
