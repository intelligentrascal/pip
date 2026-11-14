// AI provider settings and the per-provider Allow screen. Secrets never reach this page:
// the key field is a native secure field, and sign-in happens on the provider's own page.
window.pipRenderProviders=function(root,{providers,node,button,emit,showAllow}){
 root.append(node('h3','AI provider'));
 if(!providers.length){root.append(node('p','Provider choices are unavailable.'));return;}
 const active=providers.find(p=>p.active);
 root.append(node('p',`Pip uses ${active?.name??'Claude'} for requests. Nothing is sent to a provider until you read its Allow screen and choose Allow.`));
 for(const p of providers){
  const box=node('div',undefined,'provider');box.dataset.provider=p.id;
  box.append(node('strong',p.name),node('p',[p.connected?'Connected':'Not connected',p.allowed?'Allowed':'Not allowed',p.active?'Active':'',p.backup?'Backup':''].filter(Boolean).join(' · '),'label'));
  const model=node('select');model.setAttribute('aria-label',p.name+' model');
  for(const m of p.models){const o=node('option',m.label);o.value=m.id;model.append(o);}
  model.value=p.model;
  const actions=node('div',undefined,'actions');
  actions.append(model);
  actions.append(button(p.allowed?'Withdraw Allow':'Review Allow',()=>p.allowed?emit('provider.withdraw',{id:p.id}):showAllow(p.id),'secondary'));
  if(p.connect==='sign-in-page'){
   const signIn=button(p.signingIn?'Waiting for sign-in…':p.id==='openai'?'Continue with ChatGPT':'Sign in with '+p.name,()=>emit('provider.signIn',{id:p.id}),'secondary');
   signIn.disabled=p.signingIn;actions.append(signIn);
   if(p.signingIn)actions.append(button('Cancel sign-in',()=>emit('provider.cancelSignIn',{id:p.id}),'secondary'));
  }
  if(p.connect==='secure-field')actions.append(button(p.connected?'Replace key…':'Enter key…',()=>emit('provider.enterKey',{id:p.id}),'secondary'));
  if(p.connected&&p.connect!=='claude-program')actions.append(button('Remove',()=>emit('provider.remove',{id:p.id}),'secondary'));
  const use=button(p.active?'Use this model':'Use '+p.name,()=>emit('provider.select',{id:p.id,model:model.value}),'secondary');
  use.disabled=!(p.allowed&&p.connected);actions.append(use);
  box.append(actions);
  if(p.message)box.append(node('p',p.message,'notice'));
  root.append(box);
 }
 const label=node('label','Backup provider');label.htmlFor='provider-backup';
 const backup=node('select');backup.id='provider-backup';
 const none=node('option','None');none.value='';backup.append(none);
 for(const p of providers.filter(p=>p.allowed&&!p.active)){const o=node('option',p.name);o.value=p.id;backup.append(o);}
 backup.value=providers.find(p=>p.backup)?.id??'';
 backup.onchange=()=>emit('provider.backup',{id:backup.value||null});
 root.append(label,backup,node('p','Used only when the active provider cannot answer at all: signed out, out of credit, down or a rejected key. Not used after a time or turn stop, which still waits for your Continue. A backup answer says so. If it also fails, Pip keeps your request and tries no other provider.'));
};
window.pipRenderAllow=function(root,{provider,node,button,emit,back}){
 root.append(node('div','Allow '+provider.name,'label'),node('h2',`Let Pip send requests to ${provider.name}?`));
 root.append(node('p','Pip sends nothing to this provider until you choose Allow.'),node('h3','What is sent'));
 const list=node('ul');for(const s of provider.disclosure.sends)list.append(node('li',s));root.append(list);
 root.append(node('h3','Where it goes'),node('p',provider.disclosure.goes),node('h3','Who bills'),node('p',provider.disclosure.bills));
 const actions=node('div',undefined,'actions');
 actions.append(button('Allow '+provider.name,()=>{emit('provider.allow',{id:provider.id});back();}),button('Not now',back,'secondary'));
 root.append(actions);
};
