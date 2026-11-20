import {setTimeout as delay}from'node:timers/promises';
import type{Capability,Predicate}from'@interface-ai/contracts';
import type{WorkerContext}from'../execution/coordinator.js';
import type{Executor}from'../execution/executor.js';
import{ExecutionError,NeedsIntervention}from'../execution/errors.js';
import type{FailureCode}from'../execution/errors.js';
import type{RuleSet}from'./rule-profile.js';
export class BusinessOutcome extends Error{constructor(readonly code:string){super(code);}}
export class RuleEngine {
  private readonly attempts=new Map<string,number>();
  constructor(readonly rules:RuleSet,private readonly executor:Executor,private readonly context:WorkerContext,private readonly discovery=false){}
  private scope<T extends{appliesToStepIds:string[]}>(rules:T[],id:string){return rules.filter(rule=>this.discovery||rule.appliesToStepIds.includes(id));}
  async guard(condition:Predicate,stepId:string,requestedTimeoutMs=this.context.configuration.policy.budgets.stepTimeoutMs,dispatchState:'not_sent'|'settled'='settled'){
    const policy=this.context.configuration.policy.budgets;const deadline=Date.now()+Math.min(requestedTimeoutMs,policy.stepTimeoutMs);
    const guards=this.scope(this.rules.runtimeGuards??[],stepId),outcomes=this.scope(this.rules.outcomeRules,stepId),recoveries=this.scope(this.rules.recoveryRules,stepId);
    let pending:{rule:Capability['recoveryRules'][number];deadline:number}|undefined;
    while(true){
      const conditions=[condition,...guards.map(rule=>rule.when),...outcomes.map(rule=>rule.when),...recoveries.map(rule=>rule.when),...(pending?[pending.rule.after]:[])];
      const states=await this.executor.checkConditions(conditions,stepId+'-classify',Math.max(1,deadline-Date.now()));let index=1;
      for(const guard of guards){const matched=states[index++];if(!matched)continue;
        if(guard.require && (await this.executor.checkConditions([guard.require],stepId+'-identity',Math.max(1,deadline-Date.now())))[0])continue;
        await this.context.record({type:'RULE_MATCHED',actor:'automation',stepId,details:{code:guard.code,ruleId:guard.id}});
        if(guard.handling==='intervention')throw new NeedsIntervention({stepId,actionIndex:null,reason:guard.reason,dispatchState:'not_sent',effectState:'not_checked',checkpointId:stepId,expected:{code:'RECORDED_UI_CONDITION',description:'The recorded UI condition and record identity must hold.'},observed:{code:guard.code,description:'The live UI requires manual resolution before continuing.'},evidenceIds:[]});
        await this.executor.reject(guard.code as FailureCode,stepId,dispatchState);
      }
      const matchedOutcomes=outcomes.filter(()=>states[index++]);const matchedRecovery=recoveries.filter(()=>states[index++]);
      if(matchedOutcomes.length>1 || (matchedOutcomes.length&&matchedRecovery.length))await this.executor.reject('CONFLICTING_SIGNALS',stepId,dispatchState);
      if(matchedOutcomes[0]){const rule=matchedOutcomes[0];await this.context.record({type:'BUSINESS_OUTCOME',actor:'automation',stepId,details:{code:rule.code,ruleId:rule.id}});throw new BusinessOutcome(rule.code);}
      if(matchedRecovery.length>1)await this.executor.reject('CONFLICTING_SIGNALS',stepId,dispatchState);
      if(pending){
        if(states[index]){await this.context.record({type:'RECOVERY_COMPLETED',actor:'automation',stepId,details:{code:'verified',ruleId:pending.rule.id,attempt:this.attempts.get(pending.rule.id)!}});pending=undefined;continue;}
        if(Date.now()>=pending.deadline)await this.executor.reject('RECOVERY_EXHAUSTED',stepId,dispatchState);
        if(matchedRecovery.some(rule=>rule.id===pending!.rule.id)){pending=undefined;}else{await delay(policy.pollIntervalMs,undefined,{signal:this.context.signal});continue;}
      }
      const recovery=matchedRecovery[0];
      if(recovery){
        const attempt=(this.attempts.get(recovery.id)??0)+1;
        if(recovery.dispatchState!==dispatchState||attempt>Math.min(recovery.maxAttempts,policy.maxRecoveryAttempts)){
          await this.context.record({type:'RECOVERY_EXHAUSTED',actor:'automation',stepId,details:{code:'RECOVERY_EXHAUSTED',ruleId:recovery.id,attempt:attempt-1}});await this.executor.reject('RECOVERY_EXHAUSTED',stepId,dispatchState);
        }
        this.attempts.set(recovery.id,attempt);await this.context.record({type:'RECOVERY_STARTED',actor:'automation',stepId,details:{code:'declared_recovery',ruleId:recovery.id,attempt}});
        for(const[actionIndex,action]of recovery.actions.entries()){
          await this.executor.execute(action,stepId+'-r'+attempt+'-'+actionIndex,Math.min(recovery.timeoutMs,Math.max(1,deadline-Date.now())));
          const sequence=this.executor.lastEventSequence;if(!sequence)throw new ExecutionError('ARTIFACT_INVALID');
          if(this.discovery)(recovery.source.observedEventSequences??=[]).push(sequence);
        }
        pending={rule:recovery,deadline:Math.min(deadline,Date.now()+recovery.timeoutMs)};await delay(policy.pollIntervalMs,undefined,{signal:this.context.signal});continue;
      }
      if(Date.now()>=deadline)await this.executor.reject('STATE_TIMEOUT',stepId,dispatchState);
      if(states[0])return;
      if(Date.now()>=deadline)await this.executor.reject('STATE_TIMEOUT',stepId,dispatchState);
      await delay(policy.pollIntervalMs,undefined,{signal:this.context.signal});
    }
  }
}
