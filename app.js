"use strict";
/* ================= Speicher & Synchronisierung (offline zuerst, dann Supabase) ================= */
const SB_URL="https://coximimancyzjqnyuotf.supabase.co";
const SB_KEY="sb_publishable_7T6Opp6WRqpJruFm-WoFpg_PDWFJjPi";   /* öffentlicher Schlüssel, geschützt durch Login + Row Level Security */
const sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"tl-auth"}});
const LS_STATE="tl-state-v1",LS_SNAP="tl-snap-v1",LS_SESS="tl-sess-v1",LS_USER="tl-user-v1";
const SYNC={status:"ok",user:null,timer:null,busy:false,again:false,lastError:"",lastSync:null};
const SYNC_TXT={ok:"Synchronisiert",pending:"Offline gespeichert",busy:"Synchronisiere …",err:"Sync-Fehler · tippen",offline:"Offline gespeichert"};
let SNAP={};

function saveLocal(){try{localStorage.setItem(LS_STATE,JSON.stringify({settings:state.settings,styles:state.styles,cycles:state.cycles,exercises:state.exercises,plans:state.plans,log:state.log}));
  if(typeof ui!=="undefined"&&ui.sess)localStorage.setItem(LS_SESS,JSON.stringify(ui.sess));else localStorage.removeItem(LS_SESS)}catch(e){console.warn("Lokales Speichern fehlgeschlagen",e)}}
function loadLocal(){try{const s=JSON.parse(localStorage.getItem(LS_STATE)||"null");if(s){Object.assign(state,s);SNAP=JSON.parse(localStorage.getItem(LS_SNAP)||"{}");return true}}catch(e){}return false}
function restoreSession(){try{const s=JSON.parse(localStorage.getItem(LS_SESS)||"null");if(s){(s.st||[]).forEach(x=>{if(x){x.resting=false}});ui.sess=s}}catch(e){}}
function setSync(st){SYNC.status=st;document.querySelectorAll("#sync").forEach(el=>{el.className="sync "+st;el.innerHTML="<i></i>"+SYNC_TXT[st]})}
function scheduleSync(){if(!SYNC.user)return;setSync(navigator.onLine?"pending":"offline");clearTimeout(SYNC.timer);if(navigator.onLine)SYNC.timer=setTimeout(()=>syncNow(false),1500)}

/* ---------- Abbildung App ↔ Tabellen ---------- */
const nn=v=>{const x=num(v);return isFinite(x)?x:null};
const exRow=e=>({id:e.id,name:e.name,kind:e.kind||(e.cardio?"Cardio":"Kraft"),equip:e.equip||null,bar_kg:e.bar||0,step_kg:e.step??null,added_weight:!!e.added,sided:!!e.sided,rack:e.rack||null,
  maxes:e.max||{},hints:{lastWarm:e.lastWarm||null,lastPct:e.lastPct||null,lastReps:e.lastReps||null,lastRest:e.lastRest||null,warmLabels:e.warmLabels||null,bw:!!e.bw,cardio:!!e.cardio},last_used:e.lastUsed||null,deleted:!!e.deleted});
const exFrom=r=>{const h=r.hints||{},e={id:r.id,name:r.name,kind:r.kind,equip:r.equip||"",bar:+r.bar_kg||0,max:r.maxes||{}};if(r.step_kg!=null)e.step=+r.step_kg;if(r.added_weight)e.added=true;if(r.sided)e.sided=true;if(r.rack)e.rack=r.rack;
  if(h.bw)e.bw=true;if(h.cardio)e.cardio=true;["lastWarm","lastPct","lastReps","lastRest","warmLabels"].forEach(k=>{if(h[k]!=null)e[k]=h[k]});if(r.last_used)e.lastUsed=r.last_used;if(r.deleted)e.deleted=true;return e};
const cyRow=c=>({id:c.id,name:c.name,basis_reps:c.basis,weeks:c.weeks});
const cyFrom=r=>({id:r.id,name:r.name,basis:r.basis_reps,weeks:r.weeks||[]});
const planRow=p=>({id:p.id,name:p.name,cycle_id:p.cycle||null,status:p.status,start_date:p.start,end_date:p.end||null,current_week:p.week||0,done:p.done||{},finished_on:p.finished||null});
const CFG_KEYS=["reps","rounds","top","hold","iv","sp","du"];
const itemRow=(it,unitId,pos)=>{const config={};CFG_KEYS.forEach(k=>{if(it[k]!=null&&it[k]!=="")config[k]=it[k]});return {id:it.id,unit_id:unitId,exercise_id:it.ex,position:pos,format:it.type,prio:!!it.prio,base_kg:nn(it.base)||0,config}};
const itemFrom=r=>({id:r.id,ex:r.exercise_id,type:r.format,prio:!!r.prio,base:+r.base_kg||0,...(r.config||{})});
const unitExists=id=>!!id&&state.plans.some(p=>p.units.some(u=>u.id===id));
const sessRow=l=>({id:l.id,plan_id:l.planId==="free"||!planById(l.planId)?null:l.planId||null,unit_id:unitExists(l.unitId)?l.unitId:null,unit_name:l.unit,week:l.week??null,trained_on:l.date,extra:!!l.extra,light:!!l.light,feel:l.feel||null,note:l.note||null});

/* Alle Einheiten einer Zeile, die sich seit dem letzten Sync geändert haben */
function entities(){const m={settings:JSON.stringify([state.settings,state.styles])};state.cycles.forEach(c=>m["cy:"+c.id]=JSON.stringify(c));state.exercises.forEach(e=>m["ex:"+e.id]=JSON.stringify(e));
  state.plans.forEach(p=>m["pl:"+p.id]=JSON.stringify(p));state.log.forEach(l=>m["se:"+l.id]=JSON.stringify(l));return m}
const ORDER={settings:0,cy:1,ex:2,pl:3,se:4};
const ok=r=>{if(r.error)throw new Error(r.error.message||String(r.error));return r.data};
async function pushEntity(key,raw){const uidU=SYNC.user.id;
  if(key==="settings"){const [s,styles]=JSON.parse(raw);return ok(await sb.from("settings").upsert({user_id:uidU,plates:s.plates,rounding:s.rounding,effort:s.effort,e1rm:s.e1rm,bodyweight:nn(s.bodyweight),sound:s.sound||"both",styles}))}
  const [t,id]=[key.slice(0,2),key.slice(3)],o=JSON.parse(raw);
  if(t==="cy")return ok(await sb.from("cycles").upsert(cyRow(o)));
  if(t==="ex")return ok(await sb.from("exercises").upsert(exRow(o)));
  if(t==="pl"){ok(await sb.from("plans").upsert(planRow(o)));const units=o.units||[],uids=units.map(u=>u.id);
    if(units.length)ok(await sb.from("units").upsert(units.map((u,i)=>({id:u.id,plan_id:o.id,name:u.name,position:i}))));
    const delU=sb.from("units").delete().eq("plan_id",o.id);ok(await (uids.length?delU.not("id","in",`(${uids.join(",")})`):delU));
    const items=units.flatMap(u=>u.items.map((it,i)=>itemRow(it,u.id,i)));if(items.length)ok(await sb.from("unit_items").upsert(items));
    if(uids.length){const q=sb.from("unit_items").delete().in("unit_id",uids);ok(await (items.length?q.not("id","in",`(${items.map(x=>x.id).join(",")})`):q))}
    ok(await sb.from("week_overrides").delete().eq("plan_id",o.id));const ov=[];Object.entries(o.weekUnits||{}).forEach(([w,m])=>Object.entries(m||{}).forEach(([uid_,items])=>{if(uids.includes(uid_))ov.push({plan_id:o.id,unit_id:uid_,week:+w,items})}));
    if(ov.length)ok(await sb.from("week_overrides").insert(ov));return}
  if(t==="se"){ok(await sb.from("sessions").upsert(sessRow(o)));const sx=[],sets=[];
    o.items.forEach((it,i)=>{sx.push({id:it.id,session_id:o.id,exercise_id:it.ex,position:i,format:it.type||"normal",feel:it.feel||null,note:it.note||null,ladder:it.ladder||null,cardio:it.cardio||null});
      (it.warm||[]).forEach((w,j)=>sets.push({id:w.id,session_exercise_id:it.id,position:j,kind:"warmup",label:w.label||null,mode:w.mode==="sec"?"sec":"reps",weight_kg:nn(w.kg),reps:nn(w.reps),target:w.tr||null,pct:nn(w.pct)}));
      (it.sets||[]).forEach((x,j)=>sets.push({id:x.id,session_exercise_id:it.id,position:100+j,kind:"work",mode:x.sec?"sec":"reps",weight_kg:nn(x.kg),reps:nn(x.reps),partial:nn(x.part)||0,target:x.sec||x.tr||null,
        effort:x.eff===""||x.eff==null?null:nn(x.eff),style:x.style||null,side:x.side||null,assisted:!!x.assist,feel:x.feel||null,is_pr:!!x.pr}))});
    if(sx.length)ok(await sb.from("session_exercises").upsert(sx));if(sets.length)ok(await sb.from("sets").upsert(sets));return}}
async function deleteEntity(key){const [t,id]=[key.slice(0,2),key.slice(3)];const tb={cy:"cycles",ex:"exercises",pl:"plans",se:"sessions"}[t];if(tb)ok(await sb.from(tb).delete().eq("id",id))}
async function pushChanges(){const cur=entities();const ch=Object.keys(cur).filter(k=>cur[k]!==SNAP[k]).sort((a,b)=>ORDER[a.split(":")[0]]-ORDER[b.split(":")[0]]);
  const gone=Object.keys(SNAP).filter(k=>!(k in cur)).sort((a,b)=>ORDER[b.split(":")[0]]-ORDER[a.split(":")[0]]);
  for(const k of ch){await pushEntity(k,cur[k]);SNAP[k]=cur[k];localStorage.setItem(LS_SNAP,JSON.stringify(SNAP))}
  for(const k of gone){await deleteEntity(k);delete SNAP[k];localStorage.setItem(LS_SNAP,JSON.stringify(SNAP))}
  return ch.length+gone.length}
const hasPending=()=>{const cur=entities();return Object.keys(cur).some(k=>cur[k]!==SNAP[k])||Object.keys(SNAP).some(k=>!(k in cur))};

/* ---------- Alles aus Supabase laden ---------- */
async function fetchAll(table){let out=[],from=0;for(;;){const r=ok(await sb.from(table).select("*").order(table==="settings"?"user_id":"id").range(from,from+999));out=out.concat(r);if(r.length<1000)break;from+=1000}return out}
async function pullAll(){const [st,cy,ex,pl,un,it,ov,se,sx,sets]=await Promise.all([fetchAll("settings","user_id"),fetchAll("cycles"),fetchAll("exercises","name"),fetchAll("plans","created_at"),fetchAll("units","position"),
    fetchAll("unit_items","position"),fetchAll("week_overrides"),fetchAll("sessions","trained_on"),fetchAll("session_exercises","position"),fetchAll("sets","position")]);
  if(st[0]){const s=st[0];Object.assign(state.settings,{plates:(s.plates||[]).map(Number),rounding:s.rounding,effort:s.effort,e1rm:s.e1rm,bodyweight:s.bodyweight!=null?+s.bodyweight:state.settings.bodyweight,sound:s.sound});if(s.styles&&s.styles.length)state.styles=s.styles}
  state.cycles=cy.map(cyFrom);state.exercises=ex.map(exFrom).sort((a,b)=>a.name.localeCompare(b.name,"de"));
  pl.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  state.plans=pl.map(p=>{const units=un.filter(u=>u.plan_id===p.id).sort((a,b)=>a.position-b.position).map(u=>({id:u.id,name:u.name,items:it.filter(i=>i.unit_id===u.id).sort((a,b)=>a.position-b.position).map(itemFrom)}));
    const wu={};ov.filter(o=>o.plan_id===p.id).forEach(o=>{(wu[o.week]=wu[o.week]||{})[o.unit_id]=o.items});
    const o={id:p.id,name:p.name,start:p.start_date,cycle:p.cycle_id||"",status:p.status,week:p.current_week||0,done:p.done||{},units};if(p.end_date)o.end=p.end_date;if(p.finished_on)o.finished=p.finished_on;if(Object.keys(wu).length)o.weekUnits=wu;return o});
  const setsBy={};sets.forEach(x=>{(setsBy[x.session_exercise_id]=setsBy[x.session_exercise_id]||[]).push(x)});const sxBy={};sx.forEach(x=>{(sxBy[x.session_id]=sxBy[x.session_id]||[]).push(x)});
  state.log=se.map(s=>{const l={id:s.id,planId:s.plan_id||"free",unitId:s.unit_id||null,unit:s.unit_name,week:s.week,date:s.trained_on,items:[]};if(s.extra)l.extra=true;if(s.light)l.light=true;if(s.feel)l.feel=s.feel;if(s.note)l.note=s.note;
    l.items=(sxBy[s.id]||[]).sort((a,b)=>a.position-b.position).map(x=>{const all=(setsBy[x.id]||[]).sort((a,b)=>a.position-b.position);const it={id:x.id,ex:x.exercise_id,type:x.format,
      warm:all.filter(y=>y.kind==="warmup").map(y=>({id:y.id,kg:y.weight_kg==null?"":String(+y.weight_kg),reps:y.reps==null?"":String(+y.reps),tr:y.target||"",pct:y.pct==null?null:+y.pct,label:y.label||"",mode:y.mode})),
      sets:all.filter(y=>y.kind==="work").map(y=>{const o={id:y.id,kg:y.weight_kg==null?"":String(+y.weight_kg),reps:y.reps==null?"":String(+y.reps),part:String(+y.partial||0),style:y.style||"Normal",eff:y.effort==null?"":String(+y.effort),side:y.side||null,assist:!!y.assisted,feel:y.feel||null,pr:!!y.is_pr};
        if(y.mode==="sec")o.sec=y.target||"1";else o.tr=y.target||"";return o})};if(x.feel)it.feel=x.feel;if(x.note)it.note=x.note;if(x.ladder)it.ladder=x.ladder;if(x.cardio)it.cardio=x.cardio;return it});return l});
  state.log.sort((a,b)=>a.date.localeCompare(b.date));SNAP=entities();localStorage.setItem(LS_SNAP,JSON.stringify(SNAP));saveLocal();return ex.length}

/* ---------- Ablauf: erst eigene Änderungen hochladen, dann (optional) alles neu laden ---------- */
async function syncNow(full){if(!SYNC.user)return;if(!navigator.onLine){setSync("offline");return}if(SYNC.busy){SYNC.again=true;return}SYNC.busy=true;setSync("busy");
  try{await pushChanges();if(full){await pullAll();render()}SYNC.lastSync=new Date();SYNC.lastError="";setSync(hasPending()?"pending":"ok")}
  catch(e){const net=/fetch|network|load failed|timeout/i.test(e.message||"");if(net){SYNC.lastError="";setSync("offline");clearTimeout(SYNC.retry);SYNC.retry=setTimeout(()=>syncNow(false),30000)}else{console.error(e);SYNC.lastError=e.message||String(e);setSync("err")}}
  finally{SYNC.busy=false;if(SYNC.again){SYNC.again=false;setTimeout(()=>syncNow(false),500)}}}
window.addEventListener("online",()=>syncNow(true));
window.addEventListener("offline",()=>setSync("offline"));
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&SYNC.user&&!ui.sess)syncNow(true);if(document.visibilityState==="hidden")saveLocal()});

/* ---------- Login ---------- */
function renderLogin(msg){$("nav.tabs").style.display="none";$("#app").innerHTML=`<div class="login"><div class="logo-mark">${LOGO_SVG}</div><h1>Trainingslog</h1><p class="muted small">Melde dich an, damit deine Trainings sicher gespeichert und zwischen deinen Geräten synchronisiert werden.</p>
  <form id="loginForm" class="stack" style="gap:10px"><label class="small muted" style="display:flex;flex-direction:column;gap:4px">E-Mail<input class="inp" type="email" id="lgMail" autocomplete="username" value="${esc(localStorage.getItem(LS_USER)||"jesse.osei01@gmail.com")}"></label>
  <label class="small muted" style="display:flex;flex-direction:column;gap:4px">Passwort<input class="inp" type="password" id="lgPw" autocomplete="current-password"></label>
  <div class="err small" id="lgErr">${esc(msg||"")}</div><button class="btn primary full big-start" type="submit" id="lgBtn">Anmelden</button></form></div>`;
  $("#loginForm").addEventListener("submit",async e=>{e.preventDefault();const b=$("#lgBtn");b.disabled=true;b.textContent="Anmelden …";$("#lgErr").textContent="";
    const {data,error}=await sb.auth.signInWithPassword({email:$("#lgMail").value.trim(),password:$("#lgPw").value});
    if(error){b.disabled=false;b.textContent="Anmelden";$("#lgErr").textContent=/Invalid login/i.test(error.message)?"E-Mail oder Passwort stimmt nicht.":/fetch|network/i.test(error.message)?"Keine Verbindung. Für den ersten Login brauchst du Internet.":error.message;return}
    localStorage.setItem(LS_USER,$("#lgMail").value.trim());await afterLogin(data.user)})}
async function afterLogin(user){SYNC.user=user;$("nav.tabs").style.display="";$("#app").innerHTML=`<div class="login"><p class="muted">Lade deine Daten …</p></div>`;
  try{if(hasPending())await pushChanges();const n=await pullAll();
    if(n===0&&!state.exercises.length){const seed=buildSeed();Object.assign(state,{cycles:seed.cycles,exercises:seed.exercises,plans:seed.plans,log:seed.log});saveLocal();setSync("busy");render();await pushChanges()}
    setSync(hasPending()?"pending":"ok")}catch(e){console.error(e);SYNC.lastError=e.message;setSync(navigator.onLine?"err":"offline")}
  render()}
