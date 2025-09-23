const fs = require('fs');
const path = require('path');

// Final type assertion and error fixes
const fixes = [
  // Fix undefined count issues
  {
    file: 'src/services/categoryService.ts',
    changes: [
      { from: 'parseInt(childCount.count)', to: 'parseInt(childCount?.count || "0")' },
      { from: 'parseInt(transactionCount.count)', to: 'parseInt(transactionCount?.count || "0")' },
      { from: 'categoryData.organization_id!', to: 'categoryData.organization_id' },
      { from: 'return this.getCategoryById(category.id, categoryData.organization_id);', to: 'return this.getCategoryById(category.id, categoryData.organization_id!);' }
    ]
  },
  // Fix rule parameter types
  {
    file: 'src/routes/rules/ruleRoutes.ts',
    changes: [
      { from: 'query.activeOnly', to: '(query as any).activeOnly' },
      { from: 'filters[key]', to: '(filters as any)[key]' }
    ]
  },
  // Fix policy parameter types  
  {
    file: 'src/routes/policy/policyRoutes.ts',
    changes: [
      { from: 'rule: any', to: 'rule: { [key: string]: any }' }
    ]
  },
  // Fix service parameter types
  {
    file: 'src/services/categoryService.ts', 
    changes: [
      { from: 'row: any', to: 'row: { [key: string]: any }' },
      { from: 'a: any', to: 'a: { [key: string]: any }' }, 
      { from: 'b: any', to: 'b: { [key: string]: any }' }
    ]
  },
  // Fix policy service types
  {
    file: 'src/services/policyEngineService.ts',
    changes: [
      { from: 'row: any', to: 'row: { [key: string]: any }' },
      { from: 'organizationId!', to: 'organizationId || ""' },
      { from: 'userId!', to: 'userId || ""' }
    ]
  },
  // Fix rule engine types
  {
    file: 'src/services/ruleEngineService.ts',
    changes: [
      { from: 'name: any', to: 'name: string' },
      { from: 'keyword: any', to: 'keyword: string' },
      { from: 'rule.actions!', to: 'rule.actions || {}' },
      { from: 'rule.conditions!', to: 'rule.conditions || {}' }
    ]
  }
];

fixes.forEach(({ file, changes }) => {
  const filepath = path.join(__dirname, file);
  if (fs.existsSync(filepath)) {
    let content = fs.readFileSync(filepath, 'utf8');
    
    changes.forEach(({ from, to }) => {
      content = content.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), to);
    });
    
    fs.writeFileSync(filepath, content);
    console.log(`Fixed: ${file}`);
  }
});

console.log('Final fixes complete!');
