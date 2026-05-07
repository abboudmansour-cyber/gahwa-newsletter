#!/usr/bin/env node
/**
 * server.js — HTTP Webhook Listener (Event-Driven Deployment)
 *
 * REFACTORED: No SSH, no CI/CD tools. Pure webhook-driven deployment.
 *
 * On POST /webhook:
 *   1. Validate event type (must be "push")
 *   2. Validate branch (must be "main" — reject non-main branches)
 *   3. Verify HMAC-SHA256 signature
 *   4. Acquire lock (prevent concurrent runs)
 *   5. Run: git pull origin main
 *   6. Run: node operator/operator.js <job>
 *   7. Release lock
 *   8. Log everything
 */
import { ensureExecutionContext } from "./core/runtime.js";
import fs from "fs"; import path from "path"; import { createServer } from "http";
import { fileURLToPath } from "url"; import dotenv from "dotenv";
import { execSync } from "child_process";
import { acquireLock, releaseLock, isLocked } from "./core/lock.js";
import { configure as cfgSec, verifyRequest } from "./core/security.js";
import { logCounts } from "./core/logger.js"; import { runJob } from "./executor.js";
import { validateEnvironment, logWebhookStatus } from "./core/validate-env.js";

// ── Bootstrap execution context (MUST be called before ANY other logic) ─────
ensureExecutionContext();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });
cfgSec(process.env.GITHUB_WEBHOOK_SECRET || "");

// ── Startup Health Check ─────────────────────────────────────────────────────
validateEnvironment();
logWebhookStatus();


const PORT = parseInt(process.env.LISTENER_PORT || process.argv.find(a=>a.startsWith("--port="))?.split("=")[1] || "3000", 10);
const ONE_OFF = process.argv.includes("--once");
const REPO_DIR = path.resolve(__dirname, "..");

function tsLog(lvl) { return (...a) => { const p = `[${new Date().toISOString()}] [${lvl}]`; (lvl==="ERROR"?process.stderr:process.stdout).write(`${p} ${a.join(" ")}\n`); }; }
function parseBody(r) { return new Promise((res,rej) => { const c=[]; r.on("data",d=>c.push(d)); r.on("end",()=>res(Buffer.concat(c).toString())); r.on("error",rej); }); }
function json(res,code,data) { res.writeHead(code,{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}); res.end(JSON.stringify(data,null,2)+"\n"); }

/**
 * Validate the webhook payload.
 * Returns { valid: true } or { valid: false, message, statusCode }.
 */
function validatePayload(body, headers) {
  // 1. Check it's a push event
  const event = headers["x-github-event"];
  if (event && event !== "push") {
    return { valid: false, message: `Ignored event type: ${event} (only push events trigger deployment)`, statusCode: 200 };
  }

  // 2. Check ref is main branch
  if (body.ref && body.ref !== "refs/heads/main") {
    const branch = body.ref.replace("refs/heads/", "");
    return { valid: false, message: `Ignored push to non-main branch: ${branch}`, statusCode: 200 };
  }

  return { valid: true };
}

/**
 * Pull the latest code from origin/main.
 * This is the core of the event-driven deployment — the server pulls
 * whatever was just pushed, then runs the operator on the new code.
 */
