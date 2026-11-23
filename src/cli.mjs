#!/usr/bin/env node
/**
 * @franco/governed-browser CLI
 *
 * Commands:
 *   governed-browser check --label "<button text>" [--selector "<css>"] [--submit] [--href "<url>"] [--tiers <path>] [--audit <path>]
 *   governed-browser redact --selector "<css>" --label "<label>" --value "<val>" [--password]
 *   governed-browser verify-chain --audit <path>
 *   governed-browser report --audit <path>
 *   governed-browser kpi --audit <path> [--json]
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import {
  evaluateClickGate,
  loadTiersFromDisk,
  redactFillValue,
  writeAuditEntry,
  verifyAuditChain,
  computeKpis,
  formatAccountabilityReport,
} from "./core.mjs";

const DEFAULT_AUDIT = process.env.COCKPIT_AUDIT || join(homedir(), ".governed-browser", "audit.jsonl");
const DEFAULT_TIERS = process.env.COCKPIT_TIERS || join(homedir(), ".governed-browser", "tiers.md");

function parseBool(val) {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const lower = val.trim().toLowerCase();
    if (lower === "false" || lower === "0" || lower === "no") return false;
    if (lower === "true" || lower === "1" || lower === "yes") return true;
  }
  return Boolean(val);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      if (eqIdx !== -1) {
        const key = a.slice(2, eqIdx);
        args[key] = a.slice(eqIdx + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
          args[key] = true;
        } else {
          args[key] = next;
          i++;
        }
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || "help";
  const auditFile = resolve(String(args.audit || DEFAULT_AUDIT));
  const tiersFile = resolve(String(args.tiers || DEFAULT_TIERS));

  if (cmd === "check" || cmd === "check-click") {
    const label = String(args.label ?? "");
    const selector = String(args.selector || "button");
    const isSubmit = parseBool(args.submit);
    const href = String(args.href || "");
    if (!label.trim() && !args.selector && !href.trim() && !isSubmit) {
      console.error("Error: check requires at least --label, --selector, --href, or --submit.");
      process.exit(1);
    }
    const rules = loadTiersFromDisk(tiersFile);
    const gate = evaluateClickGate({ selector, label, isSubmit, href, rules });

    if (args["record-audit"]) {
      writeAuditEntry(auditFile, {
        ts: new Date().toISOString(),
        action: "click",
        tier: gate.tier,
        target: selector,
        value: label,
        justification: gate.reason,
      });
    }

    console.log(JSON.stringify(gate, null, 2));
    process.exit(gate.allowed ? 0 : 2);
  }

  if (cmd === "redact") {
    const selector = String(args.selector || "");
    const label = String(args.label || "");
    const value = String(args.value || "");
    const isPassword = Boolean(args.password);
    const redacted = redactFillValue(selector, label, value, { isPassword });
    console.log(JSON.stringify({ selector, label, redacted }, null, 2));
    process.exit(0);
  }

  if (cmd === "verify-chain") {
    const res = verifyAuditChain(auditFile);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.valid ? 0 : 2);
  }

  if (cmd === "report") {
    const entries = readEntries(auditFile);
    console.log(formatAccountabilityReport(entries, auditFile));
    process.exit(0);
  }

  if (cmd === "kpi") {
    const entries = readEntries(auditFile);
    const kpi = computeKpis(entries);
    if (args.json) {
      console.log(JSON.stringify(kpi, null, 2));
    } else {
      console.log(
        `Mutating actions: ${kpi.total} · Autonomy: ${Math.round(kpi.autonomy * 100)}% · Human intervention: ${Math.round(kpi.intervention * 100)}%`
      );
    }
    process.exit(0);
  }

  console.log(`Usage:
  governed-browser check --label "<text>" [--selector "<css>"] [--submit] [--href "<url>"] [--tiers <path>] [--audit <path>] [--record-audit]
  governed-browser redact --selector "<css>" --label "<label>" --value "<val>" [--password]
  governed-browser verify-chain [--audit <path>]
  governed-browser report [--audit <path>]
  governed-browser kpi [--audit <path>] [--json]`);
  process.exit(cmd === "help" || args.help ? 0 : 1);
}

main();
