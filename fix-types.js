const fs = require('fs');
const path = require('path');

// Files to process
const routeFiles = [
  'src/routes/policy/policyRoutes.ts',
  'src/routes/rules/ruleRoutes.ts', 
  'src/routes/transactions/categorizationRoutes.ts'
];

routeFiles.forEach(file => {
  const filepath = path.join(__dirname, file);
  if (fs.existsSync(filepath)) {
    let content = fs.readFileSync(filepath, 'utf8');
    
    // Add error handling import if not present
    if (!content.includes('import { getErrorMessage }')) {
      const imports = content.match(/^import.*?from.*?;$/gm);
      if (imports && imports.length > 0) {
        const lastImport = imports[imports.length - 1];
        content = content.replace(lastImport, lastImport + "\nimport { getErrorMessage } from '../../utils/errorHandling';");
      }
    }
    
    // Fix req.user undefined issues
    content = content.replace(/req\.user\./g, 'req.user!.');
    
    // Fix error.message issues  
    content = content.replace(/error\.message/g, 'getErrorMessage(error)');
    
    fs.writeFileSync(filepath, content);
    console.log(`Fixed: ${file}`);
  }
});

console.log('Route fixes complete!');
