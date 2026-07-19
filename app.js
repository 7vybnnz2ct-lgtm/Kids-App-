
import React, {useEffect, useMemo, useRef, useState} from "https://esm.sh/react@19.1.1";
import {createRoot} from "https://esm.sh/react-dom@19.1.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);
const KEY = "baerflix.react.v1";
const today = () => new Date().toISOString().slice(0,10);
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const defaults = {
  settings:{minutesPerEpisode:12,pinHash:"",pinSalt:""},
  kids:[],
  categories:["Serien","Fahrzeuge","Tiere","Musik","Einschlafen"],
  videos:[],
  chips:{}
};

function loadData(){
  try{
    const saved=JSON.parse(localStorage.getItem(KEY)||"{}");
    return {...defaults,...saved,settings:{...defaults.settings,...(saved.settings||{})}};
  }catch{return structuredClone(defaults)}
}
function saveData(d){localStorage.setItem(KEY,JSON.stringify(d))}
function getVideoId(url=""){
  const m=String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/);
  return m?.[1] || String(url).trim();
}
const thumb=id=>`https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const fmt=seconds=>`${String(Math.floor(Math.max(0,seconds)/60)).padStart(2,"0")}:${String(Math.floor(Math.max(0,seconds)%60)).padStart(2,"0")}`;

async function hashPin(pin,saltB64){
  const enc=new TextEncoder();
  const salt=saltB64 ? Uint8Array.from(atob(saltB64),c=>c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey("raw",enc.encode(pin),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:150000,hash:"SHA-256"},key,256);
  return {hash:btoa(String.fromCharCode(...new Uint8Array(bits))),salt:btoa(String.fromCharCode(...salt))};
}

function Modal({children,onClose}){
  return html`<div className="modal-backdrop" onMouseDown=${e=>e.target===e.currentTarget&&onClose()}>
    <div className="modal">${children}</div>
  </div>`;
}

function App(){
  const [data,setData]=useState(loadData);
  const [screen,setScreen]=useState(data.kids.length?"profiles":"onboarding");
  const [selectedKid,setSelectedKid]=useState(null);
  const [allowance,setAllowance]=useState(null);
  const [category,setCategory]=useState("Alle");
  const [modal,setModal]=useState(null);
  const [toast,setToast]=useState("");
  const [playerVideo,setPlayerVideo]=useState(null);

  useEffect(()=>saveData(data),[data]);
  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(""),2400);return()=>clearTimeout(t)}},[toast]);

  function update(mutator){setData(old=>{const next=structuredClone(old);mutator(next);return next})}
  function chipState(kidId){
    const current=data.chips[kidId];
    if(!current||current.date!==today()){
      const fresh={date:today(),used:{one1:false,one2:false,two:false},bonus:current?.bonus||0};
      update(d=>d.chips[kidId]=fresh);
      return fresh;
    }
    return current;
  }
  function chooseKid(kid){setSelectedKid(kid);setScreen("chips")}
  function chooseChip(type,minutes){setAllowance({type,remaining:minutes*60});setScreen("library")}
  function consumeChip(){
    if(!selectedKid||!allowance)return;
    update(d=>{
      let cs=d.chips[selectedKid.id];
      if(!cs||cs.date!==today())cs=d.chips[selectedKid.id]={date:today(),used:{one1:false,one2:false,two:false},bonus:cs?.bonus||0};
      if(allowance.type==="bonus")cs.bonus=Math.max(0,cs.bonus-1);else cs.used[allowance.type]=true;
    });
  }

  async function unlockParent(pin){
    if(!data.settings.pinHash){setModal("admin");return}
    const r=await hashPin(pin,data.settings.pinSalt);
    if(r.hash===data.settings.pinHash)setModal("admin");else setToast("PIN nicht korrekt");
  }

  const shell=content=>html`<div className="app">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">🐻</div><div><h1>Bärflix</h1><small>Unser Familienkino</small></div></div>
      ${screen!=="onboarding"&&html`<button className="btn ghost" onClick=${()=>setModal("login")}>Elternbereich</button>`}
    </header>
    <main className="main">${content}</main>
    ${toast&&html`<div className="toast">${toast}</div>`}
  </div>`;

  if(screen==="onboarding")return shell(html`<Onboarding data=${data} update=${update} done=${()=>setScreen("profiles")} setToast=${setToast}/>`);

  let content;
  if(screen==="profiles")content=html`<${Profiles} kids=${data.kids} chooseKid=${chooseKid}/>`;
  if(screen==="chips")content=html`<${Chips} kid=${selectedKid} data=${data} chipState=${chipState} choose=${chooseChip} back=${()=>setScreen("profiles")}/>`;
  if(screen==="library")content=html`<${Library} kid=${selectedKid} data=${data} allowance=${allowance} category=${category} setCategory=${setCategory}
      back=${()=>{setAllowance(null);setScreen("chips")}} play=${setPlayerVideo}/>`;

  return shell(html`${content}
    ${modal==="login"&&html`<${LoginModal} close=${()=>setModal(null)} unlock=${unlockParent}/>`}
    ${modal==="admin"&&html`<${AdminModal} data=${data} update=${update} close=${()=>setModal(null)} setToast=${setToast}/>`}
    ${playerVideo&&html`<${Player} video=${playerVideo} allowance=${allowance} setAllowance=${setAllowance}
      close=${()=>setPlayerVideo(null)} expired=${()=>{consumeChip();setPlayerVideo(null);setAllowance(null);setScreen("chips");setToast("Die Bärflix-Zeit ist abgelaufen.")}}/>}
  `);
}