async function logout(){try{await sb.auth.signOut()}catch(e){}["tl-state-v1","tl-snap-v1","tl-sess-v1"].forEach(k=>localStorage.removeItem(k));location.reload()}
function exportBackup(){const blob=new Blob([JSON.stringify({exportiert:new Date().toISOString(),...state},null,1)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`trainingslog-backup-${iso(new Date())}.json`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
const LOGO_SVG='<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#151515"/><rect x="10" y="22" width="6" height="20" rx="2" fill="#ff572c"/><rect x="17" y="17" width="7" height="30" rx="2" fill="#ff572c"/><rect x="40" y="17" width="7" height="30" rx="2" fill="#ff572c"/><rect x="48" y="22" width="6" height="20" rx="2" fill="#ff572c"/><rect x="24" y="29.5" width="16" height="5" rx="2" fill="#f4f1ea"/></svg>';

/* ---------- Start ---------- */
async function boot(){loadLocal();restoreSession();
  const {data}=await sb.auth.getSession();const user=data&&data.session&&data.session.user;
  if(!user)return renderLogin();SYNC.user=user;
  if(!state.exercises.length)return afterLogin(user);
  render();if(navigator.onLine)syncNow(!ui.sess);else setSync("offline")}
sb.auth.onAuthStateChange((ev,session)=>{if(ev==="SIGNED_OUT"){SYNC.user=null}if(session&&session.user)SYNC.user=session.user});

"use strict";
/* ================= Daten (Beispiele aus Jesses Notizen) ================= */
const FORMATS={normal:"Normal",ladder:"Leiter",hold:"Halten",interval:"Intervall",sprint:"Sprints",duration:"Dauer"};
const FORMAT_DEF={normal:{},ladder:{rounds:3,top:5},hold:{hold:{n:6,sec:"20–30"}},interval:{iv:{rounds:8,work:30,rest:30,metric:"",custom:null}},sprint:{sp:{n:6,dist:60,rest:120}},duration:{du:{min:30,km:""}}};
function I(ex,type,o={}){const it={id:uid(),ex,type,base:0,prio:false};if(FORMAT_DEF[type])Object.assign(it,JSON.parse(JSON.stringify(FORMAT_DEF[type])));return Object.assign(it,o)}
/* Arbeitsdaten: werden aus dem Gerät (offline) bzw. aus Supabase geladen */
const state={settings:{plates:[1.25,2.5,5,10,20],rounding:"down",effort:"RIR",e1rm:"epley",bodyweight:80,sound:"both"},
  styles:["Normal","Pausen-Wdh.","Teilwdh.","Tempo","Rest-Pause","Drop-Satz","Negativ"],cycles:[],exercises:[],plans:[],log:[]};
const H=(s)=>s.split(";").map(x=>{const [k,r]=x.split("x");return [parseFloat(k.replace(",",".")),parseFloat(r.replace(",","."))]});
/* Startdaten beim allerersten Login: Übungen, Pläne und deine Notizen aus Woche 1–5 */
function buildSeed(){
const S0={
    settings:{plates:[1.25,2.5,5,10,20],rounding:"down",effort:"RIR",e1rm:"epley",bodyweight:80,sound:"both"},
    styles:["Normal","Pausen-Wdh.","Teilwdh.","Tempo","Rest-Pause","Drop-Satz","Negativ"],
    cycles:[{id:"welle",name:"Wellenperiodisierung 5 Wochen",basis:3,weeks:[
      {tag:"Deload",pct:70},{tag:"",pct:80},{tag:"",pct:90},{tag:"",pct:100},{tag:"Test",pct:103}]}],
    exercises:[
      {id:"squat",lastWarm:[[0,"5"],[40,"3"],[70,"2"],[90,"1"]],lastRest:300,name:"Squats",equip:"Langhantel",bar:20,rack:"16",max:{3:160}},
      {id:"bench",lastWarm:[[0,"5"],[40,"3"],[70,"2"],[90,"1"]],lastRest:300,name:"Bench Press",equip:"Langhantel",bar:20,max:{3:110}},
      {id:"pullup",lastWarm:[[0,"5"],[40,"3"],[70,"2"],[90,"1"]],lastRest:300,name:"Pull-ups",equip:"Dip-Gürtel",added:true,bar:0,max:{3:60}},
      {id:"dips",lastWarm:[[0,"5"],[40,"3"],[70,"2"],[90,"1"]],lastRest:300,name:"Dips",equip:"Dip-Gürtel",added:true,bar:0,rack:"24",max:{3:72.5}},
      {id:"trapbar",lastWarm:[[0,"5"],[40,"3"],[70,"2"],[90,"1"]],lastRest:300,name:"Trap Bar DL",equip:"Trap Bar",bar:25,max:{3:220}},
      {id:"rows",name:"Barbell Rows",equip:"Langhantel",bar:20},
      {id:"ohp",name:"Shoulder Press",equip:"Langhantel",bar:20},
      {id:"split",name:"Split Squats",equip:"Kurzhanteln",bar:0,step:2},
      {id:"ham",name:"Hamstring Curls",equip:"Maschine",bar:0,step:2.5},
      {id:"lat",name:"Lateral Raises",equip:"Kabel",bar:0,step:2.5},
      {id:"rear",name:"Rear Delt",equip:"Kabel",bar:0,step:2.5},
      {id:"bic",name:"Biceps Curls",equip:"Kurzhanteln",bar:0,step:2},
      {id:"tri",name:"Triceps",equip:"Kabel",bar:0,step:2.5},
      {id:"calf",name:"Calf Raises",equip:"Maschine",bar:0,step:2.5},
      {id:"rot",name:"Cable Rotation",equip:"Kabel",bar:0,step:2.5},
      {id:"crunch",name:"Cable Crunch",equip:"Kabel",bar:0,step:2.5},
      {id:"dragon",name:"Dragon Flags",equip:"Körpergewicht",bw:true,bar:0},
      {id:"legr",name:"Leg Raises",equip:"Körpergewicht",bw:true,bar:0},
      {id:"irows",name:"Rows (Leiter)",equip:"Körpergewicht",bw:true},
      {id:"pushdon",name:"Push-ups à la Don",equip:"Körpergewicht",bw:true},
      {id:"stepper",name:"Athletic Stepper",equip:"Körpergewicht",bw:true},
      {id:"mu",kind:"Skill",lastWarm:[[0,"10","Form halten","sec"],[0,"3","High Pull-ups","reps"],[0,"3","Muscle-ups","reps"]],name:"Muscle-ups",equip:"Dip-Gürtel",added:true,bar:0},
      {id:"oap",kind:"Skill",lastWarm:[[0,"10","Einarmig festhalten","sec"]],name:"One Arm Pull-ups",equip:"Körpergewicht",bw:true,sided:true},
      {id:"hs",kind:"Skill",name:"Handstand",equip:"Körpergewicht",bw:true},
      {id:"pistol",kind:"Skill",name:"Pistol Squats",equip:"Körpergewicht",bw:true},
      {id:"run",name:"Laufen",equip:"Körpergewicht",bw:true,cardio:true},
      {id:"bike",name:"Airbike",equip:"Maschine",cardio:true},
      {id:"landmine",name:"Landmine Punch",equip:"Langhantel",cardio:true}
    ],
    plans:[]
  };
    const KRAFT=()=>[
    {id:"u1",name:"Full Body Lower",items:[I("squat","normal",{base:100,prio:true}),I("bench","normal",{base:100}),I("pullup","normal",{base:40}),I("calf","normal",{base:60}),I("bic","normal",{base:16}),I("tri","normal",{base:35}),I("dragon","normal"),I("irows","ladder",{rounds:3,top:5})]},
    {id:"u2",name:"Full Body Push",items:[I("dips","normal",{base:70,prio:true}),I("rows","normal",{base:90}),I("ohp","normal",{base:60}),I("lat","normal",{base:15}),I("legr","normal"),I("stepper","ladder",{rounds:2,top:4})]},
    {id:"u3",name:"Full Body Pull",items:[I("pullup","normal",{base:55,prio:true}),I("dips","normal",{base:60}),I("trapbar","normal",{base:220,prio:true}),I("split","normal",{base:40}),I("rear","normal",{base:15}),I("rot","normal",{base:30}),I("crunch","normal",{base:70}),I("pushdon","ladder",{rounds:3,top:4})]}];
    const SKILL=()=>[
    {id:"u4",name:"Full Body Skill",items:[I("mu","normal",{base:10}),I("oap","normal"),I("hs","hold"),I("pistol","normal")]}];
  S0.plans=[
    {id:"p2",name:"Kraft Herbst",start:"2026-10-12",cycle:"welle",status:"archiv",finished:"2026-11-13",week:4,done:{0:["u1","u2","u3"],1:["u1","u2","u3"],2:["u1","u2","u3"],3:["u1","u2","u3"],4:["u1","u2","u3"]},units:KRAFT()},
    {id:"p3",name:"Skill",start:"2026-09-07",cycle:"",status:"aktiv",week:0,done:{},units:SKILL()},
    {id:"p4",name:"Cardio",start:"2026-10-12",cycle:"",status:"aktiv",week:0,done:{},units:[
      {id:"u5",name:"Conditioning",items:[I("bike","interval",{iv:{rounds:8,work:20,rest:10,metric:"kcal",custom:null}}),I("landmine","interval",{iv:{rounds:6,work:30,rest:30,metric:"Wdh.",custom:null}})]},
      {id:"u6",name:"Laufen",items:[I("run","duration",{du:{min:30,km:5}}),I("run","sprint",{sp:{n:6,dist:60,rest:120}})]}]},
  ];
  
  
  const history={
    squat:[[0,"Lower","100x5;100x5"],[0,"Push","120x10"],[1,"Lower","130x5"],[1,"Push","120x10"],[2,"Lower","145x3;120x5"],[2,"Push","120x10"],[3,"Lower","160x3"],[3,"Push","120x10"],[4,"Lower","100x5"]],
    bench:[[0,"Lower","100x5;100x5"],[1,"Lower","100x5"],[2,"Lower","100x6"],[3,"Lower","110x4,5"],[4,"Lower","100x6"]],
    pullup:[[0,"Lower","45x6;35x6"],[0,"Pull","40x5;40x5"],[1,"Lower","40x9"],[1,"Pull","50x5"],[2,"Lower","40x9"],[2,"Pull","55x4,75"],[3,"Lower","40x10"],[3,"Pull","55x4"],[4,"Pull","60x5"]],
    dips:[[0,"Push","50x5;50x5"],[0,"Pull","55x6"],[1,"Push","65x5"],[1,"Pull","55x8"],[2,"Push","72,5x3;60x5"],[2,"Pull","60x7"],[3,"Push","72,5x3"],[3,"Pull","60x10"],[4,"Push","70x5"]],
    trapbar:[[1,"Pull","180x5"],[2,"Pull","200x4"],[3,"Pull","220x5"],[4,"Push","220x5"]],
    rows:[[0,"Push","100x5;100x5"],[1,"Push","100x6"],[2,"Push","100x4;80x8"],[3,"Push","80x8"],[4,"Push","90x6"]],
    ohp:[[0,"Push","60x5"],[1,"Push","60x5"],[3,"Push","60x5"]],
    split:[[2,"Pull","32x8"],[3,"Pull","30x10"],[4,"Pull","40x6"]],
    ham:[[0,"Pull","65x8;50x10"],[1,"Pull","65x9"]],
    lat:[[0,"Lower","15x12"],[2,"Pull","15x13"],[3,"Pull","15x15"],[4,"Push","15x15"]],
    rear:[[0,"Pull","20x10;15x10"],[1,"Pull","15x15"],[2,"Pull","15x15"],[3,"Pull","15x15"],[4,"Pull","15x15"]],
    bic:[[0,"Pull","20x6;14x6"],[1,"Lower","16x10"],[3,"Lower","16x15"]],
    tri:[[0,"Push","30x12"],[1,"Lower","35x10"],[3,"Lower","35x15"]],
    calf:[[1,"Lower","60x13"],[3,"Lower","60x10"]],
    rot:[[0,"Pull","25x10;25x10;25x10"],[1,"Pull","30x5;30x5;30x5"],[2,"Pull","30x5"],[3,"Pull","30x5;30x5;30x5"],[4,"Pull","30x5"]],
    crunch:[[2,"Pull","70x10"],[4,"Pull","70x10"]],
    dragon:[[0,"Lower","0x6;0x6"],[1,"Lower","0x6;0x6;0x6"],[2,"Lower","0x6;0x6;0x6"],[3,"Lower","0x6;0x6;0x2"],[4,"Lower","0x6;0x6;0x5"]],
    legr:[[0,"Push","0x6;0x5;0x4"],[1,"Push","0x6;0x6"],[2,"Push","0x6;0x6"],[3,"Push","0x6;0x6"],[4,"Push","0x10;0x10"]],
    mu:[[0,"Skill","10x2;10x3;10x2"],[1,"Skill","10x5;10x5;10x5"],[2,"Skill","10x2;10x3;10x2"],[3,"Skill","10x2;10x3"],[4,"Skill","10x2;10x3"]],
    pistol:[[0,"Skill","0x5;0x5;0x5;0x5"],[1,"Skill","0x5;0x5;0x5;0x5"],[2,"Skill","0x5;0x5;0x5;0x5"],[3,"Skill","0x5;0x5;0x5"],[4,"Skill","0x5;0x5;0x5"]]
  };
  /* Notizen → Trainings */
  const NAME={Lower:"Full Body Lower",Push:"Full Body Push",Pull:"Full Body Pull",Skill:"Full Body Skill"},OFF={Lower:0,Push:2,Pull:4,Skill:3},G={},log=[];
  for(const [exid,rows] of Object.entries(history))rows.forEach(([w,lab,str])=>{const key=w+"|"+lab;(G[key]=G[key]||{week:w,lab,items:[]}).items.push({ex:exid,type:"normal",warm:[],sets:H(str).map(([kg,r])=>({kg:String(kg),reps:String(Math.floor(r)),part:String(Math.round((r-Math.floor(r))*100)/100)}))})});
  Object.values(G).sort((a,b)=>a.week-b.week||OFF[a.lab]-OFF[b.lab]).forEach(g=>{const skill=g.lab==="Skill",plan=S0.plans.find(p=>p.id===(skill?"p3":"p2")),unit=plan.units.find(u=>u.name===NAME[g.lab]);
    const ord=id=>{const i=unit?unit.items.findIndex(it=>it.ex===id):-1;return i<0?99:i};g.items.sort((a,b)=>ord(a.ex)-ord(b.ex));
    log.push({planId:plan.id,unitId:unit?unit.id:null,unit:NAME[g.lab],week:skill?null:g.week,date:addDays("2026-10-12",g.week*7+OFF[g.lab]),items:g.items})});
  S0.log=log;
  /* IDs in UUIDs umwandeln (für die Datenbank) */
  const M={};const map=id=>id==null||id===""?id:(M[id]=M[id]||uid());
  S0.cycles.forEach(c=>c.id=map(c.id));S0.exercises.forEach(e=>e.id=map(e.id));
  S0.plans.forEach(p=>{const old=p.id;p.id=map(old);p.cycle=p.cycle?map(p.cycle):"";p.units.forEach(u=>{u.id=map(u.id);u.items.forEach(it=>{it.id=uid();it.ex=map(it.ex)})});
    const d={};Object.entries(p.done||{}).forEach(([w,arr])=>d[w]=arr.map(map));p.done=d});
  S0.log.forEach(l=>{l.id=uid();l.planId=map(l.planId);l.unitId=l.unitId?map(l.unitId):null;l.items.forEach(it=>{it.id=uid();it.ex=map(it.ex);it.sets.forEach(x=>x.id=uid());it.warm.forEach(x=>x.id=uid())})});
  return S0}


/* ================= Helfer ================= */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=n=>(Math.round(n*100)/100).toLocaleString("de-DE",{maximumFractionDigits:2});
const num=v=>parseFloat(String(v).replace(",","."));
const uid=()=>(crypto.randomUUID?crypto.randomUUID():"10000000-1000-4000-8000-100000000000".replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)));
const exById=id=>state.exercises.find(e=>e.id===id);
const cycById=id=>state.cycles.find(c=>c.id===id)||null;
const activePlan=()=>state.plans.find(p=>p.status==="aktiv")||null;
const TL=id=>FORMATS[id]||id;
const isStd=id=>id==="normal";
const badge=it=>`${it.prio?'<span class="badge strength">Prio</span>':""}${it.type!=="normal"?`<span class="badge ${["interval","sprint","duration"].includes(it.type)?"cardio":"ladder"}">${esc(TL(it.type))}</span>`:""}`;
function parseRange(r){const p=String(r).split(/[–-]/).map(Number);return {min:p[0],max:p[1]??p[0]}}
const fmtRest=s=>s>=60?(s%60?`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")} min`:`${s/60} min`):`${s} s`;
const RESTS=[30,45,60,90,120,150,180,240,300,360,420,480,600];
const restOpts=v=>RESTS.map(r=>`<option value="${r}"${+v===r?" selected":""}>${fmtRest(r)}</option>`).join("");
const rmLabel=n=>n>0?`${n}RM`:"Arbeitsgewicht";
/* Datum */
const D=iso=>new Date(iso+"T12:00:00");
const iso=d=>d.toISOString().slice(0,10);
const addDays=(s,n)=>{const d=D(s);d.setDate(d.getDate()+n);return iso(d)};
const fmtD=s=>D(s).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"});
function planEnd(p){if(p.end)return p.end;const c=cycById(p.cycle);return c?addDays(p.start,c.weeks.length*7-1):null}
/* Gewichte */
function stepOf(ex){const mn=Math.min(...state.settings.plates);if(["Langhantel","Trap Bar"].includes(ex.equip))return mn*2;if(ex.equip==="Dip-Gürtel")return mn;return ex.step||2.5}
function roundW(ex,t){const base=ex.bar||0,step=stepOf(ex);if(t<=base)return base;const q=(t-base)/step,m=state.settings.rounding;
  const n=m==="up"?Math.ceil(q-1e-9):m==="nearest"?Math.round(q):Math.floor(q+1e-9);return base+n*step}
function kgLabel(ex,kg){if(ex.added||ex.bw)return kg>0?"+"+fmt(kg)+" kg":(ex.added?"ohne Gewicht":"KG");return fmt(kg)+" kg"}
function est1RM(w,r){return state.settings.e1rm==="brzycki"?w*36/(37-r):w*(1+r/30)}
function fromE1(e,r){return state.settings.e1rm==="brzycki"?e*(37-r)/36:e/(1+r/30)}
function getMax(ex,n){const m=ex.max||{};if(m[n]!=null)return {kg:m[n],est:false};const k=Object.keys(m)[0];if(k==null)return null;return {kg:Math.round(fromE1(est1RM(m[k],+k),n)*4)/4,est:true}}
/* Schreibweise wie in deinen Notizen: 0%x5;40%x3;70%x2;90%x1 */
function parseNotation(txt){const out=[];for(const t of String(txt).split(";").map(x=>x.trim()).filter(Boolean)){const m=t.match(/^(\d+(?:[.,]\d+)?)\s*%?\s*[x×*]\s*(\d+(?:\s*[-–]\s*\d+)?)$/i);
  if(!m)return {error:`„${t}“ verstehe ich nicht. Erwartet z. B. 40%x3`};out.push([num(m[1]),m[2].replace(/\s*[-–]\s*/,"–")])}return {sets:out}}
const toNotation=sets=>sets.map(([p,r])=>`${fmt(p)}%x${String(r).replace("–","-")}`).join(";");
/* Feste Sätze: 10x2;10x3 · Seiten: 0x1l;0x1r;0x3al;0x3ar */
function parseAbs(txt){const out=[];for(const t of String(txt).split(";").map(x=>x.trim()).filter(Boolean)){const m=t.match(/^(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:\s*[-–]\s*\d+)?)\s*(a?)([lr]?)$/i);
  if(!m)return {error:`„${t}“ verstehe ich nicht. Erwartet z. B. 10x3 oder 0x3al`};out.push([num(m[1]),m[2].replace(/\s*[-–]\s*/,"–"),m[3].toLowerCase(),m[4].toUpperCase()])}return {sets:out}}
const toAbs=sets=>(sets||[]).map(([kg,r,a,sd])=>`${fmt(kg)}x${String(r).replace("–","-")}${a||""}${(sd||"").toLowerCase()}`).join(";");
function itemSummary(item,plan){if(item.type==="ladder")return `Leiter ${item.rounds}×(${item.top}–1)`;
  if(item.type==="interval"){const c=item.iv;return c.custom&&c.custom.length?`${c.custom.length} Runden, individuell`:`${c.rounds}× ${c.work} s / ${c.rest} s${c.metric?" · Wert: "+c.metric:""}`}
  if(item.type==="sprint")return `${item.sp.n}× ${item.sp.dist} m · Pause ${fmtRest(item.sp.rest)}`;
  if(item.type==="duration")return `Ziel: ${item.du.min?item.du.min+" min":""}${item.du.min&&item.du.km?" / ":""}${item.du.km?item.du.km+" km":""}`||"frei";
  if(item.type==="hold")return `${item.hold.n}× ${item.hold.sec} s halten`;
  const c=plan&&cycById(plan.cycle);return item.prio&&c?`Prio · Gewicht folgt dem Zyklus`:`Arbeitsgewicht ${fmt(item.base||0)} kg (zuletzt)`}
const REST_CHIPS=[60,90,120,180,240,300,360,420,480,600];
/* Vorschlag Arbeitsgewicht */
function suggest(item,plan,wk){const ex=exById(item.ex),c=plan&&cycById(plan.cycle);
  if(isStd(item.type)&&item.prio&&c){const w=c.weeks[Math.min(wk??plan.week,c.weeks.length-1)];
    if(c.basis>0){const m=getMax(ex,c.basis);if(m)return {kg:roundW(ex,m.kg*w.pct/100),why:`${w.pct} % von ${rmLabel(c.basis)} ${fmt(m.kg)} kg${m.est?" (geschätzt)":""}`}}
    else return {kg:roundW(ex,(item.base||0)*w.pct/100),why:`${w.pct} % vom Arbeitsgewicht`}}
  return {kg:item.base||0,why:"letzter Arbeitssatz"}}
const FACES={g:'<svg viewBox="0 0 24 24" fill="none" stroke="#3fb97a" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 14c1.2 1.6 2.5 2.3 4 2.3s2.8-.7 4-2.3"/><circle cx="9" cy="10" r=".6" fill="#3fb97a"/><circle cx="15" cy="10" r=".6" fill="#3fb97a"/></svg>',
  n:'<svg viewBox="0 0 24 24" fill="none" stroke="#9ba4ae" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8.5 15h7"/><circle cx="9" cy="10" r=".6" fill="#9ba4ae"/><circle cx="15" cy="10" r=".6" fill="#9ba4ae"/></svg>',
  b:'<svg viewBox="0 0 24 24" fill="none" stroke="#e5605e" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 16.3c1.2-1.6 2.5-2.3 4-2.3s2.8.7 4 2.3"/><circle cx="9" cy="10" r=".6" fill="#e5605e"/><circle cx="15" cy="10" r=".6" fill="#e5605e"/></svg>'};
const FEEL_TXT={g:"gut",n:"normal",b:"schlecht"};
function feelBtns(path,val){return `<div class="feel" role="group" aria-label="Gefühl">${["g","n","b"].map(f=>`<button type="button" class="${f}" data-feel="${path}" data-v="${f}" aria-pressed="${val===f}" aria-label="${FEEL_TXT[f]}">${FACES[f]}</button>`).join("")}</div>`}
const effOpts=v=>{const rpe=state.settings.effort==="RPE",vals=rpe?[6,6.5,7,7.5,8,8.5,9,9.5,10]:[0,1,2,3,4,5];return `<option value="">–</option>`+vals.map(n=>`<option value="${n}"${String(v)===String(n)?" selected":""}>${fmt(n)}${!rpe&&n===5?"+":""}</option>`).join("")};
const toRIR=v=>state.settings.effort==="RPE"?10-Number(v):Number(v);
const pl=(n,a,b)=>`${n} ${n===1?a:b}`;
const DEMO="";
function syncPill(){const st=SYNC.status;return `<button type="button" class="sync ${st}" id="sync" data-act="syncnow"><i></i>${SYNC_TXT[st]}</button>`}
function markPending(){saveLocal();scheduleSync()}
function sheet(html){$("#sheet").innerHTML=html;$("#modal").classList.add("on")}
function closeSheet(){$("#modal").classList.remove("on");ui.edit=null;ui.wiz=null;ui.pick=null;ui.swapAsk=null}

/* ================= Pause-Timer ================= */
const timer={end:0,total:60,iv:null,onEnd:null};
function startTimer(sec,label,onEnd){const prev=timer.onEnd;timer.onEnd=null;if(prev)prev();timer.onEnd=onEnd||null;timer.fired=false;timer.total=sec;timer.end=Date.now()+sec*1000;
  $("#timerLbl").textContent=label||"Pause";$("#timer").classList.add("on");$("#timer").classList.remove("over");clearInterval(timer.iv);timer.iv=setInterval(tick,250);tick()}
function tick(){const left=Math.round((timer.end-Date.now())/1000),el=$("#timerT");
  if(left<=0){if(!timer.fired){timer.fired=true;try{navigator.vibrate&&navigator.vibrate([200,100,200])}catch(e){}const f=timer.onEnd;timer.onEnd=null;f&&f()}
    el.textContent="Los!";$("#timer").classList.add("over");$("#timerBar").style.width="100%";if(left<-15)stopTimer();return}
  el.textContent=`${Math.floor(left/60)}:${String(left%60).padStart(2,"0")}`;$("#timerBar").style.width=(100-left/timer.total*100)+"%"}
function stopTimer(){clearInterval(timer.iv);$("#timer").classList.remove("on")}
function endTimerNow(){const f=timer.onEnd;timer.onEnd=null;stopTimer();f&&f()}

function logSetTxt(ex,x){if(x.sec)return `${x.reps||x.sec} s`;if(x.mode==="sec"){const kg=num(x.kg);return `${x.label?x.label+" ":""}${kg>0?((ex.added||ex.bw)?"+":"")+fmt(kg)+" kg ":""}${x.reps} s`}if(x.label){const kg=num(x.kg);return `${x.label} ${kg>0?((ex.added||ex.bw)?"+":"")+fmt(kg)+"×":"×"}${x.reps}`}const kg=num(x.kg),r=num(x.reps)+num(x.part||0);return `${(ex.added||ex.bw)&&kg>0?"+":""}${fmt(kg)}×${fmt(r)}${x.side?x.side.toLowerCase():""}${x.assist?" assist.":""}${x.style&&x.style!=="Normal"?" ("+x.style+")":""}`}
function logBlock(l){return `<div class="logday"><div class="row between"><b>${esc(l.unit)}${l.extra?" (zusätzlich)":""}</b>${l.light?' <span class="badge">leicht</span>':""}<span class="small muted">${fmtD(l.date)}${l.feel?` <span class="mini-face inl">${FACES[l.feel]}</span>`:""}</span></div>
  <table><tbody>${l.items.map(it=>{const ex=exById(it.ex)||{name:"?"};return `<tr><td>${esc(ex.name)}</td><td class="num">${it.cardio?esc(cardioTxt(it.cardio)):it.ladder?esc(it.ladder.join(" · ")):it.sets.map(x=>esc(logSetTxt(ex,x))+(x.feel?`<span class="mini-face inl">${FACES[x.feel]}</span>`:"")).join(" · ")}${it.warm&&it.warm.length?`<div class="muted small">Aufw.: ${esc(it.warm.map(w=>logSetTxt(ex,w)).join(" · "))}</div>`:""}${it.feel||it.note?`<div class="small exnote">${it.feel?`<span class="mini-face inl">${FACES[it.feel]}</span> `:""}${it.note?"„"+esc(it.note)+"“":""}</div>`:""}</td></tr>`}).join("")}</tbody></table>${l.feel||l.note?`<div class="sessnote">${l.feel?`<span class="mini-face inl">${FACES[l.feel]}</span> <b>Training ${FEEL_TXT[l.feel]}</b>`:""}${l.note?` · „${esc(l.note)}“`:""}</div>`:""}</div>`}

/* Letztes Training dieser Übung (für „Letztes Mal“-Hinweise) */
function lastOf(exId){for(let i=state.log.length-1;i>=0;i--){const it=state.log[i].items.find(x=>x.ex===exId&&((x.sets&&x.sets.length)||(x.warm&&x.warm.length)));if(it)return {date:state.log[i].date,it}}return null}
/* Scheibenrechner: was muss pro Seite (Langhantel) bzw. an den Gürtel */
function platesFor(ex,kg){const P=state.settings.plates.slice().sort((a,b)=>b-a);let rest,where;
  if(["Langhantel","Trap Bar"].includes(ex.equip)){rest=(kg-(ex.bar||0))/2;where="Pro Seite"}else if(ex.equip==="Dip-Gürtel"||ex.added){rest=kg;where="An den Gürtel"}else return "";
  if(rest<=0)return ex.bar&&kg<=ex.bar?"Nur die Stange":"";const out=[];for(const p of P){while(rest>=p-1e-9){out.push(p);rest-=p}}
  return `${where}: ${out.map(fmt).join(" + ")}${rest>0.01?` (+${fmt(rest)} kg nicht ladbar)`:""}`}
/* Bisheriger Rekord (schwerstes Gewicht, bei gleichem Gewicht meiste Wdh.) */
function bestOf(exId){let b=null;state.log.forEach(l=>{if(l.light)return;l.items.forEach(it=>{if(it.ex!==exId||!it.sets)return;it.sets.forEach(x=>{if(x.sec)return;const kg=num(x.kg),r=num(x.reps)+num(x.part||0);if(!b||kg>b.kg||(kg===b.kg&&r>b.reps))b={kg,reps:r}})})});return b}

/* Pläne: Wochen-Anpassungen. Grundplan gilt für alle Wochen, eine Anpassung nur für ihre Woche */
function viewItems(plan,unit,week){const o=week!=null&&plan.weekUnits&&plan.weekUnits[week]&&plan.weekUnits[week][unit.id];return o||unit.items}

/* Einheiten kopieren (neue IDs für Einheiten und Übungen) */
function cloneUnits(units){return JSON.parse(JSON.stringify(units)).map(u=>({...u,id:uid(),items:u.items.map(it=>({...it,id:uid()}))}))}


