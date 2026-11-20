import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://ronan2010raf-create.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getKeyFromEnv(name: string, legacyName: string): string | null {
  const raw = Deno.env.get(name);
  if (raw) {
    try {
      const keys = JSON.parse(raw);
      if (typeof keys.default === "string" && keys.default) return keys.default;
    } catch {
      // Fall back to legacy environment variable below.
    }
  }
  return Deno.env.get(legacyName) || null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && origin !== ALLOWED_ORIGIN) {
    return jsonResponse({ error: "Origem não autorizada." }, 403);
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const authorization = req.headers.get("Authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? [authorization.slice(0, 7), authorization.slice(7).trim()] : null;
  if (!bearer || !bearer[1]) {
    return jsonResponse({ error: "Faça login como administrador para continuar." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = getKeyFromEnv("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = getKeyFromEnv("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error("Variáveis obrigatórias do Supabase não estão disponíveis.");
    return jsonResponse({ error: "Configuração interna da função incompleta." }, 500);
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(bearer[1]);
  if (authError || !authData.user) {
    return jsonResponse({ error: "Sessão inválida. Entre novamente no aplicativo." }, 401);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Confere a permissão usando a sessão autenticada do próprio administrador.
  // O RPC é SECURITY DEFINER e já é utilizado pelo aplicativo principal.
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${bearer[1]}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: workspaceId, error: workspaceError }, { data: userRole, error: roleError }] =
    await Promise.all([
      userClient.rpc("get_souza_workspace_id"),
      userClient.rpc("get_souza_user_role"),
    ]);

  if (workspaceError || roleError) {
    console.error("Falha ao consultar perfil do administrador:", {
      workspaceError: workspaceError?.message || null,
      roleError: roleError?.message || null,
    });
    return jsonResponse({
      error: "Não foi possível consultar seu perfil no estoque. Confira se sua conta está vinculada ao estoque compartilhado e tente novamente.",
    }, 500);
  }

  if (!workspaceId || userRole !== "owner") {
    return jsonResponse({ error: "Somente o administrador principal pode criar usuários." }, 403);
  }

  let payload: { displayName?: unknown; email?: unknown; password?: unknown; role?: unknown };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Dados enviados em formato inválido." }, 400);
  }

  const displayName = typeof payload.displayName === "string" ? payload.displayName.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const role = payload.role;

  if (!displayName || displayName.length > 80) {
    return jsonResponse({ error: "Informe o nome do usuário (até 80 caracteres)." }, 400);
  }
  if (!email.includes("@") || !email.split("@")[1]?.includes(".") || email.length > 254) {
    return jsonResponse({ error: "Informe um e-mail válido para usar como login." }, 400);
  }
  if (password.length < 8 || password.length > 72) {
    return jsonResponse({ error: "A senha deve ter entre 8 e 72 caracteres." }, 400);
  }
  if (role !== "partner" && role !== "collaborator") {
    return jsonResponse({ error: "Selecione Sócio ou Colaborador." }, 400);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: displayName, created_by_souza_owner: true },
  });

  if (createError || !created.user) {
    const message = createError?.message || "O Supabase não retornou o usuário criado.";
    const duplicate = /already|registered|exists/i.test(message);
    return jsonResponse({
      error: duplicate
        ? "Este e-mail já possui uma conta no Supabase. Não é necessário criar outra; verifique o acesso existente."
        : "O Supabase não conseguiu criar a conta. Confira o e-mail e tente novamente.",
    }, duplicate ? 409 : 400);
  }

  const { error: memberInsertError } = await admin
    .from("souza_sports_workspace_members")
    .insert({
      workspace_id: workspaceId,
      user_id: created.user.id,
      role,
    });

  if (memberInsertError) {
    const { error: rollbackError } = await admin.auth.admin.deleteUser(created.user.id);
    if (rollbackError) console.error("Falha ao desfazer conta sem vínculo:", rollbackError.message);

    console.error("Falha ao vincular usuário ao estoque:", memberInsertError.message);
    if (role === "partner") {
      return jsonResponse({
        error: "A conta não foi vinculada. Para criar um Sócio, execute primeiro o script supabase-partner-role.sql no SQL Editor do Supabase. Nenhuma conta incompleta foi mantida.",
      }, 400);
    }
    return jsonResponse({
      error: "A conta não pôde ser vinculada ao estoque. Confira a configuração do banco de dados e tente novamente.",
    }, 400);
  }

  return jsonResponse({
    success: true,
    user: { id: created.user.id, email: created.user.email },
    role,
  });
});
