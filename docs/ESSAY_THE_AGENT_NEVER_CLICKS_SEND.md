# Why Browser Agents Need a Hard Commit Brake in Code, Not a Prompt

Every team building browser-use agents eventually hits the same failure mode: you ask an agent to *"prepare the vendor invoice draft and check the total,"* and the agent fills out the form—and immediately clicks **"Pay $1,450.00"** or **"Send to All Clients."**

When postmortems are run, the root cause is always identical: **the safety boundary lived in the system prompt** (*"Please ask the user before submitting forms or making payments"*), while the browser tool (`click(selector)`) had unguarded execution authority over every DOM node on the page.

Under long-context drift or ambiguous UI labels, prompt instructions degrade. Code does not.

---

## 1. Separation of Hands and Conscience

In `governed-browser`, we enforce a strict physical invariant:

> **The agent prepares the page and highlights every touched field with a `3px solid #10b981` emerald border; the final committing click (`Send`, `Pay`, `Submit`, `Delete`, `Authorize`, `Sign in`) is physically refused in code (`🛑 BRAKE`, exit code `2`).**

Even if the LLM decides to click a button labeled `"Payer"`, `"Envoyer"`, `"Submit Order"`, or `"Delete Account"`, the pre-click gate intercepts the action before the mouse event is dispatched.

## 2. Three Real Bugs We Caught While Hardening the Brake

Building a reliable commit brake requires more than a naive `label.includes("pay")` check:

1. **The Substring False-Positive & Multilingual Diacritic Trap:**
   A naive substring check for `"pay"` blocks a French form field labeled `"Pays"` (*Country*), and `"post"` blocks `"Code postal"`. Conversely, macOS NFD Unicode decomposition can split accented characters (`"Déconnecter"`, `"Réinitialiser"`) so standard regexes miss them. `governed-browser` normalizes every label through Unicode `NFD` diacritic stripping and enforces strict word-boundary matching across English, French, and Spanish committing verbs—plus ancestor `<button>`/`<a>` lookup so clicking a child `<svg>` or `<span>` cannot disguise the parent button's label.
2. **The Substring Downgrade Exploit (Constitutional Downgrade Rule):**
   If a user adds a convenience rule `account -> GREEN` to their policy file (`tiers.md`) so the agent can click `"View account"`, a naive router would match `"account"` inside `"Delete account"` and downgrade a destructive button to `GREEN`. In `governed-browser`, a forbidden committing verb can **only** be downgraded from `RED` by an **exact normalized full-label match** in `tiers.md` (e.g., `Create draft -> GREEN` allows `"Create draft"` while leaving `"Create production cluster"` locked at `RED`).
3. **The `YELLOW` One-Time Step-Approval State Transition:**
   During our Dual-Brain audit of the original prototype (`jfranco-cockpit-browser`), DeepSeek V4 caught a subtle runtime bug: when a human authorized a one-time `YELLOW` action (`/cockpit step`), the handler attempted to reassign a `const tier = resolveActionTier(...)` variable to `"SEMI"`, throwing a `TypeError` right when the human approved the step (while a second Dual-Brain pass verified that CDP's `Page.createIsolatedWorld` actually requires upstream Chromium's historically misspelled `grantUniveralAccess` parameter in `Page.pdl`). Extracting the governance core into `governed-browser` with deterministic unit tests eliminated the `YELLOW -> SEMI` state transition bug permanently.

## 3. Proactive Secret Redaction & Cryptographic Audit Trail

Browser agents routinely interact with login and checkout forms. Waiting for the DOM to confirm `type="password"` is unsafe—if a selector times out or targets a custom text input for an API key or CVV, the raw secret leaks into the agent's logs.

`governed-browser` redacts values **proactively** by inspecting both the CSS selector and label against sensitive patterns (`pass|pwd|secret|token|key|cvv|cvc|card|pin|otp|2fa|ssn`) before appending each entry to a SHA-256 hash-chained `audit.jsonl` ledger.
