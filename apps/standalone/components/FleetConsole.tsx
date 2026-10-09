'use client';
import { useEffect,useState } from 'react';
import { Bot,ShieldCheck,RefreshCw,Radio } from 'lucide-react';

type Worker={workerId:string;role:string;capabilities:string[];generation:string;
  presence:'UNKNOWN'|'CONNECTED'|'ONLINE'|'STALE'|'OFFLINE';reportedReadiness:string;
  lastSeen:string|null;leaseUntil:string|null;observedAt:string;activeTasks:number};
const names:Record<string,string>={'cli-worker-agent':'CLI worker','ide-worker-agent':'IDE investigator','siem-worker-agent':'Chronicle reader'};
function validWorker(value:unknown):value is Worker {
  if(!value || typeof value!=='object') return false;const w=value as Worker;
  const date=(v:unknown)=>typeof v==='string' && Number.isFinite(Date.parse(v));
  return typeof w.workerId==='string' && typeof w.role==='string' && typeof w.generation==='string' &&
    Array.isArray(w.capabilities) && w.capabilities.every(c=>typeof c==='string') &&
    ['UNKNOWN','CONNECTED','ONLINE','STALE','OFFLINE'].includes(w.presence) &&
    ['UNKNOWN','READY','BUSY','BLOCKED','HALTED'].includes(w.reportedReadiness) &&
    (w.lastSeen===null || date(w.lastSeen)) && (w.leaseUntil===null || date(w.leaseUntil)) && date(w.observedAt) &&
    Number.isSafeInteger(w.activeTasks) && w.activeTasks>=0;
}
export default function FleetConsole() {
  const [rows,setRows]=useState<Worker[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const [received,setReceived]=useState<number|null>(null),[elapsed,setElapsed]=useState(0),[refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let active=true,inFlight=false,controller:AbortController|undefined;
    async function load() {
      if(inFlight || !active)return;inFlight=true;setBusy(true);controller=new AbortController();
      const timeout=setTimeout(()=>controller?.abort(),8000);
      try {
        const response=await fetch('/api/control/workers',{cache:'no-store',signal:controller.signal});
        if(!response.ok) throw new Error(response.status===401?'Session expired. Sign in again.':response.status===403?
          'Your role cannot inspect this fleet.':'Control Plane unavailable. Worker presence is not verified.');
        const data=await response.json();
        if(data.schemaVersion!=='gss.worker-presence.v1' || !Array.isArray(data.workers) ||
          data.workers.length>100 || !data.workers.every(validWorker) || new Set(data.workers.map((w:Worker)=>w.workerId)).size!==data.workers.length) {
          throw new Error('Fleet contract invalid. No presence was inferred.');
        }
        if(active) {setRows(data.workers);setReceived(performance.now());setElapsed(0);setError('');}
      } catch(e) {if(active)setError(e instanceof Error && e.name!=='AbortError'?e.message:'Fleet request timed out. Presence is not verified.');}
      finally{clearTimeout(timeout);inFlight=false;if(active)setBusy(false);}
    }
    void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},10000);
    const visible=()=>{if(document.visibilityState==='visible')void load();};document.addEventListener('visibilitychange',visible);
    return()=>{active=false;clearInterval(timer);controller?.abort();document.removeEventListener('visibilitychange',visible);};
  },[refresh]);
  useEffect(()=>{if(received===null)return;const timer=setInterval(()=>setElapsed(performance.now()-received),1000);
    return()=>clearInterval(timer);},[received]);
  const presence=(w:Worker)=>error?'UNVERIFIED':
    ['ONLINE','CONNECTED'].includes(w.presence) && w.leaseUntil && Date.parse(w.leaseUntil)-Date.parse(w.observedAt)<=elapsed?'STALE':w.presence;
  const fresh=rows.filter(w=>presence(w)==='ONLINE').length;
  return <section className="fleet-console" aria-label="Durable worker fleet">
    <div className="fleet-toolbar"><p role="status" aria-atomic="true">{received===null?
      busy?'Loading worker leases…':'No verified fleet snapshot.':`${fresh} of ${rows.length} workers with fresh heartbeat${error?' · snapshot unverified':''}`}</p>
      <button className="secondary-button" disabled={busy} onClick={()=>setRefresh(r=>r+1)}><RefreshCw size={16} aria-hidden="true" />Refresh fleet</button></div>
    {error && <p className="fleet-error" role="alert">{error}{rows.length>0?' Previous observations are retained below, not live status.':''}</p>}
    {!busy && !error && !rows.length && <div className="panel fleet-empty">No registered workers. No agent activity has been inferred.</div>}
    <div className="agent-grid">{rows.map(w=>{const state=presence(w);return <article className="panel agent-panel" key={w.workerId}>
      <div className="agent-head"><span className="agent-avatar"><Bot size={20} aria-hidden="true" /></span>
        <div><h2>{names[w.workerId] ?? w.workerId}</h2><p>{w.role}</p></div>
        <span className={`fleet-presence ${state==='ONLINE'?'fleet-fresh':'fleet-unverified'}`}><Radio size={13} aria-hidden="true" />{state}</span></div>
      <div className="capability-list" aria-label="Registered capability allowlist">{w.capabilities.map(c=><span key={c}>{c.replaceAll('_',' ')}</span>)}</div>
      <dl className="agent-stats"><div><dt>Reported readiness</dt><dd>{w.reportedReadiness}</dd></div>
        <div><dt>Recorded running tasks</dt><dd>{w.activeTasks}</dd></div><div><dt>Session generation</dt><dd>{w.generation}</dd></div></dl>
      <p className="fleet-last-seen">Last heartbeat {w.lastSeen?<time dateTime={w.lastSeen}>{new Date(w.lastSeen).toLocaleString()}</time>:'not observed'}</p>
    </article>;})}</div>
    <aside className="quiet-banner"><ShieldCheck size={20} aria-hidden="true" /><div><strong>Presence is not execution evidence</strong>
      <p>PostgreSQL leases expire after 20 seconds. Readiness is worker-reported, not a verified dependency health check.
        Running task counts are durable records, not proof of a live process. Chronicle presence does not verify credentials or IAM; no demo success rates or token totals.</p></div></aside>
  </section>;
}
