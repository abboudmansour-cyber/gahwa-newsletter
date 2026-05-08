# Stability Mode — Presentation & Editorial Hardening

- [x] Analyze all allowed files (Html.gs, Render.gs, Utilities.gs, Code.gs, Parser.gs, prompts)
- [x] Identify broken Unicode sequences and CSS variable issues
- [ ] **1. UTF-8 Hardening** — Fix malformed `\U` emoji sequences, add charset hardening
- [ ] **2. CSS Variable Resolution** — Replace `--var()` with concrete values for email clients
- [ ] **3. HTML Email Upgrade** — Tighter typography, exec-brief spacing, mobile-friendly
- [ ] **4. Editorial De-Robotification** — Update newsletter prompt v11 with banned phrases
- [ ] **5. Duplicate Language Filter** — Add dedup post-processing to Utilities.gs
- [ ] **6. Validation** — Generate newsletter, verify HTML renders, email sends, truth passes
