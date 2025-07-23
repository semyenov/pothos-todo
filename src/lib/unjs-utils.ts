/**
 * Unified UnJS utilities module
 * Centralizes all UnJS package integrations for the application
 */

// Core utilities
import { $fetch, ofetch } from "ofetch";
import { consola } from "consola";
import { defu } from "defu";
import { hash } from "ohash";
import {
  joinURL,
  withQuery,
  parseURL,
  cleanDoubleSlashes,
  withBase,
} from "ufo";
import { resolve, join, dirname, basename, extname, normalize } from "pathe";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import redisDriver from "unstorage/drivers/redis";
import memoryDriver from "unstorage/drivers/memory";

// Advanced utilities
import { pascalCase, camelCase, kebabCase, snakeCase } from "scule";
import { createJiti } from "jiti";
import { resolveSync, resolvePath, createResolve } from "mlly";
import { loadConfig } from "unconfig";
import { createUnhead } from "unhead";
import { subtle, randomUUID } from "uncrypto";
import { listen } from "listhen";
import { detectPackageManager, installDependencies } from "nypm";
import { fileURLToPath } from "node:url";
import { readPackageJSON, writePackageJSON } from "pkg-types";

/**
 * Enhanced HTTP client with advanced features
 */
export class UnJSHttpClient {
  private client: typeof $fetch;

  constructor(baseURL?: string, options: any = {}) {
    this.client = $fetch.create({
      baseURL,
      retry: 3,
      retryDelay: 500,
      timeout: 30000,
      ...options,
    });
  }

  async get<T = any>(url: string, options?: any): Promise<T> {
    return this.client<T>(url, { method: "GET", ...options });
  }

  async post<T = any>(url: string, data?: any, options?: any): Promise<T> {
    return this.client<T>(url, { method: "POST", body: data, ...options });
  }

  async put<T = any>(url: string, data?: any, options?: any): Promise<T> {
    return this.client<T>(url, { method: "PUT", body: data, ...options });
  }

  async delete<T = any>(url: string, options?: any): Promise<T> {
    return this.client<T>(url, { method: "DELETE", ...options });
  }

  async patch<T = any>(url: string, data?: any, options?: any): Promise<T> {
    return this.client<T>(url, { method: "PATCH", body: data, ...options });
  }
}

/**
 * Advanced storage abstraction using unstorage
 */
export class UnJSStorage {
  private storage: ReturnType<typeof createStorage>;

  constructor(options: { driver?: string; base?: string; redis?: any } = {}) {
    const { driver = "memory", base = "./storage", redis } = options;

    let storageDriver;
    switch (driver) {
      case "fs":
        storageDriver = fsDriver({ base });
        break;
      case "redis":
        storageDriver = redisDriver(redis || { host: "localhost", port: 6379 });
        break;
      case "memory":
      default:
        storageDriver = memoryDriver();
        break;
    }

    this.storage = createStorage({
      driver: storageDriver,
    });
  }

  async get<T = any>(key: string): Promise<T | null> {
    return this.storage.getItem<T>(key);
  }

  async set<T = any>(key: string, value: T): Promise<void> {
    await this.storage.setItem(key, value);
  }

  async del(key: string): Promise<void> {
    await this.storage.removeItem(key);
  }

  async has(key: string): Promise<boolean> {
    return this.storage.hasItem(key);
  }

  async keys(base?: string): Promise<string[]> {
    return this.storage.getKeys(base);
  }

  async clear(base?: string): Promise<void> {
    await this.storage.clear(base);
  }

  async getMany<T = any>(keys: string[]): Promise<(T | null)[]> {
    return Promise.all(keys.map((key) => this.get<T>(key)));
  }

  async setMany<T = any>(items: Record<string, T>): Promise<void> {
    await Promise.all(
      Object.entries(items).map(([key, value]) => this.set(key, value))
    );
  }
}

/**
 * URL utilities with enhanced functionality
 */
export class UnJSUrlUtils {
  static join(...parts: string[]): string {
    return joinURL(...parts);
  }

  static withQuery(url: string, query: Record<string, any>): string {
    return withQuery(url, query);
  }

  static parse(url: string) {
    return parseURL(url);
  }

  static clean(url: string): string {
    return cleanDoubleSlashes(url);
  }

  static withBase(url: string, base: string): string {
    return withBase(url, base);
  }

  static isAbsolute(url: string): boolean {
    return (
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("//")
    );
  }

  static normalize(url: string): string {
    return this.clean(url);
  }
}

/**
 * Path utilities with cross-platform support
 */
export class UnJSPathUtils {
  static resolve(...paths: string[]): string {
    return resolve(...paths);
  }

  static join(...paths: string[]): string {
    return join(...paths);
  }

  static dirname(path: string): string {
    return dirname(path);
  }

  static basename(path: string, ext?: string): string {
    return basename(path, ext);
  }

  static extname(path: string): string {
    return extname(path);
  }

  static normalize(path: string): string {
    return normalize(path);
  }

