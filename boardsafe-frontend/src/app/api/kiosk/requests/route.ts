import { proxyKiosk } from "@/lib/server/kioskProxy";

export async function POST(request: Request) {
  return proxyKiosk(request, "requests");
}
