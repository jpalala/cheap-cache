
Exactly ✅ — the **master should send to the slave**.

* **Master node:** receives `SET` commands from clients.
* **Slave node:** replicates the master’s data and can serve reads.
* **Replication logic:** `replicateToSlave(key, value, ttl)` opens a connection from the master to the **slave’s host/port**, sends the `SET`, and optionally closes or keeps the connection alive.

---

### How to configure

**Master environment variables:**

```bash
NODE_ROLE=master
SLAVE_HOST=10.0.0.2    # IP of slave node
SLAVE_PORT=6379        # port the slave listens on
```

**Slave environment variables:**

```bash
NODE_ROLE=slave
# No replication from slave
```

---

### Updated replication function

```ts
async function replicateToSlave(key: string, value: string, ttl: number) {
  if (NODE_ROLE === "slave") return; // slaves don't replicate further

  try {
    const conn = await Deno.connect({ hostname: SLAVE_HOST, port: SLAVE_PORT });
    const encoder = new TextEncoder();
    await conn.write(encoder.encode(`SET ${key} ${value} ${ttl}\n`));
    conn.close();
  } catch (err) {
    console.error("Replication to slave failed:", err);
  }
}
```

* Now **the master never writes to itself**.
* The slave just accepts commands and updates its local cache.
* You can call this function inside `setCache()` on the master:

```ts
function setCache(key: string, value: string, ttl: number) {
  const expiresAt = Date.now() + ttl * 1000;
  cache.set(key, { value, expiresAt });
  replicateToSlave(key, value, ttl); // forward to slave
}
```

---

This ensures **master → slave replication**, while **slave does not send back**.

If you want, I can **rewrite the whole cheapcache node module** to clearly separate master/slave logic and avoid any accidental self-replication.

---
#### Run Master:
```
docker build -t cheapcache .
docker run -d --name cheapcache-master -p 6379:6379 \
  -e NODE_ROLE=master cheapcache

```
#### Run Slave:
```
docker build -t cheapcache .
docker run -d --name cheapcache-slave -p 6380:6379 \
  -e NODE_ROLE=slave \
  -e MASTER_HOST=master_container_ip_or_host \
  -e MASTER_PORT=6379 \
  cheapcache
```



The code below is the key, that gets called everytime your master saves a key:

```typescript
async function replicateToSlave(key: string, value: string, ttl: number) {
  if (NODE_ROLE === "slave") return; // slaves don't replicate further

  try {
    const conn = await Deno.connect({ hostname: SLAVE_HOST, port: SLAVE_PORT });
    const encoder = new TextEncoder();
    await conn.write(encoder.encode(`SET ${key} ${value} ${ttl}\n`));
    conn.close();
  } catch (err) {
    console.error("Replication to slave failed:", err);
  }
}
```

## Example on how we could use Failover  

```php
  public function send(string $cmd): ?string {
        if (!$this->fp) {
            $this->connect();
        }

        fwrite($this->fp, $cmd . "\n");
        $response = fgets($this->fp);
        
        // here's the failover part
        if ($response === false) {
            // Connection lost, try next host
            fclose($this->fp);
            $this->fp = null;
            $this->currentHostIndex = ($this->currentHostIndex + 1) % count($this->hosts);
            $this->connect();
            return $this->send($cmd); // retry the command
        }

        return trim($response);
    }
```


# Summary of how to do master-slave replication

Here’s a clean summary of the **master-slave additions**:

---

### 1️⃣ Environment variables

```ts
// NODE_ROLE = "master" or "slave"
const NODE_ROLE = Deno.env.get("NODE_ROLE") || "master";

// For master to replicate to slave
const SLAVE_HOST = Deno.env.get("SLAVE_HOST") || "127.0.0.1";
const SLAVE_PORT = parseInt(Deno.env.get("SLAVE_PORT") || "6379");
```

* **Master node**: `NODE_ROLE=master`, `SLAVE_HOST=<slave_ip>`, `SLAVE_PORT=<slave_port>`
* **Slave node**: `NODE_ROLE=slave`

---

### 2️⃣ Replication function (master → slave)

```ts
async function replicateToSlave(key: string, value: string, ttl: number) {
  if (NODE_ROLE === "slave") return; // slaves don't replicate further

  try {
    const conn = await Deno.connect({ hostname: SLAVE_HOST, port: SLAVE_PORT });
    const encoder = new TextEncoder();
    await conn.write(encoder.encode(`SET ${key} ${value} ${ttl}\n`));
    conn.close();
  } catch (err) {
    console.error("Replication to slave failed:", err);
  }
}
```

* Only executed on **master**.
* Sends a `SET` command to the slave immediately after the master sets its own cache.
* Simple TCP connection per command; can be upgraded to persistent if needed.

---

### 3️⃣ `setCache` change

```ts
function setCache(key: string, value: string, ttl: number) {
  const expiresAt = Date.now() + ttl * 1000;
  cache.set(key, { value, expiresAt });

  // Only replicate if this is the master
  replicateToSlave(key, value, ttl);
}
```

