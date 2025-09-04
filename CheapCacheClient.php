<?php
class CheapCacheClient {
    private $fp;
    private string $host;
    private int $port;

    public function __construct(string $host = "127.0.0.1", int $port = 6379) {
        $this->host = $host;
        $this->port = $port;

        $this->fp = fsockopen($host, $port, $errno, $errstr, 1);
        if (!$this->fp) {
            throw new Exception("Connection failed: $errstr ($errno)");
        }

        // Ensure connection closes gracefully at script shutdown
        register_shutdown_function([$this, 'disconnect']);
    }

    public function send(string $cmd): ?string {
        if (!$this->fp) {
            throw new Exception("Not connected to CheapCache server");
        }

        fwrite($this->fp, $cmd . "\n");
        $response = fgets($this->fp);
        return $response !== false ? trim($response) : null;
    }

    public function disconnect(): void {
        if ($this->fp) {
            fclose($this->fp);
            $this->fp = null;
        }
    }
}

// --- Usage ---
$cache = new CheapCacheClient();

echo $cache->send("SET foo bar 60") . PHP_EOL; // +OK
echo $cache->send("GET foo") . PHP_EOL;        // $3\nbar
echo $cache->send("DUMP cheap_cache_dump.json") . PHP_EOL; // +OK
