import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { fetchMainRubrics, fetchRubricChildren } from "@/lib/fourpartners";

function devSkipAuth(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.COMPARE_SKIP_AUTH === "1"
  );
}

/**
 * POST { token: string, parentId: number | null }
 * parentId == null — верхний уровень (/rubric/main), иначе — дочерние (/rubric/child/:id).
 */
export async function POST(req: NextRequest) {
  if (!devSkipAuth()) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    parentId?: number | null;
  };

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (token.length < 12) {
    return NextResponse.json(
      { error: "Укажите ключ API (не короче 12 символов)" },
      { status: 400 }
    );
  }

  const parentId =
    body.parentId === null || body.parentId === undefined
      ? null
      : Number(body.parentId);
  if (parentId != null && (!Number.isFinite(parentId) || parentId < 1)) {
    return NextResponse.json({ error: "Некорректный parentId" }, { status: 400 });
  }

  try {
    const rubrics =
      parentId == null
        ? await fetchMainRubrics(token)
        : await fetchRubricChildren(token, parentId);
    return NextResponse.json({ rubrics });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка загрузки рубрик";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
