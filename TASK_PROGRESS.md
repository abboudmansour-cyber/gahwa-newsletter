# Task: Add sanitizeUTF8() as FIRST operation on all raw LLM/parser outputs

- [x] Analyze codebase to find all LLM output entry points
- [ ] Add sanitizeUTF8() to operator/deepseek.js (askDeepSeek + callDeepSeekForContent)
- [ ] Add sanitizeUTF8() to operator/operator.js (generateNewsletterContent)
- [ ] Add sanitizeUTF8() to operator/daily-runner.js (generateNewsletter)
- [ ] Add sanitize_utf8() to scripts/generate_newsletter.py (call_deepseek)
- [ ] Add sanitizeUTF8() to scripts/Claude.gs (callClaude)
- [ ] Add sanitizeUTF8() to scripts/Code.gs (runScoutStep2 + runScoutStep3)
- [ ] Verify all changes are correct and consistent
