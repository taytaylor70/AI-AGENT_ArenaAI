/**
 * Encrypted Secrets Vault.
 *
 * API keys live ONLY in the vault (backend). Providers resolve keys from
 * it at request time; the browser/UI never sees a secret.
 *
 *   Browser -> Backend -> Encrypted Secrets Vault -> Provider
 *
 * Encryption: AES-256-GCM. The master key comes from TDX_MASTER_KEY
 * (base64 or hex) or is generated and stored at the vault's key file.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface VaultFile {
  v: 1;
  entries: Record<string, { iv: string; tag: string; data: string }>;
}

export class SecretsVault {
  private path: string;
  private key: Buffer;

  constructor(opts: { path?: string; masterKey?: string } = {}) {
    this.path = opts.path ?? process.env.TDX_VAULT_PATH ?? join(process.cwd(), '.vault', 'secrets.vault.json');
    const provided = opts.masterKey ?? process.env.TDX_MASTER_KEY;
    if (provided) {
      this.key = keyFromMaterial(provided);
    } else {
      const keyFile = `${this.path}.key`;
      if (existsSync(keyFile)) {
        this.key = keyFromMaterial(readFileSync(keyFile, 'utf8').trim());
      } else {
        this.key = randomBytes(32);
        mkdirSync(dirname(keyFile), { recursive: true });
        writeFileSync(keyFile, this.key.toString('base64'), { mode: 0o600 });
        mkdirSync(dirname(this.path), { recursive: true });
      }
    }
  }

  put(name: string, value: string): void {
    const vault = this.load();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    vault.entries[name] = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
    this.save(vault);
  }

  get(name: string): string | undefined {
    const e = this.load().entries[name];
    if (!e) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(e.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(e.data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error(`SecretsVault: cannot decrypt "${name}" (wrong master key or corrupted vault)`);
    }
  }

  has(name: string): boolean {
    return this.load().entries[name] !== undefined;
  }

  list(): string[] {
    return Object.keys(this.load().entries).sort();
  }

  delete(name: string): boolean {
    const vault = this.load();
    if (!(name in vault.entries)) return false;
    delete vault.entries[name];
    this.save(vault);
    return true;
  }

  /** Resolve a provider's key: vault first, environment fallback. */
  resolveProvider(provider: string, envFallback?: () => string | undefined): string | undefined {
    try {
      const v = this.get(provider);
      if (v) return v;
    } catch {
      /* fall through to env */
    }
    return envFallback?.();
  }

  private load(): VaultFile {
    if (!existsSync(this.path)) return { v: 1, entries: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as VaultFile;
      return { v: 1, entries: parsed.entries ?? {} };
    } catch {
      return { v: 1, entries: {} };
    }
  }

  private save(vault: VaultFile): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(vault, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}

function keyFromMaterial(material: string): Buffer {
  const trimmed = material.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  if (/^[A-Za-z0-9+/]{43}$/.test(trimmed) && trimmed.endsWith('=')) return Buffer.from(trimmed, 'base64');
  // Any other material: derive a 32-byte key (keeps dev friction low).
  return createHash('sha256').update(trimmed).digest();
}
