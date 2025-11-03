console.log('测试开始');
const dotenv = require('dotenv');
console.log('dotenv 版本:', require('dotenv/package.json').version);
const result = dotenv.config();
console.log('dotenv 加载结果:', result.error ? '失败' : '成功');
console.log('测试结束');