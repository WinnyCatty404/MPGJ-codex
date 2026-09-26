from zipfile import ZipFile
from lxml import etree
import sys

path=sys.argv[1]
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with ZipFile(path) as z: root=etree.fromstring(z.read('word/document.xml'))
body=root.find('w:body',ns)
caption=''
for index,node in enumerate(body):
    kind=etree.QName(node).localname
    txt=''.join(node.xpath('.//w:t/text()',namespaces=ns)).strip()
    if kind=='p':
        if txt: caption=txt
        continue
    if kind!='tbl': continue
    rows=[]
    for tr in node.findall('w:tr',ns):
        cells=[]
        for tc in tr.findall('w:tc',ns): cells.append(''.join(tc.xpath('.//w:t/text()',namespaces=ns)).strip())
        rows.append(cells)
    joined=''.join(sum(rows,[]))
    if any(k in caption+joined for k in ['云平台','密码产品','安全管理文档','风险分析','应用和数据安全测评结果汇总','密评人员资格','系统定级备案','重要数据']):
        print('\nTABLE',index,'CAPTION=',repr(caption),'ROWS=',len(rows))
        for r in rows[:6]: print(repr(r))
