import crypto from "node:crypto";

export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60; // 24 hours
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 300; // 5 minutes tolerance

export interface VerifiedTelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
  auth_date: number;
  start_param: string | null;
}

export class TelegramAuthError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = "TelegramAuthError";
    this.statusCode = statusCode;
  }
}

function getBotToken(): string {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new TelegramAuthError("Server BOT_TOKEN is not configured.", 500);
  }
  return token;
}

/**
 * Strictly validates Telegram Mini App initData using HMAC-SHA256
 * as specified in Telegram's official Mini Apps documentation.
 */
export function validateTelegramInitData(
  initData: string,
  botToken = getBotToken(),
  nowSeconds = Math.floor(Date.now() / 1000)
): VerifiedTelegramUser {
  if (!initData || typeof initData !== "string") {
    throw new TelegramAuthError("Missing Telegram initData.");
  }

  const params = new URLSearchParams(initData.trim());
  const hash = params.get("hash");

  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    throw new TelegramAuthError("Missing or malformed Telegram initData hash.");
  }

  const authDateRaw = params.get("auth_date");
  const authDate = Number(authDateRaw);
  if (!authDateRaw || !Number.isInteger(authDate) || authDate <= 0) {
    throw new TelegramAuthError("Invalid auth_date in Telegram initData.");
  }

  if (nowSeconds - authDate > INIT_DATA_MAX_AGE_SECONDS) {
    throw new TelegramAuthError("Telegram initData expired (older than 24 hours).");
  }

  if (authDate - nowSeconds > MAX_FUTURE_CLOCK_SKEW_SECONDS) {
    throw new TelegramAuthError("Telegram initData auth_date is in the future.");
  }

  const pairs: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    if (key !== "hash") {
      pairs.push([key, value]);
    }
  }

  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest();

  const providedHash = Buffer.from(hash, "hex");
  if (
    providedHash.length !== expectedHash.length ||
    !crypto.timingSafeEqual(providedHash, expectedHash)
  ) {
    throw new TelegramAuthError("Invalid Telegram initData signature.");
  }

  const rawUser = params.get("user");
  if (!rawUser) {
    throw new TelegramAuthError("Missing user payload in Telegram initData.");
  }

  let parsedUser: Record<string, unknown>;
  try {
    parsedUser = JSON.parse(rawUser) as Record<string, unknown>;
  } catch {
    throw new TelegramAuthError("Malformed user JSON in Telegram initData.");
  }

  const id = parsedUser.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new TelegramAuthError("Invalid user id in Telegram initData.");
  }

  const firstName =
    typeof parsedUser.first_name === "string" && parsedUser.first_name.trim().length > 0
      ? parsedUser.first_name.trim()
      : "CyberRunner";

  return {
    id,
    first_name: firstName,
    last_name: typeof parsedUser.last_name === "string" ? parsedUser.last_name : undefined,
    username: typeof parsedUser.username === "string" ? parsedUser.username : undefined,
    language_code:
      typeof parsedUser.language_code === "string" ? parsedUser.language_code : undefined,
    is_premium: typeof parsedUser.is_premium === "boolean" ? parsedUser.is_premium : undefined,
    photo_url: typeof parsedUser.photo_url === "string" ? parsedUser.photo_url : undefined,
    auth_date: authDate,
    start_param: params.get("start_param"),
  };
}

/**
 * Extracts `Authorization: tma <initData>` from an incoming Request,
 * verifies the HMAC-SHA256 hash and 24-hour expiration, and returns the verified Telegram user.
 */
export async function verifyTelegramUser(req: Request): Promise<VerifiedTelegramUser> {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader) {
    throw new TelegramAuthError("Missing Authorization header.");
  }

  const match = authHeader.match(/^tma\s+(.+)$/i);
  if (!match || !match[1]) {
    throw new TelegramAuthError("Authorization header must use format: tma <initData>.");
  }

  return validateTelegramInitData(match[1]);
}
