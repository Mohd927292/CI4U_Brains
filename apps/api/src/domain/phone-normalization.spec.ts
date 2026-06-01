import { describe, expect, it } from "vitest";
import { normalizeIndianMobilePhone } from "./phone-normalization";

describe("normalizeIndianMobilePhone", () => {
  it.each([
    "98765 43210",
    "+91 9876543210",
    "09876543210",
    "91-9876543210",
    "0091 9876543210",
  ])("normalizes %s to E.164", (rawPhone) => {
    const result = normalizeIndianMobilePhone(rawPhone);

    expect(result).toEqual({
      ok: true,
      phoneNormalized: "+919876543210",
      nationalNumber: "9876543210",
      countryCode: "91",
    });
  });

  it("rejects empty phone numbers", () => {
    expect(normalizeIndianMobilePhone("")).toMatchObject({
      ok: false,
      code: "PHONE_REQUIRED",
    });
  });

  it("rejects non-Indian country codes in the current CRM phase", () => {
    expect(normalizeIndianMobilePhone("+1 202 555 0198")).toMatchObject({
      ok: false,
      code: "PHONE_UNSUPPORTED_COUNTRY",
    });
  });

  it("rejects invalid Indian mobile prefixes", () => {
    expect(normalizeIndianMobilePhone("1234567890")).toMatchObject({
      ok: false,
      code: "PHONE_INVALID_INDIAN_MOBILE",
    });
  });
});
