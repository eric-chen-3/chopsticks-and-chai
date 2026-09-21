const path=require('node:path');
const root=process.argv[2];
const {requireAuth}=require(path.join(root,'lib/requireAuth'));
const auth=require(path.join(root,'lib/auth'));
const {Client}=require(path.join(root,'lib/apiv2'));
(async()=>{
 await requireAuth({project:'chopsticks-and-chai',...auth.getGlobalDefaultAccount(),nonInteractive:true});
 const client=new Client({auth:true,apiVersion:'v1',urlPrefix:'https://firestore.googleapis.com'});
 const base='projects/chopsticks-and-chai/databases/(default)/documents';
 for(const username of ['humpday','humpdayz']) {
  const result=await client.post(base+':runQuery',{structuredQuery:{from:[{collectionId:'users'}],where:{fieldFilter:{field:{fieldPath:'username'},op:'EQUAL',value:{stringValue:username}}},limit:2}});
  const docs=result.body.filter(x=>x.document).map(x=>x.document);
  if(docs.length!==1)throw Error('Expected one account for '+username);
  const doc=docs[0], state=doc.fields.questState?.mapValue?.fields;
  if(!state)throw Error('No quest state for '+username);
  console.log(JSON.stringify({username,questState:state}));
  if(process.argv.includes('--apply')) {
   const used=new Set((state.dailyMail?.arrayValue?.values||[]).map(x=>x.mapValue.fields.id.stringValue));
   const date=new Date();date.setHours(0,0,0,0);date.setDate(date.getDate()-1);
   while(used.has(date.toISOString().slice(0,10)))date.setDate(date.getDate()-1);
   const period=date.toISOString().slice(0,10);
   await client.patch(doc.name,{fields:{questState:{mapValue:{fields:{dailyPeriod:{stringValue:period}}}}}},{queryParams:{'updateMask.fieldPaths':'questState.dailyPeriod','currentDocument.updateTime':doc.updateTime}});
   console.log(username+': daily period reset to '+period);
  }
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