/* ================= Cardio: Intervall, Sprints, Dauer ================= */
const CARDIO={interval:"Intervall",sprint:"Sprints",duration:"Dauer"};
const isCardio=t=>!!CARDIO[t];
const METRICS=[["","kein Wert"],["kcal","Kalorien"],["m","Meter"],["Wdh.","Wiederholungen"]];
const IV_PRESETS=[["Tabata",{rounds:8,work:20,rest:10}],["30/30 × 10",{rounds:10,work:30,rest:30}],["40/20 × 8",{rounds:8,work:40,rest:20}],["EMOM 10",{rounds:10,work:60,rest:0}]];
const mmss=s=>{s=Math.max(0,Math.round(s));return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`};
const ivRounds=c=>c.custom&&c.custom.length?c.custom:Array.from({length:c.rounds},()=>[c.work,c.rest]);
const ivTotal=c=>10+ivRounds(c).reduce((a,[w,r],i,arr)=>a+w+(i<arr.length-1?r:0),0);
const paceTxt=(sec,km)=>km>0&&sec>0?`${mmss(sec/km)} /km`:"–";
function initCardio(item){const fmt=item.type;return {fmt,iv:JSON.parse(JSON.stringify(item.iv||FORMAT_DEF.interval.iv)),sp:JSON.parse(JSON.stringify(item.sp||FORMAT_DEF.sprint.sp)),du:JSON.parse(JSON.stringify(item.du||FORMAT_DEF.duration.du)),
  rounds:[],sprints:[],sw:{start:null,acc:0},dur:{sec:0,km:"",hr:""},done:false,customOpen:false}}
function cardioDone(c){return c.fmt==="interval"?c.rounds.length>0:c.fmt==="sprint"?c.sprints.some(s=>s.done):(c.dur.sec>0||num(c.dur.km)>0)}
function cardioTxt(c){if(!c)return "";if(c.fmt==="interval"){const r=c.rounds||[],cfg=c.iv,cu=cfg.custom&&cfg.custom.length;const vals=r.map(x=>x.val).filter(v=>v!==""&&v!=null);
    return `${r.length}${cu?" Runden (individuell)":`× ${cfg.work}/${cfg.rest} s`}${vals.length?` · ${vals.join(", ")} ${cfg.metric} (Σ ${fmt(vals.reduce((a,b)=>a+num(b),0))})`:""}`}
  if(c.fmt==="sprint"){const t=(c.sprints||[]).filter(s=>s.done);const best=t.map(s=>num(s.sec)).filter(x=>x>0);return `${t.length}× ${c.sp.dist} m${best.length?` · Bestzeit ${fmt(Math.min(...best))} s`:""}`}
  const km=num(c.dur.km);return `${mmss(c.dur.sec)} min${km>0?` · ${fmt(km)} km · ${paceTxt(c.dur.sec,km)}`:""}${c.dur.hr?` · Ø ${c.dur.hr} bpm`:""}`}

function cardioBox(item,ex,S){const C=S.cardio;let h=`<div class="seg" role="group" aria-label="Format heute"><button type="button" data-cfmt="duration" aria-pressed="${C.fmt==="duration"}">Dauer</button><button type="button" data-cfmt="interval" aria-pressed="${C.fmt==="interval"}">Intervall</button><button type="button" data-cfmt="sprint" aria-pressed="${C.fmt==="sprint"}">Sprints</button></div>`;
  if(C.fmt==="interval"){const c=C.iv;
    if(C.rounds.length){h+=`<div class="wz-head"><span class="wb-t">Ergebnis</span><span class="small muted">${pl(C.rounds.length,"Runde","Runden")}</span></div><div class="donelist">${C.rounds.map((r,k)=>`<div class="done-row"><b>R${k+1}</b><span class="num">${r.w} s / ${r.r} s</span>${c.metric?`<input class="inp num sel-sm" style="width:80px" inputmode="decimal" data-rval="${k}" value="${esc(r.val??"")}" placeholder="${esc(c.metric)}" aria-label="Wert Runde ${k+1}">`:""}</div>`).join("")}</div>
      <button class="btn" type="button" data-act="ivstart">Nochmal starten</button>`}
    else{h+=`<div class="quick">${IV_PRESETS.map(([n,p])=>`<button type="button" class="qchip${c.rounds===p.rounds&&c.work===p.work&&c.rest===p.rest&&!(c.custom&&c.custom.length)?" on":""}" data-ivp="${esc(n)}">${esc(n)}</button>`).join("")}</div>
      <div class="ivgrid">${[["rounds","Runden",1],["work","Belastung (s)",5],["rest","Pause (s)",5]].map(([k,l,st])=>`<div><div class="small muted">${l}</div><div class="stepper"><button type="button" data-ivs="${k}:-${st}" aria-label="${l} weniger">−</button><input class="num" data-ivv="${k}" inputmode="numeric" value="${c[k]}" aria-label="${l}"><button type="button" data-ivs="${k}:${st}" aria-label="${l} mehr">+</button></div></div>`).join("")}</div>
      <details class="fold"${C.customOpen?" open":""} data-ivcustom><summary><b>Runden einzeln anpassen</b><span class="small muted">${c.custom&&c.custom.length?"aktiv":"z. B. Pyramide"}</span></summary>
        ${c.custom&&c.custom.length?`<div class="stack" style="gap:4px">${c.custom.map(([w,r],k)=>`<div class="row"><span class="small muted" style="width:28px">R${k+1}</span><input class="inp num" style="width:70px" data-ivc="${k}:0" value="${w}" aria-label="Belastung R${k+1}"><span class="small muted">s /</span><input class="inp num" style="width:70px" data-ivc="${k}:1" value="${r}" aria-label="Pause R${k+1}"><span class="small muted">s</span></div>`).join("")}</div><button class="btn sm ghost" type="button" data-act="ivcustomoff">Wieder gleicher Rhythmus</button>`
        :`<button class="btn sm" type="button" data-act="ivcustomon">Runden einzeln einstellen</button>`}</details>
      <label class="small muted" style="display:flex;flex-direction:column;gap:4px">Wert pro Runde eintragen<select class="inp" data-ivmetric>${METRICS.map(([k,v])=>`<option value="${k}"${c.metric===k?" selected":""}>${v}</option>`).join("")}</select></label>
      <div class="ivsum"><span>Gesamt inkl. 10 s Vorbereitung</span><b class="num">${mmss(ivTotal(c))} min</b></div>
      <button class="btn primary full big-start" type="button" data-act="ivstart">▶ Intervall starten</button>
      <div class="small muted" style="text-align:center">Signale: ${({both:"Ton & Sprache",beep:"nur Ton",voice:"nur Sprache",off:"aus"})[state.settings.sound]} · Bildschirm bleibt an</div>`}}
  if(C.fmt==="sprint"){const sp=C.sp;if(!C.sprints.length)C.sprints=Array.from({length:sp.n},()=>({sec:"",done:false}));
    const best=C.sprints.filter(s=>s.done&&num(s.sec)>0).map(s=>num(s.sec));const lo=lastOf(ex.id);const lastBest=lo&&lo.it.cardio&&lo.it.cardio.fmt==="sprint"?Math.min(...lo.it.cardio.sprints.filter(s=>s.done&&num(s.sec)>0).map(s=>num(s.sec))):null;
    h+=`<div class="row between"><div class="row"><input class="inp num" style="width:80px" data-spdist value="${sp.dist}" aria-label="Strecke"><span class="small muted">m pro Sprint · Pause ${fmtRest(sp.rest)}</span></div>${best.length?`<span class="badge good-b">Best ${fmt(Math.min(...best))} s</span>`:""}</div>
      ${lastBest&&isFinite(lastBest)?`<div class="lasttime small"><span class="muted">Bestzeit letztes Mal:</span> <b class="num">${fmt(lastBest)} s</b></div>`:""}
      <div class="donelist">${C.sprints.map((s,k)=>`<div class="done-row${s.done?"":" open"}"><b>${k+1}</b><span class="small muted" style="flex:1">${sp.dist} m</span><input class="inp num" style="width:84px" inputmode="decimal" data-spsec="${k}" value="${esc(s.sec)}" placeholder="Zeit (s)" aria-label="Zeit Sprint ${k+1}"><button type="button" class="wb-check" data-spdone="${k}" aria-pressed="${s.done}" aria-label="Sprint ${k+1} erledigt">✓</button></div>`).join("")}</div>
      <div class="row"><button class="btn sm" type="button" data-act="spadd">+ Sprint</button>${C.sprints.length>1?`<button class="btn sm ghost" type="button" data-act="spdel">− Sprint</button>`:""}</div>`}
  if(C.fmt==="duration"){const run=C.sw.start!=null,sec=C.sw.acc+(run?(Date.now()-C.sw.start)/1000:0);
    h+=`<div class="stopwatch"><div class="num" id="swT">${mmss(sec)}</div><button class="btn ${run?"":"primary"} big-start" type="button" data-act="sw">${run?"⏸ Stopp":sec>0?"▶ Weiter":"▶ Start"}</button>${!run&&sec>0?`<button class="btn sm ghost" type="button" data-act="swreset">Zurücksetzen</button>`:""}</div>
      <div class="fields" style="grid-template-columns:1fr 1fr 1fr"><label>Dauer (min)<input inputmode="decimal" data-du="min" value="${C.dur.sec?fmt(Math.round(C.dur.sec/6)/10):""}" placeholder="${C.du.min||""}"></label><label>Distanz (km)<input inputmode="decimal" data-du="km" value="${esc(C.dur.km)}" placeholder="${C.du.km||""}"></label><label>Ø Puls<input inputmode="numeric" data-du="hr" value="${esc(C.dur.hr)}" placeholder="optional"></label></div>
      <div class="ivsum"><span>Pace</span><b class="num" id="paceT">${paceTxt(C.dur.sec,num(C.dur.km))}</b></div>`;
    const lo=lastOf(ex.id);if(lo&&lo.it.cardio&&lo.it.cardio.fmt==="duration")h+=`<div class="lasttime small"><span class="muted">Letztes Mal (${fmtD(lo.date)}):</span> <b class="num">${esc(cardioTxt(lo.it.cardio))}</b></div>`}
  return h}
/* Stoppuhr live aktualisieren */
setInterval(()=>{if(!ui.sess)return;const S=ui.sess.st[ui.sess.idx];if(!S||!S.cardio||S.cardio.fmt!=="duration"||S.cardio.sw.start==null)return;const C=S.cardio,sec=C.sw.acc+(Date.now()-C.sw.start)/1000;const el=$("#swT");if(el)el.textContent=mmss(sec)},500);

/* ---------- Töne, Sprache, Bildschirm an ---------- */
const AU={ctx:null};
function audioUnlock(){try{AU.ctx=AU.ctx||new (window.AudioContext||window.webkitAudioContext)();if(AU.ctx.state==="suspended")AU.ctx.resume()}catch(e){}try{if(window.speechSynthesis){const u=new SpeechSynthesisUtterance(" ");u.volume=0;speechSynthesis.speak(u)}}catch(e){}}
function beep(f,d,v=.35){try{if(!AU.ctx)return;const t=AU.ctx.currentTime,o=AU.ctx.createOscillator(),g=AU.ctx.createGain();o.type="sine";o.frequency.value=f;g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g);g.connect(AU.ctx.destination);o.start(t);o.stop(t+d+.02)}catch(e){}}
function say(t){try{if(!window.speechSynthesis||!t)return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);u.lang="de-DE";u.rate=1.05;speechSynthesis.speak(u)}catch(e){}}
const TONES={half:[[660,.18]],count:[[880,.1]],go:[[988,.12],[1319,.35]],rest:[[784,.15],[523,.45]],done:[[784,.15],[988,.15],[1319,.6]]};
function cue(kind,text){const m=state.settings.sound||"both";if(m==="off")return;if(m!=="voice"&&TONES[kind])TONES[kind].reduce((at,[f,d])=>{setTimeout(()=>beep(f,d),at);return at+d*1000+40},0);if(m!=="beep")say(text)}
let WL=null;async function wakeOn(){try{if(navigator.wakeLock&&!WL){WL=await navigator.wakeLock.request("screen");WL.addEventListener&&WL.addEventListener("release",()=>{WL=null})}}catch(e){WL=null}}
function wakeOff(){try{WL&&WL.release()}catch(e){}WL=null}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&IT.on){wakeOn();itTick()}});

/* ---------- Intervall-Timer (rechnet mit echter Uhrzeit) ---------- */
const IT={on:false};
function itStart(){const S=curS(),C=S.cardio,ex=exById(curItem().ex);audioUnlock();stopTimer();
  const rr=ivRounds(C.iv),ph=[{k:"prep",d:10}];rr.forEach(([w,r],i)=>{ph.push({k:"work",d:+w,round:i+1,n:rr.length,rest:+r});if(i<rr.length-1&&+r>0)ph.push({k:"rest",d:+r,round:i+1,n:rr.length})});
  Object.assign(IT,{on:true,ph,t0:Date.now(),paused:0,pauseAt:null,fired:{},ex:ex.name,S,done:0});wakeOn();
  let ov=$("#itov");if(!ov){ov=document.createElement("div");ov.id="itov";document.body.appendChild(ov)}ov.className="on";
  ov.innerHTML=`<div class="it-top"><span class="eyebrow" id="itEx"></span><button type="button" class="icon-btn" data-it="stop" aria-label="Intervall beenden">✕</button></div>
    <div class="it-phase" id="itPh"></div><div class="it-time num" id="itT"></div><div class="it-round" id="itR"></div>
    <div class="it-bar"><i id="itBar"></i></div><div class="it-next small" id="itN"></div><div class="it-rest small num" id="itLeft"></div>
    <div class="it-ctrl"><button type="button" class="btn" data-it="pause" id="itPause">Pause</button><button type="button" class="btn" data-it="skip">Überspringen ⏭</button></div>`;
  cue("count","Mach dich bereit");clearInterval(IT.iv);IT.iv=setInterval(itTick,100);itTick()}
const itElapsed=()=>((IT.pauseAt||Date.now())-IT.t0-IT.paused)/1000;
function itTick(){if(!IT.on)return;const e=itElapsed();let acc=0,idx=-1;for(let i=0;i<IT.ph.length;i++){if(e<acc+IT.ph[i].d){idx=i;break}acc+=IT.ph[i].d}
  if(idx<0)return itFinish(true);const p=IT.ph[idx],into=e-acc,left=p.d-into,ls=Math.ceil(left-1e-6);const f=(k,fn)=>{const key=idx+":"+k;if(!IT.fired[key]){IT.fired[key]=1;fn()}};
  if(idx>0)f("start",()=>{if(p.k==="work")cue("go",`Los! Runde ${p.round} von ${p.n}`);else if(p.k==="rest")cue("rest",`Pause, ${p.d} Sekunden`)});
  if(p.k==="work"&&p.d>=10&&into>=p.d/2)f("half",()=>cue("half","Halbzeit"));
  if(ls<=3&&ls>=1&&p.d>3)f("c"+ls,()=>cue("count",p.k==="work"&&ls===3?"Noch drei Sekunden":null));
  IT.done=IT.ph.slice(0,idx).filter(x=>x.k==="work").length;
  const ov=$("#itov");if(!ov)return;ov.dataset.ph=p.k;$("#itEx").textContent=IT.ex;$("#itPh").textContent={prep:"Vorbereiten",work:"Belastung",rest:"Pause"}[p.k]+(IT.pauseAt?" · angehalten":"");
  $("#itT").textContent=mmss(left);$("#itR").textContent=p.k==="prep"?`${IT.ph.filter(x=>x.k==="work").length} Runden`:`Runde ${p.round} von ${p.n}`;
  $("#itBar").style.width=(into/p.d*100)+"%";const nx=IT.ph[idx+1];$("#itN").textContent=nx?`Danach: ${({work:"Belastung",rest:"Pause"})[nx.k]} ${nx.d} s`:"Danach: geschafft";
  const tl=IT.ph.reduce((a,x)=>a+x.d,0)-e;$("#itLeft").textContent=`Noch ${mmss(tl)} insgesamt`;$("#itPause").textContent=IT.pauseAt?"Weiter":"Pause"}
function itPause(){if(IT.pauseAt){IT.paused+=Date.now()-IT.pauseAt;IT.pauseAt=null}else IT.pauseAt=Date.now();itTick()}
function itSkip(){const e=itElapsed();let acc=0;for(const p of IT.ph){if(e<acc+p.d){IT.t0-=(acc+p.d-e)*1000+1;break}acc+=p.d}itTick()}
function itFinish(complete){if(!IT.on)return;IT.on=false;clearInterval(IT.iv);wakeOff();const S=IT.S,C=S.cardio;
  const works=IT.ph.filter(x=>x.k==="work"),n=complete?works.length:IT.done;C.rounds=works.slice(0,n).map(w=>({w:w.d,r:w.rest,val:""}));C.done=n>0;
  cue("done",complete?"Geschafft! Gut gemacht":"Intervall beendet");const ov=$("#itov");
  if(ov){ov.dataset.ph="done";ov.innerHTML=`<div class="it-phase">${complete?"Geschafft":"Beendet"}</div><div class="it-time num">${n}/${works.length}</div><div class="it-round">Runden geschafft</div>
    <p class="small" style="text-align:center;max-width:280px">${C.iv.metric?`Trag jetzt pro Runde deine ${esc(METRICS.find(m=>m[0]===C.iv.metric)[1])} ein.`:"Notiz und Gefühl kannst du unten bei der Übung eintragen."}</p>
    <button type="button" class="btn primary" data-it="close">Zur Übung</button>`}markPending()}
document.addEventListener("click",e=>{const b=e.target.closest("[data-it]");if(!b)return;e.stopPropagation();const a=b.dataset.it;
  if(a==="pause")return itPause();if(a==="skip")return itSkip();if(a==="stop")return itFinish(false);
  if(a==="close"){const ov=$("#itov");ov&&(ov.className="");keepScroll()}},true);


/* ================= Training ================= */
const ui={libSeg:"uebungen",libSearch:"",progEx:"pullup",withBw:false,metric:"vol",sess:null};
const FREE={id:"free",name:"Freies Training",cycle:"",status:"frei",week:0,start:"2026-01-01",units:[]};
const planById=id=>id==="free"?FREE:state.plans.find(p=>p.id===id);
const sessUnit=()=>{const p=planById(ui.sess.planId);return {plan:p,unit:p.units.find(u=>u.id===ui.sess.unitId)||{id:null,name:ui.sess.unitName,items:[]}}};
const curItem=()=>ui.sess.list[ui.sess.idx];
function getS(i){const item=ui.sess.list[i];if(!ui.sess.st[i]){const {plan}=sessUnit();
    const S={work:suggest(item,plan,ui.sess.week).kg,warm:[],sets:[],draft:null,phase:"start",next:null,resting:false,editIdx:null,skipped:false,feel:null,note:"",rdone:[],rungs:null};
    if(item.type==="ladder"){S.rungs=Array.from({length:item.rounds},()=>Array(item.top).fill(false));S.phase="ladder"}
    if(isCardio(item.type)){S.phase="cardio";S.cardio=initCardio(item)}
    ui.sess.st[i]=S}
  return ui.sess.st[i]}
const curS=()=>getS(ui.sess.idx);
const warmReps=p=>p<=0?"5":p<60?"3":p<85?"2":"1";
/* Nächster Satz: Vorschläge aus dem letzten Training dieser Übung */
function mkDraft(item,S,kind){const ex=exById(item.ex),d={kind,kg:"",reps:"",part:"0",eff:"",style:"Normal",feel:null,side:null,assist:false};
  if(kind==="A"){const k=S.warm.length,lw=(ex.lastWarm||[])[k];const prev=S.warm[k-1];d.pct=lw?lw[0]:(prev?Math.min(95,prev.soll.pct+30):0);d.tr="";d.hint=lw?lw[1]:"";d.label=lw&&lw[2]||"";d.mode=lw&&lw[3]||"reps";return d}
  if(item.type==="hold"){d.sec=item.hold.sec;return d}
  const k=S.sets.length;d.tr="";d.hint=(ex.lastReps||[])[k]||"";if(k===0){d.pct=100;return d}
  d.pct=(ex.lastPct||[])[k]??(item.prio?80:100);return d}
function sollKg(item,S,d){const ex=exById(item.ex);if(d.fixedKg!=null)return d.fixedKg;if(d.sec)return 0;
  if(d.kind==="A")return roundW(ex,S.work*d.pct/100);if(!S.sets.length||d===S.sets[0])return roundW(ex,S.work);return roundW(ex,num(S.sets[0].kg)*d.pct/100)}
function restSuggest(item,S,next){const ex=exById(item.ex);if(next==="A")return 60;if(next==="S"&&!S.sets.length)return S.warm.length?180:60;if(item.type==="ladder")return 60;return ex.lastRest||(item.prio?300:120)}

function renderTraining(){if(ui.sess)return renderSession();
  const act=state.plans.filter(p=>p.status==="aktiv");
  let h=`<header class="top"><div><div class="eyebrow">${act.length} aktive ${act.length===1?"Plan":"Pläne"}</div><h1>Training</h1></div>${syncPill()}</header>`;
  const nf=state.log.filter(l=>l.planId==="free").length;
  h+=`<div class="card free-card"><div class="row between"><h3>Freies Training</h3><button type="button" class="linkbtn" data-histsheet="free">Verlauf ›</button></div>
    <div class="small muted">Ohne Plan, einfach aus Spaß. Zählt trotzdem für Fortschritt und Rekorde.${nf?` · ${pl(nf,"Training","Trainings")} bisher`:""}</div>
    <button type="button" class="btn primary" data-act="freestart">Freies Training starten</button></div>`;
  if(!act.length)return h+`<div class="card" style="margin-top:12px"><p style="margin:0">Für strukturiertes Training legst du unter Pläne einen Plan an.</p><a class="btn" href="#plaene">Zu den Plänen</a></div>`+DEMO;
  act.forEach(p=>{const c=cycById(p.cycle),tw=twOf(p),done=(p.done||{})[tw]||[];
    h+=`<div class="section-title"><h2>${esc(p.name)}</h2><button type="button" class="linkbtn" data-histsheet="${p.id}">Verlauf ›</button></div><div class="small muted" style="margin:-4px 0 8px">${c?`Aktuell Woche ${p.week+1} von ${c.weeks.length}`:"Ohne Zyklus"}</div>`;
    if(c)h+=`<div class="small muted" style="margin-bottom:4px">Training zählt für:</div><div class="chips" role="group" aria-label="Woche für dieses Training">${c.weeks.map((w,k)=>`<button type="button" class="chip" data-tweek="${p.id}:${k}" aria-pressed="${k===tw}">W${k+1}<span class="k">${w.pct} %${k===p.week?" · jetzt":""}</span></button>`).join("")}</div>`;
    if(c&&tw!==p.week)h+=`<div class="note" style="margin-bottom:8px">Du trägst für <b>Woche ${tw+1}</b> nach. Die aktuelle Woche bleibt Woche ${p.week+1}.</div>`;
    h+=`<div class="stack">`;
    p.units.forEach(u=>{const ok=c&&done.includes(u.id);h+=`<button type="button" class="unit-card${ok?" ok":""}" data-start="${p.id}:${u.id}"><div><h3>${esc(u.name)}</h3><div class="small muted">${ok?"✓ diese Woche erledigt · ":""}${pl(u.items.length,"Übung","Übungen")} · ${esc(u.items.slice(0,3).map(it=>exById(it.ex).name).join(", "))}${u.items.length>3?" …":""}</div></div><span class="go">Start</span></button>`});
    h+=`<button type="button" class="btn full ghost" data-extra="${p.id}">+ Zusätzliche Einheit${c?" in Woche "+(tw+1):""}</button></div>`});
  return h+DEMO}
const twOf=p=>{const c=cycById(p.cycle);if(!c)return null;const v=(ui.tw||{})[p.id];return v==null?p.week:Math.min(v,c.weeks.length-1)};
function extraSheet(pid){const p=planById(pid);sheet(`<h2>Zusätzliche Einheit</h2><p class="muted small" style="margin:0">Zählt nur für ${twOf(p)!=null?"Woche "+(twOf(p)+1):"heute"} und ändert deinen Plan nicht.</p>
  <div class="eyebrow" style="color:var(--faint)">Bestehende Einheit nutzen</div>${p.units.map(u=>`<button type="button" class="choice" data-extrastart="${p.id}:${u.id}"><b>${esc(u.name)}</b><span>${pl(u.items.length,"Übung","Übungen")}</span></button>`).join("")}
  <div class="eyebrow" style="color:var(--faint)">Oder neue Einheit anlegen</div><div class="row"><input class="inp" id="extraName" placeholder="z. B. Arme & Core"><button class="btn primary" type="button" data-extranew="${p.id}">Starten</button></div>
  <button class="btn ghost full" type="button" data-act="close">Abbrechen</button>`)}

function renderSession(){const {plan,unit}=sessUnit(),n=ui.sess.list.length;
  if(!n)return `<header class="top"><div><div class="eyebrow">${ui.sess.free?"Freies Training":esc(plan.name)+" · zusätzlich"}</div><h1>${esc(unit.name)}</h1></div>${syncPill()}</header><div class="card"><p style="margin:0">Füge deine erste Übung hinzu.</p><button class="btn primary" type="button" data-act="addex">+ Übung hinzufügen</button><button class="btn ghost" type="button" data-act="cancelsess">Abbrechen</button></div>`+DEMO;
  const i=ui.sess.idx,item=curItem(),ex=exById(item.ex),S=getS(i);
  let h=`<header class="top"><div><div class="eyebrow">${esc(unit.name)}${ui.sess.extra?" (zusätzlich)":""}${ui.sess.week!=null?" · W"+(ui.sess.week+1):""} · Übung ${i+1} von ${n}</div><h1>${esc(ex.name)}</h1></div>${syncPill()}</header>
    <div class="progress" aria-hidden="true">${ui.sess.list.map((x,k)=>{const s=ui.sess.st[k];return `<i class="${k===i?"cur":s&&s.skipped?"skip":s&&(s.sets.length||s.rdone.some(Boolean)||(s.cardio&&cardioDone(s.cardio)))?"done":""}"></i>`}).join("")}</div>
    <div class="row" style="margin-bottom:12px"><button type="button" class="btn sm" data-act="overview">Übersicht</button><button type="button" class="btn sm" data-act="swap">Austauschen</button><button type="button" class="btn sm ghost" data-act="finish" style="margin-left:auto">Beenden</button></div>`;
  h+=`<section class="card"><div class="row wrap">${badge(item)}<span class="small muted">${esc([ex.equip,ex.rack?"Rack "+ex.rack:""].filter(Boolean).join(" · "))}</span>${ui.sess.list[i]._swapped?'<span class="badge">heute getauscht</span>':""}</div>`;
  if(S.skipped)return h+`<div class="note">Übersprungen.</div><button class="btn" type="button" data-act="unskip">Doch machen</button></section>`+navRow(i,n,S)+DEMO;
  if(isStd(item.type)){const sg=suggest(item,plan,ui.sess.week);
    h+=`<div class="workrow"><div class="lbl"><b>Arbeitsgewicht</b>Vorschlag ${esc(kgLabel(ex,sg.kg))} · ${esc(sg.why)}</div>
      <div class="stepper"><button type="button" data-work="-1" aria-label="weniger">−</button><input id="workInp" class="num" inputmode="decimal" value="${fmt(S.work)}" aria-label="Arbeitsgewicht in kg"><button type="button" data-work="1" aria-label="mehr">+</button></div></div>`}
  /* erledigte Sätze */
  if(S.warm.length)h+=`<div class="wz-head"><span class="wb-t">Aufwärmen</span><span class="small muted">${S.warm.length} ${S.warm.length===1?"Satz":"Sätze"}</span></div><div class="donelist">${S.warm.map((w,k)=>`<div class="done-row warm"><b>A${k+1}</b><span class="num">${w.label&&w.label!==ex.name?`<span class="wl">${esc(w.label)}</span> `:""}${esc(kgLabel(ex,num(w.kg)))} × ${esc(w.reps)}${w.mode==="sec"?" s":""} <span class="muted">· ${fmt(w.soll.pct)} %</span></span><button type="button" class="icon-btn" data-delwarm="${k}" aria-label="A${k+1} entfernen">✕</button></div>`).join("")}</div>`;
  if(S.cardio)h+=cardioBox(item,ex,S);
  else if(item.type==="ladder")h+=ladderBox(item,S);
  else{if(S.sets.length||S.phase==="work"||S.phase==="askWork")h+=`<div class="wz-head"><span class="wb-t">Arbeitssätze</span><span class="small muted">${S.sets.length} gemacht</span></div>`;
    if(S.sets.length)h+=`<div class="donelist">${S.sets.map((st,k)=>`<div class="done-row${S.editIdx===k?" editing":""}"><b>S${k+1}</b><span class="num">${setText(ex,st)}${st.eff!==""&&st.eff!=null?` · ${state.settings.effort} ${fmt(num(st.eff))}`:""}${st.style&&st.style!=="Normal"?` · ${esc(st.style)}`:""}${st.pr?' <span class="badge good-b">Neuer Rekord</span>':""}</span>${st.feel?`<span class="mini-face">${FACES[st.feel]}</span>`:""}<button type="button" class="icon-btn" data-editset="${k}" aria-label="S${k+1} bearbeiten">✎</button><button type="button" class="icon-btn" data-delset="${k}" aria-label="S${k+1} entfernen">✕</button></div>`).join("")}</div>`;
    h+=stepBox(item,ex,S)}
  h+=`<div class="set"><span class="kind">Übung gesamt</span><div class="set-bottom">${feelBtns("ex",S.feel)}</div><textarea id="exNote" placeholder="Was war gut oder schlecht? (optional)">${esc(S.note)}</textarea></div></section>`;
  return h+navRow(i,n,S)+DEMO}
function navRow(i,n,S){return `<div class="navrow">${i>0?`<button type="button" class="btn" data-goex="${i-1}">← Zurück</button>`:"<span></span>"}
  ${S.skipped||S.sets.length||S.warm.length||S.rdone.some(Boolean)||(S.cardio&&cardioDone(S.cardio))?"":`<button type="button" class="btn ghost" data-act="skip">Überspringen</button>`}
  <button type="button" class="btn primary" data-act="nextex">${i<n-1?"Nächste Übung →":"Training beenden"}</button></div>`}
function setText(ex,st){if(st.sec)return `${esc(st.reps||st.sec)} s`;return `${esc(kgLabel(ex,num(st.kg)))} × ${fmt(num(st.reps)+num(st.part||0))}${st.side?" "+st.side:""}${st.assist?" assist.":""}`}

/* Der aktuelle Schritt: Start-Frage, Satz eintragen, Abfrage oder Pause wählen */
function stepBox(item,ex,S){
  if(S.editIdx!=null)return setCard(item,ex,S,S.sets[S.editIdx],"edit");
  if(S.phase==="start")return `<div class="askpanel"><div class="eyebrow">Womit startest du?</div>
    ${item.type==="hold"?"":`<button type="button" class="choice" data-next="A"><b>Aufwärmsatz</b><span>Prozent wählen, Gewicht sehen, dann Pause starten</span></button>`}
    <button type="button" class="choice" data-next="S"><b>${item.type==="hold"?"Ersten Satz starten":"Direkt zum Arbeitssatz"}</b><span>Ziel-Wdh. eintragen, dann los</span></button></div>`;
  if(S.phase==="askWarm")return `<div class="askpanel"><div class="eyebrow">Wie geht's weiter?</div>
    <button type="button" class="choice" data-next="A"><b>Weiterer Aufwärmsatz</b><span>Prozent wählen, dann Pause starten</span></button>
    <button type="button" class="choice" data-next="S"><b>Zum Arbeitssatz</b><span>${esc(kgLabel(ex,roundW(ex,S.work)))}</span></button></div>`;
  if(S.phase==="askWork")return `<div class="askpanel"><div class="eyebrow">Wie geht's weiter?</div>
    <button type="button" class="choice" data-next="S"><b>Weiterer Satz</b><span>${isStd(item.type)?"Prozent vom ersten Satz wählen, dann Pause starten":"dann Pause starten"}</span></button>
    <button type="button" class="choice next" data-act="nextex"><b>Nächste Übung →</b><span>ohne Pause</span></button></div>`;
  if(S.phase==="rest"){const sug=restSuggest(item,S,S.next);return `<div class="askpanel"><div class="eyebrow">Wie lange Pause?</div>
    <div class="restchips">${REST_CHIPS.map(r=>`<button type="button" class="rchip${r===sug?" sug":""}" data-rest="${r}">${fmtRest(r)}${r===sug?"<small>Vorschlag</small>":""}</button>`).join("")}</div>
    <button type="button" class="btn ghost" data-rest="0">Ohne Pause weiter</button></div>`}
  if(S.draft){const b=S.resting?`<div class="restpanel slim"><span class="eyebrow">Pause läuft</span><span class="small muted">Zeit zum Gewicht laden</span><button class="btn sm" type="button" data-act="skiprest">Pause beenden</button></div>`:"";return b+setCard(item,ex,S,S.draft,"new")}
  return ""}
function setCard(item,ex,S,d,mode){const eff=state.settings.effort,isA=d.kind==="A",kg=mode==="edit"?d.soll.kg:sollKg(item,S,d),k=isA?S.warm.length:mode==="edit"?S.editIdx:S.sets.length;
  const first=!isA&&k===0&&isStd(item.type);
  let h=`<div class="setcard"><div class="set-top"><span><b>${isA?"A":"S"}${k+1}</b><span class="kind">${isA?"Aufwärmsatz":first?"Erster Arbeitssatz":"Arbeitssatz"}</span></span></div>`;
  if(isA&&mode==="new"){const labels=[...new Set([...(ex.lastWarm||[]).map(x=>x[2]).filter(Boolean),...(ex.warmLabels||[]),ex.name])].slice(0,6);
    h+=`<label class="small muted" style="display:flex;flex-direction:column;gap:4px">Was machst du? (Bezeichnung)<input class="inp" id="wLabel" value="${esc(d.label||"")}" placeholder="${esc(ex.name)}"></label>
      <div class="quick">${labels.map(l=>`<button type="button" class="qchip${l===(d.label||ex.name)?" on":""}" data-wlabel="${esc(l)}">${esc(l)}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Art des Aufwärmsatzes"><button type="button" data-wmode="reps" aria-pressed="${d.mode!=="sec"}">Wiederholungen</button><button type="button" data-wmode="sec" aria-pressed="${d.mode==="sec"}">Halten (Sekunden)</button></div>`}
  if(d.pct!=null&&!first&&mode==="new"){const ref=isA?`vom Arbeitsgewicht (${fmt(S.work)} kg)`:`vom ersten Satz (${fmt(num(S.sets[0].kg))} kg)`;
    h+=`<div class="slider"><div class="row between"><span class="small muted">${ref}</span><b class="num" id="pctLbl">${fmt(d.pct)} %</b></div>
      <input type="range" min="0" max="100" step="5" value="${d.pct}" id="pctRange" aria-label="Prozent">
      <div class="quick">${(isA?[0,40,60,70,80,90]:[100,90,80,70,60,50]).map(p=>`<button type="button" class="qchip${p===d.pct?" on":""}" data-qpct="${p}">${p} %</button>`).join("")}</div></div>`}
  const unitLbl=isA&&d.mode==="sec"?"s halten":"Wdh.";
  if(!d.sec)h+=`<div class="target"><span>Nimm</span><b class="num" id="sollKg">${esc(kgLabel(ex,kg))}</b><span>×</span><input class="inp num" id="trInp" value="${esc(String(d.tr||"").replace("–","-"))}" placeholder="${d.hint?esc(String(d.hint).replace("–","-")):"z. B. 6-8"}" aria-label="Ziel" ${mode==="edit"?"disabled":""}><span>${unitLbl}</span></div>${d.hint&&mode!=="edit"?`<div class="small muted" style="margin-top:-4px">Letztes Mal: ${esc(d.hint)} ${unitLbl}</div>`:""}`;
  else h+=`<div class="target"><span>Halten</span><b class="num">${esc(d.sec)} s</b></div>`;
  if(!d.sec){const pf=platesFor(ex,kg);if(pf)h+=`<div class="plates small" id="plateTxt">${esc(pf)}</div>`}
  if(mode==="new"){const lo=lastOf(ex.id);if(lo){const arr=isA?lo.it.warm:lo.it.sets;const x=arr&&arr[k];if(x)h+=`<div class="lasttime small"><span class="muted">Letztes Mal (${fmtD(lo.date)}) ${isA?"A":"S"}${k+1}:</span> <b class="num">${esc(logSetTxt(ex,x))}</b></div>`}}
  if(mode==="new"&&!d.ready){const sug=restSuggest(item,S,d.kind),firstEver=!S.sets.length&&!S.warm.length;
    return h+`<div class="eyebrow" style="margin-top:4px">${firstEver?"Bereit? Optional eine Pause zum Vorbereiten":"Jetzt Pause starten und Gewicht laden"}</div>
      <div class="restchips">${REST_CHIPS.map(r=>`<button type="button" class="rchip${r===sug&&!firstEver?" sug":""}" data-rest="${r}">${fmtRest(r)}${r===sug&&!firstEver?"<small>Vorschlag</small>":""}</button>`).join("")}</div>
      <button type="button" class="btn${firstEver?" primary":""} full" data-rest="0">${firstEver?"Los, ohne Pause":"Ohne Pause weiter"}</button></div>`}
  if(isA)h+=`<div class="fields" style="grid-template-columns:1fr 1fr"><label>kg gemacht<input inputmode="decimal" data-f="kg" value="${esc(d.kg)}" placeholder="${fmt(kg)}"></label><label>${d.mode==="sec"?"Sekunden gehalten":"Wdh. gemacht"}<input inputmode="numeric" data-f="reps" value="${esc(d.reps)}" placeholder="${esc(parseRange(d.tr||d.hint||"").min||"")}"></label></div>`;
  else if(d.sec)h+=`<div class="fields" style="grid-template-columns:1fr 1fr"><label>Sekunden<input inputmode="numeric" data-f="reps" value="${esc(d.reps)}" placeholder="${esc(parseRange(d.sec).min)}"></label>${eff!=="none"?`<label>${eff}<select data-f="eff">${effOpts(d.eff)}</select></label>`:""}</div>`;
  else h+=`<div class="fields" style="grid-template-columns:${eff==="none"?"1fr 1fr":"1fr 1fr 1fr"}"><label>kg gemacht<input inputmode="decimal" data-f="kg" value="${esc(d.kg)}" placeholder="${fmt(kg)}"></label>
    <label>Wdh.<input inputmode="numeric" data-f="reps" value="${esc(d.reps)}" placeholder="${esc(parseRange(d.tr||d.hint||"").min||"")}"></label>
    ${eff!=="none"?`<label>${eff}<select data-f="eff">${effOpts(d.eff)}</select></label>`:""}</div>
    <div class="partrow"><span class="small muted">Teilwdh. danach</span><input type="range" min="0" max="95" step="5" value="${Math.round(num(d.part||0)*100)}" id="partRange" aria-label="Teilwiederholung in Prozent"><b class="num" id="partLbl">${num(d.part||0)>0?Math.round(num(d.part)*100)+" %":"keine"}</b></div>`;
  if(!isA){h+=`<div class="set-bottom"><label class="small muted" style="display:flex;align-items:center;gap:6px">Stil<select class="inp sel-sm" data-f="style">${state.styles.map(x=>`<option${x===d.style?" selected":""}>${esc(x)}</option>`).join("")}</select></label>`;
    if(ex.sided)h+=`<div class="side">${["L","R"].map(x=>`<button type="button" data-side="${x}" aria-pressed="${d.side===x}">${x}</button>`).join("")}<button type="button" data-assist="1" aria-pressed="${!!d.assist}">assist.</button></div>`;
    h+=`</div>`}
  h+=`<div class="set-bottom">${isA?"":feelBtns("set",d.feel)}${mode==="edit"?`<button type="button" class="btn sm ghost" data-act="canceledit" style="margin-left:auto">Abbrechen</button><button type="button" class="done-btn" data-act="saveedit" style="margin-left:6px">Speichern</button>`:`<button type="button" class="done-btn big-done" data-act="setdone">Fertig</button>`}</div></div>`;
  return h}
const ladderTxt=(item,r)=>r.map((d,k)=>d?item.top-k:null).filter(x=>x!=null).join("-")||"–";
function ladderBox(item,S){let h=`<div class="wz-head"><span class="wb-t">Runden</span><span class="small muted">Geschaffte Stufen antippen, dann Runde abschließen</span></div><div class="ladder">${S.rungs.map((r,ri)=>`<div class="rnd${S.rdone[ri]?" closed":""}"><span>R${ri+1}</span>${r.map((d,k)=>`<button type="button" class="rung" data-rung="${ri}:${k}" aria-pressed="${d}"${S.rdone[ri]?" disabled":""}>${item.top-k}</button>`).join("")}${S.rdone[ri]?`<span class="small good">✓ ${ladderTxt(item,r)}</span><button type="button" class="icon-btn" data-round="${ri}" aria-label="Runde ${ri+1} wieder öffnen">✎</button>`:`<button type="button" class="rnd-done" data-round="${ri}">✓ Runde</button>`}</div>`).join("")}</div>`;
  if(S.phase==="rest")h+=stepBox(item,null,S);return h}

/* ---------- Session: Übersicht, Austauschen, Hinzufügen, Beenden ---------- */
function goEx(j){const S=ui.sess.st[ui.sess.idx];if(S)S.resting=false;timer.onEnd=null;
  if(j>=ui.sess.list.length)return finishSession();ui.sess.idx=j;render();window.scrollTo(0,0)}
function overview(){const {unit}=sessUnit();sheet(`<h2>${esc(unit.name)}</h2><div class="stack" style="gap:6px">${ui.sess.list.map((it,k)=>{const s=ui.sess.st[k],ex=exById(it.ex);
  const st=!s?"offen":s.skipped?"übersprungen":s.cardio?(cardioDone(s.cardio)?"erledigt":"offen"):it.type==="ladder"?`${s.rdone.filter(Boolean).length}/${it.rounds} Runden`:s.sets.length?pl(s.sets.length,"Satz","Sätze"):"offen";
  return `<button type="button" class="ov-row${k===ui.sess.idx?" cur":""}" data-jump="${k}"><span class="num muted">${k+1}</span><span style="flex:1;text-align:left"><b>${esc(ex.name)}</b> ${badge(it)}</span><span class="small ${st==="offen"?"muted":st==="übersprungen"?"warn":"good"}">${st}</span></button>`}).join("")}</div>
  <button type="button" class="btn" data-act="addex">+ Übung hinzufügen</button><button type="button" class="btn ghost full" data-act="close">Schließen</button>`)}
function swapAsk(kind){const it=curItem(),ex=exById(it.ex);ui.swapAsk=kind;
  sheet(`<h2>${kind==="swap"?"Getauscht gegen "+esc(ex.name):esc(ex.name)+" hinzugefügt"}</h2><p class="muted small" style="margin:0">Gilt das nur für heute oder soll es auch im Plan gespeichert werden?</p>
    <button class="choice" type="button" data-swapkeep="0"><b>Nur heute</b><span>Der Plan bleibt, wie er ist</span></button>
    ${ui.sess.week!=null?`<button class="choice" type="button" data-swapkeep="w"><b>Nur für Woche ${ui.sess.week+1}</b><span>Gilt für alle Trainings dieser Woche</span></button>`:""}
    <button class="choice" type="button" data-swapkeep="1"><b>${kind==="swap"?"Dauerhaft im Grundplan ersetzen":"Im Grundplan speichern"}</b><span>Gilt für alle Wochen ohne eigene Anpassung</span></button>`)}
function finishSession(){let rows="";
  ui.sess.list.forEach((it,k)=>{const s=ui.sess.st[k],ex=exById(it.ex);if(!s)return;
    if(s.skipped){rows+=`<tr><td>${esc(ex.name)}</td><td colspan="2" class="muted">übersprungen</td></tr>`;return}
    if(s.cardio){if(cardioDone(s.cardio))rows+=`<tr><td>${esc(ex.name)}</td><td colspan="2" class="num">${esc(cardioTxt(s.cardio))}</td></tr>`;return}
    if(it.type==="ladder"){const d=s.rdone.filter(Boolean).length;if(d)rows+=`<tr><td>${esc(ex.name)}<div class="muted small">${s.rungs.filter((r,k)=>s.rdone[k]).map(r=>ladderTxt(it,r)).join(" · ")}</div></td><td>${d}/${it.rounds} Runden</td><td>${d===it.rounds&&s.rungs.every(r=>r.every(Boolean))?"Leiter steigern":"Leiter halten"}</td></tr>`;return}
    if(!s.sets.length)return;const f=s.sets[0],sl=f.soll;let dev="–",tip="–";
    if(!f.sec&&f.soll.reps){const kg=num(f.kg),r=num(f.reps)+num(f.part||0),{min,max}=parseRange(sl.reps);const d=[];if(kg<sl.kg)d.push(`−${fmt(sl.kg-kg)} kg`);if(kg>sl.kg)d.push(`+${fmt(kg-sl.kg)} kg`);if(r<min)d.push(`−${fmt(min-r)} Wdh.`);if(r>max)d.push(`+${fmt(r-max)} Wdh.`);
      dev=d.length?d.join(" · "):"im Ziel";const rir=s.sets.map(x=>x.eff).filter(x=>x!==""&&x!=null).map(toRIR);
      tip=r<min||kg<sl.kg?"Gewicht halten":r>=max&&(!rir.length||Math.min(...rir)>=2)?`+${fmt(stepOf(ex))} kg vorschlagen`:"Gewicht halten, Wdh. steigern"}
    rows+=`<tr><td>${esc(ex.name)}<div class="muted small">Erster Satz: ${esc(dev)}</div></td><td class="num">${pl(s.sets.length,"Satz","Sätze")}${s.warm.length?`<div class="muted small">+ ${s.warm.length} Aufwärmen</div>`:""}</td><td>${esc(tip)}</td></tr>`});
  sheet(`<h2>Training beenden</h2>${rows?`<div class="tablewrap"><table><thead><tr><th>Übung</th><th>Gemacht</th><th>Nächstes Mal</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<p class="muted">Noch nichts eingetragen.</p>`}
   <div><span class="small muted">Wie war das Training insgesamt?</span>${feelBtns("session",ui.sess.feel)}</div>
   <label class="small muted" style="display:flex;flex-direction:column;gap:4px">Datum des Trainings<input class="inp" type="date" id="sessDate" value="${ui.sess.date||iso(new Date())}"></label>
   <textarea id="sessNote" placeholder="Notiz zum Training (optional)">${esc(ui.sess.note)}</textarea>
   <label class="check"><input type="checkbox" id="sessLight"${ui.sess.light?" checked":""}> <span>Technik / leichte Einheit<br><span class="small muted">Wird gespeichert, zählt aber nicht für deinen Trend.</span></span></label>
   <div class="row"><button class="btn ghost" type="button" data-act="close">Weiter trainieren</button><button class="btn primary" style="flex:1" type="button" data-act="savesession">Speichern &amp; beenden</button></div>`)}
/* Beim Speichern: Vorschläge fürs nächste Mal merken und Fortschritt im Plan zählen */
function saveSession(){const {plan,unit}=sessUnit();const sd=$("#sessDate");const today=(sd&&sd.value)||ui.sess.date||iso(new Date());const logItems=[];
  ui.sess.list.forEach((it,k)=>{const s=ui.sess.st[k],ex=exById(it.ex);if(!s||s.skipped)return;ex.lastUsed=today;
    if(s.cardio){if(cardioDone(s.cardio)){const c=JSON.parse(JSON.stringify(s.cardio));delete c.sw;c.sprints=(c.sprints||[]).filter(x=>x.done);logItems.push({ex:it.ex,type:"cardio",cardio:c,sets:[],warm:[],feel:s.feel,note:s.note})}return}
    if(s.warm.length){ex.lastWarm=s.warm.map(w=>[w.soll.pct,w.soll.reps,w.label||"",w.mode||"reps"]);ex.warmLabels=[...new Set([...s.warm.map(w=>w.label).filter(Boolean),...(ex.warmLabels||[])])].slice(0,8)}
    logItems.push({ex:it.ex,type:it.type,feel:s.feel,note:s.note,warm:s.warm.map(w=>({kg:w.kg,reps:w.reps,tr:w.tr||"",pct:w.soll.pct,label:w.label&&w.label!==ex.name?w.label:"",mode:w.mode})),sets:s.sets.map(x=>({kg:x.kg,reps:x.reps,part:x.part,sec:x.sec,style:x.style,eff:x.eff,side:x.side,assist:x.assist,feel:x.feel,tr:x.tr||"",pr:!!x.pr})),ladder:it.type==="ladder"?s.rungs.filter((r,k)=>s.rdone[k]).map(r=>ladderTxt(it,r)):null});
    if(s.sets.length){ex.lastPct=s.sets.map(x=>x.soll.pct);ex.lastReps=s.sets.map(x=>x.soll.reps);if(isStd(it.type)&&!ui.sess.light)it.base=s.work}
    if(s.lastRest)ex.lastRest=s.lastRest});
  logItems.forEach(it=>{it.id=uid();(it.sets||[]).forEach(x=>x.id=uid());(it.warm||[]).forEach(x=>x.id=uid())});
  const c=cycById(plan.cycle),wk=ui.sess.week;let msg="";if(logItems.length){state.log.push({id:uid(),unitId:unit.id||null,planId:plan.id,unit:unit.name,extra:!!ui.sess.extra,light:!!ui.sess.light,week:c?wk:null,date:today,feel:ui.sess.feel,note:ui.sess.note,items:logItems});state.log.sort((a,b)=>a.date.localeCompare(b.date))}
  if(c&&!ui.sess.extra){plan.done=plan.done||{};const d=plan.done[wk]=plan.done[wk]||[];if(!d.includes(unit.id))d.push(unit.id);
    if(wk===plan.week&&plan.units.every(u=>d.includes(u.id))){if(plan.week>=c.weeks.length-1){plan.status="archiv";plan.finished=today;msg="zyklus"}else{plan.week++;msg="woche"}}}
  ui.sess=null;closeSheet();stopTimer();timer.onEnd=null;markPending();render();window.scrollTo(0,0);
  if(msg==="woche")sheet(`<h2>Woche ${plan.week} geschafft</h2><p style="margin:0">Alle Einheiten von „${esc(plan.name)}“ für diese Woche sind erledigt. Weiter geht's mit <b>Woche ${plan.week+1}</b> (${c.weeks[plan.week].pct} %).</p><button class="btn primary full" type="button" data-act="close">Alles klar</button>`);
  if(msg==="zyklus")sheet(`<h2>Zyklus abgeschlossen</h2><p style="margin:0">„${esc(plan.name)}“ ist fertig und liegt jetzt im Archiv. Willst du direkt den nächsten Zyklus starten? Deine Testergebnisse kannst du dabei als neue Maxima eintragen.</p><div class="row"><button class="btn ghost" type="button" data-act="close">Später</button><button class="btn primary" style="flex:1" type="button" data-nextcycle="${plan.id}">Neuen Zyklus starten</button></div>`)}

function freeSheet(){const past=state.log.filter(l=>l.planId==="free").slice(-3).reverse();
  sheet(`<h2>Freies Training</h2><label class="small muted" style="display:flex;flex-direction:column;gap:4px">Name (optional)<input class="inp" id="freeName" placeholder="z. B. Arme & Core"></label>
    <button class="btn primary full" type="button" data-act="freego">Leer starten</button>
    ${past.length?`<div class="eyebrow" style="color:var(--faint)">Oder wiederholen</div>${past.map(l=>`<button type="button" class="choice" data-freerep="${state.log.indexOf(l)}"><b>${esc(l.unit)}</b><span>${fmtD(l.date)} · ${esc(l.items.map(i=>(exById(i.ex)||{name:"?"}).name).join(", "))}</span></button>`).join("")}`:""}
    <button class="btn ghost full" type="button" data-act="close">Abbrechen</button>`)}


/* ================= Pläne ================= */
function planCard(p){const c=cycById(p.cycle),end=planEnd(p),done=(p.done||{})[p.week]||[];
  let h=`<div class="card"><div class="row between"><h3>${esc(p.name)}</h3><span class="badge good-b">aktiv</span></div>
    <div class="small muted">${c?esc(c.name)+" · wird nach der letzten Einheit abgeschlossen":"Ohne Zyklus · bleibt offen"}</div>
    <div class="formgrid"><label>Beginn<input class="inp" type="date" data-pstart="${p.id}" value="${p.start}"></label>${c?`<label>Ende (geplant)<input class="inp" type="date" data-pend="${p.id}" value="${end}"></label>`:`<label>Ende<input class="inp" type="date" data-pend="${p.id}" value="${p.end||""}"></label>`}</div>
    <button type="button" class="btn" data-histsheet="${p.id}">Verlauf ansehen · ${pl(state.log.filter(l=>l.planId===p.id).length,"Training","Trainings")}</button>`;
  if(c){h+=`<div class="chips" style="margin:0" role="group" aria-label="Aktuelle Woche">${c.weeks.map((w,k)=>`<button type="button" class="chip" data-week="${p.id}:${k}" aria-pressed="${k===p.week}">W${k+1}<span class="k">${w.pct} %${w.tag?" "+esc(w.tag):""}</span></button>`).join("")}</div>
    <div class="small muted">Diese Woche erledigt: ${p.units.map(u=>`${done.includes(u.id)?"✓":"○"} ${esc(u.name.replace("Full Body ",""))}`).join(" · ")}</div>`;
    if(c.basis>0){const ids=[...new Set(p.units.flatMap(u=>u.items.filter(it=>it.prio).map(it=>it.ex)))];
      if(ids.length)h+=`<details class="fold"><summary><b>Prio-Übungen: ${esc(rmLabel(c.basis))} &amp; Gewichte pro Woche</b></summary><div class="tablewrap"><table><thead><tr><th>Übung</th><th class="r">${esc(rmLabel(c.basis))}</th>${c.weeks.map((x,k)=>`<th class="r">W${k+1}</th>`).join("")}</tr></thead><tbody>
        ${ids.map(id=>{const e=exById(id),m=getMax(e,c.basis);return `<tr><td>${esc(e.name)}${m&&m.est?'<div class="muted small">≈ geschätzt</div>':""}</td><td class="r"><input class="inp num" inputmode="decimal" data-max="${p.id}:${e.id}" value="${m?fmt(m.kg):""}" placeholder="–" aria-label="${esc(rmLabel(c.basis))} ${esc(e.name)}"></td>${c.weeks.map(x=>`<td class="r">${m?fmt(roundW(e,m.kg*x.pct/100)):"–"}</td>`).join("")}</tr>`}).join("")}
        </tbody></table></div></details>`}}
  const ew=editWeekOf(p);
  if(c)h+=`<div class="small muted" style="margin-top:4px">Übungen bearbeiten für:</div><div class="chips" style="margin:0" role="group" aria-label="Bearbeiten für"><button type="button" class="chip" data-ew="${p.id}:all" aria-pressed="${ew==null}">Alle Wochen</button>${c.weeks.map((w,k)=>{const has=p.weekUnits&&p.weekUnits[k]&&Object.keys(p.weekUnits[k]).length;return `<button type="button" class="chip" data-ew="${p.id}:${k}" aria-pressed="${ew===k}">W${k+1}${has?'<span class="k">●</span>':""}</button>`}).join("")}</div>
    ${ew!=null?`<div class="note">Änderungen gelten <b>nur für Woche ${ew+1}</b>. Der Grundplan und die anderen Wochen bleiben unverändert.</div>`:`<div class="small muted">Änderungen am Grundplan gelten für alle Wochen ohne eigene Anpassung. Bereits gespeicherte Trainings bleiben unverändert.</div>`}`;
  p.units.forEach(u=>{const items=ew==null?u.items:viewItems(p,u,ew),own=ew!=null&&items!==u.items;
    h+=`<details class="fold unit-fold"${ui.openUnit===u.id?" open":""}><summary><b>${esc(u.name)}</b><span class="small muted">${own?'<span class="badge cardio">angepasst</span> ':""}${pl(items.length,"Übung","Übungen")}</span></summary>
    ${items.map((it,k)=>{const e=exById(it.ex);return `<div class="plan-item"><div class="pi-main"><div class="row wrap"><b>${esc(e.name)}</b>${badge(it)}</div><div class="small muted">${esc(itemSummary(it,p))}</div></div>
      <div class="pi-act"><button class="btn sm" type="button" data-edit="${u.id}:${k}">Bearbeiten</button><div class="row" style="gap:4px"><button class="btn sm ghost" type="button" data-move="${u.id}:${k}:-1" aria-label="nach oben"${k===0?" disabled":""}>↑</button><button class="btn sm ghost" type="button" data-move="${u.id}:${k}:1" aria-label="nach unten"${k===items.length-1?" disabled":""}>↓</button></div></div></div>`}).join("")}
    <button class="btn" type="button" data-pick="${u.id}">+ Übung hinzufügen${ew!=null?" (nur W"+(ew+1)+")":""}</button>${own?`<button class="btn sm ghost" type="button" data-wreset="${p.id}:${u.id}:${ew}">Auf Grundplan zurücksetzen</button>`:""}</details>`});
  const logs=state.log.filter(l=>l.planId===p.id);

  h+=`<div class="row"><button class="btn sm" type="button" data-reuse="${p.id}">Kopieren</button>${c?`<button class="btn sm" type="button" data-nextcycle="${p.id}">Neuen Zyklus starten</button>`:""}<button class="btn sm danger" type="button" data-archive="${p.id}" style="margin-left:auto">Abschließen</button></div></div>`;
  return h}
function editWeekOf(plan){const w=(ui.editWeek||{})[plan.id];return w==null||w==="all"?null:+w}
function listFor(unitId,create){const {plan,unit}=findUnit(unitId);const w=editWeekOf(plan);if(w==null)return unit.items;plan.weekUnits=plan.weekUnits||{};const wu=plan.weekUnits[w]=plan.weekUnits[w]||{};
  if(!wu[unitId]){if(!create)return unit.items;wu[unitId]=JSON.parse(JSON.stringify(unit.items))}return wu[unitId]}
function histHtml(p){const c=cycById(p.cycle),logs=state.log.filter(l=>l.planId===p.id);const hw=(ui.histWeek||{})[p.id]??Math.min(p.week,c?c.weeks.length-1:0);const shown=c?logs.filter(l=>l.week===hw):logs.slice().reverse();
  return `${c?`<div class="chips" style="margin:0" role="group" aria-label="Woche im Verlauf">${c.weeks.map((w,k)=>{const n=logs.filter(l=>l.week===k).length;return `<button type="button" class="chip" data-histweek="${p.id}:${k}" aria-pressed="${k===hw}">W${k+1}<span class="k">${w.pct} % · ${n}×</span></button>`}).join("")}</div>`:""}
    ${c?`<div class="statusrow">${p.units.map(u=>{const l=logs.find(x=>x.week===hw&&x.unit===u.name&&!x.extra);return `<span class="${l?"good":"muted"}">${l?"✓":"○"} ${esc(u.name.replace("Full Body ",""))}${l?" · "+fmtD(l.date).slice(0,6):" · offen"}</span>`}).join("")}${logs.filter(x=>x.week===hw&&x.extra).length?`<span class="accent">+ ${logs.filter(x=>x.week===hw&&x.extra).length} zusätzlich</span>`:""}</div>`:""}
    <div class="stack" style="gap:8px">${shown.map(logBlock).join("")||'<p class="muted small" style="margin:0">In dieser Woche noch nichts trainiert.</p>'}</div>`}
function histSheet(pid){const p=planById(pid);ui.histSheet=pid;sheet(`<h2>${esc(p.name)}</h2><div class="small muted">${pid==="free"?"Alle Trainings ohne Plan":`${fmtD(p.start)} – ${p.finished?fmtD(p.finished):"offen"}`}</div>${histHtml(p)}<button class="btn ghost full" type="button" data-act="close">Schließen</button>`)}
function renderPlaene(){const act=state.plans.filter(p=>p.status==="aktiv"),arch=state.plans.filter(x=>x.status==="archiv");
  let h=`<header class="top"><div><div class="eyebrow">Planung</div><h1>Pläne</h1></div>${syncPill()}</header>
    <button class="btn primary full" type="button" data-act="wizard" style="margin-bottom:6px">+ Neuer Plan</button>
    <p class="muted small" style="margin:0 0 6px">Jeder Trainingsblock ist ein eigener Plan, z. B. Kraft und Skill getrennt. Mehrere Pläne können gleichzeitig aktiv sein.</p>`;
  h+=`<div class="section-title"><h2>Aktiv</h2><span class="small muted">${pl(act.length,"Plan","Pläne")}</span></div><div class="stack">${act.map(planCard).join("")||'<p class="muted small">Kein aktiver Plan.</p>'}</div>`;
  h+=`<div class="section-title"><h2>Archiv</h2><span class="small muted">${pl(arch.length,"Plan","Pläne")}</span></div><div class="card" style="gap:0">${arch.map(a=>`<div class="lib-item"><div><b>${esc(a.name)}</b><div class="small muted">${fmtD(a.start)} – ${a.finished?fmtD(a.finished):planEnd(a)?fmtD(planEnd(a)):"offen"} · ${pl(a.units.length,"Einheit","Einheiten")} · ${esc((cycById(a.cycle)||{name:"ohne Zyklus"}).name)}</div></div><div class="pi-act">${state.log.some(l=>l.planId===a.id)?`<button class="btn sm" type="button" data-histsheet="${a.id}">Verlauf</button>`:""}${cycById(a.cycle)?`<button class="btn sm" type="button" data-nextcycle="${a.id}">Nächster Zyklus</button>`:""}<button class="btn sm ghost" type="button" data-reuse="${a.id}">Als Vorlage</button></div></div>`).join("")||'<p class="muted small" style="margin:0">Noch keine abgeschlossenen Pläne.</p>'}</div>`;
  return h+DEMO}

/* ---------- Übung auswählen: aus Bibliothek oder neu ---------- */
function openPicker(unitId,target){ui.pick={unitId,target:target||"plan",q:""};renderPicker()}
function exList(q){const all=state.exercises.filter(e=>!e.deleted&&e.name.toLowerCase().includes(q.toLowerCase()));
  const recent=q?[]:all.filter(e=>e.lastUsed).sort((a,b)=>b.lastUsed.localeCompare(a.lastUsed)).slice(0,5);
  return {recent,rest:all.filter(e=>!recent.includes(e)).sort((a,b)=>a.name.localeCompare(b.name,"de"))}}
function renderPicker(){const P=ui.pick,{recent,rest}=exList(P.q);const row=e=>`<button type="button" class="ov-row" data-pickex="${e.id}"><span style="flex:1;text-align:left"><b>${esc(e.name)}</b> <span class="small muted">${esc(e.equip)}</span></span><span class="accent">+</span></button>`;
  sheet(`<h2>${P.target==="swap"?"Austauschen gegen …":"Übung hinzufügen"}</h2><input class="inp" id="pickQ" placeholder="Suchen…" value="${esc(P.q)}" aria-label="Übung suchen">
    <div class="pick-list">${recent.length?`<div class="eyebrow" style="color:var(--faint)">Zuletzt genutzt</div>${recent.map(row).join("")}<div class="eyebrow" style="color:var(--faint)">Alle</div>`:""}${rest.map(row).join("")||'<p class="muted small">Nichts gefunden.</p>'}</div>
    <details class="fold"${!recent.length&&!rest.length?" open":""}><summary><b>Neue Übung anlegen</b><span class="small muted">landet automatisch in der Bibliothek</span></summary>${newExFields("pk",P.q)}<button class="btn primary full" type="button" data-act="picknew">Anlegen &amp; übernehmen</button></details>
    <button class="btn ghost full" type="button" data-act="close">Abbrechen</button>`)}
function newExFields(pre,name){const k=ui.nxKind||"Kraft";return `<div class="formgrid"><label class="full">Name<input class="inp" id="${pre}-name" value="${esc(name||"")}" placeholder="z. B. Hack Squat, Front Lever, Rudern"></label>
  <div class="full"><div class="small muted" style="margin-bottom:4px">Art der Übung</div><div class="seg" role="group" aria-label="Art der Übung">${["Kraft","Skill","Cardio"].map(x=>`<button type="button" data-nxkind="${x}" aria-pressed="${k===x}">${x}</button>`).join("")}</div>
    <div class="small muted" style="margin-top:4px">${k==="Cardio"?"Im Training wählst du Dauer, Intervall oder Sprints.":k==="Skill"?"Mit Gewicht × Wdh., als Leiter oder gehalten in Sekunden, je nach Plan.":"Mit Gewicht × Wdh., Aufwärmen und Rekorden."}</div></div>
  ${k==="Cardio"?`<input type="hidden" id="${pre}-equip" value="Ohne Gerät">`:`<label class="full">Gerät (für die Gewichtsschritte)<select class="inp" id="${pre}-equip">${["Langhantel","Trap Bar","Kurzhanteln","Kabel","Maschine","Dip-Gürtel","Körpergewicht"].map(x=>`<option${k==="Skill"&&x==="Körpergewicht"?" selected":""}>${x}</option>`).join("")}</select></label>
  <label class="check full"><input type="checkbox" id="${pre}-added"> Gewicht wird angehängt (z. B. Dips oder Klimmzüge mit Gürtel/Weste). Die App zeigt dann „+20 kg“.</label>
  <label class="check full"><input type="checkbox" id="${pre}-sided"> Links/rechts getrennt erfassen</label>`}</div>`}
function readNewEx(pre){const name=$(`#${pre}-name`).value.trim();if(!name){$(`#${pre}-name`).focus();return null}const eq=$(`#${pre}-equip`).value,kind=ui.nxKind||"Kraft",cb=id=>{const el=$(id);return !!(el&&el.checked)};
  const ex={id:uid("x"),name,kind,equip:eq,bar:eq==="Langhantel"?20:eq==="Trap Bar"?25:0,step:2.5,added:cb(`#${pre}-added`)||eq==="Dip-Gürtel",sided:cb(`#${pre}-sided`),bw:eq==="Körpergewicht",cardio:kind==="Cardio",max:{}};
  state.exercises.push(ex);ui.nxKind=null;return ex}
function addToUnit(unitId,exId){const L=listFor(unitId,true),ex=exById(exId);L.push(I(exId,ex.cardio?"duration":"normal",{base:lastWeight(exId)}));return L.length-1}
const lastWeight=id=>{const lo=lastOf(id);if(!lo||!lo.it.sets||!lo.it.sets.length)return 0;return Math.max(...lo.it.sets.map(x=>num(x.kg)||0))};

/* ---------- Plan-Übung bearbeiten ---------- */
function findUnit(uid_){for(const p of state.plans){const u=p.units.find(x=>x.id===uid_);if(u)return {plan:p,unit:u}}return {}}
function openEditor(unitId,k,isNew){ui.edit={unitId,k,isNew,d:JSON.parse(JSON.stringify(listFor(unitId,false)[k]))};renderEditor()}
function renderEditor(){const E=ui.edit,d=E.d,ex=exById(d.ex),{plan}=findUnit(E.unitId),c=cycById(plan.cycle);
  let h=`<h2>${esc(ex.name)}</h2><div class="formgrid">
    <label class="full">Format<select class="inp" id="ed-type">${Object.entries(FORMATS).map(([k,v])=>`<option value="${k}"${k===d.type?" selected":""}>${isCardio(k)?"Cardio: ":""}${v}${k==="normal"?" (kg × Wdh.)":k==="hold"?" (Sekunden)":""}</option>`).join("")}</select></label>`;
  if(d.type==="normal"){h+=`<label class="check full"><input type="checkbox" id="ed-prio"${d.prio?" checked":""}> <span><b>Prio-Übung</b><br><span class="small muted">${c?`Das Gewicht folgt dem Zyklus „${esc(c.name)}“.`:"Wirkt, sobald der Plan einen Zyklus hat."}</span></span></label>`;
    h+=d.prio&&c&&c.basis>0?(()=>{const m=getMax(ex,c.basis);return `<label class="full">${esc(rmLabel(c.basis))} (kg)<input class="inp num" id="ed-max" inputmode="decimal" value="${m&&!m.est?fmt(m.kg):""}" placeholder="${m?"≈ "+fmt(m.kg):"z. B. 100"}"></label>`})()
      :`<label class="full">Arbeitsgewicht (kg)<input class="inp num" id="ed-base" inputmode="decimal" value="${fmt(d.base||0)}"></label>`;
    h+=`</div><p class="muted small" style="margin:0">Aufwärmen, Sätze, Wiederholungen, Prozente und Pausen bestimmst du direkt im Training.</p>`}
  else if(isCardio(d.type)){if(d.type==="interval")h+=`<label>Runden<input class="inp num" id="ed-ivr" inputmode="numeric" value="${d.iv.rounds}"></label><label>Wert pro Runde<select class="inp" id="ed-ivm">${METRICS.map(([k,v])=>`<option value="${k}"${d.iv.metric===k?" selected":""}>${v}</option>`).join("")}</select></label><label>Belastung (s)<input class="inp num" id="ed-ivw" inputmode="numeric" value="${d.iv.work}"></label><label>Pause (s)<input class="inp num" id="ed-ivp" inputmode="numeric" value="${d.iv.rest}"></label>`;
    if(d.type==="sprint")h+=`<label>Anzahl<input class="inp num" id="ed-spn" inputmode="numeric" value="${d.sp.n}"></label><label>Strecke (m)<input class="inp num" id="ed-spd" inputmode="numeric" value="${d.sp.dist}"></label><label class="full">Pause<select class="inp" id="ed-spr">${restOpts(d.sp.rest)}</select></label>`;
    if(d.type==="duration")h+=`<label>Ziel-Dauer (min)<input class="inp num" id="ed-dum" inputmode="numeric" value="${d.du.min||""}" placeholder="optional"></label><label>Ziel-Distanz (km)<input class="inp num" id="ed-duk" inputmode="decimal" value="${d.du.km||""}" placeholder="optional"></label>`;
    h+=`</div><p class="muted small" style="margin:0">Das ist nur die Vorgabe. Im Training kannst du das Format und die Werte jederzeit ändern, z. B. statt Dauer heute Sprints.</p>`}
  else{if(d.type==="ladder")h+=`<label>Runden<input class="inp num" id="ed-rounds" inputmode="numeric" value="${d.rounds}"></label><label>Startstufe<input class="inp num" id="ed-top" inputmode="numeric" value="${d.top}"></label>`;
    if(d.type==="hold")h+=`<label>Sätze<input class="inp num" id="ed-n" inputmode="numeric" value="${d.hold.n}"></label><label>Sekunden<input class="inp num" id="ed-sec" value="${esc(String(d.hold.sec).replace("–","-"))}"></label>`;
    h+=`</div>`}
  h+=`<div class="err small" id="ed-err"></div><div class="row"><button class="btn danger" type="button" data-act="ed-del">${E.isNew?"Verwerfen":"Entfernen"}</button><button class="btn primary" style="flex:1" type="button" data-act="ed-save">Speichern</button></div>`;
  sheet(h)}
function readEditor(){const E=ui.edit,d=E.d,v=id=>{const el=$(id);return el?num(el.value):NaN};
  if(d.type==="normal"){d.prio=!!($("#ed-prio")&&$("#ed-prio").checked);if($("#ed-base")){const b=v("#ed-base");d.base=isNaN(b)?0:b}
    if($("#ed-max")){const m=v("#ed-max"),ex=exById(d.ex),c=cycById(findUnit(E.unitId).plan.cycle);ex.max=ex.max||{};if(!isNaN(m))ex.max[c.basis]=m}}
  if(d.type==="ladder"){d.rounds=Math.max(1,v("#ed-rounds")||1);d.top=Math.max(1,v("#ed-top")||1)}
  if(d.type==="hold")d.hold={n:Math.max(1,v("#ed-n")||1),sec:$("#ed-sec").value.replace("-","–")};
  if(d.type==="interval"){d.iv.rounds=Math.max(1,v("#ed-ivr")||1);d.iv.work=Math.max(5,v("#ed-ivw")||30);d.iv.rest=Math.max(0,v("#ed-ivp")||0);d.iv.metric=$("#ed-ivm").value;d.iv.custom=null}
  if(d.type==="sprint"){d.sp.n=Math.max(1,v("#ed-spn")||1);d.sp.dist=Math.max(1,v("#ed-spd")||60);d.sp.rest=+$("#ed-spr").value}
  if(d.type==="duration"){const m=v("#ed-dum"),k=v("#ed-duk");d.du={min:isNaN(m)?"":m,km:isNaN(k)?"":k}}
  return true}

/* ---------- Neuer Zyklus: Einheiten übernehmen, Testergebnisse als neue Maxima ---------- */
function nextCycleModal(pid){const p=planById(pid),c=cycById(p.cycle);const ids=[...new Set(p.units.flatMap(u=>u.items.filter(it=>it.prio).map(it=>it.ex)))];ui.ncPlan=pid;
  const start=p.finished?addDays(p.finished,1):addDays(planEnd(p),1);
  sheet(`<h2>Neuen Zyklus starten</h2><p class="muted small" style="margin:0">Einheiten und Übungen aus „${esc(p.name)}“ werden übernommen. Trag deine Ergebnisse aus der Testwoche ein. Sie werden die neuen ${esc(rmLabel(c.basis))}-Werte.</p>
    <div class="formgrid"><label class="full">Name<input class="inp" id="nc-name" value="${esc(p.name)} 2"></label><label class="full">Start<input class="inp" type="date" id="nc-start" value="${start}"></label></div>
    ${c.basis>0?`<div class="tablewrap"><table><thead><tr><th>Übung</th><th class="r">bisher</th><th class="r">neu</th></tr></thead><tbody>${ids.map(id=>{const e=exById(id),m=getMax(e,c.basis);return `<tr><td>${esc(e.name)}</td><td class="r num">${m?fmt(m.kg):"–"}</td><td class="r"><input class="inp num" style="width:80px" inputmode="decimal" data-ncmax="${id}" placeholder="${m?fmt(m.kg):""}" aria-label="neues Maximum ${esc(e.name)}"></td></tr>`}).join("")}</tbody></table></div>`:""}
    <div class="row"><button class="btn ghost" type="button" data-act="close">Abbrechen</button><button class="btn primary" style="flex:1" type="button" data-act="nc-save">Starten</button></div>`)}

/* ---------- Neuer Plan: Assistent ---------- */
function openWizard(fromId){const src=fromId&&state.plans.find(p=>p.id===fromId);const a=null;
  ui.wiz={step:1,d:{name:src?src.name+" (neu)":"",start:iso(new Date()),base:src?src.id:"",cycle:src?src.cycle:(a?a.cycle:""),newCyc:null,units:src?JSON.parse(JSON.stringify(src.units)):[],transfer:true}};renderWizard()}
const WSTEPS=["Name & Start","Zyklus","Einheiten","Übungen","Übersicht"];
function renderWizard(){const W=ui.wiz,d=W.d;let h=`<div class="wiz-steps">${WSTEPS.map((s,k)=>`<span class="${k+1===W.step?"cur":k+1<W.step?"done":""}">${k+1}</span>`).join("")}</div><div class="eyebrow">Schritt ${W.step} von 5</div><h2>${WSTEPS[W.step-1]}</h2>`;
  if(W.step===1)h+=`<div class="formgrid"><label class="full">Name des Plans<input class="inp" id="wz-name" value="${esc(d.name)}" placeholder="z. B. Plan Winter"></label>
    <label class="full">Startdatum<input class="inp" type="date" id="wz-start" value="${d.start}"></label>
    <label class="full">Grundlage<select class="inp" id="wz-base"><option value="">Leer starten</option>${state.plans.map(p=>`<option value="${p.id}"${d.base===p.id?" selected":""}>Einheiten aus „${esc(p.name)}“ übernehmen</option>`).join("")}</select></label></div>`;
  if(W.step===2){h+=`<p class="muted small" style="margin:0">Ein Zyklus steuert die Gewichte Woche für Woche. Ohne Zyklus trainierst du einfach mit deinem letzten Arbeitsgewicht weiter.</p><div class="stack" style="gap:6px">
    <label class="radio"><input type="radio" name="wzc" value=""${!d.cycle?" checked":""}><span><b>Kein Zyklus</b><span class="small muted">normal trainieren</span></span></label>
    ${state.cycles.map(c=>`<label class="radio"><input type="radio" name="wzc" value="${c.id}"${d.cycle===c.id?" checked":""}><span><b>${esc(c.name)}</b><span class="small muted">${c.weeks.length} Wochen · ${c.weeks.map(w=>w.pct+" %").join(" / ")} · Bezug ${esc(rmLabel(c.basis))}</span></span></label>`).join("")}
    <label class="radio"><input type="radio" name="wzc" value="__new"${d.cycle==="__new"?" checked":""}><span><b>Neuen Zyklus anlegen</b><span class="small muted">wird in der Bibliothek gespeichert</span></span></label></div>`;
    if(d.cycle==="__new"){const n=d.newCyc||(d.newCyc={name:"",basis:3,weeks:[{tag:"",pct:80},{tag:"",pct:90},{tag:"",pct:100}]});
      h+=`<div class="warmbox"><div class="formgrid"><label class="full">Name<input class="inp" id="wz-cname" value="${esc(n.name)}" placeholder="z. B. 4 Wochen Aufbau"></label>
        <label>Bezug<select class="inp" id="wz-cbasis">${[1,2,3,4,5,6,8,10,0].map(x=>`<option value="${x}"${n.basis===x?" selected":""}>${rmLabel(x)}</option>`).join("")}</select></label>
        <div><div class="small muted" style="margin-bottom:3px">Wochen</div><div class="stepper"><button type="button" data-wzw="-1" aria-label="Woche entfernen">−</button><input class="num" readonly value="${n.weeks.length}" aria-label="Wochen"><button type="button" data-wzw="1" aria-label="Woche hinzufügen">+</button></div></div></div>
        <div class="row wrap">${n.weeks.map((w,k)=>`<label class="small muted" style="display:flex;flex-direction:column;gap:2px">W${k+1}<input class="inp num" style="width:64px" data-wzp="${k}" value="${fmt(w.pct)}" aria-label="Woche ${k+1} Prozent"></label>`).join("")}</div></div>`}}
  if(W.step===3)h+=`<p class="muted small" style="margin:0">Trainingstage dieses Plans, z. B. Lower, Push, Pull.</p><div class="stack" style="gap:6px">${d.units.map((u,k)=>`<div class="row"><input class="inp" data-wzu="${k}" value="${esc(u.name)}" placeholder="Name der Einheit" aria-label="Einheit ${k+1}"><button class="icon-btn" type="button" data-wzudel="${k}" aria-label="Einheit entfernen">✕</button></div>`).join("")}</div><button class="btn" type="button" data-act="wz-addunit">+ Einheit</button>`;
  if(W.step===4)h+=`<p class="muted small" style="margin:0">Wähle pro Einheit die Übungen. Mit „Prio“ markierst du, für welche Übungen der Zyklus gilt. Alles andere entscheidest du im Training.</p>${d.units.map((u,ui_)=>`<div class="warmbox"><b class="wb-t">${esc(u.name||"Einheit "+(ui_+1))}</b>
    ${u.items.map((it,k)=>`<div class="row"><span style="flex:1">${esc(exById(it.ex).name)}</span><label class="check small"><input type="checkbox" data-wzprio="${ui_}:${k}"${it.prio?" checked":""}> Prio</label><select class="inp sel-sm" data-wztype="${ui_}:${k}" aria-label="Format">${Object.entries(FORMATS).map(([a,b])=>`<option value="${a}"${a===it.type?" selected":""}>${b}</option>`).join("")}</select><button class="icon-btn" type="button" data-wzidel="${ui_}:${k}" aria-label="entfernen">✕</button></div>`).join("")||'<span class="small muted">Noch keine Übungen.</span>'}
    <button class="btn sm" type="button" data-wzpick="${ui_}">+ Übung</button></div>`).join("")}`;
  if(W.step===5){const c=d.cycle==="__new"?d.newCyc:cycById(d.cycle);const end=c?addDays(d.start,c.weeks.length*7-1):null;const exIds=[...new Set(d.units.flatMap(u=>u.items.map(i=>i.ex)))].filter(id=>lastOf(id));
    h+=`<div class="tablewrap"><table><tbody><tr><td class="muted">Name</td><td>${esc(d.name)}</td></tr><tr><td class="muted">Zeitraum</td><td>${fmtD(d.start)} – ${end?fmtD(end):"offen"}</td></tr><tr><td class="muted">Zyklus</td><td>${c?esc(c.name||"Neuer Zyklus"):"kein Zyklus"}</td></tr>
      ${d.units.map(u=>`<tr><td class="muted">${esc(u.name)}</td><td>${u.items.length} Übungen</td></tr>`).join("")}</tbody></table></div>
      ${exIds.length?`<label class="check"><input type="checkbox" id="wz-transfer"${d.transfer?" checked":""}> Fortschritt übernehmen (${exIds.length} Übungen mit Verlauf)</label><p class="muted small" style="margin:0">Vorschläge und Maxima laufen weiter. Ohne Haken startet jede Übung ohne Vorschlag. Der alte Verlauf bleibt in jedem Fall erhalten.</p>`:""}
      <div class="note">Der Plan läuft zusätzlich zu deinen anderen aktiven Plänen.</div>`}
  h+=`<div class="err small" id="wz-err"></div><div class="row">${W.step>1?`<button class="btn" type="button" data-act="wz-back">Zurück</button>`:`<button class="btn ghost" type="button" data-act="close">Abbrechen</button>`}<button class="btn primary" style="flex:1" type="button" data-act="${W.step<5?"wz-next":"wz-save"}">${W.step<5?"Weiter":"Plan anlegen"}</button></div>`;
  sheet(h)}
function readWizard(){const W=ui.wiz,d=W.d,err=$("#wz-err");
  if(W.step===1){d.name=$("#wz-name").value.trim();d.start=$("#wz-start").value||d.start;const b=$("#wz-base").value;if(b!==d.base){d.base=b;d.units=b?JSON.parse(JSON.stringify(state.plans.find(p=>p.id===b).units)):[]}
    if(!d.name){err.textContent="Bitte gib dem Plan einen Namen.";return false}}
  if(W.step===2){const r=document.querySelector('input[name="wzc"]:checked');d.cycle=r?r.value:"";if(d.cycle==="__new"){const n=d.newCyc;if($("#wz-cname"))n.name=$("#wz-cname").value.trim()||"Neuer Zyklus"}}
  if(W.step===3){if(!d.units.length){err.textContent="Lege mindestens eine Einheit an.";return false}if(d.units.some(u=>!u.name.trim())){err.textContent="Jede Einheit braucht einen Namen.";return false}}
  if(W.step===4&&d.units.some(u=>!u.items.length)){err.textContent="Jede Einheit braucht mindestens eine Übung.";return false}
  return true}
function saveWizard(){const d=ui.wiz.d;let cid=d.cycle;
  if(cid==="__new"){cid=uid("c");state.cycles.push({id:cid,name:d.newCyc.name||"Neuer Zyklus",basis:d.newCyc.basis,weeks:d.newCyc.weeks})}
  const t=$("#wz-transfer");if(t&&!t.checked)d.units.forEach(u=>u.items.forEach(it=>it.base=0));
  state.plans.unshift({id:uid("p"),name:d.name,start:d.start,cycle:cid||"",status:"aktiv",week:0,done:{},units:cloneUnits(d.units)});
  closeSheet();ui.sess=null;markPending();render()}



/* ================= Bibliothek ================= */
function renderBibliothek(){const segs=[["uebungen","Übungen"],["zyklen","Zyklen"]];
  if(ui.libSeg==="einstellungen")return renderSettings();
  let h=`<header class="top"><div><div class="eyebrow">Bibliothek</div><h1>${segs.find(x=>x[0]===ui.libSeg)[1]}</h1></div><button type="button" class="gear" data-libseg="einstellungen" aria-label="Einstellungen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button></header>
    <div class="chips" role="group" aria-label="Rubrik">${segs.map(([k,v])=>`<button type="button" class="chip" data-libseg="${k}" aria-pressed="${ui.libSeg===k}">${v}</button>`).join("")}</div>`;
  if(ui.libSeg==="zyklen")return h+libCycles()+DEMO;
  return h+libExercises()+DEMO}
function usage(id){const u=[];state.plans.filter(p=>p.status==="aktiv").forEach(p=>p.units.forEach(un=>un.items.forEach(it=>{if(it.ex===id)u.push(`${badge(it)||'<span class="badge">Normal</span>'}<span class="small muted">${esc(un.name.replace("Full Body ",""))}</span>`)})));
  return u.length?`<div class="row wrap" style="margin-top:4px;gap:6px">${u.join("")}</div>`:`<div class="small muted" style="margin-top:4px">in keinem aktiven Plan</div>`}
function libExercises(){const {recent,rest}=exList(ui.libSearch);
  const row=e=>`<div class="lib-item"><div><b>${esc(e.name)}</b>${e.cardio?' <span class="badge cardio">Cardio</span>':e.kind==="Skill"?' <span class="badge ladder">Skill</span>':""}<div class="muted small">${esc(e.cardio?["Cardio: Dauer, Intervall oder Sprints"]:[e.equip,`Schritt ${fmt(stepOf(e))} kg`,e.added?"Gewicht angehängt":"",e.rack?`Rack ${e.rack}`:"",...Object.entries(e.max||{}).map(([n,v])=>`${n}RM ${fmt(v)} kg`),e.sided?"links/rechts":""].filter(Boolean).join(" · "))}</div>${usage(e.id)}</div>
      <button class="btn sm danger" type="button" data-del="${e.id}" aria-label="${esc(e.name)} löschen">Löschen</button></div>`;
  let h=`<div class="row" style="margin-bottom:8px"><input class="inp" id="libSearch" placeholder="Suchen…" value="${esc(ui.libSearch)}" aria-label="Übungen durchsuchen"><button class="btn primary" type="button" data-act="newex" style="white-space:nowrap">+ Neu</button></div>`;
  if(ui.newEx)h+=`<div class="card" style="margin-bottom:12px"><h3>Neue Übung</h3>${newExFields("nx","")}<div class="row"><button class="btn ghost" type="button" data-act="cancelex">Abbrechen</button><button class="btn primary" style="flex:1" type="button" data-act="saveex">Speichern</button></div></div>`;
  if(recent.length)h+=`<div class="section-title" style="margin-top:6px"><h3>Zuletzt genutzt</h3></div><div class="card" style="gap:0">${recent.map(row).join("")}</div>`;
  h+=`<div class="section-title"><h3>Alle (A–Z)</h3><span class="small muted">${state.exercises.filter(e=>!e.deleted).length}</span></div><div class="card" style="gap:0">${rest.map(row).join("")||'<p class="muted">Keine Übung gefunden.</p>'}</div>`;
  return h}
function libCycles(){let h=`<p class="muted small" style="margin:0 0 10px">Vorlagen für Periodisierung. Welcher Zyklus genutzt wird, wählst du beim Anlegen eines Plans.</p><div class="stack">`;
  state.cycles.forEach((c,ci)=>{h+=`<div class="card"><input class="inp" style="font-weight:600" data-cname="${ci}" value="${esc(c.name)}" aria-label="Name des Zyklus">
    <div class="formgrid"><label>Prozente beziehen sich auf<select class="inp" data-cbasis="${ci}">${[1,2,3,4,5,6,8,10,0].map(n=>`<option value="${n}"${c.basis===n?" selected":""}>${rmLabel(n)}</option>`).join("")}</select></label>
    <div><div class="small muted" style="margin-bottom:3px">Länge</div><div class="stepper"><button type="button" data-cweek="${ci}:-1" aria-label="Woche entfernen"${c.weeks.length<2?" disabled":""}>−</button><input class="num" value="${c.weeks.length} Wo." readonly aria-label="Wochen" style="width:70px"><button type="button" data-cweek="${ci}:1" aria-label="Woche hinzufügen">+</button></div></div>
    <div class="full small muted">Gilt für alle Übungen, die im Plan als Prio markiert sind.</div></div>
    <div class="tablewrap"><table><thead><tr><th>Woche</th><th>Phase</th><th class="r">Intensität</th></tr></thead><tbody>
    ${c.weeks.map((w,k)=>`<tr><td>W${k+1}</td><td><input class="inp" style="height:32px;min-width:100px" data-ctag="${ci}:${k}" value="${esc(w.tag)}" placeholder="optional"></td><td class="r" style="white-space:nowrap"><input class="inp num" style="width:64px" inputmode="decimal" data-cpct="${ci}:${k}" value="${fmt(w.pct)}"> %</td></tr>`).join("")}
    </tbody></table></div>${state.plans.some(p=>p.cycle===c.id)?"":`<button class="btn sm danger" type="button" data-cdel="${ci}" style="align-self:flex-end">Löschen</button>`}</div>`});
  return h+`</div><button class="btn full" type="button" data-act="newcyc" style="margin-top:12px">+ Zyklus anlegen</button>`}

function renderSettings(){const st=state.settings;
  let h=`<header class="top"><div><div class="eyebrow">Bibliothek</div><h1>Einstellungen</h1></div><button type="button" class="btn sm" data-libseg="uebungen">← Zurück</button></header>
   <p class="muted small" style="margin:0 0 12px">Das stellst du einmal ein und musst es danach selten wieder anfassen.</p>
   <div class="card" style="margin-bottom:12px"><h3>Konto &amp; Daten</h3><div class="small muted">Angemeldet als <b>${esc(SYNC.user?SYNC.user.email:"")}</b></div>
     <div class="small">Status: <b>${esc(SYNC_TXT[SYNC.status])}</b>${SYNC.lastSync?` · zuletzt ${SYNC.lastSync.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}`:""}</div>${SYNC.lastError?`<div class="err small">${esc(SYNC.lastError)}</div>`:""}
     <div class="row wrap"><button class="btn sm" type="button" data-act="syncnow">Jetzt synchronisieren</button><button class="btn sm" type="button" data-act="backup">Backup herunterladen</button><button class="btn sm danger" type="button" data-act="logout">Abmelden</button></div>
     <p class="muted small" style="margin:0">Alles wird zuerst auf dem iPhone gespeichert und automatisch mit Supabase abgeglichen, sobald du Internet hast.</p></div>
   <details class="card fold" open><summary><h3>Ausführungsstile</h3><span class="small muted">${state.styles.length}</span></summary><div class="row wrap">${state.styles.map((s,j)=>`<span class="pill-edit">${esc(s)}${j?`<button type="button" data-stdel="${j}" aria-label="${esc(s)} entfernen">✕</button>`:""}</span>`).join("")}</div>
     <div class="row"><input class="inp" id="newStyle" placeholder="z. B. Cluster"><button class="btn sm" type="button" data-act="addstyle">Hinzufügen</button></div></details>
   <details class="card fold"><summary><h3>Scheiben &amp; Rundung</h3></summary><p class="muted small" style="margin:0">Langhantel und Trap Bar gehen in Schritten der kleinsten Scheibe × 2, der Gürtel in Schritten der kleinsten Scheibe.</p>
     <input class="inp num" id="setPlates" value="${esc(st.plates.map(fmt).join("; "))}" aria-label="Scheiben in kg"><div class="err small" id="plateErr"></div>
     <select class="inp" id="setRound" aria-label="Rundung">${[["down","Abrunden (nie schwerer als geplant)"],["nearest","Auf nächstes Gewicht"],["up","Aufrunden"]].map(([k,v])=>`<option value="${k}"${st.rounding===k?" selected":""}>${v}</option>`).join("")}</select></details>
   <details class="card fold"><summary><h3>Erfassung</h3></summary><label class="small muted">Anstrengung<select class="inp" id="setEffort">${[["RIR","RIR (Wiederholungen in Reserve)"],["RPE","RPE (6–10)"],["none","Gar nicht"]].map(([k,v])=>`<option value="${k}"${st.effort===k?" selected":""}>${v}</option>`).join("")}</select></label>
     <label class="small muted">1RM-Schätzung<select class="inp" id="setE1">${[["epley","Epley"],["brzycki","Brzycki"]].map(([k,v])=>`<option value="${k}"${st.e1rm===k?" selected":""}>${v}</option>`).join("")}</select></label>
     <label class="small muted">Signale im Intervall-Timer<select class="inp" id="setSound">${[["both","Ton & Sprache"],["beep","Nur Ton"],["voice","Nur Sprache"],["off","Aus"]].map(([k,v])=>`<option value="${k}"${st.sound===k?" selected":""}>${v}</option>`).join("")}</select></label>
     <button class="btn sm" type="button" data-act="soundtest">Signal testen</button>
     <label class="small muted">Körpergewicht (kg)<input class="inp num" id="setBw" inputmode="decimal" value="${fmt(st.bodyweight)}"></label></details>`;
  return h+DEMO}


/* ================= Fortschritt: schwerstes Gewicht über die Zeit ================= */
const RANGES=[["1M",30],["3M",91],["6M",182],["1J",365],["Alles",0]];
const weekKey=s=>{const d=D(s);const day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);return iso(d)};
/* Pro Training: schwerster Satz (bei gleichem Gewicht der mit mehr Wdh.) */
function exSessions(id){const ex=exById(id),bw=ui.withBw&&(ex.added||ex.bw)?state.settings.bodyweight:0;const out=[];
  state.log.forEach(l=>l.items.forEach(it=>{if(it.ex!==id||!it.sets||!it.sets.length)return;let top=null;
    it.sets.forEach(x=>{if(x.sec)return;const kg=num(x.kg)+bw,r=num(x.reps)+num(x.part||0);if(!top||kg>top.kg||(kg===top.kg&&r>top.reps))top={kg,reps:r}});
    if(top)out.push({date:l.date,unit:l.unit,light:!!l.light,extra:!!l.extra,kg:top.kg,reps:top.reps,sets:it.sets,ex})}));
  return out.sort((a,b)=>a.date.localeCompare(b.date))}
