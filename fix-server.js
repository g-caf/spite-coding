const fs = require('fs');

// Add bypass flags to server startup
const serverPath = './src/server.ts';
let serverContent = fs.readFileSync(serverPath, 'utf8');

// Add bypass functionality at the top after imports
const bypassCode = `
// Bypass flags for deployment  
const asBool = (v?: string) => /^(1|true|yes)$/i.test(String(v || ''));
const FLAGS = {
  SKIP_MIGRATIONS: asBool(process.env.SKIP_MIGRATIONS),
  ALLOW_START_WITHOUT_DB: asBool(process.env.ALLOW_START_WITHOUT_DB)
};

console.log('Deployment flags:', FLAGS);
`;

// Insert after imports but before the main code
if (!serverContent.includes('SKIP_MIGRATIONS')) {
  serverContent = serverContent.replace(
    "import logger from '../config/logger';",
    "import logger from '../config/logger';" + bypassCode
  );
}

// Also modify app.ts to bypass problematic routes
const appPath = './src/app.ts';
let appContent = fs.readFileSync(appPath, 'utf8');

// Add safe route mounting
const safeRouteCode = `
// Safe route mounting function
function safeUseRouter(app: any, path: string, router: any, name: string) {
  try {
    if (typeof router === 'function') {
      app.use(path, router);
      logger.info(\`Mounted route: \${name} at \${path}\`);
    } else if (router && typeof router.default === 'function') {
      app.use(path, router.default);
      logger.info(\`Mounted route: \${name} at \${path} (via default export)\`);
    } else {
      logger.warn(\`Skipping invalid route: \${name} - not a function\`, { 
        type: typeof router, 
        keys: router ? Object.keys(router) : [] 
      });
    }
  } catch (error: any) {
    logger.warn(\`Failed to mount route: \${name}\`, { error: error.message, path });
  }
}
`;

if (!appContent.includes('safeUseRouter')) {
  appContent = appContent.replace(
    'import { TransactionMatcher }',
    safeRouteCode + '\nimport { TransactionMatcher }'
  );
}

fs.writeFileSync(serverPath, serverContent);
fs.writeFileSync(appPath, appContent);

console.log('Added bypass flags and safe route mounting!');
