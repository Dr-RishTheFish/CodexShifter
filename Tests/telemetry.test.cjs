const {test}=require('node:test');const assert=require('node:assert/strict');const Core=require('../Resources/core.js');
test('resumed turn output rate excludes historical cumulative output',()=>{assert.equal(typeof Core.outputRate,'function');assert.equal(Core.outputRate({last:{outputTokens:100},total:{outputTokens:50100}},30),200);assert.equal(Core.outputRate(null,30),null)});