  static isAbsolute(path: string): boolean {
    return resolve(path) === normalize(path);
  }

  static relative(from: string, to: string): string {
    return resolve(to).replace(resolve(from), "").replace(/^\//, "");
  }
}

/**
 * Object utilities with hashing and deep merging
 */
export class UnJSObjectUtils {
  static hash(obj: any): string {
    return hash(obj);
  }

  static objectHash(obj: any): string {
    return hash(obj);
  }

  static merge<T = any>(...objects: any[]): T {
    return defu(...objects);
  }

  static deepClone<T = any>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  static pick<T = Record<string, any>, K extends keyof T>(
    obj: T,
    keys: K[]
  ): Pick<T, K> {
    const result = {} as Pick<T, K>;
    for (const key of keys) {
      if (key in obj) {
        result[key] = obj[key];
      }
    }
    return result;
  }

  static omit<T = Record<string, any>, K extends keyof T>(
    obj: T,
    keys: K[]
  ): Omit<T, K> {
    const result = { ...obj };
    for (const key of keys) {
      delete result[key];
    }
    return result;
  }
}

/**
 * String utilities with case conversion and validation
 */
export class UnJSStringUtils {
  static camelCase = camelCase;
  static pascalCase = pascalCase;
  static kebabCase = kebabCase;
  static snakeCase = snakeCase;
  // Note: These case conversion functions are available via scule import

  static capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  static uncapitalize(str: string): string {
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  static truncate(str: string, length: number, suffix = "..."): string {
    if (str.length <= length) return str;
    return str.slice(0, length - suffix.length) + suffix;
  }

  static random(length = 10): string {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  static slug(str: string): string {
    return this.kebabCase(str.toLowerCase().replace(/[^\w\s-]/g, ""));
  }
}

/**
 * Crypto utilities for hashing and encryption
 */
export class UnJSCryptoUtils {
  static async hash(data: string, algorithm = "SHA-256"): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await subtle.digest(algorithm, dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  static randomBytes(size: number): Uint8Array {
    const bytes = new Uint8Array(size);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    }
    return bytes;
  }

  static uuid(): string {
    return randomUUID();
  }

  static base64Encode(data: string): string {
    return Buffer.from(data, "utf8").toString("base64");
  }

  static base64Decode(data: string): string {
    return Buffer.from(data, "base64").toString("utf8");
  }
}

/**
 * Configuration management with unconfig
 */
export class UnJSConfigManager {
  static async loadConfig<T = any>(
    options: {
      sources?: any[];
      defaults?: T;
      cwd?: string;
    } = {}
  ): Promise<{ config: T; sources: string[] }> {
    const { config } = await loadConfig<T>({
      name: "config",
      sources: options.sources || ["config.ts", "config.js", "config.json"],
      defaults: options.defaults,
      cwd: options.cwd,
    });
    return { config: config || ({} as T), sources: ["config"] };
  }

  static async writeConfig(path: string, config: any): Promise<void> {
    // Implementation would depend on the specific config format
    const fs = await import("fs/promises");
    await fs.writeFile(path, JSON.stringify(config, null, 2));
  }
}

/**
 * Package.json utilities
 */
export class UnJSPackageUtils {
  static async readPackageJSON(path?: string): Promise<any> {
    return readPackageJSON(path || ".");
  }

  static async writePackageJSON(pkg: any, path?: string): Promise<void> {
    return writePackageJSON(pkg, path);
  }

  static async getPackageInfo(packageName: string): Promise<any> {
    try {
      const pkg = await readPackageJSON();
      return (
        pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName]
      );
    } catch {
      return null;
    }
  }
}

/**
 * Module resolution utilities
 */
export class UnJSModuleUtils {
  static async resolve(id: string, options?: any): Promise<string> {
    return resolvePath(id, options);
  }

  static createResolver(options?: any) {
    return createResolve(options);
  }

  static fileURLToPath(url: string): string {
    return fileURLToPath(url);
  }
}

// Singleton instances for common use
export const httpClient = new UnJSHttpClient();
export const storage = new UnJSStorage();
export const urlUtils = UnJSUrlUtils;
export const pathUtils = UnJSPathUtils;
export const objectUtils = UnJSObjectUtils;
export const stringUtils = UnJSStringUtils;
export const cryptoUtils = UnJSCryptoUtils;
export const configManager = UnJSConfigManager;
export const packageUtils = UnJSPackageUtils;
export const moduleUtils = UnJSModuleUtils;

// Export logger instance
export const logger = consola;

// Export default instances
export {
  $fetch,
  ofetch,
  defu,
  hash,
  hash as objectHash,
  joinURL,
  withQuery,
  parseURL,
  cleanDoubleSlashes,
  withBase,
  resolve,
  join,
  dirname,
  basename,
  extname,
  normalize,
  createStorage,
  scule,
  jiti,
  mlly,
  unconfig,
  createHead,
  unhead,
  uncrypto,
  unws,
  unrouter,
  citty,
  listhen,
  nypm,
  untar,
};