const better=(a,b)=>!b||a.kg>b.kg||(a.kg===b.kg&&a.reps>b.reps);
function progressData(id){const all=exSessions(id);if(!all.length)return null;const today=iso(new Date());const r=RANGES.find(x=>x[0]===ui.range);
  const from=ui.range==="from"&&ui.from?ui.from:r&&r[1]?addDays(today,-r[1]):all[0].date;
  const pts=all.filter(p=>p.date>=from);const weeks={};pts.filter(p=>!p.light).forEach(p=>{const k=weekKey(p.date);if(better(p,weeks[k]))weeks[k]={...p,wk:k}});
  const trend=Object.values(weeks).sort((a,b)=>a.wk.localeCompare(b.wk));let pr=null;all.forEach(p=>{if(!p.light&&better(p,pr))pr=p});
  return {all,pts,trend,pr,from,to:today}}
function verdict(trend){if(trend.length<2)return {cls:"muted",txt:"Noch zu wenig Daten",d:""};const a=trend[0],b=trend[trend.length-1],dk=b.kg-a.kg,pct=a.kg?dk/a.kg*100:0;
  if(Math.abs(pct)<2.5&&dk===0){const dr=b.reps-a.reps;if(dr>0)return {cls:"good",txt:"Stärker geworden",d:`gleiches Gewicht, +${fmt(dr)} Wdh.`};if(dr<0)return {cls:"bad",txt:"Schwächer geworden",d:`gleiches Gewicht, ${fmt(dr)} Wdh.`};return {cls:"flat",txt:"Stagniert",d:"±0 kg"}}
  if(pct>=2.5||(dk>0&&a.kg===0))return {cls:"good",txt:"Stärker geworden",d:`+${fmt(dk)} kg${a.kg?` (+${fmt(Math.round(pct*10)/10)} %)`:""}`};
  if(pct<=-2.5)return {cls:"bad",txt:"Schwächer geworden",d:`${fmt(dk)} kg (${fmt(Math.round(pct*10)/10)} %)`};
  return {cls:"flat",txt:"Stagniert",d:`${dk>=0?"+":""}${fmt(dk)} kg`}}
