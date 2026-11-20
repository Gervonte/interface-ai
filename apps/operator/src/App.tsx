import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Container, Group, Image, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { InterventionSchema, RunViewSchema } from '@interface-ai/contracts';
import type { RunView } from '@interface-ai/contracts';

type Intervention = ReturnType<typeof InterventionSchema.parse>;
type Observation = { observationId:string; controlRevision:number; headings:string[]; controls:Array<{ref:string;kind:'click'|'fill';label:string;enabled:boolean}> };
const explanations:Record<string,string>={RESUME_VALIDATION_FAILED:'The checkpoint is not satisfied yet. Claim the session again and finish the manual resolution.',STALE_OBSERVATION:'The page changed. Refresh the session view before acting.',CONTROL_CONFLICT:'Control changed or another operation is in progress. Reload the run.',UNAUTHORIZED:'Check the operator API token.',FORBIDDEN:'This operation requires operator access.'};

export function App() {
  const [token,setToken]=useState(''),[runId,setRunId]=useState(''),[selected,setSelected]=useState('');
  const [run,setRun]=useState<RunView>(),[intervention,setIntervention]=useState<Intervention>(),[goal,setGoal]=useState(''),[resumable,setResumable]=useState(false);
  const [observation,setObservation]=useState<Observation>(),[image,setImage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [values,setValues]=useState<Record<string,string>>({});const imageRef=useRef('');
  const api=async(path:string,body?:unknown)=>{
    const response=await fetch('/api'+path,{headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
    if(!response.ok){const data=await response.json().catch(()=>({}));const code=data.error?.code;throw Error(explanations[code]??'The operation could not be completed. Refresh the run and check its status.');}return response;
  };
  const clearView=()=>{setObservation(undefined);setImage('');setValues({});if(imageRef.current){URL.revokeObjectURL(imageRef.current);imageRef.current='';}};
  useEffect(()=>()=>{if(imageRef.current)URL.revokeObjectURL(imageRef.current);},[]);
  const load=async(id=selected)=>{
    if(!id)return;const next=RunViewSchema.parse(await(await api('/v1/runs/'+id)).json());setRun(next);
    if(next.activeInterventionId){const item=InterventionSchema.parse(await(await api('/v1/interventions/'+next.activeInterventionId)).json());setIntervention(item);const context=await(await api('/v1/interventions/'+next.activeInterventionId+'/context')).json();setGoal(context.goal??'');setResumable(context.resumable===true);}
    else{setIntervention(undefined);setGoal('');setResumable(false);}
    return next;
  };
  useEffect(()=>{if(!selected)return;let stopped=false;const timer=setInterval(()=>{if(!stopped&&!busy)void load().catch(()=>{});},2500);return()=>{stopped=true;clearInterval(timer);};},[selected,token,busy]);
  useEffect(()=>{clearView();},[run?.control.revision,selected,token]);
  const perform=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(failure){setError(failure instanceof Error?failure.message:'Operation failed.');await load().catch(()=>{});}finally{setBusy(false);}};
  const refresh=async(current=run)=>{
    if(!current?.activeInterventionId||current.control.owner!=='human')return;
    const path='/v1/interventions/'+current.activeInterventionId;
    const observation:Observation=await(await api(path+'/observation?revision='+current.control.revision)).json();setObservation(observation);
    const response=await api(path+'/image?revision='+current.control.revision);const url=URL.createObjectURL(await response.blob());if(imageRef.current)URL.revokeObjectURL(imageRef.current);imageRef.current=url;setImage(url);
  };
  const act=async(control:Observation['controls'][number])=>{
    if(!run||!observation||!intervention)return;
    const body={expectedControlRevision:run.control.revision,observationId:observation.observationId,action:control.kind==='click'?{type:'click',controlRef:control.ref}:{type:'fill',controlRef:control.ref,value:values[control.ref]??''}};
    clearView();await api('/v1/interventions/'+intervention.interventionId+'/actions',body);await refresh();
  };
  const claimed=run?.status==='human_controlled';
  return <>
    <header><Container size="xl" py="md"><Group justify="space-between"><Text fw={750} className="brand">interface / automate</Text><Badge color={claimed?'orange':run?.status==='running'?'teal':'gray'}>{claimed?'Operator control':run?.status?.replaceAll('_',' ')??'Operator workspace'}</Badge></Group></Container></header>
    <main><Container size="xl" py="xl"><Stack gap="lg">
      <div><Title order={1}>Session handoff</Title><Text c="dimmed">Inspect a blocked run, resolve it in its existing browser, then return control.</Text></div>
      <Paper withBorder p="lg"><Stack><PasswordInput label="Operator API token" description="Used only in this page’s memory. Read it from your local automation configuration." value={token} onChange={event=>{setToken(event.currentTarget.value);setSelected('');setRun(undefined);clearView();}} autoComplete="off"/>
        <Group align="end"><TextInput label="Run ID" value={runId} onChange={event=>setRunId(event.currentTarget.value)} style={{flex:1}}/><Button disabled={busy||!token||!runId} loading={busy} onClick={()=>void perform(async()=>{const id=runId.trim();clearView();setSelected(id);await load(id);})}>Open run</Button></Group></Stack></Paper>
      {error&&<Alert color="red" title="Action needs attention">{error}</Alert>}
      {run&&<Paper withBorder p="lg"><Stack gap="sm"><Group justify="space-between"><Title order={2} size="h3">Run context</Title><Button variant="light" disabled={busy} onClick={()=>void perform(async()=>{await load();})}>Reload status</Button></Group>
        <Text>Run: {run.runId}</Text><Text>Mode: {run.mode} · Controller: {run.control.owner}{run.control.owner==='human'?' ('+run.control.operatorId+')':''} · Revision: {run.control.revision}</Text>
        {goal&&<Text>Goal: {goal}</Text>}{run.capability&&<Text>Capability: {run.capability.id}, version {run.capability.version}</Text>}
        {run.result&&<Alert color={run.result.kind==='success'?'teal':'gray'} title={run.result.kind.replaceAll('_',' ')}>{run.result.kind==='success'?run.result.output.availability==='available'?JSON.stringify(run.result.output.values):'Outputs are no longer retained.':run.result.kind==='cancelled'?'Run cancelled.':run.result.code}</Alert>}
      </Stack></Paper>}
      {intervention&&run&&<Paper withBorder p="lg"><Stack><Title order={2} size="h3">Manual resolution</Title><Text>{intervention.blocked.reason.replaceAll('_',' ')} · Step: {intervention.blocked.stepId??'Discovery'}</Text><Text>Expected: {intervention.blocked.expected.description}</Text><Text>Observed: {intervention.blocked.observed.description}</Text><Text c="dimmed">Session: {intervention.sessionRef} · Expires: {new Date(intervention.expiresAt).toLocaleTimeString()}</Text>
        <Group><Button disabled={busy||!resumable||run.status!=='waiting_for_human'} onClick={()=>void perform(async()=>{await api('/v1/interventions/'+intervention.interventionId+'/claim',{expectedControlRevision:run.control.revision});const next=await load();await refresh(next);})}>Claim session</Button>
          <Button variant="light" disabled={busy||!claimed} onClick={()=>void perform(async()=>{await refresh();})}>Refresh session view</Button>
          <Button color="teal" disabled={busy||!claimed} onClick={()=>void perform(async()=>{clearView();await api('/v1/interventions/'+intervention.interventionId+'/resume',{expectedControlRevision:run.control.revision});await load();})}>Validate and resume</Button>
          <Button color="red" variant="subtle" disabled={busy} onClick={()=>void perform(async()=>{clearView();await api('/v1/runs/'+run.runId+'/cancel',{reason:'USER_REQUESTED'});await load();})}>Cancel run</Button></Group>
        {!resumable&&<Alert color="orange">This stop has no validated continuation. Inspect the context and cancel the run before starting again.</Alert>}
        <Text size="sm" c="dimmed">Automation stays paused while you control the browser. Each permitted action is recorded. Resume checks the saved state and identity.</Text>
        {claimed&&observation&&<><Text fw={600}>Live screen: {observation.headings.join(' / ')}</Text>{image&&<Image src={image} alt="Current view of this run’s existing browser session" fit="contain" maw={1100}/>}
          <Group align="end">{observation.controls.map(control=><Stack key={control.ref} gap="xs">{control.kind==='fill'&&<TextInput label={control.label} value={values[control.ref]??''} onChange={event=>setValues({...values,[control.ref]:event.currentTarget.value})}/>}<Button variant="light" disabled={busy||!control.enabled} onClick={()=>void perform(()=>act(control))}>{control.kind==='fill'?'Fill '+control.label:control.label}</Button></Stack>)}</Group>
        </>}
      </Stack></Paper>}
    </Stack></Container></main>
  </>;
}
