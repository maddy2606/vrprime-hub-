import "server-only";
import { getActiveUser } from "@/lib/auth";

/**
 * The WhatsApp routes are for the owner only, and only from this site's own pages: a request another site makes the
 * browser send is refused (the browser marks it as cross-site).
 */
export async function ownerOnly(request: Request): Promise<Response | null> {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return Response.json({ ok: false, text: "Not allowed." }, { status: 403 });
  const user = await getActiveUser();
  if (!user) return Response.json({ ok: false, text: "Sign in again." }, { status: 401 });
  if (user.role !== "owner") return Response.json({ ok: false, text: "Only the owner can do this." }, { status: 403 });
  return null;
}
