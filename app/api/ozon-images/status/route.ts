import { NextResponse } from "next/server";
import {
  getOzonStorageBackend,
  storageBackendLabel
} from "@/lib/ozonImageStorage";

export async function GET() {
  const backend = getOzonStorageBackend();
  return NextResponse.json({
    configured: backend !== null,
    backend,
    label: storageBackendLabel(),
    recommended: backend === "yandex"
  });
}
