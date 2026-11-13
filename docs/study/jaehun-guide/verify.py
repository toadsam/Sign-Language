"""Check navigation and exact embedded source fidelity without executing ML code."""
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
import subprocess

here=Path(__file__).resolve().parent
root=here.parents[2]
manifest=json.loads((here/'source-manifest.json').read_text(encoding='utf-8'))
by_id={'src-'+p.replace('/','-').replace('.','-'):p for p in manifest['files']}

class Check(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids=[];self.links=[];self.sections=0;self.external_dependencies=[]
        self.file=None;self.capture=False;self.number=False;self.line='';self.lines={}
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if 'id' in a:self.ids.append(a['id'])
        if tag=='a' and a.get('href','').startswith('#'):self.links.append(a['href'][1:])
        if tag=='section' and a.get('class')=='lesson':self.sections+=1
        if tag=='script' and a.get('src'):self.external_dependencies.append(a['src'])
        if tag=='link' and a.get('rel')=='stylesheet':self.external_dependencies.append(a.get('href'))
        if tag=='article' and a.get('id') in by_id:
            self.file=by_id[a['id']];self.lines[self.file]=[]
        if self.file and tag=='span' and a.get('class')=='code-line':self.capture=True;self.line=''
        if self.capture and tag=='b':self.number=True
    def handle_data(self,data):
        if self.capture and not self.number:self.line+=data
    def handle_endtag(self,tag):
        if tag=='b':self.number=False
        if tag=='span' and self.capture:self.lines[self.file].append(self.line);self.capture=False
        if tag=='article':self.file=None

c=Check();c.feed((here/'index.html').read_text(encoding='utf-8'))
assert len(c.ids)==len(set(c.ids)), 'Duplicate DOM IDs'
assert not set(c.links)-set(c.ids), 'Broken internal links'
assert c.sections==18 and len(c.lines)==27
assert not c.external_dependencies, 'Offline guide has external dependencies'
for path,sha in manifest['files'].items():
    src=subprocess.check_output(['git','-C',str(root),'show',f"{manifest['source_commit']}:{path}"]).decode('utf-8')
    assert hashlib.sha256(src.encode()).hexdigest()==sha,path
    assert c.lines[path]==src.splitlines(),f'Source text mismatch: {path}'
report={'chapters':c.sections,'exact_source_files':len(c.lines),'internal_link_references':len(c.links),'duplicate_ids':0,'broken_internal_links':0,'external_runtime_dependencies':0,'source_commit':manifest['source_commit'],'result':'pass'}
(here/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
