module.exports = {
  apps: [
    {
      name: "cloud-trend-alert",
      script: "src/index.js",
      interpreter: "node",
      env: {
        NODE_ENV: "production"
      },
      max_restarts: 20,
      restart_delay: 3000,
      time: true
    }
  ]
};
