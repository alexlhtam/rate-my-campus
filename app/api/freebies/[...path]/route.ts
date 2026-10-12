import {freebiesRoute} from '@/lib/freebies/server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=300;
type Context={params:Promise<{path:string[]}>};
export async function GET(request:Request,context:Context){return freebiesRoute(request,(await context.params).path);}
export async function POST(request:Request,context:Context){return freebiesRoute(request,(await context.params).path);}
