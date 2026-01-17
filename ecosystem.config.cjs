module.exports = {
  apps: [
    {
      name: "cloud-trend-alert",
      script: "src/index.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 1000,
      env: {
        NODE_ENV: "production"
      },
      kill_timeout: 8000,
      listen_timeout: 8000,
      time: true
    }
  ]
};
