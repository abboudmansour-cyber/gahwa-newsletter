import { execSync } from "child_process";

/**
 * Execute the full git flow: add, commit, push.
 * All three commands must succeed for the step to be considered successful.
 * Throws on failure — caller is responsible for catch/react.
 */
export function runGit(message) {
  execSync("git add .", { stdio: "pipe" });
  execSync(`git commit -m "auto: ${message}"`, { stdio: "pipe" });
  execSync("git push origin main", { stdio: "pipe" });
}
