---
name: governed-browser
description: Enforce a deterministic code-level commit-click brake (Send/Pay/Submit/Delete/Authorize), proactive password/token redaction, emerald-border visual verification, and SHA-256 hash-chained audit trails whenever an AI agent automates a web browser.
---

# Governed Browser — Constitutional Commit-Click Brake for Browser Agents

Whenever an AI agent drives a web browser (via Chrome DevTools Protocol, Playwright, Puppeteer, or a browser MCP tool), it MUST enforce the **Governed Browser Contract**:

1. **The Agent Never Clicks Send / Pay / Delete / Submit:**
   Before clicking any button, link, or form control, pass its visible text, `aria-label`, ancestor button label, `isSubmit` flag, and `href` through `governed-browser check`:
   ```bash
   npx @franco/governed-browser check --selector "#submit-btn" --label "Pay $145.00" --submit --record-audit
   ```
   - Exit code `0` (`ALLOWED` — `GREEN` or `⚑ SEMI-AUTOMATIC`): proceed and outline the element with a `3px solid #10b981` emerald border.
   - Exit code `2` (`BRAKED` — `🔴 RED` or `PROPOSE_WAIT` — `🟡 YELLOW`): **STOP IMMEDIATELY**. Do not try an alternate CSS selector or keyboard `Enter` workaround. Hand the wheel to the human with the two-section Accountability Report.

2. **Constitutional Downgrade Rule:**
   A forbidden committing verb (`Send`, `Pay`, `Envoyer`, `Payer`, `Enviar`, `Pagar`, `Delete`, `Authorize`, `Sign in`, `Create`) can ONLY be downgraded from `RED` by an **exact normalized match** in the human's `tiers.md` policy file. Generic substring `GREEN` rules never disable the brake.

3. **Proactive Secret Redaction & SHA-256 Hash-Chained Audit Trail:**
   Never log raw passwords, API keys, CVV, OTP, or 2FA codes. Use `governed-browser redact` or the `cockpit_record_fill` MCP tool so sensitive values are replaced with `••• (sensitive — never logged)` before entering `audit.jsonl`.
