/**
 * @franco/governed-browser — Constitutional Commit-Click Brake & Emerald-Border
 * Audit Core for Autonomous Browser Agents (CDP / Playwright / MCP / DSH).
 *
 * Zero dependencies. Enforces:
 * 1. Code-level Commit-Click Brake (RED): blocks Send/Pay/Submit/Delete/Authorize/Sign-in
 *    across English, French, and Spanish with NFD diacritic stripping & word-boundary matching.
 * 2. Constitutional Downgrade Rule: a forbidden label can ONLY be downgraded from RED by an
 *    EXACT match in the human-approved tiers.md policy file (substring GREEN never bypasses RED).
 * 3. Two-Stage Policy Promotion & Tamper Guard: agents can only propose rules to tiers.proposed.md;
 *    RAM hash verification discards unauthorized on-disk edits to tiers.md.
 * 4. Proactive Secret Redaction & SHA-256 Hash-Chained Audit Trail (audit.jsonl).
 * 5. Autonomy Efficiency KPI & Two-Section Accountability Report.
 */
import { existsSync, writeFileSync, mkdirSync, appendFileSync, readFileSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

export const GREEN = "GREEN";
export const SEMI = "SEMI-AUTOMATIC";
export const YELLOW = "YELLOW";
export const RED = "RED";

export const VALID_TIERS = new Set(["GREEN", "SEMI-AUTOMATIC", "SEMI", "YELLOW", "RED"]);
export const TIER_PRIORITY = { GREEN: 1, "SEMI-AUTOMATIC": 2, SEMI: 2, YELLOW: 3, RED: 4 };

export const SENSITIVE_SELECTOR_OR_LABEL =
  /pass|pwd|secret|token|key|cvv|cvc|cc-|card|tarjeta|carte|pin|otp|2fa|ssn|auth|code|codigo/i;

export const SENSITIVE_VALUE_RE =
  /(?:\bsk-(?:live|test|proj|ant)-[A-Za-z0-9_-]{8,}|\bsk-[A-Za-z0-9]{16,}|\bAIza[0-9A-Za-z_-]{30,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:\b\d[ -]*?){13,19}\b)/;

export const DANGEROUS_HREF_RE = /^\s*(?:javascript|data|vbscript):/i;

// Word-boundary FORBIDDEN committing verbs (EN / FR / ES), evaluated on normalizeText() output
export const FORBIDDEN_WORDS = [
  "envoyer", "enviar", "soumettre", "transmettre", "submit", "send",
  "publish", "publier", "publicar", "post", "share", "partager", "compartir",
  "reply", "repondre", "responder",
  "payer", "pagar", "pay", "payment", "paiement", "pago",
  "acheter", "comprar", "buy", "purchase", "checkout", "commander",
  "transfer", "transferer", "transferir", "virement", "wire",
  "subscribe", "abonner", "suscribir", "suscribirse", "donate", "donar", "donner",
  "withdraw", "retirer", "retirar",
  "signer", "firmar", "confirm", "confirmer", "confirmar",
  "valider", "validar", "validate", "authorize", "autoriser", "autorizar",
  "accept", "accepter", "aceptar", "allow", "grant", "accorder", "conceder",
  "supprimer", "eliminar", "borrar", "delete", "remove", "erase",
  "cancel", "annuler", "cancelar", "revoke", "revoquer", "revocar",
  "deactivate", "desactiver", "desactivar", "reset", "reinitialiser", "restablecer",
  "sign\\s?in", "log\\s?in", "login", "sign\\s?up", "log\\s?out", "logout", "sign\\s?out",
  "register", "registrar", "inscrire", "inscription",
  "connexion", "connecter", "deconnexion", "deconnecter",
  "iniciar\\s+sesion", "cerrar\\s+sesion", "entrar",
  "continue\\s+with", "continuer\\s+avec", "continuar\\s+con",
  "create", "creer", "crear",
];

export const FORBIDDEN_RE = new RegExp(
  `(?:^|[^a-z0-9])(?:${FORBIDDEN_WORDS.join("|")})(?=$|[^a-z0-9])`,
  "i"
);

/**
 * Unicode NFD normalization + diacritics & zero-width char removal — immune to macOS NFD vs Linux NFC and zero-width splitting.
 */
export function normalizeText(str) {
  return String(str || "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Determine whether a UI control label or metadata represents an irreversible/committing action.
 */
export function isForbiddenLabel(label, meta = {}) {
  if (meta && meta.isSubmit) return true;
  if (meta && meta.href && DANGEROUS_HREF_RE.test(String(meta.href))) return true;
  const norm = normalizeText(label);
  if (norm && FORBIDDEN_RE.test(norm)) return true;
  if (meta && meta.href && FORBIDDEN_RE.test(normalizeText(meta.href))) return true;
  return false;
}

/**
 * Proactive secret redaction driven by selector, label, DOM password type, or secret value pattern.
 */
export function redactFillValue(selector, label, value, res = {}) {
  const rawVal = String(value ?? "");
  if (
    (res && res.isPassword) ||
    SENSITIVE_SELECTOR_OR_LABEL.test(String(selector || "")) ||
    SENSITIVE_SELECTOR_OR_LABEL.test(String(label || "")) ||
    SENSITIVE_VALUE_RE.test(rawVal)
  ) {
    return "••• (sensitive — never logged)";
  }
  return rawVal.slice(0, 80);
}

/**
 * Parse a `tiers.md` policy string (`pattern -> TIER` or `pattern → TIER`) into rule objects.
 */
export function parseTiersMarkdown(raw) {
  const out = [];
  for (const line of String(raw || "").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(/→|->/).map((s) => s.trim());
    if (parts.length < 2) continue;
    const pattern = parts[0];
    let tier = parts.slice(1).join(" ").toUpperCase().trim();
    if (tier === "SEMI") tier = "SEMI-AUTOMATIC";
    if (pattern && VALID_TIERS.has(tier)) out.push({ pattern, tier });
  }
  return out;
}

export function loadTiersFromDisk(tiersFile) {
  try {
    if (tiersFile && existsSync(tiersFile)) {
      return parseTiersMarkdown(readFileSync(tiersFile, "utf8"));
    }
  } catch {}
  return [];
}

/**
 * Match a control label against user-configured tier rules.
 * Exact matches win; otherwise highest-priority substring match (>= 3 chars) wins.
 */
export function tierForLabel(label, rules = []) {
  const lab = normalizeText(label);
  if (!lab) return null;
  let exactMatchTier = null;
  let highestSubstringTier = null;
  for (const t of rules) {
    const pat = normalizeText(t.pattern);
    const tier = String(t.tier || "").toUpperCase();
    if (!pat || pat.length < 2 || !(tier in TIER_PRIORITY)) continue;
    if (lab === pat) {
      exactMatchTier = tier;
    } else if (pat.length >= 3 && lab.includes(pat)) {
      if (!highestSubstringTier || TIER_PRIORITY[tier] > TIER_PRIORITY[highestSubstringTier]) {
        highestSubstringTier = tier;
      }
    }
  }
  return exactMatchTier || highestSubstringTier;
}

/**
 * Constitutional Brake Resolution:
 * - A forbidden committing action defaults to RED.
 * - It can ONLY be downgraded by an EXACT normalized match in `rules` — a generic
 *   substring rule never disables the commit-click brake.
 */
export function resolveActionTier(label, rules = [], meta = {}) {
  const forbidden = isForbiddenLabel(label, meta);
  const override = tierForLabel(label, rules);
  const normLab = normalizeText(label);
  if (forbidden) {
    const hasExactOverride = rules.some(
      (r) =>
        normalizeText(r.pattern) === normLab &&
        (r.tier === "GREEN" || r.tier === "SEMI" || r.tier === "SEMI-AUTOMATIC" || r.tier === "YELLOW")
    );
    if (!hasExactOverride) return RED;
  }
  return override || (forbidden ? RED : SEMI);
}

/**
 * Evaluate a click intent with full YELLOW one-time step approval and RED brake enforcement.
 */
export function evaluateClickGate({ selector, label = "", isSubmit = false, href = "", rules = [], pendingYellow = null }) {
  const override = tierForLabel(label, rules);
  let tier = resolveActionTier(label, rules, { isSubmit, href });
  let consumedYellow = false;

  if (
    tier === YELLOW &&
    pendingYellow &&
    pendingYellow.selector === selector &&
    pendingYellow.label === label
  ) {
    tier = SEMI;
    consumedYellow = true;
  }

  const allowed = tier === GREEN || tier === SEMI || tier === "SEMI-AUTOMATIC";
  const status = tier === RED ? "BRAKED" : tier === YELLOW ? "PROPOSE_WAIT" : "ALLOWED";

  return {
    allowed,
    status,
    tier,
    selector,
    label,
    isSubmit: Boolean(isSubmit),
    href: String(href || ""),
    override,
    consumedYellow,
    reason:
      tier === RED
        ? override === RED
          ? "human override: RED"
          : "refused — final/legal/committing button"
        : tier === YELLOW
          ? "propose and wait for human step approval"
          : consumedYellow
            ? "human-approved YELLOW step executed as SEMI-AUTOMATIC"
            : override
              ? `human override: ${tier}`
              : "non-committing interaction — emerald border verification",
  };
}

/**
 * Append a SHA-256 hash-chained audit record to `audit.jsonl`.
 */
export function writeAuditEntry(auditFile, entry) {
  const dir = dirname(auditFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const isNew = !existsSync(auditFile);
  let prevHash = "";
  if (!isNew) {
    try {
      const lines = readFileSync(auditFile, "utf8").trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]);
        prevHash = last.hash || "";
      }
    } catch {}
  }
  const hash = createHash("sha256")
    .update(prevHash + JSON.stringify(entry))
    .digest("hex");
  const chained = { ...entry, prevHash, hash };
  appendFileSync(auditFile, JSON.stringify(chained) + "\n", { encoding: "utf8", mode: 0o600 });
  if (isNew) {
    try {
      chmodSync(auditFile, 0o600);
    } catch {}
  }
  return chained;
}

/**
 * Verify the SHA-256 hash chain integrity of an `audit.jsonl` file.
 */
export function verifyAuditChain(auditFile) {
  if (!existsSync(auditFile)) {
    return { valid: true, entries: 0, brokenAtLine: null };
  }
  const lines = readFileSync(auditFile, "utf8").trim().split("\n").filter(Boolean);
  let expectedPrev = "";
  for (let i = 0; i < lines.length; i++) {
    let parsed;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      return { valid: false, entries: lines.length, brokenAtLine: i + 1, reason: "invalid_json" };
    }
    const { prevHash, hash, ...rest } = parsed;
    if (prevHash !== expectedPrev) {
      return { valid: false, entries: lines.length, brokenAtLine: i + 1, reason: "prev_hash_mismatch" };
    }
    const computed = createHash("sha256")
      .update(prevHash + JSON.stringify(rest))
      .digest("hex");
    if (computed !== hash) {
      return { valid: false, entries: lines.length, brokenAtLine: i + 1, reason: "hash_tampered" };
    }
    expectedPrev = hash;
  }
  return { valid: true, entries: lines.length, brokenAtLine: null, headHash: expectedPrev };
}

