module.exports = {
  apps: [
    {
      name: 'fibreflow-prod',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3005',
      cwd: '/var/www/fibreflow',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3005,
        DATABASE_URL: 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
      },
      error_file: '/var/log/pm2/fibreflow-prod-error.log',
      out_file: '/var/log/pm2/fibreflow-prod-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'fibreflow-dev',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3006',
      cwd: '/var/www/fibreflow-dev',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 3006,
        DATABASE_URL: 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
      },
      error_file: '/var/log/pm2/fibreflow-dev-error.log',
      out_file: '/var/log/pm2/fibreflow-dev-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
