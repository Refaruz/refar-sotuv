const URL='https://lwqblpfrjimzcqdbawdc.supabase.co/functions/v1/tashkent-seller-intake';
async function submitTashkent(req,res,env=process.env,send=fetch){
 const p=req.body;
 if(!p||typeof p!=='object'||Array.isArray(p)||p.city!=='Toshkent shahar')throw Error('NOT_TASHKENT');
 const key=env.REFAR_TASHKENT_INTAKE_KEY;
 if(!key||!/^[A-Za-z0-9_-]{43,128}$/.test(key))return res.status(503).json({ok:false,retry:true,error:'CRM_UNAVAILABLE'});
 if(req.headers.origin&&!['https://sotuv.refar.uz','https://refar-form-1.vercel.app'].includes(req.headers.origin))
  return res.status(403).json({ok:false,error:'ORIGIN_DENIED'});
 const keys=['name','phone','status','city','property_type','district','rooms','price','price_negotiable','lang','utm','created_at','notice_version','notice_accepted','request_id'];
 if(Object.keys(p).some(k=>!keys.includes(k))||Buffer.byteLength(JSON.stringify(p))>8000)return res.status(400).json({ok:false,error:'PAYLOAD_INVALID'});
 const request=p.request_id;
 if(typeof request!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request))
  return res.status(400).json({ok:false,error:'RELOAD_FORM'});
 const lead={...p};delete lead.request_id;
 try{
  const r=await send(URL,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
   body:JSON.stringify({request_id:request,lead}),signal:AbortSignal.timeout(22000)});
  const saved=await r.json().catch(()=>null);
  if(!r.ok||saved?.ok!==true||typeof saved.receipt!=='string')
   return res.status(r.status===409?409:503).json({ok:false,retry:true,error:'CRM_NOT_CONFIRMED'});
  // Preserve the existing Toshkent group destination, only after CRM commit.
  // A replay never resends. A Telegram failure cannot undo a saved CRM inquiry.
  let telegram=false;
  if(!saved.duplicate&&env.TG_BOT_TOKEN&&(env.TG_CHAT_TOSH||env.TG_CHAT_ID)){
   const esc=s=>String(s??'-').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
   const text='🏠 <b>Yangi ariza — Toshkent shahar</b>\n'+esc(p.name)+'\n'+esc(p.phone)+'\n'+
    esc(p.district)+' · '+esc(p.rooms)+'-xona\nNarx: '+esc(p.price||(p.price_negotiable?'kelishiladi':'-'))+
    '\nManba: '+esc(p.utm?.utm_source)+' / '+esc(p.utm?.utm_campaign)+'\nREFAR CRM qabul qildi.';
   try{const tg=await send('https://api.telegram.org/bot'+env.TG_BOT_TOKEN+'/sendMessage',{
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(5000),
    body:JSON.stringify({chat_id:env.TG_CHAT_TOSH||env.TG_CHAT_ID,text,parse_mode:'HTML'})});
    telegram=tg.ok&&(await tg.json().catch(()=>null))?.ok===true;
   }catch{/* No raw customer/key logging, and no unsafe send retry. */}
  }
  return res.status(200).json({ok:true,crm:true,receipt:saved.receipt,idempotent:saved.duplicate===true,telegram});
 }catch{return res.status(503).json({ok:false,retry:true,error:'CRM_NOT_CONFIRMED'});}
}
module.exports={submitTashkent};
