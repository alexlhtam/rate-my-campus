import { communityRoute } from "@/lib/community-server";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context) {
  const params = await context.params;
  return communityRoute(request, params.path);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
