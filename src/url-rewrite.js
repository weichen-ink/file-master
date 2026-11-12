const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const decode = value => {try{return decodeURI(value);}catch{return value;}};
/** Exact URL bases only: preserve queries, fragments, alt text, and unrelated hosts or longer filenames. */
export function createUrlRewriter(mappings, serverUrl = '', onMatch = null) {
  const replacements=new Map();
  const add=(from,to,reference=to)=>{
    if(!from||!to||from===to)return;
    for(const [a,b] of [[from,to],[decode(from),decode(to)]]) {
      replacements.set(a,{text:b,reference});
      replacements.set(encodeURI(decode(a)),{text:encodeURI(decode(b)),reference});
      replacements.set(a.replace(/\//g,'\\/'),{text:b.replace(/\//g,'\\/'),reference});
    }
  };
  for(const {from,to} of mappings || []) {
    add(from,to);
    try {
      const oldUrl=new URL(from);
      let newUrl;try {newUrl=new URL(to);} catch {}
      add(oldUrl.pathname,newUrl?.pathname || to,to);
      if(serverUrl) {const origin=new URL(serverUrl).origin;add(origin+oldUrl.pathname,newUrl?origin+newUrl.pathname:to,to);}
    }catch{}
  }
  const keys=[...replacements.keys()].sort((a,b)=>b.length-a.length);
  if(!keys.length)return text=>({text,count:0});
  const regex=new RegExp(keys.map(escape).join('|'),'g');
  return input=>{
    let count=0;
    const text=String(input).replace(regex,(match,offset,source)=>{
      const before=source[offset-1],after=source[offset+match.length];
      if(before&&!/[\s\[\(<"'=:|]/.test(before))return match;
      if(after&&!/[?#\s\)\]}>"'\\|]/.test(after))return match;
      const replacement = replacements.get(match);
      count++;onMatch?.(replacement.reference);return replacement.text;
    });
    return {text,count};
  };
}