function renderFortschritt(){const ids=[...new Set(state.log.slice().reverse().flatMap(l=>l.items.filter(i=>(i.sets&&i.sets.length)||i.cardio).map(i=>i.ex)))].filter(exById);
  if(ids.length&&!ids.includes(ui.progEx))ui.progEx=ids[0];if(ids.length&&state.log.some(l=>l.items.some(i=>i.ex===ui.progEx&&i.cardio)))return renderCardioProgress(ids);
  if(!ids.includes(ui.progEx))ui.progEx=ids[0];ui.range=ui.range||"Alles";
  let h=`<header class="top"><div><div class="eyebrow">Schwerstes Gewicht über die Zeit</div><h1>Fortschritt</h1></div>${syncPill()}</header>`;
  if(!ids.length)return h+`<p class="muted">Noch keine Trainings gespeichert.</p>`+DEMO;
  const ex=exById(ui.progEx),P=progressData(ui.progEx),v=verdict(P.trend),last=P.trend[P.trend.length-1]||P.pts[P.pts.length-1];
  const mk=Object.keys(ex.max||{})[0],anchor=mk?{n:mk,kg:ex.max[mk]+(ui.withBw&&(ex.added||ex.bw)?state.settings.bodyweight:0)}:null;
  const plus=(ex.added||ex.bw)&&!ui.withBw?"+":"";const U=k=>`${plus}${fmt(k)} kg`;
  h+=`<select class="inp" id="progSel" aria-label="Übung" style="margin-bottom:10px">${ids.map(id=>`<option value="${id}"${id===ui.progEx?" selected":""}>${esc(exById(id).name)}</option>`).join("")}</select>
    <div class="hero"><div class="hero-v num">${last?U(last.kg):"–"}<small>${last?` × ${fmt(last.reps)}`:""}</small></div>
      <div class="hero-d ${v.cls}"><b>${esc(v.txt)}</b> ${esc(v.d)}</div><div class="small muted">${ui.range==="from"?"seit "+fmtD(P.from):ui.range==="Alles"?"seit dem ersten Eintrag":"in den letzten "+({"1M":"4 Wochen","3M":"3 Monaten","6M":"6 Monaten","1J":"12 Monaten"})[ui.range]}</div></div>
    <div class="ranges" role="group" aria-label="Zeitraum">${RANGES.map(([k])=>`<button type="button" data-range="${k}" aria-pressed="${ui.range===k}">${k}</button>`).join("")}<label class="from${ui.range==="from"?" on":""}">ab<input type="date" id="rangeFrom" value="${ui.from||P.all[0].date}"></label></div>
    <div class="card chartcard"><div class="legend"><span><i style="background:var(--s1)"></i>Beste Leistung pro Woche</span><span><i class="dot"></i>Einzelnes Training</span>${anchor?`<span><i class="dash"></i>${esc(anchor.n)}RM hinterlegt</span>`:""}</div><div class="chart" id="chartLine"></div></div>
    <div class="kpis" style="margin-top:12px"><div class="kpi"><div class="l">Rekord (schwerstes Gewicht)</div><div class="v num">${P.pr?U(P.pr.kg):"–"} <span class="small muted">× ${P.pr?fmt(P.pr.reps):""}</span></div><div class="small muted">${P.pr?fmtD(P.pr.date):""}</div></div>
      <div class="kpi"><div class="l">Anker: ${anchor?esc(anchor.n)+"RM hinterlegt":"kein Maximum"}</div><div class="v num">${anchor?U(anchor.kg):"–"}</div><div class="small muted">${anchor&&P.pr?(P.pr.kg>=anchor.kg?"Rekord liegt darüber":`noch ${fmt(anchor.kg-P.pr.kg)} kg bis dahin`):"in der Bibliothek eintragen"}</div></div></div>`;
  if(ex.added||ex.bw)h+=`<label class="check" style="margin-top:10px"><input type="checkbox" id="withBw"${ui.withBw?" checked":""}> Körpergewicht einrechnen (${fmt(state.settings.bodyweight)} kg)</label>`;
  h+=freqHtml(ui.progEx,P.from);
  h+=`<div class="section-title"><h3>Alle Trainings</h3><span class="small muted">${pl(P.pts.length,"Eintrag","Einträge")}</span></div><div class="card" style="gap:0">${P.pts.slice().reverse().map(p=>`<div class="lib-item"><div><b class="num">${U(p.kg)} × ${fmt(p.reps)}</b>${p===P.pr?' <span class="badge good-b">Rekord</span>':""}${p.light?' <span class="badge">leicht</span>':""}<div class="small muted">${fmtD(p.date)} · ${esc(p.unit)}${p.extra?" (zusätzlich)":""}</div><div class="small muted num">${esc(p.sets.map(x=>logSetTxt(ex,x)).join(" · "))}</div></div></div>`).join("")}</div>
    <p class="muted small">Leichte Technik-Einheiten erscheinen als hohle Punkte und zählen nicht für den Trend. Pro Woche zählt das schwerste Gewicht, bei gleichem Gewicht die meisten Wiederholungen.</p>`;
  return h+DEMO}