function Onboarding({data,update,done,setToast}){
  const [step,setStep]=useState(1),[pin,setPin]=useState(""),[name,setName]=useState(""),[avatar,setAvatar]=useState("🐻");
  async function savePin(){
    if(pin.length<4)return setToast("Bitte mindestens vier Ziffern verwenden");
    const r=await hashPin(pin);update(d=>{d.settings.pinHash=r.hash;d.settings.pinSalt=r.salt});setStep(2)
  }
  function addFirstKid(){
    if(!name.trim())return setToast("Bitte einen Namen eingeben");
    update(d=>d.kids.push({id:uid(),name:name.trim(),avatar}));done()
  }
  return html`<div className="onboarding">
    <div className="steps"><span className=${`step-dot ${step>=1?"active":""}`}></span><span className=${`step-dot ${step>=2?"active":""}`}></span></div>
    <section className="hero">
      <div className="hero-emoji">🐻🍿</div>
      ${step===1?html`<h2>Willkommen bei Bärflix</h2><p>Lege zuerst eine Eltern-PIN fest. Kinder kommen damit nicht in die Einstellungen.</p>
        <div className="form" style=${{marginTop:20}}><label>Eltern-PIN<input type="password" inputMode="numeric" value=${pin} onChange=${e=>setPin(e.target.value)} placeholder="mindestens 4 Ziffern"/></label></div>
        <div className="actions"><button className="btn primary" onClick=${savePin}>Weiter</button></div>`
      :html`<h2>Erstes Kinderprofil</h2><p>Weitere Profile kannst du später jederzeit im Elternbereich hinzufügen.</p>
        <div className="form-grid" style=${{marginTop:20}}>
          <label>Name<input value=${name} onChange=${e=>setName(e.target.value)} placeholder="z. B. Ludwig"/></label>
          <label>Avatar<select value=${avatar} onChange=${e=>setAvatar(e.target.value)}><option>🐻</option><option>🦊</option><option>🐼</option><option>🦁</option><option>🐯</option><option>🐨</option></select></label>
        </div><div className="actions"><button className="btn primary" onClick=${addFirstKid}>Bärflix starten</button></div>`}
    </section>
  </div>`;
}

