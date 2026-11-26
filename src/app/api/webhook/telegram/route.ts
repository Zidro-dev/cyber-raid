import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { adjustUserBalance } from "@/lib/api-utils";
import {
  calculateItemPowerBonus,
  generateItemName,
  grantItemWithAutoEquip,
} from "@/lib/game-logic";
import { getProductById } from "@/lib/products";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { answerPreCheckoutQuery, sendTelegramMessage } from "@/lib/telegram-bot";
import type { ProductId, UserRow } from "@/types/game";

interface InvoicePayload {
  userId?: number;
  productId?: string;
}

interface TelegramPreCheckoutQuery {
  id: string;
  from: { id: number };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

interface TelegramSuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
}

interface TelegramUpdate {
  update_id?: number;
  pre_checkout_query?: TelegramPreCheckoutQuery;
  message?: {
    message_id?: number;
    text?: string;
    from?: { id: number; first_name?: string; username?: string };
    chat?: { id: number };
    successful_payment?: TelegramSuccessfulPayment;
  };
}

const MINI_APP_URL = "https://cyber-raid-green.vercel.app";
const LAUNCH_COMMAND_REGEX = /^\/(?:start|play)(?:@[A-Za-z0-9_]+)?(?:\s+(.*))?$/i;

function parseInvoicePayload(raw: string): InvoicePayload | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      userId: typeof parsed.userId === "number" ? parsed.userId : undefined,
      productId: typeof parsed.productId === "string" ? parsed.productId : undefined,
    };
  } catch {
    return null;
  }
}

function verifyWebhookSecret(req: Request): boolean {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return true;
  }

  const incomingSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!incomingSecret) {
    return false;
  }

  const expectedBuf = Buffer.from(configuredSecret, "utf8");
  const actualBuf = Buffer.from(incomingSecret, "utf8");
  return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
}

async function extendUserTimestampField(
  userId: number,
  field: "vip_until" | "shield_until",
  durationMs: number
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: userData, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("telegram_id, vip_until, shield_until")
      .eq("telegram_id", userId)
      .single();

    if (fetchError || !userData) {
      throw new Error(`User ${userId} not found when extending ${field}`);
    }

    const row = userData as Pick<UserRow, "telegram_id" | "vip_until" | "shield_until">;
    const nowMs = Date.now();
    const currentValue = row[field];
    const baseMs =
      currentValue && new Date(currentValue).getTime() > nowMs
        ? new Date(currentValue).getTime()
        : nowMs;
    const nextIso = new Date(baseMs + durationMs).toISOString();

    let query = supabaseAdmin
      .from("users")
      .update({ [field]: nextIso })
      .eq("telegram_id", userId);

    query = currentValue === null ? query.is(field, null) : query.eq(field, currentValue);

    const { data: updated, error: updateError } = await query.select("telegram_id").maybeSingle();
    if (updateError) {
      throw new Error(`Failed updating ${field}: ${updateError.message}`);
    }
    if (updated) {
      return nextIso;
    }
  }

  throw new Error(`Concurrent conflict while updating ${field} for user ${userId}`);
}

async function applyProductReward(userId: number, productId: ProductId): Promise<string> {
  const { data: userData, error: userError } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("telegram_id", userId)
    .single();

  if (userError || !userData) {
    throw new Error(`User ${userId} not found for reward fulfillment.`);
  }

  const user = userData as UserRow;

  switch (productId) {
    case "starter_pack": {
      await adjustUserBalance(userId, { coresDelta: 500 });
      const epicWeaponPower = calculateItemPowerBonus(user.farm_level, "epic");
      const epicWeaponName = generateItemName("weapon", "epic");
      const granted = await grantItemWithAutoEquip({
        userId,
        slot: "weapon",
        rarity: "epic",
        name: epicWeaponName,
        powerBonus: epicWeaponPower,
      });
      return (
        `+500 Quantum Cores & Epic Weapon [${granted.item.name}] (+${granted.item.power_bonus} PWR)` +
        (granted.autoEquipped ? " — Auto-Equipped!" : " — Added to Inventory!")
      );
    }

    case "vip_30d": {
      const nextVip = await extendUserTimestampField(
        userId,
        "vip_until",
        30 * 24 * 60 * 60 * 1000
      );
      return `VIP Neural Link active until ${new Date(nextVip).toUTCString()} (24h offline storage unlocked).`;
    }

    case "shield_24h": {
      const nextShield = await extendUserTimestampField(
        userId,
        "shield_until",
        24 * 60 * 60 * 1000
      );
      return `Aegis Energy Shield active until ${new Date(nextShield).toUTCString()}.`;
    }

    case "premium_10x": {
      await adjustUserBalance(userId, { coresDelta: 600 });
      return `+600 Quantum Cores added to your account.`;
    }
  }
}

