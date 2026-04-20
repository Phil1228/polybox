#!/usr/bin/env node

import { randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const USERNAME_REGEX = /^[A-Za-z0-9_]{4,16}$/;

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/reset-user-password.mjs <username> <newPassword>");
  console.log("");
  console.log("Example:");
  console.log("  node scripts/reset-user-password.mjs alice_01 MyNewPass123");
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function main() {
  const [, , usernameArg = "", passwordArg = ""] = process.argv;
  const username = String(usernameArg).trim();
  const newPassword = String(passwordArg);

  if (!username || !newPassword) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (!USERNAME_REGEX.test(username)) {
    console.error("Invalid username. Must be 4-16 letters/numbers/underscore.");
    process.exitCode = 1;
    return;
  }
  if (newPassword.length < 1 || newPassword.length > 64) {
    console.error("Invalid password length. Must be 1-64 characters.");
    process.exitCode = 1;
    return;
  }

  const dbPath = resolve(process.cwd(), "data", "minimaths.db");
  if (!existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    console.error("Run the app once to initialize the database.");
    process.exitCode = 1;
    return;
  }

  const db = new DatabaseSync(dbPath);
  const readUserStmt = db.prepare(`
    SELECT id, username
    FROM users
    WHERE username = ?
    LIMIT 1
  `);
  const updatePasswordStmt = db.prepare(`
    UPDATE users
    SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const user = readUserStmt.get(username);
  if (!user) {
    console.error(`User not found: ${username}`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = hashPassword(newPassword);
  updatePasswordStmt.run(passwordHash, user.id);

  console.log(`Password reset successfully for user: ${user.username}`);
}

main();