function Profiles({kids,chooseKid}){
  return html`<section className="hero"><div><h2>Wer schaut heute?</h2><p>Wähle ein Profil. Danach wird ein Chip ausgesucht und nur die von euch freigegebenen Videos erscheinen.</p></div><div className="hero-emoji">🍿</div></section>
  <div className="section-head"><div><h2>Profile</h2><p>Einfach antippen</p></div></div>
  <div className="profile-grid">${kids.map(k=>html`<button className="profile-card" onClick=${()=>chooseKid(k)}><div className="avatar">${k.avatar}</div><h3>${k.name}</h3><div className="subtle">Profil öffnen</div></button>`)}</div>`;
}

function Chips({kid,data,chipState,choose,back}){
  const cs=chipState(kid.id),m=data.settings.minutesPerEpisode;
  const chip=(key,label,minutes,klass)=>html`<button disabled=${cs.used[key]} className=${`chip ${klass} ${cs.used[key]?"used":""}`} onClick=${()=>choose(key,minutes)}><b>${label}</b><span>${minutes} Minuten</span></button>`;
  return html`<button className="btn ghost" onClick=${back}>← Profile</button>
    <section className="hero" style=${{marginTop:16}}><div><h2>${kid.name}, welchen Chip möchtest du?</h2><p>Die Zeit läuft nur, während das Video abgespielt wird.</p></div><div className="hero-emoji">${kid.avatar}</div></section>
    <div className="section-head"><div><h2>Deine Chips</h2><p>Sie werden jeden Tag automatisch erneuert.</p></div></div>
    <div className="chip-grid">${chip("one1","⭐ Eine Folge",m,"one")}${chip("one2","⭐ Eine Folge",m,"one")}${chip("two","⭐⭐ Zwei Folgen",m*2,"two")}
      <button disabled=${cs.bonus<1} className=${`chip bonus ${cs.bonus<1?"used":""}`} onClick=${()=>choose("bonus",m)}><b>🌈 Bonuschip</b><span>${cs.bonus} verfügbar · ${m} Minuten</span></button>
    </div>`;
}

function Library({kid,data,allowance,category,setCategory,back,play}){
  const cats=["Alle",...data.categories],videos=data.videos.filter(v=>category==="Alle"||v.category===category);
  return html`<button className="btn ghost" onClick=${back}>← Chips</button>
    <div className="section-head"><div><h2>Was möchtest du schauen?</h2><p>${kid.name} · ${fmt(allowance.remaining)} verfügbar</p></div>
      <button className="btn mint" disabled=${!videos.length} onClick=${()=>videos.length&&play(videos[Math.floor(Math.random()*videos.length)])}>🎲 Überrasch mich</button></div>
    <div className="category-row">${cats.map(c=>html`<button className=${`category ${category===c?"active":""}`} onClick=${()=>setCategory(c)}>${c}</button>`)}</div>
    <div className="media-grid">${videos.length?videos.map(v=>html`<article className="media-card"><img src=${thumb(v.youtubeId)} alt=""/><span className="play-badge">▶</span>
      <div className="media-card-body"><h3>${v.title}</h3><p>${v.category}</p></div><button className="play-overlay" aria-label="Video starten" onClick=${()=>play(v)}></button></article>`)
      :html`<div className="empty">In dieser Kategorie sind noch keine Videos freigegeben.</div>`}</div>`;
}

function LoginModal({close,unlock}){
  const [pin,setPin]=useState("");
  return html`<${Modal} onClose=${close}><div className="modal-header"><h2>Elternbereich</h2><button className="btn ghost" onClick=${close}>Schließen</button></div>
    <div className="form" style=${{marginTop:18}}><label>PIN<input autoFocus type="password" inputMode="numeric" value=${pin} onChange=${e=>setPin(e.target.value)} onKeyDown=${e=>e.key==="Enter"&&unlock(pin)}/></label></div>
    <div className="actions"><button className="btn primary" onClick=${()=>unlock(pin)}>Öffnen</button></div></${Modal}>`;
}

