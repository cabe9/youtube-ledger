// Rename JavaScript identifiers only: never alter product copy, regexes or URLs.
const acorn=require('acorn'),fs=require('node:fs');
const sources=JSON.parse(fs.readFileSync(0,'utf8'));
for(const [name,source] of Object.entries(sources)){
 const replacements=[];
 for(const token of acorn.tokenizer(source,{ecmaVersion:'latest'}))if(token.type.label==='name'&&token.value==='browser')replacements.push(token);
 let text=source;
 for(const token of replacements.reverse())text=text.slice(0,token.start)+'LedgerBrowser'+text.slice(token.end);
 sources[name]=text;
}
process.stdout.write(JSON.stringify(sources));
