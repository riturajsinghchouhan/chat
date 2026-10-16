// PM2 process file for an Ubuntu VPS: `pm2 start ecosystem.config.cjs --env production`
// One instance by default. To run several instances, set REDIS_URL (Socket.IO Redis adapter)
// and keep Nginx sticky sessions (ip_hash) so HTTP long-polling fallbacks stay on one process.
module.exports = {
  apps: [
    {
      name: 'pulse-chat-api',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '600M',
      kill_timeout: 12000, // graceful shutdown window (server closes sockets + DB within 10s)
      restart_delay: 2000,
      exp_backoff_restart_delay: 200,
      time: true,
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