function AdminModal({data,update,close,setToast}){
  const [view,setView]=useState("main");
  const [kidName,setKidName]=useState(""),[kidAvatar,setKidAvatar]=useState("🐻");
  const [url,setUrl]=useState(""),[title,setTitle]=useState(""),[cat,setCat]=useState(data.categories[0]||"Serien");
  const [minutes,setMinutes]=useState(data.settings.minutesPerEpisode),[newPin,setNewPin]=useState("");

  async function saveSettings(){
    let result=null;if(newPin){if(newPin.length<4)return setToast("PIN muss mindestens vier Ziffern haben");result=await hashPin(newPin)}
    update(d=>{d.settings.minutesPerEpisode=Math.max(1,Number(minutes)||12);if(result){d.settings.pinHash=result.hash;d.settings.pinSalt=result.salt}});
    setNewPin("");setToast("Einstellungen gespeichert");
  }
  async function fetchTitle(){
    const id=getVideoId(url);if(!id)return;
    try{const r=await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);if(r.ok){const j=await r.json();if(!title)setTitle(j.title||"")}}catch{}
  }
  function addVideo(){
    const id=getVideoId(url);if(!id||!title.trim())return setToast("Bitte Link und Titel eingeben");
    update(d=>d.videos.push({id:uid(),youtubeId:id,title:title.trim(),category:cat}));setUrl("");setTitle("");setView("main");setToast("Videokachel hinzugefügt")
  }
  function exportBackup(){
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),a=document.createElement("a");
    a.href=URL.createObjectURL(blob);a.download=`baerflix-backup-${today()}.json`;a.click();URL.revokeObjectURL(a.href)
  }
  function importBackup(e){
    const f=e.target.files[0];if(!f)return;const r=new FileReader();
    r.onload=()=>{try{const x=JSON.parse(r.result);update(d=>Object.assign(d,x));setToast("Backup importiert")}catch{setToast("Backup konnte nicht gelesen werden")}};r.readAsText(f)
  }

  return html`<${Modal} onClose=${close}>
    <div className="modal-header"><div><h2>Elternbereich</h2><div className="subtle">Alle Daten bleiben auf diesem Gerät.</div></div><button className="btn ghost" onClick=${close}>Schließen</button></div>
    ${view==="main"&&html`<div className="admin-grid">
      <section className="panel"><h3>👧 Kinderprofile</h3><div className="list">${data.kids.map(k=>html`<div className="list-item"><span>${k.avatar} <b>${k.name}</b></span><span>
        <button className="btn" onClick=${()=>{update(d=>{const cs=d.chips[k.id]||{date:today(),used:{one1:false,one2:false,two:false},bonus:0};cs.bonus=(cs.bonus||0)+1;d.chips[k.id]=cs});setToast("Bonuschip vergeben")}}>+ Bonus</button>
        <button className="btn" onClick=${()=>{update(d=>d.chips[k.id]={date:today(),used:{one1:false,one2:false,two:false},bonus:d.chips[k.id]?.bonus||0});setToast("Chips zurückgesetzt")}}>Reset</button>
      </span></div>`)}</div><div className="actions"><button className="btn primary" onClick=${()=>setView("kid")}>Kind hinzufügen</button></div></section>
      <section className="panel"><h3>📺 Videokacheln</h3><div className="list">${data.videos.map(v=>html`<div className="list-item"><span><b>${v.title}</b><br/><small>${v.category}</small></span><button className="btn danger" onClick=${()=>update(d=>d.videos=d.videos.filter(x=>x.id!==v.id))}>Löschen</button></div>`)}</div>
        <div className="actions"><button className="btn primary" onClick=${()=>setView("video")}>Video hinzufügen</button></div></section>
      <section className="panel"><h3>⚙️ Einstellungen</h3><div className="form"><label>Minuten pro Folge<input type="number" min="1" max="120" value=${minutes} onChange=${e=>setMinutes(e.target.value)}/></label>
        <label>Neue Eltern-PIN<input type="password" inputMode="numeric" value=${newPin} onChange=${e=>setNewPin(e.target.value)} placeholder="leer lassen = unverändert"/></label></div>
        <div className="actions"><button className="btn mint" onClick=${saveSettings}>Speichern</button></div></section>
      <section className="panel"><h3>💾 Backup</h3><p className="subtle">Sichere Profile, Videos und Einstellungen.</p><div className="actions"><button className="btn" onClick=${exportBackup}>Exportieren</button>
        <label className="btn">Importieren<input hidden type="file" accept=".json" onChange=${importBackup}/></label></div></section>
    </div>`}
    ${view==="kid"&&html`<div style=${{marginTop:18}}><h3>Kind hinzufügen</h3><div className="form-grid"><label>Name<input value=${kidName} onChange=${e=>setKidName(e.target.value)}/></label>
      <label>Avatar<select value=${kidAvatar} onChange=${e=>setKidAvatar(e.target.value)}><option>🐻</option><option>🦊</option><option>🐼</option><option>🦁</option><option>🐯</option><option>🐨</option></select></label></div>
      <div className="actions"><button className="btn primary" onClick=${()=>{if(!kidName.trim())return setToast("Bitte Namen eingeben");update(d=>d.kids.push({id:uid(),name:kidName.trim(),avatar:kidAvatar}));setView("main")}}>Speichern</button><button className="btn ghost" onClick=${()=>setView("main")}>Zurück</button></div></div>`}
    ${view==="video"&&html`<div style=${{marginTop:18}}><h3>Videokachel hinzufügen</h3><div className="form"><label>YouTube-Link<input value=${url} onBlur=${fetchTitle} onChange=${e=>setUrl(e.target.value)} placeholder="https://youtu.be/..."/></label>
      <label>Titel<input value=${title} onChange=${e=>setTitle(e.target.value)} placeholder="wird oft automatisch übernommen"/></label>
      <label>Kategorie<select value=${cat} onChange=${e=>setCat(e.target.value)}>${data.categories.map(c=>html`<option>${c}</option>`)}</select></label></div>
      <div className="actions"><button className="btn primary" onClick=${addVideo}>Kachel speichern</button><button className="btn ghost" onClick=${()=>setView("main")}>Zurück</button></div></div>`}
  </${Modal}>`;
}

