import Stripe from "stripe";
import { generateId } from "./utils";
import log = require("loglevel");

export namespace cards {
  export interface CardExtra {
    sourceToken: string;
  }

  const cardExtras: { [cardId: string]: CardExtra } = {};

  export function createFromSource(token: string): Stripe.Card {
    log.debug("cards.createFromSource", token);

    let saveCard = true;
    const cardId = `card_${generateId(24)}`;
    const now = new Date();
    const card: Stripe.Card = {
      id: cardId,
      object: "card",
      address_city: null,
      address_country: null,
      address_line1: null,
      address_line1_check: null,
      address_line2: null,
      address_state: null,
      address_zip: null,
      address_zip_check: null,
      brand: "Unknown",
      country: "US",
      customer: null,
      cvc_check: null,
      dynamic_last4: null,
      exp_month: now.getMonth() + 1,
      exp_year: now.getFullYear() + 1,
      fingerprint: generateId(16),
      funding: "credit",
      last4: "XXXX",
      metadata: {},
      name: null,
      tokenization_method: null,
    };

    switch (token) {
      case "tok_visa":
        card.brand = "Visa";
        card.last4 = "4242";
        break;
      case "tok_visa_debit":
        card.brand = "Visa";
        card.last4 = "5556";
        break;
      case "tok_mastercard":
        card.brand = "MasterCard";
        card.last4 = "4444";
        break;
      case "tok_mastercard_debit":
        card.brand = "MasterCard";
        card.last4 = "3222";
        break;
      case "tok_mastercard_prepaid":
        card.brand = "MasterCard";
        card.last4 = "5100";
        break;
      case "tok_amex":
        card.brand = "American Express";
        card.last4 = "8431";
        break;
      case "tok_ca": // CRTC approved.
        card.brand = "Visa";
        card.last4 = "0000";
        card.country = "CA";
        break;
      case "tok_chargeCustomerFail":
        card.brand = "Visa";
        card.last4 = "0341";
        break;
      case "tok_riskLevelElevated":
        card.brand = "Visa";
        card.last4 = "9235";
        break;
      case "tok_chargeDeclined":
        card.brand = "Visa";
        card.last4 = "0002";
        break;
      case "tok_chargeDeclinedInsufficientFunds":
        card.brand = "Visa";
        card.last4 = "9995";
        break;
      case "tok_chargeDeclinedFraudulent":
        card.brand = "Visa";
        card.last4 = "0019";
        break;
      case "tok_chargeDeclinedIncorrectCvc":
        card.brand = "Visa";
        card.last4 = "0127";
        break;
      case "tok_chargeDeclinedExpiredCard":
        card.brand = "Visa";
        card.last4 = "0069";
        break;
      case "tok_chargeDeclinedProcessingError":
        card.brand = "Visa";
        card.last4 = "0119";
        break;
      case "tok_createDispute":
        card.brand = "Visa";
        card.last4 = "0259";
        break;
      case "tok_createDisputeProductNotReceived":
        card.brand = "Visa";
        card.last4 = "2685";
        break;
      case "tok_createDisputeInquiry":
        card.brand = "Visa";
        card.last4 = "1976";
        break;
      case "tok_forget":
        // Unofficial token.
        card.brand = "Visa";
        card.last4 = "1982";
        saveCard = false;
        break;
      default:
        throw new Error(`Unhandled source token '${token}'`);
    }

    if (saveCard) {
      cardExtras[card.id] = {
        sourceToken: token,
      };
    }

    return card;
  }

  export function getCardExtra(cardId: string): CardExtra {
    return cardExtras[cardId];
  }

  // based on the number, return the brand
  export function getCardBrand(
    cardNumber: string
  ): "visa" | "mastercard" | "amex" {
    const token = cardNumber.slice(-4);

    let card: "visa" | "mastercard" | "amex" = "visa";
    switch (token) {
      case "4242":
      case "0000":
      case "5556":
      case "9235":
      case "0341":
      case "0002":
      case "9995":
      case "0019":
      case "0127":
      case "0069":
      case "0119":
      case "0259":
      case "2685":
      case "1976":
      case "1982":
        card = "visa";
        break;
      case "4444":
      case "3222":
      case "5100":
        card = "mastercard";
        break;
      case "8431":
        card = "amex";
        break;
      default:
        throw new Error(`Unknown Card brand card: '${cardNumber}'`);
    }

    return card;
  }
}
