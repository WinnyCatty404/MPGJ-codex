import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const relative of ['../frontend/public/prototype.html', '../frontend/src/report-generator.html']) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  assert.match(source, /id="topology-block-list"/, `${relative} 缺少拓扑图文块容器`);
  assert.match(source, /id="topology-file"[^>]*multiple/, `${relative} 应支持一次选择多张图片`);
  assert.match(source, /data\.topologyBlocks\s*=\s*clone\(topologyBlocks\)/, `${relative} 应保存拓扑图文块`);
  assert.match(source, /saved\.topologyBlocks/, `${relative} 应恢复已保存的拓扑图文块`);
  assert.match(source, /function moveTopologyBlock[\s\S]*?notifyTopologyBlocksChanged\(\)/, `${relative} 调整顺序后应自动保存`);
  assert.match(source, /function removeTopologyBlock[\s\S]*?notifyTopologyBlocksChanged\(\)/, `${relative} 删除后应自动保存`);
}

console.log('PASS: 网络拓扑页面支持图文块新增、排序、保存和恢复');
