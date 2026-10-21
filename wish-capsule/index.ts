
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const OWNER_ID = Deno.env.get("OWNER_USER_ID")!;
const WRITER_ID = Deno.env.get("WRITER_USER_ID")!;
const WRITER_EMAIL = Deno.env.get("WRITER_EMAIL")!;
const INVITE_HASH = Deno.env.get("INVITE_TOKEN_SHA256")!;
const CODE_HASH = Deno.env.get("ACCESS_CODE_SHA256")!;

const admin = createClient(URL, SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function equalHex(a: string, b: string) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < 64; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function authenticatedUser(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;

  const client = createClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: header } },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

async function 
async function getWish() {
  const { data, error } = await admin.rpc("get_sealed_wish");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    id: row.wish_id,
    writer_id: row.writer_id,
    wish_text: row.wish_text,
    created_at: row.created_at,
    unlock_at: row.unlock_at,
  };
}
 {
  const { data, error } = await admin
    .schema("private")
    .from("wishes")
    .select("id, writer_id, wish_text, created_at, unlock_at")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const action = body?.action;

    // Exchange the invitation and code for a one-time Supabase sign-in token.
    if (action === "writer-login") {
      const invite = String(body.invite ?? "");
      const code = String(body.code ?? "");

      if (
        invite.length < 32 ||
        code.length < 12 ||
        !equalHex(await sha256(invite), INVITE_HASH) ||
        !equalHex(await sha256(code), CODE_HASH)
      ) {
        return reply({ error: "Invalid invitation or access code." }, 401);
      }

      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: WRITER_EMAIL,
      });

      if (error || !data.properties?.hashed_token) {
        console.error("Could not create writer sign-in token");
        return reply({ error: "Sign-in is temporarily unavailable." }, 500);
      }

      if (data.user.id !== WRITER_ID) {
        console.error("Writer account ID mismatch");
        return reply({ error: "Writer account is not configured." }, 500);
      }

      return reply({
        token_hash: data.properties.hashed_token,
        type: data.properties.verification_type ?? "magiclink",
      });
    }

    // All remaining actions require an authenticated account.
    const user = await authenticatedUser(req);
    if (!user) return reply({ error: "Sign in required." }, 401);

    const isOwner = user.id === OWNER_ID;
    const isWriter = user.id === WRITER_ID;

    if (!isOwner && !isWriter) {
      return reply({ error: "Not authorized." }, 403);
    }

    if (action === "status") {
      const wish = await getWish();

      if (!wish) return reply({ exists: false });

      const unlocked = Date.now() >= Date.parse(wish.unlock_at);

      return reply({
        exists: true,
        unlocked: isOwner || unlocked,
        created_at: wish.created_at,
        unlock_at: wish.unlock_at,
      });
    }

    if (action === "create") {
      if (!isWriter) return reply({ error: "Writer only." }, 403);

      const wishText = String(body.wish ?? "");
      if (!wishText.trim() || wishText.length > 10000) {
        return reply({ error: "Write a wish of up to 10,000 characters." }, 400);
      }

      const { data, error } = await admin.rpc("create_sealed_wish", {
        p_writer_id: user.id,
        p_wish_text: wishText,
      });

      if (error) {
        if (error.code === "23505") {
          return reply({ error: "A wish has already been sealed." }, 409);
        }
        console.error("Wish creation failed", error.code);
        return reply({ error: "Could not seal the wish." }, 500);
      }

      const row = Array.isArray(data) ? data[0] : data;
      return reply({
        success: true,
        created_at: row.created_at,
        unlock_at: row.unlock_at,
      });
    }

    if (action === "open") {
      const wish = await getWish();
      if (!wish) return reply({ error: "No wish has been sealed yet." }, 404);

      if (wish.writer_id !== WRITER_ID) {
        return reply({ error: "Not authorized." }, 403);
      }

      if (!isOwner && Date.now() < Date.parse(wish.unlock_at)) {
        return reply({
          error: "This wish is still sealed.",
          unlock_at: wish.unlock_at,
        }, 403);
      }

      return reply({
        wish: wish.wish_text,
        created_at: wish.created_at,
        unlock_at: wish.unlock_at,
      });
    }

    return reply({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("Wish API error", error);
    return reply({ error: "An unexpected error occurred." }, 500);
  }
});