export async function POST(req: Request) {
  try {
    if (!verifyWebhookSecret(req)) {
      return NextResponse.json({ error: "Invalid webhook secret." }, { status: 401 });
    }

    const update = (await req.json()) as TelegramUpdate;

    // 1. Pre-checkout query handling
    if (update.pre_checkout_query) {
      const preCheckout = update.pre_checkout_query;
      const parsed = parseInvoicePayload(preCheckout.invoice_payload);
      const product = parsed?.productId ? getProductById(parsed.productId) : null;

      if (
        !product ||
        preCheckout.currency !== "XTR" ||
        preCheckout.total_amount !== product.starsAmount
      ) {
        await answerPreCheckoutQuery(
          preCheckout.id,
          false,
          "Invalid product or payment amount."
        );
        return NextResponse.json({ ok: true, preCheckoutAccepted: false });
      }

      await answerPreCheckoutQuery(preCheckout.id, true);
      return NextResponse.json({ ok: true, preCheckoutAccepted: true });
    }

    // 2. Successful payment fulfillment with strict idempotency
    const payment = update.message?.successful_payment;
    if (payment) {
      const chargeId = payment.telegram_payment_charge_id;
      if (!chargeId) {
        return NextResponse.json(
          { error: "Missing telegram_payment_charge_id." },
          { status: 400 }
        );
      }

      const parsed = parseInvoicePayload(payment.invoice_payload);
      const userId = parsed?.userId ?? update.message?.from?.id;
      const product = parsed?.productId ? getProductById(parsed.productId) : null;

      if (!userId || !product) {
        console.error("[webhook/telegram] Unrecognized payment payload:", payment.invoice_payload);
        return NextResponse.json({ ok: true, ignored: "unrecognized_payload" });
      }

      if (payment.currency !== "XTR" || payment.total_amount !== product.starsAmount) {
        console.error("[webhook/telegram] Payment amount/currency mismatch:", payment);
        return NextResponse.json({ ok: true, ignored: "amount_mismatch" });
      }

      // Check idempotency first
      const { data: existingTx, error: txLookupError } = await supabaseAdmin
        .from("transactions")
        .select("id, status")
        .eq("telegram_charge_id", chargeId)
        .maybeSingle();

      if (txLookupError) {
        throw new Error(`Failed to check existing transaction: ${txLookupError.message}`);
      }

      if (existingTx) {
        return NextResponse.json({ ok: true, duplicate: true });
      }

      const txId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      // Insert transaction row first; UNIQUE constraint on telegram_charge_id blocks concurrent duplicates
      const { error: txInsertError } = await supabaseAdmin.from("transactions").insert({
        id: txId,
        user_id: userId,
        telegram_charge_id: chargeId,
        product_id: product.id,
        stars_amount: payment.total_amount,
        status: "processing",
        created_at: nowIso,
      });

      if (txInsertError) {
        if (txInsertError.code === "23505") {
          return NextResponse.json({ ok: true, duplicate: true });
        }
        throw new Error(`Failed to record transaction: ${txInsertError.message}`);
      }

      try {
        const rewardSummary = await applyProductReward(userId, product.id);

        const { error: finalizeError } = await supabaseAdmin
          .from("transactions")
          .update({ status: "completed" })
          .eq("id", txId);

        if (finalizeError) {
          console.error(
            `[webhook/telegram] Reward applied but failed to mark tx ${txId} completed:`,
            finalizeError
          );
        }

        await sendTelegramMessage(
          userId,
          `✅ Payment Confirmed: ${product.title} (${payment.total_amount} ⭐)\n\n${rewardSummary}`
        );

        return NextResponse.json({ ok: true, fulfilled: true, productId: product.id });
      } catch (fulfillError) {
        // Roll back the processing row so Telegram retries can cleanly succeed
        await supabaseAdmin.from("transactions").delete().eq("id", txId);
        throw fulfillError;
      }
    }

    // 3. Bot command handling (/start, /start <ref>, /play)
    const messageText = update.message?.text?.trim();
    const chatId = update.message?.chat?.id ?? update.message?.from?.id;
    if (messageText && chatId) {
      const commandMatch = messageText.match(LAUNCH_COMMAND_REGEX);
      if (commandMatch) {
        const referralCode = commandMatch[1]?.trim();
        const welcomeText = referralCode
          ? `⚡ NEURAL LINK ONLINE — Welcome to CYBER RAID.\n\nUpgrade your credit farm, crack Gacha capsules, and raid rival sectors for loot. Referral signal [${referralCode}] detected.\n\nTap below to deploy into the grid:`
          : `⚡ NEURAL LINK ONLINE — Welcome to CYBER RAID.\n\nUpgrade your credit farm, crack Gacha capsules, and raid rival sectors for loot.\n\nTap below to deploy into the grid:`;

        await sendTelegramMessage(chatId, welcomeText, {
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: "⚡ Launch Neon Raid",
                  web_app: { url: MINI_APP_URL },
                },
              ],
            ],
          },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[webhook/telegram] Error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
