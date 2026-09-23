// PM2 process file for the VPS:  pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "legacy-flow",
      cwd: __dirname + "/..",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      env: { NODE_ENV: "production" },
      instances: 1,
      max_memory_restart: "700M",
      out_file: "/var/log/legacy-flow/out.log",
      error_file: "/var/log/legacy-flow/error.log",
      time: true,
    },
  ],
};
