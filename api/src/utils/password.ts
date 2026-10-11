import {
  argon2,
  randomBytes,
  timingSafeEqual,
  type Argon2Parameters,
} from "node:crypto";

const ALGORITHM = "argon2id";
const VERSION = 19;

const SALT_LENGTH = 16;
const MEMORY = 65536;
const PASSES = 3;
const PARALLELISM = 4;
const TAG_LENGTH = 32;

const PHC_PATTERN = /^\$argon2id\$v=(\d+)\$([^$]+)\$([^$]+)\$([^$]+)$/;

interface DerivedParameters {
  m: number;
  t: number;
  p: number;
}

function parseParameters(input: string): DerivedParameters {
  const entries = new Map<string, number>();

  for (const segment of input.split(",")) {
    const [key, value] = segment.split("=");
    const parsed = Number(value);

    if (!key || value === undefined || !Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("Invalid Argon2 parameter");
    }

    entries.set(key, parsed);
  }

  const memory = entries.get("m");
  const passes = entries.get("t");
  const parallelism = entries.get("p");

  if (memory === undefined || passes === undefined || parallelism === undefined) {
    throw new Error("Missing Argon2 parameter");
  }

  return { m: memory, t: passes, p: parallelism };
}

function encodeBase64(value: Buffer): string {
  return value.toString("base64").replace(/=+$/, "");
}

function deriveKey(
  password: string,
  salt: Buffer,
  memory: number,
  passes: number,
  parallelism: number,
  tagLength: number,
): Promise<Buffer> {
  const parameters: Argon2Parameters = {
    message: password,
    nonce: salt,
    memory,
    passes,
    parallelism,
    tagLength,
  };

  return new Promise((resolve, reject) => {
    argon2(ALGORITHM, parameters, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await deriveKey(
    password,
    salt,
    MEMORY,
    PASSES,
    PARALLELISM,
    TAG_LENGTH,
  );

  return `$argon2id$v=${VERSION}$m=${MEMORY},t=${PASSES},p=${PARALLELISM}$${encodeBase64(salt)}$${encodeBase64(derivedKey)}`;
}

export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  const match = PHC_PATTERN.exec(storedHash);

  if (!match) {
    return false;
  }

  const [, version, parameters, saltEncoded, hashEncoded] = match;

  if (Number(version) !== VERSION) {
    return false;
  }

  let parsed: DerivedParameters;

  try {
    parsed = parseParameters(parameters);
  } catch {
    return false;
  }

  const salt = Buffer.from(saltEncoded, "base64");
  const expectedKey = Buffer.from(hashEncoded, "base64");

  if (salt.length === 0 || expectedKey.length === 0) {
    return false;
  }

  let actualKey: Buffer;

  try {
    actualKey = await deriveKey(
      password,
      salt,
      parsed.m,
      parsed.t,
      parsed.p,
      expectedKey.length,
    );
  } catch {
    return false;
  }

  return timingSafeEqual(actualKey, expectedKey);
}