function drawCharts(){const L=$("#chartLine");if(!L)return;if(state.log.some(l=>l.items.some(i=>i.ex===ui.progEx&&i.cardio)))return drawCardio();const ex=exById(ui.progEx),P=progressData(ui.progEx);if(!P)return;
  const mk=Object.keys(ex.max||{})[0],anchor=mk?ex.max[mk]+(ui.withBw&&(ex.added||ex.bw)?state.settings.bodyweight:0):null;
  const W=Math.max(280,L.clientWidth),Ht=210,pad={l:40,r:16,t:16,b:26},iw=W-pad.l-pad.r,ih=Ht-pad.t-pad.b;
  const t0=D(P.from).getTime()-864e5*2,t1=Math.max(D(P.to).getTime(),t0+864e5*7);
  const xs=s=>pad.l+((D(s).getTime()-t0)/(t1-t0))*iw;
  const vals=[...P.pts.map(p=>p.kg),...(anchor!=null?[anchor]:[])];if(!vals.length){L.innerHTML='<p class="muted small">Keine Einträge im Zeitraum.</p>';return}
  let lo=Math.min(...vals),hi=Math.max(...vals);const sp=hi-lo||10;lo=Math.max(0,Math.floor((lo-sp*.2)/5)*5);hi=Math.ceil((hi+sp*.15)/5)*5;if(hi===lo)hi=lo+10;
  const ys=v=>pad.t+ih-(v-lo)/(hi-lo)*ih;const ticks=niceTicks(lo,hi,4);
  const months=[];{const d=D(iso(new Date(t0)));d.setDate(1);while(d.getTime()<=t1){if(d.getTime()>=t0)months.push(iso(d));d.setMonth(d.getMonth()+1)}}
  const tr=P.trend,path=tr.map((p,j)=>`${j?"L":"M"}${xs(p.date).toFixed(1)},${ys(p.kg).toFixed(1)}`).join("");
  const area=tr.length>1?path+`L${xs(tr[tr.length-1].date)},${pad.t+ih}L${xs(tr[0].date)},${pad.t+ih}Z`:"";
  L.innerHTML=`<svg viewBox="0 0 ${W} ${Ht}" height="${Ht}" role="img" aria-label="Schwerstes Gewicht über die Zeit">
    ${ticks.filter(t=>t>=lo&&t<=hi).map(t=>`<line x1="${pad.l}" x2="${W-pad.r}" y1="${ys(t)}" y2="${ys(t)}" stroke="rgba(244,242,235,.08)"/><text x="${pad.l-6}" y="${ys(t)+4}" text-anchor="end">${fmt(t)}</text>`).join("")}
    ${months.map(m=>`<text x="${xs(m)}" y="${Ht-8}" text-anchor="middle">${D(m).toLocaleDateString("de-DE",{month:"short"})}</text>`).join("")}
    ${anchor!=null&&anchor>=lo&&anchor<=hi?`<line x1="${pad.l}" x2="${W-pad.r}" y1="${ys(anchor)}" y2="${ys(anchor)}" stroke="#f4f1ea" stroke-opacity=".55" stroke-dasharray="5 4"/><text x="${W-pad.r}" y="${ys(anchor)-5}" text-anchor="end" style="fill:#f4f1ea">${esc(mk)}RM ${fmt(anchor)}</text>`:""}
    ${area?`<path d="${area}" fill="#ff572c" opacity=".12"/>`:""}<path d="${path}" fill="none" stroke="#ff572c" stroke-width="2" stroke-linejoin="round"/>
    ${P.pts.map(p=>`<circle cx="${xs(p.date)}" cy="${ys(p.kg)}" r="3.5" fill="${p.light?"#151515":"rgba(244,242,235,.55)"}" stroke="${p.light?"rgba(244,242,235,.6)":"none"}" stroke-width="1.5"/>`).join("")}
    ${tr.map(p=>`<circle cx="${xs(p.date)}" cy="${ys(p.kg)}" r="4.5" fill="#ff572c" stroke="#151515" stroke-width="2"/>`).join("")}
    ${P.pr&&P.pr.date>=P.from?`<circle cx="${xs(P.pr.date)}" cy="${ys(P.pr.kg)}" r="9" fill="none" stroke="#3fb97a" stroke-width="2"/><text x="${Math.min(xs(P.pr.date),W-pad.r-30)}" y="${anchor!=null&&Math.abs(ys(P.pr.kg)-ys(anchor))<22?ys(P.pr.kg)+24:ys(P.pr.kg)-14}" text-anchor="middle" style="fill:#3fb97a;font-weight:600">Rekord</text>`:""}
    <line id="xh" x1="0" x2="0" y1="${pad.t}" y2="${pad.t+ih}" stroke="rgba(244,242,235,.35)" stroke-dasharray="3 3" style="display:none"/>
    <rect x="${pad.l}" y="0" width="${iw}" height="${Ht}" fill="transparent" id="hitL"/></svg><div class="tip" id="tipL"></div>`;
  const hit=$("#hitL"),tip=$("#tipL"),xh=$("#xh"),plus=(ex.added||ex.bw)&&!ui.withBw?"+":"";
  const move=ev=>{if(!P.pts.length)return;const r=L.getBoundingClientRect(),x=(ev.clientX-r.left)*(W/r.width);let b=P.pts[0];P.pts.forEach(p=>{if(Math.abs(xs(p.date)-x)<Math.abs(xs(b.date)-x))b=p});
    xh.setAttribute("x1",xs(b.date));xh.setAttribute("x2",xs(b.date));xh.style.display="";tip.innerHTML="";
    const a=document.createElement("div");a.textContent=`${fmtD(b.date)} · ${b.unit}`;a.style.color="var(--muted)";const c=document.createElement("b");c.textContent=`${plus}${fmt(b.kg)} kg × ${fmt(b.reps)}`;
    tip.appendChild(a);tip.appendChild(c);if(b.light){const l=document.createElement("div");l.textContent="leichte Einheit";l.style.color="var(--muted)";tip.appendChild(l)}
    tip.style.display="block";const px=xs(b.date)*(r.width/W);tip.style.left=Math.min(Math.max(px-70,0),r.width-150)+"px";tip.style.top="0px"};
  hit.addEventListener("pointermove",move);hit.addEventListener("pointerdown",move);hit.addEventListener("pointerleave",()=>{tip.style.display="none";xh.style.display="none"})}
function niceTicks(lo,hi,n){const raw=(hi-lo)/n,mag=Math.pow(10,Math.floor(Math.log10(raw))),step=[1,2,2.5,5,10].map(m=>m*mag).find(s=>s>=raw);
  const out=[];for(let v=Math.ceil(lo/step)*step;v<=hi+1e-9;v+=step)out.push(Math.round(v*100)/100);return out}

/* ---------- Cardio-Fortschritt ---------- */
const CF={duration:{lbl:"Pace",low:true,f:v=>mmss(v)+" /km"},sprint:{lbl:"Bestzeit",low:true,f:v=>fmt(Math.round(v*100)/100)+" s"},interval:{lbl:"Summe pro Training",low:false,f:(v,m)=>fmt(v)+(m?" "+m:" Runden")}};
function cardioPts(id){const out=[];state.log.forEach(l=>l.items.forEach(it=>{if(it.ex!==id||!it.cardio)return;const c=it.cardio;let v=null;
  if(c.fmt==="duration"&&num(c.dur.km)>0&&c.dur.sec>0)v=c.dur.sec/num(c.dur.km);
  if(c.fmt==="sprint"){const t=(c.sprints||[]).filter(s=>s.done&&num(s.sec)>0).map(s=>num(s.sec));if(t.length)v=Math.min(...t)}
  if(c.fmt==="interval"){const vals=(c.rounds||[]).map(r=>num(r.val)).filter(x=>!isNaN(x));v=vals.length?vals.reduce((a,b)=>a+b,0):(c.rounds||[]).length}
  if(v!=null)out.push({date:l.date,unit:l.unit,fmt:c.fmt,v,c,light:!!l.light})}));return out.sort((a,b)=>a.date.localeCompare(b.date))}
function renderCardioProgress(ids){const ex=exById(ui.progEx),all=cardioPts(ui.progEx),fmts=[...new Set(all.map(p=>p.fmt))];if(!fmts.includes(ui.cfmt))ui.cfmt=fmts[fmts.length-1];
  const M=CF[ui.cfmt],metric=(all.find(p=>p.fmt==="interval")||{c:{iv:{}}}).c.iv.metric||"";const today=iso(new Date()),r=RANGES.find(x=>x[0]===ui.range);
  const from=ui.range==="from"&&ui.from?ui.from:r&&r[1]?addDays(today,-r[1]):(all[0]||{date:today}).date;const pts=all.filter(p=>p.fmt===ui.cfmt&&p.date>=from);
  const a=pts[0],b=pts[pts.length-1];let v={cls:"muted",txt:"Noch zu wenig Daten",d:""};
  if(pts.length>1){const ch=(b.v-a.v)/a.v*100*(M.low?-1:1);v=Math.abs(ch)<2.5?{cls:"flat",txt:"Stagniert",d:""}:ch>0?{cls:"good",txt:"Besser geworden",d:`${M.low?"":"+"}${M.f(Math.abs(b.v-a.v),metric)} ${M.low?"schneller":""} (${fmt(Math.round(Math.abs(ch)*10)/10)} %)`}:{cls:"bad",txt:"Schlechter geworden",d:`(${fmt(Math.round(Math.abs(ch)*10)/10)} %)`}}
  const best=pts.reduce((x,p)=>!x||(M.low?p.v<x.v:p.v>x.v)?p:x,null);
  let h=`<header class="top"><div><div class="eyebrow">Cardio</div><h1>Fortschritt</h1></div>${syncPill()}</header>
    <select class="inp" id="progSel" aria-label="Übung" style="margin-bottom:10px">${ids.map(id=>`<option value="${id}"${id===ui.progEx?" selected":""}>${esc(exById(id).name)}</option>`).join("")}</select>
    ${fmts.length>1?`<div class="seg" role="group" aria-label="Format" style="margin-bottom:10px">${fmts.map(f=>`<button type="button" data-cpf="${f}" aria-pressed="${f===ui.cfmt}">${CARDIO[f]}</button>`).join("")}</div>`:""}
    <div class="hero"><div class="small muted">${esc(M.lbl)}${M.low?" · niedriger ist besser":""}</div><div class="hero-v num">${b?esc(M.f(b.v,metric)):"–"}</div><div class="hero-d ${v.cls}"><b>${esc(v.txt)}</b> ${esc(v.d)}</div></div>
    <div class="ranges" role="group" aria-label="Zeitraum">${RANGES.map(([k])=>`<button type="button" data-range="${k}" aria-pressed="${ui.range===k}">${k}</button>`).join("")}</div>
    <div class="card chartcard"><div class="chart" id="chartLine"></div></div>
    <div class="kpis" style="margin-top:12px"><div class="kpi"><div class="l">Bester Wert</div><div class="v num">${best?esc(M.f(best.v,metric)):"–"}</div><div class="small muted">${best?fmtD(best.date):""}</div></div><div class="kpi"><div class="l">Trainings im Zeitraum</div><div class="v num">${pts.length}</div></div></div>
    ${freqHtml(ui.progEx,from)}
    <div class="section-title"><h3>Alle Einträge</h3></div><div class="card" style="gap:0">${pts.slice().reverse().map(p=>`<div class="lib-item"><div><b class="num">${esc(M.f(p.v,metric))}</b>${p===best?' <span class="badge good-b">Bestwert</span>':""}<div class="small muted">${fmtD(p.date)} · ${esc(p.unit)}</div><div class="small muted num">${esc(cardioTxt(p.c))}</div></div></div>`).join("")||'<p class="muted small">Keine Einträge im Zeitraum.</p>'}</div>`;
  ui.cpts={pts,M,metric,from,best};return h+DEMO}
function drawCardio(){const L=$("#chartLine");if(!L||!ui.cpts)return;const {pts,M,metric,from,best}=ui.cpts;if(!pts.length){L.innerHTML='<p class="muted small">Keine Einträge im Zeitraum.</p>';return}
  const W=Math.max(280,L.clientWidth),Ht=190,pad={l:48,r:16,t:16,b:26},iw=W-pad.l-pad.r,ih=Ht-pad.t-pad.b;const t0=D(from).getTime()-864e5*2,t1=Math.max(D(iso(new Date())).getTime(),t0+864e5*7);
  const xs=s=>pad.l+((D(s).getTime()-t0)/(t1-t0))*iw;let lo=Math.min(...pts.map(p=>p.v)),hi=Math.max(...pts.map(p=>p.v));const sp=hi-lo||Math.max(1,hi*.1);lo=lo-sp*.25;hi=hi+sp*.25;
  const ys=v=>pad.t+ih-(v-lo)/(hi-lo)*ih;const tk=[lo+(hi-lo)*.15,lo+(hi-lo)*.5,lo+(hi-lo)*.85];
  const path=pts.map((p,j)=>`${j?"L":"M"}${xs(p.date).toFixed(1)},${ys(p.v).toFixed(1)}`).join("");
  L.innerHTML=`<svg viewBox="0 0 ${W} ${Ht}" height="${Ht}" role="img" aria-label="${esc(M.lbl)} über die Zeit">${tk.map(t=>`<line x1="${pad.l}" x2="${W-pad.r}" y1="${ys(t)}" y2="${ys(t)}" stroke="rgba(244,242,235,.08)"/><text x="${pad.l-6}" y="${ys(t)+4}" text-anchor="end">${esc(M.f(t,"").replace(" /km","").replace(" s","").replace(" Runden",""))}</text>`).join("")}
    <path d="${path}" fill="none" stroke="#ff572c" stroke-width="2" stroke-linejoin="round"/>${pts.map(p=>`<circle cx="${xs(p.date)}" cy="${ys(p.v)}" r="4.5" fill="#ff572c" stroke="#151515" stroke-width="2"/><text x="${xs(p.date)}" y="${Ht-8}" text-anchor="middle">${fmtD(p.date).slice(0,5)}</text>`).join("")}
    ${best?`<circle cx="${xs(best.date)}" cy="${ys(best.v)}" r="9" fill="none" stroke="#3fb97a" stroke-width="2"/>`:""}</svg>`}

/* ---------- Häufigkeit: wie oft im Zeitraum trainiert ---------- */
const hasEx=(it,id)=>it.ex===id&&((it.sets&&it.sets.length)||it.cardio);
function freqHtml(id,from){const today=iso(new Date());const logs=state.log.filter(l=>l.date>=from&&l.date<=today&&l.items.some(it=>hasEx(it,id)));
  const n=logs.length,sets=logs.reduce((a,l)=>a+l.items.filter(it=>hasEx(it,id)).reduce((b,it)=>b+(it.cardio?(it.cardio.rounds||[]).length+(it.cardio.sprints||[]).length||1:it.sets.length),0),0);
  const weeks=Math.max(1,Math.round((D(today)-D(from))/864e5/7*10)/10),avg=n/weeks;
  const wk={};let k=weekKey(from);while(k<=today){wk[k]=0;k=addDays(k,7)}logs.forEach(l=>{const w=weekKey(l.date);if(w in wk)wk[w]++});
  const arr=Object.entries(wk),mx=Math.max(1,...arr.map(x=>x[1]));const last=logs.length?logs[logs.length-1].date:null;const since=last?Math.round((D(today)-D(last))/864e5):null;
  const ex=exById(id);
  let h=`<div class="section-title"><h3>Häufigkeit</h3><span class="small muted">im gewählten Zeitraum</span></div>
    <div class="kpis"><div class="kpi"><div class="l">${esc(ex.name)} gemacht</div><div class="v num">${n}×</div><div class="small muted">Ø ${fmt(Math.round(avg*10)/10)}× pro Woche</div></div>
    <div class="kpi"><div class="l">${ex.cardio?"Runden / Sprints / Einheiten":"Arbeitssätze"}</div><div class="v num">${sets}</div><div class="small muted">${last?`zuletzt ${since===0?"heute":since===1?"gestern":"vor "+since+" Tagen"}`:"noch nie"}</div></div></div>
    ${arr.length>1?`<div class="card freq"><div class="small muted">Trainings pro Woche</div><div class="fbars">${arr.slice(-26).map(([w,c])=>`<div class="fb" title="Woche ab ${fmtD(w)}: ${c}×"><i style="height:${c?Math.max(12,c/mx*100):3}%" class="${c?"":"zero"}"></i><span>${c||""}</span></div>`).join("")}</div><div class="row between small muted"><span>${fmtD(arr[Math.max(0,arr.length-26)][0]).slice(0,6)}</span><span>diese Woche</span></div></div>`:""}`;
  /* alle Übungen im Zeitraum, nach Häufigkeit */
  const cnt={};state.log.filter(l=>l.date>=from&&l.date<=today).forEach(l=>{const seen=new Set();l.items.forEach(it=>{if(((it.sets&&it.sets.length)||it.cardio)&&!seen.has(it.ex)){seen.add(it.ex);cnt[it.ex]=(cnt[it.ex]||0)+1}})});
  const top=Object.entries(cnt).filter(([e])=>exById(e)).sort((a,b)=>b[1]-a[1]);const tm=Math.max(1,...top.map(x=>x[1]));
  if(top.length)h+=`<details class="card fold"${ui.freqOpen?" open":""} data-freqfold><summary><h3>Alle Übungen im Zeitraum</h3><span class="small muted">${top.length}</span></summary>
    <div class="stack" style="gap:4px">${top.map(([e,c])=>`<button type="button" class="freqrow${e===id?" cur":""}" data-pex="${e}"><span class="fname">${esc(exById(e).name)}</span><span class="fline"><i style="width:${c/tm*100}%"></i></span><b class="num">${c}×</b></button>`).join("")}</div></details>`;
  return h}


/* ================= Router & Events ================= */
const TABS=["training","plaene","uebungen","fortschritt"];
function current(){const h=location.hash.slice(1);return TABS.includes(h)?h:"training"}
function render(){if(!SYNC.user)return;const tab=current();
  $("#app").innerHTML=tab==="training"?renderTraining():tab==="plaene"?renderPlaene():tab==="uebungen"?renderBibliothek():renderFortschritt();
  document.querySelectorAll("nav.tabs a").forEach(a=>{if(a.dataset.tab===tab)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
  if(tab==="fortschritt")requestAnimationFrame(drawCharts);saveLocal()}
function keepScroll(fn){const y=window.scrollY;fn&&fn();render();window.scrollTo(0,y)}
window.addEventListener("hashchange",()=>{render();window.scrollTo(0,0)});
window.addEventListener("resize",()=>{if(current()==="fortschritt")drawCharts()});
const confirmBtn=b=>{if(b.dataset.confirm==="1")return true;b.dataset.confirm="1";b.textContent="Sicher?";return false};
const setTarget=()=>{const S=curS();return S.editIdx!=null?S.sets[S.editIdx]:S.draft};
function backFromSheet(){ui.histSheet=null;if(ui.pick&&ui.pick.target==="wiz"){ui.pick=null;return renderWizard()}
  if(ui.edit&&ui.edit.isNew){listFor(ui.edit.unitId,true).splice(ui.edit.k,1)}closeSheet();keepScroll()}
function pickDone(exId){const P=ui.pick;ui.pick=null;
  if(P.target==="wiz"){ui.wiz.d.units[P.unitIdx].items.push(I(exId,"normal",{base:lastWeight(exId)}));return renderWizard()}
  if(P.target==="swap"){const old=curItem();const it=JSON.parse(JSON.stringify(old));it.ex=exId;it.base=lastWeight(exId);it._swapped=true;ui.sess.list[ui.sess.idx]=it;ui.sess.st[ui.sess.idx]=null;if(ui.sess.extra||ui.sess.free){render();return closeSheet()}return swapAsk("swap")}
  if(P.target==="add"){const it=I(exId,exById(exId).cardio?"duration":"normal",{base:lastWeight(exId)});it._added=true;ui.sess.list.push(it);ui.sess.idx=ui.sess.list.length-1;if(ui.sess.extra||ui.sess.free){closeSheet();return render()}return swapAsk("add")}
  const k=addToUnit(P.unitId,exId);ui.openUnit=P.unitId;openEditor(P.unitId,k,true)}
/* Pause wählen und starten; der nächste Satz wird schon angezeigt */
function chooseRest(sec){const item=curItem(),S=curS(),ex=exById(item.ex);
  if(item.type==="ladder"){S.phase="ladder";if(sec)startTimer(sec,`Pause · ${ex.name}`);return keepScroll()}
  const tr=$("#trInp");if(tr&&tr.value.trim())S.draft.tr=tr.value.trim().replace("-","–");
  S.draft.ready=true;if(S.draft.kind==="S"&&S.sets.length)S.lastRest=sec||S.lastRest;
  if(sec){S.resting=true;startTimer(sec,`Pause · ${ex.name}`,()=>{if(S.resting){S.resting=false;if(current()==="training"&&ui.sess)keepScroll()}})}
  keepScroll()}

document.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const d=b.dataset,a=d.act;
  /* --- Training --- */
  if(d.start){const [pid,uid_]=d.start.split(":");const unit=planById(pid).units.find(u=>u.id===uid_);
    const wk=twOf(planById(pid));ui.sess={planId:pid,unitId:uid_,week:wk,idx:0,list:viewItems(planById(pid),unit,wk).map((it,k)=>({...JSON.parse(JSON.stringify(it)),_k:k})),st:[],feel:null,note:""};render();return window.scrollTo(0,0)}
  if(d.work){const S=curS(),ex=exById(curItem().ex);S.work=Math.max(ex.bar||0,S.work+(+d.work)*stepOf(ex));return keepScroll()}
  if(d.step){const S=curS();S.next=d.step==="warm"?"A":"S";S.draft=mkDraft(curItem(),S,S.next);S.phase=d.step;return keepScroll()}
  if(d.next){const S=curS(),item=curItem();S.next=d.next;if(item.type==="ladder"){S.phase="rest";return keepScroll()}S.draft=mkDraft(item,S,d.next);S.draft.ready=false;S.phase=d.next==="A"?"warm":"work";return keepScroll()}
  if(d.ew){const [pid,w]=d.ew.split(":");ui.editWeek=ui.editWeek||{};ui.editWeek[pid]=w==="all"?"all":+w;return keepScroll()}
  if(d.wreset){const [pid,u,w]=d.wreset.split(":");const p=planById(pid);if(p.weekUnits&&p.weekUnits[w])delete p.weekUnits[w][u];markPending();return keepScroll()}
  if(d.cfmt){const S=curS();if(S.cardio.rounds.length||S.cardio.sprints.some(x=>x.done)||S.cardio.dur.sec){if(!confirmBtn(b))return}const item=curItem();const c=initCardio({...item,type:d.cfmt});S.cardio=c;return keepScroll()}
  if(d.ivp){const p=IV_PRESETS.find(x=>x[0]===d.ivp)[1];Object.assign(curS().cardio.iv,p,{custom:null});return keepScroll()}
  if(d.ivs){const [k,st]=d.ivs.split(":");const c=curS().cardio.iv;c[k]=Math.max(k==="rest"?0:k==="rounds"?1:5,num(c[k])+(+st));if(c.custom&&k==="rounds")c.custom=null;return keepScroll()}
  if(a==="ivcustomon"){const C=curS().cardio;C.iv.custom=ivRounds(C.iv).map(x=>[...x]);C.customOpen=true;return keepScroll()}
  if(a==="ivcustomoff"){const C=curS().cardio;C.iv.custom=null;return keepScroll()}
  if(a==="ivstart")return itStart();
  if(d.spdone!=null){const S=curS(),C=S.cardio,k=+d.spdone,s=C.sprints[k];s.done=!s.done;if(s.done&&C.sprints.some(x=>!x.done))startTimer(C.sp.rest,`Pause · nächster Sprint`);markPending();return keepScroll()}
  if(a==="spadd"){curS().cardio.sprints.push({sec:"",done:false});return keepScroll()}
  if(a==="spdel"){const sp=curS().cardio.sprints;if(sp.length>1&&!sp[sp.length-1].done)sp.pop();return keepScroll()}
  if(a==="sw"){const C=curS().cardio;audioUnlock();if(C.sw.start!=null){C.sw.acc+=(Date.now()-C.sw.start)/1000;C.sw.start=null;C.dur.sec=Math.round(C.sw.acc);wakeOff()}else{C.sw.start=Date.now();wakeOn()}markPending();return keepScroll()}
  if(a==="swreset"){const C=curS().cardio;C.sw={start:null,acc:0};C.dur.sec=0;return keepScroll()}
  if(a==="syncnow")return syncNow(true);
  if(a==="backup")return exportBackup();
  if(a==="logout"){if(!confirmBtn(b))return;return logout()}
  if(a==="soundtest"){audioUnlock();return cue("go","Los! Runde 1 von 8")}
  if(d.tweek){const [pid,k]=d.tweek.split(":");ui.tw=ui.tw||{};ui.tw[pid]=+k;return keepScroll()}
  if(d.extra)return extraSheet(d.extra);
  if(a==="freestart")return freeSheet();
  if(a==="freego"){const name=($("#freeName").value||"").trim()||"Freies Training";closeSheet();ui.sess={planId:"free",unitId:null,unitName:name,free:true,week:null,idx:0,list:[],st:[],feel:null,note:""};render();return window.scrollTo(0,0)}
  if(d.freerep!=null){const l=state.log[+d.freerep];closeSheet();ui.sess={planId:"free",unitId:null,unitName:l.unit,free:true,week:null,idx:0,list:l.items.map(i=>i.cardio?I(i.ex,i.cardio.fmt,{iv:i.cardio.iv,sp:i.cardio.sp,du:i.cardio.du}):I(i.ex,"normal",{base:i.sets&&i.sets[0]?num(i.sets[0].kg):0})),st:[],feel:null,note:""};render();return window.scrollTo(0,0)}
  if(d.extrastart){const [pid,uid_]=d.extrastart.split(":");const p=planById(pid),unit=p.units.find(u=>u.id===uid_);closeSheet();
    ui.sess={planId:pid,unitId:uid_,extra:true,week:twOf(p),idx:0,list:viewItems(p,unit,twOf(p)).map(it=>JSON.parse(JSON.stringify(it))),st:[],feel:null,note:""};render();return window.scrollTo(0,0)}
  if(d.extranew){const name=$("#extraName").value.trim()||"Zusätzliche Einheit";const p=planById(d.extranew);closeSheet();
    ui.sess={planId:p.id,unitId:null,unitName:name,extra:true,week:twOf(p),idx:0,list:[],st:[],feel:null,note:""};render();return window.scrollTo(0,0)}
  if(a==="cancelsess"){ui.sess=null;return keepScroll()}
  if(d.rest!=null)return chooseRest(+d.rest);
  if(d.wlabel!=null){const t=setTarget();t.label=d.wlabel;return keepScroll()}
  if(d.wmode){const t=setTarget();t.label=($("#wLabel")||{}).value??t.label;t.mode=d.wmode;return keepScroll()}
  if(d.qpct!=null){const t=setTarget();t.pct=+d.qpct;return keepScroll()}
  if(a==="setdone"){const S=curS(),item=curItem(),dr=S.draft;const tr=$("#trInp");if(tr&&tr.value.trim())dr.tr=tr.value.trim().replace("-","–");
    const kg=sollKg(item,S,dr);if(dr.reps===""){const r=parseRange(dr.tr||dr.hint||dr.sec||"").min;if(!r){const f=document.querySelector('.setcard [data-f="reps"]');f&&f.focus();return}dr.reps=String(r)}
    if(dr.kind==="A"){const wl=$("#wLabel");if(wl)dr.label=wl.value.trim()||dr.label||""}dr.soll={kg,reps:dr.tr||"",pct:dr.pct};if(dr.kg==="")dr.kg=dr.sec?"":fmt(kg);
    if(dr.kind==="A"){S.warm.push(dr);S.phase="askWarm"}else{const b=bestOf(item.ex),kgD=num(dr.kg),rD=num(dr.reps)+num(dr.part||0);if(!dr.sec&&kgD>0&&(!b||kgD>b.kg||(kgD===b.kg&&rD>b.reps))&&!S.sets.some(x=>x.pr&&num(x.kg)>=kgD))dr.pr=true;S.sets.push(dr);S.phase="askWork"}S.draft=null;S.resting=false;timer.onEnd=null;markPending();return keepScroll()}
  if(a==="skiprest")return endTimerNow();
  if(d.delwarm!=null){const S=curS();S.warm.splice(+d.delwarm,1);if(!S.warm.length&&!S.sets.length&&S.phase==="askWarm")S.phase="start";return keepScroll()}
  if(d.editset!=null){const S=curS();S.editIdx=+d.editset;S.backup=JSON.parse(JSON.stringify(S.sets[S.editIdx]));return keepScroll()}
  if(a==="canceledit"){const S=curS();S.sets[S.editIdx]=S.backup;S.editIdx=null;return keepScroll()}
  if(a==="saveedit"){curS().editIdx=null;markPending();return keepScroll()}
  if(d.delset!=null){const S=curS();S.sets.splice(+d.delset,1);S.editIdx=null;if(!S.sets.length&&S.phase==="askWork"){S.phase="start"}markPending();return keepScroll()}
  if(d.side){setTarget().side=d.side;return keepScroll()}
  if(d.assist){const t=setTarget();t.assist=!t.assist;return keepScroll()}
  if(d.rung){const [r,k]=d.rung.split(":").map(Number);const S=curS();S.rungs[r][k]=!S.rungs[r][k];return keepScroll()}
  if(d.round!=null){const S=curS(),item=curItem(),r=+d.round;S.rdone[r]=!S.rdone[r];if(S.rdone[r]&&S.rdone.filter(Boolean).length<item.rounds)S.phase="rest";else S.phase="ladder";markPending();return keepScroll()}
  if(d.feel){const v=d.v,p=d.feel;const tog=(o,k)=>{o[k]=o[k]===v?null:v};
    if(p==="session")tog(ui.sess,"feel");else if(p==="ex")tog(curS(),"feel");else if(p==="set")tog(setTarget(),"feel");
    b.parentElement.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b&&x.getAttribute("aria-pressed")!=="true"?"true":"false"));markPending();return}
  if(a==="nextex"){const S=curS();S.resting=false;timer.onEnd=null;stopTimer();return goEx(ui.sess.idx+1)}
  if(a==="skip"){curS().skipped=true;return goEx(ui.sess.idx+1)}
  if(a==="unskip"){curS().skipped=false;return keepScroll()}
  if(d.goex!=null)return goEx(+d.goex);
  if(d.jump!=null){closeSheet();return goEx(+d.jump)}
  if(a==="overview")return overview();
  if(a==="swap"){ui.pick={target:"swap",q:""};return renderPicker()}
  if(a==="addex"){ui.pick={target:"add",q:""};return renderPicker()}
  if(d.swapkeep!=null){const it=curItem(),{unit}=sessUnit();const kind=ui.swapAsk;
    if(d.swapkeep!=="0"){const clean=JSON.parse(JSON.stringify(it));delete clean._k;delete clean._swapped;delete clean._added;const plan=planById(ui.sess.planId);let L=unit.items;
      if(d.swapkeep==="w"&&ui.sess.week!=null){plan.weekUnits=plan.weekUnits||{};const wu=plan.weekUnits[ui.sess.week]=plan.weekUnits[ui.sess.week]||{};if(!wu[unit.id])wu[unit.id]=JSON.parse(JSON.stringify(viewItems(plan,unit,null)));L=wu[unit.id]}
      if(kind==="swap"&&it._k!=null)L[it._k]=clean;else if(kind==="add"){L.push(clean);it._k=L.length-1}markPending()}
    closeSheet();render();return window.scrollTo(0,0)}
  if(a==="finish")return finishSession();
  if(a==="savesession")return saveSession();
  if(a==="close")return backFromSheet();
  /* --- Pläne --- */
  if(d.week!=null){const [pid,k]=d.week.split(":");planById(pid).week=+k;markPending();return keepScroll()}
  if(a==="wizard")return openWizard();
  if(d.reuse)return openWizard(d.reuse);
  if(d.archive){if(!confirmBtn(b))return;const p=planById(d.archive);p.status="archiv";p.finished=iso(new Date());markPending();return keepScroll()}
  if(d.edit){const [u,k]=d.edit.split(":");ui.openUnit=u;return openEditor(u,+k,false)}
  if(d.move){const [u,k,dir]=d.move.split(":");const L=listFor(u,true),x=+k,y=x+(+dir);[L[x],L[y]]=[L[y],L[x]];ui.openUnit=u;markPending();return keepScroll()}
  if(d.pick){ui.openUnit=d.pick;return openPicker(d.pick)}
  if(d.pickex)return pickDone(d.pickex);
  if(a==="picknew"){const ex=readNewEx("pk");if(ex){markPending();pickDone(ex.id)}return}
  if(a==="ed-save"){if(!readEditor())return;listFor(ui.edit.unitId,true)[ui.edit.k]=ui.edit.d;closeSheet();markPending();return keepScroll()}
  if(a==="ed-del"){listFor(ui.edit.unitId,true).splice(ui.edit.k,1);closeSheet();markPending();return keepScroll()}
  if(d.nextcycle)return nextCycleModal(d.nextcycle);
  if(a==="nc-save"){const p=planById(ui.ncPlan),c=cycById(p.cycle);document.querySelectorAll("[data-ncmax]").forEach(inp=>{const v=num(inp.value);if(!isNaN(v)){const e2=exById(inp.dataset.ncmax);e2.max=e2.max||{};e2.max[c.basis]=v}});
    const np=JSON.parse(JSON.stringify(p));Object.assign(np,{id:uid("p"),name:$("#nc-name").value||p.name,start:$("#nc-start").value,week:0,done:{},status:"aktiv"});delete np.finished;np.units=cloneUnits(np.units);np.weekUnits={};
    if(p.status==="aktiv"){p.status="archiv";p.finished=iso(new Date())}state.plans.unshift(np);closeSheet();markPending();return keepScroll()}
  if(a==="wz-next"){if(!readWizard())return;ui.wiz.step++;return renderWizard()}
  if(a==="wz-back"){readWizard();ui.wiz.step--;return renderWizard()}
  if(a==="wz-save")return saveWizard();
  if(a==="wz-addunit"){ui.wiz.d.units.push({id:uid("u"),name:"",items:[]});renderWizard();const ins=document.querySelectorAll("[data-wzu]");ins[ins.length-1]&&ins[ins.length-1].focus();return}
  if(d.wzudel!=null){ui.wiz.d.units.splice(+d.wzudel,1);return renderWizard()}
  if(d.wzpick!=null){ui.pick={target:"wiz",unitIdx:+d.wzpick,q:""};return renderPicker()}
  if(d.wzidel){const [u,k]=d.wzidel.split(":").map(Number);ui.wiz.d.units[u].items.splice(k,1);return renderWizard()}
  if(d.wzw){const n=ui.wiz.d.newCyc;if(+d.wzw>0)n.weeks.push({tag:"",pct:n.weeks[n.weeks.length-1].pct});else if(n.weeks.length>1)n.weeks.pop();return renderWizard()}
  /* --- Bibliothek --- */
  if(d.libseg){ui.libSeg=d.libseg;render();return window.scrollTo(0,0)}
  if(a==="newex"){ui.newEx=true;return keepScroll()}
  if(a==="cancelex"){ui.newEx=false;return keepScroll()}
  if(a==="saveex"){if(readNewEx("nx")){ui.newEx=false;markPending();keepScroll()}return}
  if(d.del){if(!confirmBtn(b))return;const e2=exById(d.del);e2.deleted=true;state.plans.forEach(p=>p.units.forEach(u=>u.items=u.items.filter(it=>it.ex!==d.del)));markPending();return keepScroll()}
  if(a==="newcyc"){state.cycles.push({id:uid("c"),name:"Neuer Zyklus",basis:3,weeks:[{tag:"",pct:80},{tag:"",pct:90},{tag:"",pct:100}]});markPending();return keepScroll()}
  if(d.cweek){const [ci,dir]=d.cweek.split(":").map(Number);const w=state.cycles[ci].weeks;if(dir>0)w.push({tag:"",pct:w[w.length-1].pct});else if(w.length>1)w.pop();state.plans.forEach(p=>{if(p.cycle===state.cycles[ci].id)p.week=Math.min(p.week,w.length-1)});markPending();return keepScroll()}
  if(d.cdel!=null){if(!confirmBtn(b))return;state.cycles.splice(+d.cdel,1);markPending();return keepScroll()}
  if(d.histweek){const [pid,k]=d.histweek.split(":");ui.histWeek=ui.histWeek||{};ui.histWeek[pid]=+k;ui.histOpen=pid;if(ui.histSheet===pid&&$("#modal").classList.contains("on"))return histSheet(pid);return keepScroll()}
  if(d.histsheet)return histSheet(d.histsheet);
  if(a==="addstyle"){const v=$("#newStyle").value.trim();if(v&&!state.styles.includes(v)){state.styles.push(v);markPending()}return keepScroll()}
  if(d.stdel!=null){state.styles.splice(+d.stdel,1);markPending();return keepScroll()}
  if(d.nxkind){const keep={};["pk-name","nx-name"].forEach(i=>{const el=$("#"+i);if(el)keep[i]=el.value});ui.nxKind=d.nxkind;if(ui.pick){renderPicker();const det=document.querySelector("#sheet details");if(det)det.open=true}else render();Object.entries(keep).forEach(([i,v])=>{const el=$("#"+i);if(el)el.value=v});return}
  if(d.pex){ui.progEx=d.pex;ui.freqOpen=true;render();return window.scrollTo(0,0)}
  if(d.cpf){ui.cfmt=d.cpf;return keepScroll()}
  if(d.range){ui.range=d.range;return keepScroll()}
});

document.addEventListener("input",e=>{const t=e.target;
  if(t.id==="partRange"){const tg=setTarget(),v=+t.value;tg.part=String(v/100);$("#partLbl").textContent=v?v+" %":"keine";return}
  if(t.id==="pctRange"){const tg=setTarget();tg.pct=+t.value;$("#pctLbl").textContent=fmt(tg.pct)+" %";const kg=sollKg(curItem(),curS(),tg);$("#sollKg").textContent=kgLabel(exById(curItem().ex),kg);const f=document.querySelector('.setcard [data-f="kg"]');if(f)f.placeholder=fmt(kg);const pt=$("#plateTxt"),pf=platesFor(exById(curItem().ex),kg);if(pt)pt.textContent=pf;
    document.querySelectorAll(".qchip").forEach(q=>q.classList.toggle("on",+q.dataset.qpct===tg.pct));return}
  if(t.id==="libSearch"){ui.libSearch=t.value;const pos=t.selectionStart;render();const s=$("#libSearch");s.focus();s.setSelectionRange(pos,pos)}
  if(t.id==="pickQ"){ui.pick.q=t.value;const pos=t.selectionStart;renderPicker();const s=$("#pickQ");s.focus();s.setSelectionRange(pos,pos)}});
document.addEventListener("change",e=>{const t=e.target,d=t.dataset,id=t.id;
  /* Training */
  if(id==="workInp"){const v=num(t.value);if(!isNaN(v)){curS().work=v;keepScroll()}return}
  if(id==="wLabel"){const tg=setTarget();if(tg)tg.label=t.value.trim();return}
  if(id==="trInp"){const tg=setTarget();if(tg)tg.tr=t.value.trim().replace("-","–");return}
  if(d.f&&ui.sess&&t.closest(".setcard")){setTarget()[d.f]=t.value;markPending();return}
  if(id==="exNote"){curS().note=t.value;markPending();return}
  if(id==="sessNote"){ui.sess.note=t.value;return}
  if(d.ivv){const c=curS().cardio.iv,v=num(t.value);if(!isNaN(v)){c[d.ivv]=Math.max(d.ivv==="rest"?0:1,v);if(d.ivv==="rounds")c.custom=null}return keepScroll()}
  if(d.ivc){const [k,j]=d.ivc.split(":").map(Number);const v=num(t.value);if(!isNaN(v))curS().cardio.iv.custom[k][j]=Math.max(j?0:5,v);return keepScroll()}
  if(t.hasAttribute&&t.hasAttribute("data-ivmetric")){curS().cardio.iv.metric=t.value;return keepScroll()}
  if(d.rval!=null){curS().cardio.rounds[+d.rval].val=t.value;markPending();return}
  if(t.hasAttribute&&t.hasAttribute("data-spdist")){const v=num(t.value);if(v>0)curS().cardio.sp.dist=v;return keepScroll()}
  if(d.spsec!=null){curS().cardio.sprints[+d.spsec].sec=t.value;markPending();return}
  if(d.du){const C=curS().cardio;if(d.du==="min"){const v=num(t.value);C.dur.sec=isNaN(v)?0:Math.round(v*60);C.sw={start:null,acc:C.dur.sec}}else C.dur[d.du]=t.value;markPending();return keepScroll()}
  if(id==="setSound"){state.settings.sound=t.value;markPending();return}
  if(id==="sessLight"){ui.sess.light=t.checked;return}
  if(id==="sessDate"){ui.sess.date=t.value;return}
  if(d.pstart){planById(d.pstart).start=t.value;markPending();return keepScroll()}
  if(d.pend){planById(d.pend).end=t.value||undefined;markPending();return keepScroll()}
  /* Pläne */
  if(d.max){const [pid,eid]=d.max.split(":");const v=num(t.value),e2=exById(eid),c=cycById(planById(pid).cycle);e2.max=e2.max||{};if(!isNaN(v)){e2.max[c.basis]=v;markPending();keepScroll()}return}
  if(id==="ed-type"){const E=ui.edit,old=E.d;E.d=I(old.ex,t.value,{base:old.base,prio:t.value==="normal"&&old.prio});return renderEditor()}
  if(id==="ed-prio"){ui.edit.d.prio=t.checked;readEditor();return renderEditor()}
  if(d.wzprio){const [u,k]=d.wzprio.split(":").map(Number);ui.wiz.d.units[u].items[k].prio=t.checked;return}
  if(t.name==="wzc"){ui.wiz.d.cycle=t.value;return renderWizard()}
  if(d.wzu!=null){ui.wiz.d.units[+d.wzu].name=t.value;return}
  if(d.wztype){const [u,k]=d.wztype.split(":").map(Number);const it=ui.wiz.d.units[u].items[k];ui.wiz.d.units[u].items[k]=I(it.ex,t.value,{base:it.base,prio:t.value==="normal"&&it.prio});return}
  if(id==="wz-cname"){ui.wiz.d.newCyc.name=t.value;return}
  if(id==="wz-cbasis"){ui.wiz.d.newCyc.basis=+t.value;return}
  if(d.wzp!=null){const v=num(t.value);if(!isNaN(v))ui.wiz.d.newCyc.weeks[+d.wzp].pct=v;return}
  /* Bibliothek */
  if(d.cname!=null){state.cycles[+d.cname].name=t.value||"Ohne Namen";markPending();return}
  if(d.cbasis!=null){state.cycles[+d.cbasis].basis=+t.value;markPending();return keepScroll()}

  if(d.ctag){const [ci,k]=d.ctag.split(":").map(Number);state.cycles[ci].weeks[k].tag=t.value;markPending();return}
  if(d.cpct){const [ci,k]=d.cpct.split(":").map(Number);const v=num(t.value);if(!isNaN(v))state.cycles[ci].weeks[k].pct=v;markPending();return}

  if(id==="setPlates"){const v=t.value.split(/[;\s]+/).map(num).filter(x=>x>0);if(!v.length){$("#plateErr").textContent="Mindestens eine Scheibe angeben, z. B. 1,25; 2,5; 5";return}state.settings.plates=v.sort((x,y)=>x-y);markPending();return keepScroll()}
  if(id==="setRound"){state.settings.rounding=t.value;markPending();return}
  if(id==="setEffort"){state.settings.effort=t.value;markPending();return}
  if(id==="setE1"){state.settings.e1rm=t.value;markPending();return}
  if(id==="setBw"){const v=num(t.value);if(!isNaN(v))state.settings.bodyweight=v;markPending();return}
  /* Fortschritt */
  if(id==="progSel"){ui.progEx=t.value;return keepScroll()}
  if(id==="rangeFrom"){ui.range="from";ui.from=t.value;return keepScroll()}
  if(id==="withBw"){ui.withBw=t.checked;return keepScroll()}
  if(id==="bwInp"){const v=num(t.value);if(!isNaN(v)){state.settings.bodyweight=v;keepScroll()}return}
});
$("#modal").addEventListener("click",e=>{if(e.target.id==="modal")backFromSheet()});
$("#tMinus").onclick=()=>{timer.end-=15000;tick()};$("#tPlus").onclick=()=>{timer.end+=15000;timer.total+=15;tick()};$("#tStop").onclick=endTimerNow;
boot();