function Player({video,allowance,setAllowance,close,expired}){
  const iframe=useRef(null),interval=useRef(null),last=useRef(null);
  useEffect(()=>{
    const onMessage=e=>{
      if(typeof e.data!=="string")return;
      let d;try{d=JSON.parse(e.data)}catch{return}
      if(d.event==="onStateChange"){
        if(d.info===1){
          last.current=Date.now();clearInterval(interval.current);
          interval.current=setInterval(()=>{const now=Date.now(),delta=(now-last.current)/1000;last.current=now;
            setAllowance(a=>{const next={...a,remaining:a.remaining-delta};if(next.remaining<=0){setTimeout(expired,0);return {...next,remaining:0}}return next})},500);
        }else{clearInterval(interval.current)}
      }
    };
    window.addEventListener("message",onMessage);return()=>{window.removeEventListener("message",onMessage);clearInterval(interval.current)}
  },[]);
  const src=`https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  return html`<div className="player-screen"><div className="player-top"><button className="btn ghost" onClick=${close}>← Zurück</button><div className="timer">${fmt(allowance.remaining)}</div>
    <button className="btn primary" onClick=${()=>{const el=iframe.current;(el.requestFullscreen||el.webkitRequestFullscreen)?.call(el)}}>⛶ Vollbild</button></div>
    <div className="player-wrap"><iframe ref=${iframe} src=${src} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen></iframe></div></div>`;
}

createRoot(document.getElementById("root")).render(html`<${App}/>`);
if("serviceWorker" in navigator && location.protocol.startsWith("http"))window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));
