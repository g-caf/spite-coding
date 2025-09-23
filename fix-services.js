const fs = require('fs');
const path = require('path');

// Service files to process
const serviceFiles = [
  'src/services/categoryService.ts',
  'src/services/ruleEngineService.ts',
  'src/services/policyEngineService.ts',
  'src/services/receiptService.ts',
  'src/services/transactionCategorizationService.ts',
  'src/utils/audit.ts'
];

serviceFiles.forEach(file => {
  const filepath = path.join(__dirname, file);
  if (fs.existsSync(filepath)) {
    let content = fs.readFileSync(filepath, 'utf8');
    
    // Fix database field naming issues
    content = content.replace(/\.organizationId/g, '.organization_id');
    content = content.replace(/\.createdBy/g, '.created_by');
    content = content.replace(/\.updatedBy/g, '.updated_by');
    content = content.replace(/organizationId:/g, 'organization_id:');
    content = content.replace(/createdBy:/g, 'created_by:');
    content = content.replace(/updatedBy:/g, 'updated_by:');
    
    // Fix error handling
    content = content.replace(/error\.message/g, 'getErrorMessage(error)');
    
    // Fix potentially undefined values with non-null assertions
    content = content.replace(/childCount\.count/g, 'childCount!.count');
    content = content.replace(/transactionCount\.count/g, 'transactionCount!.count');
    content = content.replace(/activePoliciesCount/g, 'activePoliciesCount!');
    content = content.replace(/todaySpending/g, 'todaySpending!');
    content = content.replace(/weekSpending/g, 'weekSpending!');
    content = content.replace(/monthSpending/g, 'monthSpending!');
    content = content.replace(/totalResult/g, 'totalResult!');
    
    // Fix flagged_issues typo
    content = content.replace(/flagged_issues/g, 'flaggedIssues');
    
    // Add error handling import if not present
    if (!content.includes('import { getErrorMessage }') && content.includes('error.message')) {
      const imports = content.match(/^import.*?from.*?;$/gm);
      if (imports && imports.length > 0) {
        const lastImport = imports[imports.length - 1];
        content = content.replace(lastImport, lastImport + "\nimport { getErrorMessage } from '../utils/errorHandling';");
      }
    }
    
    fs.writeFileSync(filepath, content);
    console.log(`Fixed: ${file}`);
  }
});

console.log('Service fixes complete!');
