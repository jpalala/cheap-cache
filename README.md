# Cheap Cache

A simple, in-memory TCP cache server written in TypeScript for Deno. It provides basic Redis-like `SET` and `GET` commands with a time-to-live (TTL) for keys. The project is designed to be a learning tool for building a network service in Deno.

## Features

* **In-Memory Cache**: Stores key-value pairs in a `Map` data structure for fast access.
* **Time-to-Live (TTL)**: Keys can be set with an expiration time in seconds.
* **Background Cleanup**: A simple, non-blocking cleanup loop automatically removes expired keys.
* **Simple TCP Protocol**: Communicates using a basic, RESP-like protocol for easy client interaction.
* **File Dumping**: Supports a `DUMP` command to write the current cache to a JSON file.

## Requirements

* [Deno](https://deno.land/) v1.34.0 or higher.

## How to Run

1. Clone this repository or create the files locally.
2. Open your terminal and navigate to the project directory.
3. Run the server with the following command. The `--allow-net` and `--allow-write` flags are necessary to allow the server to listen on a port and write the dump file.

```
deno run --allow-net --allow-write cheap_cache.ts
```

The server will start and listen on port `6379`.

## Usage

You can interact with the server using any TCP client, such as `netcat` or `telnet`.

**Using netcat (nc)**

1. Open a new terminal window.

```
nc localhost 6379
```

2. Type a command followed by `Enter`. The server's response will be displayed on the next line.

### Commands

| Command                   | Description                                                                     | Example                       |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------------------- |
| `SET <key> <value> <ttl>` | Sets a key-value pair with a TTL in seconds.                                    | `SET user:123 "Alice" 3600`   |
| `GET <key>`               | Retrieves the value for a key. Returns `$-1\r\n` if not found or expired.       | `GET user:123`                |
| `DUMP [filename]`         | Dumps all non-expired keys to a JSON file. Defaults to `cheap_cache_dump.json`. | `DUMP` or `DUMP my_data.json` |

## Example Interaction

```
# Set a key 'mykey' with value 'hello' that expires in 10 seconds
> SET mykey hello 10
+OK

# Get the value
> GET mykey
$5
hello

# Wait 10 seconds, then try to get it again
> GET mykey
$-1

# Dump the cache to a file
> DUMP my_backup.json
+OK
```

The `my_backup.json` file would contain the current state of the cache.

Let me know if you want this saved as a `.md` file.
