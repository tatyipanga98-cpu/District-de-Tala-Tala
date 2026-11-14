
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers":
"authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedRoles = [
"community_clerk",
"community_leader",
"commission",
"commission_deputy",
];

function response(data: unknown, status = 200) {
return new Response(JSON.stringify(data), {
status,
headers: { ...corsHeaders, "Content-Type": "application/json" },
});
}

function temporaryPassword() {
const chars =
"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
const bytes = crypto.getRandomValues(new Uint8Array(20));
return Array.from(bytes, b => chars[b % chars.length]).join("");
}

Deno.serve(async (req) => {
if (req.method === "OPTIONS") {
return new Response("ok", { headers: corsHeaders });
}

if (req.method !== "POST") {
return response({ error: "Méthode non autorisée." }, 405);
}

const url = Deno.env.get("SUPABASE_URL");
const anonKey =
Deno.env.get("SUPABASE_ANON_KEY") ??
Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
const serviceKey =
Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
Deno.env.get("SUPABASE_SECRET_KEY");

if (!url || !anonKey || !serviceKey) {
return response({ error: "Configuration serveur incomplète." }, 500);
}

const authorization = req.headers.get("Authorization");
if (!authorization?.startsWith("Bearer ")) {
return response({ error: "Connexion requise." }, 401);
}

const callerClient = createClient(url, anonKey, {
global: { headers: { Authorization: authorization } },
auth: { persistSession: false, autoRefreshToken: false },
});

const { data: userData, error: userError } =
await callerClient.auth.getUser();

if (userError || !userData.user) {
return response({ error: "Session invalide." }, 401);
}

const adminClient = createClient(url, serviceKey, {
auth: { persistSession: false, autoRefreshToken: false },
});

const { data: profile, error: profileError } = await adminClient
.from("profiles")
.select("role, active")
.eq("id", userData.user.id)
.single();

if (
profileError ||
profile?.role !== "district_admin" ||
profile?.active !== true
) {
return response({ error: "Accès réservé à l'administrateur du district." }, 403);
}

let body: {
users?: Array<{
email: string;
display_name: string;
role: string;
community_id?: string | null;
}>;
reset_password?: { user_id?: string };
};

try {
body = await req.json();
} catch {
return response({ error: "Corps de requête invalide." }, 400);
}

// Réinitialisation du mot de passe d'un compte par l'administrateur (jamais le sien).
if (body.reset_password) {
const targetId = body.reset_password.user_id ?? "";
if (!/^[0-9a-f-]{36}$/i.test(targetId)) {
return response({ error: "Identifiant de compte invalide." }, 400);
}
if (targetId === userData.user.id) {
return response({ error: "Vous ne pouvez pas réinitialiser votre propre mot de passe ici." }, 400);
}
const { data: target, error: targetError } = await adminClient
.from("profiles")
.select("id, display_name")
.eq("id", targetId)
.maybeSingle();
if (targetError) {
return response({ error: "Impossible de vérifier ce compte." }, 500);
}
if (!target) {
return response({ error: "Compte introuvable." }, 404);
}
const newPassword = temporaryPassword();
const { error: updError } = await adminClient.auth.admin.updateUserById(targetId, { password: newPassword });
if (updError) {
return response({ error: "Réinitialisation impossible : " + updError.message }, 500);
}
const { error: flagError } = await adminClient
.from("profiles")
.update({ must_change_password: true })
.eq("id", targetId);
if (flagError) {
return response({ error: "Mot de passe modifié mais le profil n'a pas pu être marqué. Renouvelez l'opération." }, 500);
}
return response({
message: "Mot de passe provisoire généré. Transmettez-le de façon confidentielle.",
user_id: targetId,
display_name: target.display_name,
temporary_password: newPassword,
});
}

if (
!Array.isArray(body.users) ||
body.users.length < 1 ||
body.users.length > 18
) {
return response({ error: "Fournissez entre 1 et 18 utilisateurs." }, 400);
}

const emails = body.users.map(u => u.email?.trim().toLowerCase());

if (
emails.some(e => !e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) ||
new Set(emails).size !== emails.length
) {
return response({ error: "Adresses e-mail invalides ou répétées." }, 400);
}

const communityRoles = ["community_clerk", "community_leader"];

for (const u of body.users) {
if (
!u.display_name?.trim() ||
!allowedRoles.includes(u.role) ||
(communityRoles.includes(u.role) && !u.community_id) ||
(!communityRoles.includes(u.role) && u.community_id)
) {
return response({
error: "Nom, rôle ou communauté invalide. Aucun compte créé.",
}, 400);
}
}

const { data: communities, error: communitiesError } =
await adminClient.from("communities").select("id");

if (communitiesError) {
return response({ error: "Impossible de vérifier les communautés." }, 500);
}

const communityIds = new Set((communities ?? []).map(c => c.id));

if (
body.users.some(
u => communityRoles.includes(u.role) &&
!communityIds.has(u.community_id)
)
) {
return response({ error: "Identifiant de communauté inconnu." }, 400);
}

const created: Array<{
email: string;
display_name: string;
role: string;
temporary_password: string;
}> = [];

for (let i = 0; i < body.users.length; i++) {
const u = body.users[i];
const email = emails[i];
const password = temporaryPassword();

const { data: authData, error: authError } =
await adminClient.auth.admin.createUser({
email,
password,
email_confirm: true,
});

if (authError || !authData.user) {
return response({
error: "Création interrompue. Certains comptes précédents peuvent déjà exister.",
created,
failed_email: email,
detail: authError?.message ?? "Utilisateur non créé.",
}, 400);
}

const { error: insertError } = await adminClient
.from("profiles")
.insert({
id: authData.user.id,
display_name: u.display_name.trim(),
role: u.role,
community_id: u.community_id ?? null,
active: true,
must_change_password: true,
});

if (insertError) {
await adminClient.auth.admin.deleteUser(authData.user.id);
return response({
error: "Création du profil impossible. Le compte concerné a été supprimé.",
created,
failed_email: email,
}, 500);
}

created.push({
email,
display_name: u.display_name.trim(),
role: u.role,
temporary_password: password,
});
}

return response({
message: "Comptes créés. Transmettez les mots de passe temporairement générés de façon confidentielle.",
created,
});
});
