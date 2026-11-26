import { NextResponse } from "next/server";
import { handleApiError, safeParseJson } from "@/lib/api-utils";
import { getProductById } from "@/lib/products";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTelegramUser } from "@/lib/telegram-auth";
import { createTelegramInvoiceLink } from "@/lib/telegram-bot";

interface CreateInvoiceBody {
  productId?: unknown;
}

export async function POST(req: Request) {
  try {
    const tgUser = await verifyTelegramUser(req);
    const body = await safeParseJson<CreateInvoiceBody>(req);
    const productId = typeof body?.productId === "string" ? body.productId : "";

    const product = getProductById(productId);
    if (!product) {
      return NextResponse.json({ error: "Invalid productId." }, { status: 400 });
    }

    const { data: userExists, error: userLookupError } = await supabaseAdmin
      .from("users")
      .select("telegram_id")
      .eq("telegram_id", tgUser.id)
      .maybeSingle();

    if (userLookupError) {
      throw new Error(`Failed to verify user: ${userLookupError.message}`);
    }
    if (!userExists) {
      return NextResponse.json(
        { error: "User not initialized. Call /api/auth/sync first." },
        { status: 404 }
      );
    }

    const payload = JSON.stringify({
      userId: tgUser.id,
      productId: product.id,
    });

    const invoiceLink = await createTelegramInvoiceLink({
      title: product.title,
      description: product.description,
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [
        {
          label: product.title,
          amount: product.starsAmount,
        },
      ],
    });

    return NextResponse.json({ invoiceLink, productId: product.id });
  } catch (error) {
    return handleApiError(error);
  }
}
