import { execSync } from "child_process";

export function runGit(message) {
  execSync("git add .");
  execSync(`git commit -m "${message}"`);
  execSync("git push");
}