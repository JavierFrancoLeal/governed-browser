#!/usr/bin/env node
/**
 * @franco/governed-browser MCP Server (stdio JSON-RPC 2.0)
 *
 * Exposes 4 deterministic governance tools for any browser-driving AI agent:
 * - cockpit_check_click: Evaluates whether a button/link click is ALLOWED (GREEN/SEMI),
 *   PROPOSE_WAIT (YELLOW), or BRAKED (RED committing action).
 * - cockpit_record_fill: Redacts sensitive values, logs the fill to the SHA-256 hash chain,
 *   and returns the emerald-border verification receipt.
 * - cockpit_get_report: Renders the two-section Accountability Report & Autonomy KPI.
 * - cockpit_verify_audit_chain: Cryptographically verifies the SHA-256 hash chain in audit.jsonl.
 */
import { createInterface } from "node:readline";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import {
  SEMI,
  evaluateClickGate,
  loadTiersFromDisk,
  redactFillValue,
  writeAuditEntry,
  verifyAuditChain,
  computeKpis,
  formatAccountabilityReport,
} from "./core.mjs";

const AUDIT_FILE = resolve(process.env.COCKPIT_AUDIT || join(homedir(), ".governed-browser", "audit.jsonl"));
const TIERS_FILE = resolve(process.env.COCKPIT_TIERS || join(homedir(), ".governed-browser", "tiers.md"));

function readEntries(auditPath) {
  if (!existsSync(auditPath)) return [];
  return readFileSync(auditPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const TOOLS = [
  {
    name: "cockpit_check_click",
    description:
      "Constitutional commit-click brake gate. Call BEFORE clicking any button or link in a browser tool. Refuses committing/irreversible clicks (Send, Pay, Submit, Delete, Authorize, Sign in, Checkout) with status='BRAKED' (RED) so the human performs the final click.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the target element" },
        label: { type: "string", description: "Visible text, aria-label, or ancestor button text" },
        isSubmit: { type: "boolean", description: "True if input[type=submit] or button inside form" },
        href: { type: "string", description: "Target href or form action URL if present" },
      },
      required: ["selector", "label"],
    },
  },
  {
    name: "cockpit_record_fill",
    description:
      "Proactively redact sensitive fields (passwords, tokens, CVV, OTP) and record a SEMI-AUTOMATIC form fill in the SHA-256 hash-chained audit trail.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the input/select field" },
        label: { type: "string", description: "Field label or placeholder" },
        value: { type: "string", description: "Value written into the field" },
        isPassword: { type: "boolean", description: "True if input[type=password]" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "cockpit_get_report",
    description: "Render the two-section Accountability Report and Autonomy Efficiency KPI for the current audit trail.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "cockpit_verify_audit_chain",
    description: "Verify the SHA-256 hash chain integrity of audit.jsonl.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch (err) {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse error: ${err.message}` } });
    return;
  }
  if (!req || typeof req !== "object" || Array.isArray(req)) {
    send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
    return;
  }

  const { id, method, params } = req;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "governed-browser", version: "1.0.1" },
      },
    });
    return;
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};

    if (name === "cockpit_check_click") {
      const rules = loadTiersFromDisk(TIERS_FILE);
      const gate = evaluateClickGate({
        selector: String(args.selector || "button"),
        label: String(args.label || ""),
        isSubmit: Boolean(args.isSubmit),
        href: String(args.href || ""),
        rules,
      });
      writeAuditEntry(AUDIT_FILE, {
        ts: new Date().toISOString(),
        action: "click",
        tier: gate.tier,
        target: gate.selector,
        value: gate.label,
        justification: gate.reason,
      });
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(gate, null, 2) }],
          isError: !gate.allowed,
        },
      });
      return;
    }

    if (name === "cockpit_record_fill") {
      const redacted = redactFillValue(args.selector, args.label, args.value, {
        isPassword: Boolean(args.isPassword),
      });
      const rec = writeAuditEntry(AUDIT_FILE, {
        ts: new Date().toISOString(),
        action: "fill",
        tier: SEMI,
        target: String(args.selector || ""),
        value: redacted,
        justification: "writes a value into a third-party page — emerald border verification",
      });
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ recorded: true, redacted, hash: rec.hash }, null, 2) }],
        },
      });
      return;
    }

    if (name === "cockpit_get_report") {
      const entries = readEntries(AUDIT_FILE);
      const report = formatAccountabilityReport(entries, AUDIT_FILE);
      const kpi = computeKpis(entries);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `${report}\n\nKPI: ${JSON.stringify(kpi)}` }],
        },
      });
      return;
    }

    if (name === "cockpit_verify_audit_chain") {
      const res = verifyAuditChain(AUDIT_FILE);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
          isError: !res.valid,
        },
      });
      return;
    }

    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown tool: ${name}` },
    });
    return;
  }

  if (id !== undefined) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
});
