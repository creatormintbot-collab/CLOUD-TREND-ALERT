import fs from "node:fs/promises";
import path from "node:path";
import { ensureDirs } from "../config/constants.js";

ensureDirs();

export async function readJson(file, fallback) {
  try {
    const txt = await fs.readFile(file, "utf8");
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  const txt = JSON.stringify(data, null, 2);
  await fs.writeFile(tmp, txt, "utf8");
  await fs.rename(tmp, file);
}
