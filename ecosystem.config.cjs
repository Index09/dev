module.exports = {
  apps: [
    {
      name: "whatsapp-manager",
      script: "./server.js", // or instanceManager.js if that’s your entry file
      instances: 3,           // You have 3 CPUs — use 3 workers
      exec_mode: "cluster",
      watch: false,
      env: {
        NODE_ENV: "production",
        REDIS_URL: "redis://127.0.0.1:6379",
        DB_PATH: "./data/database.sqlite",
      },
      env_development: {
        NODE_ENV: "development",
        REDIS_URL: "redis://127.0.0.1:6379",
        DB_PATH: "./data/database.sqlite",
      },
      max_memory_restart: "500M", // restart worker if memory exceeds 500MB
      autorestart: true,
      time: true,
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
    },
  ],
};