/**
 * Compute autonomy vs. human-intervention KPIs over an array of audit entries.
 */
export function computeKpis(entries = []) {
  const mutating = entries.filter((e) => e && (e.action === "click" || e.action === "fill"));
  let green = 0,
    semi = 0,
    yellow = 0,
    red = 0;
  for (const e of mutating) {
    if (e.tier === GREEN) green++;
    else if (e.tier === SEMI || e.tier === "SEMI-AUTOMATIC") semi++;
    else if (e.tier === YELLOW) yellow++;
    else if (e.tier === RED) red++;
  }
  const total = green + semi + yellow + red;
  if (total === 0) {
    return { total: 0, autonomy: 0, intervention: 0, breakdown: { green, semi, yellow, red } };
  }
  return {
    total,
    autonomy: Number(((green + semi) / total).toFixed(4)),
    intervention: Number(((yellow + red) / total).toFixed(4)),
    breakdown: { green, semi, yellow, red },
  };
}

/**
 * Render the two-section Accountability Report from audit entries.
 */
export function formatAccountabilityReport(entries = [], auditFile = "audit.jsonl") {
  const actions = entries.filter((e) => e.tier === GREEN || e.tier === SEMI || e.tier === "SEMI-AUTOMATIC");
  const brakes = entries.filter((e) => e.tier === RED);
  const doneSummary =
    actions.length === 0
      ? "(nothing yet)"
      : actions
          .slice(-5)
          .map((e) => `${e.action} ${e.target}${e.value ? " = " + e.value : ""}`)
          .join(" · ");
  const missingSummary =
    brakes.length === 0
      ? "(nothing blocked)"
      : brakes.map((e) => `click on "${e.value || e.target}"`).join(" · ");

  const lines = ["— Accountability Report (governed-browser) —", ""];
  lines.push("Automatic actions — for you to verify:");
  if (actions.length === 0) lines.push("  (none)");
  for (const e of actions) {
    const flag = e.tier === SEMI || e.tier === "SEMI-AUTOMATIC" ? "⚑ " : "";
    const value = e.value ? ` = ${e.value}` : "";
    const time = e.ts ? e.ts.slice(11, 19) : "";
    lines.push(`  [${flag}${e.tier}] ${e.action} ${e.target}${value}${time ? " — " + time : ""}`);
  }
  lines.push("");
  lines.push("Brakes applied (RED — the guide stopped, hand to the human):");
  if (brakes.length === 0) lines.push("  (none)");
  for (const e of brakes) {
    const time = e.ts ? e.ts.slice(11, 19) : "";
    lines.push(`  🛑 ${e.action} ${e.target} ("${e.value}")${time ? " — " + time : ""}`);
  }
  lines.push("");
  lines.push(`✅ Ready: ${doneSummary}`);
  lines.push(`⏳ Missing (you, human): ${missingSummary}`);
  lines.push("");
  lines.push(`Full trail: ${auditFile}`);
  return lines.join("\n");
}
