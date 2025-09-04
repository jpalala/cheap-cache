// Deno native TCP cache server with TTL
// To run: deno run --allow-net --allow-write cheap_cache.ts


// import { LruCache } from "jsr:@std/cache/lru-cache";
import { LruCache } from "jsr:@std/cache@0.2.0/lru-cache";

/**
 * A simple, in-memory TCP cache server.
 * It provides basic Redis-like GET and SET commands with TTL.
 *
 * To run: `deno run --allow-net --allow-write cheap_cache.ts`
 */

// The cache data structure using the Deno standard library.
// It manages the LRU logic internally. The size is based on the number of items.
let maxCacheItems = 10000; // Default limit: 10,000 items
const MAX_CONNECTIONS = 1000; // LIMIT 1000 clients at a time (dont worry, handled by the LRU cache!)
const PORT = 6379;

const cache = new LruCache<string, { value: string; expireAt: number }>(maxCacheItems);

// --- NEW: LRU cache to track active connections ---
const connCache = new LruCache<number, Deno.Conn>(MAX_CONNECTIONS, {
  onEviction: (_, conn) => {          // NEW: callback when evicted
    try {
      conn.close();                   // NEW: close evicted connection
    } catch (_) {}
  },
});

let nextConnId = 1; // NEW: unique ID for each connection

// Maximum TTL for keys (30 days in milliseconds).
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Helper to get current time in milliseconds.
const now = () => Date.now();

// --- Cache Operations ---

/**
 * Sets a key with a TTL in the cache.
 * @param key The key.
 * @param value The value.
 * @param ttl_seconds The time to live in seconds.
 */
function setCache(key: string, value: string, ttl_seconds: number) {
  // Cap the TTL
  let ttl = ttl_seconds <= 0 || ttl_seconds > MAX_TTL_MS / 1000
    ? MAX_TTL_MS
    : ttl_seconds * 1000;

  const expireAt = now() + ttl;
  
  // Use the LruCache's set method, which handles LRU and expiration.
  // The expireIn option is in milliseconds.
  cache.set(key, { value, expireAt }, { expireIn: ttl });
}

/**
 * Retrieves a value by key. Cleans up expired keys on access.
 * @param key The key to retrieve.
 * @returns The value or null if not found or expired.
 */
function getCache(key: string): string | null {
    const entry = cache.get(key);
    if (!entry) {
        return null;
    }
    // Check for expiration manually since LruCache's expireIn might be a soft expiration.
    if (entry.expireAt <= now()) {
        // The LruCache doesn't automatically remove expired items on get,
        // so we delete it here to keep the cache clean.
        cache.delete(key);
        return null;
    }
    return entry.value;
}

/**
 * Dumps the current non-expired cache to a JSON file.
 * @param filename The name of the file to write to.
 */
async function dumpCache(filename: string): Promise<void> {
  const data: Record<string, { value: string; ttl: number }> = {};
  const currentTime = now();

  for (const [key, entry] of cache.entries()) {
    if (entry.expireAt > currentTime) {
      data[key] = {
        value: entry.value,
        ttl: Math.round((entry.expireAt - currentTime) / 1000),
      };
    } else {
      cache.delete(key); // Clean up expired keys during dump
    }
  }

  await Deno.writeTextFile(filename, JSON.stringify(data, null, 2));
}

// --- Background Cleanup ---
// --- Background Cleanup ---

// Asynchronously clean up expired entries.
// This is still useful to clean up keys that are not being accessed.
async function startCleanupLoop() {
    const CLEANUP_INTERVAL_MS = 1000;
    while (true) {
        await new Promise((resolve) => setTimeout(resolve, CLEANUP_INTERVAL_MS));
        const currentTime = now();
        for (const [key, entry] of cache.entries()) {
            if (entry.expireAt <= currentTime) {
                cache.delete(key);
            }
        }
    }
}

// Start the cleanup loop.
startCleanupLoop();

// --- Network & Command Handling ---

// RESP-like helpers for Deno.
function sendOK(conn: Deno.Conn) {
    conn.write(new TextEncoder().encode("+OK\r\n"));
}

async function send(conn: Deno.Conn, message: string) {
  // Remove $<len> formatting
  await conn.write(new TextEncoder().encode(message + "\r\n"));
}

function sendErr(conn: Deno.Conn, msg: string) {
    conn.write(new TextEncoder().encode(`-ERR ${msg}\r\n`));
}

function sendBulkString(conn: Deno.Conn, s: string | null) {
    if (!s) {
        conn.write(new TextEncoder().encode("$-1\r\n"));
        return;
    }
    const encoder = new TextEncoder();
    const bytes = encoder.encode(s);
    const header = `$${bytes.length}\r\n`;
    conn.write(encoder.encode(header));
    conn.write(bytes);
    conn.write(encoder.encode("\r\n"));
}

/**
 * Handles incoming TCP connections.
 */
async function handleConnection(conn: Deno.Conn, id: number) {
  try {
    const buffer = new Uint8Array(2048);

    while (true) { // keep connection alive
      const n = await conn.read(buffer);
      if (!n) break; // client closed connection

      const command = new TextDecoder().decode(buffer.subarray(0, n)).trim();
      const parts = command.split(/\s+/);
      const cmd = parts[0].toUpperCase();

      switch (cmd) {
        case "SET": {
          if (parts.length === 4) {
            const [_, key, value, ttlStr] = parts;
            const ttl = parseInt(ttlStr);
            if (isNaN(ttl)) {
              sendErr(conn, "invalid TTL");
            } else {
              setCache(key, value, ttl);
              sendOK(conn);
            }
          } else {
            sendErr(conn, "SET requires key, value, and ttl");
          }
          break;
        }

        case "GET": {
          if (parts.length === 2) {
            const [_, key] = parts;
            const value = getCache(key);
            sendBulkString(conn, value);
          } else {
            sendErr(conn, "GET requires a key");
          }
          break;
        }

        case "DUMP": {
          const filename = parts[1] || "cheap_cache_dump.json";
          await dumpCache(filename);
          sendOK(conn);
          break;
        }

        case "LIMIT": {
          if (parts.length === 2) {
            const [_, sizeItemsStr] = parts;
            const sizeItems = parseInt(sizeItemsStr);
            if (isNaN(sizeItems) || sizeItems <= 0) {
              sendErr(conn, "invalid size (must be a positive integer)");
            } else {
              maxCacheItems = sizeItems;
              cache.resize(maxCacheItems);
              sendOK(conn);
              console.log(`Cache size limit set to ${sizeItems} items`);
            }
          } else {
            sendErr(conn, "LIMIT requires size in number of items");
          }
          break;
        }

        default:
          sendErr(conn, "unknown command");
      }
    }
  } catch (error) {
    console.error("Error handling connection:", error);
  } finally {
    connCache.delete(id);
    conn.close(); // only when client closes or error occurs
  }
}

// --- Main server ---
console.log(`CheapCache server listening on port ${PORT}`);
const server = Deno.listen({ port: PORT, transport: "tcp" });

for await (const conn of server) {
  const id = nextConnId++;
  connCache.set(id, conn); // automatically evict oldest if full
  handleConnection(conn, id);
}