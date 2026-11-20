import type { Capability, Predicate, Target } from '@interface-ai/contracts';
export type RuleSet=Pick<Capability,'outcomeRules'|'recoveryRules'|'runtimeGuards'>;
const scope={kind:'frame' as const,frames:[{attribute:'title' as const,value:'Member servicing workspace'}]};
const cue=(label:string):Target=>({scope,within:[],locator:{kind:'attribute',name:'aria-label',value:label},expectedMatches:1});
const field=(region:string,label:string):Target=>({scope,within:[{kind:'container',locator:{kind:'attribute',name:'aria-label',value:region}}],locator:{kind:'field',label},expectedMatches:1});
const visible=(target:string):Predicate=>({kind:'visible',target});
const absent=(target:string):Predicate=>({kind:'absent',target});
const identity=(target:string):Predicate=>({kind:'equals',source:{target,read:'text',transform:'trim'},value:{kind:'input',name:'memberId'}});
const all=(...conditions:Predicate[]):Predicate=>({kind:'all',conditions});
export function balanceRules(targets:Record<string,Target>):RuleSet {
  Object.assign(targets,{
    ruleMemberIdentity:field('Active member','Member ID'),ruleSearchedIdentity:field('Member Search Results','Searched Member ID'),ruleAccountIdentity:field('Account Details','Account ID'),
    ruleShellIdentity:{...field('Active member','Member ID'),scope:{kind:'document'}},
    ruleNoMember:cue('No matching member'),ruleNoPrimary:cue('No primary savings account'),ruleDenied:cue('Access denied'),
    ruleNotice:cue('Servicing notice'),ruleExpiry:cue('Staff session expired'),ruleReview:cue('Servicing review required'),ruleValidation:cue('Member search validation error'),
    ruleUnavailable:cue('Account inquiry unavailable'),ruleLoading:cue('Loading servicing screen'),ruleDialog:{scope,within:[],locator:{kind:'attribute',name:'aria-modal',value:'true'},expectedMatches:1},
    ruleInquiry:{scope,within:[],locator:{kind:'role',role:'heading',name:'Account Inquiry',exact:true},expectedMatches:1},
    ruleAccounts:{scope,within:[],locator:{kind:'caption',text:'Member accounts',exact:true},expectedMatches:1},
    ruleMemberOpen:{scope,within:[{kind:'tableRow',tableCaption:'Member search results',cells:[{columnHeader:'Member ID',equals:{kind:'input',name:'memberId'}}]}],locator:{kind:'role',role:'button',name:'Open',exact:true},expectedMatches:1},
    rulePrimaryOpen:{scope,within:[{kind:'tableRow',tableCaption:'Member accounts',cells:[{columnHeader:'Account Type',equals:{kind:'literal',value:'Primary Savings'}},{columnHeader:'Designation',equals:{kind:'literal',value:'Primary'}}]}],locator:{kind:'role',role:'button',name:'Open',exact:true},expectedMatches:1},
    ruleAcknowledge:{scope,within:[{kind:'container',locator:{kind:'attribute',name:'aria-label',value:'Servicing notice'}}],locator:{kind:'role',role:'button',name:'Acknowledge notice',exact:true},expectedMatches:1},
    ruleRetry:{scope,within:[{kind:'container',locator:{kind:'attribute',name:'aria-label',value:'Account inquiry unavailable'}}],locator:{kind:'role',role:'button',name:'Try again',exact:true},expectedMatches:1},
  } satisfies Record<string,Target>);
  const source={kind:'authored' as const,reason:'Explicit, tested credit-union portal scenario contract; not inferred from a successful discovery.'};
  const outcomeRules:Capability['outcomeRules']=[
    {id:'member-not-found',code:'MEMBER_NOT_FOUND',when:all(visible('ruleNoMember'),identity('ruleSearchedIdentity')),appliesToStepIds:[],source},
    {id:'no-primary-savings',code:'NO_PRIMARY_SAVINGS_ACCOUNT',when:all(visible('ruleInquiry'),visible('ruleAccounts'),visible('ruleNoPrimary'),identity('ruleMemberIdentity')),appliesToStepIds:[],source},
    {id:'access-denied',code:'ACCESS_DENIED',when:all(visible('ruleInquiry'),visible('ruleDenied'),identity('ruleMemberIdentity')),appliesToStepIds:[],source},
  ];
  const recoveryRules:Capability['recoveryRules']=[
    {id:'acknowledge-notice',when:visible('ruleNotice'),appliesToStepIds:[],dispatchState:'settled',maxAttempts:2,timeoutMs:10_000,actions:[{type:'click',target:'ruleAcknowledge'}],after:all(absent('ruleNotice'),absent('ruleLoading'),visible('ruleAccounts')),source:{...source}},
    {id:'retry-inquiry',when:visible('ruleUnavailable'),appliesToStepIds:[],dispatchState:'settled',maxAttempts:2,timeoutMs:10_000,actions:[{type:'click',target:'ruleRetry'}],after:all(absent('ruleUnavailable'),absent('ruleLoading'),visible('ruleAccounts')),source:{...source}},
  ];
  const runtimeGuards:NonNullable<Capability['runtimeGuards']>=[
    {id:'staff-session-expired',when:visible('ruleExpiry'),handling:'intervention',code:'SESSION_EXPIRED',reason:'SESSION_EXPIRED',appliesToStepIds:[],source},
    {id:'unexpected-dialog',when:all(visible('ruleDialog'),absent('ruleNotice'),absent('ruleExpiry')),handling:'intervention',code:'UNEXPECTED_DIALOG',reason:'UNEXPECTED_DIALOG',appliesToStepIds:[],source},
    {id:'target-validation',when:visible('ruleValidation'),handling:'failure',code:'TARGET_VALIDATION_ERROR',reason:'STATE_TIMEOUT',appliesToStepIds:[],source},
    ...['ruleMemberIdentity','ruleShellIdentity'].map((target,index)=>({id:'member-identity-'+index,when:visible(target),require:identity(target),handling:'failure' as const,code:'IDENTITY_MISMATCH',reason:'STATE_TIMEOUT' as const,appliesToStepIds:[],source})),
    {id:'conflicting-no-member',when:visible('ruleNoMember'),require:absent('ruleMemberOpen'),handling:'failure',code:'CONFLICTING_SIGNALS',reason:'STATE_TIMEOUT',appliesToStepIds:[],source},
    {id:'conflicting-no-primary',when:visible('ruleNoPrimary'),require:absent('rulePrimaryOpen'),handling:'failure',code:'CONFLICTING_SIGNALS',reason:'STATE_TIMEOUT',appliesToStepIds:[],source},
    {id:'conflicting-denied',when:visible('ruleDenied'),require:absent('ruleAccounts'),handling:'failure',code:'CONFLICTING_SIGNALS',reason:'STATE_TIMEOUT',appliesToStepIds:[],source},
  ];
  return {outcomeRules,recoveryRules,runtimeGuards};
}
export function accountGuard(variable:string):NonNullable<Capability['runtimeGuards']>[number]{return{id:'account-identity',when:visible('ruleAccountIdentity'),require:{kind:'equals',source:{target:'ruleAccountIdentity',read:'text',transform:'trim'},value:{kind:'variable',name:variable}},handling:'failure',code:'IDENTITY_MISMATCH',reason:'STATE_TIMEOUT',appliesToStepIds:[],source:{kind:'authored',reason:'Account Details must match the account ID captured from the selected row.'}};}
export function attachBalanceRules(capability:Capability):Capability {
  const artifact=structuredClone(capability);const rules=balanceRules(artifact.targets);const steps=artifact.steps.filter(step=>step.type!=='navigate').map(step=>step.id);
  for(const rule of [...rules.outcomeRules,...rules.recoveryRules,...rules.runtimeGuards??[]])rule.appliesToStepIds=[...steps];
  const selected=artifact.steps.findIndex(step=>step.type==='capture'&&step.variable.startsWith('selectedAccount'));
  const capture=artifact.steps[selected];if(capture?.type==='capture'){const guard=accountGuard(capture.variable);guard.appliesToStepIds=artifact.steps.slice(selected+1).map(step=>step.id);rules.runtimeGuards!.push(guard);}
  for(const old of artifact.recoveryRules)if((old.source.observedEventSequences??[]).length){const index=rules.recoveryRules.findIndex(rule=>rule.id===old.id);if(index<0)rules.recoveryRules.push(structuredClone(old));else rules.recoveryRules[index]=structuredClone(old);}
  for(const step of artifact.steps){step.outcomeRuleIds=rules.outcomeRules.filter(rule=>rule.appliesToStepIds.includes(step.id)).map(rule=>rule.id);step.recoveryRuleIds=rules.recoveryRules.filter(rule=>rule.appliesToStepIds.includes(step.id)).map(rule=>rule.id);}
  return {...artifact,...rules};
}
