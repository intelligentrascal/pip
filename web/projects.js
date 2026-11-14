// Approved ELF-8 continuity, rendered through the existing exact-review surface.
window.pipRenderProjects=function renderProjects(root,{state,node,button,proposal,useProject,openWork,back}) {
 root.replaceChildren();
 root.append(node('h2','Projects'),node('p','Save only context you approve. References never grant file, browser or account access. Recheck sources before relying on them.'));
 const projects=(state.projects??[]).filter(p=>p.active);
 const edit=project=>{
  root.replaceChildren();root.append(node('h2',project?'Edit project context':'New project context'));
  const field=(label,id,value,multiline=false)=>{const l=node('label',label),input=node(multiline?'textarea':'input');l.htmlFor=id;input.id=id;input.value=value;input.maxLength=multiline?12000:1000;root.append(l,input);return input;};
  const title=field('Project title','project-title',project?.title??'');
  const summary=field('Approved summary','project-summary',project?.summary??'',true);
  const provenance=field('Where this context came from','project-provenance',project?.provenance??'');
  const pins=field('Pinned public references: one title | HTTPS address | last checked date per line','project-pins',(project?.pins??[]).map(p=>`${p.title} | ${p.reference} | ${p.checkedAt}`).join('\n'),true);
  root.append(node('p','Dates describe your last source check, not a fresh read by Pip. Remove a line to unpin it.'));
  const links=[];
  root.append(node('h3','Unfinished work'));
  for(const w of state.works.filter(w=>w.status!=='Done'||project?.workIds.includes(w.id))){const label=node('label'),input=node('input');input.type='checkbox';input.style.width='auto';input.checked=project?.workIds.includes(w.id)??false;label.append(input,document.createTextNode(w.request));root.append(label);links.push({id:w.id,input});}
  root.append(node('p','Saving permits this summary to be offered to '+(window.pipProviderName||'Claude')+' only when you explicitly choose it for a request. It starts no work.'));
  const error=node('p');error.setAttribute('role','alert');root.append(error);
  root.append(button('Review project context',()=>{try{
   const parsed=pins.value.trim()?pins.value.trim().split('\n').map(line=>{const parts=line.split('|').map(s=>s.trim());if(parts.length!==3)throw Error('Each reference needs a title, HTTPS address and check date.');return {title:parts[0],reference:parts[1],checkedAt:parts[2]};}):[];
   proposal({type:'project.save',projectId:project?.id??crypto.randomUUID(),revision:project?.revision??0,title:title.value,summary:summary.value,provenance:provenance.value,pins:parsed,workIds:links.filter(l=>l.input.checked).map(l=>l.id)});
  }catch(e){error.textContent=e.message;}}),button('Cancel',()=>renderProjects(root,{state,node,button,proposal,useProject,openWork,back})));
 };
 root.append(button('New project',()=>edit(null)));
 if(!projects.length)root.append(node('p','No approved projects yet.'));
 for(const p of projects){const section=node('section');section.append(node('h3',p.title),node('p',p.summary),node('small',`Revision ${p.revision} · ${p.updatedAt}\nSource: ${p.provenance}`));
  for(const pin of p.pins)section.append(node('p',`${pin.title} · ${pin.reference}\nLast checked: ${pin.checkedAt} · Not permission to reopen`));
  for(const id of p.workIds){const w=state.works.find(w=>w.id===id);section.append(button(`${w?.status??'Unavailable'} · ${w?.request??id}`,()=>openWork(id)));}
  section.append(button('Use for next request',()=>useProject(p)),button('Edit summary and pins',()=>edit(p)),button('Forget project',()=>proposal({type:'project.forget',projectId:p.id,revision:p.revision})));root.append(section);
 }
 root.append(button('Back',back));
}
