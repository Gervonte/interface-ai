import { describe, expect, it } from 'vitest';
import { OutputContractSchema, RunRequestSchema, outputSchemaFor } from '@interface-ai/contracts';
import { currentBalanceRequest, availableBalanceRequest } from '../examples/discovery-requests.js';

describe('bounded requested output contracts',()=>{
  it('requires an explicit contract for discovery and keeps replay artifact-only',()=>{
    for(const request of [currentBalanceRequest,availableBalanceRequest])expect(RunRequestSchema.parse(request)).toEqual(request);
    const {outputContract: _contract,...missing}=currentBalanceRequest;
    expect(RunRequestSchema.safeParse(missing).success).toBe(false);
    expect(RunRequestSchema.safeParse({mode:'replay',targetId:'demo-credit-union',capability:{id:'saved',version:1},inputs:{memberId:'M1002'},outputContract:currentBalanceRequest.outputContract}).success).toBe(false);
  });
  it('derives renamed typed fields and supports both distinct balance meanings',()=>{
    const contract=structuredClone(currentBalanceRequest.outputContract);
    contract.fields.available=availableBalanceRequest.outputContract.fields.availableBalanceMinor!;
    const amount=contract.fields.currentBalanceMinor!;delete contract.fields.currentBalanceMinor;contract.fields.value=amount;
    const member=contract.fields.memberId!;delete contract.fields.memberId;contract.fields.ZuluMember=member;
    const schema=outputSchemaFor(contract);
    expect(schema.properties.value).toEqual(amount.schema);expect(schema.properties.available!.type).toBe('integer');
    expect(schema.required).not.toContain('currentBalanceMinor');expect(schema.required).toHaveLength(6);expect(schema.required).toEqual([...schema.required].sort());
  });
  it.each(['missing-identity','duplicate-meaning','wrong-type','wrong-account','literal-identity','unsupported-meaning','broad-account-type'])('rejects %s rather than coercing a conflicting request',kind=>{
    const contract=structuredClone(currentBalanceRequest.outputContract);
    if(kind==='missing-identity')delete contract.fields.memberId;
    if(kind==='duplicate-meaning')contract.fields.other=contract.fields.currentBalanceMinor!;
    if(kind==='wrong-type')contract.fields.currentBalanceMinor!.schema={type:'string',maxLength:20};
    if(kind==='wrong-account')contract.account.type='checking';
    if(kind==='literal-identity')Object.assign(contract.fields.memberId!.schema,{enum:['M1001']});
    if(kind==='unsupported-meaning')Object.assign(contract.fields.currentBalanceMinor!,{meaning:'interest-rate'});
    if(kind==='broad-account-type')contract.fields.accountType!.schema={type:'string',enum:['savings','checking'],maxLength:20};
    expect(OutputContractSchema.safeParse(contract).success).toBe(false);
  });
});