* Every `SET` now calls `replicateToSlave` automatically.
* Slave nodes don’t call `replicateToSlave`, so no loop occurs.

---

### 4️⃣ Other parts of the server

* TCP server, `handleConnection`, GET/SET/DUMP/LIMIT commands all **remain the same**.
* Only addition is the **replication logic** and **NODE\_ROLE / SLAVE\_HOST environment awareness**.

---

✅ **In short:**

* **Master talks to slave** via `replicateToSlave()`.
* **Slave just handles its own cache**; it never replicates.
* All other server functionality (client TCP commands, LRU cache, DUMP, LIMIT) stays as before.

---

```typescript
// cheapcache_node.ts
import { LruCache } from "https://deno.land/x/lru_cache/mod.ts";

// --- Cache Setup ---
interface CacheEntry {
  value: string;
  expiresAt: number; // timestamp in ms
}

const MAX_KEYS = 10000;
const cache = new LruCache<string, CacheEntry>(MAX_KEYS);

// --- Master/Slave Config ---
const NODE_ROLE = Deno.env.get("NODE_ROLE") || "master"; // "master" or "slave"
const SLAVE_HOST = Deno.env.get("SLAVE_HOST") || "127.0.0.1";
const SLAVE_PORT = parseInt(Deno.env.get("SLAVE_PORT") || "6379");

// --- Replication (master → slave) ---
async function replicateToSlave(key: string, value: string, ttl: number) {
  if (NODE_ROLE === "slave") return; // slaves don't replicate further

  try {
    const conn = await Deno.connect({ hostname: SLAVE_HOST, port: SLAVE_PORT });
    const encoder = new TextEncoder();
    await conn.write(encoder.encode(`SET ${key} ${value} ${ttl}\n`));
    conn.close();
  } catch (err) {
    console.error("Replication to slave failed:", err);
  }
}

// --- Cache Operations ---
function setCache(key: string, value: string, ttl: number) {
  const expiresAt = Date.now() + ttl * 1000;
  cache.set(key, { value, expiresAt });

  // replicate to slave if master
  replicateToSlave(key, value, ttl);
}

function getCache(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

// --- Utility Responses ---
function sendOK(conn: Deno.Conn) {
  conn.write(new TextEncoder().encode("+OK\n"));
}

function sendErr(conn: Deno.Conn, msg: string) {
  conn.write(new TextEncoder().encode(`-ERR ${msg}\n`));
}

function sendBulkString(conn: Deno.Conn, value: string | null) {
  if (value === null) {
    conn.write(new TextEncoder().encode("$-1\n"));
  } else {
    conn.write(new TextEncoder().encode(`${value}\n`));
  }
}

// --- Dump Cache to File ---
async function dumpCache(filename: string) {
  const obj: Record<string, any> = {};
  for (const [k, v] of cache.entries()) {
    obj[k] = { value: v.value, expiresAt: v.expiresAt };
  }
  await Deno.writeTextFile(filename, JSON.stringify(obj, null, 2));
}

// --- TCP Server ---
const PORT = parseInt(Deno.env.get("PORT") || "6379");
const server = Deno.listen({ port: PORT, hostname: "0.0.0.0" });
console.log(`${NODE_ROLE} node listening on 0.0.0.0:${PORT}`);

for await (const conn of server) {
  handleConnection(conn);
}

// --- Connection Handler ---
async function handleConnection(conn: Deno.Conn) {
  const buffer = new Uint8Array(2048);

  try {
    while (true) {
      const n = await conn.read(buffer);
      if (!n) break; // client closed connection

      const command = new TextDecoder().decode(buffer.subarray(0, n)).trim();
      const parts = command.split(/\s+/);
      const cmd = parts[0].toUpperCase();

      switch (cmd) {
        case "SET":
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
            sendErr(conn, "SET requires key, value, ttl");
          }
          break;

        case "GET":
          if (parts.length === 2) {
            const [_, key] = parts;
            const val = getCache(key);
            sendBulkString(conn, val);
          } else {
            sendErr(conn, "GET requires key");
          }
          break;

        case "DUMP":
          const filename = parts[1] || "cheap_cache_dump.json";
          await dumpCache(filename);
          sendOK(conn);
          break;

        case "LIMIT":
          if (parts.length === 2) {
            const [_, sizeStr] = parts;
            const size = parseInt(sizeStr);
            if (isNaN(size) || size <= 0) {
              sendErr(conn, "invalid size (must be positive)");
            } else {
              cache.resize(size);
              sendOK(conn);
              console.log(`Cache size limit set to ${size}`);
            }
          } else {
            sendErr(conn, "LIMIT requires size");
          }
          break;

        default:
          sendErr(conn, "unknown command");
      }
    }
  } catch (err) {
    console.error("Connection error:", err);
  } finally {
    conn.close();
  }
}

```