export type PhoneNormalizationErrorCode =
  | "PHONE_REQUIRED"
  | "PHONE_UNSUPPORTED_COUNTRY"
  | "PHONE_INVALID_LENGTH"
  | "PHONE_INVALID_INDIAN_MOBILE";

export type PhoneNormalizationResult =
  | {
      ok: true;
      phoneNormalized: string;
      nationalNumber: string;
      countryCode: "91";
    }
  | {
      ok: false;
      code: PhoneNormalizationErrorCode;
      message: string;
    };

export function normalizeIndianMobilePhone(rawPhone: string): PhoneNormalizationResult {
  const trimmed = rawPhone.trim();

  if (!trimmed) {
    return {
      ok: false,
      code: "PHONE_REQUIRED",
      message: "Phone number is required.",
    };
  }

  let digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+") && !digits.startsWith("91")) {
    return {
      ok: false,
      code: "PHONE_UNSUPPORTED_COUNTRY",
      message: "Only Indian phone numbers are supported in the current CRM phase.",
    };
  }

  if (digits.startsWith("0091")) {
    digits = digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    digits = `91${digits.slice(1)}`;
  }

  if (digits.length === 10) {
    digits = `91${digits}`;
  }

  if (digits.length !== 12 || !digits.startsWith("91")) {
    return {
      ok: false,
      code: "PHONE_INVALID_LENGTH",
      message: "Phone number must be a 10 digit Indian mobile number or +91 format.",
    };
  }

  const nationalNumber = digits.slice(2);

  if (!/^[6-9]\d{9}$/.test(nationalNumber)) {
    return {
      ok: false,
      code: "PHONE_INVALID_INDIAN_MOBILE",
      message: "Indian mobile numbers must start with 6, 7, 8, or 9.",
    };
  }

  return {
    ok: true,
    phoneNormalized: `+${digits}`,
    nationalNumber,
    countryCode: "91",
  };
}