function gitPull() {
  console.log(`[DEPLOY] Pulling latest code from origin/main...`);
  const start = Date.now();
  try {
    execSync("git fetch origin main", { cwd: REPO_DIR, stdio: "pipe" });
    execSync("git reset --hard origin/main", { cwd: REPO_DIR, stdio: "pipe" });
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[DEPLOY] Git pull completed in ${duration}s — now at HEAD of origin/main`);
    return { success: true, duration };
  } catch (err) {
    console.error(`[DEPLOY] Git pull failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function start() {
  const srv = createServer(async (req, res) => {
    const t0 = Date.now();
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, x-hub-signature-256, x-github-event");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.method === "GET" && req.url === "/health") return json(res,200,{status:"ok",timestamp:new Date().toISOString(),version:"3.0.0",uptime:process.uptime(),lock:isLocked(),logs:logCounts()});
    if (req.method === "GET" && req.url === "/status") return json(res,200,{server:"gahwa-listener",running:true,lock:isLocked(),pid:process.pid});
    if (req.method === "POST" && (req.url==="/webhook"||req.url==="/trigger")) {
      try {
        const raw = await parseBody(req);

        // ── 1. Signature verification ────────────────────────────────
        const auth = verifyRequest(req.headers["x-hub-signature-256"], raw);
        if (!auth.valid) {
          console.log(`[TRIGGER] ❌ Rejected — invalid signature from ${req.socket.remoteAddress}`);
          return json(res,401,{status:"error",message:auth.message});
        }

        // ── 2. Parse body ────────────────────────────────────────────
        let body={};
        try { body=JSON.parse(raw); } catch { return json(res,400,{status:"error",message:"Invalid JSON payload"}); }

        // ── 3. Validate payload (event type, branch) ─────────────────
        const validation = validatePayload(body, req.headers);
        if (!validation.valid) {
          console.log(`[TRIGGER] ℹ️ ${validation.message}`);
          return json(res, validation.statusCode, { status: "ignored", message: validation.message });
        }

        // ── 4. Log trigger ───────────────────────────────────────────
        const branch = body.ref ? body.ref.replace("refs/heads/","") : "main";
        const pusher = body.pusher?.name || body.sender?.login || "unknown";
        const commit = body.head_commit?.id?.substring(0, 7) || "unknown";
        const repo = body.repository?.full_name || "unknown";
        console.log(`[TRIGGER] 🔔 Webhook received — ${repo} push by ${pusher} (commit ${commit}) on branch ${branch}`);

        // ── 5. Acquire lock ──────────────────────────────────────────
        if (!acquireLock(branch)) {
          console.log(`[TRIGGER] ⚠️ Lock held — skipping (another run is in progress)`);
          return json(res,409,{status:"error",message:"Execution lock held — another run is in progress"});
        }

        let result;
        try {
          const job = body.job || process.argv.find(a=>a.startsWith("--job="))?.split("=")[1] || "daily-newsletter";

          // ── 6. Git pull (the actual deployment) ────────────────────
          const pullResult = gitPull();
          if (!pullResult.success) {
            console.log(`[DEPLOY] ❌ Git pull failed — aborting pipeline`);
            return json(res,500,{status:"error",message:`Git pull failed: ${pullResult.error}`});
          }

          // ── 7. Run the job ─────────────────────────────────────────
          console.log(`[TRIGGER] 🚀 Starting job: ${job}`);
          result = await runJob(job);
        } finally {
          releaseLock();
        }

        const duration = `${((Date.now()-t0)/1000).toFixed(1)}s`;
        console.log(`[TRIGGER] ✅ Job ${result.success ? "SUCCEEDED" : "FAILED"} in ${duration}`);

        return json(res,result.success?200:500,{
          status:result.success?"ok":"error",
          job: body.job || "daily-newsletter",
          branch,
          commit,
          pusher,
          timestamp:new Date().toISOString(),
          duration,
          ...result
        });
      } catch(e) { releaseLock(); return json(res,500,{status:"error",message:`Internal server error: ${e.message}`}); }
    }
    json(res,404,{status:"error",message:"Not found. Available: GET /health, GET /status, POST /webhook"});
  });
  srv.listen(PORT,"0.0.0.0",()=>process.stdout.write(`[${new Date().toISOString()}] [INFO] GAHWA SERVER — PID ${process.pid}, Port ${PORT}\n`));
  const shutdown = sig => { process.stdout.write(`\n[${new Date().toISOString()}] [INFO] ${sig} received. Shutting down...\n`); releaseLock(); srv.close(()=>process.exit(0)); setTimeout(()=>process.exit(1),5000); };
  process.on("SIGINT",()=>shutdown("SIGINT")); process.on("SIGTERM",()=>shutdown("SIGTERM")); process.on("SIGHUP",()=>shutdown("SIGHUP"));
  process.on("uncaughtException",e=>{ process.stderr.write(`[FATAL] ${e.stack}\n`); releaseLock(); process.exit(1); });
  process.on("unhandledRejection",r=>{ process.stderr.write(`[FATAL] Unhandled rejection: ${r}\n`); releaseLock(); process.exit(1); });
}

async function main() {
  console.log = tsLog("INFO"); console.error = tsLog("ERROR");
  if (ONE_OFF) {
    const job = process.argv.find(a=>a.startsWith("--job="))?.split("=")[1] || "daily-newsletter";
    const branch = process.argv.find(a=>a.startsWith("--branch="))?.split("=")[1] || "main";
    if (!acquireLock(branch)) process.exit(1);
    let r; try { r=await runJob(job); } finally { releaseLock(); }
    process.stdout.write(`\nResult: ${r.success?"✅ SUCCESS":"❌ FAILED"}\n`);
    process.exit(r.success?0:1);
  } else start();
}
main().catch(e=>{ process.stderr.write(`[FATAL] ${e.message}\n`); releaseLock(); process.exit(1); });
