module.exports = {
  apps: [
    {
      name: "cloud-trend-alert",
      script: "src/index.js",

      // IMPORTANT: keep single instance to avoid duplicate jobs/loops
      exec_mode: "fork",
      instances: 1,

      autorestart: true,

      // Production hardening
      time: true,
      node_args: "--enable-source-maps",

      // Restart / stability
      max_memory_restart: "350M",
      min_uptime: "10s",
      max_restarts: 50,
      restart_delay: 1000,
      exp_backoff_restart_delay: 100,

      // Graceful shutdown windows
      kill_timeout: 15000,
      listen_timeout: 8000,

      // Environment
      env: {
        NODE_ENV: "production"
      },

      // Logs (make sure ./logs exists on VPS: mkdir -p logs)
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      out_file: "./logs/out.log",
      error_file: "./logs/err.log",

      // Don't watch in production (avoid accidental restarts)
      watch: false
    }
  ]
};
