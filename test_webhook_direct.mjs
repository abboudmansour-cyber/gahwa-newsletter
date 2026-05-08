// Direct node-fetch test
const { default: fetch } = await import('node-fetch');

const WEBHOOK = "https://script.google.com/macros/s/AKfycbyAvWOJzR3y234fYHF-HtVsnEPlLHyjK6uf8zl8wtfz0P9f_Q8NE-RUL0fp4hTJS5Q/exec";
const SECRET = "89e9d1671f9a13dbd3cbdc5fd90a2fdecaff7a5d635b81aa";

const authHeaders = { "X-Gahwa-Webhook-Secret": SECRET };

// Test: POST directly with redirect: manual
console.log("=== POST with redirect: manual ===");
const res = await fetch(WEBHOOK, {
  method: "POST",
  redirect: "manual",
  headers: { "Content-Type": "application/json", ...authHeaders },
  body: JSON.stringify({ test: true, deliveryId: "test-direct-001" }),
});
const status = res.status;
const loc = res.headers.get("location") || "(none)";
const body = await res.text();
console.log(`Status: ${status}`);
console.log(`Location: ${loc}`);
console.log(`Body: ${body.substring(0, 500)}`);

console.log("\n=== POST with default redirect ===");
const res2 = await fetch(WEBHOOK, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...authHeaders },
  body: JSON.stringify({ test: true, deliveryId: "test-direct-002" }),
});
const status2 = res2.status;
const body2 = await res2.text();
console.log(`Status: ${status2}`);
console.log(`Body: ${body2.substring(0, 500)}`);
