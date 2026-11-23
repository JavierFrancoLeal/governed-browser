import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GREEN,
  SEMI,
  YELLOW,
  RED,
  normalizeText,
  isForbiddenLabel,
  redactFillValue,
  parseTiersMarkdown,
  resolveActionTier,
  evaluateClickGate,
  writeAuditEntry,
  verifyAuditChain,
  computeKpis,
  formatAccountabilityReport,
} from "../src/core.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "src", "cli.mjs");
const MCP = join(__dirname, "..", "src", "mcp-server.mjs");

test("1. normalizeText strips diacritics across EN/FR/ES (NFD immune)", () => {
  assert.equal(normalizeText("  Déconnecter / Réinitialiser  "), "deconnecter / reinitialiser");
  assert.equal(normalizeText("Iniciar Sesión"), "iniciar sesion");
});

test("2. isForbiddenLabel catches committing buttons in EN/FR/ES without false-positives on 'Pays' or 'Postal'", () => {
  assert.equal(isForbiddenLabel("Envoyer le dossier"), true);
  assert.equal(isForbiddenLabel("Payer $145.00"), true);
  assert.equal(isForbiddenLabel("Submit Order"), true);
  assert.equal(isForbiddenLabel("Eliminar cuenta"), true);
  assert.equal(isForbiddenLabel("Continue with Google"), true);
  assert.equal(isForbiddenLabel("Next step", { isSubmit: true }), true);

  // Non-committing words containing substrings of forbidden words must NOT false-positive
  assert.equal(isForbiddenLabel("Pays / Country"), false);
  assert.equal(isForbiddenLabel("Code postal"), false);
  assert.equal(isForbiddenLabel("Filter by designer"), false);
});

test("3. Constitutional Downgrade Rule: substring GREEN cannot bypass a RED committing button; only exact match can", () => {
  const rules = parseTiersMarkdown(`
    # Generic substring rule
    account -> GREEN
  `);
  // "Delete account" has substring "account" -> GREEN, but "Delete" is FORBIDDEN -> stays RED!
  assert.equal(resolveActionTier("Delete account", rules), RED);

  // Exact match override can deliberately downgrade a specific button
  const exactRules = parseTiersMarkdown(`
    Create draft -> GREEN
  `);
  assert.equal(resolveActionTier("Create draft", exactRules), GREEN);
  assert.equal(resolveActionTier("Create production database", exactRules), RED);
});

test("4. evaluateClickGate handles YELLOW propose-wait and one-time human step approval without const reassignment bug", () => {
  const rules = parseTiersMarkdown(`
    Archive project -> YELLOW
  `);

  // First click on YELLOW stops and asks for approval
  const first = evaluateClickGate({
    selector: "#archive-btn",
    label: "Archive project",
    rules,
    pendingYellow: null,
  });
  assert.equal(first.allowed, false);
  assert.equal(first.status, "PROPOSE_WAIT");
  assert.equal(first.tier, YELLOW);

  // Second click after human `/cockpit step` approval consumes pendingYellow and demotes to SEMI-AUTOMATIC
  const second = evaluateClickGate({
    selector: "#archive-btn",
    label: "Archive project",
    rules,
    pendingYellow: { selector: "#archive-btn", label: "Archive project" },
  });
  assert.equal(second.allowed, true);
  assert.equal(second.status, "ALLOWED");
  assert.equal(second.tier, SEMI);
  assert.equal(second.consumedYellow, true);
});

test("5. redactFillValue proactively scrubs passwords, tokens, CVV, and 2FA codes", () => {
  assert.equal(redactFillValue("#user-password", "Password", "Hunter2!"), "••• (sensitive — never logged)");
  assert.equal(redactFillValue("#api_key", "OpenAI Key", "sk-123456"), "••• (sensitive — never logged)");
  assert.equal(redactFillValue("#city", "Ville", "Montréal"), "Montréal");
});

test("6. writeAuditEntry and verifyAuditChain detect tampering in SHA-256 hash chain", () => {
  const dir = mkdtempSync(join(tmpdir(), "governed-browser-test-"));
  const auditFile = join(dir, "audit.jsonl");
  try {
    writeAuditEntry(auditFile, { ts: "2026-11-23T12:00:00Z", action: "fill", tier: SEMI, target: "#email", value: "a@b.com" });
    writeAuditEntry(auditFile, { ts: "2026-11-23T12:00:05Z", action: "click", tier: RED, target: "#pay", value: "Pay Now" });

    const checkOk = verifyAuditChain(auditFile);
    assert.equal(checkOk.valid, true);
    assert.equal(checkOk.entries, 2);

    // Tamper with the file
    writeFileSync(auditFile, '{"ts":"tampered","prevHash":"","hash":"deadbeef"}\n', "utf8");
    const checkBad = verifyAuditChain(auditFile);
    assert.equal(checkBad.valid, false);
    assert.equal(checkBad.brokenAtLine, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("7. computeKpis and formatAccountabilityReport calculate autonomy ratio and render two-section report", () => {
  const entries = [
    { ts: "2026-11-23T12:00:01Z", action: "fill", tier: SEMI, target: "#name", value: "Alice" },
    { ts: "2026-11-23T12:00:02Z", action: "fill", tier: SEMI, target: "#amount", value: "250" },
    { ts: "2026-11-23T12:00:03Z", action: "click", tier: GREEN, target: "#preview", value: "Preview" },
    { ts: "2026-11-23T12:00:04Z", action: "click", tier: RED, target: "#submit", value: "Envoyer" },
  ];
  const kpi = computeKpis(entries);
  assert.equal(kpi.total, 4);
  assert.equal(kpi.autonomy, 0.75);
  assert.equal(kpi.intervention, 0.25);

  const report = formatAccountabilityReport(entries, "/tmp/audit.jsonl");
  assert.match(report, /Automatic actions — for you to verify:/);
  assert.match(report, /Brakes applied \(RED — the guide stopped, hand to the human\):/);
  assert.match(report, /🛑 click #submit \("Envoyer"\)/);
});

test("8. Hardening: --flag=value CLI parsing, zero-width obfuscation, dangerous hrefs, value-driven secret redaction, and MCP null guard", () => {
  // 1) --label=Send must be BRAKED (exit 2), never silently ignored
  const eqRun = spawnSync(process.execPath, [CLI, "check", "--label=Send", "--selector=#send-btn"], { encoding: "utf8" });
  assert.equal(eqRun.status, 2);
  assert.equal(JSON.parse(eqRun.stdout).status, "BRAKED");

  // 2) Zero-width split obfuscation ("Pa\u200Byer") and javascript: URI must be BRAKED
  assert.equal(isForbiddenLabel("Pa\u200Byer maintenant"), true);
  assert.equal(isForbiddenLabel("Open link", { href: "javascript:fetch('https://evil.tld')" }), true);

  // 3) Value-driven redaction catches API keys/JWTs/cards even in generic fields
  assert.equal(redactFillValue("#bio", "Bio", "sk-proj-1234567890abcdefgh"), "••• (sensitive — never logged)");
  assert.equal(redactFillValue("#notes", "Notes", "AIzaSyA123456789012345678901234567890"), "••• (sensitive — never logged)");

  // 4) MCP server survives null / non-object JSON payload without crashing
  const mcpRun = spawnSync(process.execPath, [MCP], {
    input: 'null\n{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n',
    encoding: "utf8",
  });
  assert.equal(mcpRun.status, 0);
  const lines = mcpRun.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines[0].error.code, -32600);
  assert.equal(lines[1].result.serverInfo.version, "1.0.1");
});
