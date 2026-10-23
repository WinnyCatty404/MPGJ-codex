// 表1-1 测评项目组成员导入：系统用户表中不存在的人员直接不导入（方案 A）
// 直接从构建输入页抽取导入逻辑实跑，避免测试与页面实现脱节。
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FILES = ['frontend/src/report-generator.html', 'frontend/public/prototype.html'];

const START = "if (includePlanning) (function () {\n      const team = findTN('测评项目组成员');";
const END_MARK = "})(); else add(s2, '表1-1测评项目组成员：本次未选择导入测评准备与方案，保留原值');";

function extractBlock(source) {
  const start = source.indexOf(START);
  assert.ok(start >= 0, '未找到表1-1导入块起点');
  const end = source.indexOf(END_MARK, start);
  assert.ok(end > start, '未找到表1-1导入块终点');
  return source.slice(start, end + '})();'.length);
}

const blocks = FILES.map(path => ({ path, block: extractBlock(fs.readFileSync(path, 'utf8')) }));
// 两份文件必须同构，否则页面与源码行为会分叉
assert.equal(blocks[0].block, blocks[1].block, 'src 与 prototype 的导入逻辑必须一致');

// 块内依赖通过参数注入：findTN / getEvalUserNameList / newPlanMember / renderPlanMembers / add / s2
function run(block, { rows, userNames, existing = [] }) {
  const messages = [];
  const rendered = [];
  const fn = new Function('includePlanning', 'findTN', 'getEvalUserNameList', 'newPlanMember',
    'renderPlanMembers', 'add', 's2', 'state', `
    let planMembers = state.planMembers;
    ${block}
    return planMembers;
  `);
  const members = fn(true,
    caption => (caption === '测评项目组成员' ? { rows } : null),
    () => userNames,
    values => ({ id: 'pm-' + Math.random().toString(36).slice(2, 8), role: values.role || '', name: values.name || '',
      task: values.task || '', passed: values.passed || '是', importedName: values.importedName || '' }),
    () => rendered.push(1),
    (section, text, warn) => messages.push({ section, text, warn: !!warn }),
    's2',
    { planMembers: existing.slice() });
  return { members, messages, rendered: rendered.length };
}

const HEADER = ['角色', '姓名', '任务分工', '是否通过密评人员考核'];
const table = (...people) => [HEADER, ...people.map(p => [p.role || '组员', p.name, p.task || '任务', p.passed || '是'])];
const block = blocks[0].block;

// 1. 3 人中 1 人不在用户列表 → 只导入 2 人，且不产生空姓名行
const mixed = run(block, {
  rows: table({ name: '张三' }, { name: '李四' }, { name: '王五' }),
  userNames: ['张三', '李四']
});
assert.equal(mixed.members.length, 2, '未匹配的人员不应生成成员行');
assert.deepEqual(mixed.members.map(m => m.name).join(','), '张三,李四');
assert.ok(mixed.members.every(m => m.name), '不得残留姓名为空的成员行');
assert.ok(mixed.members.every(m => !m.importedName), '不得残留 importedName 占位');
assert.equal(mixed.rendered, 1, '导入成功后应刷新成员表');
const skipMsg = mixed.messages.find(m => m.text.includes('王五'));
assert.ok(skipMsg, '应提示被跳过的人员姓名');
assert.ok(skipMsg.text.includes('未导入该成员'), '提示应说明该成员未导入');
assert.equal(skipMsg.warn, true, '被跳过的人应作为警示项列出');
const summary = mixed.messages[mixed.messages.length - 1];
assert.ok(summary.text.includes('导入 2 人'), '汇总应写明导入人数');
assert.ok(summary.text.includes('跳过 1 人'), '汇总应写明跳过人数');
assert.ok(summary.text.includes('王五'), '汇总应列出被跳过的人名');
assert.equal(summary.warn, false, '部分导入成功时汇总不算失败');

// 2. 全部不在用户列表 → 一条都不导入，保留现有人员（不清空）
const existing = [{ id: 'old', role: '项目负责人', name: '赵六', task: '原任务', passed: '是', importedName: '' }];
const allMissing = run(block, { rows: table({ name: '王五' }, { name: '钱七' }), userNames: ['张三'], existing });
assert.deepEqual(allMissing.members.map(m => m.name), ['赵六'], '全部未匹配时必须保留现有成员');
assert.equal(allMissing.rendered, 0, '未导入任何成员时不应刷新成员表');
const emptyMsg = allMissing.messages[allMissing.messages.length - 1];
assert.ok(emptyMsg.text.includes('保留现有人员'), '应提示保留现有人员');
assert.equal(emptyMsg.warn, true, '全部未匹配应作为警示项');

// 3. 全部在用户列表 → 全部导入，汇总不出现“跳过”
const allMatched = run(block, {
  rows: table({ name: '张三' }, { name: '李四' }, { name: '王五' }),
  userNames: ['张三', '李四', '王五']
});
assert.equal(allMatched.members.length, 3);
assert.deepEqual(allMatched.members.map(m => m.name).join(','), '张三,李四,王五');
const okSummary = allMatched.messages[allMatched.messages.length - 1];
assert.ok(okSummary.text.includes('导入 3 人'), '汇总应写明导入人数');
assert.ok(!okSummary.text.includes('跳过'), '无跳过时汇总不应出现跳过字样');
assert.ok(!allMatched.messages.some(m => m.warn), '全部匹配时不应产生警示');

// 4. 姓名为空的数据行仍被忽略（不进成员、不计入跳过）
const blank = run(block, {
  rows: [HEADER, ['组员', '', '任务', '是'], ['组员', '张三', '任务', '是']],
  userNames: ['张三']
});
assert.equal(blank.members.length, 1);
assert.ok(!blank.messages.some(m => m.text.includes('跳过')), '空姓名行不算跳过');

// 5. 表头缺失时保持原有早退逻辑，不误清空成员
const noHeader = run(block, { rows: [['组员', '张三']], userNames: ['张三'], existing });
assert.deepEqual(noHeader.members.map(m => m.name), ['赵六']);
assert.ok(noHeader.messages.some(m => m.text.includes('缺少“姓名”列')));

// 6. 考核列“否”仍正确写入（改动不得影响其它字段）
const passed = run(block, { rows: [HEADER, ['组员', '张三', '任务', '否']], userNames: ['张三'] });
assert.equal(passed.members[0].passed, '否');
assert.equal(passed.members[0].task, '任务');
assert.equal(passed.members[0].role, '组员');

console.log('test-plan-member-import: OK（6 组场景 · 两份文件同构校验）');
