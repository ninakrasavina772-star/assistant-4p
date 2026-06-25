import { NextResponse } from "next/server";
import { searchLetualPhotosWithAi } from "@/lib/letualMainPhotoServer";

export const maxDuration = 300;

type SearchBody = {
  ean?: string | null;
  productName?: string;
  brandName?: string;
  openaiApiKey?: string;
};

export async function POST(req: Request) {
  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  try {
    const results = await searchLetualPhotosWithAi(
      body.ean ?? null,
      body.productName ?? "",
      body.brandName ?? "",
      body.openaiApiKey
    );
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
