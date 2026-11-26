interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface InvoicePrice {
  label: string;
  amount: number;
}

export interface CreateInvoiceLinkParams {
  title: string;
  description: string;
  payload: string;
  currency: "XTR";
  provider_token: "";
  prices: InvoicePrice[];
}

function getRequiredBotToken(): string {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error("Missing BOT_TOKEN environment variable.");
  }
  return token;
}

async function callTelegramBotApi<T>(
  method: string,
  body: Record<string, unknown>,
  timeoutMs = 8000
): Promise<T> {
  const token = getRequiredBotToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const data = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !data.ok || data.result === undefined) {
    throw new Error(
      `Telegram API ${method} failed (${data.error_code ?? response.status}): ${
        data.description ?? "Unknown error"
      }`
    );
  }

  return data.result;
}

export async function createTelegramInvoiceLink(
  params: CreateInvoiceLinkParams
): Promise<string> {
  return callTelegramBotApi<string>("createInvoiceLink", {
    title: params.title,
    description: params.description,
    payload: params.payload,
    provider_token: params.provider_token,
    currency: params.currency,
    prices: params.prices,
  });
}

export async function answerPreCheckoutQuery(
  preCheckoutQueryId: string,
  ok: boolean,
  errorMessage?: string
): Promise<boolean> {
  return callTelegramBotApi<boolean>("answerPreCheckoutQuery", {
    pre_checkout_query_id: preCheckoutQueryId,
    ok,
    ...(ok ? {} : { error_message: errorMessage ?? "Payment verification failed." }),
  });
}

export interface InlineKeyboardButton {
  text: string;
  web_app?: { url: string };
  url?: string;
  callback_data?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  options?: {
    parseMode?: "HTML" | "MarkdownV2";
    replyMarkup?: InlineKeyboardMarkup;
  }
): Promise<boolean> {
  try {
    if (!process.env.BOT_TOKEN) {
      return false;
    }
    await callTelegramBotApi(
      "sendMessage",
      {
        chat_id: chatId,
        text,
        ...(options?.parseMode ? { parse_mode: options.parseMode } : {}),
        ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      },
      4000
    );
    return true;
  } catch (err) {
    console.warn(`[telegram-bot] Failed to send message to ${chatId}:`, err);
    return false;
  }
}
